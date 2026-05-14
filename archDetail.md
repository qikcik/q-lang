# QLang — Architektura Szczegółowa

> Stan na: 2026-05-13 (aktualizacja: **`else if`** w parserze; **unary minus (`-`)** w parser/typeinfer/emitter; Worker-based Run+Debug via wasm-runner.js; 7-state SharedArrayBuffer protocol; konsola kolorowa; Stop w toolbarze; dbg-stop usunięty; **`defer`** — naprawa flushu przy zagnieżdżonych `return` w `defer-pass.js`; **`collectLocalDecls`** — deduplicacja węzłów AST współdzielonych przez defer-pass; **multi-file project** — VFS, file-tree, tab bar, "Open project" dropdown; **namespace file imports** — `NamespaceImport`, `compileMulti` / `liveCompileMulti`, multi-file codegen; **autocomplete** — `importEnv` w ide-state, importowane namespace'y i sub-namespace'y; **qualified type annotations** — `QualifiedTypeRef` w `parseType()` + `resolveType()`; wykluczone built-in skalary z autocomplete namespace'y)
> Iteracyjnie uzupełniana przy każdym zrealizowanym todo.
> Wprowadzenie i big picture: [archIntro.md](archIntro.md)

---

## 1. Filozofia projektu

- **Podejście systemowe** — projekt budowany jako spójny system, nie zbiór niezależnych hacków. Każdy moduł ma jasno zdefiniowane wejście i wyjście; zmiany w jednym module nie wymagają łatania pozostałych.
- **Oparcie na przepływie danych** — architektura podąża za naturalnym przepływem danych (source → tokens → AST → typed AST → S-expr → WASM bytes). Żaden etap nie sięga wstecz; żaden nie omija kolejnego. Brak cheatowania architektury.
- **Zero zależności** — cały kompilator w czystym, natywnym JS (ES modules)
- **Przeglądarka jako runtime** — statyczna strona HTML, brak bundlera, brak Node.js
- **Binary WASM ręcznie** — bez wabt.js, binarny format generowany bit po bicie
- **Iteracyjny rozwój** — każda faza jest niezależnym modułem z jasnym interfejsem
- **Pareto-first** — najprostsza implementacja spełniająca wymagania, refaktor tylko gdy potrzeba

---

## 2. Struktura plików

```
index.html               — QLang IDE UI (edytor, przyciski, panele)
ide/
  main.js                — Entry point (ES module): compile/run/debug + inicjalizacja; importuje macro-panel.js
  vfs.js                 — Virtual File System: Project (pliki jako Map) + VFS (wiele projektów); localStorage persistence; `isExample` flag − session-only projects not saved
  file-tree.js           — <qlang-file-tree> Web Component: setFiles(), ft-file-* + ft-project-rename/delete events; editable project name input
  project-ui.js          — initProjectUI(deps) → activateProject; obsługa file-tree events, tab bar, new-project, rename/delete project
  examples.js            — initExamples(onLoad, { getProjects, onProjectOpen }): "Open project" dropdown; sekcje My projects + Examples
  views.js               — Renderery widoków: syntaxHighlight, renderWAT, renderBytecode
  source-view.js         — <qlang-source-view> Web Component: editable (edytor) + read-only (panel makra)
  qlang-pane.js          — <qlang-pane> Web Component: strukturalny wrapper paneli
  qlang-toolbar.js       — <qlang-toolbar> Web Component: przyciski nagłówka → eventy ql-compile/ql-run/ql-debug/ql-clear
  qlang-error-panel.js   — <qlang-error-panel> Web Component: setErrors(), log(), clear() → event ql-error-click
  qlang-console.js       — <qlang-console> Web Component: write(text) [biały], log(msg) [niebieski], clear(), startInput(cb), cancelInput()
  layout.js              — Resize handlerów (col/row-handle), drag & drop paneli, zwijanie/rozwijanie
  crossSelection.js      — Cienki re-export shim (~25 linii): setStmtMap, enclosingStmt, highlightSourceRange
  highlight.js           — Koordynator podświetleń: highlightAndScrollSource, applyChainHighlights, clearAll
  ide-state.js           — Pasywny store: setExpLog/getExpLog, setLast*/getLast*, setLastImportEnv/getLastImportEnv (zero zależności)
  source-registry.js     — Rejestr SourceBuffer + widoków; registerView, getView, highlightInSource
  lsp.js                 — Narzędzia edytora: autocomplete (3 tryby: general/dot/::), getScopeItems (obsługuje NamespaceImport → alias jako 'namespace'), getNamespaceMembers (Case A: alias importu → sub-namespace'y + funcs; Case B: sub-namespace z importEnv), resolveChainedType, syncAstHighlight; re-eksportuje setLastImportEnv
  editor.js              — contenteditable helpery: getEditorText, getCaretOffset/setCaretOffset, getSelectionOffsets, setSelectionRange, getEditorLine
  hover.js               — Hover data builder: HINTS (statyczne definicje), buildHoverData (AST walker)
  macro-panel.js         — Manager paneli makr; +lens buttons; inner +lens; close-all na recompile
  navigate.js            — Nawigacja canonical-ref; navigateToRef, navNext/navPrev/clearNav
  nav-bar.js             — Pływający pill #nav-bar (◁ ▷ ×)
  debugger.js            — Debug session: sourceBps, initDebugger(generate, log, {onStart, onStop, consolePanel}); Worker-based via wasm-runner.js
  wasm-runner.js         — Web Worker: uruchamia WASM w trybie run/debug; SharedArrayBuffer+Atomics dla I/O i debug pause
  lang-docs.js           — Markdown renderer + ładowanie dokumentacji języka
compiler/
  lexer.js               — Faza 1: Tokenizer
  parser-base.js         — Faza 2 base: ParseError, node(), ParserBase (stream utilities)
  parser-exprs.js        — Faza 2 mid: ParserExprs extends ParserBase — parseType() + wszystkie parseXxxExpr()
  parser.js              — Faza 2 top: Parser extends ParserExprs — deklaracje, instrukcje, struct
  macro-expander.js      — Faza 2.5: Hygienic macro expander (token substitution)
  staticAnalysis.js      — Typy pomocnicze: TypeError, Scope, typeEq, typeStr, isNumeric, isStruct, buildStructType…
  type-infer.js          — TypeInferBase — wszystkie metody infer*() w izolacji
  staticTypeChecker.js   — TypeChecker extends TypeInferBase (check*) + typecheck() + liveTypecheck()
  pipeline.js            — compile(src) [alias → compileMulti]; compileMulti(src, getFile) — primary multi-file compile z namespace imports, zwraca importEnv; liveCompile(src, opts); liveCompileMulti(src, getFile) — live multi-file, zwraca { ...liveCompile, importEnv }
  wasm-encoder.js        — Pomocniczy: LEB128, opcody, sekcje WASM
  wat-utils.js           — SExprBuilder, BUILTINS, canonType, BumpAllocator, HEAP_BASE
  defer-pass.js          — Faza 3b: AST rewrite pass — inline DeferStmt przed każdym ReturnStmt i przy fallthrough
  wat-emitter.js         — emitFunc / emitStmt / emitExpr (buduje S-expr + sSpans)
  wat-encoder.js         — buildWAT(ast) → { module, sSpans }; re-eksportuje watToText
  wat-serializer.js      — watToText(module, sSpans) → { text, spans }
  codegen.js             — Faza 4: Generator binarnego WASM
  ast-renderer.js        — Renderowanie AST do HTML (interaktywne drzewo <details>)
tests/
  helpers.js             — test, suite, assert, assertEq, assertThrows, compileAndGenerate, summarize
  test.js                — Orkiestrator (importuje wszystkie test-*.js + summarize)
  test-lexer.js          — Suity: typy tokenów, offsety, błędy
  test-lexer-macro.js    — Suity: tokenizacja makr
  test-parser.js         — Suity: VarDecl, FuncDecl, wyrażenia, start/end
  test-parser-macro.js   — Suity: parsowanie makr
  test-parser-recovery.js — Suity: resilient parsing, ErrorNode recovery
  test-typechecker.js    — Suity: inferencja, lokalne funkcje, błędy, shadowowanie, _typeAnnotStart/End
  test-codegen.js        — Suity: WASM validity, tablice, ptr, ByteSpan, debugger
  test-macros.js         — Suity: rozwijanie makr, BracketAccess, QualifiedName, Namespace
  test-struct.js         — Suity: struct declaration, field access, type checking
  test-namespace.js      — Suity: namespace, qualified names, hover, chained dot-completion
  test-defer.js          — Suity: defer statements
  test-ide-logic.js      — Suity: autocomplete logic, getScopeItems, resolveChainedType
  test-ide-ui.js         — Suity: IDE UI behavior, auto-indent
  test-ide-smoke.js      — Suity: DOM IDs, pliki IDE, pipeline shape, hover data, Web Component tagi
  test-vfs.js            — Suity: VFS Project, createProject, persistence, isExample session-only behaviour
  test-ast-renderer.js   — Suity: AST rendering
  package.json           — { "type": "module" }
start.js                 — Serwer deweloperski Node.js: COOP/COEP headers + no-cache; wymagany dla SharedArrayBuffer
langIntro.md             — Wprowadzenie do języka
langDetail.md            — Specyfikacja szczegółowa
archIntro.md             — Architektura (wprowadzenie)
archDetail.md            — Ten plik
ide.md                   — Dokumentacja edytora i interfejsu IDE
```

---

## 3. Pipeline kompilatora

```
Source (string)
    │
    ▼  tokenize(src)
Token[]                        ← lexer.js
    │
    ▼  parse(tokens)
AST (Program node)             ← parser.js
    │
    ▼  expand(ast)
AST (macros resolved)          ← macro-expander.js
    │
    ▼  typecheck(ast)
Typed AST                      ← typechecker.js
    │
    ▼  deferPass(ast)           ← defer-pass.js  (AST rewrite: DeferStmt → inline stmts)
Typed AST (bez DeferStmt)      ← [mutacja in-place]
    │
    ▼  generate(ast)           ← codegen.js  (jeden punkt wejścia, zwraca wszystko)
    │     │
    │     ├──▼  buildWAT(ast)           ← wat-encoder.js
    │     │  WatModule (S-expr) + SSpans
    │     │
    │     ├──▼  watToText(module, sSpans)   ← wat-serializer.js (re-eksportowane przez wat-encoder.js)
    │     │  { text: string, spans: TextSpan[] }
    │     │
    │     └──▼  sExprToWasm(module, sSpans) ← codegen.js
    │        { bytes: Uint8Array, byteSpans: ByteSpan[] }
    │
    ├── bytes → WebAssembly.instantiate(bytes, imports)
    │           WASM Instance → instance.exports.main() → konsola IDE
    │
    ├── { text, spans } → renderWAT(text, spans)
    │                     WAT Explorer (HTML)          ← views.js
    │
    └── { bytes, byteSpans } → renderBytecode(container, bytes, byteSpans, enclosingStmt)
                               Bytecode View (HTML)    ← views.js
```

### Typy spanów

```ts
// S-expr node ↔ AST node (wewnętrzna warstwa pośrednia)
// startIdx/endIdx: zakres dzieci w node[] należących do tego spanu
SSpan    = { node: SNode, startIdx: number, endIdx: number, astNode: ASTNode }

// Char-offset w tekście WAT ↔ AST node  (używany przez WAT Explorer)
TextSpan = { watStart: number, watEnd: number, astNode: ASTNode }

// Byte-offset w binarnym WASM ↔ AST node  (używany przez Bytecode View)
// Per-expression: jeden span na wyrażenie/statement (przygotowanie do debuggera)
ByteSpan = { byteStart: number, byteEnd: number, astNode: ASTNode }
```

---

## 4. Faza 1 — Lexer (`compiler/lexer.js`)

### Eksport
- `tokenize(src: string): Token[]`
- `LexError` — błąd z `line`, `col`, `start`, `end`
- `TT` — enum typów tokenów (frozen object)

### Struktura tokenu

```js
{
  type:  string,   // TT.IDENT, TT.NUMBER, …
  value: string,   // surowa wartość
  line:  number,   // 1-based
  col:   number,   // 1-based
  start: number,   // bajt-offset początku w src (włącznie)
  end:   number,   // bajt-offset końca w src (wyłącznie)
}
```

### Typy tokenów

| Token | Opis | Przykłady |
|---|---|---|
| `IDENT` | identyfikator | `x`, `main`, `add`, `i32`, `f64` |
| `NUMBER` | literał liczbowy | `5`, `3.14`, `1_000` |
| `BOOL_LIT` | literał boolowski | `true`, `false` |
| `STRING_LIT` | literał łańcuchowy | `"hello"`, `"a\n"` |
| `CHAR_LIT` | literał znakowy — `value` jest **numerycznym stringiem** kodu ASCII | `'A'` → `value:"65"`, `'\n'` → `value:"10"` |
| `KEYWORD` | słowo kluczowe języka | `return`, `as`, `if`, `else`, `while`, `break`, `mut`, `ptr`, `array`, `fn`, `macro`, `namespace` |
| `OP` | operator | `:=`, `:`, `=`, `+`, `-`, `*`, `/`, `&`, `<`, `>`, `;`, `,`, `!`, `\|`, `&&`, `\|\|`, `==`, `!=`, `<=`, `>=`, `::` |
| `PUNCT` | znak interpunkcji | `(`, `)`, `{`, `}`, `[`, `]`, `.` |
| `MACRO_PARAM` | odwołanie do parametru makra | `@name` |
| `MACRO_VAR` | gensym makra | `$name` |
| `MACRO_STRINGIFY` | stringify makra | `#name` |
| `EOF` | koniec pliku | |

### Decyzje projektowe
- `true`/`false` → `BOOL_LIT` (nie `KEYWORD`) — upraszcza parser
- Typy (`i32` itd.) → `IDENT` (nie osobny token) — scalary rejestrowane w globalScope, traktowane jak structs
- `:=` rozpoznawane jako jeden token (lookahead 1 w lexerze)
- Separatory liczbowe `_` usuwane w lexerze (`1_000` → `"1000"`)
- Komentarze `//` i `/* */` ignorowane w lexerze (nie emitują tokenów)
- `.` → `PUNCT` — operator dostępu do składowej (`arr.size`); brak kolizji z float (lexer obsługuje `1.5` wcześniej), sekwencje escape obsługiwane w string literał (`\n`,`\r`,`\t`,`\\`,`\"`)
- String nie jest null-terminated na poziomie języka — długość przenoszona przez system typów (`array<u8, N>`)
- Wieloliniowe strings są błędem leksykalnym (prostota parsowania)
- Char literal `'x'` przechowuje kod ASCII jako `value` (string numeryczny), zakres 0–127; pusty `''` i nieznane escape `'\q'` są `LexError`
- Dwa sąsiednie `STRING_LIT` są scalane przez **parser** (nie lexer) w jeden węzeł `StringLiteral`; lexer emituje osobne tokeny

---

## 5. Faza 2 — Parser (`compiler/parser.js`)

### Struktura plik\u00f3w (3-tier hierarchy)

| Plik | Zawarto\u015b\u0107 |
|---|---|
| `compiler/parser-base.js` | `ParseError`, `node()`, `errorNode()`, klasa `ParserBase` (stream utilities) |
| `compiler/parser-exprs.js` | `ParserExprs extends ParserBase` \u2014 `parseType()`, `parseExpr()`, wszystkie `parseXxxExpr()` |
| `compiler/parser.js` | `Parser extends ParserExprs` \u2014 deklaracje, instrukcje, `parseStructDeclBody()` |

### Eksport (z `parser.js`)
- `parse(tokens: Token[]): ProgramNode`
- `ParseError` \u2014 b\u0142\u0105d z `line`, `col`, `start`, `end`
- `Parser` \u2014 klasa (do test\u00f3w jednostkowych)

### Strategia parsowania
- Recursive descent, LL(2)
- Bez backtrackingu
- AST node: `{ kind: string, ...props, start: number, end: number }` \u2014 ka\u017cdy w\u0119ze\u0142 niesie bajt-offsety

### Disambiguacja funkcja vs zmienna
S\u0142owo kluczowe `fn` jednoznacznie identyfikuje deklaracj\u0119 funkcji \u2014 brak potrzeby lookahead:

Przy `IDENT ':='`:
- jeśli następnie `fn` → `FuncDecl` (parsuj typ, `(`, parametry, `)`, blok)
- inaczej → `VarDecl` (inferred, zawsze `const`)

Przy `IDENT ':'`:
- parsuj typ, `=`, wyrażenie → `VarDecl` (explicit, `mut` jeśli typ zaczyna się od `mut`)

### Węzły AST

Wszystkie węzły mają pola `start: number` i `end: number` (bajt-offsety w src, inclusive/exclusive).  
Typy (`Type`, `ArrayType`) mają dodatkowe pole **`mut: bool`** — decyduje o mutabilności zmiennej/elementu.

| Kind | Pola |
|---|---|
| `Program` | `body: Decl[]` |
| `FuncDecl` | `name, returnType, params, body, line, start, end` |
| `VarDecl` | `name, typeAnnot\|null, value, line, start, end` |
| `Param` | `name, typeAnnot, line, start, end` |
| `Block` | `body: Stmt[], line, start, end` |
| `ReturnStmt` | `value: Expr|null, line, start, end` — `null` for void return |
| `ExprStmt` | `expr, line, start, end` |
| `AssignStmt` | `target: Identifier|BracketAccessExpr, value, line, start, end` |
| `IfStmt` | `condition, then: Block, elseBranch: Block\|null, line, start, end` — `else if` owija kolejny `IfStmt` w syntetyczny `Block` |
| `WhileStmt` | `condition, body: Block, line, start, end` |
| `BreakStmt` | `line, start, end` |
| `ScopeBlock` | `body: Stmt[], line, start, end` — anonimowy blok leksykalny bez warunku |
| `Type` | `name, **mut: bool**, line, start, end` |
| `PtrType` | `inner: TypeNode, **mut: bool**, line, start, end` |
| `FuncType` | `returnType, paramTypes: TypeNode[], **mut: bool**, line, start, end` |
| `BinaryExpr` | `op, left, right, line, start, end` |
| `UnaryExpr` | `op, operand, line, start, end` |
| `CallExpr` | `callee, args, line, start, end` |
| `AsExpr` | `asType, expr, line, start, end` |
| `ArrayType` | `elemType, size, **mut: bool**, line, start, end` |
| `ArrayLiteral` | `elements: Expr[], line, start, end` |
| `PackLiteral` | `elements: Expr[], line, start, end` — `[e, e, ...]` comptime pack literal |
| `StringLiteral` | `value: string, line, start, end` |
| `BracketAccessExpr` | `base, index, dotStart, line, start, end` — `arr.[i]` — jedyna składnia dostępu indeksowego |
| `QualifiedName` | `segments: string[], args: Expr[]\|null, line, start, end` — `A::B::C(args?)` |
| `NamespaceDecl` | `name: string, target: string[]\|null, line, start, end` — `std := namespace;` |
| `NamespacedDecl` | `segments: string[], inner: FuncDecl\|VarDecl, line, start, end` — `std::foo := fn() ...` |
| `NamespaceImport` | `alias: string, filename: string, line, start, end` — `m := namespace "math.qlang";` |
| `StructDecl` | `name: string, fields: StructField[], line, start, end` |
| `StructField` | `name: string, typeAnnot: TypeNode, mut: bool, defaultValue: Expr\|null, line, start, end` |
| `UserTypeRef` | `name: string, mut: bool, line, start, end` — user-defined type ref w pozycji type annotation |
| `QualifiedTypeRef` | `segments: string[], mut: bool, line, start, end` — kwalifikowana adnotacja typowa: `m::Vec2`, `a::b::T`; emitowana przez `parseType()` gdy po IDENT następuje `::` |
| `TypeRef` | `name: string, line, start, end` — bare type name w wyrażeniu |
| `MacroDecl` | `name, params: MacroParam[], body: MacroBody, bodyTokens: Token[], line, start, end` |
| `MacroBody` | `tokens: Token[], line?, start?, end?` |
| `MacroCallStmt` | `name, args: MacroArg[], raw, line, start, end` |
| `MacroCallExpr` | `name, args: MacroArg[], line, start, end` — v1: architecture hook, rzuca błąd |
| `MacroVarExpr` | `name: string, line, start, end` — `$name` wewnątrz ciała makra |
| `MacroParamExpr` | `name: string, line, start, end` — `@param` wewnątrz ciała makra |
| `MacroStringifyExpr` | `name: string, line, start, end` — `#param` wewnątrz ciała makra |

### Priorytety wyrażeń (rosnąco)

```
parseExpr → parseOrExpr (||)
         → parseAndExpr (&&)
         → parseCmpExpr (== != < > <= >=)
         → parseAddExpr (+ -)
         → parseMulExpr (* /)
         → parseUnaryExpr (! - & as)
         → parseCallOrPrimary   ← postfix: () [] . .*
```

### Decyzje projektowe (Typy)
- `array<T, N>` jest węzłem `ArrayType { elemType, size, mut }` — rozmiar znany w parse-time; `mut` na ArrayType to outer mutability, `elemType.mut` to inner
- `ptr<T>` jest węzłem `PtrType { inner, mut }` — `mut` to outer mutability (binding), `inner.mut` to pointee mutability
- `parseType()` obsługuje opcjonalny `mut` prefix: `mut array<mut T, N>` → `ArrayType { mut:true, elemType: {name:T, mut:true} }`
- Template-like syntax: `ptr<T>` i `array<T, N>` przygotowują do przyszłych user-defined templates
- Return type funkcji NIE może być `ArrayType` — tablice są przekazywane jako wskaźniki (`i32`)
- Literał `{e, e}` → `ArrayLiteral { elements }` — domyślnie const; wymaga jawnej adnotacji z `mut` dla mutowalności
- Literał `"abc"` → `StringLiteral { value }` — domyślnie const; TypeChecker weryfikuje długość UTF-8
- `fn(params) Type` w `parseType()` → `FuncType { returnType, paramTypes }` — używany w `ptr<fn(...) Type>`; nazwy parametrów opcjonalne
- `normalizeType()` w TypeChecker konwertuje `FuncType` → `{ name: '__func__', returnType, paramTypes }` — ujednolicenie z sygnaturami z `FuncDecl`
- `.*` (postfixowa dereferencja) parsowana w `parseCallOrPrimary()` po `.` — tworzy `UnaryExpr { op: '*', operand }`; prefix `*` usunięty
- `-` (negacja) parsowana w `parseUnaryExpr()` — tworzy `UnaryExpr { op: '-', operand }`; obsługuje typy numeryczne (`i32`, `u8`, `u16`, `u32`, `f64`); codegen: `i32.const 0; operand; i32.sub` (int) lub `f64.neg` (float)
- `else if` parsowane w `parseIfStmt()` — po zjedzeniu `else`, jeśli następny token to `if`, parser rekurencyjnie wywołuje `parseIfStmt()` i owija wynik w syntetyczny `Block`; zero zmian w typecheckerze i codegenecie

---

## 5.5. Faza 2.5 — Macro Expander (`compiler/macro-expander.js`)

### Eksport
- `expand(ast): Map<callStart, ExpansionEntry>` — mutuje AST in-place; usuwa `MacroDecl`, zastępuje `MacroCallStmt` rozwiniętymi stmt; zwraca expansion log dla hover
- `MacroError` — błąd z `line`

### Pipeline position
```
parse(tokens) → expand(ast) → typecheck(ast) → generate(ast)
```

### Zasady podstawiania tokenów
| Marker | Rodzaj | Wynik |
|---|---|---|
| `@param` | `expr` | `( arg_tokens )` — opakowany w nawiasy (priorytety operatorów) |
| `@param` | `ident` / `block` / `type` / `any` | `arg_tokens` — raw |
| `$name` | — | `__mg_name_N` — gensym (N = licznik wywołania, per expansion) |
| `#param` | — | `STRING_LIT` — tekst tokenów argumentu jako `array<u8, N>` |

### Expansion log
`expand(ast)` zwraca `Map<number, ExpansionEntry>` gdzie klucz to `stmt.start`:
```js
{
  name:           string,   // nazwa makra
  end:            number,   // koniec call-site (byte offset)
  callLine:       number,   // numer linii wywołania
  macroSig:       string,   // np. "arr: expr, elem: ident, body: block"
  bodySource:     string,   // AST rozwinięcia przeliczone przez stmtsToSourceMapped() — pre-expansion tekst z MacroCallStmt
  expandedSource: string,   // stringifikacja tokenów po podstawieniu (single-line)
  preExpBody:     ASTNode[], // snapshot block.body PRZED expandStmtList — MacroCallStmt nodes intact
  expandedBody:   ASTNode[], // body PO rekurencyjnej ekspansji (MacroExpansionNode zamiast MacroCallStmt)
}
```
- `bodySource` = `stmtsToSourceMapped(block.body)` z `ast-to-source.js` — pre-expansion tekst (MacroCallStmt shown as `name!(args);`)
- `preExpBody` = `[...block.body]` — shallow copy; IDE macro panels używają tego do hover (pozycje matchują bodySource)
- `expandedSource` = `stringifyTokens(innerTokens)` — token-level, używane przez starą ścieżkę hover

### Ograniczenia v1
- Brak makr rekurencyjnych
- Brak variadics
- `MacroCallExpr` (makro w pozycji wartości) → `MacroError` z wyjaśnieniem
- Wywołania makr tylko jako statement (`MacroCallStmt`); top-level macro calls nie są parseowane

---

## 5.6. Narzędzie: AST → Source (`compiler/ast-to-source.js`)

### Cel architektoniczny
Moduł jest fundamentem przyszłego formatera kodu QLang (analogia: `clang-format`, `gofmt`).
Aktualnie używany przez macro lens do wyświetlania **realnego rozwinięcia makra** (z podstawionymi argumentami), nie szablonu body.

### Eksport
- `stmtsToSource(stmts, indent?)` → `string` — lista instrukcji; każda na osobnej linii z 4-spacjowymi wcięciami
- `nodeToSource(node, indent?)` → `string` — dowolny węzeł AST (wyrażenie lub instrukcja)

### Obsługiwane węzły

**Typy:**

| Kind | Wynik |
|---|---|
| `Type` | `(mut?) name` |
| `PtrType` | `(mut?) ptr<inner>` |
| `ArrayType` | `(mut?) array<elem, N>` |
| `FuncType` | `(mut?) fn(params) retType` |

**Wyrażenia:**

| Kind | Wynik |
|---|---|
| `Literal` | literał liczbowy / bool (`isBool`, `isFloat`) |
| `Identifier` | `name` |
| `StringLiteral` | `"escaped"` |
| `ArrayLiteral` | `{e, e, ...}` |
| `BinaryExpr` | `left op right` (z nawiasami przy niższym priorytecie) |
| `UnaryExpr` | `op operand` lub `operand.*` dla dereferencji |
| `CallExpr` | `callee(args)` |
| `BracketAccessExpr` | `base.[index]` |
| `PackLiteral` | `[e, e, ...]` |
| `MemberExpr` | `obj.member` |
| `AsExpr` | `expr as<Type>` |
| `QualifiedName` | `A::B::C(args?)` |
| `NamespaceDecl` | `name := namespace [Target::Chain];` |
| `NamespacedDecl` | `A::B := fn(...) ...` / `A::B := expr;` |
| `StructDecl` | `Name := struct { fields }` |

**Instrukcje:**

| Kind | Wynik |
|---|---|
| `VarDecl` | `name := expr;` lub `name: Type = expr;` |
| `FuncDecl` | `name := fn(params) RetType { body }` |
| `ReturnStmt` | `return expr;` lub `return;` dla void |
| `ExprStmt` | `expr;` |
| `AssignStmt` | `target = value;` |
| `IfStmt` | `if cond { ... } else if (cond2) { ... } else { ... }` |
| `WhileStmt` | `while cond { ... }` |
| `BreakStmt` | `break;` |
| `ScopeBlock` | `{ stmts }` |
| `MacroExpansionNode` | inline body (transparentne, bez dodatkowego scope) |
| `MacroCallStmt` | `name!(arg1, arg2, ...);` — pre-expansion call site z tokenów |
| `ErrorNode` | `/* parse error */` |

### Priorytety operatorów (`PREC`)
Nawiasy dodawane automatycznie gdy dziecko `BinaryExpr` ma niższy priorytet niż rodzic:
`||=1 < &&=2 < cmp=3 < +/-=4 < */=5`

---

## 6. Faza 3 — Type Checker

Pliki po refaktoryzacji:

| Plik | Zawartość |
|---|---|
| `compiler/staticAnalysis.js` | `TypeError`, stałe `INT_TYPES`/`FLOAT_TYPES`/`NUM_TYPES`, helpery `typeEq`, `typeStr`, `isNumeric`, `isInt`, `isArray`, `isPtr`, `isFunc`, `isStruct`, `normalizeType`, `elemByteSize`, `typeByteSize`, `buildStructType`, `structFieldType`, `fieldByteOffset`, `isAssignable`, `canAsConvert`, klasa `Scope` |
| `compiler/type-infer.js` | Klasa `TypeInferBase` — wszystkie metody `infer*()` (inferencja wyrażeń) |
| `compiler/staticTypeChecker.js` | Klasa `TypeChecker extends TypeInferBase` (metody `check*`) + eksportowane funkcje `typecheck()` i `liveTypecheck()` |
| `compiler/typechecker.js` | Barrel: re-eksportuje `TypeError`, `typeStr` z `staticAnalysis.js` oraz `TypeChecker`, `typecheck`, `liveTypecheck` z `staticTypeChecker.js` |

### Eksport (barrel `typechecker.js`)
- `typecheck(ast): TypedAST`
- `TypeError` — błąd z `line`, `start`, `end`; overloaded constructor: `(msg, node)` lub `(msg, line, start?, end?)`
- `TypeChecker` — klasa

### Symbol Table
- Scope stack: `Scope { parent, symbols: Map<name, { type, kind, mut }> }`
- `pushScope()` / `popScope()` wywoływane przy wejściu/wyjściu z każdego `Block` (funkcja, if, while, ScopeBlock)
- `checkBlock()` zawsze tworzy nowy scope — zmienne nie wyciekają poza blok
- `checkFuncDecl()` tworzy dodatkowy zakres dla parametrów (rodzic zakresu ciała)
- Two-pass dla top-level: najpierw rejestracja sygnatur funkcji, potem sprawdzanie ciał
- **4-pass dla top-level** — Pass 0: `NamespaceDecl` (aliasy) + `NamespaceImport` (rejestracja jako 'namespace' w scope z `mountNamespace` z importEnv); Pass 1a: rejestracja sygnatur `NamespacedDecl`+`FuncDecl`; Pass 1b: rejestracja placeholder `StructType`; Pass 2: sprawdzanie ciał i `StructDecl` (rozwijanie pól)
- `resolveType(typeAnnot, errorNode)`: konwertuje `UserTypeRef` → resolved `StructType` przez scope lookup; `QualifiedTypeRef` → `scope.resolveQualified(segments)` — obsługuje alias expansion; fallback na `normalizeType` dla pozostałych
- Lokalne `FuncDecl` w bloku: rejestrowane w scope i natychmiast type-checked (`checkStmt` obsługuje `FuncDecl`)
- `checkFuncDecl` zapisuje/przywraca `currentReturnType` — bezpieczne dla zagnieżdżonych funkcji
- **Shadowing jest błędem**: `Scope.define()` rzuca `TypeError` jeśli nazwa istnieje w bieżącym lub zewnętrznym scope

### System const/mut

Jest to **core feature** kompilatora — wbudowany w fazę type-checkingu:

| Deklaracja | Binding | Elementy |
|---|---|---|
| `x := 5` | const (inferred, zawsze) | — |
| `x : i32 = 5` | const (brak `mut`) | — |
| `x : mut i32 = 5` | **mut** | — |
| `arr := {1,2,3}` | const | const (inferred) |
| `arr : array<i32, 3> = {1,2,3}` | const | const |
| `arr : mut array<i32, 3> = {1,2,3}` | **mut** | const |
| `arr : mut array<mut i32, 3> = {1,2,3}` | **mut** | **mut** |
| `arr : array<mut i32, 3> = {1,2,3}` | const | **mut** |

> **Podwójny `mut` na tablicach**: Outer `mut` (binding) i inner `mut` (elementy) to dwa niezależne poziomy. Dla tablic statycznych (`array<T, N>`) outer `mut` pozwala na nadpisanie całej tablicy (`arr = {new, values}`). Mechanika ta będzie kluczowa przy przyszłych wektorach (dynamic arrays), gdzie outer `mut` pozwoli na `push`/`pop`/`resize`, a inner `mut` kontroluje zapis przez indeks.

- Shadowing jest **błędem** — ta sama nazwa w tym samym lub zewnętrznym scope → `TypeError`
- `Scope.define(name, type, kind, mut, line)` sprawdza `symbols` i wszystkie parent-scopes
- Przypisanie do zmiennej const (`sym.mut === false`) → `TypeError`: `Cannot assign to const variable`
- Indeksowanie tablicy const (`arr[i] = v` gdzie `elemType.mut === false`) → `TypeError`: `Cannot assign to element of const array`
- `expr._elemMut: bool` — annotowane przez `inferIndexExpr` na podstawie `baseTy.elemType.mut`
- `expr._mut: bool` — annotowane przez `inferIdent` na podstawie `sym.mut`

### Reprezentacja typów
Typy jako plain objects, każdy z polem `mut: bool`:
```js
{ kind: 'Type',       name: 'i32', mut: false }                   // const skalar
{ kind: 'Type',       name: 'i32', mut: true  }                   // mut skalar
{ kind: 'PtrType',    inner: TypeNode, mut: false }                // const ptr<T>
{ kind: 'PtrType',    inner: TypeNode, mut: true  }                // mut ptr<T>
{ kind: 'ArrayType',  elemType: TypeNode, size: N, mut: false }    // array<T, N>
{ kind: 'StructType', name: string, fields: StructField[], byteSize: number,
  fieldOffsets: Map<string,number>, mut: false }                    // struct T
{ name: '__func__',    returnType, paramTypes, mut: false }        // funkcja
{ name: '__builtin__', returnType, paramTypes, builtinName, mut: false } // built-in
```
`typeEq(a, b)` i `isAssignable(from, to)` **ignorują** pole `mut` — const/mut to cv-qualifier, nie część base-type.

`StructType` jest budowany przez `buildStructType(name, resolvedFields)` z `staticAnalysis.js` — oblicza `fieldOffsets` (natural alignment `min(field_size, 4)`) i `byteSize`.

### Reguły inferencji
- int literal → `{ kind: 'Type', name: 'i32', mut: false }`
- float literal → `{ kind: 'Type', name: 'f64', mut: false }`
- bool literal → `{ kind: 'Type', name: 'bool', mut: false }`
- `arr := {1,2,3}` → `ArrayType { elemType: {i32, mut:false}, size:3, mut:false }` — literał const
- `"abc"` → `ArrayType { elemType: {u8, mut:false}, size:N, mut:false }` — string const
- `arr[i]` → inferred elem type; `_elemMut` z `baseTy.elemType.mut` (array) lub `baseTy.inner.mut` (pointer)
- `arr.size` → `{ kind: 'Type', name: 'u32', mut:false }` — stała kompilacji, zawsze const
- `&x` → `{ kind: 'PtrType', inner: {kind:'Type', name:T, mut:false}, mut: false }`
- `*p` → `p.inner` (inner type of pointer)
- `a op b` porównanie → `{ kind: 'Type', name: 'bool', mut:false }`; `_operandType` dla codegen

### Kompatybilność przypisania (`isAssignable`)
- `array<T,N> ↔ array<T,N>` — rozmiar musi się zgadzać, elementy assignable; `mut` ignorowane
- `array<T,N> → ptr<T>` — array decay (tablica przekazywana jako wskaźnik)
- `ptr<T> ↔ ptr<T>` — inner type musi się zgadzać
- `int ↔ int` (dowolne int-family), `float ↔ float` — dozwolone
- Brak implicit int↔float coercji

### Walidacja sterowania przepływem
- `this.loopDepth: number` — licznik zagnieżdżenia pętli
- `break` poza pętlą → `TypeError`
- Warunek `if`/`while` musi być dokładnie `bool`

### Built-in print
- Rejestrowana w `TypeChecker._registerBuiltins()` jako `__builtin__`
- `inferCall` obsługuje zarówno `__func__` jak i `__builtin__`
- Return type: `void` — `__builtin__` print zwraca `void`

---

## 6.3. Multi-file — `compileMulti` i `liveCompileMulti` (`compiler/pipeline.js`)

### `compileMulti(src, getFile)`

Główny punkt wejścia dla kompilacji multi-file.

| Etap | Opis |
|------|------|
| Skanowanie `NamespaceImport` | Przechodzi top-level AST; dla każdego `NamespaceImport { filename }` rekurencyjnie wczytuje plik przez `getFile(filename)` |
| Cykliczne importy | `visiting: Set<string>` — jeśli `filename` już jest w zbiorze, rzuca `Error("Circular import: '...'")`  |
| Per-file typecheck | Każdy plik type-checkowany niezależnie z `_filePrefix` (np. `__f_math_qlang`) — prefiks zapewnia unikalne nazwy WASM globals/functions |
| `importEnv: Map<filename, { scope, ast }>` | Wynik per-file typecheck; mapuje nazwę pliku na scope i typed AST |
| TypeChecker Pass 0 głównego pliku | `mountNamespace(alias, importEnv[filename].scope)` — montuje scope importowanego pliku jako sub-namespace pod aliasem |
| Merge AST | `importedBodies` (FuncDecl + NamespacedDecl z importowanych plików) dołączane do `ast.body` głównego pliku przed codegen |

### `liveCompileMulti(src, getFile)`

Live-compile dla IDE (nie rzuca, zbiera błędy).

| Etap | Opis |
|------|------|
| `buildLiveImportEnv(src, getFile)` | Buduje `importEnv` bez `_filePrefix`; cykliczne importy — cicho pomija (`if (visiting.has(filename)) return`) zamiast rzucać |
| `liveCompile(src, { importEnv })` | Type-checkuje główny plik z gotowym `importEnv`; zwraca `{ typeErrors, ... }` |
| Brakujący plik / cykl | Plik nie trafia do `importEnv` → `liveTypecheck` generuje type error dla brakującego namespace — nigdy nie rzuca |
| Zwraca | `{ ...liveCompile, importEnv }` — `importEnv` używany przez IDE dla autocomplete |

### `QualifiedTypeRef` — resolve w typecheckerze

`resolveType(typeAnnot, errorNode)` obsługuje `QualifiedTypeRef` przez `scope.resolveQualified(typeAnnot.segments)`:
- `segments[0]` to alias (`m`) → `NamespaceImport` symbol → rozwiązuje w `importEnv` → sub-namespace ze strukturami importowanego pliku
- Kolejne segmenty (`Vec2`) → namespace struktowy → `StructType`
- Jeśli wynik nie jest `StructType` → `TypeError('... is not a type', errorNode)`

### Autocomplete — wykluczenie built-in skalarów

`getNamespaceMembers` (lsp.js) Case A iteruje `scope.namespaces.keys()` importowanego pliku. `_registerBuiltins()` rejestruje skalary (`i32`, `u8`, `bool`, ...) w każdym `globalScope.namespaces` — filtrowane przez `BUILTIN_NS` Set przed dodaniem do podpowiedzi.

---

## 6.5. Faza 3b — Defer Pass (`compiler/defer-pass.js`)

### Pipeline position
```
typecheck(ast) → deferPass(ast) → generate(ast)
```
`deferPass` musi być wywołany **po** `typecheck` (węzły potrzebują `_type`) i **przed** `generate` (codegen nie rozumie `DeferStmt`).

### Eksport
- `deferPass(ast): ast` — mutuje AST in-place; zwraca to samo `ast`

### Semantyka
`DeferStmt` to instrukcja parse-time; po przejściu defer-pass znika z AST — codegen jej nie widzi.

Reguły inline:
1. Deferred statementy z bieżącego bloku wstrzykiwane są **przed każdym `ReturnStmt`** w tym bloku — łącznie z `ReturnStmt` zagnieżdżonymi wewnątrz `IfStmt`/`WhileStmt`.
2. Jeśli blok kończy się bez `return` (fallthrough), deferred statementy doczepiane są **na end of block**.
3. **Kolejność wykonania:** odwrotna do kolejności deklaracji (LIFO — ostatni `defer` odpala pierwszy).
4. Zagnieżdżone funkcje (`FuncDecl` wewnątrz bloku) przetwarzane są **niezależnie** — ich własne `defer` nie wpływają na zewnętrzny zakres.

### Architektura wewnętrzna

```
deferPass(ast)
  └── rewriteFuncDecl(decl)
        └── rewriteBlock(stmts, outerDeferred=[])
              ├── Zbiera DeferStmt z bieżącego poziomu → localDeferred[]
              ├── Dla każdego nie-DeferStmt:
              │     activeDeferred = [...localDeferred, ...outerDeferred]
              │     rewriteStmt(stmt, activeDeferred)
              │       ├── IfStmt  → rewriteBlock(then.body,  activeDeferred)
              │       │            rewriteBlock(else.body,  activeDeferred)
              │       ├── WhileStmt → rewriteBlock(body.body, activeDeferred)
              │       ├── ScopeBlock → rewriteBlock(body,    activeDeferred)
              │       └── FuncDecl  → rewriteFuncDecl() (niezależny)
              │
              ├── 2nd pass: przed każdym ReturnStmt wstrzyknij flushAll()
              │                 flushAll = [...localDeferred,...outerDeferred].reverse()
              └── Fallthrough: doczep flushLocal()
                                flushLocal = [...localDeferred].reverse()
```

**Kluczowe rozróżnienie flush:**
- `flushAll()` — używany przed `ReturnStmt`: emituje wszystkie aktywne deferowane (lokalne + z zewnętrznych scope'ów), bo opuszczamy wszystkie obejmujące bloki naraz przy `return`.
- `flushLocal()` — używany przy fallthrough: emituje tylko **lokalne** deferowane bieżącego bloku. Zewnętrzne obsłuży własny fallthrough nadrzędnego `rewriteBlock`. Bez tego rozróżnienia zewnętrzne `defer` byłyby emitowane podwójnie.

### Obsługiwane formy DeferStmt
| Forma | Pole w węźle | Iniekcja |
|---|---|---|
| `defer expr;` | `expr`, `stmt: null` | `ExprStmt { expr }` |
| `defer x = v;` | `stmt: AssignStmt`, `expr: null` | `AssignStmt` (verbatim) |
| `defer { blok };` | `stmt: ScopeBlock`, `expr: null` | `ScopeBlock` (verbatim) |

### Powiązana zmiana w `wat-emitter.js`
`collectLocalDecls` śledzi odwiedzone węzły przez `Set` (deduplicacja). `defer-pass` wstrzykuje **ten sam obiekt** `ScopeBlock` przed każdym `ReturnStmt` i przy fallthrough. Bez `Set` zmienne z bloku `defer { ... }` byłyby zarejestrowane jako WASM locals wielokrotnie → `duplicate local` i błąd instancjacji.

---

## 7. Pomocniczy: WASM Encoder (`compiler/wasm-encoder.js`)

### Eksport
- `encodeULEB128(n)`, `encodeSLEB128(n)` — LEB128 encoding
- `encodeF32(v)`, `encodeF64(v)` — IEEE 754 little-endian
- `encodeVec(items)` — WASM vector (prefixed length)
- `encodeSection(id, contents)` — sekcja binarna
- `encodeFuncType(params, results)` — sygnatura funkcji
- `encodeString(str)` — WASM name encoding (UTF-8 z prefixem długości)
- `encodeLocal(count, valtype)` — deklaracja lokalnych WASM
- `wasmValtype(typeName)` — mapowanie nazwy typu na bajt WASM
- `instrByte(name)` — konwersja nazwy instrukcji WAT (np. `'i32.add'`) na bajt opkodu: `name.replaceAll('.','_')` → klucz w `OP`
- `OP` — mapa nazw opcodów na bajty (zawiera wszystkie opcody porównań i32/i64/f32/f64, `i32_and`, `i32_or`, `i32_xor`)
- `VALTYPE`, `SECTION_ID` — enumeracje

---

## 8. Faza 4 — Code Generator (`compiler/codegen.js`)

### Eksport
- `generate(ast: TypedAST): { bytes, byteSpans, watText, watSpans, module, sSpans }` — główna funkcja IDE; wywołuje całe sub-pipeline i zwraca wszystko w jednym kroku
- `sExprToWasm(module, sSpans)` — wewnętrzna (nieeksportowana); serializacja S-expr → bajty WASM + spany bajtowe

### Architektura: generate() jako punkt wejścia
`codegen.js` jest **orkiestratorem** pipeline'u — importuje zarówno `buildWAT` jak i `watToText` z `wat-encoder.js`:
```js
export function generate(ast) {
  const { module, sSpans }               = buildWAT(ast);
  const { text: watText, spans: watSpans } = watToText(module, sSpans);
  const { bytes, byteSpans }             = sExprToWasm(module, sSpans);
  return { bytes, byteSpans, watText, watSpans, module, sSpans };
}
```
Dzięki temu `main.js` wywołuje `generate()` raz i dostaje wszystko. `module` i `sSpans` są również  
eksponowane — potrzebne przez debugger (S-expr interpreter).

### ByteSpan — spany bajtowe (per-expression, debugger-ready)
`sExprToWasm` przyjmuje `sSpans[]` i buduje `ByteSpan[]`:
- Dla każdego wyrażenia i statementu: oblicza absolutne offsety bajtowe w finalnym binarnym WASM
- Produkuje `{ byteStart, byteEnd, astNode }` — jeden span per wyrażenie/statement, hierarchicznie zagnieżdżone
- Obsługuje bloki sterujące (if/while): SSpan z `startIdx`/`endIdx` + rekurencyjny `encodeInstrList`/`encodeInstrTracked`
- Funkcja-level span jest zachowany jako korzeń hierarchii (backward-compat)
- Wyliczanie offset: `prefixBytes.length + 1 (section_id) + sectionSizeBytes.length + countBytes.length + Σ(poprzednie ciała) + instrOffset + relByteStart`

### Pre-pass: zbieranie indeksów (`buildIndexMaps`)
Przed enkodowaniem `sExprToWasm` skanuje płytko `['module', ...]`:
- **typeIds**: każdy `['type', '$tN', ...]` → `Map<id, number>` (0-indexed)
- **funcIds**: importy (`['import', ...]`) → idx 0..importCount-1, user funcs (`['func', ...]`) → idx importCount..
- **localIds per func**: dla każdej `['func', '$id', ...children]` → `Map<localId, number>` z `['param',...]` (0..n-1) i `['local',...]` (n..)

### Enkodowanie sekcji
`sExprToWasm` przechodzi dzieci `['module', ...]` i zbiera je w odpowiednie sekcje:

| Tag S-expr | Sekcja binarna WASM (id) |
|---|---|
| `type` | Type section (0x01) |
| `import` | Import section (0x02) |
| `func` | Function section (0x03) — zbierane, emitowane zbiorczo |
| `table` | Table section (0x04) |
| `memory` | Memory section (0x05) |
| `export` | Export section (0x07) |
| `elem` | Element section (0x09) |
| `func` | Code section (0x0a) — ciała funkcji (zbierane razem z function section) |

Kolejność sekcji w binarnym WASM jest ściśle wymagana przez specyfikację.

### Enkodowanie instrukcji (`encodeInstr`)

| Forma S-expr | Bajty binarne |
|---|---|
| `'return'` / `'drop'` / `'i32.add'` / … (atom) | `[instrByte(atom)]` — jednobajtowe |
| `['i32.const', n]` | `[0x41, ...SLEB128(n)]` |
| `['i64.const', n]` | `[0x42, ...SLEB128(n)]` |
| `['f32.const', n]` | `[0x43, ...F32LE(n)]` |
| `['f64.const', n]` | `[0x44, ...F64LE(n)]` |
| `['local.get', '$x']` | `[0x20, ...ULEB128(localIdx($x))]` |
| `['local.set', '$x']` | `[0x21, ...ULEB128(localIdx($x))]` |
| `['call', '$f']` | `[0x10, ...ULEB128(funcIdx($f))]` |
| `['call_indirect', ['type', '$tN']]` | `[0x11, ...ULEB128(typeIdx($tN)), 0x00]` |
| `['br', n]` / `['br_if', n]` | `[0x0c/0x0d, ...ULEB128(n)]` |
| `'i32.load'` / `'i32.store8'` / … (atom) | `[instrByte(atom), alignLog2, 0x00]` — `isMemInstr` wykrywa load/store |
| `['if', ['then',...T], ['else',...E]?]` | `[0x04, 0x40, ...T, (0x05,...E,)? 0x0b]` |
| `['block', ['loop',...B]]` | `[0x02, 0x40, 0x03, 0x40, ...B, 0x0b, 0x0b]` |

`instrByte(name)` z `wasm-encoder.js`: zamienia `'i32.add'` na `'i32_add'` i szuka w `OP`.

### Usunięte z codegen.js
- `collectAllFuncDecls` — przeniesione do `wat-encoder.js`
- `collectLocalDecls` — przeniesione do `wat-encoder.js`
- `BumpAllocator` — przeniesione do `wat-encoder.js`
- `canonType` — przeniesione do `wat-encoder.js`
- `generateFunc`, `genStmt`, `genExpr` — zastąpione przez `encodeInstr`
- `signatureMap` — zastąpione przez `typeIds` z pre-passu na S-expr

---

## 9. WAT Encoder (`compiler/wat-encoder.js`)

### Eksport
- `buildWAT(ast: TypedAST): { module: SNode, sSpans: SSpan[] }` — buduje S-expr drzewo + spany
- `watToText` — re-eksportowane z `wat-serializer.js` przez `export { watToText } from './wat-serializer.js'`
- `SSpan: { node: SNode, startIdx: number, endIdx: number, astNode: ASTNode }` — zakres w liście S-expr powiązany ze źródłem
- `TextSpan: { watStart: number, watEnd: number, astNode: ASTNode }` — offset w tekście WAT

### WatIR — schemat S-expr

`SNode = string | number | SNode[]` — rekurencyjna definicja Lisp-style.  
Zawsze: `SNode[0]` to string-tag identyfikujący typ węzła.

**Sekcje modułu:**
```
['module', ...section*]
['type',   '$tN', ['func', ...param*, result?]]
['import', modname, fieldname, ['func', '$id', ...param*, result?]]
['memory', pages]                                // pages: number
['table',  size, 'funcref']                      // size: number
['elem',   ['i32.const', 0], 'func', ...'$fN']   // active element, table 0
['export', name, ['func',   '$id']]
['export', name, ['memory', 0]]
['func',   '$id', ...param*, result?, ...local*, ...instr*]
['param',  '$name', valtype]                     // nazwany (w func)
['param',  valtype]                              // bez nazwy (w import type)
['result', valtype]
['local',  '$name', valtype]
```

**Instrukcje w ciele funkcji:**
```
// Atomy — bez operandów, konwertują 1:1 na opcode
'return' | 'drop' | 'i32.eqz' | 'i32.and' | 'i32.or'
'i32.add' | 'i32.sub' | 'i32.mul' | 'i32.div_s' | 'i32.rem_s'
'i64.add' | 'f32.add' | 'f64.mul' | ...
'i32.eq' | 'i32.ne' | 'i32.lt_s' | 'i32.gt_s' | 'i32.le_u' | ...
'f64.lt' | 'f64.ge' | ...
'f32.convert_i32_s' | 'i32.trunc_f32_s' | 'f64.promote_f32' | ...
// Load/store też są atomami (instrByte + memArgAlign w codegen)
'i32.load' | 'i32.load8_s' | 'i32.load8_u' | 'i32.load16_s' | ...
'i32.store' | 'i32.store8' | 'i32.store16' | 'i64.store' | ...

// Węzły z operandami
['i32.const', n]          | ['i64.const', n]
['f32.const', n]          | ['f64.const', n]
['local.get', '$name']    | ['local.set', '$name']
['call', '$funcId']
['call_indirect', ['type', '$typeId']]
['br', depth]             | ['br_if', depth]

// Bloki kontrolne (zagnieżdżone, nie flat)
['if', ['then', ...instr*], ['else', ...instr*]?]
['block', ['loop', ...instr*]]   // while → block + loop zagnieżdżone
```

> **Uwaga o sekcji `if`:** używa zagnieżdżonych wrapperów `['then',...]` / `['else',...]` (styl specyfikacji WAT).  
> `watToText` serializuje je do płaskiego formatu `if / else / end` (zgodnie z poprzednim wyjściem).

### Klasa `SExprBuilder`
Zastępuje `Builder`. Zamiast akumulować tekst, buduje drzewo `SNode[]`:
- `push(node)` — dodaje węzeł do bieżącej listy
- `openList(tag)` → `closer` — otwiera tablicę z danym tagiem; zwraca funkcję zamykającą (wywołacie `closer()` kończy listę i wraca do rodzica)
- `openSpan(astNode) → closeSpan` — zapamiętuje `_top` oraz `startIdx = _top.length`; `closeSpan()` tworzy `SSpan { node: _top, startIdx, endIdx: _top.length, astNode }`
- `_top` — referencja do bieżącej aktywnej listy (dostępna również po `openList`, przed wywołaniem `closer`)
- Eksponowane w `wat-utils.js`

### `watToText(module, sSpans)` — serializator
Rekurencyjnie przechodzi S-expr drzewo:
- Sekcje modułu (`type`, `import`, `func`, …) → `(tag ...)` styl z wcięciami
- Ciało funckji: atomy → linia płaska; `['if', T, E?]` → flat `if / else? / end ;;`; `['block',...]` → `block / end ;;`
- Śledzi bieżący offset znakowy → dla każdego `SSpan` emituje `TextSpan { watStart, watEnd, astNode }`
- Produkuje identyczny format tekstu co poprzedni `Builder` — WAT Explorer niezmienny

### `BumpAllocator` i `canonType`
- Pozostają w `wat-encoder.js` — wymagane do budowy S-expr (adresy tablic, typy WASM)
- `collectAllFuncDecls`, `collectLocalDecls` — lambda-lifting i zbieranie locals jak dotychczas
- `collectLocalDecls` używa `Set` do deduplicacji węzłów AST — `defer-pass` może wstrzyknąć ten sam `ScopeBlock` w kilka miejsc; bez deduplicacji powstałyby zduplikowane `(local ...)` w WASM i konflikt nazw
- `BumpAllocator` per-function (`HEAP_BASE = 1024`)

### Source-map spans
- `SSpan` wiąże węzeł S-expr z węzłem AST; wiele `SSpan` na jeden AST node (hierarchiczne)
- `watToText` konwertuje `SSpan[]` → `TextSpan[]` podczas serializacji
- `spansByParentIdx` indeksuje pod OBYDWOMA kluczami (`startIdx` i `endIdx`) — konieczne do poprawnego działania `markChildStart`/`markChildEnd`
- `serFunc` używa `markChildStart(node, i+2)` / `markChildEnd(node, i+3)` — +2 bo `const [, fname, ...rest] = node` pomija tag i nazwę
- `main.js` korzysta z `TextSpan[]` (format niezmieniony)

---

## 10. QLang IDE

→ Patrz [ide.md](ide.md) — pełna dokumentacja edytora, paneli, autocomplete, hover, bytecode view i czterokierunkowego podświetlenia.

---

## 11. BumpAllocator i adresowanie pamięci

### Strategia (aktualna — łatwa do zamiany)
- Klasa `BumpAllocator` w `wat-encoder.js` (przeniesiona z codegen.js po refaktorze); każda funkcja dostaje własny egzemplarz
- `HEAP_BASE = 1024` — bajty 0–1023 zarezerwowane (na przyszłe użycie)
- `alloc(byteSize, align)` — przesuwa wskaźnik, zwraca adres
- `allocScalar(typeName)` — dla operatora `&`
- `allocArray(elemTypeName, count)` — dla deklaracji `array<T, N>`

### Interfejs `ArrayLayout`
Izolacja strategii alokacji: żeby zmienić strategię, wystarczy zastąpić `BumpAllocator`.  
Możliwe przyszłe strategie: shadow stack, segment data (data section WASM), heap z GC.

### Mapowanie typów do WASM
```
canonType(typeObj):
  ArrayType  → i32  (base address)
  PtrType    → i32  (pointer address)
  i8..u32    → i32
  i64/u64    → i64
  f32        → f32
  f64        → f64
  bool       → i32
```

### Alignment w WASM memarg
WASM `memarg` koduje `log2(alignment)`:
- u8/i8 → 0  (1-byte)
- u16/i16 → 1  (2-byte)
- i32/f32 → 2  (4-byte)
- i64/f64 → 3  (8-byte, nie używane w narrow stores)

### Import section
- Importy WASM są deklarowane w kodzie użytkownika składnią `extern!`: `name : fn(...) T = extern!("mod.field");`
- `collectAllImportDecls(ast)` w `compiler/wat-encoder.js` zbiera wszystkie `VarDecl._isRuntimeImport` i `NamespacedDecl.inner._isRuntimeImport` z top-level `ast.body`
- Importy mają niższe indeksy funkcji niż lokalne funkcje użytkownika (wymóg WASM spec)
- Kolejność indeksów: import 0..N-1, lokalne funkcje N..N+M
- Brak statycznego rejestru `BUILTINS` — wszystkie importy są user-declared; IDE dostarcza host-functions `env.write_utf8`, `env.print_utf8`, `env.input_utf8` jako standardowe I/O
- `buildWAT()` zwraca `wasmImports: [{ module, field, mangledName }]` — lista importów dla dynamicznej budowy `importObject` w `wasm-runner.js`

### Array decay
`array<T,N>` → `ptr<T>` jest dozwolone w przypisaniu i przekazywaniu argumentów (`isAssignable`).  
Zmienna tablicowa (`genIdent`) zwraca `local_get` — wartość lokalna to adres bazowy (`i32`).  

### Konwerter `as<T>()`
`inferAs()` waliduje konwersję skalarną przez `canAsConvert(from, to)`:  
- `int ↔ int` (dowolne szerokości), `float ↔ float`, `int ↔ float`, `bool ↔ int`, `bool ↔ float`  
- **Array decay**: `array<T,N>` → `ptr<T>` dozwolone gdy `typeEq(fromType.elemType, toType.inner)` — emituje adres bazowy tablicy (identycznie jak `&arr`); brak dodatkowej instrukcji WASM  
- Odrzuca typ wskaźnikowy jako źródło (`ptr<T>` → cokolwiek)  
- Odrzuca typy tablicowe i wskaźnikowe jako cel, jeśli nie zachodzi array decay  
- `as<mut T>()` jest błędem parsera — `mut` w typie docelowym jest zabroniony

### Short-circuit `&&` / `||`
Operatory `&&` i `||` korzystają z short-circuit evaluation:  
- `&&`: emituje lewy operand → `if (result) i32` → prawy operand → `else` → `i32.const 0` → `end`  
- `||`: emituje lewy operand → `if (result) i32` → `i32.const 1` → `else` → prawy operand → `end`  
Prawy operand nie jest ewaluowany, jeśli wynik został zdeterminowany przez lewy.

### Runtime (wasm-runner.js — Web Worker)
- WASM uruchamiany w Web Worker (`ide/wasm-runner.js`) — zarówno tryb Run jak i Debug
- Worker przyjmuje `{ bytes, sharedBuf, mode: 'run'|'debug', breakpoints?: number[] }`
- `write_utf8(ptr, len)`: odczytuje z `wasmMemory.buffer`, dekoduje UTF-8, wysyła `{type:'write', text}` (bez `\n`)
- `print_utf8(ptr, len)`: jak wyżej, ale `{type:'println', text}` — główny wątek dodaje `\n`
- `input_utf8(ptr, maxLen)`: zapisuje `STATE_INPUT(1)`, wysyła `{type:'input-wait'}`, blokuje Worker przez `Atomics.wait(ctrl, STATE_INPUT)`; `STATE_ABORT` → rzuca `AbortExecution`; `STATE_INPUTOK(2)` → kopiuje dane z SharedArrayBuffer do pamięci WASM
- Tryb debug dodaje `importObject.dbg.brk(stmtId)`: `stepMode='step'` → pauzuje na każdym brk(); `stepMode='continue'` → pauzuje tylko na breakpointach; blokuje przez `Atomics.wait(ctrl, STATE_PAUSE)`; `STATE_STEP`/`STATE_CONTINUE` określa następny tryb
- SharedArrayBuffer (8+1024 bajtów): `[0..3]` Int32 state, `[4..7]` Int32 len, `[8..1031]` dane wejściowe
- 7 stanów: IDLE(0), INPUT(1), INPUTOK(2), PAUSE(3), STEP(4), CONTINUE(5), ABORT(-1)
- Wymaga nagłówków COOP/COEP (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) — serwer `start.js` je ustawia
- `wasmMemory` ustawiany po instantiacji przez `instance.exports.memory`

## 12. Testy regresji

`tests/test.js` — orkiestrator (Node.js ES module): importuje 5 podplików testowych + wywołuje `summarize()`:

- **Lexer** (`test-lexer.js`): typy tokenów, start/end offsety, LexError z pozycją
- **Parser** (`test-parser.js`): VarDecl, FuncDecl top-level i lokalne, wyrażenia, start/end na węzłach
- **TypeChecker** (`test-typechecker.js`): inferencja typów, lokalne funkcje, const/mut walidacja, zakaz shadowingu
- **CodeGen** (`test-codegen.js`): magic/version bytes, tablic, ByteSpan, debugger, short-circuit
- **Macros** (`test-macros.js`): lexer/parser/TC/codegen makra, BracketAccess, QualifiedName
- **Recovery** (`test-parser-recovery.js`): ErrorNode top-level + stmt-level, compile()/liveCompile() API
- **Namespace** (`test-namespace.js`): NamespaceDecl, NamespacedDecl, alias, namespace-func codegen
- `compileAndGenerate(src)` → `generate(ast)` — helper testowy z `tests/helpers.js`

---

## 13. Bytecode View

→ Patrz [ide.md](ide.md) sekcja 9 — dokumentacja renderowania bytecode, ByteSpan per-expression, i podświetlania.

---

## 14. Debugger (natywny WASM, throw-to-pause)

### Architektura
Debugger uruchamia WASM natywnie w przeglądarce. Instrumentacja odbywa się na etapie
kodegenu: `generate(ast, { debug: true })` wstrzykuje `(call $__dbg (i32.const stmtId))`
przed każdym statementem. Import `$__dbg` (moduł `dbg`, pole `brk`) liczy wywołania
i rzuca `DbgPause` gdy osiągnie target count — przerywając wykonywanie WASM.

**Wymaganie:** Użytkownik musi kliknąć Compile przed Debug — przycisk Debug jest `disabled`
dopóki `_compiled` flag w `main.js` nie jest `true`. `initDebugger(generate, log)` — bez parametru `compile` (niepotrzebny po usunięciu fallback compile path).

### API codegen
- `buildWAT(ast, { debug: true })` → `{ module, sSpans, stmtMap: Map<number, ASTNode> }`
- `generate(ast, { debug: true })` → `{ bytes, byteSpans, watText, watSpans, module, sSpans, stmtMap }`

### Przepływ debugowania
1. **Start:** Kompilacja z `{ debug: true }`, instantiate WASM z importem `dbg.brk`
2. **Step:** Inkrement `targetCount`, reinstancjacja WASM, ponowne uruchomienie od początku
3. **Continue:** `targetCount = Infinity`, sprawdzanie breakpointów w `brk`
4. **Pauza:** `brk` rzuca `DbgPause(stmtId)` → catch → podświetlenie
5. **Muting:** Podczas replay output jest wyciszony (flaga `muteOutput`)

### Breakpointy
- Kliknięcie w numer linii toggle’uje breakpoint (czerwona kropka)
- `debugSession.breakpoints: Set<number>` — zbiór numerów linii
- W `brk`: jeśli `astNode.line` jest w `breakpoints`, rzuca `DbgPause`

### Panel Debugger (UI)
- Toolbar: ⏭ Step | ▶ Continue | ⏹ Stop
- Sekcja "Current Statement" — wyświetla fragment źródła
- Podświetlenie bieżącego `astNode` we wszystkich widokach (identity-based)

---

## 14. Resilient Parser (ErrorNode + recovery)

### Strategia

Parser nigdy nie rzuca `ParseError` na zewnątrz — zawsze zwraca pełne `Program` z ewentualnymi `ErrorNode` w AST.  
Strategia: **try-catch + skan do sync pointu** (prostsze niż true BFS pre-scan, identyczny efekt widoczny dla użytkownika).

### ErrorNode

```js
{ kind: 'ErrorNode', error: ParseError, start, end }
```

- `start`/`end` = byte offsets z `ParseError` (pozycja błędnego tokenu)
- Downstream passy (TC, expander, codegen) **pomijają** `ErrorNode`

### Program node

```js
{ kind: 'Program', body: [...], errors: ParseError[] }
```

- `errors` = tablica wszystkich `ParseError` zebranych podczas recovery
- `body` może zawierać `ErrorNode` — jeden per zepsuta deklaracja lub instrukcja

### Sync pointy

| Poziom | `scanTo...()` | Warunek zatrzymania |
|--------|--------------|---------------------|
| Top-level (`parseProgram`) | `scanToTopLevelSyncPoint()` | `IDENT ':='` lub `IDENT ':'` przy `braceDepth==0`, lub EOF |
| Statement (`parseBlock`) | `scanToStatementSyncPoint()` | `';'` (konsumowany) lub `'}'` przy `depth==0` (niekonsumowany), lub EOF |

### Pipeline z recovery

```js
compile(src) → { tokens, ast, expLog, parseErrors }
// gdy parseErrors.length > 0: expand + typecheck pominięte (partial AST)

liveCompile(src, opts = {}) → { tokens, ast, expLog, parseErrors, typeErrors }
// zawsze tokenize → parse → expand → liveTypecheck (niezależnie od parseErrors)
// liveTypecheck() zbiera WSZYSTKIE błędy typów (per deklaracja, nie tylko pierwszy)
// wyniki w ast.typeErrors i w zwracanym typeErrors[]
// TypeErrorNode w AST Explorer: po głównej strukturze drzewa, z pozycją start/end
// opts.phases = ['tokenize','parse','expand','typecheck'] — domyślnie wszystkie
// furtka architektoniczna: opts.phases pozwala pominąć fazy (two-pass typecheck, typeof w #if)
```

### MacroExpansionNode

Po rozwinięciu `MacroCallStmt`, expander wstawia w blok jeden węzeł `MacroExpansionNode` (zamiast płaskiego splajsu):

```js
{
  kind:           'MacroExpansionNode',
  macroName:      'for_each',           // nazwa makra
  expandedSource: 'i32.const 0 ...',    // skrócony token-text rozwinięcia
  body:           Stmt[],               // rozwinięte instrukcje (może zawierać zagnieżdżone MacroExpansionNode)
  line, start, end,                     // call-site (z oryginalnego MacroCallStmt)
}
```

- `body` jest **inline** w scope rodzica (brak nowego scope) — zmienne ident-param (`lo_val`, `hi_val`) widoczne po makrze
- Downstream passy iterują `body` jak `ScopeBlock`: TC (`checkStmt`), codegen (`emitStmt`), `collectLocalDecls`
- `ast-renderer.js`: renderuje jako otwarty węzeł z etykietą `name!(…)` i dziećmi z `body`

### TypeErrorNode w AST

- `liveTypecheck()` zapisuje zebrane błędy typów jako `ast.typeErrors: TypeError[]`
- `ast-renderer.js` wstawia `TypeErrorNode` **bezpośrednio po** deklaracji, do której błąd należy (na podstawie `errorBelongsTo(e, decl)`: `e.node.start >= decl.start && <= decl.end`); sieroty lądują na dole
- Kliknięcie na `TypeErrorNode` podświetla odpowiedni fragment kodu w edytorze
- `TypeError.node` — referencja do źródłowego węzła AST (do celów debugowych)

### TypeError — zbieranie wielu błędów

- `TypeChecker.errors = array | null` — gdy ustawione, `checkBlock` łapie błędy per-instrukcja (resilient mode)
- `liveTypecheck()` ustawia `tc.errors = ast.typeErrors` → wiele błędów na raz (różne funkcje + różne instrukcje)
- `compile()` używa zwykłego `typecheck()` (rzuca przy pierwszym błędzie — pożądane dla przycisku Compile)

### Live IDE (debounce)

`triggerLiveCompile(src)` w `ide/main.js` — debounce 150ms po `editor.input`.  
Wywoływana też od razu przy starcie IDE (po załadowaniu domyślnego snippetu).  
Odświeża AST Explorer i hover data **bez** czyszczenia WAT/WASM stanu.  
Podświetla w edytorze **wszystkie** błędy (parse + type) jednocześnie przez `setLastErrorRanges(allSpans)`.  
W `lsp.js` stan to `lastErrorRanges: {start,end}[]` + `lastErrorRange` (jednopolożeniowy, compatibility).

### Downstream guards

- `staticTypeChecker.js`: `checkDecl()` i first-pass loop — `if (decl.kind === 'ErrorNode') continue/return`
- `checkStmt()` — `if (stmt.kind === 'ErrorNode') return` (skip) + `MacroExpansionNode` case (inline body)
- `macro-expander.js`: `expandDeclList()` — `else { result.push(d); }` (already safe)
- `expandStmt()` — switch-case fall-through do `return stmt` dla nieznanych kind (safe)
- `ast-renderer.js`: `ErrorNode` i `TypeErrorNode` w `LEAF_KINDS`; `MacroExpansionNode` nie-leaf z `body` dziećmi

---

## 15. Planowane rozszerzenia

- Lexical scope dla bloków `if`/`while` ✓
- Kolorowanie składni (token-based) ✓
- Obsługa Tab (wcięcia) w edytorze ✓
- Autocomplete ze scope AST + type hints ✓
- Type hints przy hover (offset-based) ✓
- Autocomplete: type-aware member suggestions (ptr→`*`, array→`size`/`.[`, struct→fields) ✓
- Autocomplete: `::` completion dla namespace members ✓
- Autocomplete: chained dot-completion (np. `obj.pos.x` rozwiązuje kolejne typy) ✓
- Autocomplete: `.[` completion dla array ✓
- Hover: namespace declarations, namespaced declarations, QualifiedName ✓
- Auto-indent na Enter (wyrównanie + extra indent po `{`) ✓
- Lokalne funkcje (lambda-lifting) ✓
- Error highlighting z pozycją w edytorze ✓
- Zwijalne panele ✓
- WAT Explorer z dwukierunkowym podświetleniem ✓
- Bytecode View z czterokierunkowym podświetleniem (granularność: per-expression) ✓
- Zmiana składni fn: `fn(params) RetType` ✓
- WatIR S-expr jako warstwa pośrednia (codegen ← wat-encoder) ✓
- System const/mut (domyślnie const, `mut` opt-in, zakaz shadowingu) ✓
- Template-like type syntax: `ptr<T>`, `array<T, N>` ✓
- Shadow stack dla tablic w funkcjach rekurencyjnych ✓
- Assign-by-copy dla tablic (element-by-element copy) ✓
- `generate()` jako jedyny punkt wejścia IDE (WAT + WASM + spany w jednym wywołaniu) ✓
- Granularne ByteSpan per-expression (przygotowanie pod debugger) ✓
- `as<T>` jako konwerter skalarny (int, float, bool) i array decay `array<T,N>→ptr<T>` ✓
- Short-circuit evaluation `&&`/`||` ✓
- Dokumentacja IDE wydzielona do ide.md ✓
- Debugger: natywne WASM z throw-to-pause, step/continue/breakpoint ✓
- Czterokierunkowe podświetlenie: identity-based dla AST/WAT/Bytecode ✓
- Source overlay highlight (zamiast natywnego setSelectionRange) ✓
- Pointer dereference assignment: `p.* = val` ✓
- Autocomplete: type-aware member suggestions (ptr→`*`, array→`size`) ✓
- Autocomplete: namespace `::` completion, chained dot-completion, `.[` for arrays ✓
- `void` jako jawny typ zwracany ✓
- `arr.[i]` jako jedyna składnia dostępu tablicowego (usunięto `arr[i]`/IndexExpr) ✓
- `pack` param kind + `[...]` literal + `#expand val in @vals { }` ✓
- Typy strukturalne (struct)
- Top-level var decls jako globale WASM
