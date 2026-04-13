// ide/editor.js — contenteditable helpers for the QLang IDE editor
//
// Pure DOM utilities: no state, no project imports.
//
// Exports:
//   getEditorText()
//   getCaretOffset()
//   setCaretOffset(offset)
//   getSelectionOffsets()   → { start, end }
//   setSelectionRange(start, end)
//   getEditorLine()         → 1-based line number at caret

const editor = document.getElementById('editor');

// ── Text access ───────────────────────────────────────────────────────────────

export function getEditorText() {
  return editor.textContent;
}

// ── Caret helpers ─────────────────────────────────────────────────────────────

export function getCaretOffset() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(editor);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().length;
}

export function setCaretOffset(offset) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len  = node.nodeValue.length;
    if (total + len >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - total);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    total += len;
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Selection helpers ─────────────────────────────────────────────────────────

export function getSelectionOffsets() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { start: 0, end: 0 };
  const r  = sel.getRangeAt(0);
  const ra = r.cloneRange(); ra.selectNodeContents(editor); ra.setEnd(r.startContainer, r.startOffset);
  const rb = r.cloneRange(); rb.selectNodeContents(editor); rb.setEnd(r.endContainer,   r.endOffset);
  return { start: ra.toString().length, end: rb.toString().length };
}

export function setSelectionRange(start, end) {
  function nodeAt(offset) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len  = node.nodeValue.length;
      if (total + len >= offset) return { node, off: offset - total };
      total += len;
    }
    const w2 = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let last = null;
    while (w2.nextNode()) last = w2.currentNode;
    return last ? { node: last, off: last.nodeValue.length } : { node: editor, off: 0 };
  }
  const s = nodeAt(start);
  const e = nodeAt(end);
  const range = document.createRange();
  range.setStart(s.node, s.off);
  range.setEnd(e.node, e.off);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Line helper ───────────────────────────────────────────────────────────────

export function getEditorLine() {
  const text = getEditorText();
  const pos  = getCaretOffset();
  return (text.substring(0, pos).match(/\n/g) || []).length + 1;
}
