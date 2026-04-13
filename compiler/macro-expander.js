// ─────────────────────────────────────────────────────────────────────────────
// macro-expander.js  — Hygienic macro expander
//
// Pipeline position: after parse(), before typecheck()
//   tokenize → parse → expand → typecheck → generate
//
// Public API:
//   expand(ast) → ast     (mutates AST in-place, removes MacroDecl nodes, expands MacroCallStmt nodes)
//
// v1 limitations:
//   - No recursive macros
//   - No variadics
//   - MacroCallExpr (macro call in value position) — architecture hook, v1 errors
//   - Macros defined at top-level or inside function bodies (local macros)
//
// Substitution rules (from spec):
//   @param (kind=expr)  → ( arg_tokens )  [wrapped in parens for safe precedence]
//   @param (kind=ident) → arg_tokens      [raw — for l-value / declaration target]
//   @param (kind=block) → arg_tokens      [raw block including { }]
//   @param (kind=type)  → arg_tokens      [raw type expression]
//   @param (kind=any)   → arg_tokens      [raw — caller decides]
//   $name               → __mg_name_N    [gensym, N = expansion counter]
//   #param              → STRING_LIT      [stringify: source text of arg tokens]
// ─────────────────────────────────────────────────────────────────────────────

import { Parser }             from './parser.js';
import { TT, tokenize }       from './lexer.js';
import { stmtsToSourceMapped } from './ast-to-source.js';
import { SourceBuffer }        from './source-buffer.js';

// ── Public error class ────────────────────────────────────────────────────────

export class MacroError extends Error {
  constructor(msg, line) {
    super(`[Macro] Line ${line ?? '?'}: ${msg}`);
    this.line = line ?? null;
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Expand all macros in the AST (in-place).
 * MacroDecl nodes are removed from ast.body (consumed by the expander).
 * MacroCallStmt nodes are replaced with their expanded statements.
 *
 * Returns an expansion log: Map<callStart, { name, end, expandedSource }>
 * usable by buildHoverData for expand-on-hover tooltips.
 */
export function expand(ast, opts = {}) {
  const ctx   = { counter: 0, log: new Map(), fileId: opts.fileId ?? 'main', source: opts.source ?? null };
  const macros = new Map();

  // Collect top-level macros first (single-pass definition order)
  for (const d of ast.body) {
    if (d.kind === 'MacroDecl') macros.set(d.name, d);
  }

  ast.body = expandDeclList(ast.body, macros, ctx);
  return ctx.log;
}

// ── Declaration-level walk ────────────────────────────────────────────────────

function expandDeclList(decls, macros, ctx) {
  const result = [];
  for (const d of decls) {
    if (d.kind === 'MacroDecl') {
      result.push(d);  // kept in ast.body for IDE display (hover, macro panel)
      continue;
    }
    if (d.kind === 'FuncDecl') {
      expandFuncBody(d, macros, ctx);
      result.push(d);
    } else if (d.kind === 'VarDecl') {
      d.value = expandExpr(d.value, macros, ctx);
      result.push(d);
    } else {
      result.push(d);
    }
  }
  return result;
}

function expandFuncBody(decl, macros, ctx) {
  // Local macros defined inside this function are scoped to it
  const localMacros = new Map(macros);
  const stmts = decl.body.body;
  for (const s of stmts) {
    if (s.kind === 'MacroDecl') localMacros.set(s.name, s);
  }
  decl.body.body = expandStmtList(stmts, localMacros, ctx);
}

// ── Statement-level walk ──────────────────────────────────────────────────────

function expandStmtList(stmts, macros, ctx) {
  const result = [];
  for (const s of stmts) {
    if (s.kind === 'MacroDecl') {
      macros.set(s.name, s);
      result.push(s);
      continue;
    }
    if (s.kind === 'MacroCallStmt') {
      result.push(expandMacroCallStmt(s, macros, ctx));  // single MacroExpansionNode
    } else {
      result.push(expandStmt(s, macros, ctx));
    }
  }
  return result;
}

function expandStmt(stmt, macros, ctx) {
  switch (stmt.kind) {
    case 'VarDecl':
      stmt.value = expandExpr(stmt.value, macros, ctx);
      break;
    case 'ReturnStmt':
      stmt.value = expandExpr(stmt.value, macros, ctx);
      break;
    case 'ExprStmt':
      stmt.expr = expandExpr(stmt.expr, macros, ctx);
      break;
    case 'AssignStmt':
      stmt.target = expandExpr(stmt.target, macros, ctx);
      stmt.value  = expandExpr(stmt.value,  macros, ctx);
      break;
    case 'IfStmt':
      stmt.condition      = expandExpr(stmt.condition, macros, ctx);
      stmt.then.body      = expandStmtList(stmt.then.body, macros, ctx);
      if (stmt.elseBranch)
        stmt.elseBranch.body = expandStmtList(stmt.elseBranch.body, macros, ctx);
      break;
    case 'WhileStmt':
      stmt.condition  = expandExpr(stmt.condition, macros, ctx);
      stmt.body.body  = expandStmtList(stmt.body.body, macros, ctx);
      break;
    case 'ScopeBlock':
      stmt.body = expandStmtList(stmt.body, macros, ctx);
      break;
    case 'DeferStmt':
      if (stmt.stmt) {
        if (stmt.stmt.kind === 'ScopeBlock') {
          stmt.stmt.body = expandStmtList(stmt.stmt.body, macros, ctx);
        } else {
          stmt.stmt.target = expandExpr(stmt.stmt.target, macros, ctx);
          stmt.stmt.value  = expandExpr(stmt.stmt.value,  macros, ctx);
        }
      } else {
        stmt.expr = expandExpr(stmt.expr, macros, ctx);
      }
      break;
    case 'FuncDecl':
      expandFuncBody(stmt, macros, ctx);
      break;
    // BreakStmt, no sub-nodes
  }
  return stmt;
}

function expandExpr(expr, macros, ctx) {
  if (!expr) return expr;
  switch (expr.kind) {
    case 'MacroCallExpr':
      // Architecture hook for v1 — macro calls in value position not yet supported
      // furtka: future MacroCallExpr expansion would return last-expr value of block
      throw new MacroError(
        `Macro call '${expr.name}!(...)' in expression position is not supported in v1.\n` +
        `Use it as a statement, or restructure to assign via ident-kind macro param.`,
        expr.line,
      );
    case 'CallExpr':
      expr.args = expr.args.map(a => expandExpr(a, macros, ctx));
      if (expr.callee) expr.callee = expandExpr(expr.callee, macros, ctx);
      break;
    case 'BinaryExpr':
      expr.left  = expandExpr(expr.left,  macros, ctx);
      expr.right = expandExpr(expr.right, macros, ctx);
      break;
    case 'UnaryExpr':
      expr.operand = expandExpr(expr.operand, macros, ctx);
      break;
    case 'BracketAccessExpr':
      expr.base  = expandExpr(expr.base,  macros, ctx);
      expr.index = expandExpr(expr.index, macros, ctx);
      break;
    case 'MemberExpr':
      expr.obj = expandExpr(expr.obj, macros, ctx);
      break;
    case 'AsExpr':
      expr.expr = expandExpr(expr.expr, macros, ctx);
      break;
    case 'QualifiedName':
      if (expr.args) expr.args = expr.args.map(a => expandExpr(a, macros, ctx));
      break;
    // Leaf nodes — Literal, Identifier, StringLiteral, ArrayLiteral, TypeRef, PackLiteral
    case 'ArrayLiteral':
      expr.elements = expr.elements.map(e => expandExpr(e, macros, ctx));
      break;
    case 'PackLiteral':
      expr.elements = expr.elements.map(e => expandExpr(e, macros, ctx));
      break;
  }
  return expr;
}

// ── Core expansion ────────────────────────────────────────────────────────────

function expandMacroCallStmt(stmt, macros, ctx) {
  const macro = macros.get(stmt.name);
  if (!macro) throw new MacroError(`Undefined macro '${stmt.name}'`, stmt.line);

  if (stmt.args.length !== macro.params.length) {
    throw new MacroError(
      `Macro '${stmt.name}' expects ${macro.params.length} arg(s), got ${stmt.args.length}`,
      stmt.line,
    );
  }

  const id = ctx.counter++;

  // Kind-check
  for (let i = 0; i < stmt.args.length; i++) {
    kindCheck(stmt.args[i], macro.params[i], stmt.name);
  }

  const bodyTokens = macro.body.tokens ?? macro.bodyTokens;

  // Build gensym table: scan bodyTokens for all $name occurrences
  const gensyms = new Map();
  for (const tok of bodyTokens) {
    if (tok.type === TT.MACRO_VAR) {
      const bare = tok.value.slice(1);  // strip $
      if (!gensyms.has(bare)) gensyms.set(bare, `__mg_${bare}_${id}`);
    }
  }

  // Substitute tokens
  const substituted = substituteTokens(bodyTokens, macro.params, stmt.args, gensyms);

  // Re-parse the substituted block: bodyTokens includes outer { }
  const eofTok = { type: TT.EOF, value: '', line: 0, col: 0, start: 0, end: 0 };
  const parser  = new Parser([...substituted, eofTok]);
  const block   = parser.parseBlock();

  // Build SourceBuffer from the substituted (pre-expansion) body text.
  // This MUST happen before expandStmtList so that nested macro calls
  // receive the correct parent source for canonical ref chains.
  const { text: bodyText, nodeSpans } = stmtsToSourceMapped(block.body);
  const sourceId  = `macro:${stmt.name}:${ctx.fileId}:${stmt.start}`;
  const expSource = SourceBuffer.forMacro(
    sourceId, bodyText,
    { source: ctx.source, sourceId: ctx.fileId, start: stmt.src_start ?? stmt.start, end: stmt.src_end ?? stmt.end },
  );

  // Annotate the pre-expansion nodes with their expSource position.
  // Nodes that survive expansion unchanged carry these annotations.
  // MacroCallStmt nodes get annotated then discarded; their replacements
  // (MacroExpansionNode and body) are annotated by the inner expansion.
  for (const [n, span] of nodeSpans) {
    n.__src      = expSource;
    n.src_start  = span.start;
    n.src_end    = span.end;
  }

  // Recursively expand nested macro calls.
  // innerCtx carries expSource so nested expansions build the correct chain.
  const innerCtx     = { ...ctx, source: expSource, fileId: sourceId };
  // Snapshot: pre-expansion body for IDE display (nested MacroCallStmt still intact).
  const preExpBody   = [...block.body];
  const expandedBody = expandStmtList(block.body, macros, innerCtx);

  const innerTokens  = substituted.slice(1, substituted.length - 1);  // skip outer { }
  const macroSig     = macro.params.map(p => `${p.name}: ${p.paramKind}`).join(', ');

  const expansionNode = {
    kind:           'MacroExpansionNode',
    macroName:      stmt.name,
    expandedSource: stringifyTokens(innerTokens),
    body:           expandedBody,
    line:           stmt.line,
    start:          stmt.start,
    end:            stmt.end,
  };

  ctx.log.set(sourceId, {
    name:           stmt.name,
    end:            stmt.end,
    callLine:       stmt.line,
    callStart:      stmt.start,
    macroSig,
    bodySource:     bodyText,
    expandedSource: stringifyTokens(innerTokens),
    expandedBody,    // AST nodes of the expanded body (for SourceView rendering)
    preExpBody,      // pre-expansion body snapshot (MacroCallStmt nodes intact, for IDE panels)
    expansionNode,   // the MacroExpansionNode itself (for AST cross-selection)
    source:         expSource,   // replaces virtualFile
    // Per-argument info: token range in ORIGINAL source (for hover hints)
    args: stmt.args.map((arg, i) => {
      const toks = arg.tokens.filter(t => t.type !== TT.EOF);
      return {
        paramName: macro.params[i].name,
        paramKind: macro.params[i].paramKind,
        start: toks[0]?.start ?? stmt.start,
        end:   toks[toks.length - 1]?.end ?? stmt.end,
      };
    }),
  });

  return expansionNode;
}

// ── Kind checking ─────────────────────────────────────────────────────────────

function kindCheck(arg, param, macroName) {
  const { paramKind: kind, name, line } = param;
  if (kind === 'any') return;
  if (kind === 'pack' || kind.startsWith('pack<')) return;  // pack validated lazily via #expand

  if (kind === 'block' && arg.kind !== 'block') {
    throw new MacroError(
      `'${macroName}': parameter '${name}' expects kind 'block', got non-block argument`,
      line,
    );
  }
  if (kind !== 'block' && arg.kind === 'block') {
    throw new MacroError(
      `'${macroName}': parameter '${name}' expects kind '${kind}', got 'block' argument`,
      line,
    );
  }
  if (kind === 'ident') {
    const toks = arg.tokens.filter(t => t.type !== TT.EOF);
    if (toks.length !== 1 || toks[0].type !== TT.IDENT) {
      throw new MacroError(
        `'${macroName}': parameter '${name}' (kind=ident) requires a bare identifier, ` +
        `got: '${toks.map(t => t.value).join(' ')}'`,
        line,
      );
    }
  }
  // 'expr', 'type': raw token validation deferred to re-parse
}

// ── Token substitution ────────────────────────────────────────────────────────

function substituteTokens(bodyTokens, params, args, gensyms) {
  const paramMap = new Map(params.map((p, i) => [p.name, { param: p, arg: args[i] }]));
  const result   = [];

  for (let i = 0; i < bodyTokens.length; i++) {
    const tok = bodyTokens[i];
    if (tok.type === TT.MACRO_PARAM) {
      const bare    = tok.value.slice(1);  // strip @
      const binding = paramMap.get(bare);
      if (!binding) throw new MacroError(`Unknown macro parameter '@${bare}'`, tok.line);

      const { param, arg } = binding;
      if (param.paramKind === 'expr') {
        // Wrap in parens for safe operator precedence
        result.push(mkPunct('('));
        result.push(...arg.tokens);
        result.push(mkPunct(')'));
      } else {
        result.push(...arg.tokens);
        // block arg self-terminates with '}' — eat a stray ';' from the template if present
        if (param.paramKind === 'block') {
          const next = bodyTokens[i + 1];
          if (next && next.type === TT.OP && next.value === ';') i++;
        }
      }

    } else if (tok.type === TT.MACRO_VAR) {
      const bare = tok.value.slice(1);  // strip $
      const name = gensyms.get(bare) ?? `__mg_${bare}_0`;
      result.push(mkIdent(name, tok));

    } else if (tok.type === TT.MACRO_STRINGIFY && tok.value === '#expand') {
      // Pattern: #expand IDENT(val) IDENT('in') MACRO_PARAM(@param) { body }
      // Unrolls the body once per element of the pack argument.
      const valNameTok = bodyTokens[++i];  // IDENT: the loop variable name
      const inTok      = bodyTokens[++i];  // IDENT: 'in' keyword
      const paramTok   = bodyTokens[++i];  // MACRO_PARAM: @param
      if (!valNameTok || valNameTok.type !== TT.IDENT)
        throw new MacroError(`#expand: expected loop variable name`, tok.line);
      if (!inTok || inTok.type !== TT.IDENT || inTok.value !== 'in')
        throw new MacroError(`#expand: expected 'in' after loop variable`, tok.line);
      if (!paramTok || paramTok.type !== TT.MACRO_PARAM)
        throw new MacroError(`#expand: expected @param after 'in'`, tok.line);
      // Collect body block: { ... }
      if (bodyTokens[i + 1]?.type !== TT.PUNCT || bodyTokens[i + 1]?.value !== '{')
        throw new MacroError(`#expand: expected '{' after @${paramTok.value.slice(1)}`, tok.line);
      i++;  // consume '{'
      const bodyStart = i + 1;
      let depth = 1;
      while (depth > 0 && i + 1 < bodyTokens.length) {
        i++;
        const bt = bodyTokens[i];
        if (bt.type === TT.PUNCT && bt.value === '{') depth++;
        else if (bt.type === TT.PUNCT && bt.value === '}') depth--;
      }
      const bodyEnd = i;  // index of closing '}'
      const innerBody = bodyTokens.slice(bodyStart, bodyEnd);
      // Get pack arg tokens and split into elements
      const bare    = paramTok.value.slice(1);
      const binding = paramMap.get(bare);
      if (!binding) throw new MacroError(`#expand: unknown parameter '@${bare}'`, tok.line);
      const packElements = splitPackElements(binding.arg.tokens);
      const valName = valNameTok.value;
      // Unroll: for each element, substitute val identifier then run full token substitution
      for (const elemTokens of packElements) {
        // First pass: substitute the loop variable (val) with the pack element tokens
        const withVal = [];
        for (const bt of innerBody) {
          if (bt.type === TT.IDENT && bt.value === valName) {
            withVal.push(mkPunct('('));
            withVal.push(...elemTokens);
            withVal.push(mkPunct(')'));
          } else {
            withVal.push(bt);
          }
        }
        // Second pass: run full substituteTokens to replace @params, $gensyms, #stringify
        result.push(...substituteTokens(withVal, params, args, gensyms));
      }

    } else if (tok.type === TT.MACRO_STRINGIFY) {
      const bare    = tok.value.slice(1);  // strip #
      const binding = paramMap.get(bare);
      if (!binding) throw new MacroError(`Unknown macro parameter '#${bare}'`, tok.line);
      const text = stringifyTokens(binding.arg.tokens);
      result.push(mkStringLit(text, tok));

    } else {
      result.push(tok);
    }
  }

  return result;
}

// ── Pack element splitter ─────────────────────────────────────────────────────

/**
 * Given the raw token list for a pack arg (e.g. `[ 1 , true , "hi" ]`),
 * split into individual element token lists.
 * Handles nested brackets/parens at any depth.
 * The outer `[` and `]` are stripped; elements are separated by `,` at depth 0.
 */
function splitPackElements(tokens) {
  const filtered = tokens.filter(t => t.type !== TT.EOF);
  // Strip outer [ ]
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

function stringifyTokens(tokens) {
  // Reconstruct readable source text from token values (single-line, spaces only)
  // Used for #param stringify and expandedSource (token-level, pre-parse)
  return tokens
    .filter(t => t.type !== TT.EOF)
    .map(t => t.value)
    .join(' ')
    .trim();
}

// ── Fake token builders ───────────────────────────────────────────────────────

function mkIdent(name, srcTok) {
  return { type: TT.IDENT, value: name,
    line: srcTok?.line ?? 0, col: srcTok?.col ?? 0,
    start: srcTok?.start ?? 0, end: srcTok?.end ?? 0 };
}

function mkPunct(val) {
  return { type: TT.PUNCT, value: val, line: 0, col: 0, start: 0, end: 0 };
}

function mkStringLit(text, srcTok) {
  return { type: TT.STRING_LIT, value: text,
    line: srcTok?.line ?? 0, col: srcTok?.col ?? 0,
    start: srcTok?.start ?? 0, end: srcTok?.end ?? 0 };
}
