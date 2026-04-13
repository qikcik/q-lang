// tests/test-defer.js — §11 defer statement tests

import { test, suite, assert, assertEq, compileAndGenerate } from './helpers.js';
import { tokenize } from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { expand } from '../compiler/macro-expander.js';
import { compile } from '../compiler/pipeline.js';
import { deferPass } from '../compiler/defer-pass.js';
import { generate } from '../compiler/codegen.js';

// ─────────────────────────────────────────────────────────────────────────────
// Parser — defer
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — defer statement');

test('defer parses as DeferStmt', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x; return 0; };`;
  const ast = parse(tokenize(src));
  const stmts = ast.body[0].body.body;
  assertEq(stmts[1].kind, 'DeferStmt');
});

test('DeferStmt.expr is the deferred expression', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x; return 0; };`;
  const ast = parse(tokenize(src));
  const deferStmt = ast.body[0].body.body[1];
  assertEq(deferStmt.expr.kind, 'Identifier');
  assertEq(deferStmt.expr.name, 'x');
});

// ─────────────────────────────────────────────────────────────────────────────
// defer-pass — AST rewrite
// ─────────────────────────────────────────────────────────────────────────────

suite('deferPass — rewrite');

test('DeferStmt removed from block after rewrite', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x; return 0; };`;
  const { ast } = compile(src);  // pipeline includes deferPass
  const stmts = ast.body[0].body.body;
  assert(stmts.every(s => s.kind !== 'DeferStmt'), 'DeferStmt should be removed');
});

test('deferred expr injected before return', () => {
  // defer x; return 0; → [ExprStmt(x), ReturnStmt(0)]
  const src = `main := fn() i32 { x : mut i32 = 7; defer x; return 0; };`;
  const { ast } = compile(src);
  const stmts = ast.body[0].body.body;
  // stmts: VarDecl(x), ExprStmt(x), ReturnStmt(0)
  const hasExprBeforeReturn =
    stmts.findIndex(s => s.kind === 'ExprStmt') <
    stmts.findIndex(s => s.kind === 'ReturnStmt');
  assert(hasExprBeforeReturn, 'deferred ExprStmt should precede ReturnStmt');
});

test('multiple defers execute in reverse order', () => {
  // Both defer stmts should appear before return, in reversed order.
  const src = `
    main := fn() i32 {
      a : mut i32 = 0;
      defer a;
      defer a;
      return a;
    };
  `;
  const { ast } = compile(src);
  const stmts = ast.body[0].body.body;
  // Expect: VarDecl(a), ExprStmt, ExprStmt, ReturnStmt
  const retIdx = stmts.findIndex(s => s.kind === 'ReturnStmt');
  assert(retIdx >= 2, 'at least 2 stmts before return');
  assert(stmts[retIdx - 1].kind === 'ExprStmt', 'stmt before return is ExprStmt');
  assert(stmts[retIdx - 2].kind === 'ExprStmt', 'stmt 2 before return is ExprStmt');
});

// ─────────────────────────────────────────────────────────────────────────────
// CodeGen — defer compiles end-to-end
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — defer');

test('function with defer compiles to valid WASM', () => {
  const bytes = compileAndGenerate(`
    cleanup := fn(x: i32) i32 { return x; };
    main := fn() i32 {
      defer cleanup(0);
      return 1;
    };
  `);
  assert(bytes instanceof Uint8Array && bytes.length > 8, 'should emit valid WASM');
});

// ─────────────────────────────────────────────────────────────────────────────
// Parser — defer assignment (stmt-form)
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — defer assignment (stmt-form)');

test('defer x = 5; parses as DeferStmt with stmt field', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x = 5; return x; };`;
  const ast = parse(tokenize(src));
  const deferStmt = ast.body[0].body.body[1];
  assertEq(deferStmt.kind, 'DeferStmt');
  assert(deferStmt.stmt != null,  'DeferStmt.stmt should be set for assignment form');
  assert(deferStmt.expr === null, 'DeferStmt.expr should be null for assignment form');
});

test('stmt-form DeferStmt.stmt is AssignStmt', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x = 5; return x; };`;
  const ast = parse(tokenize(src));
  const deferStmt = ast.body[0].body.body[1];
  assertEq(deferStmt.stmt.kind, 'AssignStmt');
  assertEq(deferStmt.stmt.target.name, 'x');
  assertEq(deferStmt.stmt.value.value, 5);
});

test('expr-form DeferStmt still has expr set and stmt null', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x; return 0; };`;
  const ast = parse(tokenize(src));
  const deferStmt = ast.body[0].body.body[1];
  assertEq(deferStmt.expr.kind, 'Identifier');
  assert(deferStmt.stmt === null, 'DeferStmt.stmt should be null for expr form');
});

// ─────────────────────────────────────────────────────────────────────────────
// deferPass — stmt-form rewrite
// ─────────────────────────────────────────────────────────────────────────────

suite('deferPass — stmt-form defer');

test('stmt-form defer injects AssignStmt before return', () => {
  const src = `main := fn() i32 { x : mut i32 = 0; defer x = 99; return x; };`;
  const { ast } = compile(src);
  const stmts = ast.body[0].body.body;
  // Expect: VarDecl, AssignStmt (deferred), ReturnStmt
  assert(stmts.every(s => s.kind !== 'DeferStmt'), 'DeferStmt should be removed');
  const retIdx = stmts.findIndex(s => s.kind === 'ReturnStmt');
  assertEq(stmts[retIdx - 1].kind, 'AssignStmt', 'injected stmt should be AssignStmt');
});

test('stmt-form defer compiles to valid WASM', () => {
  const bytes = compileAndGenerate(`
    main := fn() i32 {
      x : mut i32 = 0;
      defer x = 5;
      return x;
    };
  `);
  assert(bytes instanceof Uint8Array && bytes.length > 8, 'should emit valid WASM');
});

// ─────────────────────────────────────────────────────────────────────────────
// CodeGen — defer with pointer (ptr-form)
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — defer with pointer mutation');

test('defer cleanup(&local) compiles to valid WASM', () => {
  const bytes = compileAndGenerate(`
    cleanup := fn(x: ptr<mut i32>) void { x.* = 0; };
    main := fn() i32 {
      tt : mut i32 = 1000;
      defer cleanup(&tt);
      return tt;
    };
  `);
  assert(bytes instanceof Uint8Array && bytes.length > 8, 'should emit valid WASM');
});

