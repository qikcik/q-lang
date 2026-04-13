// views.js — view renderers: syntax highlight, WAT Explorer, Bytecode hex dump
//
// Exports:
//   escHtml(s)
//   syntaxHighlight(src, errorRanges)    — tokenizes + produces HTML
//   applyHighlight(editor, errorRanges, setCaretOffset, updateLineNumbers)
//   renderWAT(watText, spans, enclosingStmt) — builds <details> tree DOM; assigns _astNode per line
//   findWatSpan(spans, watStart, watEnd)
//   renderBytecode(container, bytes, byteSpans, enclosingStmt)
//   findByteSpan(byteSpans, rowStart, rowEnd)
//   classifyWasmBytes(bytes)

import { tokenize, SCALAR_TYPES } from '../compiler/lexer.js';

// ── Syntax highlighting ───────────────────────────────────────────────────────

const TT_CLASS = {
  KEYWORD:    'hl-keyword',
  BOOL_LIT:   'hl-bool',
  NUMBER:     'hl-number',
  STRING_LIT: 'hl-string',
  IDENT:      'hl-ident',
  OP:         'hl-op',
  PUNCT:      'hl-punct',
};

export function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// errorRanges: optional array of {start, end} to underline as errors
export function syntaxHighlight(src, errorRanges) {
  const errRanges = errorRanges ? [...errorRanges].sort((a, b) => a.start - b.start) : [];
  function isErr(pos) {
    for (const r of errRanges) {
      if (r.start > pos) break;
      if (pos < r.end) return true;
    }
    return false;
  }

  let tokens;
  try {
    tokens = tokenize(src);
  } catch (e) {
    const safe = src.slice(0, e.start ?? src.length);
    let out = '';
    for (let i = 0; i < safe.length; i++) out += escHtml(safe[i]);
    if (e.start != null) {
      const errPart = escHtml(src.slice(e.start, e.end ?? e.start + 1));
      out += '<span class="hl-error">' + errPart + '</span>';
      const rest = src.slice(e.end ?? e.start + 1);
      for (let i = 0; i < rest.length; i++) out += escHtml(rest[i]);
    }
    return out;
  }

  let out = '';
  let pos = 0;
  for (const tok of tokens) {
    if (tok.type === 'EOF') break;
    if (tok.start > pos) {
      const gap = src.slice(pos, tok.start);
      out += emitGap(gap, pos, errRanges);
    }
    let cls = TT_CLASS[tok.type] ?? null;
    // Scalar type names (i32, f64, bool…) are now IDENT — highlight as types
    if (tok.type === 'IDENT' && SCALAR_TYPES.has(tok.value)) cls = 'hl-type';
    const raw = escHtml(src.slice(tok.start, tok.end));
    const isError = isErr(tok.start);
    if (isError) {
      out += '<span class="hl-error">' + raw + '</span>';
    } else if (cls) {
      out += '<span class="' + cls + '">' + raw + '</span>';
    } else {
      out += raw;
    }
    pos = tok.end;
  }
  if (pos < src.length) out += emitGap(src.slice(pos, src.length), pos, errRanges);
  return out;
}

function emitGap(text, basePos, errRanges) {
  let i = 0, out = '';
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') {
      const end = text.indexOf('\n', i);
      const comment = end < 0 ? text.slice(i) : text.slice(i, end);
      out += '<span class="hl-comment">' + escHtml(comment) + '</span>';
      i += comment.length;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const comment = end < 0 ? text.slice(i) : text.slice(i, end + 2);
      out += '<span class="hl-comment">' + escHtml(comment) + '</span>';
      i += comment.length;
      continue;
    }
    out += escHtml(c);
    i++;
  }
  return out;
}

// ── WAT Explorer renderer ─────────────────────────────────────────────────────

// WAT token classifier for syntax highlighting
function watTokenClass(tok) {
  if (/^;;/.test(tok))                    return 'wc'; // comment
  if (/^"/.test(tok))                     return 'ws'; // string
  if (/^\$/.test(tok))                    return 'wr'; // $ref
  if (/^[-+]?[0-9]/.test(tok))           return 'wn'; // number
  if (/^(i32|i64|f32|f64|funcref|func|result|param|local|type|memory|table|elem|import|export|module)$/.test(tok)) return 'wt';
  if (/^(if|else|end|loop|block|then|return|br|br_if|call|call_indirect|drop|select)$/.test(tok)) return 'wk';
  if (/\.(const|add|sub|mul|div|rem|and|or|xor|shl|shr|rotl|rotr|eq|ne|lt|gt|le|ge|eqz|clz|ctz|popcnt|load|store|trunc|convert|demote|promote|wrap|extend|reinterpret|neg|abs|ceil|floor|nearest|sqrt|min|max|copysign|get|set|tee)/.test(tok)) return 'wi';
  if (/^(local\.get|local\.set|local\.tee|global\.get|global\.set)$/.test(tok)) return 'wi';
  return null;
}

function watHighlightLineTokens(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ';' && line[i+1] === ';') {
      tokens.push({text: line.slice(i), class: 'wc', lineStart: i, lineEnd: line.length});
      break;
    }
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') { if (line[j] === '\\') j++; j++; }
      tokens.push({text: line.slice(i, j + 1), class: 'ws', lineStart: i, lineEnd: j + 1});
      i = j + 1;
      continue;
    }
    if (/[\s()]/.test(line[i])) {
      tokens.push({text: line[i], class: null, lineStart: i, lineEnd: i + 1});
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && !/[\s();"]/.test(line[j])) j++;
    const tok = line.slice(i, j);
    const cls = watTokenClass(tok);
    tokens.push({text: tok, class: cls, lineStart: i, lineEnd: j});
    i = j;
  }
  return tokens;
}

const WAT_BLOCK_OPEN  = new Set(['(module', '(func', '(if', '(else', '(loop', '(block', '(then']);

// renderWAT(watText, spans, enclosingStmt) → DOM div.wat-root
// Each .wat-line gets _astNode = enclosingStmt(bestSpan.astNode), same approach as bytecode.
// highlightWatForNode then uses simple identity comparison (el._astNode === stmtNode).
export function renderWAT(watText, spans, enclosingStmt = n => n) {
  const root = document.createElement('div');
  root.className = 'wat-root';

  if (!spans || spans.length === 0) {
    console.warn('[wat] renderWAT: watSpans is empty or missing — WAT cross-highlight will not work');
  }

  // Helper: find the tightest WAT span overlapping a char range and return its astNode
  // normalized to statement level. Returns null if no span covers this range.
  function astNodeForRange(lineStart, lineEnd) {
    const sp = findWatSpan(spans, lineStart, lineEnd);
    if (!sp?.astNode) return null;
    return enclosingStmt(sp.astNode);
  }

  let pos = 0;
  const lines = watText.split('\n');
  const stack = [root];
  function top() { return stack[stack.length - 1]; }

  // Build token spans for syntax highlighting only.
  function buildTokenSpans(rawLine, container) {
    const tokens = watHighlightLineTokens(rawLine);
    for (const tok of tokens) {
      const tokenSpan = document.createElement('span');
      if (tok.class) tokenSpan.className = tok.class;
      tokenSpan.textContent = tok.text;
      container.appendChild(tokenSpan);
    }
  }

  for (const rawLine of lines) {
    const lineStart = pos;
    const lineEnd   = pos + rawLine.length;
    const trimmed   = rawLine.trimStart();
    const isBlockOpen  = [...WAT_BLOCK_OPEN].some(k => trimmed.startsWith(k));
    const isBlockClose = trimmed === ')' || trimmed === ');';

    if (isBlockOpen) {
      const det = document.createElement('details');
      det.open = trimmed.startsWith('(module') || trimmed.startsWith('(func');
      const sum = document.createElement('summary');
      sum.className = 'wat-line';
      sum._astNode = astNodeForRange(lineStart, lineEnd);
      buildTokenSpans(rawLine, sum);
      det.appendChild(sum);
      top().appendChild(det);
      stack.push(det);
    } else if (isBlockClose && stack.length > 1) {
      const span = document.createElement('span');
      span.className = 'wat-line';
      span._astNode = astNodeForRange(lineStart, lineEnd);
      buildTokenSpans(rawLine, span);
      top().appendChild(span);
      stack.pop();
    } else if (rawLine.length > 0) {
      const span = document.createElement('span');
      span.className = 'wat-line';
      span._astNode = astNodeForRange(lineStart, lineEnd);
      buildTokenSpans(rawLine, span);
      top().appendChild(span);
    }

    pos += rawLine.length + 1;
  }

  return root;
}

export function findWatSpan(spans, watStart, watEnd) {
  let best = null, bestLen = Infinity;
  for (const sp of spans) {
    if (sp.watStart <= watEnd && sp.watEnd >= watStart) {
      const len = sp.watEnd - sp.watStart;
      if (len < bestLen) { bestLen = len; best = sp; }
    }
  }
  return best;
}

// ── Bytecode renderer ─────────────────────────────────────────────────────────

export function classifyWasmBytes(bytes) {
  const roles = new Array(bytes.length).fill('bc-operand');
  let i = 0;
  const len = bytes.length;

  function readULEB128() {
    const start = i;
    while (i < len && (bytes[i] & 0x80)) i++;
    if (i < len) i++;
    return { start, end: i };
  }
  function readSLEB128() {
    const start = i;
    while (i < len && (bytes[i] & 0x80)) i++;
    if (i < len) i++;
    return { start, end: i };
  }
  function tag(from, to, cls) {
    for (let j = from; j < to && j < len; j++) roles[j] = cls;
  }

  if (len >= 4) { tag(0, 4, 'bc-magic'); i = 4; }
  if (len >= 8) { tag(4, 8, 'bc-magic'); i = 8; }

  const lebOperandOps = new Set([
    0x0c, 0x0d, 0x10, 0x20, 0x21, 0x22, 0x23, 0x24, 0x41, 0x42, 0x3f, 0x40,
  ]);
  const memOps = new Set([
    0x28,0x29,0x2a,0x2b,0x2c,0x2d,0x2e,0x2f,0x30,0x31,0x32,0x33,0x34,0x35,
    0x36,0x37,0x38,0x39,0x3a,0x3b,0x3c,0x3d,
  ]);

  while (i < len) {
    const secId = bytes[i];
    tag(i, i + 1, 'bc-sec-id'); i++;
    if (i >= len) break;
    const szRange = readULEB128();
    tag(szRange.start, szRange.end, 'bc-sec-sz');
    let secSize = 0, shift = 0;
    for (let j = szRange.start; j < szRange.end; j++) { secSize |= (bytes[j] & 0x7f) << shift; shift += 7; }
    const secEnd = i + secSize;

    if (secId === 1 && i < secEnd) {
      const cntRange = readULEB128(); tag(cntRange.start, cntRange.end, 'bc-count');
      while (i < secEnd) {
        if (bytes[i] === 0x60) { tag(i, i + 1, 'bc-type'); i++; }
        else { const r = readULEB128(); tag(r.start, r.end, 'bc-count'); }
        while (i < secEnd && !(bytes[i] === 0x60 && i + 1 < secEnd)) {
          const b = bytes[i];
          if (b >= 0x7c && b <= 0x7f) { tag(i, i + 1, 'bc-type'); i++; }
          else { const r = readULEB128(); tag(r.start, r.end, 'bc-count'); }
          if (i >= secEnd) break;
        }
      }
    } else if (secId === 7 && i < secEnd) {
      const cntRange = readULEB128(); tag(cntRange.start, cntRange.end, 'bc-count');
      while (i < secEnd) {
        const nlRange = readULEB128(); tag(nlRange.start, nlRange.end, 'bc-count');
        let nameLen = 0, sh = 0;
        for (let j = nlRange.start; j < nlRange.end; j++) { nameLen |= (bytes[j] & 0x7f) << sh; sh += 7; }
        tag(i, i + nameLen, 'bc-string'); i += nameLen;
        if (i < secEnd) { tag(i, i + 1, 'bc-type'); i++; }
        if (i < secEnd) { const r = readULEB128(); tag(r.start, r.end, 'bc-operand'); }
      }
    } else if (secId === 10 && i < secEnd) {
      const fcRange = readULEB128(); tag(fcRange.start, fcRange.end, 'bc-count');
      while (i < secEnd) {
        const bsRange = readULEB128(); tag(bsRange.start, bsRange.end, 'bc-sec-sz');
        let bodySize = 0, bsh = 0;
        for (let j = bsRange.start; j < bsRange.end; j++) { bodySize |= (bytes[j] & 0x7f) << bsh; bsh += 7; }
        const bodyEnd = i + bodySize;
        const lcRange = readULEB128(); tag(lcRange.start, lcRange.end, 'bc-count');
        let ldc = 0, lsh = 0;
        for (let j = lcRange.start; j < lcRange.end; j++) { ldc |= (bytes[j] & 0x7f) << lsh; lsh += 7; }
        for (let d = 0; d < ldc && i < bodyEnd; d++) {
          const lr = readULEB128(); tag(lr.start, lr.end, 'bc-count');
          if (i < bodyEnd) { tag(i, i + 1, 'bc-type'); i++; }
        }
        while (i < bodyEnd) {
          const op = bytes[i];
          if (op === 0x0b || op === 0x05) { tag(i, i + 1, 'bc-end'); i++; continue; }
          if (op === 0x02 || op === 0x03 || op === 0x04) {
            tag(i, i + 1, 'bc-opcode'); i++;
            if (i < bodyEnd) { tag(i, i + 1, 'bc-type'); i++; }
            continue;
          }
          tag(i, i + 1, 'bc-opcode'); i++;
          if (op === 0x41 || op === 0x42) { const r = readSLEB128(); tag(r.start, r.end, 'bc-operand'); }
          else if (op === 0x43) { tag(i, i + 4, 'bc-operand'); i += 4; }
          else if (op === 0x44) { tag(i, i + 8, 'bc-operand'); i += 8; }
          else if (memOps.has(op)) {
            const a = readULEB128(); tag(a.start, a.end, 'bc-operand');
            const o = readULEB128(); tag(o.start, o.end, 'bc-operand');
          } else if (op === 0x11) {
            const t = readULEB128(); tag(t.start, t.end, 'bc-operand');
            if (i < bodyEnd) { tag(i, i + 1, 'bc-operand'); i++; }
          } else if (lebOperandOps.has(op)) {
            const r = readULEB128(); tag(r.start, r.end, 'bc-operand');
          }
        }
      }
    } else {
      if (i < secEnd) { const r = readULEB128(); tag(r.start, r.end, 'bc-count'); }
      while (i < secEnd) {
        const b = bytes[i];
        if (b >= 0x7c && b <= 0x7f) { tag(i, i + 1, 'bc-type'); i++; }
        else { const r = readULEB128(); tag(r.start, r.end, 'bc-operand'); }
      }
    }
    if (i < secEnd) i = secEnd;
  }
  return roles;
}

// renderBytecode(container, bytes, byteSpans, enclosingStmt)
export function renderBytecode(container, bytes, byteSpans, enclosingStmt = n => n) {
  container.replaceChildren();
  if (!bytes || bytes.length === 0) { container.textContent = '(no bytecode)'; return; }

  const roles = classifyWasmBytes(bytes);
  const COLS = 16;

  for (let offset = 0; offset < bytes.length; offset += COLS) {
    const chunk = bytes.subarray(offset, offset + COLS);
    const row = document.createElement('div');
    row.className = 'bc-row';

    const addr = document.createElement('span');
    addr.className   = 'bc-addr';
    addr.textContent = offset.toString(16).padStart(4, '0');
    row.appendChild(addr);

    const hex = document.createElement('span');
    hex.className = 'bc-hex';

    for (let j = 0; j < chunk.length; j++) {
      const absIdx = offset + j;
      const byteEl = document.createElement('span');
      byteEl.className   = 'bc-byte ' + roles[absIdx];
      byteEl.textContent = chunk[j].toString(16).padStart(2, '0');
      byteEl.dataset.offset = String(absIdx);
      const sp = findByteSpan(byteSpans, absIdx, absIdx + 1);
      if (sp) byteEl._astNode = enclosingStmt(sp.astNode);
      hex.appendChild(byteEl);
    }

    row.appendChild(hex);
    container.appendChild(row);
  }
}

export function findByteSpan(byteSpans, rowStart, rowEnd) {
  let best = null, bestLen = Infinity;
  for (const sp of byteSpans) {
    if (sp.byteStart < rowEnd && sp.byteEnd > rowStart) {
      const len = sp.byteEnd - sp.byteStart;
      if (len < bestLen) { bestLen = len; best = sp; }
    }
  }
  return best;
}
