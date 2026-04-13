// ─────────────────────────────────────────────────────────────────────────────
// defer-pass.js  — AST rewrite pass: DeferStmt → inline statements
//
// Pipeline position: after typecheck(), before generate()
//   tokenize → parse → expand → typecheck → deferPass → generate
//
// Public API:
//   deferPass(ast) → ast   (mutates AST in-place)
//
// Semantics:
//   defer <expr>;  — evaluates <expr> at end of the enclosing function body
//                    (deferred statements execute in reverse order).
//   If the function exits via return, deferred statements run before the
//   return value is produced.
//
// Architecture note:
//   The rewriter is isolated so the actual code-emission strategy can be
//   swapped later (e.g. for a thunk-based or WASM-try-finally approach).
//   To swap: replace rewriteBlock() with an alternate implementation.
// ─────────────────────────────────────────────────────────────────────────────

export function deferPass(ast) {
  // Precondition: typecheck() must have run — all FuncDecl nodes must carry _type.
  for (const decl of ast.body) {
    if (decl.kind === 'FuncDecl' && !decl._type)
      throw new Error(`deferPass() called before typecheck() — FuncDecl '${decl.name}' has no _type`);
  }
  for (const decl of ast.body) {
    if (decl.kind === 'FuncDecl') rewriteFuncDecl(decl);
  }
  return ast;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal – rewrite a function declaration
// ─────────────────────────────────────────────────────────────────────────────

function rewriteFuncDecl(decl) {
  decl.body.body = rewriteBlock(decl.body.body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal – rewrite one list of statements (one block scope)
//
// Strategy (MVP / inline):
//   1. Collect DeferStmt nodes in order (they will fire in reverse).
//   2. Recurse into nested blocks so inner defers are handled independently.
//   3. For each ReturnStmt in THIS block, inject the collected deferred exprs
//      (reversed) as ExprStmt nodes immediately before the return.
//   4. At the end of the block, append any remaining deferred exprs
//      (reversed) — covers fall-through exits.
//   5. Remove all DeferStmt nodes from the output.
//
// To swap the emit mechanism, replace steps 3+4 with a different strategy
// (e.g. emit a finally block, or emit function-call thunks).
// ─────────────────────────────────────────────────────────────────────────────

function rewriteBlock(stmts, outerDeferred = []) {
  // Collect deferred expressions from this scope (not from nested scopes).
  const deferred = [];  // { expr, line, start, end }

  // First pass: gather defers from this scope level, recurse into nested blocks.
  const preRewritten = [];
  for (const s of stmts) {
    if (s.kind === 'DeferStmt') {
      deferred.push(s);
    } else {
      // Pass all currently active defers (local + outer) to nested blocks so
      // their ReturnStmts also flush the correct set of deferred code.
      const activeDeferred = [...deferred, ...outerDeferred];
      preRewritten.push(rewriteStmt(s, activeDeferred));
    }
  }

  if (deferred.length === 0 && outerDeferred.length === 0) return preRewritten;

  // Mapping helper: DeferStmt → executable statement.
  const deferToStmt = d => d.stmt
    ? d.stmt
    : ({ kind: 'ExprStmt', expr: d.expr, line: d.line, start: d.start, end: d.end });

  // flushAll  — used before ReturnStmt: must emit ALL active defers (local + outer)
  //             because the function is exiting and every registered defer must fire.
  const allActive = [...deferred, ...outerDeferred];
  const flushAll  = () => [...allActive].reverse().map(deferToStmt);

  // flushLocal — used at block fallthrough: emit only THIS scope's defers.
  //              Outer defers are handled by their own scope's fallthrough flush —
  //              emitting them here would cause double execution.
  const flushLocal = () => [...deferred].reverse().map(deferToStmt);

  // Second pass: inject deferred exprs before each ReturnStmt.
  const result = [];
  for (const s of preRewritten) {
    if (s.kind === 'ReturnStmt') {
      result.push(...flushAll());
    }
    result.push(s);
  }

  // Append fall-through flush (last statement is not a ReturnStmt, or block has no return).
  const last = result[result.length - 1];
  if (!last || last.kind !== 'ReturnStmt') {
    result.push(...flushLocal());
  }

  return result;
}

// Recursively rewrite nested statement nodes that contain their own block.
function rewriteStmt(stmt, activeDeferred = []) {
  switch (stmt.kind) {
    case 'IfStmt':
      stmt.then.body = rewriteBlock(stmt.then.body, activeDeferred);
      if (stmt.elseBranch) stmt.elseBranch.body = rewriteBlock(stmt.elseBranch.body, activeDeferred);
      break;
    case 'WhileStmt':
      stmt.body.body = rewriteBlock(stmt.body.body, activeDeferred);
      break;
    case 'ScopeBlock':
      stmt.body = rewriteBlock(stmt.body, activeDeferred);
      break;
    case 'FuncDecl':
      // Nested function: its defers are independent.
      rewriteFuncDecl(stmt);
      break;
  }
  return stmt;
}
