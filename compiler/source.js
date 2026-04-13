// compiler/source.js — Source utilities (offset → line/col, srcStart/srcEnd)
//
// Node convention:
//   node.__src       : SourceBuffer — which buffer posns refer to
//   node.src_start   : number       — inclusive offset in __src.text
//   node.src_end     : number       — exclusive offset in __src.text
//   node.start / node.end — raw parse-time offsets (error reporting)
//
// Exports:
//   offsetToLine, offsetToLineCol, srcStart, srcEnd

/** offset → 1-based line number within a Source text */
export function offsetToLine(text, offset) {
  return offsetToLineCol(text, offset).line;
}

/** offset → { line, col } (both 1-based) within a Source text */
export function offsetToLineCol(text, offset) {
  let line = 1, lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') { line++; lineStart = i + 1; }
  }
  return { line, col: offset - lineStart + 1 };
}

/** Rendering start offset for a node: `src_start` if set, else `start`. */
export function srcStart(node) { return node.src_start ?? node.start; }

/** Rendering end offset for a node: `src_end` if set, else `end`. */
export function srcEnd(node)   { return node.src_end   ?? node.end;   }
