// compiler/macro-error.js — MacroError class
//
// Extracted as a standalone module to break circular dependencies between
// macro-expander.js, macro-substitute.js, and macro-unpack.js.

export class MacroError extends Error {
  constructor(msg, line, src = 'main', start = null, end = null) {
    const srcLabel = src.startsWith('macro:')
      ? src.split(':').slice(0, 2).join(':')
      : src;
    const ref = `${srcLabel}[${line ?? '?'}:1]`;
    super(`[Macro] ${ref} — ${msg}`);
    this.line         = line ?? null;
    this.src          = src;
    this.start        = start;
    this.end          = end;
    this.canonicalRef = ref;
  }
}
