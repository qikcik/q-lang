# QLang — Architektura (Wprowadzenie)

> Stan na: 2026-05-13 (aktualizacja: defer-pass, resilient parser (3-tier split), type-infer split, multi-file VFS, file-tree, uzupełnienie listy plików i testów)
> Szczegółowa dokumentacja: [archDetail.md](archDetail.md)

---

## 1. Podejście projektowe

- **Podejście systemowe** — projekt budowany jako spójny system, nie zbiór niezależnych hacków. Każdy moduł ma jasno zdefiniowane wejście i wyjście; zmiany w jednym module nie wymagają łatania pozostałych.
- **Oparcie na przepływie danych** — architektura podąża za naturalnym przepływem danych (source → tokens → AST → typed AST → S-expr → WASM bytes). Żaden etap nie sięga wstecz do poprzedniego; żaden nie omija kolejnego. Brak cheatowania architektury (np. brak bezpośredniego emitowania bajtów z parsera).
- **Zero zależności** — cały kompilator w czystym, natywnym JS (ES modules)
- **Przeglądarka jako runtime** — statyczna strona HTML, brak bundlera, brak Node.js
- **Binary WASM ręcznie** — bez wabt.js, binarny format generowany bit po bicie
- **Iteracyjny rozwój** — każda faza jest niezależnym modułem z jasnym interfejsem
- **Pareto-first** — najprostsza implementacja spełniająca wymagania, refaktor tylko gdy potrzeba

---

## 2. Pipeline kompilatora (big picture)

```
Source (string)
    │
    ▼  tokenize(src)           ← lexer.js
Token[]
    │
    ▼  parse(tokens)           ← parser.js
AST
    │
    ▼  expand(ast)            ← macro-expander.js
AST (macros resolved)
    │
    ▼  typecheck(ast)          ← staticTypeChecker.js
Typed AST
    │
    ▼  deferPass(ast)          ← defer-pass.js  (AST rewrite: DeferStmt → inline stmts)
Typed AST (bez DeferStmt)
    │
    ▼  generate(ast)           ← codegen.js  (orkiestrator)
```

Fazy 1–3b (tokenize → parse → expand → typecheck → deferPass) są orkiestrowane przez `compiler/pipeline.js`:
```
    compile(src)            ← pipeline.js  — zwraca { tokens, ast, expLog, parseErrors, mainSource }
    │                          gdy parseErrors.length > 0: expand+typecheck+deferPass pominięte
    │                          compile() włącza deferPass (rewrite DeferStmt) przed generate()
    │
    liveCompile(src)       ← pipeline.js  — zawsze pełny pipeline (bez deferPass, bez codegen)
    │                          używa liveTypecheck() — zbiera WSZYSTKIE typeErrors
    │
    ▼  generate(ast)           ← codegen.js  (orkiestrator)
    ├── buildWAT(ast)          ← wat-encoder.js → S-expr + SSpans
    ├── watToText(module)      ← wat-serializer.js → WAT text + TextSpans (re-exported via wat-encoder.js)
    └── sExprToWasm(module)    ← codegen.js     → WASM bytes + ByteSpans
    │
    ▼  WebAssembly.instantiate()  ← wasm-runner.js (Web Worker)
WASM Instance → main() → konsola IDE
   Run:   mode:'run'  — env imports only
   Debug: mode:'debug' — env + dbg.brk (Atomics.wait at breakpoints, O(1) stepping)
```

---

## 3. Struktura plików

```
index.html               — UI (edytor, przyciski, panele, CSS)
ide/
  main.js                — Entry point: compile/run/debug + inicjalizacja
  source-view.js         — <qlang-source-view> Web Component: editable (główny edytor) + read-only
  qlang-pane.js          — <qlang-pane> Web Component: wrapper strukturalny paneli
  qlang-toolbar.js       — <qlang-toolbar> Web Component: przyciski nagłówka → eventy ql-*
  qlang-error-panel.js   — <qlang-error-panel> Web Component: setErrors(), log(), clear()
  qlang-console.js       — <qlang-console> Web Component: write(text), log(msg), clear(), startInput(cb), cancelInput()
  vfs.js                 — VirtualFileSystem: multi-file project management (persist, sessions)
  file-tree.js           — <qlang-file-tree> Web Component: drzewo plików, create/rename/delete, eventy ft-*
  project-ui.js          — Project UI: new-project dialog, open, save, tab management
  examples.js            — Wczytywanie przykładów (examples/index.json → VFS)
  layout.js              — Resize handlerów, drag & drop paneli, zwijanie/rozwijanie
  views.js               — Renderery: syntaxHighlight, renderWAT, renderBytecode
  crossSelection.js      — Cienki re-export shim: setStmtMap, enclosingStmt, highlightSourceRange
  highlight.js           — Koordynator podświetleń: highlightAndScrollSource, applyChainHighlights, clearAll
  ide-state.js           — Pasywny store: setExpLog/getExpLog, setLast*/getLast* (zero zależności)
  source-registry.js     — Rejestr SourceBuffer + widoków; getAllSourceIds, getView, registerView
  macro-panel.js         — Manager paneli makr; +lens buttons; inner +lens; close-all na recompile
  navigate.js            — Nawigacja canonical-ref; navigateToRef, navNext/navPrev/clearNav
  nav-bar.js             — Pływający pill #nav-bar (◁ ▷ ×)
  lsp.js                 — Edytor: autocomplete (3 tryby), getScopeItems, resolveChainedType, syncAstHighlight
  hover.js               — Hover data builder: HINTS, buildHoverData (AST → HoverEntry[])
  editor.js              — contenteditable helpery: getEditorText, getCaretOffset, setCaretOffset
  debugger.js            — Debugger: sourceBps, initDebugger (Worker-based via wasm-runner.js)
  wasm-runner.js         — Web Worker: Run+Debug WASM; SharedArrayBuffer+Atomics dla I/O i debug pause
  lang-docs.js           — Markdown renderer + ładowanie dokumentacji języka
compiler/
  lexer.js               — Tokenizer
  parser-base.js         — ParseError, node(), ParserBase (stream utilities)
  parser-exprs.js        — ParserExprs extends ParserBase — parseType() + parseXxxExpr()
  parser.js              — Parser extends ParserExprs — deklaracje, instrukcje, struct (resilient: ErrorNode)
  source-buffer.js       — SourceBuffer class: { id, text, kind, callSite }
  source-ref.js          — SourceRef / source location helpers
  source.js              — Utility fns: offsetToLine, offsetToLineCol, srcStart, srcEnd
  macro-expander.js      — Faza 2.5: macro expander orkiestrator
  macro-substitute.js    — substituteStmts, kindCheck, parseArgForSub
  macro-unpack.js        — expandUnpack (built-in unpack!)
  macro-error.js         — MacroError class
  staticAnalysis.js      — Typy pomocnicze, helpery, Scope
  type-infer.js          — TypeInferBase — wszystkie metody infer*()
  staticTypeChecker.js   — TypeChecker extends TypeInferBase (check*) + typecheck() + liveTypecheck()
  pipeline.js            — compile(src) + liveCompile(src) (fazy 1–4 + deferPass)
  defer-pass.js          — Faza 3b: AST rewrite — DeferStmt → inline stmts
  ast-to-source.js       — AST → sformatowany kod QLang (fundament formatera)
  wasm-encoder.js        — LEB128, opcody, sekcje WASM
  wat-utils.js           — SExprBuilder, BUILTINS, canonType, BumpAllocator
  wat-emitter.js         — emitFunc/emitStmt/emitExpr (WAT IR builders)
  wat-encoder.js         — buildWAT(ast) → S-expr + SSpans; re-eksportuje watToText
  wat-serializer.js      — watToText(module, sSpans) → { text, spans }
  codegen.js             — Generator binarnego WASM
  ast-renderer.js        — AST → HTML (<details> tree)
tests/
  helpers.js             — test, suite, assert, compileAndGenerate, summarize
  test.js                — Orkiestrator (importuje wszystkie test-*.js)
  test-lexer.js          — Suity: typy tokenów, offsety, błędy
  test-lexer-macro.js    — Suity: tokenizacja makr
  test-parser.js         — Suity: VarDecl, FuncDecl, wyrażenia, start/end
  test-parser-macro.js   — Suity: parsowanie makr
  test-parser-recovery.js — Suity: resilient parsing, ErrorNode recovery
  test-typechecker.js    — Suity: inferencja, lokalne funkcje, błędy, shadowowanie
  test-codegen.js        — Suity: WASM validity, tablice, ptr, ByteSpan, debugger
  test-macros.js         — Suity: rozwijanie makr, BracketAccess, QualifiedName, Namespace
  test-struct.js         — Suity: struct declaration, field access, type checking
  test-namespace.js      — Suity: namespace, qualified names, hover, chained dot-completion
  test-defer.js          — Suity: defer statements
  test-ide-logic.js      — Suity: autocomplete logic, getScopeItems, resolveChainedType
  test-ide-ui.js         — Suity: IDE UI behavior, auto-indent
  test-ide-smoke.js      — Suity: DOM IDs, pliki IDE, pipeline shape, Web Component tagi
  test-vfs.js            — Suity: VFS Project, createProject, persistence
  test-ast-renderer.js   — Suity: AST rendering
start.js                 — Serwer deweloperski Node.js: COOP/COEP headers + no-cache; wymagany dla SharedArrayBuffer
```

---

## 4. Moduły IDE

→ [ide.md](ide.md) — edytor, panele, autocomplete, hover, debugger, cross-selection

## 5. Framework tworzenia funkcjonalności UI

→ [wayOfWork.md](wayOfWork.md) § 11 — wzorzec Web Component, pipeline, tabela istniejących komponentów

---

## 6. Dokumentacja języka

→ [langIntro.md](langIntro.md) — przegląd języka
→ [langDetail.md](langDetail.md) — pełna specyfikacja
