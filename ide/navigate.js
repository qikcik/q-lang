// ide/navigate.js — Universal canonical-ref navigation
//
// navigateToRef(refStr, expLog):
//   1. Parse the canonical ref string into segments.
//   2. Resolve each short sourceId (e.g. 'macro:for_each') to the full
//      registered ID (e.g. 'macro:for_each:main:42') via findInfoBySourceId.
//   3. Ensure macro panels are open for each resolved sourceId.
//   4. Delegate all highlight work to applyChainHighlights in highlight.js.
//   5. Show the floating nav-bar.
//
// NavCursor tracks which segment is "active" for prev/next navigation.

import { parseCanonicalRef } from '../compiler/source-ref.js';
import { openExpansion, findInfoBySourceId } from './macro-panel.js';
import { applyChainHighlights, clearAllSourceHighlights } from './highlight.js';
import { showNavBar, updateNavBar, hideNavBar } from './nav-bar.js';

// ── Nav cursor ────────────────────────────────────────────────────────────────

/** @type {{ segments: object[], activeIdx: number } | null} */
let _cursor = null;

export function clearNav() {
  _cursor = null;
  clearAllSourceHighlights();
  hideNavBar();
}

export function navNext() {
  if (!_cursor || _cursor.activeIdx >= _cursor.segments.length - 1) return;
  _cursor.activeIdx++;
  applyChainHighlights(_cursor.segments, _cursor.activeIdx);
  updateNavBar(_cursor);
}

export function navPrev() {
  if (!_cursor || _cursor.activeIdx <= 0) return;
  _cursor.activeIdx--;
  applyChainHighlights(_cursor.segments, _cursor.activeIdx);
  updateNavBar(_cursor);
}

export function getCursor() { return _cursor; }

// ── Core navigation ───────────────────────────────────────────────────────────

/**
 * Navigate to all source positions described by a canonical ref string.
 * Opens all macro panels along the expansion chain and highlights each segment.
 *
 * @param {string} refStr  — e.g. "main[8:10-8:20]/macro:for_each:main:42[3:4-3:14]"
 * @param {Map}    expLog  — expansion log from last compile (may be null)
 */
export function navigateToRef(refStr, expLog) {
  if (!refStr) return;

  const segments = parseCanonicalRef(refStr);
  if (!segments || segments.length === 0) return;

  // Ensure all macro panels along the chain are open.
  for (const seg of segments) {
    if (seg.sourceId === 'main') continue;
    const info = findInfoBySourceId(seg.sourceId, expLog);
    if (info) openExpansion(info, expLog);
  }

  _cursor = { segments, activeIdx: segments.length - 1 };
  applyChainHighlights(segments, _cursor.activeIdx);
  showNavBar(_cursor);
}
