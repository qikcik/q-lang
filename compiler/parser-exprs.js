// ─────────────────────────────────────────────────────────────────────────────
// parser-exprs.js — type-annotation and expression parsing tier
//
// Extends ParserBase with:
//   parseType()         — type annotations (mut, ptr<T>, array<T,N>, fn(...) R, UserTypeRef)
//   parseExpr()         — precedence climbing: ||, &&, cmp, +/-, *//, unary, postfix, primary
//   parseCallOrPrimary()
//   parsePrimary()
//   parseArgList()
//
// UserTypeRef: all IDENT tokens in type position produce UserTypeRef nodes.
//   treated as a reference to a user-defined type (e.g. a struct name).
//   Produces: { kind: 'UserTypeRef', name: string, mut, line, start, end }
//
// ─────────────────────────────────────────────────────────────────────────────

import { TT }                   from './lexer.js';
import { ParserBase, node, ParseError } from './parser-base.js';

export class ParserExprs extends ParserBase {

  // ── type ───────────────────────────────────────────────────────────────────
  // type ::= 'mut'? ( IDENT (UserTypeRef) | 'ptr' '<' type '>'
  //                 | 'array' '<' type ',' NUMBER '>'
  //                 | 'fn' '(' ((name ':')? type)* ')' type )

  parseType() {
    // Optional 'mut' qualifier
    let mut      = false;
    let mutStart = null;
    if (this.check(TT.KEYWORD, 'mut')) {
      mutStart = this.cur().start;
      mut      = true;
      this.pos++;
    }

    // Pointer type: ptr<innerType>
    if (this.check(TT.KEYWORD, 'ptr')) {
      const kw = this.eat(TT.KEYWORD, 'ptr');
      this.eat(TT.OP, '<');
      const inner = this.parseType();
      const close = this.eat(TT.OP, '>');
      return node('PtrType', { inner, mut, line: kw.line, start: mutStart ?? kw.start, end: close.end });
    }

    // Array type: array<elemType, size>
    if (this.check(TT.KEYWORD, 'array')) {
      const kw = this.eat(TT.KEYWORD, 'array');
      this.eat(TT.OP, '<');
      const elemType = this.parseType();
      this.eat(TT.OP, ',');
      const sizeTok = this.eat(TT.NUMBER);
      const size    = parseInt(sizeTok.value, 10);
      if (!Number.isInteger(size) || size <= 0) {
        throw new ParseError(`Array size must be a positive integer, got '${sizeTok.value}'`, sizeTok.line, sizeTok.col, sizeTok.start, sizeTok.end);
      }
      const close = this.eat(TT.OP, '>');
      return node('ArrayType', { elemType, size, mut, line: kw.line, start: mutStart ?? kw.start, end: close.end });
    }

    // Function type: fn(paramTypes...) RetType
    if (this.check(TT.KEYWORD, 'fn')) {
      const kw = this.eat(TT.KEYWORD, 'fn');
      this.eat(TT.PUNCT, '(');
      const paramTypes = [];
      if (!this.check(TT.PUNCT, ')')) {
        do {
          // Optional param name: 'name :' prefix — name is not part of the type
          if (this.check(TT.IDENT) && this.peek().type === TT.OP && this.peek().value === ':') {
            this.eat(TT.IDENT);
            this.eat(TT.OP, ':');
          }
          paramTypes.push(this.parseType());
        } while (this.tryEat(TT.OP, ','));
      }
      this.eat(TT.PUNCT, ')');
      const returnType = this.parseType();
      const end = returnType.end;
      return node('FuncType', { returnType, paramTypes, mut, line: kw.line, start: mutStart ?? kw.start, end });
    }

    // void return type
    if (this.check(TT.KEYWORD, 'void')) {
      const kw = this.eat(TT.KEYWORD, 'void');
      if (mut) throw new ParseError(`'mut' is not valid before 'void'`, kw.line, kw.col, kw.start, kw.end);
      return node('Type', { name: 'void', mut: false, line: kw.line, start: mutStart ?? kw.start, end: kw.end });
    }

    // Type reference: IDENT in type position — covers both scalar types (i32, f64, bool…)
    // and user-defined types (struct names). All resolved by the type-checker.
    // Also handles qualified type refs: m::Vec2 → QualifiedTypeRef { segments: ['m','Vec2'] }
    if (this.check(TT.IDENT)) {
      const ident = this.eat(TT.IDENT);
      // Optional '::' chain: m::Vec2 or m::ns::T
      if (this.check(TT.OP, '::')) {
        const segments = [ident.value];
        let end = ident.end;
        while (this.check(TT.OP, '::')) {
          this.pos++;
          const seg = this.eat(TT.IDENT);
          segments.push(seg.value);
          end = seg.end;
        }
        return node('QualifiedTypeRef', { segments, mut, line: ident.line, start: mutStart ?? ident.start, end });
      }
      return node('UserTypeRef', { name: ident.value, mut, line: ident.line, start: mutStart ?? ident.start, end: ident.end });
    }

    this.error('Expected type');
  }

  // ── expressions (precedence climbing) ─────────────────────────────────────

  parseExpr() { return this.parseOrExpr(); }

  parseOrExpr() {
    let left = this.parseAndExpr();
    while (this.check(TT.OP, '||')) {
      const op = this.cur();
      this.pos++;
      const right = this.parseAndExpr();
      left = node('BinaryExpr', { op: '||', left, right, line: op.line, start: left.start, end: right.end });
    }
    return left;
  }

  parseAndExpr() {
    let left = this.parseCmpExpr();
    while (this.check(TT.OP, '&&')) {
      const op = this.cur();
      this.pos++;
      const right = this.parseCmpExpr();
      left = node('BinaryExpr', { op: '&&', left, right, line: op.line, start: left.start, end: right.end });
    }
    return left;
  }

  parseCmpExpr() {
    let left = this.parseAddExpr();
    const CMP = ['==', '!=', '<', '>', '<=', '>='];
    if (CMP.includes(this.cur().value) && this.cur().type === TT.OP) {
      const op    = this.cur();
      this.pos++;
      const right = this.parseAddExpr();
      left = node('BinaryExpr', { op: op.value, left, right, line: op.line, start: left.start, end: right.end });
    }
    return left;
  }

  parseAddExpr() {
    let left = this.parseMulExpr();
    while (this.check(TT.OP, '+') || this.check(TT.OP, '-')) {
      const op    = this.cur();
      this.pos++;
      const right = this.parseMulExpr();
      left = node('BinaryExpr', { op: op.value, left, right, line: op.line, start: left.start, end: right.end });
    }
    return left;
  }

  parseMulExpr() {
    let left = this.parseUnaryExpr();
    while (this.check(TT.OP, '*') || this.check(TT.OP, '/')) {
      const op    = this.cur();
      this.pos++;
      const right = this.parseUnaryExpr();
      left = node('BinaryExpr', { op: op.value, left, right, line: op.line, start: left.start, end: right.end });
    }
    return left;
  }

  parseUnaryExpr() {
    // logical not
    if (this.check(TT.OP, '!')) {
      const op = this.cur(); this.pos++;
      const operand = this.parseUnaryExpr();
      return node('UnaryExpr', { op: '!', operand, line: op.line, start: op.start, end: operand.end });
    }

    // negation
    if (this.check(TT.OP, '-')) {
      const op = this.cur(); this.pos++;
      const operand = this.parseUnaryExpr();
      return node('UnaryExpr', { op: '-', operand, line: op.line, start: op.start, end: operand.end });
    }

    // address-of
    if (this.check(TT.OP, '&')) {
      const op = this.cur(); this.pos++;
      const operand = this.parseUnaryExpr();
      return node('UnaryExpr', { op: '&', operand, line: op.line, start: op.start, end: operand.end });
    }

    // as<type>(expr)
    if (this.check(TT.KEYWORD, 'as')) {
      const kw = this.cur(); this.pos++;
      this.eat(TT.OP, '<');
      const asType = this.parseType();
      // Reject as<mut T> — as produces temporaries, can't have mutable type
      if (asType.mut) {
        throw new SyntaxError("'as' target type cannot be mutable (as produces temporary r-values)", kw.line);
      }
      this.eat(TT.OP, '>');
      this.eat(TT.PUNCT, '(');
      const expr  = this.parseExpr();
      const close = this.eat(TT.PUNCT, ')');
      return node('AsExpr', { asType, expr, line: kw.line, start: kw.start, end: close.end });
    }

    return this.parseCallOrPrimary();
  }

  parseCallOrPrimary() {
    let expr = this.parsePrimary();

    // postfix operators: call '(', bracket access '.[', member '.', deref '.*', constructor '::'
    for (;;) {
      if (this.check(TT.PUNCT, '(')) {
        const open = this.cur(); this.pos++;
        const args  = this.parseArgList();
        const close = this.eat(TT.PUNCT, ')');
        expr = node('CallExpr', { callee: expr, args, line: open.line, start: expr.start, end: close.end });
      } else if (this.check(TT.PUNCT, '.')) {
        const dotTok = this.cur(); this.pos++; // save '.' position
        // arr.[i] — bracket access (replaces arr[i] in macro-safe contexts)
        if (this.check(TT.PUNCT, '[')) {
          this.pos++; // consume '['
          const index = this.parseExpr();
          const close = this.eat(TT.PUNCT, ']');
          expr = node('BracketAccessExpr', { base: expr, index, dotStart: dotTok.start, line: expr.line, start: expr.start, end: close.end });
        } else if (this.check(TT.OP, '*')) {
          // Postfix dereference: expr.*
          const starTok = this.cur(); this.pos++;
          expr = node('UnaryExpr', { op: '*', operand: expr, opStart: dotTok.start, line: expr.line, start: expr.start, end: starTok.end });
        } else {
          const member = this.eat(TT.IDENT);
          expr = node('MemberExpr', { obj: expr, member: member.value, dotStart: dotTok.start, memberStart: member.start, line: expr.line, start: expr.start, end: member.end });
        }
      } else if (this.check(TT.OP, '::')) {
        // QualifiedName: A::B, A::B::C, A::B(args), etc.
        // Replaces TypeConstructorExpr — parser does NOT restrict to of/default.
        // Type-checker resolves and tags with _resolvedKind.
        const firstSeg = expr.kind === 'Identifier' ? expr.name : (expr.name ?? String(expr.value));
        const segments = [firstSeg];
        let end = expr.end;

        while (this.check(TT.OP, '::')) {
          this.pos++; // consume '::'
          const seg = this.eat(TT.IDENT);
          segments.push(seg.value);
          end = seg.end;
        }

        // Optional call args after last segment
        let args = null;
        if (this.check(TT.PUNCT, '(')) {
          this.pos++;
          args = this.parseArgList();
          const close = this.eat(TT.PUNCT, ')');
          end = close.end;
        }

        expr = node('QualifiedName', {
          segments, args,
          line: expr.line, start: expr.start, end,
        });
      } else {
        break;
      }
    }

    return expr;
  }

  parseArgList() {
    const args = [];
    if (this.check(TT.PUNCT, ')')) return args;
    do {
      args.push(this.parseExpr());
    } while (this.tryEat(TT.OP, ','));
    return args;
  }

  parsePrimary() {
    const t = this.cur();

    // extern!("module.field") — runtime import expression
    if (t.type === TT.KEYWORD && t.value === 'extern') {
      return this._parseRuntimeImportExpr();
    }

    if (t.type === TT.NUMBER) {
      this.pos++;
      const isFloat = t.value.includes('.');
      return node('Literal', { value: Number(t.value), isFloat, line: t.line, start: t.start, end: t.end });
    }

    if (t.type === TT.BOOL_LIT) {
      this.pos++;
      return node('Literal', { value: t.value === 'true', isFloat: false, isBool: true, line: t.line, start: t.start, end: t.end });
    }

    // Char literal: 'x' — value is numeric code (stored as string in token)
    if (t.type === TT.CHAR_LIT) {
      this.pos++;
      return node('Literal', { value: parseInt(t.value, 10), isChar: true, line: t.line, start: t.start, end: t.end });
    }

    if (t.type === TT.IDENT) {
      this.pos++;
      // Macro call expression: IDENT!(args)
      if (this.check(TT.OP, '!')) {
        this.eat(TT.OP, '!');
        const { args, raw } = this.parseMacroArgs();
        const last = raw.flat();
        const endPos = last.length ? last[last.length - 1].end : t.end;
        return node('MacroCallExpr', { name: t.value, args, raw, line: t.line, start: t.start, end: endPos });
      }
      return node('Identifier', { name: t.value, line: t.line, start: t.start, end: t.end });
    }

    // $name — macro gensym variable (valid inside macro body tokens only)
    if (t.type === TT.MACRO_VAR) {
      this.pos++;
      return node('MacroVarExpr', { name: t.value, line: t.line, start: t.start, end: t.end });
    }

    // @name — macro parameter reference (valid inside macro body tokens only)
    if (t.type === TT.MACRO_PARAM) {
      this.pos++;
      return node('MacroParamExpr', { name: t.value, line: t.line, start: t.start, end: t.end });
    }

    // #name — macro stringify operator (valid inside macro body tokens only)
    if (t.type === TT.MACRO_STRINGIFY) {
      this.pos++;
      return node('MacroStringifyExpr', { name: t.value, line: t.line, start: t.start, end: t.end });
    }

    // Pack literal: '[' (expr (',' expr)*)? ']'
    if (t.type === TT.PUNCT && t.value === '[') {
      const open  = this.eat(TT.PUNCT, '[');
      const elements = [];
      if (!this.check(TT.PUNCT, ']')) {
        do {
          elements.push(this.parseExpr());
        } while (this.tryEat(TT.OP, ','));
      }
      const close = this.eat(TT.PUNCT, ']');
      return node('PackLiteral', { elements, line: open.line, start: open.start, end: close.end });
    }

    // Array literal: '{' expr (',' expr)* '}'
    if (t.type === TT.PUNCT && t.value === '{') {
      const open  = this.eat(TT.PUNCT, '{');
      const elements = [];
      if (!this.check(TT.PUNCT, '}')) {
        do {
          elements.push(this.parseExpr());
        } while (this.tryEat(TT.OP, ','));
      }
      const close = this.eat(TT.PUNCT, '}');
      return node('ArrayLiteral', { elements, line: open.line, start: open.start, end: close.end });
    }

    // String literal: "abc" — treated as array<u8, N> literal
    // Adjacent string literals are concatenated: "aa" "bb" → "aabb"
    if (t.type === TT.STRING_LIT) {
      this.pos++;
      let value = t.value;
      let end   = t.end;
      while (this.cur().type === TT.STRING_LIT) {
        const next = this.cur(); this.pos++;
        value += next.value;
        end    = next.end;
      }
      return node('StringLiteral', { value, line: t.line, start: t.start, end });
    }

    if (t.type === TT.PUNCT && t.value === '(') {
      this.pos++;
      const expr  = this.parseExpr();
      const close = this.eat(TT.PUNCT, ')');
      // Preserve outer parens span
      expr.start = t.start;
      expr.end   = close.end;
      return expr;
    }

    throw new ParseError(`Unexpected token '${t.value}'`, t.line, t.col, t.start, t.end);
  }

  _parseRuntimeImportExpr() {
    const kw     = this.eat(TT.KEYWORD, 'extern');
    this.eat(TT.OP, '!');
    this.eat(TT.PUNCT, '(');
    const strTok = this.eat(TT.STRING_LIT);
    const str    = strTok.value;
    const dot    = str.lastIndexOf('.');
    if (dot <= 0 || dot === str.length - 1) {
      throw new ParseError(
        `extern! string must be 'module.field', got '${str}'`,
        strTok.line, strTok.col, strTok.start, strTok.end,
      );
    }
    const module = str.slice(0, dot);
    const field  = str.slice(dot + 1);
    const close  = this.eat(TT.PUNCT, ')');
    return node('RuntimeImportExpr', { module, field, line: kw.line, start: kw.start, end: close.end });
  }
}
