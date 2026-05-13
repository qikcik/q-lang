// compiler/source-buffer.js — SourceBuffer: unified text-buffer descriptor
//
// A SourceBuffer is the single canonical representation of a text buffer
// that AST nodes are positioned within.  Two kinds exist:
//
//   'user'  — a file written by the user (currently just 'main')
//   'macro' — the expanded body of one macro call-site
//
// Every ASTNode produced by the compiler carries:
//   node.__src       : SourceBuffer   — which buffer the node lives in
//   node.src_start   : number         — inclusive offset in __src.text
//   node.src_end     : number         — exclusive offset in __src.text
//
// SourceBuffer replaces the old plain-object { id, text, tokens, kind, callSite }
// returned by createSource().  The shape is identical but is now a class
// with factory methods for clarity and future extensibility.
//
// Exports:
//   SourceBuffer.forMain(text)            → SourceBuffer (kind='user', id='main')
//   SourceBuffer.forMacro(id, text, cs)   → SourceBuffer (kind='macro')

import { tokenize } from './lexer.js';

export class SourceBuffer {
  /**
   * @param {string}           id       — unique id, e.g. 'main' or 'macro:push:main:42'
   * @param {string}           text     — full source text
   * @param {'user'|'macro'}   kind
   * @param {CallSite | null}  callSite — link to parent buffer for macro expansions
   *
   * CallSite = { source: SourceBuffer|null, sourceId: string, start: number, end: number }
   */
  constructor(id, text, kind, callSite = null) {
    this.id       = id;
    this.text     = text;
    this._tokens  = null;  // lazily computed; use .tokens getter
    this.kind     = kind;
    this.callSite = callSite;
  }

  /** Lazily-computed token array — tokenized on first access. */
  get tokens() { return this._tokens ??= tokenize(this.text); }

  // ── Factories ─────────────────────────────────────────────────────────────

  /**
   * Create the main (user) source buffer.
   * @param {Token[]|null} tokens — pre-computed tokens from pipeline (avoids double tokenization)
   */
  static forMain(text, tokens = null) {
    const buf = new SourceBuffer('main', text, 'user', null);
    if (tokens != null) buf._tokens = tokens;
    return buf;
  }

  /**
   * Create a source buffer for an imported file.
   * @param {string}    filename — e.g. 'utils.qlang'
   * @param {string}    text     — full source text of the file
   * @param {Token[]|null} tokens — pre-computed tokens (avoids double tokenization)
   */
  static forFile(filename, text, tokens = null) {
    const buf = new SourceBuffer(filename, text, 'user', null);
    if (tokens != null) buf._tokens = tokens;
    return buf;
  }

  /**
   * Create a macro-expansion source buffer.
   *
   * @param {string}  id        — e.g. 'macro:for_each:main:42'
   * @param {string}  text      — virtual-file source text
   * @param {{ source: SourceBuffer|null, sourceId: string, start: number, end: number }} callSite
   */
  static forMacro(id, text, callSite) {
    return new SourceBuffer(id, text, 'macro', callSite);
  }

  // ── Convenience ───────────────────────────────────────────────────────────

  /** Walk the callSite chain up to the root (user) buffer. */
  get root() {
    let cur = this;
    while (cur.callSite?.source) cur = cur.callSite.source;
    return cur;
  }

  /** Returns the parent SourceBuffer (or null for user sources). */
  get parent() {
    return this.callSite?.source ?? null;
  }

  /** The depth of this buffer in the expansion chain (0 = main). */
  get depth() {
    let d = 0, cur = this;
    while (cur.callSite?.source) { d++; cur = cur.callSite.source; }
    return d;
  }

  toString() { return `SourceBuffer(${this.id})`; }
}
