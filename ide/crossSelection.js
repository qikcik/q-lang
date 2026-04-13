// crossSelection.js — thin re-export shim
//
// All highlight logic (click handlers, stmtMap, node-level exports) now lives
// in highlight.js.  This module re-exports the public API so existing callers
// (main.js, debugger.js) need no import changes.

export {
  setStmtMap,
  enclosingStmt,
  clearAll             as clearHighlights,
  clearAllSourceHighlights as clearSourceHighlight,
  highlightBytecodeForNode,
  highlightWatForNode,
  highlightAstForNode,
} from './highlight.js';

import { applyChainHighlights } from './highlight.js';

/** Backward-compat wrapper so main.js can call highlightSourceRange(sid, s, e). */
export function highlightSourceRange(sourceId, start, end) {
  applyChainHighlights([{ sourceId: sourceId ?? 'main', startLine: 0, startCol: start, endLine: 0, endCol: end }], 0);
}


