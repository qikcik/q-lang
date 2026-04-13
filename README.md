# QLang

A statically typed, manually-managed, WebAssembly-targeting language with a browser-based IDE.

## Reading order

1. [`langIntro.md`](langIntro.md) — language overview (syntax, types, macros)
2. [`langDetail.md`](langDetail.md) — full language specification
3. [`archIntro.md`](archIntro.md) — architecture overview
4. [`archDetail.md`](archDetail.md) — file-level architecture reference
5. [`ide.md`](ide.md) — IDE features and internals

## Structure

```
compiler/   — lexer, parser, macro system, type checker, codegen, WAT emitter
ide/        — browser IDE (editor, highlight, debugger, macro panels)
tests/      — test suite (run: node tests/test.js)
```

## Running tests

```sh
node tests/test.js
```

## Entry point

Open `index.html` in a browser.
