// ─────────────────────────────────────────────────────────────────────────────
// parser-base.js — shared utilities for the recursive descent parser
//
// Exports:
//   ParseError       — thrown on unexpected tokens (carries line/col/start/end)
//   node(kind, props) — AST node factory
//   errorNode(err)   — ErrorNode factory for parse error recovery
//   ParserBase       — token stream helpers that all parser tiers inherit
//
// Hierarchy:
//   ParserBase (this file)
//     └─ ParserExprs (parser-exprs.js) — type + expression parsing
//          └─ Parser (parser.js)       — declarations + statements + public API
// ─────────────────────────────────────────────────────────────────────────────

import { TT } from './lexer.js';

// ── node factories ────────────────────────────────────────────────────────────

export const node = (kind, props) => ({ kind, ...props });

// ErrorNode: produced by the parser when a declaration or statement fails to
// parse. Carries the original ParseError and the source span of the bad region.
// Downstream passes (typechecker, codegen) must skip ErrorNodes entirely.
export const errorNode = (err) => ({
  kind:  'ErrorNode',
  error: err,
  start: err.start,
  end:   err.end,
});

// ── ParseError ────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(msg, line, col, start, end) {
    super(`[Parse] Line ${line}:${col} — ${msg}`);
    this.line  = line;
    this.col   = col;
    this.start = start ?? null;
    this.end   = end   ?? null;
  }
}

// ── ParserBase — token stream helpers ─────────────────────────────────────────

export class ParserBase {
  /** @param {import('./lexer.js').Token[]} tokens */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos    = 0;
    this.errors = []; // accumulates ALL ParseErrors from recovery
  }

  cur()          { return this.tokens[this.pos]; }
  peek(offset=1) { return this.tokens[this.pos + offset]; }

  eat(type, value) {
    const t = this.cur();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ParseError(
        `Expected ${value ?? type}, got '${t.value}'`,
        t.line, t.col, t.start, t.end,
      );
    }
    this.pos++;
    return t;
  }

  tryEat(type, value) {
    const t = this.cur();
    if (t.type === type && (value === undefined || t.value === value)) {
      this.pos++;
      return t;
    }
    return null;
  }

  check(type, value) {
    const t = this.cur();
    return t.type === type && (value === undefined || t.value === value);
  }

  error(msg) {
    const t = this.cur();
    throw new ParseError(msg, t.line, t.col, t.start, t.end);
  }
}
