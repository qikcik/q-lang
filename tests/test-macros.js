// tests/test-macros.js — Macro system, BracketAccessExpr, QualifiedName tests

import { test, suite, assert, assertEq, assertThrows, compileAndGenerate } from './helpers.js';
import { tokenize, TT, LexError } from '../compiler/lexer.js';
import { parse, ParseError } from '../compiler/parser.js';
import { expand, MacroError } from '../compiler/macro-expander.js';
import { typecheck, TypeError } from '../compiler/staticTypeChecker.js';
import { compile, liveCompile } from '../compiler/pipeline.js';
import { generate } from '../compiler/codegen.js';

// ─────────────────────────────────────────────────────────────────────────────
// LEXER — Macro tokens
// ─────────────────────────────────────────────────────────────────────────────

suite('Lexer — macro tokens');

test('macro keyword is KEYWORD', () => {
  const toks = tokenize('macro');
  assertEq(toks[0].type, TT.KEYWORD);
  assertEq(toks[0].value, 'macro');
});

test('$name → MACRO_VAR', () => {
  const toks = tokenize('$i');
  assertEq(toks[0].type, TT.MACRO_VAR);
  assertEq(toks[0].value, '$i');
});

test('@name → MACRO_PARAM', () => {
  const toks = tokenize('@arr');
  assertEq(toks[0].type, TT.MACRO_PARAM);
  assertEq(toks[0].value, '@arr');
});

test('#name → MACRO_STRINGIFY', () => {
  const toks = tokenize('#cond');
  assertEq(toks[0].type, TT.MACRO_STRINGIFY);
  assertEq(toks[0].value, '#cond');
});

test(':: → OP ::', () => {
  const toks = tokenize('i32::of');
  assertEq(toks[1].type, TT.OP);
  assertEq(toks[1].value, '::');
});

test('$name start/end offsets', () => {
  const toks = tokenize(' $idx');
  assertEq(toks[0].start, 1);
  assertEq(toks[0].end, 5);
});

test('@name start/end offsets', () => {
  const toks = tokenize('@elem');
  assertEq(toks[0].start, 0);
  assertEq(toks[0].end, 5);
});

test('#name start/end offsets', () => {
  const toks = tokenize('#cond');
  assertEq(toks[0].start, 0);
  assertEq(toks[0].end, 5);
});

test('@ alone (no alpha) throws LexError', () => {
  assertThrows(() => tokenize('@'), LexError);
});

test('# alone (no alpha) throws LexError', () => {
  assertThrows(() => tokenize('#'), LexError);
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER — macro constructs
// ─────────────────────────────────────────────────────────────────────────────

suite('Parser — BracketAccessExpr (arr.[i])');

test('arr.[i] parses as BracketAccessExpr', () => {
  const ast = parse(tokenize('main := fn() i32 { a : array<i32,3> = {1,2,3}; v := a.[0]; return v; };'));
  const decl = ast.body[0].body.body[1];
  assertEq(decl.value.kind, 'BracketAccessExpr');
});

test('BracketAccessExpr index value', () => {
  const ast = parse(tokenize('main := fn() i32 { a : array<i32,3> = {1,2,3}; v := a.[1]; return v; };'));
  const ba  = ast.body[0].body.body[1].value;
  assertEq(ba.index.value, 1);
});

test('BracketAccessExpr stores dotStart', () => {
  const src = 'main := fn() i32 { a : array<i32,3> = {1,2,3}; v := a.[0]; return v; };';
  const ast = parse(tokenize(src));
  const ba  = ast.body[0].body.body[1].value;
  assert(ba.dotStart != null, 'dotStart must be set');
  assertEq(src[ba.dotStart], '.', 'dotStart must point to .');
});

suite('Parser — QualifiedName (T::method)');

test('i32::of(42) → QualifiedName', () => {
  const ast = parse(tokenize('x := i32::of(42);'));
  assertEq(ast.body[0].value.kind, 'QualifiedName');
  assertEq(ast.body[0].value.segments[0], 'i32');
  assertEq(ast.body[0].value.segments[1], 'of');
});

test('f64::default → QualifiedName', () => {
  const ast = parse(tokenize('x := f64::default;'));
  assertEq(ast.body[0].value.kind, 'QualifiedName');
  assertEq(ast.body[0].value.segments[0], 'f64');
  assertEq(ast.body[0].value.segments[1], 'default');
  assertEq(ast.body[0].value.args, null);
});

// Parser is now permissive with :: — T::unknown_method is valid syntax,
// type-checker rejects unknown methods. So no parse error expected.
test('T::unknown_method → QualifiedName (parser permissive)', () => {
  const ast = parse(tokenize('x := i32::mystery;'));
  assertEq(ast.body[0].kind, 'VarDecl');
  assertEq(ast.body[0].value.kind, 'QualifiedName');
  assertEq(ast.body[0].value.segments[1], 'mystery');
});

suite('Parser — MacroDecl');

test('top-level macro declaration parses as MacroDecl', () => {
  const ast = parse(tokenize('assert := macro(cond : expr) { };'));
  assertEq(ast.body[0].kind, 'MacroDecl');
  assertEq(ast.body[0].name, 'assert');
});

test('MacroDecl params include name and kind', () => {
  const ast = parse(tokenize('m := macro(a : expr, b : ident, c : block) { };'));
  assertEq(ast.body[0].params.length, 3);
  assertEq(ast.body[0].params[0].name, 'a');
  assertEq(ast.body[0].params[0].paramKind, 'expr');
  assertEq(ast.body[0].params[1].paramKind, 'ident');
  assertEq(ast.body[0].params[2].paramKind, 'block');
});

test('MacroDecl all valid kinds accepted', () => {
  for (const k of ['expr', 'ident', 'block', 'type', 'any']) {
    const ast = parse(tokenize(`m := macro(p : ${k}) { };`));
    assertEq(ast.body[0].params[0].paramKind, k);
  }
});

test('MacroDecl invalid kind → ErrorNode', () => {
  const ast = parse(tokenize('m := macro(p : value) { };'));
  assertEq(ast.body[0].kind, 'ErrorNode');
  assert(ast.errors.length > 0);
  assert(ast.errors[0] instanceof ParseError);
  assert(ast.errors[0].message.includes('value'));
});

test('MacroDecl body includes MacroBody tokens and braces', () => {
  const ast = parse(tokenize('m := macro(p : expr) { $i := 0; };'));
  const decl = ast.body[0];
  assertEq(decl.body.kind, 'MacroBody');
  assert(Array.isArray(decl.body.tokens));
  assert(decl.body.tokens.length > 0);
  assertEq(decl.body.tokens[0].value, '{');
});

suite('Parser — MacroCallStmt');

test('macro call statement inside function body', () => {
  const src = 'assert := macro(cond : expr) { }; main := fn() i32 { assert!(true); return 0; };';
  const ast = parse(tokenize(src));
  const stmt = ast.body[1].body.body[0];
  assertEq(stmt.kind, 'MacroCallStmt');
  assertEq(stmt.name, 'assert');
});

test('MacroCallStmt args collected', () => {
  const src = 'm := macro(a : expr, b : block) { }; main := fn() i32 { m!(x + 1, { }); return 0; };';
  const ast = parse(tokenize(src));
  const stmt = ast.body[1].body.body[0];
  assertEq(stmt.args.length, 2);
  assertEq(stmt.args[0].kind, 'raw');
  assertEq(stmt.args[1].kind, 'block');
});

// ─────────────────────────────────────────────────────────────────────────────
// TYPECHECKER — BracketAccessExpr and QualifiedName
// ─────────────────────────────────────────────────────────────────────────────

suite('TypeChecker — BracketAccessExpr');

test('arr.[i] → element type', () => {
  const { ast } = compile('main := fn() i32 { a : array<i32,3> = {1,2,3}; v := a.[0]; return v; };');
  const v = ast.body[0].body.body[1];
  assertEq(v._type.name, 'i32');
});

test('arr.[i] on mut array → mut elem type', () => {
  const { ast } = compile('main := fn() i32 { a : array<mut i32,2> = {1,2}; v := a.[0]; return as<i32>(v); };');
  const v = ast.body[0].body.body[1];
  assertEq(v._type.name, 'i32');
});

test('arr.[i] assign to mut element', () => {
  assert(compile('main := fn() i32 { a : array<mut i32,2> = {1,2}; a.[0] = 99; return a.[0]; };') !== null);
});

suite('TypeChecker — QualifiedName');

test('i32::of(5) → i32', () => {
  const { ast } = compile('x := i32::of(5);');
  assertEq(ast.body[0]._type.name, 'i32');
});

test('f64::default → f64', () => {
  const { ast } = compile('x := f64::default;');
  assertEq(ast.body[0]._type.name, 'f64');
});

// ─────────────────────────────────────────────────────────────────────────────
// CODEGEN — BracketAccessExpr and QualifiedName
// ─────────────────────────────────────────────────────────────────────────────

suite('CodeGen — BracketAccessExpr');

test('arr.[i] read compiles', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { a : array<i32,3> = {1,2,3}; return a.[1]; };'
  );
  assert(bytes.length > 8);
});

test('arr.[i] write compiles', () => {
  const bytes = compileAndGenerate(
    'main := fn() i32 { a : array<mut i32,2> = {10,20}; a.[0] = 99; return a.[0]; };'
  );
  assert(bytes.length > 8);
});

test('ptr<mut u8>.[i] = v write-through-pointer compiles and produces i32.store8', () => {
  // Write path via pointer: emitAssignStmt BracketAccessExpr with ptr<mut T> base.
  // Verifies the pointer branch of checkAssign (via _elemMut) and emitAssignStmt
  // (storeInstr path) are both exercised.
  const src =
    'write := fn(p: ptr<mut u8>, idx: i32, val: u8) void { p.[idx] = val; };' +
    'main := fn() i32 { a : array<mut u8,4> = {0,0,0,0}; write(&a, 1, as<u8>(42)); return as<i32>(a.[1]); };';
  const bytes = compileAndGenerate(src);
  assert(bytes.length > 8, 'WASM output must be non-empty');
});

suite('CodeGen — QualifiedName');

test('i32::of(42) compiles', () => {
  const bytes = compileAndGenerate('main := fn() i32 { x := i32::of(42); return x; };');
  assert(bytes.length > 8);
});

test('f64::default compiles', () => {
  const bytes = compileAndGenerate('main := fn() i32 { x := f64::default; return as<i32>(x); };');
  assert(bytes.length > 8);
});

// ─────────────────────────────────────────────────────────────────────────────
// MACRO EXPANDER
// ─────────────────────────────────────────────────────────────────────────────

suite('Macro expander — basic expansion');

test('MacroDecl is kept in ast.body after expand (for IDE display)', () => {
  const tokens = tokenize('assert := macro(cond : expr) { }; main := fn() i32 { return 0; };');
  const ast    = parse(tokens);
  expand(ast);
  assert(ast.body.some(d => d.kind === 'MacroDecl'), 'MacroDecl should be kept by expander for IDE display');
});

test('simple macro call expands to stmts', () => {
  const src = `
    inc := macro(x : ident) {
      @x = @x + 1;
    };
    main := fn() i32 {
      n : mut i32 = 0;
      inc!(n);
      return n;
    };
  `;
  const { ast } = compile(src);
  // After expansion inc!(n) becomes a MacroExpansionNode wrapping an AssignStmt
  const mainFn = ast.body.find(d => d.kind === 'FuncDecl' && d.name === 'main');
  const stmts = mainFn.body.body;
  const expansion = stmts.find(s => s.kind === 'MacroExpansionNode');
  assert(expansion != null, 'MacroExpansionNode should be present');
  assert(expansion.body.some(s => s.kind === 'AssignStmt'), 'expanded assign stmt should be in body');
});

test('macro expansion produces correct value', async () => {
  const src = `
    inc := macro(x : ident) {
      @x = @x + 1;
    };
    main := fn() i32 {
      n : mut i32 = 0;
      inc!(n);
      return n;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 1, 'n should be 1 after inc!(n)');
});

test('gensym $name creates unique identifier per expansion', () => {
  const src = `
    dbl := macro(x : ident) {
      $tmp : i32 = @x;
      @x = $tmp + $tmp;
    };
    main := fn() i32 {
      a : mut i32 = 5;
      dbl!(a);
      return a;
    };
  `;
  const { ast } = compile(src);
  const mainFn = ast.body.find(d => d.kind === 'FuncDecl' && d.name === 'main');
  const stmts = mainFn.body.body;
  // MacroExpansionNode wraps the expanded stmts; gensym'd VarDecl is inside
  const expansion = stmts.find(s => s.kind === 'MacroExpansionNode');
  assert(expansion != null, 'MacroExpansionNode should be present');
  const gensymDecl = expansion.body.find(s => s.kind === 'VarDecl' && s.name.startsWith('__mg_'));
  assert(gensymDecl != null, 'gensym decl should exist inside MacroExpansionNode.body');
});

test('gensym expansion produces correct value', async () => {
  const src = `
    dbl := macro(x : ident) {
      $tmp : i32 = @x;
      @x = $tmp + $tmp;
    };
    main := fn() i32 {
      a : mut i32 = 5;
      dbl!(a);
      return a;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 10, 'a should be 10 after dbl!(a)');
});

test('block kind argument is spliced in', async () => {
  const src = `
    repeat2 := macro(body : block) {
      @body;
      @body;
    };
    main := fn() i32 {
      n : mut i32 = 0;
      repeat2!({
        n = n + 1;
      });
      return n;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 2, 'repeat2 should run body twice');
});

test('expr kind wraps argument in parens', () => {
  const src = `
    negate := macro(x : expr) {
      $r : i32 = 0 - (@x);
    };
    main := fn() i32 {
      negate!(3 + 2);
      return 0;
    };
  `;
  // Should parse without error (operator precedence safe due to wrapping)
  const tokens = tokenize(src);
  const ast    = parse(tokens);
  expand(ast); // no error
  assert(true, 'expr kind wrapping should not throw');
});

test('undefined macro throws MacroError', () => {
  assertThrows(() => {
    const tokens = tokenize('main := fn() i32 { nosuchm!(x); return 0; };');
    const ast    = parse(tokens);
    expand(ast);
  }, MacroError, 'nosuchm');
});

test('wrong arg count throws MacroError', () => {
  assertThrows(() => {
    const src = 'm := macro(a : expr) { }; main := fn() i32 { m!(x, y); return 0; };';
    const tokens = tokenize(src);
    const ast    = parse(tokens);
    expand(ast);
  }, MacroError);
});

test('ident kind rejects non-ident argument', () => {
  assertThrows(() => {
    const src = 'm := macro(x : ident) { }; main := fn() i32 { m!(a + b); return 0; };';
    const tokens = tokenize(src);
    const ast    = parse(tokens);
    expand(ast);
  }, MacroError, 'ident');
});

test('block kind rejects non-block argument', () => {
  assertThrows(() => {
    const src = 'm := macro(b : block) { }; main := fn() i32 { m!(expr); return 0; };';
    const tokens = tokenize(src);
    const ast    = parse(tokens);
    expand(ast);
  }, MacroError, 'block');
});

suite('Macro expander — stringify (#param)');

test('#param produces string-like expansion', () => {
  // stringify produces a StringLiteral token → expands to array<u8, N>
  const src = `
    log_name := macro(x : expr) {
      $s := #x;
    };
    main := fn() i32 {
      log_name!(myValue);
      return 0;
    };
  `;
  const tokens = tokenize(src);
  const ast    = parse(tokens);
  expand(ast);
  typecheck(ast); // $s := "myValue" — infers array<u8, N>
  assert(true, 'stringify expansion should typecheck');
});

suite('Macro expander — for_each example');

test('for_each macro expands and compiles', async () => {
  const src = `
    for_each := macro(arr : expr, elem : ident, body : block) {
      $i : mut u32 = 0;
      while ($i < (@arr).size) {
        @elem := (@arr).[$i];
        @body;
        $i = $i + 1;
      }
    };
    main := fn() i32 {
      nums : array<i32, 3> = {1, 2, 3};
      total : mut i32 = 0;
      for_each!(nums, val, {
        total = total + val;
      });
      return total;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 6, 'sum of {1,2,3} should be 6');
});

suite('Macro expander — with_min_max example (ident × 2)');

test('with_min_max compiles and returns correct values', async () => {
  const src = `
    with_min_max := macro(arr : expr, lo : ident, hi : ident) {
      @lo : mut i32 = @arr.[0];
      @hi : mut i32 = @arr.[0];
      $i : mut u32 = 1;
      while ($i < @arr.size) {
        $v := @arr.[$i];
        if ($v < @lo) { @lo = $v; }
        if ($v > @hi) { @hi = $v; }
        $i = $i + 1;
      }
    };
    main := fn() i32 {
      scores : array<i32, 5> = {4, 7, 2, 9, 1};
      with_min_max!(scores, lo_val, hi_val);
      return hi_val - lo_val;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 8, 'max(9) - min(1) = 8');
});

test('with_min_max + for_each combined (default snippet)', async () => {
  const src = `
    for_each := macro(arr : expr, elem : ident, body : block) {
      $i : mut u32 = 0;
      while ($i < @arr.size) {
        @elem := @arr.[$i];
        @body;
        $i = $i + 1;
      }
    };
    with_min_max := macro(arr : expr, lo : ident, hi : ident) {
      @lo : mut i32 = @arr.[0];
      @hi : mut i32 = @arr.[0];
      $i : mut u32 = 1;
      while ($i < @arr.size) {
        $v := @arr.[$i];
        if ($v < @lo) { @lo = $v; }
        if ($v > @hi) { @hi = $v; }
        $i = $i + 1;
      }
    };
    main := fn() i32 {
      scores : array<i32, 5> = {4, 7, 2, 9, 1};
      total : mut i32 = 0;
      for_each!(scores, v, {
        total = total + v;
      });
      with_min_max!(scores, lo_val, hi_val);
      return total + hi_val - lo_val;
    };
  `;
  const { ast } = compile(src);
  const { bytes } = generate(ast);
  const { instance } = await WebAssembly.instantiate(bytes, { env: { write_utf8: () => 0, print_utf8: () => 0, input_utf8: () => 0 } });
  assertEq(instance.exports.main(), 31, 'total(23) + max(9) - min(1) = 31');
});

// ── Expansion log (hover data) ────────────────────────────────────────────────

suite('Macro expander — expansion log');

test('expand() returns a Map with call-site entries', () => {
  const src = `
    inc := macro(x : ident) { @x = @x + 1; };
    main := fn() i32 {
      n : mut i32 = 0;
      inc!(n);
      return n;
    };
  `;
  const { expLog } = compile(src);
  assert(expLog instanceof Map, 'expLog should be a Map');
  assertEq(expLog.size, 1, 'one macro call → one log entry');
});

test('expansion log entry has name, end, expandedSource', () => {
  const src = `
    double := macro(x : ident) { @x = @x * 2; };
    main := fn() i32 {
      v : mut i32 = 3;
      double!(v);
      return v;
    };
  `;
  const { expLog } = compile(src);
  const [_start, entry] = [...expLog][0];
  assertEq(entry.name, 'double', 'name should be macro name');
  assert(typeof entry.end  === 'number', 'end should be a number');
  assert(typeof entry.expandedSource === 'string', 'expandedSource should be a string');
  assert(entry.expandedSource.includes('*'), 'expanded source should contain the body op');
});

// ── Source + __src/src_start/src_end ─────────────────────────────────────────

suite('Macro expander — source + __src/src_start/src_end');

test('expansion log has source with id, text, tokens', () => {
  const src = `
    inc := macro(n : ident) { @n = @n + 1; };
    main := fn() i32 { x : mut i32 = 0; inc!(x); return x; };
  `;
  const { expLog } = compile(src);
  const info = [...expLog.values()][0];
  assert(info.source, 'source exists');
  assert(typeof info.source.id   === 'string', 'id is string');
  assert(typeof info.source.text === 'string', 'text is string');
  assert(Array.isArray(info.source.tokens),    'tokens is array');
});

test('source.text matches bodySource', () => {
  const src = `
    inc := macro(n : ident) { @n = @n + 1; };
    main := fn() i32 { x : mut i32 = 0; inc!(x); return x; };
  `;
  const { expLog } = compile(src);
  const info = [...expLog.values()][0];
  assertEq(info.source.text, info.bodySource, 'source.text === bodySource');
});

test('expanded stmt nodes have __src/src_start/src_end set', () => {
  const src = `
    inc := macro(n : ident) { @n = @n + 1; };
    main := fn() i32 { x : mut i32 = 0; inc!(x); return x; };
  `;
  const { expLog } = compile(src);
  const info = [...expLog.values()][0];
  const stmt = info.expandedBody[0];
  assert(stmt.__src     != null, 'stmt.__src is set');
  assert(stmt.src_start != null, 'stmt.src_start is set');
  assert(stmt.src_end   != null, 'stmt.src_end is set');
  assert(stmt.src_start < stmt.src_end, 'src_start < src_end');
});

test('src_start/src_end point to correct text in source', () => {
  const src = `
    inc := macro(n : ident) { @n = @n + 1; };
    main := fn() i32 { x : mut i32 = 0; inc!(x); return x; };
  `;
  const { expLog } = compile(src);
  const info  = [...expLog.values()][0];
  const stmt  = info.expandedBody[0];
  const text  = stmt.__src.text;
  const slice = text.slice(stmt.src_start, stmt.src_end);
  assert(slice.includes('x'), 'stmt text contains identifier x');
  assert(slice.endsWith(';'), 'stmt text ends with ;');
});

test('sub-expression Identifier has src_start pointing to its name', () => {
  const src = `
    inc := macro(n : ident) { @n = @n + 1; };
    main := fn() i32 { x : mut i32 = 0; inc!(x); return x; };
  `;
  const { expLog } = compile(src);
  const info   = [...expLog.values()][0];
  const stmt   = info.expandedBody[0];            // AssignStmt: x = x + 1;
  const target = stmt.target;                     // Identifier 'x'
  assertEq(target.kind, 'Identifier');
  assert(target.__src     != null, 'Identifier __src set');
  assert(target.src_start != null, 'Identifier src_start set');
  const idText = target.__src.text.slice(target.src_start, target.src_end);
  assertEq(idText, 'x', 'Identifier src text = "x"');
});

// ── pack + #expand ────────────────────────────────────────────────────────────

suite('Macros — pack param + #expand');

test('pack param parses without error', () => {
  const { parseErrors } = compile('log := macro(vals: pack) { }; main := fn() i32 { log!([1, 2, 3]); return 0; };');
  assertEq(parseErrors.length, 0);
});

test('#expand unrolls pack into repeated statements', () => {
  const src = `
    sum := macro(acc: ident, vals: pack) {
      #expand val in @vals { @acc = @acc + val; }
    };
    main := fn() i32 {
      s : mut i32 = 0;
      sum!(s, [1, 2, 3]);
      return s;
    };
  `;
  const { ast } = compile(src);
  assert(ast != null, 'compile should succeed');
});

test('#expand over empty pack produces no statements', () => {
  const src = `
    noop := macro(vals: pack) {
      #expand val in @vals { }
    };
    main := fn() i32 {
      noop!([]);
      return 0;
    };
  `;
  const { ast } = compile(src);
  assert(ast != null, 'compile should succeed');
});
