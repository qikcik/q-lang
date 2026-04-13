// compiler/source-ref.js — Canonical source reference strings
//
// Format: sourceId[startLine:startCol-endLine:endCol]/sourceId[L:C-L:C]/...
//
// Each segment represents one buffer in the expansion chain, from outermost
// (main source) to innermost (deepest macro expansion level).
// sourceId is the full buffer ID (e.g. 'macro:for_each:main:42'), not shortened.
//
// Example: main[8:10-8:20]/macro:for_each:main:42[3:4-3:14]
//
// Exports:
//   buildCanonicalRef(node, start?, end?) → string
//   parseCanonicalRef(str) → Segment[]
//   segmentLabel(sourceId) → string   (display-only shortener)

import { offsetToLineCol } from './source.js';

// ── Segment type ──────────────────────────────────────────────────────────────
// Segment: { sourceId, label, startLine, startCol, endLine, endCol }

/** Shorten a sourceId for display: 'main' → 'main', 'macro:for_each:main:42' → 'macro:for_each' */
export function segmentLabel(sourceId) {
  if (!sourceId || sourceId === 'main') return 'main';
  if (sourceId.startsWith('macro:')) {
    return sourceId.split(':').slice(0, 2).join(':');  // 'macro:for_each'
  }
  return sourceId;
}

function formatSegment(sourceId, text, start, end) {
  if (start == null || !text) return sourceId + '[?:?]';
  const s = offsetToLineCol(text, start);
  const e = end != null ? offsetToLineCol(text, end) : s;
  return `${sourceId}[${s.line}:${s.col}-${e.line}:${e.col}]`;
}

// ── Build canonical ref from an AST node ─────────────────────────────────────

/**
 * Build the canonical reference string for an AST node.
 *
 * Walks up __src.callSite.source to reconstruct the full expansion chain,
 * then formats each level as "label[startLine:startCol-endLine:endCol]".
 *
 * If start/end are not provided, uses node.src_start/src_end ?? node.start/end.
 *
 * Returns 'main[?:?]' when source info is missing.
 */
export function buildCanonicalRef(node, start, end) {
  if (!node) return 'main[?:?]';

  // Collect chain from innermost to outermost source
  const chain = [];

  // Innermost: the node's own position in its source
  const innermostSrc = node.__src;
  if (innermostSrc) {
    const s = start ?? node.src_start ?? node.start;
    const e = end   ?? node.src_end   ?? node.end;
    chain.push({ src: innermostSrc, start: s, end: e });
  } else {
    // No __src: assume main source, use node.start/end
    return formatNodeInMain(node, start, end);
  }

  // Walk up callSite chain
  let cur = innermostSrc;
  while (cur?.callSite) {
    const cs = cur.callSite;
    const parentSrc = cs.source;
    if (!parentSrc) {
      // No source ref available — break chain, use sourceId as label only
      chain.push({ src: { id: cs.sourceId, text: null }, start: cs.start, end: cs.end });
      break;
    }
    chain.push({ src: parentSrc, start: cs.start, end: cs.end });
    cur = parentSrc;
    if (cur.kind === 'user') break;  // reached top-level user source
  }

  // Reverse so outermost (main) is first
  chain.reverse();

  return chain.map(({ src, start: s, end: e }) =>
    formatSegment(src.id, src.text, s, e)
  ).join('/');
}

function formatNodeInMain(node, start, end) {
  // Fallback when node has no __src but has line (from original parse)
  const line = node.line ?? 1;
  const col  = 1;
  if (start == null) return `main[${line}:${col}]`;
  return `main[${line}:${col}]`;
}

// ── Parse canonical ref string → segments ────────────────────────────────────

/**
 * Parse a canonical ref string into segments.
 * Returns array of Segment objects: { sourceId, label, startLine, startCol, endLine, endCol }
 */
export function parseCanonicalRef(str) {
  if (!str) return [];
  // Each segment: label[L:C-L:C] or label[L:C]
  const segments = [];
  // Split on '/' but not inside brackets: use greedy match
  const parts = splitRefParts(str);
  for (const part of parts) {
    const m = part.match(/^([^[\]]+)\[(\d+):(\d+)(?:-(\d+):(\d+))?\]$/);
    if (m) {
      const [, id, sl, sc, el, ec] = m;
      segments.push({
        sourceId:  labelToSourceId(id),
        label:     segmentLabel(id),
        startLine: +sl,
        startCol:  +sc,
        endLine:   el != null ? +el : +sl,
        endCol:    ec != null ? +ec : +sc,
      });
    } else {
      // Bare label without position (e.g. 'main[?:?]')
      segments.push({ sourceId: labelToSourceId(part), label: segmentLabel(part), startLine: 1, startCol: 1, endLine: 1, endCol: 1 });
    }
  }
  return segments;
}

/** Split 'main[..]/macro:x[..]' on '/' boundaries outside of brackets */
function splitRefParts(str) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[') depth++;
    else if (str[i] === ']') depth--;
    else if (str[i] === '/' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

/** Reverse segmentLabel → approximate sourceId (best effort) */
function labelToSourceId(label) {
  if (label === 'main') return 'main';
  if (label.startsWith('macro:')) return label;  // 'macro:for_each' - no full UID, used as prefix
  return label;
}
