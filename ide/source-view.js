// -----------------------------------------------------------------------------
// ide/source-view.js � <qlang-source-view> Web Component (Light DOM)
//
// A unified source buffer component used in two modes:
//
//   editable  (main editor):
//     Creates #editor (contenteditable pre) + sv-gutter (line nums + BP dots)
//     + #src-overlay.  Pre-existing DOM children (macro-lens-layer, macro-
//     expand-panel) are adopted into sv-body so they stay position-relative
//     to the editing surface.
//
//   read-only  (macro expand panel, future tabs):
//     Creates sv-pre (syntax-highlighted pre) + sv-gutter (line nums, no BPs)
//     + sv-overlay.  Container (#macro-expand-body) owns scrolling.
//
// JS API (same in both modes unless noted):
//   setText(src, errorRanges?)   editable: update highlighted content
//                                (caller saves/restores caret via editor.js)
//   setContent(text, hoverData?) read-only: set text + hover data at once
//   set hoverData(entries)       update hover entries independently
//   setBpLines(Set<number>)      editable: refresh breakpoint dots in gutter
//   highlightRange(start, end)   draw overlay highlight rects
//   highlightNode(astNode)       highlight via start_gen ?? start
//   clearHighlight()
//
// Events dispatched (bubbling):
//   'sv-gutter-click'  detail: { line: number }   (editable only)
//   'sv-node-click'    detail: { node: ASTNode|null }
//
// Import chain: source-view.js imports views.js only.
// editor.js is NOT imported here; caret management stays in main.js/lsp.js.
// -----------------------------------------------------------------------------

import { syntaxHighlight } from './views.js';

// Shared tooltip lives in static HTML, always present before modules run.
const typeTooltip = document.getElementById('type-tooltip');

// -- WebComponent --------------------------------------------------------------

class QLangSourceView extends HTMLElement {
  static get observedAttributes() { return ['editable']; }

  constructor() {
    super();
    this._hoverData    = [];
    this._bpLines      = new Set();  // Set<number> � lines with active BPs
    this._pre          = null;       // #editor (editable) or .sv-pre (read-only)
    this._overlay      = null;       // #src-overlay (editable) or .sv-overlay (ro)
    this._gutter       = null;       // .sv-gutter
    this._body         = null;       // .sv-body
    this._built        = false;    this._text         = null;       // raw source text (for getText / _lineColToOffset)
    this._onMousemove   = this._handleMousemove.bind(this);
    this._onMouseleave  = this._handleMouseleave.bind(this);
    this._onClick       = this._handleClick.bind(this);
    this._onGutterClick = this._handleGutterClick.bind(this);
    this._onScroll      = () => {
      if (this._gutter && this._pre) this._gutter.scrollTop = this._pre.scrollTop;
    };
    this._storedHighlights = [];
    this._resizeObserver   = null;
    this._onScrollHL       = null;
  }

  get editable() { return this.hasAttribute('editable'); }

  connectedCallback() {
    if (!this._built) { this._build(); this._built = true; }
  }

  disconnectedCallback() {
    this._teardown();
  }

  // -- DOM construction ----------------------------------------------------

  _build() {
    const isEditable = this.editable;
    this.classList.add(isEditable ? 'sv-editable' : 'sv-readonly');

    // Adopt pre-existing children (e.g. macro-lens-layer, macro-expand-panel)
    // into sv-body before replaceChildren wipes this element's child list.
    const slotted = [...this.children];

    // Gutter (line number column)
    this._gutter = document.createElement('div');
    this._gutter.className = 'sv-gutter';
    this._gutter.addEventListener('click', this._onGutterClick);

    // Body (holds the pre + overlay + any slotted macro elements)
    this._body = document.createElement('div');
    this._body.className = 'sv-body';

    // Content pre
    this._pre = document.createElement('pre');
    if (isEditable) {
      this._pre.id              = 'editor';
      this._pre.contentEditable = 'true';
      this._pre.spellcheck      = false;
      this._pre.setAttribute('autocorrect',    'off');
      this._pre.setAttribute('autocomplete',   'off');
      this._pre.setAttribute('autocapitalize', 'off');
    } else {
      this._pre.className = 'sv-pre';
    }

    // Overlay (highlight rect divs live here)
    this._overlay = document.createElement('div');
    if (isEditable) {
      this._overlay.id = 'src-overlay';  // crossSelection.js finds it by ID
    }
    this._overlay.className = 'sv-overlay';

    // Wire body: pre first, then overlay, then adopted macro-layer children
    this._body.append(this._pre, this._overlay, ...slotted);
    this.replaceChildren(this._gutter, this._body);

    // Event listeners on content pre
    this._pre.addEventListener('mousemove',  this._onMousemove);
    this._pre.addEventListener('mouseleave', this._onMouseleave);
    this._pre.addEventListener('click',      this._onClick);
    if (isEditable) this._pre.addEventListener('scroll', this._onScroll);
    // Redraw highlights on scroll (fixes overlay position desync after manual scroll)
    this._onScrollHL = () => requestAnimationFrame(() => this._redrawHighlights());
    this._pre.addEventListener('scroll', this._onScrollHL);
    // Redraw on resize (panels are resizable)
    this._resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this._redrawHighlights()));
    this._resizeObserver.observe(this._pre);
  }

  _teardown() {
    if (this._pre) {
      this._pre.removeEventListener('mousemove',  this._onMousemove);
      this._pre.removeEventListener('mouseleave', this._onMouseleave);
      this._pre.removeEventListener('click',      this._onClick);
      if (this.editable) this._pre.removeEventListener('scroll', this._onScroll);
      if (this._onScrollHL) this._pre.removeEventListener('scroll', this._onScrollHL);
    }
    this._resizeObserver?.disconnect();
    if (this._gutter) {
      this._gutter.removeEventListener('click', this._onGutterClick);
    }
    if (typeTooltip) typeTooltip.style.display = 'none';
  }

  // -- Content API ---------------------------------------------------------

  /**
   * Editable mode: replace syntax-highlighted content.
   * Caller saves/restores caret position using getCaretOffset/setCaretOffset.
   */
  setText(src, errorRanges = null) {
    if (!this._pre) return;
    this._text = src;
    this._pre.innerHTML = syntaxHighlight(src, errorRanges);
    this._syncGutter(src);
  }

  /** Read-only mode: set content and hover data in one call. */
  setContent(text, hoverData = []) {
    this._hoverData = hoverData ?? [];
    if (!this._pre) return;
    this._text = text;
    this._pre.innerHTML = syntaxHighlight(text);
    this._syncGutter(text);
  }

  /** Return the raw source text set via setText / setContent. */
  getText() { return this._text ?? this._pre?.textContent ?? ''; }

  /**
   * Scroll the nearest scrollable ancestor so the character at `offset` is
   * roughly in the upper third of the viewport.  Highlight rects should be
   * added AFTER this call (use requestAnimationFrame).
   */
  scrollToOffset(offset) {
    if (!this._pre) return;
    const loc = _nodeAtOffset(this._pre, offset);
    if (!loc) return;
    const rng = document.createRange();
    rng.setStart(loc.node, loc.off);
    rng.setEnd(loc.node, loc.off);
    const rect  = rng.getBoundingClientRect();
    // Find the nearest scrollable ancestor. In editable mode #editor itself
    // has overflow:auto, so start the search from this._pre (not its parent).
    let container = this._pre;
    while (container && container !== document.body) {
      const { overflowY } = getComputedStyle(container);
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break;
      container = container.parentElement;
    }
    if (container && container !== document.body) {
      const cRect = container.getBoundingClientRect();
      container.scrollTop += rect.top - cRect.top - cRect.height / 3;
    } else {
      window.scrollBy(0, rect.top - window.innerHeight / 3);
    }
  }

  /** Update hover entries independently (editable: after each liveCompile). */
  set hoverData(entries) {
    this._hoverData = entries ?? [];
  }

  /** Editable: refresh breakpoint dots in gutter.  Accepts Set<number>. */
  setBpLines(lineSet) {
    this._bpLines = lineSet ?? new Set();
    this._refreshBpDots();
  }

  // -- Highlight API --------------------------------------------------------

  /** Clear overlay + draw a single highlight rect (backward-compat). */
  highlightRange(start, end, className = 'sv-hl-rect') {
    if (!this._overlay) return;
    this._storedHighlights = [];
    this._overlay.innerHTML = '';
    this._appendToStorage(start, end, className);
  }

  /**
   * Append one highlight rect WITHOUT clearing existing ones.
   * Use 'sv-hl-dimmed' or 'sv-hl-active' for navigation markers.
   */
  addHighlightRange(start, end, className = 'sv-hl-rect') {
    this._appendToStorage(start, end, className);
  }

  /** Replace all highlights at once.  ranges = [{ start, end, className? }] */
  setHighlights(ranges) {
    if (!this._overlay) return;
    this._storedHighlights = [];
    this._overlay.innerHTML = '';
    for (const { start, end, className } of ranges) {
      this._appendToStorage(start, end, className ?? 'sv-hl-rect');
    }
  }

  _appendRect(start, end, className) {
    if (!this._pre || !this._overlay) {
      console.warn('[sv] _appendRect: no _pre or _overlay', { pre: !!this._pre, overlay: !!this._overlay });
      return;
    }
    if (start == null || end == null) {
      console.warn('[sv] _appendRect: null start/end', { start, end });
      return;
    }
    // Unknown range: expand to the whole line instead of 1-char fallback.
    if (end <= start) {
      const text = this._text ?? '';
      const ls = text.lastIndexOf('\n', start - 1) + 1;
      const le = text.indexOf('\n', start);
      start = ls;
      end   = le === -1 ? text.length : le;
      if (end <= start) end = start + 1; // empty line edge case
    }
    const startLoc = _nodeAtOffset(this._pre, start);
    const endLoc   = _nodeAtOffset(this._pre, end);
    if (!startLoc || !endLoc) {
      console.warn('[sv] _appendRect: _nodeAtOffset failed', { start, end, textLen: this._text?.length, startLoc: !!startLoc, endLoc: !!endLoc });
      return;
    }
    const range = document.createRange();
    range.setStart(startLoc.node, startLoc.off);
    range.setEnd(endLoc.node, endLoc.off);
    const preRect = this._pre.getBoundingClientRect();
    const rects = range.getClientRects();
    if (rects.length === 0) {
      console.warn('[sv] _appendRect: empty getClientRects', { start, end });
    }
    for (const r of rects) {
      const div = document.createElement('div');
      div.className    = className;
      div.style.left   = (r.left - preRect.left) + 'px';
      div.style.top    = (r.top  - preRect.top)  + 'px';
      div.style.width  = r.width  + 'px';
      div.style.height = r.height + 'px';
      this._overlay.appendChild(div);
    }
  }

  _appendToStorage(start, end, className) {
    this._storedHighlights.push({ start, end, className });
    this._appendRect(start, end, className);
  }

  _renderFromStorage() {
    if (!this._overlay) return;
    this._overlay.innerHTML = '';
    for (const h of this._storedHighlights) {
      this._appendRect(h.start, h.end, h.className);
    }
  }

  _redrawHighlights() { this._renderFromStorage(); }

  highlightNode(astNode) {
    if (!astNode) { this.clearHighlight(); return; }
    this.highlightRange(
      astNode.start_gen ?? astNode.start,
      astNode.end_gen   ?? astNode.end,
    );
  }

  clearHighlight() {
    this._storedHighlights = [];
    if (this._overlay) this._overlay.innerHTML = '';
  }

  // -- Gutter internals -----------------------------------------------------

  _syncGutter(text) {
    if (!this._gutter) return;
    const count = (text ?? '').split('\n').length;
    const spans = this._gutter.children;

    while (spans.length < count) this._gutter.appendChild(document.createElement('span'));
    while (spans.length > count) this._gutter.removeChild(this._gutter.lastChild);

    let i = 1;
    for (const s of spans) {
      s.textContent = String(i);
      s.dataset.line = i;
      s.classList.toggle('bp-active', this._bpLines.has(i));
      i++;
    }
    if (this._pre) this._gutter.scrollTop = this._pre.scrollTop;
  }

  _refreshBpDots() {
    if (!this._gutter) return;
    for (const s of this._gutter.children) {
      s.classList.toggle('bp-active', this._bpLines.has(+s.dataset.line));
    }
  }

  _handleGutterClick(e) {
    const span = e.target.closest('[data-line]');
    if (!span) return;
    this.dispatchEvent(new CustomEvent('sv-gutter-click', {
      bubbles: true,
      detail:  { line: +span.dataset.line },
    }));
  }

  // -- Hover internals ------------------------------------------------------

  _offsetAtPoint(x, y) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
    }
    // Ensure the caret landed inside our pre (not in gutter or overlay)
    if (!range || !this._pre || !this._pre.contains(range.startContainer)) return null;

    const walker = document.createTreeWalker(this._pre, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n === range.startContainer) return total + range.startOffset;
      total += n.nodeValue.length;
    }
    return null;
  }

  _handleMousemove(e) {
    if (!this._hoverData.length) { if (typeTooltip) typeTooltip.style.display = 'none'; return; }
    const offset = this._offsetAtPoint(e.clientX, e.clientY);
    if (offset == null) { if (typeTooltip) typeTooltip.style.display = 'none'; return; }
    const hit = this._hoverData.find(h => h.start <= offset && offset < h.end);
    if (!hit) { if (typeTooltip) typeTooltip.style.display = 'none'; return; }
    typeTooltip.textContent   = hit.label + (hit.detail ? ': ' + hit.detail : '');
    typeTooltip.style.display = 'block';
    typeTooltip.style.top     = (e.clientY + 18) + 'px';
    typeTooltip.style.left    = (e.clientX + 12) + 'px';
  }

  _handleMouseleave() {
    if (typeTooltip) typeTooltip.style.display = 'none';
  }

  _handleClick(e) {
    const offset = this._offsetAtPoint(e.clientX, e.clientY);
    let best = null, bestLen = Infinity;
    if (offset != null) {
      for (const entry of this._hoverData) {
        if (entry.start <= offset && offset < entry.end) {
          const len = entry.end - entry.start;
          if (len < bestLen) { bestLen = len; best = entry; }
        }
      }
    }
    this.dispatchEvent(new CustomEvent('sv-node-click', {
      bubbles: true,
      detail:  { node: best?._astNode ?? null },
    }));
  }
}

// -- Private helper ------------------------------------------------------------

function _nodeAtOffset(container, target) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    const n   = walker.currentNode;
    const len = n.nodeValue.length;
    if (total + len >= target) return { node: n, off: target - total };
    total += len;
  }
  return null;
}

// -- Register ------------------------------------------------------------------

customElements.define('qlang-source-view', QLangSourceView);
