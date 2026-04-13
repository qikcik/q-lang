// tests/test-ast-renderer.js — AST renderer: nodeLabel coverage + MacroDecl visibility

import { test, suite, assert, assertEq } from './helpers.js';
import { nodeLabel } from '../compiler/ast-renderer.js';
import { compile } from '../compiler/pipeline.js';
import { parse } from '../compiler/parser.js';
import { tokenize } from '../compiler/lexer.js';
import { expand } from '../compiler/macro-expander.js';

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — leaf / value nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: leaf nodes');

test('Literal integer', () => assertEq(nodeLabel({ kind: 'Literal', value: 42 }), '42'));
test('Literal float',   () => assertEq(nodeLabel({ kind: 'Literal', value: 3.14 }), '3.14'));
test('Literal bool',    () => assertEq(nodeLabel({ kind: 'Literal', value: true }), 'true'));
test('Identifier',      () => assertEq(nodeLabel({ kind: 'Identifier', name: 'foo' }), 'foo'));
test('StringLiteral short', () => assertEq(nodeLabel({ kind: 'StringLiteral', value: 'hi' }), '"hi"'));
test('StringLiteral truncated at 20 chars', () => {
  const lbl = nodeLabel({ kind: 'StringLiteral', value: 'abcdefghijklmnopqrstuvwxyz' });
  assert(lbl.includes('\u2026'), 'long string label should contain ellipsis');
});

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — type nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: type nodes');

test('Type', ()     => assertEq(nodeLabel({ kind: 'Type', name: 'i32', mut: false }), 'i32'));
test('Type mut', () => assertEq(nodeLabel({ kind: 'Type', name: 'i32', mut: true }),  'mut i32'));
test('PtrType', () => {
  const inner = { kind: 'Type', name: 'i32', mut: false };
  assertEq(nodeLabel({ kind: 'PtrType', inner, mut: false }), 'ptr<i32>');
});
test('PtrType mut', () => {
  const inner = { kind: 'Type', name: 'f32', mut: false };
  assertEq(nodeLabel({ kind: 'PtrType', inner, mut: true }), 'mut ptr<f32>');
});
test('ArrayType', () => {
  const et = { kind: 'Type', name: 'i32', mut: false };
  assertEq(nodeLabel({ kind: 'ArrayType', elemType: et, size: 4, mut: false }), 'array<i32, 4>');
});
test('FuncType', () => {
  const p1  = { kind: 'Type', name: 'i32', mut: false };
  const ret = { kind: 'Type', name: 'i32', mut: false };
  assertEq(nodeLabel({ kind: 'FuncType', paramTypes: [p1], returnType: ret, mut: false }), 'fn(i32) i32');
});

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — declaration nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: declarations');

test('FuncDecl', ()  => assertEq(nodeLabel({ kind: 'FuncDecl', name: 'main' }), 'main'));
test('VarDecl const', () => assertEq(nodeLabel({ kind: 'VarDecl', name: 'x', _type: { mut: false } }), 'x [const]'));
test('VarDecl mut',   () => assertEq(nodeLabel({ kind: 'VarDecl', name: 'x', _type: { mut: true } }),  'x [mut]'));
test('MacroDecl', ()  => assertEq(nodeLabel({ kind: 'MacroDecl', name: 'for_each' }), 'for_each'));
test('MacroParam', () => assertEq(nodeLabel({ kind: 'MacroParam', name: 'arr', paramKind: 'expr' }), 'arr: expr'));
test('MacroParam pack', () => assertEq(nodeLabel({ kind: 'MacroParam', name: 'vals', paramKind: 'pack<expr>' }), 'vals: pack<expr>'));
test('MacroBody', ()  => assertEq(nodeLabel({ kind: 'MacroBody', tokens: [1, 2, 3] }), '{ 3 tokens }'));
test('Param',     ()  => assertEq(nodeLabel({ kind: 'Param', name: 'n' }), 'n'));
test('MacroExpansionNode', () => assertEq(nodeLabel({ kind: 'MacroExpansionNode', macroName: 'inc' }), 'inc!(…)'));

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — statement nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: statements');

test('Block',        () => assertEq(nodeLabel({ kind: 'Block' }), ''));
test('ReturnStmt',   () => assertEq(nodeLabel({ kind: 'ReturnStmt' }), ''));
test('ExprStmt',     () => assertEq(nodeLabel({ kind: 'ExprStmt' }), ''));
test('BreakStmt',    () => assertEq(nodeLabel({ kind: 'BreakStmt' }), 'break'));
test('DeferStmt',    () => assertEq(nodeLabel({ kind: 'DeferStmt' }), 'defer'));
test('IfStmt',       () => assertEq(nodeLabel({ kind: 'IfStmt' }), 'if'));
test('WhileStmt',    () => assertEq(nodeLabel({ kind: 'WhileStmt' }), 'while'));
test('ScopeBlock',   () => assertEq(nodeLabel({ kind: 'ScopeBlock' }), ''));
test('AssignStmt with Identifier target', () => {
  const target = { kind: 'Identifier', name: 'x' };
  assertEq(nodeLabel({ kind: 'AssignStmt', target }), 'x =');
});
test('AssignStmt with complex target', () => {
  const target = { kind: 'BracketAccessExpr' };
  assertEq(nodeLabel({ kind: 'AssignStmt', target }), '=');
});
test('MacroCallStmt', () => assertEq(nodeLabel({ kind: 'MacroCallStmt', name: 'inc' }), 'inc!(…)'));

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — expression nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: expressions');

test('BinaryExpr', ()  => assertEq(nodeLabel({ kind: 'BinaryExpr', op: '+' }), '+'));
test('UnaryExpr',  ()  => assertEq(nodeLabel({ kind: 'UnaryExpr', op: '&' }), '&'));
test('AsExpr',     ()  => assertEq(nodeLabel({ kind: 'AsExpr' }), ''));
test('ArrayLiteral', () => assertEq(nodeLabel({ kind: 'ArrayLiteral', elements: [1, 2, 3] }), '[3]'));
test('PackLiteral',  () => assertEq(nodeLabel({ kind: 'PackLiteral', elements: [1, 2] }), '[2]'));
test('PackLiteral empty', () => assertEq(nodeLabel({ kind: 'PackLiteral', elements: [] }), '[0]'));
test('BracketAccessExpr with Literal index', () => {
  const index = { kind: 'Literal', value: 2 };
  assertEq(nodeLabel({ kind: 'BracketAccessExpr', index }), '.[2]');
});
test('BracketAccessExpr with non-literal index', () => {
  const index = { kind: 'Identifier', name: 'i' };
  assertEq(nodeLabel({ kind: 'BracketAccessExpr', index }), '.[…]');
});
test('MemberExpr', ()  => assertEq(nodeLabel({ kind: 'MemberExpr', member: 'size' }), '.size'));
test('QualifiedName', () => assertEq(nodeLabel({ kind: 'QualifiedName', segments: ['i32', 'of'] }), 'i32::of'));
test('CallExpr with Identifier callee', () => {
  const callee = { kind: 'Identifier', name: 'fib' };
  assertEq(nodeLabel({ kind: 'CallExpr', callee }), 'fib');
});
test('CallExpr with UnaryExpr callee (fn ptr)', () => {
  const callee = { kind: 'UnaryExpr', op: '*' };
  assertEq(nodeLabel({ kind: 'CallExpr', callee }), '*');
});

// ─────────────────────────────────────────────────────────────────────────────
// nodeLabel — error nodes
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — nodeLabel: error nodes');

test('ErrorNode', () => {
  const lbl = nodeLabel({ kind: 'ErrorNode', error: { message: 'unexpected token' } });
  assertEq(lbl, 'unexpected token');
});
test('ErrorNode long message truncated', () => {
  const long = 'a'.repeat(80);
  const lbl  = nodeLabel({ kind: 'ErrorNode', error: { message: long } });
  assert(lbl.endsWith('…'), 'truncated label should end with ellipsis');
  assert(lbl.length <= 62, 'truncated label should fit');
});
test('TypeErrorNode', () => {
  const lbl = nodeLabel({ kind: 'TypeErrorNode', error: { message: 'type mismatch' } });
  assertEq(lbl, 'type mismatch');
});

// ─────────────────────────────────────────────────────────────────────────────
// MacroDecl in AST after expansion
// ─────────────────────────────────────────────────────────────────────────────

suite('AST Renderer — MacroDecl visibility after expansion');

test('MacroDecl kept in ast.body after expand', () => {
  const tokens = tokenize('m := macro(a : expr) { }; main := fn() i32 { return 0; };');
  const ast    = parse(tokens);
  expand(ast);
  assert(ast.body.some(d => d.kind === 'MacroDecl'), 'MacroDecl should be present in ast.body for IDE display');
});

test('MacroDecl has correct kind after expansion', () => {
  const tokens = tokenize('greet := macro(x : ident) { }; main := fn() i32 { return 0; };');
  const ast    = parse(tokens);
  expand(ast);
  const decl = ast.body.find(d => d.kind === 'MacroDecl');
  assert(decl != null, 'MacroDecl should be found');
  assertEq(decl.name, 'greet');
});

test('MacroParam has kind MacroParam and correct paramKind', () => {
  const ast = parse(tokenize('m := macro(a : expr, b : ident, c : block) { };'));
  assertEq(ast.body[0].params[0].kind, 'MacroParam', 'node kind discriminant');
  assertEq(ast.body[0].params[0].paramKind, 'expr',   'param kind');
  assertEq(ast.body[0].params[1].paramKind, 'ident',  'param kind');
  assertEq(ast.body[0].params[2].paramKind, 'block',  'param kind');
});

test('MacroParam pack<expr> has correct paramKind', () => {
  const ast = parse(tokenize('m := macro(vals : pack<expr>) { };'));
  assertEq(ast.body[0].params[0].kind,      'MacroParam',  'node kind');
  assertEq(ast.body[0].params[0].paramKind, 'pack<expr>',  'param kind');
});

test('all MacroParams have kind MacroParam after parser', () => {
  const kinds = ['expr', 'ident', 'block', 'type', 'any'];
  for (const k of kinds) {
    const ast   = parse(tokenize(`m := macro(p : ${k}) { };`));
    const param = ast.body[0].params[0];
    assertEq(param.kind,      'MacroParam', `kind should be MacroParam for paramKind=${k}`);
    assertEq(param.paramKind, k,            `paramKind should be ${k}`);
  }
});

test('full compile preserves MacroDecl in ast.body', () => {
  const { ast } = compile(`
    for_each := macro(arr : expr, elem : ident, body : block) {
      $i : mut u32 = 0;
      while ($i < @arr.size) { @elem := @arr.[$i]; @body; $i = $i + 1; }
    };
    main := fn() i32 {
      a : array<i32, 3> = {1, 2, 3};
      total : mut i32 = 0;
      for_each!(a, v) { total = total + v; };
      return total;
    };
  `);
  assert(ast.body.some(d => d.kind === 'MacroDecl'), 'MacroDecl should be in ast after compile');
  assert(ast.body.some(d => d.kind === 'FuncDecl'),  'FuncDecl should also be in ast');
});
