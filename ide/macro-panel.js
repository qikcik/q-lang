// ide/macro-panel.js — Multi-panel macro expansion viewer
//
// Manages a row of side-by-side expansion panels, each showing a virtual
// SourceBuffer via <qlang-source-view>.  Panels display expanded macro code
// with +lens buttons for nested macro calls (same mechanism as main editor).
//
// After recompile: all panels close, user reopens via +lens.
// Inner macro calls use +lens (not header pills) — unified mechanism.
//
// Exports:
//   initMacroPanels()
//   updateMacroLenses(expLog)                  — called after each compile
//   openExpansion(info, expLog)                — open or focus a panel
//   closePanelForSource(sourceId)
//   closeAllPanels()
//   revealInPanel(sourceId, start, end, className)
//   getOpenPanelSourceIds()                    → string[]
//   findInfoBySourceId(sourceId, expLog)       → expansionInfo | null

import { buildHoverData } from './hover.js';
import { registerSource, unregisterSource, getView, registerView } from './source-registry.js';
import { addBp, removeBp, hasBp, getBpLines } from './debugger.js';
import { clearAll, setOnMissingView, highlightNodeChain, enclosingStmt,
         highlightAstForNode, highlightWatForNode, highlightBytecodeForNode } from './highlight.js';

// ── DOM refs (set by initMacroPanels) ─────────────────────────────────────────

let _panelsRow     = null;   // #macro-panels-row
let _lensLayer     = null;   // #macro-lens-layer (inside main-sv)
let _editorEl      = null;   // #editor (for scroll + lineHeight)

// ── State ─────────────────────────────────────────────────────────────────────

// Map<sourceId, { panelEl, sv, info }>
const _openPanels = new Map();

let _lastExpLog = null;   // last expansion log from compile

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMacroPanels(panelsRow, lensLayer, editorEl) {
  _panelsRow = panelsRow;
  _lensLayer = lensLayer;
  _editorEl  = editorEl;

  if (_editorEl) {
    _editorEl.addEventListener('scroll', _positionLensButtons);
  }

  // Auto-open panel when highlight.js targets a macro source that has no view yet
  setOnMissingView(sourceId => {
    if (!sourceId.startsWith('macro:') || !_lastExpLog) return;
    const info = findInfoBySourceId(sourceId, _lastExpLog);
    if (info) openExpansion(info, _lastExpLog);
  });
}

// ── Macro lens UI ─────────────────────────────────────────────────────────────

export function updateMacroLenses(expLog) {
  _lastExpLog = expLog ?? null;

  // Always close all panels on recompile — user reopens via +lens
  closeAllPanels();

  if (!_lensLayer) return;
  _lensLayer.replaceChildren();

  if (!expLog) return;

  // Only show lenses for top-level expansions (callSite.sourceId === 'main')
  const byLine = new Map();
  for (const [, info] of expLog) {
    if (info.source?.callSite?.sourceId !== 'main') continue;
    byLine.set(info.callLine, info);
  }

  for (const [, info] of byLine) {
    const btn = document.createElement('button');
    btn.className        = 'macro-lens-btn';
    btn.textContent      = '+';
    btn.title            = `Expand ${info.name}!(${info.macroSig})`;
    btn.dataset.sourceId = info.source?.id ?? '';
    btn.style.right      = '8px';
    _positionBtn(btn, info.callLine);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sourceId = btn.dataset.sourceId;
      if (_openPanels.has(sourceId)) {
        closePanelForSource(sourceId);
      } else {
        openExpansion(info, _lastExpLog);
      }
      _syncLensBtnStates();
    });
    _lensLayer.appendChild(btn);
  }

  _syncLensBtnStates();
}

function _positionBtn(btn, callLine) {
  if (!_editorEl) return;
  const style  = getComputedStyle(_editorEl);
  const lineH  = parseFloat(style.lineHeight);
  const padTop = parseFloat(style.paddingTop);
  const top    = padTop + (callLine - 1) * lineH - _editorEl.scrollTop;
  btn.style.top = (top + lineH / 2 - 9) + 'px';
}

function _positionLensButtons() {
  if (!_lensLayer) return;
  for (const btn of _lensLayer.children) {
    // Re-read callLine from the matching info in last expLog
    const sourceId = btn.dataset.sourceId;
    if (!sourceId || !_lastExpLog) continue;
    const info = findInfoBySourceId(sourceId, _lastExpLog);
    if (info) _positionBtn(btn, info.callLine);
  }
}

function _syncLensBtnStates() {
  if (!_lensLayer) return;
  for (const btn of _lensLayer.children) {
    btn.classList.toggle('active', _openPanels.has(btn.dataset.sourceId));
  }
}

// ── Panel management ──────────────────────────────────────────────────────────

/**
 * Open (or re-use) a panel for the given expansion info.
 * If a panel for info.source.id already exists, just focuses it.
 * Panels display source code with +lens buttons for nested macro calls
 * (same mechanism as main editor).
 */
export function openExpansion(info, expLog) {
  if (!_panelsRow || !info?.source) return null;
  const sourceId = info.source.id;

  if (_openPanels.has(sourceId)) {
    _openPanels.get(sourceId).panelEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return _openPanels.get(sourceId).sv;
  }

  // Build hover data for this virtual file
  // Use preExpBody (pre-expansion) so that nested MacroCallStmt nodes
  // have src_start/src_end matching the displayed bodySource text.
  // expandedBody would have inner-macro nodes with positions in inner sources.
  const bodyForHover = info.preExpBody ?? info.expandedBody ?? [];
  const hoverData = buildHoverData(
    info.source.tokens,
    { kind: 'Program', body: bodyForHover },
    null,
    n => ({ start: n.src_start ?? n.start, end: n.src_end ?? n.end }),
  );

  const vfText = info.source.text ?? '';

  // Create panel DOM
  const panelEl = document.createElement('div');
  panelEl.className = 'macro-panel';
  panelEl.dataset.sourceId = sourceId;

  const header = document.createElement('div');
  header.className = 'macro-panel-header';

  const title = document.createElement('span');
  title.className   = 'macro-panel-title';
  title.textContent = sourceId;   // canonical path, e.g. macro:for_each:main:42
  title.title       = `${info.name}!(${info.macroSig})`;  // definition on hover

  const closeBtn = document.createElement('button');
  closeBtn.className   = 'macro-panel-close';
  closeBtn.textContent = '✕';
  closeBtn.title       = 'Close panel';
  closeBtn.addEventListener('click', () => {
    closePanelForSource(sourceId);
    _syncLensBtnStates();
  });

  header.append(title, closeBtn);

  // Body: source-view + inner lens layer
  const body = document.createElement('div');
  body.className = 'macro-panel-body';
  body.style.position = 'relative';

  const sv = document.createElement('qlang-source-view');
  body.appendChild(sv);

  // Inner lens layer for nested macro calls (same +lens mechanism as main editor)
  const innerLensLayer = document.createElement('div');
  innerLensLayer.className = 'macro-lens-layer';
  body.appendChild(innerLensLayer);

  panelEl.append(header, body);
  _panelsRow.appendChild(panelEl);
  _panelsRow.style.display = 'flex';

  sv.setContent(vfText, hoverData);

  // Add inner +lens buttons for nested macro calls in this expansion
  _addInnerLenses(innerLensLayer, sv, sourceId, expLog);

  // BP gutter
  sv.setBpLines(getBpLines(sourceId));
  sv.addEventListener('sv-gutter-click', e => {
    const line = e.detail.line;
    if (hasBp(sourceId, line)) removeBp(sourceId, line);
    else addBp(sourceId, line);
    sv.setBpLines(getBpLines(sourceId));
  });

  // Node click: highlight the clicked node and its full canonical ancestry chain
  sv.addEventListener('sv-node-click', e => {
    const clickedNode = e.detail.node;
    if (!clickedNode) return;
    clearAll();
    highlightNodeChain(clickedNode);
    highlightAstForNode(clickedNode);
    const stmt = enclosingStmt(clickedNode);
    highlightWatForNode(stmt);
    highlightBytecodeForNode(stmt);
  });

  registerSource(info.source, sv);
  registerView(sourceId, sv);

  _openPanels.set(sourceId, { panelEl, sv, info });
  _syncLensBtnStates();
  return sv;
}

export function closePanelForSource(sourceId) {
  const entry = _openPanels.get(sourceId);
  if (!entry) return;
  entry.panelEl.remove();
  unregisterSource(sourceId);
  _openPanels.delete(sourceId);
  if (_openPanels.size === 0 && _panelsRow) {
    _panelsRow.style.display = 'none';
  }
}

export function closeAllPanels() {
  for (const sourceId of [..._openPanels.keys()]) {
    closePanelForSource(sourceId);
  }
}

/** Apply a highlight range in an already-open panel without scrolling. */
export function revealInPanel(sourceId, start, end, className = 'sv-hl-rect') {
  const entry = _openPanels.get(sourceId);
  if (!entry) return;
  entry.sv.addHighlightRange(start, end, className);
}

/** Scroll + focus the panel for sourceId (make it visible). */
export function focusPanel(sourceId) {
  const entry = _openPanels.get(sourceId);
  if (!entry) return;
  entry.panelEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

export function clearAllPanelHighlights() {
  for (const { sv } of _openPanels.values()) sv.clearHighlight();
}

export function getOpenPanelSourceIds() {
  return [..._openPanels.keys()];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find expansion info by sourceId.  Prefers exact match; falls back to prefix. */
export function findInfoBySourceId(sourceId, expLog) {
  if (!expLog || !sourceId) return null;
  // Exact match first (fast path — canonical refs now carry full sourceIds)
  for (const [, info] of expLog) {
    if (info.source?.id === sourceId) return info;
  }
  // Prefix fallback for short labels (e.g. 'macro:name' from legacy callers)
  for (const [, info] of expLog) {
    if (info.source?.id?.startsWith(sourceId + ':')) return info;
  }
  return null;
}

/**
 * Add +lens buttons for nested macro calls inside a panel's source-view.
 * Scans expLog for entries whose callSite.sourceId === this panel's sourceId.
 * Same visual mechanism as main editor lenses, but positioned inside the panel.
 */
function _addInnerLenses(lensLayer, sv, parentSourceId, expLog) {
  if (!expLog || !lensLayer) return;

  const innerInfos = [];
  for (const [, innerInfo] of expLog) {
    if (innerInfo.source?.callSite?.sourceId !== parentSourceId) continue;
    innerInfos.push(innerInfo);
  }

  for (const innerInfo of innerInfos) {
    const btn = document.createElement('button');
    btn.className        = 'macro-lens-btn';
    btn.textContent      = '+';
    btn.title            = `Expand ${innerInfo.name}!(${innerInfo.macroSig})`;
    btn.dataset.sourceId = innerInfo.source?.id ?? '';
    btn.style.right      = '8px';

    // Position relative to the panel's source-view
    const callLineInParent = _callLineInSource(innerInfo, parentSourceId);
    if (callLineInParent > 0) {
      _positionBtnInSv(btn, callLineInParent, sv);
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sid = btn.dataset.sourceId;
      if (_openPanels.has(sid)) {
        closePanelForSource(sid);
      } else {
        openExpansion(innerInfo, _lastExpLog ?? expLog);
      }
      _syncLensBtnStates();
    });
    lensLayer.appendChild(btn);
  }
}

/** Get the 1-based line of a macro call inside its parent source. */
function _callLineInSource(info, parentSourceId) {
  // The callLine in info is from the original source. For nested expansions
  // we need the line relative to the parent's virtual source.
  if (!info.source?.callSite) return info.callLine;
  const cs = info.source.callSite;
  if (cs.sourceId !== parentSourceId) return info.callLine;
  // Compute line from offset in parent source text
  const parentInfo = findInfoBySourceId(parentSourceId, _lastExpLog);
  if (parentInfo?.source?.text) {
    const text = parentInfo.source.text;
    let line = 1;
    for (let i = 0; i < cs.start && i < text.length; i++) {
      if (text[i] === '\n') line++;
    }
    return line;
  }
  return info.callLine;
}

/** Position a lens button relative to a source-view element. */
function _positionBtnInSv(btn, callLine, sv) {
  const pre = sv.querySelector?.('.sv-pre') ?? sv.querySelector?.('#editor');
  if (!pre) return;
  const style  = getComputedStyle(pre);
  const lineH  = parseFloat(style.lineHeight) || 18;
  const padTop = parseFloat(style.paddingTop) || 0;
  const top    = padTop + (callLine - 1) * lineH;
  btn.style.top      = (top + lineH / 2 - 9) + 'px';
  btn.style.position = 'absolute';
}

/** Refresh BP dots in all open panels (call after clearAllBps). */
export function refreshAllPanelBps() {
  for (const [sourceId, { sv }] of _openPanels) {
    sv.setBpLines(getBpLines(sourceId));
  }
}

/** Build a Map<1-based line, ASTNode> for BP click validation. */
export function buildVfLineIndex(expandedBody, vfText) {
  const map = new Map();
  const lineStarts = [0];
  for (let i = 0; i < vfText.length; i++) {
    if (vfText[i] === '\n') lineStarts.push(i + 1);
  }
  function lineOf(off) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }
  function walkBody(nodes) {
    for (const n of nodes ?? []) {
      if (n.kind === 'ScopeBlock' || n.kind === 'MacroExpansionNode') { walkBody(n.body); continue; }
      const off = n.src_start ?? n.start;
      if (off != null) { const line = lineOf(off); if (!map.has(line)) map.set(line, n); }
    }
  }
  walkBody(expandedBody);
  return map;
}
