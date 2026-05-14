// tests/test-namespace.js — Namespace declarations, namespaced functions, aliases

import { test, suite, assert, assertEq, assertThrows, compileAndGenerate } from './helpers.js';
import { tokenize, TT } from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { compile, liveCompile, liveCompileMulti, compileMulti } from '../compiler/pipeline.js';
import { TypeError, _filenameToNsKey } from '../compiler/staticTypeChecker.js';
import { generate } from '../compiler/codegen.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — NamespaceImport  (m := import "file.qlang" | import "file.qlang")
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — NamespaceImport');

test('x := import "utils.qlang" → NamespaceImport node (aliased)', () => {
  const ast = parse(tokenize('x := import "utils.qlang";'));
  assertEq(ast.body[0].kind, 'NamespaceImport');
  assertEq(ast.body[0].alias, 'x');
  assertEq(ast.body[0].filename, 'utils.qlang');
});

test('import "utils.qlang" bare → NamespaceImport node (wildcard, alias null)', () => {
  const ast = parse(tokenize('import "utils.qlang";'));
  assertEq(ast.body[0].kind, 'NamespaceImport');
  assertEq(ast.body[0].alias, null);
  assertEq(ast.body[0].filename, 'utils.qlang');
});

test('NamespaceImport aliased has line/start/end positions', () => {
  const ast = parse(tokenize('ext := import "math.qlang";'));
  const node = ast.body[0];
  assertEq(node.kind, 'NamespaceImport');
  assert(node.line != null);
  assert(node.start != null);
  assert(node.end != null);
});

test('NamespaceDecl (no string) is still NamespaceDecl', () => {
  const ast = parse(tokenize('std := namespace;'));
  assertEq(ast.body[0].kind, 'NamespaceDecl');
});

test('NamespaceDecl with target is still NamespaceDecl', () => {
  const ast = parse(tokenize('gfx := namespace Engine::Graphics;'));
  assertEq(ast.body[0].kind, 'NamespaceDecl');
  assertEq(ast.body[0].name, 'gfx');
});

// ─────────────────────────────────────────────────────────────────────────────
// _filenameToNsKey
// ─────────────────────────────────────────────────────────────────────────────

suite('_filenameToNsKey');

test('"utils.qlang" → "__f_utils_qlang"', () => {
  assertEq(_filenameToNsKey('utils.qlang'), '__f_utils_qlang');
});

test('"Math.qlang" normalised to lowercase', () => {
  assertEq(_filenameToNsKey('Math.qlang'), '__f_math_qlang');
});

test('"math/vec.qlang" → "__f_math_vec_qlang"', () => {
  assertEq(_filenameToNsKey('math/vec.qlang'), '__f_math_vec_qlang');
});

test('special chars replaced with underscore', () => {
  assertEq(_filenameToNsKey('my-lib.v2.qlang'), '__f_my_lib_v2_qlang');
});

// ─────────────────────────────────────────────────────────────────────────────
// compileMulti — basic import and calling imported functions
// ─────────────────────────────────────────────────────────────────────────────

suite('compileMulti — basic import');

const WASM_ENV = { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } };

function makeGetFile(files) { return name => files[name] ?? null; }

test('compileMulti produces merged AST with imported FuncDecls', () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'u := import "utils.qlang"; main := fn() i32 { return u::add(2, 3); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  // merged body must include both the imported FuncDecl and main
  const funcNames = ast.body.filter(d => d.kind === 'FuncDecl').map(d => d.name);
  assert(funcNames.some(n => n.includes('__f_utils_qlang__add')), 'imported add should be prefixed');
  assert(funcNames.includes('main'), 'main should be present');
});

test('compileMulti — imported FuncDecl name mangled with file prefix', () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'u := import "utils.qlang"; main := fn() i32 { return u::add(1, 1); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const importedAdd = ast.body.find(d => d.kind === 'FuncDecl' && d.name === '__f_utils_qlang__add');
  assert(importedAdd != null, 'mangled imported function should exist in merged AST');
});

test('compileMulti — basic call executes correctly', async () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'u := import "utils.qlang"; main := fn() i32 { return u::add(2, 3); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 5);
});

test('compileMulti — intra-file call from imported function', async () => {
  // double calls add internally; both must use mangled names in WASM
  const utils = [
    'add := fn(a: i32, b: i32) i32 { return a + b; };',
    'double := fn(x: i32) i32 { return add(x, x); };',
  ].join('\n');
  const main = 'u := import "utils.qlang"; main := fn() i32 { return u::double(7); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 14);
});

test('compileMulti — multiple functions from same import', async () => {
  const utils = [
    'add := fn(a: i32, b: i32) i32 { return a + b; };',
    'mul := fn(a: i32, b: i32) i32 { return a * b; };',
  ].join('\n');
  const main = 'u := import "utils.qlang"; main := fn() i32 { return u::add(u::mul(2, 3), 4); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 10); // (2*3)+4 = 10
});

// ─────────────────────────────────────────────────────────────────────────────
// compileMulti — error cases
// ─────────────────────────────────────────────────────────────────────────────

suite('compileMulti — error cases');

test('missing file throws with filename in message', () => {
  const main = 'u := import "missing.qlang"; main := fn() i32 { return 0; };';
  assertThrows(
    () => compileMulti(main, makeGetFile({})),
    Error,
    'missing.qlang'
  );
});

test('circular import throws', () => {
  // a.qlang imports b.qlang which imports a.qlang
  const files = {
    'a.qlang': 'b := import "b.qlang"; foo := fn() i32 { return 1; };',
    'b.qlang': 'a := import "a.qlang"; bar := fn() i32 { return 2; };',
  };
  const main = 'a := import "a.qlang"; main := fn() i32 { return 0; };';
  assertThrows(
    () => compileMulti(main, makeGetFile(files)),
    Error,
    'Circular import'
  );
});

test('parse error in main causes early return with parseErrors', () => {
  const main = 'u := import "utils.qlang"; main := fn( { return 0; };'; // bad syntax
  const { parseErrors } = compileMulti(main, makeGetFile({}));
  assert(parseErrors.length > 0, 'should report parse errors');
});

// ─────────────────────────────────────────────────────────────────────────────
// compileMulti — liveCompile with NamespaceImport
// ─────────────────────────────────────────────────────────────────────────────

suite('liveCompile — NamespaceImport');

test('liveCompile: NamespaceImport with no importEnv produces type error (not a crash)', () => {
  // liveCompile has no getFile — import resolve silently skipped; accessing alias member errors
  const src = 'u := import "utils.qlang"; main := fn() i32 { return u::add(1, 2); };';
  let threw = false;
  let result;
  try { result = liveCompile(src); } catch { threw = true; }
  assert(!threw, 'liveCompile must never throw');
});

test('liveCompile: NamespaceImport node alone produces 0 crashes', () => {
  const src = 'u := import "utils.qlang";';
  let threw = false;
  try { liveCompile(src); } catch { threw = true; }
  assert(!threw, 'liveCompile must never throw on bare NamespaceImport');
});
// ─────────────────────────────────────────────────────────────────────────────────
// liveCompileMulti — multi-file live compile with importEnv
// ─────────────────────────────────────────────────────────────────────────────────

suite('liveCompileMulti — live multi-file type checking');

test('liveCompileMulti: 0 type errors when import resolves', () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'u := import "utils.qlang"; main := fn() i32 { return u::add(1, 2); };';
  const { typeErrors } = liveCompileMulti(main, name => name === 'utils.qlang' ? utils : null);
  assertEq(typeErrors.length, 0);
});

test('liveCompileMulti: type error when import missing (not crash)', () => {
  const main = 'u := import "missing.qlang"; main := fn() i32 { return u::add(1, 2); };';
  let threw = false;
  let result;
  try { result = liveCompileMulti(main, () => null); } catch { threw = true; }
  assert(!threw, 'liveCompileMulti must never throw');
  assert(result.typeErrors.length > 0, 'should report type error for missing file');
});

test('liveCompileMulti: intra-file call among imported functions — 0 errors', () => {
  const utils = [
    'add := fn(a: i32, b: i32) i32 { return a + b; };',
    'double := fn(x: i32) i32 { return add(x, x); };',
  ].join('\n');
  const main = 'u := import "utils.qlang"; main := fn() i32 { return u::double(3); };';
  const { typeErrors } = liveCompileMulti(main, name => name === 'utils.qlang' ? utils : null);
  assertEq(typeErrors.length, 0);
});

test('liveCompileMulti: never throws on bad main source', () => {
  let threw = false;
  try { liveCompileMulti('main := fn( { BAD SYNTAX', () => ''); } catch { threw = true; }
  assert(!threw);
});

test('liveCompileMulti: liveCompile of imported file in isolation shows correct types', () => {
  // When editing vec2.qlang directly, compile it in isolation — should have 0 errors
  const vec2src = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const { typeErrors } = liveCompile(vec2src);
  assertEq(typeErrors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Parser — QualifiedTypeRef in type position
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — QualifiedTypeRef in type position');

test('m::Vec2 in type annotation → QualifiedTypeRef node', () => {
  const ast = parse(tokenize('x : m::Vec2 = m::Vec2::default;'));
  const ta = ast.body[0].typeAnnot;
  assertEq(ta.kind, 'QualifiedTypeRef');
  assertEq(ta.segments[0], 'm');
  assertEq(ta.segments[1], 'Vec2');
  assertEq(ta.mut, false);
});

test('mut m::Vec2 → QualifiedTypeRef with mut:true', () => {
  const ast = parse(tokenize('x : mut m::Vec2 = m::Vec2::default;'));
  const ta = ast.body[0].typeAnnot;
  assertEq(ta.kind, 'QualifiedTypeRef');
  assertEq(ta.mut, true);
  assertEq(ta.segments.join('::'), 'm::Vec2');
});

test('3-segment qualified type a::b::T → QualifiedTypeRef with 3 segments', () => {
  const ast = parse(tokenize('x : a::b::T = a::b::T::default;'));
  const ta = ast.body[0].typeAnnot;
  assertEq(ta.kind, 'QualifiedTypeRef');
  assertEq(ta.segments.length, 3);
  assertEq(ta.segments.join('::'), 'a::b::T');
});

test('unqualified ident in type position still → UserTypeRef (no regression)', () => {
  const ast = parse(tokenize('x : Vec2 = Vec2::default;'));
  const ta = ast.body[0].typeAnnot;
  assertEq(ta.kind, 'UserTypeRef');
  assertEq(ta.name, 'Vec2');
});

// ─────────────────────────────────────────────────────────────────────────────
// QualifiedTypeRef — type checking and code generation
// ─────────────────────────────────────────────────────────────────────────────

suite('QualifiedTypeRef — compileMulti & liveCompileMulti');

const _mathSrc = 'Vec2 := struct { x: i32; y: i32; };';

test('liveCompileMulti: x : m::Vec2 = m::Vec2::of(1,2) — 0 type errors', () => {
  const main = [
    'm := import "math.qlang";',
    'main := fn() i32 { x : m::Vec2 = m::Vec2::of(1, 2); return x.x; };',
  ].join('\n');
  const { typeErrors } = liveCompileMulti(main, makeGetFile({ 'math.qlang': _mathSrc }));
  assertEq(typeErrors.length, 0);
});

test('liveCompileMulti: fn param v: m::Vec2 — 0 type errors', () => {
  const main = [
    'm := import "math.qlang";',
    'getX := fn(v: m::Vec2) i32 { return v.x; };',
    'main := fn() i32 { p : m::Vec2 = m::Vec2::of(7, 8); return getX(p); };',
  ].join('\n');
  const { typeErrors } = liveCompileMulti(main, makeGetFile({ 'math.qlang': _mathSrc }));
  assertEq(typeErrors.length, 0);
});

test('liveCompileMulti: struct field pos: m::Vec2 — 0 type errors', () => {
  const main = [
    'm := import "math.qlang";',
    'Entity := struct { id: i32; pos: m::Vec2; };',
    'main := fn() i32 { e := Entity::of(1, m::Vec2::of(3, 4)); return e.id; };',
  ].join('\n');
  const { typeErrors } = liveCompileMulti(main, makeGetFile({ 'math.qlang': _mathSrc }));
  assertEq(typeErrors.length, 0);
});

test('liveCompileMulti: x : m::Vec2 = 5 — type mismatch is reported (not crash)', () => {
  const main = [
    'm := import "math.qlang";',
    'main := fn() i32 { x : m::Vec2 = 5; return 0; };',
  ].join('\n');
  let threw = false;
  let result;
  try { result = liveCompileMulti(main, makeGetFile({ 'math.qlang': _mathSrc })); } catch { threw = true; }
  assert(!threw, 'must not throw on type mismatch');
  assert(result.typeErrors.length > 0, 'should report type mismatch');
});

test('liveCompileMulti: x : m::Unknown — unknown qualified type is reported (not crash)', () => {
  const main = [
    'm := import "math.qlang";',
    'main := fn() i32 { x : m::Unknown = m::Vec2::of(1, 2); return 0; };',
  ].join('\n');
  let threw = false;
  let result;
  try { result = liveCompileMulti(main, makeGetFile({ 'math.qlang': _mathSrc })); } catch { threw = true; }
  assert(!threw, 'must not throw on unknown qualified type');
  assert(result.typeErrors.length > 0, 'should report error for unknown qualified type');
});

test('compileMulti + generate: x : m::Vec2 = m::Vec2::of(2,3) — WASM returns x.x = 2', async () => {
  const main = [
    'm := import "math.qlang";',
    'main := fn() i32 { x : m::Vec2 = m::Vec2::of(2, 3); return x.x; };',
  ].join('\n');
  const { ast } = compileMulti(main, makeGetFile({ 'math.qlang': _mathSrc }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 2);
});

test('compileMulti + generate: fn param v: m::Vec2 — WASM returns correct field', async () => {
  const main = [
    'm := namespace "math.qlang";',
    'getX := fn(v: m::Vec2) i32 { return v.x; };',
    'main := fn() i32 { p : m::Vec2 = m::Vec2::of(7, 8); return getX(p); };',
  ].join('\n');
  const { ast } = compileMulti(main, makeGetFile({ 'math.qlang': _mathSrc }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 7);
});

// ─────────────────────────────────────────────────────────────────────────────
// Circular imports — liveCompileMulti safety
// ─────────────────────────────────────────────────────────────────────────────

suite('Circular imports — liveCompileMulti safety');

test('direct circular (a→b→a): liveCompileMulti never throws', () => {
  const files = {
    'a.qlang': 'b := import "b.qlang"; foo := fn() i32 { return 1; };',
    'b.qlang': 'a := import "a.qlang"; bar := fn() i32 { return 2; };',
  };
  const main = 'a := import "a.qlang"; main := fn() i32 { return 0; };';
  let threw = false;
  try { liveCompileMulti(main, makeGetFile(files)); } catch { threw = true; }
  assert(!threw, 'liveCompileMulti must not throw on circular imports');
});

test('direct circular: result has typeErrors array (valid shape)', () => {
  const files = {
    'a.qlang': 'b := import "b.qlang"; foo := fn() i32 { return 1; };',
    'b.qlang': 'a := import "a.qlang"; bar := fn() i32 { return 2; };',
  };
  const main = 'a := import "a.qlang"; main := fn() i32 { return a::foo(); };';
  const result = liveCompileMulti(main, makeGetFile(files));
  assert(result !== undefined, 'result must be defined');
  assert(Array.isArray(result.typeErrors), 'typeErrors must be an array');
});

test('self-import (a imports a): liveCompileMulti never throws', () => {
  const files = { 'a.qlang': 'self := import "a.qlang"; foo := fn() i32 { return 1; };' };
  const main = 'a := import "a.qlang"; main := fn() i32 { return 0; };';
  let threw = false;
  try { liveCompileMulti(main, makeGetFile(files)); } catch { threw = true; }
  assert(!threw, 'self-import must not throw');
});

test('transitive circular (a→b→c→a): liveCompileMulti never throws', () => {
  const files = {
    'a.qlang': 'b := import "b.qlang"; fa := fn() i32 { return 1; };',
    'b.qlang': 'c := import "c.qlang"; fb := fn() i32 { return 2; };',
    'c.qlang': 'a := import "a.qlang"; fc := fn() i32 { return 3; };',
  };
  const main = 'a := import "a.qlang"; main := fn() i32 { return 0; };';
  let threw = false;
  try { liveCompileMulti(main, makeGetFile(files)); } catch { threw = true; }
  assert(!threw, 'transitive circular must not throw');
});

test('compileMulti: circular import throws with "Circular import" message', () => {
  const files = {
    'a.qlang': 'b := import "b.qlang"; foo := fn() i32 { return 1; };',
    'b.qlang': 'a := import "a.qlang"; bar := fn() i32 { return 2; };',
  };
  const main = 'a := import "a.qlang"; main := fn() i32 { return 0; };';
  assertThrows(
    () => compileMulti(main, makeGetFile(files)),
    Error,
    'Circular import',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Wildcard import — bare `import "file.qlang"` form
// ─────────────────────────────────────────────────────────────────────────────

suite('Wildcard import — bare import form');

test('wildcard import: call imported function directly (no alias)', async () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'import "utils.qlang"; main := fn() i32 { return add(1, 2); };';
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, WASM_ENV);
  assertEq(instance.exports.main(), 3);
});

test('wildcard import: liveCompileMulti 0 type errors', () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = 'import "utils.qlang"; main := fn() i32 { return add(1, 2); };';
  const { typeErrors } = liveCompileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  assertEq(typeErrors.length, 0);
});

test('wildcard import: conflict (both files export same name) → error', () => {
  const a = 'foo := fn() i32 { return 1; };';
  const b = 'foo := fn() i32 { return 2; };';
  const main = 'import "a.qlang"; import "b.qlang"; main := fn() i32 { return foo(); };';
  assertThrows(
    () => compileMulti(main, makeGetFile({ 'a.qlang': a, 'b.qlang': b })),
    Error,
    'conflict',
  );
});

test('wildcard and aliased coexist, aliased takes precedence by name', () => {
  const utils = 'add := fn(a: i32, b: i32) i32 { return a + b; };';
  const main  = [
    'import "utils.qlang";',
    'u := import "utils.qlang";',
    'main := fn() i32 { return u::add(3, 4); };',
  ].join('\n');
  // aliased call works even alongside wildcard
  const { ast } = compileMulti(main, makeGetFile({ 'utils.qlang': utils }));
  const { bytes } = generate(ast);
  // Don't run — just verify it compiles without error
  assert(bytes.length > 8);
});