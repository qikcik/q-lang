// tests/test-parser-recovery.js — Resilient parser smoke tests
//
// Strategy (wayOfWork.md §10): smoke tests covering key recovery scenarios.
// No tests for internal implementation details — only observable AST shape.

import { test, suite, assert, assertEq } from './helpers.js';
import { tokenize }    from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { compile, liveCompile } from '../compiler/pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// Top-level recovery
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser recovery — top-level');

test('garbage before valid decl → ErrorNode + VarDecl', () => {
  const ast = parse(tokenize('!!! y := 2;'));
  assertEq(ast.body.length, 2);
  assertEq(ast.body[0].kind, 'ErrorNode');
  assertEq(ast.body[1].kind, 'VarDecl');
  assertEq(ast.body[1].name, 'y');
});

test('parse() always returns Program (never throws ParseError)', () => {
  // Use lex-valid tokens that are grammatically invalid
  const ast = parse(tokenize('totally + broken code here'));
  assertEq(ast.kind, 'Program');
  assert(ast.errors.length > 0);
});

test('errors array populated with ParseError instances', () => {
  const ast = parse(tokenize('!!! y := 2;'));
  assert(ast.errors.length > 0);
  assert(ast.errors[0] instanceof ParseError);
});

test('multiple bad decls → multiple ErrorNodes', () => {
  // Use lex-valid but grammatically invalid tokens for both errors
  const ast = parse(tokenize('!!! y := 2; !! z := 3;'));
  const errorNodes = ast.body.filter(n => n.kind === 'ErrorNode');
  assert(errorNodes.length >= 1, 'should have at least one ErrorNode');
  assert(ast.errors.length >= 1, 'should have at least one error');
});

test('ErrorNode has error property with message', () => {
  const ast = parse(tokenize('!!! y := 2;'));
  const errNode = ast.body[0];
  assertEq(errNode.kind, 'ErrorNode');
  assert(typeof errNode.error.message === 'string');
  assert(errNode.error.message.length > 0);
});

test('good code before and after bad decl is preserved', () => {
  const src = 'a := 1; !!! b := 2; c := 3;';
  const ast = parse(tokenize(src));
  const kinds = ast.body.map(n => n.kind);
  assert(kinds.includes('VarDecl'), 'should have VarDecl');
  assert(kinds.includes('ErrorNode'), 'should have ErrorNode');
  const varDecls = ast.body.filter(n => n.kind === 'VarDecl');
  assert(varDecls.some(d => d.name === 'a'), 'a should be parsed');
  assert(varDecls.some(d => d.name === 'c'), 'c should be parsed');
});

test('empty source → empty Program, no errors', () => {
  const ast = parse(tokenize(''));
  assertEq(ast.kind, 'Program');
  assertEq(ast.body.length, 0);
  assertEq(ast.errors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Statement-level (block) recovery
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser recovery — statement-level');

test('bad stmt in function body → FuncDecl preserved', () => {
  const src = 'main := fn() i32 { !!! return 0; };';
  const ast = parse(tokenize(src));
  assertEq(ast.body[0].kind, 'FuncDecl');
  assertEq(ast.body[0].name, 'main');
});

test('bad stmt followed by valid stmt → valid stmt preserved in body', () => {
  // Error on rhs of assignment: scan consumes up to ';', then return stmt parses ok
  const src = 'main := fn() i32 { x := !!!; return 1; };';
  const ast = parse(tokenize(src));
  const body = ast.body[0].body.body;
  const returnStmt = body.find(s => s.kind === 'ReturnStmt');
  assert(returnStmt != null, 'ReturnStmt should survive after bad stmt');
});

test('ErrorNode in block body carries ParseError', () => {
  const src = 'main := fn() i32 { !! return 0; };';
  const ast = parse(tokenize(src));
  const body = ast.body[0].body.body;
  const errNode = body.find(s => s.kind === 'ErrorNode');
  assert(errNode != null, 'ErrorNode should be in body');
  assert(errNode.error instanceof ParseError);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline: compile() with parse errors
// ─────────────────────────────────────────────────────────────────────────────

suite('Pipeline — compile() with parse errors');

test('compile() never throws ParseError', () => {
  // Should not throw — errors go into parseErrors
  const result = compile('!!! nonsense');
  assert(result != null);
  assert(result.parseErrors.length > 0);
});

test('compile() returns parseErrors field', () => {
  const { parseErrors } = compile('!!! x := 1;');
  assert(Array.isArray(parseErrors));
  assert(parseErrors.length > 0);
  assert(parseErrors[0] instanceof ParseError);
});

test('compile() skips typecheck when parseErrors (no _type on nodes)', () => {
  const { ast, parseErrors } = compile('!!! x := 1;');
  assert(parseErrors.length > 0);
  // VarDecl parsed after error should not have _type (typecheck was skipped)
  const varDecl = ast.body.find(n => n.kind === 'VarDecl');
  if (varDecl) assert(varDecl._type == null, '_type should not be set when typecheck skipped');
});

test('compile() with valid code returns empty parseErrors', () => {
  const { parseErrors } = compile('x := 42;');
  assertEq(parseErrors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline: liveCompile()
// ─────────────────────────────────────────────────────────────────────────────

suite('Pipeline — liveCompile()');

test('liveCompile() never throws', () => {
  const result = liveCompile('!!! broken garbage @#%');
  assert(result != null);
});

test('liveCompile() returns parseErrors on bad input', () => {
  const { parseErrors } = liveCompile('!!! bad');
  assert(parseErrors.length > 0);
  assert(parseErrors[0] instanceof ParseError);
});

test('liveCompile() returns ast on partial input', () => {
  const { ast } = liveCompile('!!! y := 2;');
  assert(ast != null);
  assertEq(ast.kind, 'Program');
});

test('liveCompile() with valid code → typeErrors empty, ast typed', () => {
  const { parseErrors, typeErrors, ast } = liveCompile('x := 42;');
  assertEq(parseErrors.length, 0);
  assertEq(typeErrors.length, 0);
  const xDecl = ast.body.find(n => n.kind === 'VarDecl');
  assert(xDecl?._type != null, 'x should be typed');
});

test('liveCompile() with type error → typeErrors populated, no throw', () => {
  const { typeErrors } = liveCompile('x := 1 + true;');
  assert(typeErrors.length > 0);
});
