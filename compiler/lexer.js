// ─────────────────────────────────────────────────────────────────────────────
// Lexer — tokenizer for the custom language
// ─────────────────────────────────────────────────────────────────────────────

export const TT = Object.freeze({
  IDENT:       'IDENT',       // variable/function names (includes scalar type names: i32, f64, bool, etc.)
  NUMBER:      'NUMBER',      // integer or float literals
  BOOL_LIT:    'BOOL_LIT',   // true | false
  STRING_LIT:  'STRING_LIT', // "hello" — raw UTF-8 string
  CHAR_LIT:    'CHAR_LIT',   // 'x'  — single ASCII character; value = numeric code as string
  KEYWORD:     'KEYWORD',    // return as if else while break fn mut ptr array macro namespace
  OP:          'OP',         // := :: : = + - * / & < > , ; ! | && || == != <= >=
  PUNCT:       'PUNCT',      // ( ) { } [ ] .
  MACRO_VAR:        'MACRO_VAR',        // $name — gensym variable inside macro body
  MACRO_PARAM:       'MACRO_PARAM',      // @name — parameter reference inside macro body
  MACRO_STRINGIFY:   'MACRO_STRINGIFY',  // #name — stringify operator inside macro body
  EOF:               'EOF',
});

// Scalar type names — tokenized as IDENT, resolved by type-checker via globalScope.
// Exported so macro-substitute and other modules can check "is this IDENT a type name?"
export const SCALAR_TYPES = new Set([
  'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'f32', 'f64', 'bool',
]);

const KEYWORDS = new Set(['return', 'as', 'if', 'else', 'while', 'break', 'mut', 'ptr', 'array', 'fn', 'macro', 'void', 'defer', 'struct', 'namespace']);

/**
 * @typedef {{ type: string, value: string, line: number, col: number, start: number, end: number }} Token
 * start/end are byte offsets into the source string (end is exclusive).
 */

/**
 * Tokenizes source code into an array of Token objects.
 * @param {string} src
 * @returns {Token[]}
 */
export function tokenize(src) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  const col = () => pos - lineStart + 1;
  const peek = (offset = 0) => src[pos + offset];
  const advance = () => {
    const ch = src[pos++];
    if (ch === '\n') { line++; lineStart = pos; }
    return ch;
  };

  // tok is only used for single-char punctuation/operators where start is already captured
  const tok = (type, value, l = line, c = col() - value.length) =>
    tokens.push({ type, value, line: l, col: c, start: pos - value.length, end: pos });

  while (pos < src.length) {
    const startLine = line;
    const startCol  = col();
    const ch = peek();

    // ── whitespace ────────────────────────────────────────────────────────────
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    // ── line comment  // ... ──────────────────────────────────────────────────
    if (ch === '/' && peek(1) === '/') {
      while (pos < src.length && peek() !== '\n') advance();
      continue;
    }

    // ── block comment  /* ... */ ──────────────────────────────────────────────
    if (ch === '/' && peek(1) === '*') {
      advance(); advance(); // consume /*
      while (pos < src.length) {
        if (peek() === '*' && peek(1) === '/') { advance(); advance(); break; }
        advance();
      }
      continue;
    }

    // ── numbers ───────────────────────────────────────────────────────────────
    if (isDigit(ch) || (ch === '.' && isDigit(peek(1)))) {
      let raw = '';
      const startPos = pos;
      while (pos < src.length && isDigitOrUnderscore(peek())) raw += advance();
      if (peek() === '.' && isDigit(peek(1))) {
        raw += advance(); // consume '.'
        while (pos < src.length && isDigitOrUnderscore(peek())) raw += advance();
      }
      tokens.push({ type: TT.NUMBER, value: raw.replace(/_/g, ''), line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── identifiers, keywords, type keywords ─────────────────────────────────
    if (isAlpha(ch)) {
      let raw = '';
      const startPos = pos;
      while (pos < src.length && isAlphaNum(peek())) raw += advance();
      let type;
      if (raw === 'true' || raw === 'false') type = TT.BOOL_LIT;
      else if (KEYWORDS.has(raw))             type = TT.KEYWORD;
      else                                    type = TT.IDENT;
      tokens.push({ type, value: raw, line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── string literals  "..." ──────────────────────────────────────────────
    if (ch === '"') {
      const startPos = pos;
      advance(); // consume opening "
      let raw = '';
      while (pos < src.length && peek() !== '"') {
        const c = peek();
        if (c === '\n') throw new LexError('Unterminated string literal', startLine, startCol, startPos);
        if (c === '\\') {
          advance(); // consume backslash
          const esc = advance();
          if (esc === '"')       raw += '"';
          else if (esc === '\\') raw += '\\';
          else if (esc === 'n')  raw += '\n';
          else if (esc === 'r')  raw += '\r';
          else if (esc === 't')  raw += '\t';
          else throw new LexError(`Unknown escape sequence '\\${esc}'`, startLine, startCol);
        } else {
          raw += advance();
        }
      }
      if (pos >= src.length) throw new LexError('Unterminated string literal', startLine, startCol, startPos);
      advance(); // consume closing "
      tokens.push({ type: TT.STRING_LIT, value: raw, line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── char literals  'x' ──────────────────────────────────────────────────
    if (ch === "'") {
      const startPos = pos;
      advance(); // consume opening '
      if (pos >= src.length || peek() === "'") throw new LexError('Empty char literal', startLine, startCol, startPos);
      const c = peek();
      if (c === '\n') throw new LexError('Unterminated char literal', startLine, startCol, startPos);
      let charCode;
      if (c === '\\') {
        advance(); // consume backslash
        const esc = advance();
        if      (esc === "'")  charCode = 39;
        else if (esc === '\\') charCode = 92;
        else if (esc === 'n')  charCode = 10;
        else if (esc === 'r')  charCode = 13;
        else if (esc === 't')  charCode = 9;
        else if (esc === '0')  charCode = 0;
        else throw new LexError(`Unknown char escape '\\${esc}'`, startLine, startCol, startPos);
      } else {
        charCode = src.codePointAt(pos);
        if (charCode > 127) throw new LexError('Char literal must be ASCII (0–127)', startLine, startCol, startPos);
        advance();
      }
      if (peek() !== "'") throw new LexError('Unterminated char literal', startLine, startCol, startPos);
      advance(); // consume closing '
      tokens.push({ type: TT.CHAR_LIT, value: String(charCode), line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }
    if (ch === '#' && isAlpha(peek(1))) {
      const startPos = pos;
      advance(); // consume '#'
      let raw = '';
      while (pos < src.length && isAlphaNum(peek())) raw += advance();
      tokens.push({ type: TT.MACRO_STRINGIFY, value: '#' + raw, line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── $name — macro gensym variable ─────────────────────────────────────────
    if (ch === '$' && isAlpha(peek(1))) {
      const startPos = pos;
      advance(); // consume '$'
      let raw = '';
      while (pos < src.length && isAlphaNum(peek())) raw += advance();
      tokens.push({ type: TT.MACRO_VAR, value: '$' + raw, line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── @name — macro parameter reference ───────────────────────────────────
    if (ch === '@' && isAlpha(peek(1))) {
      const startPos = pos;
      advance(); // consume '@'
      let raw = '';
      while (pos < src.length && isAlphaNum(peek())) raw += advance();
      tokens.push({ type: TT.MACRO_PARAM, value: '@' + raw, line: startLine, col: startCol, start: startPos, end: pos });
      continue;
    }

    // ── two-character operators first ─────────────────────────────────────────
    if (ch === ':' && peek(1) === ':') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '::', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === ':' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: ':=', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '&' && peek(1) === '&') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '&&', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '|' && peek(1) === '|') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '||', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '=' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '==', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '!' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '!=', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '<' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '<=', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }
    if (ch === '>' && peek(1) === '=') {
      advance(); advance();
      tokens.push({ type: TT.OP, value: '>=', line: startLine, col: startCol, start: pos - 2, end: pos });
      continue;
    }

    // ── single-character operators / punctuation ──────────────────────────────
    if ('+-*/&<>=;:,!|'.includes(ch)) {
      advance();
      tokens.push({ type: TT.OP, value: ch, line: startLine, col: startCol, start: pos - 1, end: pos });
      continue;
    }

    if ('(){}[]'.includes(ch)) {
      advance();
      tokens.push({ type: TT.PUNCT, value: ch, line: startLine, col: startCol, start: pos - 1, end: pos });
      continue;
    }

    // ── dot — member access (not part of a number literal) ────────────────────
    if (ch === '.') {
      advance();
      tokens.push({ type: TT.PUNCT, value: '.', line: startLine, col: startCol, start: pos - 1, end: pos });
      continue;
    }

    // ── unknown character → lex error ─────────────────────────────────────────
    throw new LexError(`Unexpected character '${ch}'`, startLine, startCol);
  }

  tokens.push({ type: TT.EOF, value: '', line, col: col(), start: pos, end: pos });
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isDigitOrUnderscore(ch) { return (ch >= '0' && ch <= '9') || ch === '_'; }
function isAlpha(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'; }
function isAlphaNum(ch) { return isAlpha(ch) || isDigit(ch); }

export class LexError extends Error {
  constructor(msg, line, col, start, end) {
    super(`[Lex] Line ${line}:${col} — ${msg}`);
    this.line  = line;
    this.col   = col;
    this.start = start ?? null;
    this.end   = end   ?? null;
  }
}
