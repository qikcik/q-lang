// tests/test-lexer.js — Lexer tests

import { test, suite, assert, assertEq, assertThrows } from './helpers.js';
import { tokenize, TT, LexError } from '../compiler/lexer.js';

// ─────────────────────────────────────────────────────────────────────────────
// LEXER
// ─────────────────────────────────────────────────────────────────────────────

suite('Lexer — token types');

test('integer literal', () => {
  const toks = tokenize('42');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '42');
});

test('float literal', () => {
  const toks = tokenize('3.14');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '3.14');
});

test('numeric separator stripped', () => {
  const toks = tokenize('1_000_000');
  assertEq(toks[0].value, '1000000');
});

test('bool literals', () => {
  const toks = tokenize('true false');
  assertEq(toks[0].type, TT.BOOL_LIT);
  assertEq(toks[1].type, TT.BOOL_LIT);
});

test('type keywords', () => {
  const toks = tokenize('i32 f64 bool u8');
  assertEq(toks[0].type, TT.IDENT);
  assertEq(toks[1].type, TT.IDENT);
  assertEq(toks[2].type, TT.IDENT);
  assertEq(toks[3].type, TT.IDENT);
});

test('fn keyword is recognized as KEYWORD', () => {
  const toks = tokenize('fn');
  assertEq(toks[0].type, TT.KEYWORD);
  assertEq(toks[0].value, 'fn');
});

test('keywords', () => {
  const toks = tokenize('return if else while break as fn');
  for (const t of toks.slice(0, 7)) assertEq(t.type, TT.KEYWORD);
});

test(':= recognized as single OP token', () => {
  const toks = tokenize('x := 5;');
  assertEq(toks[1].type, TT.OP);
  assertEq(toks[1].value, ':=');
});

test('string literal', () => {
  const toks = tokenize('"hello"');
  assertEq(toks[0].type, TT.STRING_LIT);
  assertEq(toks[0].value, 'hello');
});

test('string escape sequences', () => {
  const toks = tokenize('"line\\nbreak"');
  assertEq(toks[0].value, 'line\nbreak');
});

test('comment skipped (line)', () => {
  const toks = tokenize('// comment\nx');
  assertEq(toks[0].type, TT.IDENT);
  assertEq(toks[0].value, 'x');
});

test('comment skipped (block)', () => {
  const toks = tokenize('/* block */ y');
  assertEq(toks[0].type, TT.IDENT);
  assertEq(toks[0].value, 'y');
});

test('EOF token at end', () => {
  const toks = tokenize('x');
  assertEq(toks[toks.length - 1].type, TT.EOF);
});

suite('Lexer — start/end offsets');

test('integer start/end', () => {
  const toks = tokenize('  42  ');
  assertEq(toks[0].start, 2);
  assertEq(toks[0].end,   4);
});

test('ident start/end', () => {
  const toks = tokenize('abc');
  assertEq(toks[0].start, 0);
  assertEq(toks[0].end,   3);
});

test('two-char op start/end', () => {
  const toks = tokenize('x := 5;');
  //  x   :=     5   ;
  //  0   2      5   6
  assertEq(toks[1].start, 2);
  assertEq(toks[1].end,   4);
});

test('string literal start/end includes quotes', () => {
  const toks = tokenize('"hi"');
  assertEq(toks[0].start, 0);
  assertEq(toks[0].end,   4);  // 0.."hi" = 4 chars
});

test('token after whitespace has correct offset', () => {
  const src  = '   i32';
  const toks = tokenize(src);
  assertEq(toks[0].start, 3);
  assertEq(toks[0].end,   6);
});

suite('Lexer — errors');

test('unterminated string throws LexError with start', () => {
  assertThrows(() => tokenize('"unterminated'), LexError);
  try { tokenize('"unterminated'); } catch (e) {
    assert(e.start != null, 'LexError.start should be set');
  }
});

test('unknown character throws LexError', () => {
  assertThrows(() => tokenize('@'), LexError);
});

// ─────────────────────────────────────────────────────────────────────────────
// Char literals
// ─────────────────────────────────────────────────────────────────────────────

suite('Lexer — char literals');

test("char literal 'A' has type CHAR_LIT", () => {
  const toks = tokenize("'A'");
  assertEq(toks[0].type, TT.CHAR_LIT);
});

test("char literal 'A' value is numeric code", () => {
  const toks = tokenize("'A'");
  assertEq(toks[0].value, '65');
});

test("char literal '#' = 35", () => {
  const toks = tokenize("'#'");
  assertEq(toks[0].value, '35');
});

test("char literal ' ' = 32", () => {
  const toks = tokenize("' '");
  assertEq(toks[0].value, '32');
});

// ─────────────────────────────────────────────────────────────────────────────
// Lexer — hex literals
// ─────────────────────────────────────────────────────────────────────────────

suite('Lexer — hex literals');

test('0xFF tokenizes as NUMBER', () => {
  const toks = tokenize('0xFF');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '0xFF');
});

test('0xFF0000FF tokenizes as NUMBER (color constant)', () => {
  const toks = tokenize('0xFF0000FF');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '0xFF0000FF');
});

test('0x0 tokenizes as NUMBER', () => {
  const toks = tokenize('0x0');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '0x0');
});

test('hex uppercase 0xDEADBEEF tokenizes as NUMBER', () => {
  const toks = tokenize('0xDEADBEEF');
  assertEq(toks[0].type, TT.NUMBER);
  assertEq(toks[0].value, '0xDEADBEEF');
});

test('0x followed by non-hex is just 0 then identifier', () => {
  const toks = tokenize('0xGG');
  // 0x → but G is not a hex digit, so '0' is a complete number, 'xGG' is an identifier
  // Actually: '0' consumed, then 'x' triggers hex scan but 'G' isn't hex
  // Result: '0x' with zero hex digits is '0x' as value or fallback
  // The simplest valid behavior: 0x with no hex digits is still token '0x'
  // (guard against crash, value may be NaN-safe for parser)
  assert(toks[0].type === TT.NUMBER || toks[0].type === TT.IDENT, 'first token is NUMBER or IDENT');
});

test("char escape '\\n' = 10", () => {
  const toks = tokenize("'\\n'");
  assertEq(toks[0].type, TT.CHAR_LIT);
  assertEq(toks[0].value, '10');
});

test("char escape '\\t' = 9", () => {
  const toks = tokenize("'\\t'");
  assertEq(toks[0].value, '9');
});

test("char escape '\\0' = 0", () => {
  const toks = tokenize("'\\0'");
  assertEq(toks[0].value, '0');
});

test("char escape '\\\\' = 92", () => {
  const toks = tokenize("'\\\\'"  );
  assertEq(toks[0].value, '92');
});

test("char literal start/end offsets include quotes", () => {
  const toks = tokenize("'A'");
  assertEq(toks[0].start, 0);
  assertEq(toks[0].end,   3);
});

test("empty char literal throws LexError", () => {
  assertThrows(() => tokenize("''"), LexError);
});

test("unterminated char literal throws LexError", () => {
  assertThrows(() => tokenize("'A"), LexError);
});

test("unknown char escape throws LexError", () => {
  assertThrows(() => tokenize("'\\q'"), LexError);
});
