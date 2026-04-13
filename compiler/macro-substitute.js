// compiler/macro-substitute.js — AST-level macro substitution
//
// Extracted from macro-expander.js.  Handles the pure substitution pass:
// deep-clones macro body AST, replaces $name / @param / #param placeholders,
// splices block params inline.  Does NOT expand nested macro calls —
// that's the expander's job after source-mapping.
//
// Exports:
//   substituteStmts(stmts, parsedArgs, gensymMap, id) → Stmt[]
//   parseArgForSub(arg, param)                        → ParsedArg
//   subArgTokens(tokens, parsedArgs, gensymMap, id)   → Token[]
//   kindCheck(arg, param, macroName, line, start, end) — throws MacroError
//   splitPackElements(tokens)                         → Token[][]
//   stringifyTokens(tokens)                           → string
//   mkPunct(val)                                      → Token

import { Parser }              from './parser.js';
import { TT, SCALAR_TYPES }   from './lexer.js';
import { MacroError }          from './macro-error.js';
import { PACK_KIND }           from './staticAnalysis.js';

// ── Kind checking ─────────────────────────────────────────────────────────────

export function kindCheck(arg, param, macroName, callLine, callStart, callEnd) {
  const { paramKind: kind, name } = param;
  if (kind === 'any') return;
  if (kind === PACK_KIND || kind.startsWith(PACK_KIND + '<')) return;

  if (kind === 'block' && arg.kind !== 'block') {
    throw new MacroError(
      `'${macroName}': parameter '${name}' expects kind 'block', got non-block argument`,
      callLine, 'main', callStart, callEnd,
    );
  }
  if (kind !== 'block' && arg.kind === 'block') {
    throw new MacroError(
      `'${macroName}': parameter '${name}' expects kind '${kind}', got 'block' argument`,
      callLine, 'main', callStart, callEnd,
    );
  }
  if (kind === 'ident') {
    const toks = arg.tokens.filter(t => t.type !== TT.EOF);
    if (toks.length !== 1 || toks[0].type !== TT.IDENT) {
      throw new MacroError(
        `'${macroName}': parameter '${name}' (kind=ident) requires a bare identifier, ` +
        `got: '${toks.map(t => t.value).join(' ')}'`,
        callLine, 'main', callStart, callEnd,
      );
    }
  }
  if (kind === 'type') {
    const toks = arg.tokens.filter(t => t.type !== TT.EOF);
    const first = toks[0];
    const isTypeStart = first && (
      (first.type === TT.IDENT && SCALAR_TYPES.has(first.value)) ||
      (first.type === TT.KEYWORD && (first.value === 'mut' || first.value === 'ptr' ||
                                     first.value === 'array' || first.value === 'fn')) ||
      first.type === TT.IDENT // any IDENT could be a user-defined type (struct)
    );
    if (!isTypeStart) {
      throw new MacroError(
        `'${macroName}': parameter '${name}' (kind=type) — expected type expression, ` +
        `got: '${toks.map(t => t.value).join(' ') || '(empty)'}'`,
        callLine, 'main', callStart, callEnd,
      );
    }
  }
  if (kind === 'expr') {
    const toks = arg.tokens.filter(t => t.type !== TT.EOF);
    if (toks.length === 1 && toks[0].type === TT.IDENT && SCALAR_TYPES.has(toks[0].value)) {
      throw new MacroError(
        `'${macroName}': parameter '${name}' (kind=expr) — got bare type '${toks[0].value}'; use an expression`,
        callLine, 'main', callStart, callEnd,
      );
    }
  }
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const EOF_TOK = { type: TT.EOF, value: '', line: 0, col: 0, start: 0, end: 0 };

export function parseArgForSub(arg, param) {
  const { paramKind: kind } = param;
  const tokens = arg.tokens;

  if (kind === PACK_KIND || kind.startsWith(PACK_KIND + '<')) {
    return { kind: PACK_KIND, tokens };
  }
  if (kind === 'ident') {
    const toks = tokens.filter(t => t.type !== TT.EOF);
    return { kind: 'ident', name: toks[0]?.value ?? '', tokens };
  }
  if (kind === 'block' || arg.kind === 'block') {
    const p = new Parser([...tokens, EOF_TOK]);
    const block = p.parseBlock();
    return { kind: 'block', block, tokens };
  }
  if (kind === 'type') {
    const p = new Parser([...tokens, EOF_TOK]);
    const typeNode = p.parseType();
    return { kind: 'type', typeNode, tokens };
  }
  if (kind === 'any') {
    if (arg.kind === 'block') {
      const p = new Parser([...tokens, EOF_TOK]);
      return { kind: 'any', block: p.parseBlock(), tokens };
    }
    const p = new Parser([...tokens, EOF_TOK]);
    try {
      const ast = p.parseExpr();
      return { kind: 'any', ast, tokens };
    } catch { return { kind: 'any', tokens }; }
  }
  // expr (default)
  const p = new Parser([...tokens, EOF_TOK]);
  const ast = p.parseExpr();
  return { kind: 'expr', ast, tokens };
}

// ── AST substitution ──────────────────────────────────────────────────────────

function substituteName(name, parsedArgs, gensymMap, id) {
  if (typeof name !== 'string') return name;
  if (name.startsWith('$')) {
    const bare = name.slice(1);
    if (!gensymMap.has(bare)) gensymMap.set(bare, `__mg_${bare}_${id}`);
    return gensymMap.get(bare);
  }
  if (name.startsWith('@')) {
    const bare = name.slice(1);
    const parsed = parsedArgs.get(bare);
    if (parsed?.kind === 'ident') return parsed.name;
  }
  return name;
}

function substituteTypeAnnot(typeNode, parsedArgs) {
  if (!typeNode) return typeNode;
  if (typeNode.kind === 'MacroParamExpr') {
    const bare = typeNode.name.slice(1);
    const parsed = parsedArgs.get(bare);
    return parsed?.typeNode ?? typeNode;
  }
  if (typeNode.inner)    return { ...typeNode, inner: substituteTypeAnnot(typeNode.inner, parsedArgs) };
  if (typeNode.elemType) return { ...typeNode, elemType: substituteTypeAnnot(typeNode.elemType, parsedArgs) };
  return typeNode;
}

function substituteExpr(expr, parsedArgs, gensymMap, id) {
  if (!expr) return expr;
  switch (expr.kind) {
    case 'MacroVarExpr': {
      const bare = expr.name.slice(1);
      if (!gensymMap.has(bare)) gensymMap.set(bare, `__mg_${bare}_${id}`);
      return { kind: 'Identifier', name: gensymMap.get(bare), line: expr.line, start: expr.start, end: expr.end };
    }
    case 'MacroParamExpr': {
      const bare = expr.name.slice(1);
      const parsed = parsedArgs.get(bare);
      if (!parsed) return expr;
      if (parsed.kind === 'ident') return { kind: 'Identifier', name: parsed.name, line: expr.line, start: expr.start, end: expr.end };
      if (parsed.ast) return parsed.ast;
      if (parsed.block) return expr;
      return expr;
    }
    case 'MacroStringifyExpr': {
      const bare = expr.name.slice(1);
      const parsed = parsedArgs.get(bare);
      const text = parsed ? stringifyTokens(parsed.tokens) : expr.name;
      return { kind: 'StringLiteral', value: text, line: expr.line, start: expr.start, end: expr.end };
    }
    case 'Literal':
    case 'Identifier':
    case 'StringLiteral':
    case 'TypeRef':
      return expr;
    case 'BinaryExpr':
      return { ...expr, left: substituteExpr(expr.left, parsedArgs, gensymMap, id), right: substituteExpr(expr.right, parsedArgs, gensymMap, id) };
    case 'UnaryExpr':
      return { ...expr, operand: substituteExpr(expr.operand, parsedArgs, gensymMap, id) };
    case 'CallExpr':
      return { ...expr, callee: substituteExpr(expr.callee, parsedArgs, gensymMap, id), args: expr.args.map(a => substituteExpr(a, parsedArgs, gensymMap, id)) };
    case 'BracketAccessExpr':
      return { ...expr, base: substituteExpr(expr.base, parsedArgs, gensymMap, id), index: substituteExpr(expr.index, parsedArgs, gensymMap, id) };
    case 'MemberExpr':
      return { ...expr, obj: substituteExpr(expr.obj, parsedArgs, gensymMap, id) };
    case 'AsExpr':
      return { ...expr, expr: substituteExpr(expr.expr, parsedArgs, gensymMap, id), asType: substituteTypeAnnot(expr.asType, parsedArgs) };
    case 'QualifiedName':
      return { ...expr, args: expr.args ? expr.args.map(a => substituteExpr(a, parsedArgs, gensymMap, id)) : null };
    case 'ArrayLiteral':
      return { ...expr, elements: expr.elements.map(e => substituteExpr(e, parsedArgs, gensymMap, id)) };
    case 'PackLiteral':
      return { ...expr, elements: expr.elements.map(e => substituteExpr(e, parsedArgs, gensymMap, id)) };
    default:
      return expr;
  }
}

function substituteBlock(block, parsedArgs, gensymMap, id) {
  return { ...block, body: substituteStmts(block.body, parsedArgs, gensymMap, id) };
}

export function subArgTokens(tokens, parsedArgs, gensymMap, id) {
  const result = [];
  for (const tok of tokens) {
    if (tok.type === TT.MACRO_PARAM) {
      const bare = tok.value.slice(1);
      const parsed = parsedArgs.get(bare);
      if (parsed) result.push(...parsed.tokens.filter(t => t.type !== TT.EOF));
      else result.push(tok);
    } else if (tok.type === TT.MACRO_VAR) {
      const bare = tok.value.slice(1);
      if (!gensymMap.has(bare)) gensymMap.set(bare, `__mg_${bare}_${id}`);
      result.push({ ...tok, type: TT.IDENT, value: gensymMap.get(bare) });
    } else if (tok.type === TT.MACRO_STRINGIFY) {
      const bare = tok.value.slice(1);
      const parsed = parsedArgs.get(bare);
      const text = parsed ? stringifyTokens(parsed.tokens) : tok.value;
      result.push({ ...tok, type: TT.STRING_LIT, value: text });
    } else {
      result.push(tok);
    }
  }
  return result;
}

function substituteStmt(stmt, parsedArgs, gensymMap, id) {
  switch (stmt.kind) {
    case 'MacroSpliceStmt': {
      const bare = stmt.name.slice(1);
      const parsed = parsedArgs.get(bare);
      if (parsed?.kind === 'block' || parsed?.kind === 'any' && parsed.block) {
        return (parsed.block ?? parsed.block).body;
      }
      return [stmt];
    }
    case 'VarDecl': {
      const name = substituteName(stmt.name, parsedArgs, gensymMap, id);
      const typeAnnot = stmt.typeAnnot ? substituteTypeAnnot(stmt.typeAnnot, parsedArgs) : null;
      const value = stmt.value ? substituteExpr(stmt.value, parsedArgs, gensymMap, id) : null;
      return [{ ...stmt, name, typeAnnot, value }];
    }
    case 'ExprStmt':
      return [{ ...stmt, expr: substituteExpr(stmt.expr, parsedArgs, gensymMap, id) }];
    case 'ReturnStmt':
      return [{ ...stmt, value: stmt.value ? substituteExpr(stmt.value, parsedArgs, gensymMap, id) : null }];
    case 'AssignStmt': {
      const target = substituteExpr(stmt.target, parsedArgs, gensymMap, id);
      const value  = substituteExpr(stmt.value,  parsedArgs, gensymMap, id);
      return [{ ...stmt, target, value }];
    }
    case 'IfStmt': {
      const condition  = substituteExpr(stmt.condition, parsedArgs, gensymMap, id);
      const then       = substituteBlock(stmt.then,       parsedArgs, gensymMap, id);
      const elseBranch = stmt.elseBranch ? substituteBlock(stmt.elseBranch, parsedArgs, gensymMap, id) : null;
      return [{ ...stmt, condition, then, elseBranch }];
    }
    case 'WhileStmt': {
      const condition = substituteExpr(stmt.condition, parsedArgs, gensymMap, id);
      const body      = substituteBlock(stmt.body, parsedArgs, gensymMap, id);
      return [{ ...stmt, condition, body }];
    }
    case 'ScopeBlock':
      return [{ ...stmt, body: substituteStmts(stmt.body, parsedArgs, gensymMap, id) }];
    case 'FuncDecl':
      return [{ ...stmt, body: substituteBlock(stmt.body, parsedArgs, gensymMap, id) }];
    case 'DeferStmt':
      if (stmt.stmt) {
        if (stmt.stmt.kind === 'ScopeBlock') {
          const s = { ...stmt.stmt, body: substituteStmts(stmt.stmt.body, parsedArgs, gensymMap, id) };
          return [{ ...stmt, stmt: s }];
        } else {
          const s = { ...stmt.stmt,
            target: substituteExpr(stmt.stmt.target, parsedArgs, gensymMap, id),
            value:  substituteExpr(stmt.stmt.value,  parsedArgs, gensymMap, id),
          };
          return [{ ...stmt, stmt: s }];
        }
      }
      return [{ ...stmt, expr: substituteExpr(stmt.expr, parsedArgs, gensymMap, id) }];
    case 'MacroCallStmt': {
      const newArgs = stmt.args.map(arg => ({
        ...arg,
        tokens: subArgTokens(arg.tokens, parsedArgs, gensymMap, id),
      }));
      return [{ ...stmt, args: newArgs }];
    }
    case 'MacroDecl':
      return [stmt];
    case 'BreakStmt':
    default:
      return [stmt];
  }
}

export function substituteStmts(stmts, parsedArgs, gensymMap, id) {
  const result = [];
  for (const s of stmts) {
    result.push(...substituteStmt(s, parsedArgs, gensymMap, id));
  }
  return result;
}

// ── Pack element splitter ─────────────────────────────────────────────────────

export function splitPackElements(tokens) {
  const filtered = tokens.filter(t => t.type !== TT.EOF);
  const start = filtered[0]?.value === '[' ? 1 : 0;
  const end   = filtered[filtered.length - 1]?.value === ']' ? filtered.length - 1 : filtered.length;
  const inner = filtered.slice(start, end);
  if (!inner.length) return [];
  const elements = [];
  let current = [];
  let depth = 0;
  for (const t of inner) {
    if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
    else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
    if (depth === 0 && t.value === ',') {
      elements.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length) elements.push(current);
  return elements;
}

// ── Stringify helper ──────────────────────────────────────────────────────────

export function stringifyTokens(tokens) {
  return tokens
    .filter(t => t.type !== TT.EOF)
    .map(t => t.value)
    .join(' ')
    .trim();
}

// ── Fake token builder ────────────────────────────────────────────────────────

export function mkPunct(val) {
  return { type: TT.PUNCT, value: val, line: 0, col: 0, start: 0, end: 0 };
}
