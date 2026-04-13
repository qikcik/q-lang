// tests/test-parser.js — Parser tests

import { test, suite, assert, assertEq, assertThrows } from './helpers.js';
import { tokenize, TT } from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { HINTS as HOVER_HINTS } from '../ide/hover.js';

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — var declarations');

test('inferred var decl', () => {
  const ast = parse(tokenize('x := 5;'));
  assertEq(ast.body[0].kind, 'VarDecl');
  assertEq(ast.body[0].name, 'x');
  assert(ast.body[0].typeAnnot === null);
});

test('explicit var decl', () => {
  const ast = parse(tokenize('x : i32 = 5;'));
  assertEq(ast.body[0].kind, 'VarDecl');
  assertEq(ast.body[0].typeAnnot.name, 'i32');
});

test('var decl start/end spans full declaration', () => {
  const src = 'x := 5;';
  const ast = parse(tokenize(src));
  assertEq(ast.body[0].start, 0);
  assertEq(ast.body[0].end,   src.length);
});

suite('Parser — function declarations');

test('top-level func decl', () => {
  const ast = parse(tokenize('f := fn(a: i32) i32 { return a; };'));
  assertEq(ast.body[0].kind,        'FuncDecl');
  assertEq(ast.body[0].name,        'f');
  assertEq(ast.body[0].returnType.name, 'i32');
  assertEq(ast.body[0].params.length, 1);
  assertEq(ast.body[0].params[0].name, 'a');
});

test('func decl with explicit return type using :', () => {
  const ast = parse(tokenize('f := fn(a: i32) i32 { return a; };'));
  assertEq(ast.body[0].kind, 'FuncDecl');
});

test('func body is a Block', () => {
  const ast = parse(tokenize('f := fn() i32 { return 0; };'));
  assertEq(ast.body[0].body.kind, 'Block');
});

test('local function declaration inside block', () => {
  const src = 'main := fn() i32 { inner := fn() i32 { return 1; }; return inner(); };';
  const ast = parse(tokenize(src));
  const block = ast.body[0].body;
  assertEq(block.body[0].kind, 'FuncDecl');
  assertEq(block.body[0].name, 'inner');
});

suite('Parser — statements');

test('if statement', () => {
  const ast = parse(tokenize('main := fn() i32 { if (true) { return 1; } };'));
  const ifStmt = ast.body[0].body.body[0];
  assertEq(ifStmt.kind, 'IfStmt');
  assert(ifStmt.elseBranch === null);
});

test('if-else statement', () => {
  const ast = parse(tokenize('main := fn() i32 { if (true) { return 1; } else { return 0; } };'));
  const ifStmt = ast.body[0].body.body[0];
  assertEq(ifStmt.kind, 'IfStmt');
  assert(ifStmt.elseBranch !== null);
});

test('while statement', () => {
  const ast = parse(tokenize('main := fn() i32 { i := 0; while (false) { i = i + 1; } return i; };'));
  const whileStmt = ast.body[0].body.body[1];
  assertEq(whileStmt.kind, 'WhileStmt');
});

test('return statement', () => {
  const ast = parse(tokenize('f := fn() i32 { return 42; };'));
  assertEq(ast.body[0].body.body[0].kind, 'ReturnStmt');
});

test('break statement in while', () => {
  const ast = parse(tokenize('main := fn() i32 { while (true) { break; } return 0; };'));
  const ws  = ast.body[0].body.body[0];
  assertEq(ws.body.body[0].kind, 'BreakStmt');
});

suite('Parser — expressions');

test('binary expr precedence: * before +', () => {
  const ast   = parse(tokenize('x := 2 + 3 * 4;'));
  const value = ast.body[0].value;
  assertEq(value.kind, 'BinaryExpr');
  assertEq(value.op,   '+');
  assertEq(value.right.op, '*');
});

test('unary negation', () => {
  const ast = parse(tokenize('x := !true;'));
  assertEq(ast.body[0].value.kind, 'UnaryExpr');
  assertEq(ast.body[0].value.op,   '!');
});

test('call expression', () => {
  const ast = parse(tokenize('f := fn() i32 { return 0; }; x := f();'));
  assertEq(ast.body[1].value.kind, 'CallExpr');
});

test('bracket access expression', () => {
  const ast = parse(tokenize('a : array<i32, 3> = {1,2,3}; x := a.[0];'));
  assertEq(ast.body[1].value.kind, 'BracketAccessExpr');
});

test('BracketAccessExpr stores dotStart (position of .)', () => {
  const src = 'a : array<i32, 3> = {1,2,3}; x := a.[0];';
  const ast = parse(tokenize(src));
  const idx = ast.body[1].value; // BracketAccessExpr
  assert(idx.dotStart != null, 'dotStart must be set');
  assertEq(src[idx.dotStart], '.', 'dotStart must point to .');
});

test('member expression (arr.size)', () => {
  const ast = parse(tokenize('a : array<i32, 3> = {1,2,3}; n := a.size;'));
  assertEq(ast.body[1].value.kind, 'MemberExpr');
  assertEq(ast.body[1].value.member, 'size');
});

test('MemberExpr stores dotStart and memberStart', () => {
  const src = 'a : array<i32, 3> = {1,2,3}; n := a.size;';
  const ast = parse(tokenize(src));
  const mem = ast.body[1].value; // MemberExpr
  assert(mem.dotStart != null,    'dotStart must be set');
  assert(mem.memberStart != null, 'memberStart must be set');
  assertEq(src[mem.dotStart],    '.', 'dotStart must point to .');
  assertEq(src.slice(mem.memberStart, mem.memberStart + 4), 'size', 'memberStart must point to size');
});

test('HOVER_HINTS contains built-in type and keyword descriptions', () => {
  assertEq(HOVER_HINTS['as'].label, 'as<T>(expr)');
  assert(HOVER_HINTS['as'].detail.includes('temporary'));
  assertEq(HOVER_HINTS['array'].detail, 'native raw sequential array with constant compile-time size N');
  assert(HOVER_HINTS['f32'].detail.includes('== and != are forbidden'));
});

test('as expression', () => {
  const ast = parse(tokenize('x := as<i32>(3.14);'));
  assertEq(ast.body[0].value.kind, 'AsExpr');
});

test('as<mut T> rejected', () => {
  assertThrows(() => {
    parse(tokenize('x := as<mut i32>(5);'));
  }, SyntaxError, 'mutable');
});

test('array literal', () => {
  const ast = parse(tokenize('x : array<i32, 3> = {1, 2, 3};'));
  assertEq(ast.body[0].value.kind, 'ArrayLiteral');
  assertEq(ast.body[0].value.elements.length, 3);
});

test('string literal in decl', () => {
  const ast = parse(tokenize('x : array<u8, 5> = "hello";'));
  assertEq(ast.body[0].value.kind, 'StringLiteral');
  assertEq(ast.body[0].value.value, 'hello');
});

suite('Parser — start/end on all major nodes');

test('Block start/end', () => {
  const src = 'f := fn() i32 { return 0; };';
  const ast = parse(tokenize(src));
  const blk = ast.body[0].body;
  assert(blk.start != null && blk.end != null, 'Block must have start/end');
  assertEq(src.slice(blk.start, blk.end), '{ return 0; }');
});

test('FuncDecl start/end', () => {
  const src = 'f := fn() i32 { return 0; };';
  const ast = parse(tokenize(src));
  assert(ast.body[0].start === 0);
  assert(ast.body[0].end   === src.length);
});

test('IfStmt start/end', () => {
  const src = 'main := fn() i32 { if (true) { return 1; } return 0; };';
  const ast = parse(tokenize(src));
  const ifStmt = ast.body[0].body.body[0];
  assert(ifStmt.start != null);
  assert(src.slice(ifStmt.start).startsWith('if'));
});

test('BinaryExpr start/end', () => {
  const src = 'x := 2 + 3;';
  const ast = parse(tokenize(src));
  const expr = ast.body[0].value;
  assertEq(src.slice(expr.start, expr.end), '2 + 3');
});

// ─────────────────────────────────────────────────────────────────────────────
// Char literals + string concatenation
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — char literals');

test("'A' parses as Literal with isChar=true", () => {
  const ast = parse(tokenize("x := 'A';"));
  const lit = ast.body[0].value;
  assertEq(lit.kind,   'Literal');
  assert(lit.isChar,   'isChar should be true');
  assertEq(lit.value,  65);
});

test("'\\n' parses with value 10", () => {
  const ast = parse(tokenize("x := '\\n';"));
  assertEq(ast.body[0].value.value, 10);
});

test("'#' parses with value 35", () => {
  const ast = parse(tokenize("x := '#';"));
  assertEq(ast.body[0].value.value, 35);
});

test("char literal span covers quotes", () => {
  const src = "x := 'A';";
  const ast  = parse(tokenize(src));
  const lit  = ast.body[0].value;
  assertEq(src.slice(lit.start, lit.end), "'A'");
});

suite('Parser — adjacent string concatenation');

test('"aa" "bb" concatenates to single StringLiteral', () => {
  const ast = parse(tokenize('x := "aa" "bb";'));
  const lit  = ast.body[0].value;
  assertEq(lit.kind,  'StringLiteral');
  assertEq(lit.value, 'aabb');
});

test('three adjacent strings concat', () => {
  const ast = parse(tokenize('x := "a" "b" "c";'));
  assertEq(ast.body[0].value.value, 'abc');
});

test('single string not affected', () => {
  const ast = parse(tokenize('x := "hello";'));
  assertEq(ast.body[0].value.value, 'hello');
});

test('concat span covers all strings', () => {
  const src = 'x := "aa" "bb";';
  const ast  = parse(tokenize(src));
  const lit  = ast.body[0].value;
  assertEq(src.slice(lit.start, lit.end), '"aa" "bb"');
});
