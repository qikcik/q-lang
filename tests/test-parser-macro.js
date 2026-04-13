import { tokenize } from '../compiler/lexer.js';
import { parse }    from '../compiler/parser.js';

function pp(src) {
  const tokens = tokenize(src);
  const ast = parse(tokens);
  return ast;
}

// Test arr.[i] — BracketAccessExpr
{
  const ast = pp('main := fn() i32 { v := arr.[0]; return v; };');
  const body = ast.body[0].body.body;
  const decl = body[0];
  console.assert(decl.value.kind === 'BracketAccessExpr', 'BracketAccessExpr kind');
  console.assert(decl.value.index.value === 0, 'BracketAccessExpr index');
  console.log('✓ arr.[i] BracketAccessExpr');
}

// Test T::of(v) — QualifiedName
{
  const ast = pp('main := fn() i32 { x := i32::of(42); return x; };');
  const decl = ast.body[0].body.body[0];
  console.assert(decl.value.kind === 'QualifiedName', 'QualifiedName kind');
  console.assert(decl.value.segments[0] === 'i32', 'QualifiedName type');
  console.assert(decl.value.segments[1] === 'of', 'QualifiedName method=of');
  console.log('✓ i32::of(v) QualifiedName');
}

// Test T::default — QualifiedName
{
  const ast = pp('main := fn() f64 { y := f64::default; return y; };');
  const decl = ast.body[0].body.body[0];
  console.assert(decl.value.kind === 'QualifiedName', 'QualifiedName default kind');
  console.assert(decl.value.segments[1] === 'default', 'method=default');
  console.log('✓ f64::default QualifiedName');
}

// Test macro declaration
{
  const src = `assert := macro(cond : expr) {
    if (!@cond) {
      return 0;
    }
  };
  main := fn() i32 { return 1; };`;
  const ast = pp(src);
  console.assert(ast.body[0].kind === 'MacroDecl', 'MacroDecl kind');
  console.assert(ast.body[0].name === 'assert', 'MacroDecl name');
  console.assert(ast.body[0].params[0].name === 'cond', 'MacroParam name');
  console.assert(ast.body[0].params[0].paramKind === 'expr', 'MacroParam paramKind');
  console.log('✓ MacroDecl');
}

// Test macro call statement
{
  const src = `assert := macro(cond : expr) { if (!@cond) { return 0; } };
  main := fn() i32 {
    assert!(true);
    return 1;
  };`;
  const ast = pp(src);
  const stmt = ast.body[1].body.body[0];
  console.assert(stmt.kind === 'MacroCallStmt', 'MacroCallStmt kind: ' + stmt.kind);
  console.assert(stmt.name === 'assert', 'MacroCallStmt name');
  console.log('✓ MacroCallStmt');
}

console.log('\nAll parser macro tests passed!');
