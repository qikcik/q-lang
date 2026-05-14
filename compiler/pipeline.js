// compiler/pipeline.js — canonical compile pipeline
//
// Single entry point that runs all compiler phases in order:
//   compile():     tokenize → parse → expand (macros) → typecheck → deferPass
//   liveCompile(): tokenize → parse → expand → typecheck  (no deferPass, no codegen)
//
// PHASE ORDER (must not be permuted):
//   tokenize → parse → expand → typecheck → deferPass → generate
//   expand must precede typecheck (MacroDecl nodes are consumed by expander)
//   typecheck must precede deferPass  (deferPass asserts _type on FuncDecls)
//   deferPass must precede generate   (DeferStmt nodes must be rewritten first)
//
// __src tagging: two paths
//   Expanded macro nodes are tagged with __src at expansion time by macro-expander.js.
//   Main-file nodes are tagged retroactively via tagMainSourceNodes() after expand().
//   Both paths assign { __src (SourceBuffer), src_start, src_end }.
//   buildCanonicalRef() (source-ref.js) unifies both behind a single API.
//
// compile() returns { tokens, ast, expLog, parseErrors, mainSource }.
//   The typed AST is mutated in-place by typecheck(); deferPass() rewrites DeferStmt
//   nodes inline before generate() is called.
//   When parseErrors.length > 0, expand and typecheck are skipped (partial AST only).
//
// liveCompile() always runs all phases and never throws. Used for live IDE feedback.
//   Returns { tokens, ast, expLog, parseErrors, typeErrors, mainSource }.
//
// Usage (IDE, tests, tooling):
//   import { compile, liveCompile } from './compiler/pipeline.js';
//   const { tokens, ast, expLog, parseErrors } = compile(src);
//
// MAPS THAT MUST BE REFRESHED IN ide/main.js AFTER EVERY RECOMPILE (in order):
//   setLastAst(ast)             → ide-state.js
//   setLastTokens(tokens)       → ide-state.js
//   setLastHoverData(hd)        → ide-state.js
//   setLastLineIndex(lineIdx)   → ide-state.js (via buildLineIndex)
//   setExpLog(expLog)           → ide-state.js
//   setLastErrorRange(...)      → ide-state.js
//   setStmtMap(stmtMap)         → crossSelection.js
// Skipping any one of these causes stale IDE state (wrong hover / highlight).
//
// The generate() step is intentionally excluded — called separately by the IDE and tests.

import { tokenize }  from './lexer.js';
import { parse }     from './parser.js';
import { expand }    from './macro-expander.js';
import { typecheck, liveTypecheck, TypeChecker, _filenameToNsKey } from './staticTypeChecker.js';
import { deferPass } from './defer-pass.js';
import { SourceBuffer } from './source-buffer.js';
import { srcStart, srcEnd } from './source.js';

// Walk every AST node reachable from `root` and assign __src / src_start / src_end.
// Nodes that already carry __src (expanded nodes tagged by macro-expander) are skipped.
// Only traverses child properties that are AST arrays or AST child nodes (has .start).
const AST_CHILD_KEYS = new Set([
  'body', 'params', 'args', 'elements', 'elseBody',
  'condition', 'value', 'left', 'right', 'callee', 'object', 'index',
  'operand', 'returnType',
]);
function tagMainSourceNodes(root, mainSource) {
  const visited = new Set();
  function tag(node) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (node.__src) return;  // already tagged by macro-expander
    if (node.start != null) {
      node.__src     = mainSource;
      node.src_start = node.start;
      node.src_end   = node.end;
    }
    for (const key of AST_CHILD_KEYS) {
      const val = node[key];
      if (!val) continue;
      if (Array.isArray(val)) val.forEach(tag);
      else if (typeof val === 'object') tag(val);
    }
  }
  tag(root);
}

export function compileMulti(src, getFile) {
  // Step 1: parse main
  const tokens     = tokenize(src);
  const ast        = parse(tokens);
  const parseErrors = ast.errors ?? [];
  if (parseErrors.length > 0) {
    return { tokens, ast, expLog: new Map(), parseErrors, importEnv: new Map() };
  }

  // Step 2: resolve imports recursively
  const importEnv = new Map(); // filename → { scope, ast, source }
  const visiting  = new Set();

  function resolveImport(filename) {
    if (importEnv.has(filename)) return;
    if (visiting.has(filename)) {
      throw new Error(`Circular import: '${filename}'`);
    }
    visiting.add(filename);

    const fileSrc = getFile(filename);
    if (fileSrc == null) throw new Error(`File not found: '${filename}'`);

    const fileTokens = tokenize(fileSrc);
    const fileAst    = parse(fileTokens);
    const fileSource = SourceBuffer.forFile(filename, fileSrc, fileTokens);
    tagMainSourceNodes(fileAst, fileSource);

    // Recursively resolve any imports this file declares
    for (const decl of fileAst.body) {
      if (decl.kind === 'NamespaceImport') resolveImport(decl.filename);
    }

    // Typecheck in isolation: _filePrefix causes FuncDecl names to be prefixed
    // so they produce unique WASM function names while remaining accessible
    // under their original names within the file's own scope.
    const nsKey  = _filenameToNsKey(filename);
    const fileTC = new TypeChecker();
    fileTC._filePrefix = nsKey;
    fileTC.check(fileAst, importEnv);
    deferPass(fileAst);

    importEnv.set(filename, { scope: fileTC.globalScope, ast: fileAst, source: fileSource });
    visiting.delete(filename);
  }

  for (const decl of ast.body) {
    if (decl.kind === 'NamespaceImport') resolveImport(decl.filename);
  }

  // Step 3: run main pipeline
  const mainSource = SourceBuffer.forMain(src, tokens);
  const expLog = expand(ast, { fileId: 'main', source: mainSource });
  tagMainSourceNodes(ast, mainSource);
  typecheck(ast, importEnv);
  deferPass(ast);

  // Step 4: create merged AST for codegen — imported FuncDecl and NamespacedDecl
  // bodies prepended so collectAllFuncDecls() in wat-encoder naturally picks them up.
  // NamespacedDecl (e.g. Vec2::dot) wraps an inner FuncDecl; the encoder's recursive
  // Object.values walk finds the inner FuncDecl when NamespacedDecl is in the body.
  const importedBodies = [];
  for (const entry of importEnv.values()) {
    for (const decl of entry.ast.body) {
      if (decl.kind === 'FuncDecl' || decl.kind === 'NamespacedDecl'
          || (decl.kind === 'VarDecl' && decl._isRuntimeImport)) importedBodies.push(decl);
    }
  }
  const mergedAst = importedBodies.length > 0
    ? { ...ast, body: [...importedBodies, ...ast.body] }
    : ast;

  return { tokens, ast: mergedAst, expLog, parseErrors, mainSource, importEnv };
}

// compile — single-file convenience wrapper.
// Backward-compatible alias for compileMulti with no file imports.
// All single-file programs continue to work unchanged.
export const compile = src => compileMulti(src, () => null);

// liveCompile — full pipeline for live IDE feedback (no codegen).
// Never throws. Always runs all phases (tokenize→parse→expand→typecheck).
// ErrorNode guards in TC/expander protect against crashes on partial ASTs.
// Returns { tokens, ast, expLog, parseErrors, typeErrors, mainSource }.
// opts.importEnv — optional Map(filename → { scope, ast, source }) for namespace imports.
export function liveCompile(src, opts = {}) {
  let tokens, ast, expLog = new Map(), parseErrors = [], typeErrors = [];

  try { tokens = tokenize(src); } catch { return { tokens: [], ast: null, expLog, parseErrors, typeErrors }; }

  try { ast = parse(tokens); } catch { return { tokens, ast: null, expLog, parseErrors, typeErrors }; }
  parseErrors = ast.errors ?? [];

  const mainSource = SourceBuffer.forMain(src, tokens);

  try { expLog = expand(ast, { fileId: 'main', source: mainSource }); } catch (e) {
    typeErrors.push(e);
    return { tokens, ast, expLog, parseErrors, typeErrors };
  }
  tagMainSourceNodes(ast, mainSource);

  liveTypecheck(ast, opts.importEnv ?? null);
  typeErrors = ast.typeErrors ?? [];

  return { tokens, ast, expLog, parseErrors, typeErrors, mainSource };
}

// buildLiveImportEnv — resolve namespace imports for liveCompileMulti.
// Tokenizes and typechecks each imported file WITHOUT _filePrefix so hover
// shows real function names (e.g. 'add', not '__f_vec2_qlang__add').
// Silently skips files that are missing or have type errors — liveTypecheck
// will emit the appropriate "File not found" error for the caller.
function buildLiveImportEnv(mainAst, getFile) {
  const importEnv = new Map();
  const visiting  = new Set();

  function resolve(filename) {
    if (importEnv.has(filename) || visiting.has(filename)) return;
    visiting.add(filename);
    const fileSrc = getFile(filename);
    if (!fileSrc) { visiting.delete(filename); return; }

    const fileTokens = tokenize(fileSrc);
    const fileAst    = parse(fileTokens);
    const fileSource = SourceBuffer.forFile(filename, fileSrc, fileTokens);
    tagMainSourceNodes(fileAst, fileSource);

    // Recursively resolve any imports this file declares
    for (const decl of fileAst.body) {
      if (decl.kind === 'NamespaceImport') resolve(decl.filename);
    }

    // Typecheck in isolation — no _filePrefix so user sees real function names in hover
    const fileTC = new TypeChecker();
    try { fileTC.check(fileAst, importEnv); } catch {}
    importEnv.set(filename, { scope: fileTC.globalScope, ast: fileAst, source: fileSource });
    visiting.delete(filename);
  }

  for (const decl of mainAst.body) {
    if (decl.kind === 'NamespaceImport') resolve(decl.filename);
  }
  return importEnv;
}

// liveCompileMulti — live compile aware of namespace file imports.
// Used by the IDE when the project has more than one file.
// Builds an importEnv from getFile, then delegates to liveCompile.
// Never throws. Returns the same shape as liveCompile.
export function liveCompileMulti(src, getFile) {
  // Pre-parse main to discover imports; liveCompile will re-parse (acceptable trade-off)
  let fastAst;
  try {
    fastAst = parse(tokenize(src));
  } catch {
    return liveCompile(src);
  }

  const importEnv = buildLiveImportEnv(fastAst, getFile);
  return { ...liveCompile(src, { importEnv }), importEnv };
}

