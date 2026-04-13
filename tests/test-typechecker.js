// tests/test-typechecker.js — TypeChecker + ScopeBlock tests

import { test, suite, assert, assertEq, assertThrows, compileAndGenerate } from './helpers.js';
import { tokenize } from '../compiler/lexer.js';
import { parse } from '../compiler/parser.js';
import { compile, liveCompile } from '../compiler/pipeline.js';
import { TypeError } from '../compiler/staticTypeChecker.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPE CHECKER
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — inference');

test('integer literal → i32', () => {
  const { ast } = compile('x := 5;');
  assertEq(ast.body[0]._type.name, 'i32');
});

test('float literal → f64', () => {
  const { ast } = compile('x := 3.14;');
  assertEq(ast.body[0]._type.name, 'f64');
});

test('bool literal → bool', () => {
  const { ast } = compile('x := true;');
  assertEq(ast.body[0]._type.name, 'bool');
});

test("char literal 'A' → u8", () => {
  const { ast } = compile("x := 'A';");
  assertEq(ast.body[0]._type.name, 'u8');
});

test("char literal compiles to valid WASM", () => {
  const src = `
    printByte := fn(b: u8) void {
      ch : array<mut u8, 1> = { 0 };
      ch.[0] = b;
      ext::print(&ch, 1);
    };
    main := fn() void { printByte('#'); printByte('\\n'); };
  `;
  const bytes = compileAndGenerate(src);
  assert(bytes instanceof Uint8Array && bytes.length > 8, 'WASM generated');
  assert(bytes[0] === 0x00 && bytes[1] === 0x61, 'WASM magic');
});

test('identity function return type propagated', () => {
  const { ast } = compile('id := fn(x: i32) i32 { return x; };');
  assertEq(ast.body[0]._type.name, '__func__');
  assertEq(ast.body[0]._type.returnType.name, 'i32');
});

test('explicit type annotation applied', () => {
  const { ast } = compile('x : i32 = 5;');
  assertEq(ast.body[0]._type.name, 'i32');
});

test('binary arithmetic → operand type', () => {
  const { ast } = compile('x := 1 + 2;');
  assertEq(ast.body[0]._type.name, 'i32');
});

test('comparison → bool', () => {
  const { ast } = compile('x := 1 < 2;');
  assertEq(ast.body[0]._type.name, 'bool');
});

test('array literal → ArrayType', () => {
  const { ast } = compile('x : array<i32, 3> = {1, 2, 3};');
  assertEq(ast.body[0]._type.kind, 'ArrayType');
  assertEq(ast.body[0]._type.size, 3);
});

test('string literal assigns to [N]u8', () => {
  const { ast } = compile('x : array<u8, 5> = "hello";');
  assertEq(ast.body[0]._type.kind,          'ArrayType');
  assertEq(ast.body[0]._type.elemType.name, 'u8');
});

test('adjacent string concat yields array<u8, N> of combined length', () => {
  const { ast } = compile('x := "ab" "cd";');
  assertEq(ast.body[0]._type.kind,          'ArrayType');
  assertEq(ast.body[0]._type.elemType.name, 'u8');
  assertEq(ast.body[0]._type.size,          4);
});

test('address-of → pointer', () => {
  const { ast } = compile('x := 5; p := &x;');
  assertEq(ast.body[1]._type.kind,       'PtrType');
  assertEq(ast.body[1]._type.inner.name,  'i32');
});

test('arr.size → u32', () => {
  const { ast } = compile('a : array<i32, 4> = {1,2,3,4}; n := a.size;');
  assertEq(ast.body[1]._type.name, 'u32');
});

test('as<f32> → f32', () => {
  const { ast } = compile('x := as<f32>(5);');
  assertEq(ast.body[0]._type.name, 'f32');
});

suite('TypeChecker — local functions');

test('local function defined and callable', () => {
  const { ast } = compile('main := fn() i32 { sq := fn(n: i32) i32 { return n; }; return sq(3); };');
  const block = ast.body[0].body;
  assertEq(block.body[0].kind,       'FuncDecl');
  assertEq(block.body[0]._type.name, '__func__');
});

test('local function type inferrable from call site', () => {
  const { ast } = compile('main := fn() i32 { double := fn(x: i32) i32 { return x + x; }; return double(2); };');
  // call result should be i32
  const retStmt = ast.body[0].body.body[1];
  assertEq(retStmt.value._type.name, 'i32');
});

suite('TypeChecker — errors');

test('undefined identifier → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { return undefined_var; };'), TypeError);
});

test('return type mismatch → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { return true; };'), TypeError);
});

test('bool used in arithmetic → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { x := true; return x + 1; };'), TypeError);
});

test('non-bool in && → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { x := 1 && 2; return 0; };'), TypeError);
});

test('non-bool in if condition → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { if (1) { return 1; } return 0; };'), TypeError);
});

test('break outside loop → TypeError', () => {
  assertThrows(() => compile('main := fn() i32 { break; return 0; };'), TypeError);
});

test('f32 == f32 → TypeError (floating-point equality forbidden)', () => {
  assertThrows(() => compile('main := fn() i32 { x : f32 = 1.0; y : f32 = 1.0; b := x == y; return 0; };'), TypeError);
});

test('f64 != f64 → TypeError (floating-point equality forbidden)', () => {
  assertThrows(() => compile('main := fn() i32 { x := 1.0; b := x != x; return 0; };'), TypeError);
});

// ── TypeChecker — as<T> scalar conversion validation ────────────────────────

test('as<i32>(f64) allowed', () => {
  const { ast } = compile('main := fn() i32 { x : f64 = 1.5; return as<i32>(x); };');
  assertEq(ast.body[0].body.body[1].value.kind, 'AsExpr');
});

test('as<f32>(i64) allowed', () => {
  const { ast } = compile('main := fn() i32 { x : i64 = 5; y : f32 = as<f32>(x); return 0; };');
  assertEq(ast.body[0].body.body[1].value._type.name, 'f32');
});

test('as<bool>(i32) allowed', () => {
  const { ast } = compile('main := fn() i32 { x : i32 = 1; b : bool = as<bool>(x); return 0; };');
  assertEq(ast.body[0].body.body[1].value._type.name, 'bool');
});

test('as<ptr<i32>>(i32) rejected', () => {
  assertThrows(() => compile('main := fn() i32 { return as<ptr<i32>>(5); };'), TypeError, 'pointer');
});

test('as<array<i32,3>>(i32) rejected', () => {
  assertThrows(() => compile('main := fn() i32 { x := as<array<i32,3>>(5); return 0; };'), TypeError, 'array');
});

test('as<i32>(ptr<i32>) rejected', () => {
  assertThrows(() => compile('main := fn() i32 { x := 5; p : ptr<i32> = &x; return as<i32>(p); };'), TypeError, 'pointer');
});

test('call non-function → TypeError', () => {
  assertThrows(() => compile('x := 5; main := fn() i32 { return x(); };'), TypeError);
});

test('wrong arg count → TypeError', () => {
  assertThrows(() => compile('f := fn(a: i32) i32 { return a; }; main := fn() i32 { return f(1, 2); };'), TypeError);
});

test('array size mismatch → TypeError', () => {
  assertThrows(() => compile('x : array<i32, 3> = {1, 2};'), TypeError);
});

suite('TypeChecker — warnings');

test('shadowing is a compile error', () => {
  assertThrows(() => compile('x := 3; x := 5;'), TypeError, 'already declared');
});

// ── ScopeBlock ────────────────────────────────────────────────────────────────

suite('Parser — ScopeBlock');

test('bare block parses as ScopeBlock', () => {
  const ast = parse(tokenize('main := fn() i32 { { } return 0; };'));
  const stmt = ast.body[0].body.body[0];
  assertEq(stmt.kind, 'ScopeBlock');
});

test('ScopeBlock with statements has body', () => {
  const ast = parse(tokenize('main := fn() i32 { { x := 1; } return 0; };'));
  const sb = ast.body[0].body.body[0];
  assertEq(sb.kind, 'ScopeBlock');
  assertEq(sb.body.length, 1);
  assertEq(sb.body[0].kind, 'VarDecl');
});

suite('TypeChecker — ScopeBlock');

test('variable inside ScopeBlock is not visible outside', () => {
  assertThrows(
    () => compile('main := fn() i32 { { x := 1; } return x; };'),
    TypeError,
    "Undefined identifier 'x'",
  );
});

test('ScopeBlock compiles and does not leak scope', () => {
  assert(true === !!compile('main := fn() i32 { { y := 2; } return 0; };'), 'should compile');
});

test('shadowing across ScopeBlock is still illegal', () => {
  assertThrows(
    () => compile('main := fn() i32 { x := 1; { x := 2; } return x; };'),
    TypeError,
    "shadows an outer declaration",
  );
});

suite('CodeGen — ScopeBlock');

test('ScopeBlock executes and mut var visible in same scope', async () => {
  const src = 'main := fn() i32 { r : mut i32 = 0; { r = 42; } return r; };';
  const bytes = compileAndGenerate(src);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 42, 'ScopeBlock should be able to write to outer mut var');
});

test('VarDecl inside ScopeBlock is allocatable', async () => {
  const src = 'main := fn() i32 { { tmp := 7; } return 0; };';
  const bytes = compileAndGenerate(src);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 0);
});

// -- void return type ----------------------------------------------------------

suite('TypeChecker � void');

test('void function type-checks without return', () => {
  const { ast } = compile('f := fn() void { }; main := fn() i32 { f(); return 0; };');
  assert(ast != null, 'compile should succeed');
});

test('void function with bare return;', () => {
  const { ast } = compile('f := fn() void { return; }; main := fn() i32 { f(); return 0; };');
  assert(ast != null, 'compile should succeed');
});

test('void function with value return fails', () => {
  assertThrows(() => compile('f := fn() void { return 42; }; main := fn() i32 { return 0; };'), TypeError, 'Void');
});

test('void return type is marked on FuncDecl', () => {
  const { ast } = compile('f := fn() void { }; main := fn() i32 { f(); return 0; };');
  assertEq(ast.body[0].returnType.name, 'void');
});

test('PackLiteral cannot be assigned to a variable binding', () => {
  // 'pack' is compile-time-only; storing it in a variable is a spec violation.
  assertThrows(
    () => compile('main := fn() i32 { p := [1, 2, 3]; return 0; };'),
    TypeError,
    'pack',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPE ANNOTATION SOURCE POSITIONS (for hover/IDE)
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — type annotation positions');

test('Param with struct type preserves _typeAnnotStart/End', () => {
  const src = 'Point := struct { x: i32, y: i32 };\nmove := fn(p: Point) i32 { return p.x; };';
  const { ast } = compile(src);
  const func = ast.body.find(d => d.kind === 'FuncDecl');
  const param = func.params[0];
  assert(param._typeAnnotStart != null, '_typeAnnotStart exists');
  assert(param._typeAnnotEnd != null, '_typeAnnotEnd exists');
  assertEq(src.slice(param._typeAnnotStart, param._typeAnnotEnd), 'Point');
});

test('VarDecl with struct type preserves _typeAnnotStart/End', () => {
  const src = 'Point := struct { x: i32, y: i32 };\np : Point = Point::of(1, 2);';
  const { ast } = compile(src);
  const varDecl = ast.body.find(d => d.kind === 'VarDecl');
  assert(varDecl._typeAnnotStart != null, '_typeAnnotStart exists');
  assert(varDecl._typeAnnotEnd != null, '_typeAnnotEnd exists');
  assertEq(src.slice(varDecl._typeAnnotStart, varDecl._typeAnnotEnd), 'Point');
});

test('StructField with struct type preserves _typeAnnotStart/End', () => {
  const src = 'Point := struct { x: i32, y: i32 };\nRect := struct { origin: Point, size: i32 };';
  const { ast } = compile(src);
  const rect = ast.body.find(d => d.kind === 'StructDecl' && d.name === 'Rect');
  const originField = rect.fields[0];
  assert(originField._typeAnnotStart != null, '_typeAnnotStart exists');
  assert(originField._typeAnnotEnd != null, '_typeAnnotEnd exists');
  assertEq(src.slice(originField._typeAnnotStart, originField._typeAnnotEnd), 'Point');
});

// ─────────────────────────────────────────────────────────────────────────────
// ext namespace
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — ext namespace');

test('ext::print call type-checks (void return)', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<u8, 5> = "hello"; ext::print(&buf, 5); };'
  );
  assert(ast != null, 'should compile');
});

test('ext::printLn call type-checks (void return)', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<u8, 5> = "hello"; ext::printLn(&buf, 5); };'
  );
  assert(ast != null, 'should compile');
});

test('ext::input call type-checks (u32 return)', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<mut u8, 8> = {0,0,0,0,0,0,0,0}; n := ext::input(&buf, 8); ext::printLn(&buf, n); };'
  );
  assert(ast != null, 'should compile');
});

test('ext::print return type is void', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<u8, 5> = "hello"; ext::print(&buf, 5); };'
  );
  const mainFn = ast.body[0];
  const exprStmt = mainFn.body.body[1];
  assertEq(exprStmt.expr._type?.name, 'void');
});

test('ext::printLn return type is void', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<u8, 5> = "hello"; ext::printLn(&buf, 5); };'
  );
  const mainFn = ast.body[0];
  const exprStmt = mainFn.body.body[1];
  assertEq(exprStmt.expr._type?.name, 'void');
});

test('ext::input return type is u32', () => {
  const { ast } = compile(
    'main := fn() void { buf : array<mut u8, 4> = {0,0,0,0}; n := ext::input(&buf, 4); };'
  );
  const mainFn = ast.body[0];
  const nDecl = mainFn.body.body[1];
  assertEq(nDecl._type.name, 'u32');
});

test('ext namespace declaration by user → TypeError', () => {
  assertThrows(
    () => compile('ext := namespace;'),
    TypeError,
    "'ext' is a reserved namespace",
  );
});

test('ext::foo user-defined function → TypeError', () => {
  assertThrows(
    () => compile('ext := namespace; ext::foo := fn() void {};'),
    TypeError,
    "'ext' is a reserved namespace",
  );
});

test('ext:: namespace function visible in liveCompile', () => {
  const { typeErrors } = liveCompile(
    'main := fn() void { buf : array<u8, 5> = "hello"; ext::print(&buf, 5); };'
  );
  assertEq(typeErrors.length, 0, 'no type errors expected');
});

