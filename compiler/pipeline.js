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
import { typecheck, liveTypecheck } from './staticTypeChecker.js';
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

export function compile(src, _opts = {}) {
  const tokens     = tokenize(src);
  const ast        = parse(tokens);
  const parseErrors = ast.errors ?? [];
  if (parseErrors.length > 0) {
    return { tokens, ast, expLog: new Map(), parseErrors };
  }
  const mainSource = SourceBuffer.forMain(src, tokens);
  const expLog = expand(ast, { fileId: 'main', source: mainSource });
  tagMainSourceNodes(ast, mainSource);
  typecheck(ast);
  deferPass(ast);
  return { tokens, ast, expLog, parseErrors, mainSource };
}

// liveCompile — full pipeline for live IDE feedback (no codegen).
// Never throws. Always runs all phases (tokenize→parse→expand→typecheck).
// ErrorNode guards in TC/expander protect against crashes on partial ASTs.
// Returns { tokens, ast, expLog, parseErrors, typeErrors, mainSource }.
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

  liveTypecheck(ast);
  typeErrors = ast.typeErrors ?? [];

  return { tokens, ast, expLog, parseErrors, typeErrors, mainSource };
}

