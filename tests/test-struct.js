// tests/test-struct.js — StructDecl parser + typechecker + codegen tests (Items 13.1–13.6)

import { tokenize }          from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { compile }           from '../compiler/pipeline.js';
import { generate }          from '../compiler/codegen.js';
import { TypeError }         from '../compiler/staticTypeChecker.js';
import { test, suite, assert, assertEq, assertThrows } from './helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Parser — StructDecl
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — StructDecl');

test('empty struct parses as StructDecl', () => {
  const ast = parse(tokenize('Empty := struct { };'));
  assertEq(ast.body[0].kind, 'StructDecl');
  assertEq(ast.body[0].name, 'Empty');
  assertEq(ast.body[0].fields.length, 0);
});

test('struct with primitive fields', () => {
  const ast = parse(tokenize('Vec2 := struct { x: i32; y: i32; };'));
  const s   = ast.body[0];
  assertEq(s.kind, 'StructDecl');
  assertEq(s.name, 'Vec2');
  assertEq(s.fields.length, 2);
  assertEq(s.fields[0].name, 'x');
  assertEq(s.fields[0].typeAnnot.kind, 'UserTypeRef');
  assertEq(s.fields[0].typeAnnot.name, 'i32');
  assertEq(s.fields[1].name, 'y');
});

test('struct field with mut modifier', () => {
  const ast = parse(tokenize('Counter := struct { n: mut i32; };'));
  const f   = ast.body[0].fields[0];
  assertEq(f.name, 'n');
  assertEq(f.mut, true);
  assertEq(f.typeAnnot.kind, 'UserTypeRef');
  assertEq(f.typeAnnot.name, 'i32');
});

test('struct field without mut defaults to non-mut', () => {
  const ast = parse(tokenize('Point := struct { x: f64; };'));
  assertEq(ast.body[0].fields[0].mut, false);
});

test('struct field with default value', () => {
  const ast = parse(tokenize('Cfg := struct { hp: mut u32 = 100; };'));
  const f   = ast.body[0].fields[0];
  assertEq(f.name, 'hp');
  assert(f.defaultValue !== null, 'defaultValue should be set');
  assertEq(f.defaultValue.kind, 'Literal');
  assertEq(f.defaultValue.value, 100);
});

test('struct field without default has null defaultValue', () => {
  const ast = parse(tokenize('Entity := struct { id: i32; };'));
  assert(ast.body[0].fields[0].defaultValue === null);
});

test('struct with array field type', () => {
  const ast = parse(tokenize('Player := struct { name: array<u8, 32>; };'));
  const f   = ast.body[0].fields[0];
  assertEq(f.typeAnnot.kind, 'ArrayType');
  assertEq(f.typeAnnot.elemType.name, 'u8');
  assertEq(f.typeAnnot.size, 32);
});

test('struct field with user-defined type ref', () => {
  const ast = parse(tokenize('Pair := struct { pos: Vec2; }; Vec2 := struct { x: i32; y: i32; };'));
  const f   = ast.body[0].fields[0];
  assertEq(f.typeAnnot.kind, 'UserTypeRef');
  assertEq(f.typeAnnot.name, 'Vec2');
});

test('struct with multiple fields mixed types', () => {
  const src = 'Player := struct { hp: mut u32 = 0; name: array<u8, 32>; active: bool; };';
  const ast = parse(tokenize(src));
  const s   = ast.body[0];
  assertEq(s.fields.length, 3);
  assertEq(s.fields[0].name, 'hp');
  assertEq(s.fields[1].name, 'name');
  assertEq(s.fields[2].name, 'active');
});

// ─────────────────────────────────────────────────────────────────────────────
// Parser — StructDecl source ranges
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — StructDecl source ranges');

test('StructDecl has start and end', () => {
  const ast = parse(tokenize('S := struct { x: i32; };'));
  const s   = ast.body[0];
  assert(s.start !== undefined, 'start defined');
  assert(s.end   !== undefined, 'end defined');
  assert(s.start < s.end,       'start < end');
});

test('StructField has line and start', () => {
  const ast = parse(tokenize('S := struct { x: i32; };'));
  const f   = ast.body[0].fields[0];
  assertEq(f.line, 1);
  assert(f.start !== undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Parser — StructDecl coexists with other declarations
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — StructDecl in program');

test('struct and function co-exist in same program', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { return 0; };';
  const ast = parse(tokenize(src));
  assertEq(ast.body[0].kind, 'StructDecl');
  assertEq(ast.body[1].kind, 'FuncDecl');
  assertEq(ast.errors.length, 0);
});

test('two struct declarations in one program', () => {
  const src = 'A := struct { x: i32; }; B := struct { y: f64; };';
  const ast = parse(tokenize(src));
  assertEq(ast.body.length, 2);
  assertEq(ast.body[0].kind, 'StructDecl');
  assertEq(ast.body[1].kind, 'StructDecl');
});

// ─────────────────────────────────────────────────────────────────────────────
// TypeChecker — StructDecl (Item 13.3)
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — StructDecl');

test('struct decl produces StructType', () => {
  const { ast } = compile('Vec2 := struct { x: i32; y: i32; };');
  const st = ast.body[0]._type;
  assertEq(st.kind, 'StructType');
  assertEq(st.name, 'Vec2');
});

test('StructType has correct field count', () => {
  const { ast } = compile('Vec2 := struct { x: i32; y: i32; };');
  assertEq(ast.body[0]._type.fields.length, 2);
});

test('StructType field names and types', () => {
  const { ast } = compile('Vec2 := struct { x: i32; y: f64; };');
  const fields = ast.body[0]._type.fields;
  assertEq(fields[0].name, 'x');
  assertEq(fields[0].type.name, 'i32');
  assertEq(fields[1].name, 'y');
  assertEq(fields[1].type.name, 'f64');
});

test('StructType byteSize is sum of field sizes (packed)', () => {
  const { ast } = compile('S := struct { a: i32; b: f64; };');
  // i32=4 bytes, f64=8 bytes → total 12
  assertEq(ast.body[0]._type.byteSize, 12);
});

test('StructType fieldOffsets correct', () => {
  const { ast } = compile('S := struct { a: i32; b: f64; };');
  const offsets = ast.body[0]._type.fieldOffsets;
  assertEq(offsets.get('a'), 0);
  assertEq(offsets.get('b'), 4);
});

test('struct with mut field has field.mut = true', () => {
  const { ast } = compile('S := struct { n: mut i32; };');
  assertEq(ast.body[0]._type.fields[0].mut, true);
});

test('struct field default value is typed', () => {
  const { ast } = compile('S := struct { n: mut u32 = 0; };');
  const field   = ast.body[0].fields[0];
  assertEq(field.defaultValue._type.name, 'u32');
});

test('struct with array field — byteSize includes array', () => {
  const { ast } = compile('S := struct { name: array<u8, 32>; };');
  // array<u8,32> = 32 bytes
  assertEq(ast.body[0]._type.byteSize, 32);
});

test('struct field default value type mismatch throws TypeError', () => {
  assertThrows(
    () => compile('S := struct { n: u32 = 3.14; };'),
    TypeError,
    'not assignable',
  );
});

test('StructType registered in scope — usable as function param type', () => {
  // Vec2 is declared before main, so it should be in scope when main is checked
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { return 0; };';
  const { ast } = compile(src);
  // No errors expected
  assertEq(ast.errors.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// TypeChecker — struct member access (Item 13.4)
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — struct member access');

test('v.field returns field type', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn(v: Vec2) i32 { return v.x; };';
  const { ast } = compile(src);
  assertEq(ast.errors.length, 0);
  const ret = ast.body[1].body.body[0];
  assertEq(ret.value._type.name, 'i32');
});

test('access to non-existent field throws TypeError', () => {
  const src = 'Vec2 := struct { x: i32; }; main := fn(v: Vec2) i32 { return v.z; };';
  assertThrows(() => compile(src), TypeError, "no field 'z'");
});

test('mut field allows assignment', () => {
  const src = 'Vec2 := struct { x: mut i32; }; main := fn(v: Vec2) i32 { v.x = 5; return v.x; };';
  const { ast } = compile(src);
  assertEq(ast.errors.length, 0);
});

test('non-mut field assignment throws TypeError', () => {
  const src = 'Vec2 := struct { x: i32; }; main := fn(v: Vec2) i32 { v.x = 5; return 0; };';
  assertThrows(() => compile(src), TypeError, "const field");
});

test('struct param type is resolved StructType in scope', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn(v: Vec2) i32 { return v.x; };';
  const { ast } = compile(src);
  const param = ast.body[1].params[0];
  assertEq(param._type.kind, 'StructType');
  assertEq(param._type.name, 'Vec2');
});

// ─────────────────────────────────────────────────────────────────────────────
// CodeGen — struct (Item 13.6)
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — struct (Item 13.6)');

// Struct params are passed as i32 (base address into WASM linear memory).
// The caller writes the struct fields into memory, then calls the function.

test('struct param field read compiles to valid WASM', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn(v: Vec2) i32 { return v.x; };';
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  assert(bytes instanceof Uint8Array, 'should produce bytes');
  assert(bytes.length > 8, 'should be non-trivial WASM');
});

test('struct param field read returns first field value', async () => {
  // Vec2 := struct { x: i32; y: i32; }
  //   x is at offset 0, y at offset 4 (each i32 = 4 bytes)
  // main(v: Vec2) i32 { return v.x; }
  // We write [7, 99] into memory at address 0, pass 0 as v, expect 7 back.
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn(v: Vec2) i32 { return v.x; };';
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  const mem = new Int32Array(instance.exports.memory.buffer);
  mem[0] = 7;   // x at byte offset 0 → Int32Array index 0
  mem[1] = 99;  // y at byte offset 4 → Int32Array index 1
  const result = instance.exports.main(0);  // pass base address 0
  assertEq(result, 7);
});

test('struct param second field read returns second field value', async () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; get_y := fn(v: Vec2) i32 { return v.y; };';
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  const mem = new Int32Array(instance.exports.memory.buffer);
  mem[0] = 3;   // x
  mem[1] = 42;  // y
  const result = instance.exports.get_y(0);
  assertEq(result, 42);
});

test('struct param field write (mut field) persists', async () => {
  // v.x = 99; return v.x;
  // Field x is mut so assignment is allowed.
  const src = 'Vec2 := struct { x: mut i32; y: i32; }; main := fn(v: Vec2) i32 { v.x = 99; return v.x; };';
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  const mem = new Int32Array(instance.exports.memory.buffer);
  mem[0] = 0;   // x starts 0
  mem[1] = 0;   // y
  const result = instance.exports.main(0);
  assertEq(result, 99);
});

// ─────────────────────────────────────────────────────────────────────────────
// TypeChecker — struct constructor (Item 13.5)
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — struct constructor (Item 13.5)');

test('Vec2::default typechecks and returns StructType', () => {
  const src = 'Vec2 := struct { x: mut i32; y: mut i32; }; main := fn() Vec2 { v : Vec2 = Vec2::default; return v; };';
  const { ast } = compile(src);
  assertEq(ast.errors.length, 0);
  const vDecl = ast.body[1].body.body[0];
  assertEq(vDecl._type.kind, 'StructType');
  assertEq(vDecl._type.name, 'Vec2');
});

test('Vec2::of(1, 2) typechecks and returns StructType', () => {
  const src = 'Vec2 := struct { x: mut i32; y: mut i32; }; main := fn() Vec2 { v : Vec2 = Vec2::of(1, 2); return v; };';
  const { ast } = compile(src);
  assertEq(ast.errors.length, 0);
  const vDecl = ast.body[1].body.body[0];
  assertEq(vDecl._type.kind, 'StructType');
});

test('Vec2::of wrong arg count → TypeError', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { v : Vec2 = Vec2::of(1); return 0; };';
  assertThrows(() => compile(src), TypeError, 'expects 2 argument');
});

test('Vec2::of arg type mismatch → TypeError', () => {
  const src = 'Vec2 := struct { x: i32; y: i32; }; main := fn() i32 { v : Vec2 = Vec2::of(1, true); return 0; };';
  assertThrows(() => compile(src), TypeError, "field 'y'");
});

// ─────────────────────────────────────────────────────────────────────────────
// CodeGen — struct constructor (Item 13.5)
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — struct constructor (Item 13.5)');

test('Vec2::of(3, 7) local — read first field returns 3', async () => {
  const src = `
    Vec2 := struct { x: mut i32; y: mut i32; };
    main := fn() i32 {
      v : Vec2 = Vec2::of(3, 7);
      return v.x;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 3);
});

test('Vec2::of(3, 7) local — read second field returns 7', async () => {
  const src = `
    Vec2 := struct { x: mut i32; y: mut i32; };
    main := fn() i32 {
      v : Vec2 = Vec2::of(3, 7);
      return v.y;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 7);
});

test('Vec2::default local — fields are zero', async () => {
  const src = `
    Vec2 := struct { x: mut i32; y: mut i32; };
    main := fn() i32 {
      v : Vec2 = Vec2::default;
      return v.x;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 0);
});

test('T::default uses explicit field default values', async () => {
  const src = `
    Counter := struct { id: i32; n: mut i32 = 10; };
    main := fn() i32 {
      c : Counter = Counter::default;
      return c.n;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 10);
});

test('T::default: field without default is zero, field with default uses it', async () => {
  const src = `
    Counter := struct { id: i32; n: mut i32 = 42; };
    main := fn() i32 {
      c : Counter = Counter::default;
      return c.id + c.n;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 42);  // id=0, n=42
});

// ─────────────────────────────────────────────────────────────────────────────
// CodeGen — struct through pointer (ptr<mut S>, &local)
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — struct through pointer');

test('&local struct passes address to ptr<mut S> param', async () => {
  // zero_x takes a pointer, writes 0 to the x field
  const src = `
    Vec2 := struct { x: mut i32; y: mut i32; };
    zero_x := fn(p: ptr<mut Vec2>) void { p.*.x = 0; };
    main := fn() i32 {
      v : mut Vec2 = Vec2::of(99, 7);
      zero_x(&v);
      return v.x;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 0);
});

test('field read through ptr deref (c.*.field) returns correct value', async () => {
  const src = `
    Pair := struct { a: mut i32; b: mut i32; };
    get_b := fn(p: ptr<mut Pair>) i32 { return p.*.b; };
    main := fn() i32 {
      v : mut Pair = Pair::of(10, 55);
      return get_b(&v);
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 55);
});

test('field write through ptr deref (c.*.field = x) persists to caller', async () => {
  const src = `
    Pair := struct { a: mut i32; b: mut i32; };
    set_a := fn(p: ptr<mut Pair>, v: i32) void { p.*.a = v; };
    main := fn() i32 {
      s : mut Pair = Pair::of(0, 0);
      set_a(&s, 42);
      return s.a;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 42);
});

test('multiple ptr writes in one function all persist', async () => {
  // Mirrors complex_sqr pattern: read fields, write back computed values
  const src = `
    V := struct { r: mut f64; i: mut f64; };
    negate := fn(c: ptr<mut V>) void {
      c.*.r = 0.0 - c.*.r;
      c.*.i = 0.0 - c.*.i;
    };
    main := fn() i32 {
      v : mut V = V::of(3.0, 5.0);
      negate(&v);
      // v.r should be -3, v.i should be -5; sum = -8 cast to i32 = -8
      return as<i32>(v.r + v.i);
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), -8);
});
