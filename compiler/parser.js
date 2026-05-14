// ─────────────────────────────────────────────────────────────────────────────
// parser.js — QLang Recursive Descent Parser — LL(2)
//
// Three-tier class hierarchy:
//   ParserBase  (parser-base.js)  — token stream helpers
//   ParserExprs (parser-exprs.js) — type annotations + expression parsing
//   Parser      (this file)       — declarations, statements, struct decls
//
// Grammar additions:
//   structDecl ::= IDENT ':=' 'struct' '{' (field ';')* '}' ';'
//   field      ::= IDENT ':' ['mut'] type ['=' expr]
//
// AST nodes produced here:
//   Program, VarDecl, FuncDecl, MacroDecl, MacroBody, MacroParam
//   Block, ReturnStmt, BreakStmt, DeferStmt, IfStmt, WhileStmt
//   ScopeBlock, ExprStmt, AssignStmt, MacroCallStmt
//   StructDecl { name, fields: StructField[], line, start, end }
//   StructField{ name, typeAnnot, defaultValue, mut, line, start, end }
//   NamespaceDecl   { name, target: string[]|null, line, start, end }
//   NamespaceImport  { alias: string, filename: string, line, start, end }
//   NamespacedDecl   { segments: string[], inner: FuncDecl|VarDecl, line, start, end }
//
// All expression/type AST nodes are in parser-exprs.js.
// ─────────────────────────────────────────────────────────────────────────────

import { TT }                           from './lexer.js';
import { ParserExprs }                  from './parser-exprs.js';
import { node, errorNode, ParseError }  from './parser-base.js';

// Re-export for backwards compatibility — all callers import from parser.js
export { ParseError };

export class Parser extends ParserExprs {

  // ── top-level ──────────────────────────────────────────────────────────────

  parseProgram() {
    const decls  = [];
    while (!this.check(TT.EOF)) {
      try {
        decls.push(this.parseDecl());
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.errors.push(e);
        decls.push(errorNode(e));
        this.scanToTopLevelSyncPoint();
      }
    }
    return node('Program', { body: decls, errors: this.errors });
  }

  // Advance until we find the start of a new top-level declaration
  // (IDENT followed by ':=' or ':' at brace depth 0) or EOF.
  scanToTopLevelSyncPoint() {
    let braceDepth = 0;
    while (!this.check(TT.EOF)) {
      const t = this.cur();
      if (t.type === TT.PUNCT && t.value === '{') { braceDepth++; this.pos++; continue; }
      if (t.type === TT.PUNCT && t.value === '}') {
        if (braceDepth === 0) break;
        braceDepth--; this.pos++; continue;
      }
      if (braceDepth === 0 && t.type === TT.IDENT) {
        const next = this.peek();
        if (next && next.type === TT.OP && (next.value === ':=' || next.value === ':' || next.value === '::')) {
          break;
        }
      }
      this.pos++;
    }
  }

  // ── declaration ───────────────────────────────────────────────────────────

  parseDecl() {
    // bare file import: import "file.qlang";  →  NamespaceImport { alias: null, filename }
    if (this.check(TT.KEYWORD, 'import')) {
      return this._parseBareImportDecl();
    }

    const name = this.eat(TT.IDENT);

    // ── namespaced declaration: A::B::C := fn/var ────────────────────────
    if (this.check(TT.OP, '::')) {
      return this.parseNamespacedDecl(name);
    }

    if (this.check(TT.OP, ':=')) {
      this.eat(TT.OP, ':=');

      // 'namespace' → namespace declaration
      if (this.check(TT.KEYWORD, 'namespace')) {
        return this.parseNamespaceDeclBody(name);
      }

      // 'import' → aliased file import: m := import "file.qlang";
      if (this.check(TT.KEYWORD, 'import')) {
        return this._parseAliasedImportDecl(name);
      }

      // 'fn' → function declaration
      if (this.check(TT.KEYWORD, 'fn')) {
        this.eat(TT.KEYWORD, 'fn');
        return this.parseFuncDeclBody(name);
      }

      // 'macro' → macro declaration
      if (this.check(TT.KEYWORD, 'macro')) {
        return this.parseMacroDeclBody(name);
      }

      // 'struct' → struct declaration
      if (this.check(TT.KEYWORD, 'struct')) {
        return this.parseStructDeclBody(name);
      }

      // Otherwise → var decl with inferred type
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      return node('VarDecl', { name: name.value, typeAnnot: null, value, line: name.line, start: name.start, end: semi.end });
    }

    if (this.check(TT.OP, ':')) {
      this.eat(TT.OP, ':');
      const typeAnnot = this.parseType();
      this.eat(TT.OP, '=');
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      return node('VarDecl', { name: name.value, typeAnnot, value, line: name.line, start: name.start, end: semi.end });
    }

    this.error(`Expected ':=' or ':' after identifier '${name.value}'`);
  }

  // ── file import declarations ───────────────────────────────────────────────
  // import "file.qlang";            →  NamespaceImport { alias: null, filename }
  // m := import "file.qlang";       →  NamespaceImport { alias: 'm', filename }

  _parseBareImportDecl() {
    const kw      = this.eat(TT.KEYWORD, 'import');
    const fileTok = this.eat(TT.STRING_LIT);
    const semi    = this.eat(TT.OP, ';');
    return node('NamespaceImport', {
      alias: null, filename: fileTok.value,
      line: kw.line, start: kw.start, end: semi.end,
    });
  }

  _parseAliasedImportDecl(nameTok) {
    this.eat(TT.KEYWORD, 'import');
    const fileTok = this.eat(TT.STRING_LIT);
    const semi    = this.eat(TT.OP, ';');
    return node('NamespaceImport', {
      alias: nameTok.value, filename: fileTok.value,
      line: nameTok.line, start: nameTok.start, end: semi.end,
    });
  }

  // ── function declaration ───────────────────────────────────────────────────

  parseFuncDeclBody(nameTok) {
    this.eat(TT.PUNCT, '(');
    const params = this.parseParamList();
    this.eat(TT.PUNCT, ')');
    const returnType = this.parseType();
    const body = this.parseBlock();
    const semi = this.tryEat(TT.OP, ';');
    return node('FuncDecl', {
      name: nameTok.value,
      returnType,
      params,
      body,
      line:  nameTok.line,
      start: nameTok.start,
      end:   semi ? semi.end : body.end,
    });
  }

  // ── macro declaration ──────────────────────────────────────────────────────

  parseMacroDeclBody(nameTok) {
    const macroKw = this.eat(TT.KEYWORD, 'macro');
    this.eat(TT.PUNCT, '(');
    const params = this.parseMacroParamList();
    this.eat(TT.PUNCT, ')');
    const bodyTokens = this.collectMacroBody();
    const body = { kind: 'MacroBody', tokens: bodyTokens };
    const semi = this.tryEat(TT.OP, ';');
    return node('MacroDecl', {
      name: nameTok.value,
      params,
      body,
      bodyTokens,
      line:  nameTok.line,
      start: nameTok.start,
      end:   semi ? semi.end : (bodyTokens.length ? bodyTokens[bodyTokens.length - 1].end : macroKw.end),
    });
  }

  parseMacroParamList() {
    const params = [];
    if (this.check(TT.PUNCT, ')')) return params;
    const VALID_KINDS = new Set(['expr', 'ident', 'block', 'type', 'any', 'pack']);
    do {
      const pname = this.eat(TT.IDENT);
      this.eat(TT.OP, ':');
      const kindTok = this.eat(TT.IDENT);
      let kind = kindTok.value;
      if (kind === 'pack' && this.check(TT.OP, '<')) {
        this.eat(TT.OP, '<');
        const innerKind = this.eat(TT.IDENT);
        this.eat(TT.OP, '>');
        kind = `pack<${innerKind.value}>`;
      } else if (!VALID_KINDS.has(kind)) {
        throw new ParseError(
          `Unknown macro parameter kind '${kind}', expected: expr|ident|block|type|any|pack`,
          kindTok.line, kindTok.col, kindTok.start, kindTok.end,
        );
      }
      params.push(node('MacroParam', { name: pname.value, paramKind: kind, line: pname.line, start: pname.start, end: kindTok.end }));
    } while (this.tryEat(TT.OP, ','));
    return params;
  }

  collectMacroBody() {
    const open  = this.eat(TT.PUNCT, '{');
    const result = [open];
    let depth = 1;
    while (depth > 0 && !this.check(TT.EOF)) {
      const t = this.cur();
      result.push(t);
      this.pos++;
      if (t.type === TT.PUNCT && t.value === '{') depth++;
      else if (t.type === TT.PUNCT && t.value === '}') depth--;
    }
    return result; // includes both braces
  }

  // ── struct declaration ─────────────────────────────────────────────────────
  // structDecl ::= IDENT ':=' 'struct' '{' (field (';'|','))* '}' ';'
  // field      ::= IDENT ':' ['mut'] type ['=' expr]
  //
  // StructDecl: { kind:'StructDecl', name, fields: StructField[], line, start, end }
  // StructField:{ kind:'StructField', name, typeAnnot, defaultValue(null|expr), mut, line, start, end }

  parseStructDeclBody(nameTok) {
    const kw    = this.eat(TT.KEYWORD, 'struct');
    const open  = this.eat(TT.PUNCT, '{');
    const fields = [];
    while (!this.check(TT.PUNCT, '}') && !this.check(TT.EOF)) {
      fields.push(this.parseStructField());
      // allow trailing ; or , as separator
      this.tryEat(TT.OP, ';') || this.tryEat(TT.OP, ',');
    }
    const close = this.eat(TT.PUNCT, '}');
    const semi  = this.tryEat(TT.OP, ';');
    return node('StructDecl', {
      name:   nameTok.value,
      fields,
      line:   nameTok.line,
      start:  nameTok.start,
      end:    semi ? semi.end : close.end,
    });
  }

  parseStructField() {
    const fieldName = this.eat(TT.IDENT);
    this.eat(TT.OP, ':');
    const typeAnnot = this.parseType();
    let defaultValue = null;
    if (this.check(TT.OP, '=')) {
      this.pos++;
      defaultValue = this.parseExpr();
    }
    return node('StructField', {
      name:         fieldName.value,
      typeAnnot,
      defaultValue,
      mut:          typeAnnot.mut ?? false,
      line:         fieldName.line,
      start:        fieldName.start,
      end:          defaultValue ? defaultValue.end : typeAnnot.end,
    });
  }

  // ── namespace declaration ──────────────────────────────────────────────────
  // name := namespace;                       → empty namespace
  // name := namespace Target::Chain;         → alias

  parseNamespaceDeclBody(nameTok) {
    this.eat(TT.KEYWORD, 'namespace');
    let target = null;
    if (this.check(TT.IDENT)) {
      target = [this.eat(TT.IDENT).value];
      while (this.check(TT.OP, '::')) {
        this.eat(TT.OP, '::');
        target.push(this.eat(TT.IDENT).value);
      }
    }
    const semi = this.eat(TT.OP, ';');
    return node('NamespaceDecl', {
      name: nameTok.value, target,
      line: nameTok.line, start: nameTok.start, end: semi.end,
    });
  }

  // ── namespaced declaration ─────────────────────────────────────────────────
  // A::B::C := fn(...)  → NamespacedDecl { segments: ['A','B','C'], inner: FuncDecl }
  // A::B := expr;       → NamespacedDecl { segments: ['A','B'], inner: VarDecl }
  // A::B : type = expr; → NamespacedDecl { segments: ['A','B'], inner: VarDecl }

  parseNamespacedDecl(firstTok) {
    const segments = [firstTok.value];
    let lastTok = firstTok;
    while (this.check(TT.OP, '::')) {
      this.eat(TT.OP, '::');
      lastTok = this.eat(TT.IDENT);
      segments.push(lastTok.value);
    }

    let inner;
    if (this.check(TT.OP, ':=')) {
      this.eat(TT.OP, ':=');
      if (this.check(TT.KEYWORD, 'fn')) {
        this.eat(TT.KEYWORD, 'fn');
        inner = this.parseFuncDeclBody(lastTok);
      } else {
        const value = this.parseExpr();
        const semi  = this.eat(TT.OP, ';');
        inner = node('VarDecl', {
          name: lastTok.value, typeAnnot: null, value,
          line: lastTok.line, start: lastTok.start, end: semi.end,
        });
      }
    } else if (this.check(TT.OP, ':')) {
      this.eat(TT.OP, ':');
      const typeAnnot = this.parseType();
      this.eat(TT.OP, '=');
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      inner = node('VarDecl', {
        name: lastTok.value, typeAnnot, value,
        line: lastTok.line, start: lastTok.start, end: semi.end,
      });
    } else {
      this.error(`Expected ':=' or ':' after '${segments.join('::')}'`);
    }

    return node('NamespacedDecl', {
      segments, inner,
      line: firstTok.line, start: firstTok.start, end: inner.end,
    });
  }

  // ── param list ─────────────────────────────────────────────────────────────

  parseParamList() {
    const params = [];
    if (this.check(TT.PUNCT, ')')) return params;
    do {
      const pname = this.eat(TT.IDENT);
      this.eat(TT.OP, ':');
      const ptype = this.parseType();
      params.push(node('Param', { name: pname.value, typeAnnot: ptype, line: pname.line, start: pname.start, end: ptype.end }));
    } while (this.tryEat(TT.OP, ','));
    return params;
  }

  // ── block ──────────────────────────────────────────────────────────────────

  parseBlock() {
    const open  = this.eat(TT.PUNCT, '{');
    const stmts = [];
    while (!this.check(TT.PUNCT, '}') && !this.check(TT.EOF)) {
      try {
        stmts.push(this.parseStmt());
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.errors.push(e);
        stmts.push(errorNode(e));
        this.scanToStatementSyncPoint();
      }
    }
    const close = this.eat(TT.PUNCT, '}');
    return node('Block', { body: stmts, line: open.line, start: open.start, end: close.end });
  }

  scanToStatementSyncPoint() {
    let depth = 0;
    while (!this.check(TT.EOF)) {
      const t = this.cur();
      if (t.type === TT.PUNCT && t.value === '{') { depth++; this.pos++; continue; }
      if (t.type === TT.PUNCT && t.value === '}') {
        if (depth === 0) break;
        depth--; this.pos++; continue;
      }
      if (depth === 0 && t.type === TT.OP && t.value === ';') {
        this.pos++;
        break;
      }
      this.pos++;
    }
  }

  // ── statement ──────────────────────────────────────────────────────────────

  parseStmt() {
    if (this.check(TT.KEYWORD, 'if'))    return this.parseIfStmt();
    if (this.check(TT.KEYWORD, 'while')) return this.parseWhileStmt();

    // break
    if (this.check(TT.KEYWORD, 'break')) {
      const kw   = this.eat(TT.KEYWORD, 'break');
      const semi = this.eat(TT.OP, ';');
      return node('BreakStmt', { line: kw.line, start: kw.start, end: semi.end });
    }

    // defer statement: defer { block }; or defer <expr>; or defer <target> = <value>;
    if (this.check(TT.KEYWORD, 'defer')) {
      const kw = this.eat(TT.KEYWORD, 'defer');
      // Block form: defer { stmts };
      if (this.check(TT.PUNCT, '{')) {
        const block = this.parseBlock();
        const semi  = this.eat(TT.OP, ';');
        const scopeBlock = node('ScopeBlock', { body: block.body, line: block.line, start: block.start, end: block.end });
        return node('DeferStmt', { expr: null, stmt: scopeBlock, line: kw.line, start: kw.start, end: semi.end });
      }
      const expr = this.parseExpr();
      if (this.check(TT.OP, '=')) {
        this.pos++;  // consume '='
        const value = this.parseExpr();
        const semi  = this.eat(TT.OP, ';');
        const stmt  = node('AssignStmt', { target: expr, value, line: kw.line, start: expr.start, end: semi.end });
        return node('DeferStmt', { expr: null, stmt, line: kw.line, start: kw.start, end: semi.end });
      }
      const semi = this.eat(TT.OP, ';');
      return node('DeferStmt', { expr, stmt: null, line: kw.line, start: kw.start, end: semi.end });
    }

    // return stmt
    if (this.check(TT.KEYWORD, 'return')) {
      const kw = this.eat(TT.KEYWORD, 'return');
      if (this.check(TT.OP, ';')) {
        const semi = this.eat(TT.OP, ';');
        return node('ReturnStmt', { value: null, line: kw.line, start: kw.start, end: semi.end });
      }
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      return node('ReturnStmt', { value, line: kw.line, start: kw.start, end: semi.end });
    }

    // Anonymous scope block: '{' stmts '}'
    if (this.check(TT.PUNCT, '{')) {
      const block = this.parseBlock();
      return node('ScopeBlock', { body: block.body, line: block.line, start: block.start, end: block.end });
    }

    // Local var decl: IDENT ':=' | IDENT ':' type '='
    if (this.check(TT.IDENT)) {
      const next = this.peek();
      if (next.type === TT.OP && (next.value === ':=' || next.value === ':')) {
        return this.parseLocalVarDecl();
      }
      if (next.type === TT.OP && next.value === '!') {
        return this.parseMacroCallStmt();
      }
    }

    // Expression statement or assignment
    const expr = this.parseExpr();
    if (this.check(TT.OP, '=')) {
      const eqTok = this.cur();
      this.pos++;
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      return node('AssignStmt', { target: expr, value, line: eqTok.line, start: expr.start, end: semi.end });
    }
    const semi = this.eat(TT.OP, ';');
    return node('ExprStmt', { expr, line: expr.line, start: expr.start, end: semi.end });
  }

  parseIfStmt() {
    const kw = this.eat(TT.KEYWORD, 'if');
    this.eat(TT.PUNCT, '(');
    const condition = this.parseExpr();
    this.eat(TT.PUNCT, ')');
    const then = this.parseBlock();
    let elseBranch = null;
    if (this.check(TT.KEYWORD, 'else')) {
      this.eat(TT.KEYWORD, 'else');
      if (this.check(TT.KEYWORD, 'if')) {
        const elseIf = this.parseIfStmt();
        elseBranch = node('Block', { body: [elseIf], line: elseIf.line, start: elseIf.start, end: elseIf.end });
      } else {
        elseBranch = this.parseBlock();
      }
    }
    const end = elseBranch ? elseBranch.end : then.end;
    return node('IfStmt', { condition, then, elseBranch, line: kw.line, start: kw.start, end });
  }

  parseWhileStmt() {
    const kw = this.eat(TT.KEYWORD, 'while');
    this.eat(TT.PUNCT, '(');
    const condition = this.parseExpr();
    this.eat(TT.PUNCT, ')');
    const body = this.parseBlock();
    return node('WhileStmt', { condition, body, line: kw.line, start: kw.start, end: body.end });
  }

  // ── macro call statement ───────────────────────────────────────────────────

  parseMacroCallStmt() {
    const nameT = this.eat(TT.IDENT);
    this.eat(TT.OP, '!');
    const { args } = this.parseMacroArgs();
    const semi = this.eat(TT.OP, ';');
    return node('MacroCallStmt', { name: nameT.value, args, line: nameT.line, start: nameT.start, end: semi.end });
  }

  parseMacroArgs() {
    const open = this.eat(TT.PUNCT, '(');
    const args = [];
    if (!this.check(TT.PUNCT, ')')) {
      do {
        const argTokens = [];
        if (this.check(TT.PUNCT, '{')) {
          let depth = 0;
          do {
            const t = this.cur(); this.pos++;
            argTokens.push(t);
            if (t.value === '{') depth++;
            else if (t.value === '}') depth--;
          } while (depth > 0 && !this.check(TT.EOF));
          // Parse block tokens into a proper Block AST node
          const eofTok  = { type: TT.EOF, value: '', line: 0, col: 0, start: 0, end: 0 };
          const subP    = new Parser([...argTokens, eofTok]);
          const blockAst = subP.parseBlock();
          args.push({ kind: 'block', tokens: argTokens, block: blockAst });
        } else {
          let depth = 0;
          let bDepth = 0;
          while (!this.check(TT.EOF)) {
            const t = this.cur();
            if (depth === 0 && bDepth === 0 && (t.value === ',' || t.value === ')')) break;
            argTokens.push(t); this.pos++;
            if (t.value === '(') depth++;
            else if (t.value === ')') depth--;
            else if (t.value === '[') bDepth++;
            else if (t.value === ']') bDepth--;
          }
          // Try to parse collected tokens as an expression AST node
          let expr = null;
          try {
            const eofTok = { type: TT.EOF, value: '', line: 0, col: 0, start: 0, end: 0 };
            const subP   = new Parser([...argTokens, eofTok]);
            expr = subP.parseExpr();
          } catch (_) { /* type args etc. — keep as raw tokens only */ }
          args.push({ kind: 'raw', tokens: argTokens, expr });
        }
      } while (this.tryEat(TT.OP, ','));
    }
    this.eat(TT.PUNCT, ')');
    return { args };
  }

  // ── local var decl (inside function bodies) ────────────────────────────────

  parseLocalVarDecl() {
    const name = this.eat(TT.IDENT);

    if (this.tryEat(TT.OP, ':=')) {
      if (this.check(TT.KEYWORD, 'fn')) {
        this.eat(TT.KEYWORD, 'fn');
        return this.parseFuncDeclBody(name);
      }
      if (this.check(TT.KEYWORD, 'macro')) {
        return this.parseMacroDeclBody(name);
      }
      const value = this.parseExpr();
      const semi  = this.eat(TT.OP, ';');
      return node('VarDecl', { name: name.value, typeAnnot: null, value, line: name.line, start: name.start, end: semi.end });
    }

    this.eat(TT.OP, ':');
    const typeAnnot = this.parseType();
    this.eat(TT.OP, '=');
    const value = this.parseExpr();
    const semi  = this.eat(TT.OP, ';');
    return node('VarDecl', { name: name.value, typeAnnot, value, line: name.line, start: name.start, end: semi.end });
  }
}

// ── public entry point ────────────────────────────────────────────────────────

export function parse(tokens) {
  return new Parser(tokens).parseProgram();
}
