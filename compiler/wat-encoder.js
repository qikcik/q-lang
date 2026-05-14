// ─────────────────────────────────────────────────────────────────────────────
// wat-encoder.js  —  Typed AST  →  WatIR (S-expr)  +  WAT text
//
// Public API:
//   buildWAT(ast, opts)        → { module: SNode, sSpans: SSpan[], stmtMap? }
//   watToText(module, sSpans)  → { text: string, spans: TextSpan[] }
//
// Splits:
//   wat-utils.js       — canonType, elemByteSize, BumpAllocator, SExprBuilder,
//                        BUILTINS, load/store/arith/cmp/conv instruction helpers
//   wat-emitter.js     — emitFunc, emitStmt, emitExpr (AST → S-expr nodes)
//   wat-serializer.js  — watToText (S-expr → WAT text + TextSpan[])
// ─────────────────────────────────────────────────────────────────────────────

import { SExprBuilder, canonType, HEAP_BASE } from './wat-utils.js';
import { emitFunc }                                     from './wat-emitter.js';
export { watToText }                                    from './wat-serializer.js';

// ── AST collection helper ─────────────────────────────────────────────────────

function collectAllFuncDecls(ast) {
  const result = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'FuncDecl') { result.push(node); walk(node.body); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const v of Object.values(node)) { if (v && typeof v === 'object') walk(v); }
  }
  walk(ast);
  return result;
}

// Collect all VarDecls tagged _isRuntimeImport (top-level + inside NamespacedDecl)
function collectAllImportDecls(ast) {
  const result = [];
  for (const decl of ast.body) {
    if (decl.kind === 'VarDecl' && decl._isRuntimeImport) {
      result.push(decl);
    } else if (decl.kind === 'NamespacedDecl' && decl.inner?._isRuntimeImport) {
      result.push(decl.inner);
    }
  }
  return result;
}

// ── buildWAT — Typed AST → S-expr tree ───────────────────────────────────────

export function buildWAT(ast, { debug = false } = {}) {
  const b            = new SExprBuilder();
  const funcs        = collectAllFuncDecls(ast);
  const importDecls  = collectAllImportDecls(ast);
  const importCount  = importDecls.length + (debug ? 1 : 0);
  const stmtMap      = new Map();
  let   stmtCounter  = 0;

  const funcIndex = new Map();
  importDecls.forEach((d, i) => funcIndex.set(d._type._mangledName, i));
  funcs.forEach((f, i)       => funcIndex.set(f.name, importCount + i));

  const signatures = [];
  const sigIndex   = new Map();
  function getSig(params, result) {
    const key = params.join(',') + ':' + result;
    if (!sigIndex.has(key)) { sigIndex.set(key, signatures.length); signatures.push({ params, result }); }
    return sigIndex.get(key);
  }
  importDecls.forEach(d => getSig(
    d._type.paramTypes.map(p => canonType(p)),
    canonType(d._type.returnType),
  ));
  if (debug) getSig(['i32'], 'void');
  funcs.forEach(f => getSig(f.params.map(p => canonType(p.typeAnnot)), canonType(f.returnType)));

  const closeModule = b.openList('module');

  // ── type section ───────────────────────────────────────────────────────────
  signatures.forEach((sig, i) => {
    const funcNode = ['func', ...sig.params.map(p => ['param', p]),
      ...(sig.result !== 'void' ? [['result', sig.result]] : [])];
    b.push(['type', `$t${i}`, funcNode]);
  });

  // ── imports ────────────────────────────────────────────────────────────────
  importDecls.forEach(d => {
    const params = d._type.paramTypes.map(p => canonType(p));
    const result = canonType(d._type.returnType);
    b.push(['import', d._type._wasmModule, d._type._wasmField, [
      'func', `$${d._type._mangledName}`,
      ...params.map(p => ['param', p]),
      ...(result !== 'void' ? [['result', result]] : []),
    ]]);
  });
  if (debug) {
    b.push(['import', 'dbg', 'brk', ['func', '$__dbg', ['param', 'i32']]]);
  }

  // ── memory + shadow-stack global ──────────────────────────────────────────
  b.push(['memory', 1]);
  b.push(['global', '$__sp', ['mut', 'i32'], ['i32.const', HEAP_BASE]]);

  // ── table + elem ───────────────────────────────────────────────────────────
  if (funcs.length > 0) {
    b.push(['table', funcs.length, 'funcref']);
    b.push(['elem', ['i32.const', 0], 'func', ...funcs.map(f => `$${f.name}`)]);
  }

  // ── exports ────────────────────────────────────────────────────────────────
  b.push(['export', 'memory', ['memory', 0]]);
  funcs.forEach(f => b.push(['export', f.name, ['func', `$${f.name}`]]));

  // ── function bodies ────────────────────────────────────────────────────────
  const dbgCtx = { stmtMap, inject: debug, nextId() { return stmtCounter++; } };
  funcs.forEach(f => emitFunc(b, f, funcIndex, sigIndex, importCount, dbgCtx));

  closeModule();
  const wasmImports = importDecls.map(d => ({
    module:      d._type._wasmModule,
    field:       d._type._wasmField,
    mangledName: d._type._mangledName,
  }));
  return { module: b.root, sSpans: b.sSpans, stmtMap, wasmImports };
}
