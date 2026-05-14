// tests/test-codegen.js — CodeGen, pointer, ByteSpan, debugger tests

import { test, suite, assert, assertEq, assertThrows, compileAndGenerate } from './helpers.js';
import { tokenize } from '../compiler/lexer.js';
import { parse } from '../compiler/parser.js';
import { compile } from '../compiler/pipeline.js';
import { generate } from '../compiler/codegen.js';
import { TypeError } from '../compiler/staticTypeChecker.js';

// ─────────────────────────────────────────────────────────────────────────────
// CODE GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — WASM binary validity');

test('output starts with WASM magic+version', () => {
  const bytes = compileAndGenerate('main := fn() i32 { return 0; };');
  assertEq(bytes[0], 0x00);
  assertEq(bytes[1], 0x61);  // 'a'
  assertEq(bytes[2], 0x73);  // 's'
  assertEq(bytes[3], 0x6d);  // 'm'
  assertEq(bytes[4], 0x01);  // version 1
  assertEq(bytes[5], 0x00);
  assertEq(bytes[6], 0x00);
  assertEq(bytes[7], 0x00);
});

test('output is a Uint8Array', () => {
  const bytes = compileAndGenerate('main := fn() i32 { return 42; };');
  assert(bytes instanceof Uint8Array, 'generate().bytes must be Uint8Array');
});

test('two functions produce longer output than one', () => {
  const one = compileAndGenerate('main := fn() i32 { return 1; };');
  const two = compileAndGenerate('f := fn() i32 { return 2; }; main := fn() i32 { return f(); };');
  assert(two.length > one.length, 'two-function program should be longer');
});

test('local function compiles without error', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { double := fn(x: i32) i32 { return x + x; }; return double(5); };'
  );
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('array declaration compiles', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { a : array<i32, 3> = {1,2,3}; return a.[0]; };'
  );
  assert(bytes.length > 8);
});

test('while loop compiles', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { i : mut i32 = 0; while (i < 3) { i = i + 1; } return i; };'
  );
  assert(bytes.length > 8);
});

test('if-else compiles', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { ok := 1 > 0; if (ok) { return 1; } else { return 0; } };'
  );
  assert(bytes.length > 8);
});

test('full demo snippet compiles', () => {
  const src = [
    'add := fn(a: i32, b: i32) i32 { return a + b; };',
    'main := fn() i32 {',
    '  double := fn(x: i32) i32 { return x + x; };',
    '  a : i32 = 10;',
    '  b := 3;',
    '  s := add(a, b);',
    '  d := double(s);',
    '  nums : array<i32, 3> = {1, 2, 3};',
    '  n := nums.size;',
    '  fi := as<i32>(3.7);',
    '  acc : mut i32 = 0;',
    '  idx : mut i32 = 0;',
    '  while (idx < as<i32>(n)) {',
    '    acc = acc + nums.[idx];',
    '    idx = idx + 1;',
    '    if (acc > 4) { break; }',
    '  }',
    '  return add(d, acc);',
    '};',
  ].join('\n');
  const bytes = compileAndGenerate(src);
  assert(bytes.length > 8);
});

suite('CodeGen — array reassignment');

test('array whole-value reassignment compiles', () => {
  const src = [
    'main := fn() i32 {',
    '  nums : mut array<mut i32, 3> = {1, 2, 3};',
    '  nums = {10, 20, 30};',
    '  return nums.[0];',
    '};',
  ].join('\n');
  const bytes = compileAndGenerate(src);
  assert(bytes.length > 8);
});

test('array reassignment to const binding fails', () => {
  assertThrows(() => compile(
    'main := fn() i32 { nums : array<mut i32, 3> = {1,2,3}; nums = {10,20,30}; return 0; };'
  ), TypeError, 'const');
});

// ─────────────────────────────────────────────────────────────────────────────
// POSTFIX DEREFERENCE (.*)
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — postfix dereference .*');

test('p.* parses as UnaryExpr *', () => {
  const ast = parse(tokenize('x := 5; p := &x; v := p.*;'));
  const deref = ast.body[2].value;
  assertEq(deref.kind, 'UnaryExpr');
  assertEq(deref.op,   '*');
  assertEq(deref.operand.name, 'p');
});

test('UnaryExpr .* stores opStart (position of .)', () => {
  const src = 'x := 5; p := &x; v := p.*;';
  const ast = parse(tokenize(src));
  const deref = ast.body[2].value; // UnaryExpr{op:'*'}
  assert(deref.opStart != null, 'opStart must be set');
  assertEq(src[deref.opStart], '.', 'opStart must point to .');
});

test('chained p.*.* parses correctly', () => {
  const ast = parse(tokenize('main := fn() i32 { x := 5; p : ptr<i32> = &x; v := p.*; return v; };'));
  const retVal = ast.body[0].body.body[2];
  assertEq(retVal.kind, 'VarDecl');
  assertEq(retVal.value.kind, 'UnaryExpr');
  assertEq(retVal.value.op, '*');
});

suite('TypeChecker — postfix dereference .*');

test('p.* on ptr<i32> → i32', () => {
  const { ast } = compile('main := fn() i32 { x := 5; p : ptr<i32> = &x; return p.*; };');
  assertEq(ast.body[0].body.body[2].value._type.name, 'i32');
});

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION POINTERS
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — function pointer types');

test('ptr<fn(i32) i32> parses correctly', () => {
  const ast = parse(tokenize('f := fn(n: i32) i32 { return n; }; main := fn() i32 { p : ptr<fn(n: i32) i32> = &f; return p.*(5); };'));
  const pDecl = ast.body[1].body.body[0];
  assertEq(pDecl.typeAnnot.kind, 'PtrType');
  assertEq(pDecl.typeAnnot.inner.kind, 'FuncType');
  assertEq(pDecl.typeAnnot.inner.returnType.name, 'i32');
  assertEq(pDecl.typeAnnot.inner.paramTypes.length, 1);
});

test('fn type without param names parses', () => {
  const ast = parse(tokenize('main := fn() i32 { f := fn(n: i32) i32 { return n; }; p : ptr<fn(i32) i32> = &f; return p.*(3); };'));
  const pDecl = ast.body[0].body.body[1];
  assertEq(pDecl.typeAnnot.inner.kind, 'FuncType');
});

suite('TypeChecker — function pointers');

test('&func gives ptr<fn ...>', () => {
  const { ast } = compile('f := fn(n: i32) i32 { return n; }; main := fn() i32 { p := &f; return 0; };');
  const pDecl = ast.body[1].body.body[0];
  assertEq(pDecl._type.kind, 'PtrType');
  assertEq(pDecl._type.inner.name, '__func__');
});

test('ptr<fn ...> = &func typechecks', () => {
  compile('f := fn(n: i32) i32 { return n; }; main := fn() i32 { p : ptr<fn(n: i32) i32> = &f; return 0; };');
});

test('fptr.*(args) typechecks', () => {
  const { ast } = compile('f := fn(n: i32) i32 { return n + 1; }; main := fn() i32 { p : ptr<fn(n: i32) i32> = &f; return p.*(5); };');
  const ret = ast.body[1].body.body[1];
  assertEq(ret.value._type.name, 'i32');
});

test('fptr.*(wrong arg count) → TypeError', () => {
  assertThrows(() => compile(
    'f := fn(n: i32) i32 { return n; }; main := fn() i32 { p : ptr<fn(n: i32) i32> = &f; return p.*(1, 2); };'
  ), TypeError);
});

suite('CodeGen — function pointers');

test('function pointer call compiles', () => {
  const bytes = compileAndGenerate(
    'f := fn(n: i32) i32 { return n + 1; }; main := fn() i32 { p : ptr<fn(n: i32) i32> = &f; return p.*(5); };'
  );
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('postfix deref compiles for data pointer', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { x := 42; p : ptr<i32> = &x; return p.*; };'
  );
  assert(bytes.length > 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// BYTE SPANS — per-expression granularity
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — ByteSpan per-expression');

test('byteSpans include function-level span', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const result = generate(ast);
  const funcSpans = result.byteSpans.filter(s => s.astNode.kind === 'FuncDecl');
  assert(funcSpans.length >= 1, 'should have at least one function-level span');
});

test('byteSpans include expression-level spans', () => {
  const { ast } = compile('main := fn() i32 { x := 5; return x; };');
  const result = generate(ast);
  // Should have spans for: VarDecl, Literal(5), Identifier(x), ReturnStmt, FuncDecl
  assert(result.byteSpans.length > 1, 'should have multiple spans (got ' + result.byteSpans.length + ')');
  const kinds = new Set(result.byteSpans.map(s => s.astNode.kind));
  assert(kinds.has('FuncDecl'), 'should have FuncDecl span');
});

test('byteSpans for if statement covers sub-expressions', () => {
  const { ast } = compile('main := fn() i32 { if (true) { return 1; } return 0; };');
  const result = generate(ast);
  const ifSpans = result.byteSpans.filter(s => s.astNode.kind === 'IfStmt');
  assert(ifSpans.length >= 1, 'should have IfStmt span');
  const retSpans = result.byteSpans.filter(s => s.astNode.kind === 'ReturnStmt');
  assert(retSpans.length >= 1, 'should have ReturnStmt spans');
});

test('byteSpans for while loop covers body', () => {
  const { ast } = compile('main := fn() i32 { i : mut i32 = 0; while (i < 3) { i = i + 1; } return i; };');
  const result = generate(ast);
  const whileSpans = result.byteSpans.filter(s => s.astNode.kind === 'WhileStmt');
  assert(whileSpans.length >= 1, 'should have WhileStmt span');
});

test('byteSpans have valid ascending byte offsets', () => {
  const { ast } = compile('main := fn() i32 { return 1 + 2; };');
  const result = generate(ast);
  for (const sp of result.byteSpans) {
    assert(sp.byteStart < sp.byteEnd, 'byteStart must be < byteEnd');
    assert(sp.byteStart >= 0, 'byteStart must be >= 0');
    assert(sp.byteEnd <= result.bytes.length, 'byteEnd must be <= bytes.length');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// as<T> — rejects ptr/array targets (scalar-only converter)
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — as<T> rejects non-scalar');

test('as<ptr<T>>(array) allowed — array decays to ptr', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { arr : array<i32, 3> = {1, 2, 3}; p := as<ptr<i32>>(arr); return p.[0]; };'
  );
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('as<f32>(bool) allowed — bool↔float conversion', () => {
  const bytes = compileAndGenerate('main := fn() i32 { b := true; f := as<f32>(b); return as<i32>(f); };');
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('as<bool>(f64) allowed — float→bool conversion', () => {
  const bytes = compileAndGenerate('main := fn() i32 { f := 1.0; b := as<bool>(f); return as<i32>(b); };');
  assert(bytes.length > 8, 'should emit valid WASM');
});

// ─────────────────────────────────────────────────────────────────────────────
// Short-circuit evaluation
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — short-circuit && ||');

test('&& short-circuit compiles', () => {
  const bytes = compileAndGenerate('main := fn() i32 { a := true; b := false; c := a && b; return as<i32>(c); };');
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('|| short-circuit compiles', () => {
  const bytes = compileAndGenerate('main := fn() i32 { a := false; b := true; c := a || b; return as<i32>(c); };');
  assert(bytes.length > 8, 'should emit valid WASM');
});

// ─────────────────────────────────────────────────────────────────────────────
// Debugger — native WASM with debug instrumentation
// ─────────────────────────────────────────────────────────────────────────────

suite('Debugger — debug instrumentation');

test('generate() returns module and sSpans', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const result = generate(ast);
  assert(result.module != null, 'module should exist');
  assert(Array.isArray(result.module), 'module should be an array (S-expr)');
  assertEq(result.module[0], 'module');
  assert(Array.isArray(result.sSpans), 'sSpans should be an array');
});

test('generate({debug:true}) returns stmtMap', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const result = generate(ast, { debug: true });
  assert(result.stmtMap instanceof Map, 'stmtMap should be a Map');
  assert(result.stmtMap.size > 0, 'stmtMap should have entries');
});

test('stmtMap entries point to AST statement nodes', () => {
  const { ast } = compile('main := fn() i32 { x := 5; return x; };');
  const { stmtMap } = generate(ast, { debug: true });
  for (const [id, node] of stmtMap) {
    assert(typeof id === 'number', 'stmtId should be a number');
    assert(node && node.kind, 'mapped node should be an AST node');
    assert(['VarDecl','ReturnStmt','ExprStmt','AssignStmt','IfStmt','WhileStmt','BreakStmt']
      .includes(node.kind), 'mapped node should be a statement kind: ' + node.kind);
  }
});

test('debug-instrumented WASM is valid and can be instantiated', async () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const { bytes } = generate(ast, { debug: true });
  let dbgCalls = 0;
  const importObject = {
    env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 },
    dbg: { brk: () => { dbgCalls++; } },
  };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  const result = instance.exports.main();
  assertEq(result, 42, 'instrumented main() should still return 42');
  assert(dbgCalls > 0, 'dbg.brk should have been called');
});

test('debug brk receives sequential statement IDs', async () => {
  const { ast } = compile('main := fn() i32 { x := 5; y := 10; return x + y; };');
  const { bytes } = generate(ast, { debug: true });
  const ids = [];
  const importObject = {
    env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 },
    dbg: { brk: (id) => { ids.push(id); } },
  };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  instance.exports.main();
  assert(ids.length === 3, 'should have 3 statements (VarDecl, VarDecl, ReturnStmt)');
  assertEq(ids[0], 0);
  assertEq(ids[1], 1);
  assertEq(ids[2], 2);
});

test('throw-to-pause pattern stops execution', async () => {
  const { ast } = compile('main := fn() i32 { x := 5; y := 10; return x + y; };');
  const { bytes } = generate(ast, { debug: true });
  let pauseAt = null;
  const importObject = {
    env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 },
    dbg: { brk: (id) => { if (id === 1) { pauseAt = id; throw new Error('__dbg_pause'); } } },
  };
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  try {
    instance.exports.main();
    assert(false, 'should have thrown');
  } catch (e) {
    assertEq(e.message, '__dbg_pause');
    assertEq(pauseAt, 1, 'should have paused at statement 1');
  }
});

// -- void codegen --------------------------------------------------------------

suite('CodeGen � void');

test('void function compiles', () => {
  const src = 'noop := fn() void { }; main := fn() i32 { noop(); return 42; };';
  const bytes = compileAndGenerate(src);
  assert(bytes.length > 8, 'should emit valid WASM');
});

test('void function with bare return; compiles', () => {
  const src = 'f := fn() void { return; }; main := fn() i32 { f(); return 1; };';
  const bytes = compileAndGenerate(src);
  assert(bytes.length > 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// extern! — runtime import codegen
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — extern! runtime imports');

test('extern! declaration returns wasmImports from generate()', () => {
  const { ast } = compile('p : fn(ptr<u8>, i32) void = extern!("env.write_utf8"); main := fn() void {};');
  const { wasmImports } = generate(ast);
  assert(Array.isArray(wasmImports), 'wasmImports is an array');
  assertEq(wasmImports.length, 1);
  assertEq(wasmImports[0].module,      'env');
  assertEq(wasmImports[0].field,       'write_utf8');
  assertEq(wasmImports[0].mangledName, 'p');
});

test('extern! funcIndex: import at index 0, local func at index 1', () => {
  const src = 'p : fn(ptr<u8>, i32) void = extern!("env.write_utf8"); main := fn() void { buf : array<u8, 1> = {0}; p(&buf, 1); };';
  const { ast } = compile(src);
  const { wasmImports, bytes } = generate(ast);
  assertEq(wasmImports.length, 1, 'exactly 1 import');
  assert(bytes instanceof Uint8Array && bytes.length > 8, 'WASM emitted');
  assert(bytes[0] === 0x00 && bytes[1] === 0x61, 'WASM magic');
});

test('no extern! declarations → wasmImports is empty array', () => {
  const { ast } = compile('main := fn() i32 { return 0; };');
  const { wasmImports } = generate(ast);
  assert(Array.isArray(wasmImports), 'wasmImports is an array');
  assertEq(wasmImports.length, 0);
});

test('extern! WASM can be instantiated with matching host function', async () => {
  const src = 'p : fn(ptr<u8>, i32) void = extern!("env.write_utf8"); main := fn() void { buf : array<u8, 1> = {0}; p(&buf, 1); };';
  const { ast } = compile(src);
  const { bytes, wasmImports } = generate(ast);
  const importObject = {};
  for (const { module, field } of wasmImports) {
    importObject[module] ??= {};
    importObject[module][field] = () => {};
  }
  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  assert(typeof instance.exports.main === 'function', 'main exported');
  instance.exports.main(); // should not throw
});

