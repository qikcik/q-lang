// ide/highlight.js — Central highlight coordinator
//
// Single module that knows the DOM representation of all views.
// crossSelection.js, navigate.js, and debugger.js all delegate to it.
//
// Exports:
//   initHighlight({ outAst, watRoot, outBytecode })
//   highlightAndScrollSource(sourceId, start, end, cls?)
//   addSourceHighlight(sourceId, start, end, cls?)
//   clearSourceHighlight(sourceId)
//   clearAllSourceHighlights()
//   highlightNodeChain(node)           — highlight full __src ancestry at once
//   nodeToChainSegments(node)          — build segment list from __src ancestry
//   applyChainHighlights(segments, activeIdx)
//   highlightAst(astNode)
//   highlightAstWithStmt(astNode, stmtNode)
//   highlightWat(stmtNode)
//   highlightBytecode(astNode)
//   clearAstHighlight()
//   clearWatHighlight()
//   clearBytecodeHighlight()
//   clearAll()
//
// Import chain: highlight.js → source-registry.js, compiler/source.js, ide-state.js  (no cycle)

import { getView, getAllSourceIds } from './source-registry.js';
import { srcStart, srcEnd } from '../compiler/source.js';
import { getExpLog } from './ide-state.js';

// ── DOM refs (set via initHighlight) ─────────────────────────────────────────

let _outAst      = null;
let _watRoot     = null;
let _outBytecode = null;
let _onMissingView = null;   // callback(sourceId) — auto-open a panel for the given source

export function setOnMissingView(fn) { _onMissingView = fn; }

export function initHighlight({ outAst, watRoot, outBytecode }) {
  _outAst      = outAst;
  _watRoot     = watRoot;
  _outBytecode = outBytecode;
  _registerClickHandlers();
}

// ── Stmt map (enclosingStmt, used by click handlers and external callers) ─────

let _lastStmtMap = null;

export function setStmtMap(map) { _lastStmtMap = map; }

export function enclosingStmt(node) {
  if (!_lastStmtMap || !node || node.start == null) return node;
  let best = null;
  for (const stmt of _lastStmtMap.values()) {
    if (stmt.start <= node.start && node.end <= stmt.end) {
      if (!best || (stmt.end - stmt.start) < (best.end - best.start)) best = stmt;
    }
  }
  return best ?? node;
}

// ── Source highlights ─────────────────────────────────────────────────────────

/**
 * Scroll a source view to the offset position, then after the browser has
 * painted (rAF) draw the highlight rect.  This ensures the rects are computed
 * after scrolling so they land at the right viewport-relative position.
 */
export function highlightAndScrollSource(sourceId, start, end, cls = 'sv-hl-active') {
  let view = getView(sourceId);
  if (!view && _onMissingView) {
    _onMissingView(sourceId);
    view = getView(sourceId);
  }
  if (!view) return;
  view.clearHighlight();
  view.scrollToOffset?.(start);
  requestAnimationFrame(() => {
    view.addHighlightRange(start, end, cls);
  });
}

/** Add a highlight without scrolling (used for dimmed chain segments). */
export function addSourceHighlight(sourceId, start, end, cls = 'sv-hl-rect') {
  let view = getView(sourceId);
  if (!view && _onMissingView) {
    _onMissingView(sourceId);
    view = getView(sourceId);
  }
  view?.addHighlightRange(start, end, cls);
}

/** Clear highlight overlay for one source view. */
export function clearSourceHighlight(sourceId) {
  getView(sourceId)?.clearHighlight();
}

/** Clear highlight overlays for every registered source view. */
export function clearAllSourceHighlights() {
  for (const id of getAllSourceIds()) {
    getView(id)?.clearHighlight();
  }
}

// ── Chain highlight (for canonical-ref navigation) ────────────────────────────

/**
 * Build offset-based chain segments from an AST node's __src ancestry.
 * Returns array from outermost (main) to innermost (deepest).
 * Segments use startLine=0 → _segToOffsets treats startCol/endCol as raw offsets.
 */
export function nodeToChainSegments(node) {
  if (!node) return [];

  const chain = [];  // built innermost-first, reversed at end

  const innermostSrc = node.__src;
  if (innermostSrc) {
    chain.push({
      sourceId:  innermostSrc.id,
      startLine: 0, startCol: srcStart(node),
      endLine:   0, endCol:   srcEnd(node),
    });

    let cur = innermostSrc;
    while (cur?.callSite) {
      const cs = cur.callSite;
      chain.push({
        sourceId:  cs.sourceId ?? 'main',
        startLine: 0, startCol: cs.start,
        endLine:   0, endCol:   cs.end,
      });
      cur = cs.source;
      if (!cur || cur.kind === 'user') break;
    }
  } else {
    const s = node.src_start ?? node.start;
    const e = node.src_end   ?? node.end ?? s;
    chain.push({ sourceId: 'main', startLine: 0, startCol: s, endLine: 0, endCol: e });
  }

  // Outermost first: chain[0] = main, chain[last] = innermost
  chain.reverse();
  return chain;
}

/**
 * Highlight all source views in the node's canonical ancestry chain
 * simultaneously: innermost view is active (scrolled), parents are dimmed.
 * Auto-opens missing macro panels via _onMissingView.
 */
export function highlightNodeChain(node) {
  if (!node) return;
  const segments = nodeToChainSegments(node);
  if (segments.length === 0) return;

  // Ensure all macro panels in the chain are open
  const expLog = getExpLog();
  if (expLog && _onMissingView) {
    for (const seg of segments) {
      if (seg.sourceId !== 'main' && !getView(seg.sourceId)) {
        _onMissingView(seg.sourceId);
      }
    }
  }

  // Innermost (last segment) is active
  applyChainHighlights(segments, segments.length - 1);
}

/**
 * Apply dimmed highlights on all segments and an active highlight on the
 * segment at activeIdx.  The active segment is also scrolled into view.
 *
 * @param {Array<{sourceId:string, startLine:number, startCol:number,
 *                endLine:number, endCol:number}>} segments
 * @param {number} activeIdx
 */
export function applyChainHighlights(segments, activeIdx) {
  clearAllSourceHighlights();

  // Scroll the active view immediately so the layout is already stable when
  // getBoundingClientRect() is called inside addHighlightRange below.
  const active = segments[activeIdx];
  if (active) {
    const view = getView(active.sourceId);
    if (view) {
      const { start } = _segToOffsets(view, active);
      view.scrollToOffset?.(start);
    }
  }

  // Draw all highlight rects (dimmed + active) in one rAF so the browser has
  // completed layout before we ask for bounding-rect positions.
  requestAnimationFrame(() => {
    for (let i = 0; i < segments.length; i++) {
      const seg  = segments[i];
      const view = getView(seg.sourceId);
      if (!view) continue;
      const { start, end } = _segToOffsets(view, seg);
      view.addHighlightRange(start, end, i === activeIdx ? 'sv-hl-active' : 'sv-hl-dimmed');
    }
  });
}

/**
 * Convert a segment's line:col coordinates to char offsets in the view's text.
 * If startLine is 0 the segment is already offset-based.
 */
function _segToOffsets(view, seg) {
  if (seg.startLine === 0) {
    return { start: seg.startCol, end: seg.endCol };
  }

  const text = view.getText?.() ?? '';
  if (!text) return { start: seg.startCol, end: seg.endCol };

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }

  const start0 = seg.startLine - 1;
  const end0   = seg.endLine   - 1;

  const start = (lineStarts[start0] ?? 0) + seg.startCol - 1;
  const end   = (lineStarts[end0]   ?? 0) + seg.endCol   - 1;
  return { start, end };
}

// ── AST highlights ────────────────────────────────────────────────────────────

export function highlightAst(astNode) {
  if (!_outAst || !astNode) {
    if (!_outAst) console.warn('[highlight] highlightAst: _outAst not initialized');
    return;
  }
  clearAstHighlight();
  _outAst.querySelectorAll('[data-start]').forEach(el => {
    if (el._astNode === astNode) {
      el.classList.add('ast-highlight');
    }
  });
  const firstMatch = _outAst.querySelector('.ast-highlight');
  if (firstMatch) {
    let p = firstMatch.parentElement;
    while (p && p !== _outAst) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
    firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function highlightAstWithStmt(astNode, stmtNode) {
  if (!_outAst) {
    console.warn('[highlight] highlightAstWithStmt: _outAst not initialized');
    return;
  }
  clearAstHighlight();
  let scrollTarget = null;
  _outAst.querySelectorAll('[data-start]').forEach(el => {
    if (el._astNode === astNode) {
      el.classList.add('ast-highlight');
      if (!scrollTarget) scrollTarget = el;
    }
    if (stmtNode && el._astNode === stmtNode) {
      el.classList.add('ast-stmt-highlight');
      if (!scrollTarget) scrollTarget = el;
    }
  });
  if (scrollTarget) {
    let p = scrollTarget.parentElement;
    while (p && p !== _outAst) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
    scrollTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function clearAstHighlight() {
  _outAst?.querySelectorAll('.ast-highlight, .ast-stmt-highlight').forEach(el => {
    el.classList.remove('ast-highlight', 'ast-stmt-highlight');
  });
}

// ── WAT highlights ────────────────────────────────────────────────────────────

export function highlightWat(stmtNode) {
  if (!_watRoot || !stmtNode) {
    if (!_watRoot) console.warn('[highlight] highlightWat: _watRoot not initialized');
    return;
  }
  clearWatHighlight();
  let firstMatch = null;
  _watRoot.querySelectorAll('.wat-line').forEach(el => {
    if (el._astNode === stmtNode) {
      el.classList.add('wat-highlight');
      let p = el.parentElement;
      while (p && p !== _watRoot) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
      if (!firstMatch) firstMatch = el;
    }
  });
  if (firstMatch) firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function clearWatHighlight() {
  _watRoot?.querySelectorAll('.wat-highlight').forEach(el => el.classList.remove('wat-highlight'));
}

// ── Bytecode highlights ───────────────────────────────────────────────────────

export function highlightBytecode(astNode) {
  if (!_outBytecode || !astNode) {
    if (!_outBytecode) console.warn('[highlight] highlightBytecode: _outBytecode not initialized');
    return;
  }
  clearBytecodeHighlight();
  let firstMatch = null;
  _outBytecode.querySelectorAll('.bc-byte').forEach(el => {
    if (el._astNode === astNode) {
      el.classList.add('bc-highlight');
      if (!firstMatch) firstMatch = el;
    }
  });
  if (firstMatch) firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function clearBytecodeHighlight() {
  _outBytecode?.querySelectorAll('.bc-highlight').forEach(el => el.classList.remove('bc-highlight'));
}

// ── Clear all ─────────────────────────────────────────────────────────────────

export function clearAll() {
  clearAllSourceHighlights();
  clearAstHighlight();
  clearWatHighlight();
  clearBytecodeHighlight();
}

// ── Node-level highlight exports (used by debugger.js and crossSelection shim) ─

export function highlightBytecodeForNode(node)  { highlightBytecode(node); }
export function highlightWatForNode(node)       { highlightWat(node); }
export function highlightAstForNode(node)       {
  if (!node) return;
  highlightAstWithStmt(node, enclosingStmt(node));
}

// ── Click handlers (registered inside initHighlight) ─────────────────────────

function _registerClickHandlers() {
  _outAst.addEventListener('click', _onAstClick);
  _watRoot.addEventListener('click', _onWatClick);
  _outBytecode.addEventListener('click', _onBytecodeClick);
}

function _onAstClick(e) {
  const el = e.target.closest('[data-start]');
  if (!el) return;
  clearAll();
  el.classList.add('ast-highlight');

  const astNode = el._astNode;
  if (astNode) {
    const stmtNode = enclosingStmt(astNode);
    _outAst.querySelectorAll('[data-start]').forEach(candidate => {
      if (candidate._astNode === stmtNode) candidate.classList.add('ast-stmt-highlight');
    });
    highlightWat(stmtNode);
    highlightBytecode(stmtNode);
    highlightNodeChain(astNode);
  } else {
    applyChainHighlights([{ sourceId: 'main', startLine: 0, startCol: +el.dataset.start, endLine: 0, endCol: +el.dataset.end }], 0);
  }
}

function _onWatClick(e) {
  if (_watRoot.hasAttribute('data-stale')) return;
  const lineEl = e.target.closest('.wat-line');
  if (!lineEl || !lineEl._astNode) return;
  const stmtNode = lineEl._astNode;
  clearAll();
  highlightWat(stmtNode);
  highlightBytecode(stmtNode);
  highlightAstWithStmt(stmtNode, stmtNode);
  highlightNodeChain(stmtNode);
}

function _onBytecodeClick(e) {
  if (_outBytecode.hasAttribute('data-stale')) return;
  const byteEl = e.target.closest('.bc-byte');
  if (!byteEl) return;
  const node = byteEl._astNode;
  if (!node || node.start == null) return;
  clearAll();
  highlightBytecode(node);
  highlightAstWithStmt(node, enclosingStmt(node));
  highlightWat(node);
  highlightNodeChain(node);
}
