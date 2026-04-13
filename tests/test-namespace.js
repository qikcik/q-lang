// tests/test-namespace.js — Namespace declarations, namespaced functions, aliases

import { test, suite, assert, assertEq, assertThrows, compileAndGenerate } from './helpers.js';
import { tokenize, TT } from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { compile, liveCompile } from '../compiler/pipeline.js';
import { TypeError } from '../compiler/staticTypeChecker.js';

// ─────────────────────────────────────────────────────────────────────────────
// LEXER — namespace keyword
// ─────────────────────────────────────────────────────────────────────────────

suite('Lexer — namespace keyword');

test('namespace is KEYWORD', () => {
  const toks = tokenize('namespace');
  assertEq(toks[0].type, TT.KEYWORD);
  assertEq(toks[0].value, 'namespace');
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — NamespaceDecl
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — NamespaceDecl');

test('empty namespace: std := namespace;', () => {
  const ast = parse(tokenize('std := namespace;'));
  assertEq(ast.body[0].kind, 'NamespaceDecl');
  assertEq(ast.body[0].name, 'std');
  assertEq(ast.body[0].target, null);
});

test('namespace alias: gfx := namespace Engine::Graphics;', () => {
  const ast = parse(tokenize('gfx := namespace Engine::Graphics;'));
  assertEq(ast.body[0].kind, 'NamespaceDecl');
  assertEq(ast.body[0].name, 'gfx');
  assertEq(ast.body[0].target[0], 'Engine');
  assertEq(ast.body[0].target[1], 'Graphics');
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — NamespacedDecl
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — NamespacedDecl');

test('std::foo := fn() i32 { return 42; };', () => {
  const ast = parse(tokenize('std::foo := fn() i32 { return 42; };'));
  assertEq(ast.body[0].kind, 'NamespacedDecl');
  assertEq(ast.body[0].segments[0], 'std');
  assertEq(ast.body[0].segments[1], 'foo');
  assertEq(ast.body[0].inner.kind, 'FuncDecl');
  assertEq(ast.body[0].inner.name, 'foo');
});

test('A::B::C := fn() void {};', () => {
  const ast = parse(tokenize('A::B::C := fn() void {};'));
  assertEq(ast.body[0].kind, 'NamespacedDecl');
  assertEq(ast.body[0].segments.length, 3);
  assertEq(ast.body[0].segments[2], 'C');
  assertEq(ast.body[0].inner.kind, 'FuncDecl');
});

test('std::BAR := 42;', () => {
  const ast = parse(tokenize('std::BAR := 42;'));
  assertEq(ast.body[0].kind, 'NamespacedDecl');
  assertEq(ast.body[0].segments[0], 'std');
  assertEq(ast.body[0].segments[1], 'BAR');
  assertEq(ast.body[0].inner.kind, 'VarDecl');
  assertEq(ast.body[0].inner.value.value, 42);
});

test('std::count : mut i32 = 0;', () => {
  const ast = parse(tokenize('std::count : mut i32 = 0;'));
  assertEq(ast.body[0].kind, 'NamespacedDecl');
  assertEq(ast.body[0].inner.kind, 'VarDecl');
  assertEq(ast.body[0].inner.typeAnnot.kind, 'UserTypeRef');
  assertEq(ast.body[0].inner.typeAnnot.mut, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPECHECKER — NamespaceDecl + NamespacedDecl
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — Namespace');

test('empty namespace compiles', () => {
  const { ast } = compile('std := namespace; main := fn() i32 { return 0; };');
  assert(ast !== null);
});

test('namespace function: std::foo registered and callable', () => {
  const { ast } = compile(
    'std := namespace; std::foo := fn() i32 { return 42; }; main := fn() i32 { return std::foo(); };'
  );
  // std::foo is mangled to std__foo
  const nsFunc = ast.body.find(d => d.kind === 'NamespacedDecl');
  assertEq(nsFunc.inner.name, 'std__foo');
  assertEq(nsFunc.inner._type.returnType.name, 'i32');
});

test('namespace function args validated', () => {
  assertThrows(
    () => compile('std := namespace; std::add := fn(a: i32, b: i32) i32 { return a; }; main := fn() i32 { return std::add(1); };'),
    TypeError,
    'expects 2 argument(s), got 1',
  );
});

test('namespace function without prior namespace decl auto-creates', () => {
  // NamespacedDecl auto-creates namespace via defineQualified
  const { ast } = compile(
    'math::square := fn(x: i32) i32 { return x; }; main := fn() i32 { return math::square(5); };'
  );
  const nsFunc = ast.body.find(d => d.kind === 'NamespacedDecl');
  assertEq(nsFunc.inner.name, 'math__square');
});

test('struct auto-namespace still works: Player::of', () => {
  const { ast } = compile(
    'Player := struct { hp: i32; }; main := fn() i32 { p := Player::of(10); return p.hp; };'
  );
  const main = ast.body.find(d => d.kind === 'FuncDecl' && d.name === 'main');
  assertEq(main._type.returnType.name, 'i32');
});

test('namespace alias resolves', () => {
  const { ast } = compile(
    'math := namespace; math::double := fn(x: i32) i32 { return x; }; m := namespace math; main := fn() i32 { return m::double(5); };'
  );
  assert(ast !== null);
});

// ─────────────────────────────────────────────────────────────────────────────
// CODEGEN — NamespacedDecl
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — Namespace');

test('namespace function compiles to WASM', () => {
  const bytes = compileAndGenerate(
    'std := namespace; std::foo := fn() i32 { return 42; }; main := fn() i32 { return std::foo(); };'
  );
  assert(bytes.length > 8);
});

test('namespace function with args compiles', () => {
  const bytes = compileAndGenerate(
    'math::add := fn(a: i32, b: i32) i32 { return a; }; main := fn() i32 { return math::add(1, 2); };'
  );
  assert(bytes.length > 8);
});

test('struct namespace + custom function coexist', () => {
  const bytes = compileAndGenerate(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'main := fn() i32 { v := Vec2::of(3, 7); return v.x; };'
  );
  assert(bytes.length > 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVECOMPILE — namespace resilience
// ─────────────────────────────────────────────────────────────────────────────

suite('liveCompile — Namespace');

test('liveCompile: empty namespace + namespaced fn → 0 type errors', () => {
  const { typeErrors } = liveCompile(
    'std := namespace; std::foo := fn() i32 { return 42; }; main := fn() i32 { return std::foo(); };'
  );
  assertEq(typeErrors.length, 0);
});

test('liveCompile: namespace alias → 0 type errors', () => {
  const { typeErrors } = liveCompile(
    'math := namespace; math::double := fn(x: i32) i32 { return x; }; m := namespace math; main := fn() i32 { return m::double(5); };'
  );
  assertEq(typeErrors.length, 0);
});

test('liveCompile: auto-created namespace (no prior decl) → 0 type errors', () => {
  const { typeErrors } = liveCompile(
    'math::square := fn(x: i32) i32 { return x; }; main := fn() i32 { return math::square(5); };'
  );
  assertEq(typeErrors.length, 0);
});

test('liveCompile: struct auto-namespace (Vec2::of) → 0 type errors', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { v := Vec2::of(3, 7); return v.x; };'
  );
  assertEq(typeErrors.length, 0);
});

test('liveCompile: namespace error is collected, does not throw', () => {
  const { typeErrors } = liveCompile(
    'main := fn() i32 { return unknown_ns::func(); };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors[0].message.includes('Undefined namespace'));
});

test('liveCompile: default snippet has 0 type errors', () => {
  const src = [
    'Vec2 := struct { x: i32; y: i32; };',
    'Counter := struct { id: i32; n: mut i32 = 10; };',
    'fibonacci := fn(n: i32) i32 { if (n <= 1) { return n; } return fibonacci(n - 1) + fibonacci(n - 2); };',
    'main := fn() i32 {',
    '  v : Vec2 = Vec2::of(3, 7);',
    '  c : Counter = Counter::default;',
    '  r1 := fibonacci(10);',
    '  x := 42; p := &x; r3 := p.*;',
    '  return v.x + c.n + r1 + r3;',
    '};',
  ].join('\n');
  const { typeErrors } = liveCompile(src);
  assertEq(typeErrors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE — struct param / return in namespace functions
// ─────────────────────────────────────────────────────────────────────────────

suite('Namespace — struct param/return resolution');

test('namespace fn with struct param compiles', () => {
  const bytes = compileAndGenerate(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'Vec2::len_sq := fn(v: Vec2) i32 { return v.x * v.x + v.y * v.y; }; ' +
    'main := fn() i32 { v : Vec2 = Vec2::of(3, 7); return Vec2::len_sq(v); };'
  );
  assert(bytes.length > 8);
});

test('namespace fn with struct param — liveCompile 0 errors', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'Vec2::len_sq := fn(v: Vec2) i32 { return v.x * v.x + v.y * v.y; }; ' +
    'main := fn() i32 { v : Vec2 = Vec2::of(3, 7); return Vec2::len_sq(v); };'
  );
  assertEq(typeErrors.length, 0);
});

test('namespace fn with struct return type — liveCompile 0 errors', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'Vec2::zero := fn() Vec2 { return Vec2::default; }; ' +
    'main := fn() i32 { v : Vec2 = Vec2::zero(); return v.x; };'
  );
  assertEq(typeErrors.length, 0);
});

test('namespace fn: struct param from separate namespace', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'math := namespace; ' +
    'math::dot := fn(a: Vec2, b: Vec2) i32 { return a.x * b.x + a.y * b.y; }; ' +
    'main := fn() i32 { a : Vec2 = Vec2::of(1, 2); b : Vec2 = Vec2::of(3, 4); return math::dot(a, b); };'
  );
  assertEq(typeErrors.length, 0);
});

test('alias call with struct param — liveCompile 0 errors', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'Vec2::sum := fn(v: Vec2) i32 { return v.x + v.y; }; ' +
    'v2 := namespace Vec2; ' +
    'main := fn() i32 { p : Vec2 = Vec2::of(3, 7); return v2::sum(p); };'
  );
  assertEq(typeErrors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE — error detection
// ─────────────────────────────────────────────────────────────────────────────

suite('Namespace — error detection');

test('undefined namespace in call → error collected', () => {
  const { typeErrors } = liveCompile(
    'main := fn() i32 { return nope::func(); };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors.some(e => e.message.includes('Undefined namespace')));
});

test('undefined function in namespace → error collected', () => {
  const { typeErrors } = liveCompile(
    'math := namespace; main := fn() i32 { return math::nonexistent(); };'
  );
  assert(typeErrors.length > 0);
});

test('wrong arg count to namespace fn → error collected', () => {
  const { typeErrors } = liveCompile(
    'math := namespace; math::add := fn(a: i32, b: i32) i32 { return a + b; }; ' +
    'main := fn() i32 { return math::add(1); };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors.some(e => e.message.includes('expects 2')));
});

test('wrong arg type to namespace fn → error collected', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'math := namespace; math::square := fn(x: i32) i32 { return x * x; }; ' +
    'main := fn() i32 { v : Vec2 = Vec2::of(1, 2); return math::square(v); };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors.some(e => e.message.includes('not assignable')));
});

test('struct param type mismatch in namespace fn → error collected', () => {
  const { typeErrors } = liveCompile(
    'Vec2 := struct { x: i32; y: i32; }; ' +
    'Vec3 := struct { x: i32; y: i32; z: i32; }; ' +
    'Vec2::len_sq := fn(v: Vec2) i32 { return v.x; }; ' +
    'main := fn() i32 { w : Vec3 = Vec3::of(1, 2, 3); return Vec2::len_sq(w); };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors.some(e => e.message.includes('not assignable')));
});

test('namespace fn called without args when params expected → error', () => {
  const { typeErrors } = liveCompile(
    'math := namespace; math::inc := fn(x: i32) i32 { return x; }; ' +
    'main := fn() i32 { return math::inc; };'
  );
  assert(typeErrors.length > 0);
  assert(typeErrors.some(e => e.message.includes('expects 1')));
});

// ─────────────────────────────────────────────────────────────────────────────
// HOVER — namespace + struct + QualifiedName hints
// ─────────────────────────────────────────────────────────────────────────────

import { buildHoverData } from '../ide/hover.js';

suite('Hover — Namespace integration');

test('hover on NamespaceDecl shows namespace info', () => {
  const src = 'std := namespace;';
  const { ast, tokens } = compile(src + ' main := fn() i32 { return 0; };');
  const hoverData = buildHoverData(tokens, ast);
  const nsHover = hoverData.find(h => h.label.includes('std') && h.label.includes('namespace'));
  assert(nsHover != null, 'should have hover entry for namespace decl');
  assert(nsHover.detail.includes('namespace'), 'detail should mention namespace');
});

test('hover on NamespacedDecl shows qualified name', () => {
  const src = 'std := namespace; std::foo := fn() i32 { return 42; }; main := fn() i32 { return std::foo(); };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const nsFunc = hoverData.find(h => h.label === 'std::foo');
  assert(nsFunc != null, 'should have hover entry for namespaced decl');
});

test('hover on QualifiedName call shows return type', () => {
  const src = 'std := namespace; std::foo := fn() i32 { return 42; }; main := fn() i32 { return std::foo(); };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  // QualifiedName hover should show the return type (i32)
  const qn = hoverData.find(h => h.label === 'std::foo' && h.detail.includes('i32'));
  assert(qn != null, 'should have hover for QualifiedName with type');
});

test('hover on struct constructor (Vec2::of) shows struct type', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { v := Vec2::of(3, 7); return v.x; };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const ctor = hoverData.find(h => h.label === 'Vec2::of');
  assert(ctor != null, 'should have hover for Vec2::of');
});

test('hover on struct member access shows field type', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { v := Vec2::of(3, 7); return v.x; };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const member = hoverData.find(h => h.label === '.x' && h.detail.includes('i32'));
  assert(member != null, 'should have hover for .x member with type');
});

test('hover on namespace alias shows alias info', () => {
  const src = 'math := namespace; math::double := fn(x: i32) i32 { return x; }; m := namespace math; main := fn() i32 { return m::double(5); };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const alias = hoverData.find(h => h.label.includes('m') && h.detail.includes('alias'));
  assert(alias != null, 'should have hover for namespace alias');
});

test('hover on StructDecl shows fields and byte size', () => {
  const src = 'Player := struct { hp: mut i32; name: u8; }; main := fn() i32 { return 0; };';
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const sh = hoverData.find(h => h.label === 'Player : struct');
  assert(sh != null, 'should have struct hover');
  assert(sh.detail.includes('hp'), 'detail should list field hp');
  assert(sh.detail.includes('bytes'), 'detail should mention byte size');
});

// ─────────────────────────────────────────────────────────────────────────────
// HOVER — chained struct member access
// ─────────────────────────────────────────────────────────────────────────────

suite('Hover — Chained struct member access');

test('hover on nested struct field v.pos.x shows i32', () => {
  const src = [
    'Vec2 := struct { x: i32; y: i32; };',
    'Entity := struct { pos: Vec2; hp: i32; };',
    'main := fn() i32 {',
    '  e := Entity::of(Vec2::of(3, 7), 100);',
    '  return e.pos.x;',
    '};',
  ].join('\n');
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  // .x on the nested struct should show i32
  const dotX = hoverData.find(h => h.label === '.x' && h.detail.includes('i32'));
  assert(dotX != null, 'should have hover for .x with i32 type');
});

test('hover on intermediate member .pos shows Vec2', () => {
  const src = [
    'Vec2 := struct { x: i32; y: i32; };',
    'Entity := struct { pos: Vec2; hp: i32; };',
    'main := fn() i32 {',
    '  e := Entity::of(Vec2::of(3, 7), 100);',
    '  return e.pos.x;',
    '};',
  ].join('\n');
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  // .pos should show the struct type Vec2
  const dotPos = hoverData.find(h => h.label === '.pos');
  assert(dotPos != null, 'should have hover for .pos');
  assert(dotPos.detail.includes('Vec2'), '.pos detail should mention Vec2');
});

test('hover on triple-nested chain a.b.c.d resolves correctly', () => {
  const src = [
    'Inner := struct { val: i32; };',
    'Mid := struct { inner: Inner; };',
    'Outer := struct { mid: Mid; };',
    'main := fn() i32 {',
    '  o := Outer::of(Mid::of(Inner::of(42)));',
    '  return o.mid.inner.val;',
    '};',
  ].join('\n');
  const { ast, tokens } = compile(src);
  const hoverData = buildHoverData(tokens, ast);
  const dotVal = hoverData.find(h => h.label === '.val' && h.detail.includes('i32'));
  assert(dotVal != null, 'should have hover for .val with i32 at end of triple chain');
  const dotInner = hoverData.find(h => h.label === '.inner');
  assert(dotInner != null, 'should have hover for .inner');
  assert(dotInner.detail.includes('Inner'), '.inner detail should mention Inner struct');
});
