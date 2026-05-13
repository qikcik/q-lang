# QLang IDE — Dokumentacja edytora i interfejsu

> Stan na: 2026-05-13 (aktualizacja: multi-file project support — VFS, file-tree, tab bar; "Open project" dropdown z user projects + examples; pane Files → Project z rename/delete; example projects session-only, nie persystowane)
> Wydzielone z archDetail.md i langDetail.md.

---

## 1. Architektura UI (`index.html` + moduły JS)

> Wzorzec tworzenia nowych komponentów UI: → [wayOfWork.md](wayOfWork.md) § 11

- `index.html` — cały layout w jednym pliku, zero frameworków
- `main.js` — ES module entry point, klej IDE ↔ kompilator; `<script type="module">`
- `ide/vfs.js` — **Virtual File System** — `Project` (pliki jako Map) + `VFS` (wiele projektów); persystencja przez `localStorage` (`qlang-vfs-v1`); eksportuje singleton `vfs`; `isExample: true` → projekt sesyjny, nie zapisywany przy `save()`; `#lastUserActiveId` — przy `save()` gdy aktywny projekt to example, jako `activeId` w storage zapisywany jest ostatni nie-example
- `ide/file-tree.js` — `<qlang-file-tree>` Web Component (Light DOM); API: `setFiles(paths, activePath, projectName)`, `set activePath`; header z edytowalnym `<input>` (rename projektu), przyciskiem 🗑 (delete projektu) i `+` (new file); zdarzenia bubbling: `ft-file-select`, `ft-file-create`, `ft-file-delete`, `ft-file-rename`, `ft-project-rename`, `ft-project-delete`
- `ide/project-ui.js` — `initProjectUI(deps)` → `activateProject(proj)`; obsługuje wszystkie zdarzenia file-tree; renderuje tab bar; `ft-project-rename` → `proj.name = ...`; `ft-project-delete` → `confirm()` + `vfs.deleteProject()` + przełącz na następny projekt; `btn-new-project` → `prompt('Project name:')` → `vfs.createProject(name)`
- `ide/examples.js` — `initExamples(onLoad, { getProjects, onProjectOpen })` — dropdown "Open project"; lista przebudowywana przy każdym otwarciu; sekcja "My projects" (bez example projektów) + separator + sekcja "Examples" (kursywa, muted); `onLoad({ name, texts: Map })` wywoływane po załadowaniu plików przykładu; `onProjectOpen(proj)` — otwiera istniejący projekt VFS
- `views.js` — renderery widoków: `syntaxHighlight`, `renderWAT`, `renderBytecode`, `classifyWasmBytes`, `findWatSpan`, `findByteSpan`
- `ide/source-view.js` — `<qlang-source-view>` Web Component (Light DOM, zero Shadow DOM); dwa tryby: `editable` i read-only; API: `setText`, `setContent`, `getText`, `scrollToOffset`, `set hoverData`, `setBpLines`, `highlightNode`, `highlightRange`, `addHighlightRange`, `setHighlights`, `clearHighlight`; CSS klasy rektów: `sv-hl-rect` (niebieski), `sv-hl-dimmed` (żółty), `sv-hl-active` (pomarańczowo-czerwony kontur); Events: `sv-gutter-click { line }`, `sv-node-click { node }`; `_storedHighlights` + scroll listener + `ResizeObserver` (redraw przy scrollu/resize); **diagnostyczne `console.warn`** przy 4 silent exit points w `_appendRect`
- `ide/highlight.js` — **Koordynator podświetleń** (jeden moduł zna DOM wszystkich widoków); eksportuje `initHighlight`, `highlightAndScrollSource`, `addSourceHighlight`, `clearAllSourceHighlights`, `applyChainHighlights`, `highlightAst`, `highlightAstWithStmt`, `highlightWat`, `highlightBytecode`, `clearAll`, `setOnMissingView`; `highlightAndScrollSource` wywołuje `_onMissingView(sourceId)` gdy `getView()` zwraca null — macro-panel.js rejestruje callback auto-otwierający panel; wszystkie inne moduły IDE delegują do niego zamiast bezpośrednio manipulować DOM; **diagnostyczne `console.warn`** przy każdym null-guard (`_outAst`/`_watRoot`/`_outBytecode` nie zainicjalizowane)
- `ide/ide-state.js` — pasywny store dla `expLog`; `setExpLog`/`getExpLog`; zero zależności (żadnych importów z innych plików IDE), eliminuje 3 rozproszone kopie `lastExpLog`
- `ide/layout.js` — wydzielony z inline `<script>` w `index.html`; obsługuje resize handlerów (col-handle, row-handle), drag & drop paneli, zwijanie/rozwijanie `.sub-pane`
- `ide/qlang-pane.js` — `<qlang-pane>` Web Component (Light DOM); wrapper strukturalny dla paneli IDE; adopts pre-existing children
- `ide/qlang-toolbar.js` — `<qlang-toolbar>` Web Component (Light DOM, 33 linii); wrapper na przyciski nagłówka; interceptuje click na `button[data-action]` → dispatches semantic events: `ql-compile`, `ql-run`, `ql-debug`, `ql-clear` (bubbling); HTML: `<qlang-toolbar><button data-action="compile">Compile</button>...</qlang-toolbar>`
- `ide/qlang-error-panel.js` — `<qlang-error-panel>` Web Component (Light DOM, 73 linii); API: `setErrors(errors[])`, `log(msg)`, `clear()`; renderuje `.err-line` span z `data-start`/`data-end`/`data-line`/`data-canonical-ref`; dispatches `ql-error-click { canonicalRef, start, end, line }` (bubbling); adopts existing `<pre>` child; `main.js` nasłuchuje `ql-error-click` zamiast bezpośredniego click na `<pre>`
- `ide/qlang-console.js` — `<qlang-console>` Web Component (Light DOM); API: `write(text)` (dopisuje TextNode — biały, output z WASM), `log(msg)` (dopisuje `<span>` w kolorze `var(--accent)` — niebieski, wiadomości IDE), `clear()`, `startInput(cb)` (aktywuje pole stdin, cb wywoływany z Enter/przycisk ▶), `cancelInput()` (wyłącza stdin); stdin echo w kolorze `var(--muted)` (szary); adopts existing `<pre>` child
- `ide/source-registry.js` — globalny rejestr obiektów `SourceBuffer` i widoków `qlang-source-view`; `registerSource`, `registerView`, `unregisterSource`, `getSource`, `getView`, `getAllSourceIds`, `highlightInSource`, `clearSourceViewHighlight`; null guard na `registerSource`
- `ide/crossSelection.js` — cienki bridge (∼25 linii re-export shim); deleguje podświetlenia do `highlight.js`; zachowuje `setStmtMap`, `enclosingStmt`, `highlightSourceRange`; handlery kliknięć AST/WAT/Bytecode w pełni w `highlight.js`
- `ide/macro-panel.js` — manager paneli rozwinięć makr obok siebie; **podłączony w `main.js`**: `initMacroPanels(panelsRow, lensLayer, editor)`; eksportuje `initMacroPanels`, `updateMacroLenses`, `openExpansion`, `closeAllPanels`, `refreshAllPanelBps`, `findInfoBySourceId`; przyciski `+` (lens) na liniach wywołań w main i w panelach (inner +lens via `_addInnerLenses`); `updateMacroLenses` zamyka WSZYSTKIE panele przy recompile (user reopens via +lens); panel text pochodzi z `info.source.text` (pre-expansion bodySource — MacroCallStmt shown as call-site text); hover data z `info.preExpBody` (pre-expansion AST snapshot); `sv-node-click` → `clearAll()` + highlight + chain walk; `initMacroPanels` rejestruje `setOnMissingView` callback auto-otwierający panel macro; `#macro-panels-row` — kontener HTML poniżej edytora (`display:flex; gap:4px; overflow-x:auto; max-height:280px`)
- `ide/navigate.js` — nawigacja po canonical ref (∼70 linii); `navigateToRef(refStr, expLog)` parsuje ref (pełne sourceId w segmencie), otwiera panele via `openExpansion`, deleguje do `applyChainHighlights`; `navNext`/`navPrev`/`clearNav`
- `ide/nav-bar.js` — pływający pasek `#nav-bar` (pill) z przyciskami ◁ ▷ × do nawigacji po segmentach łańcucha
- `compiler/source-ref.js` — `buildCanonicalRef(node, s?, e?) → string`, `parseCanonicalRef(str) → Segment[]`, `segmentLabel(sourceId) → string`
- `compiler/source-buffer.js` — `SourceBuffer { id, text, tokens, kind, callSite }` z fabrykami `forMain()`, `forMacro()`; gettery `root`, `parent`, `depth`
- `lsp.js` — narzędzia edytora: `updateAc`, `syncAstHighlight`, `buildLineIndex`, `getLastLineIndex`, `getScopeItems`, `getNamespaceMembers`, `resolveChainedType`; obsługuje autocomplete (3 tryby: general, dot, ::), type-aware member suggestions
- `ide/hover.js` — hover data builder: `HINTS` (statyczne definicje), `buildHoverData` (AST walker → `HoverEntry[]`); obsługuje Identifier, VarDecl, FuncDecl, Param, StructDecl, StructField, MemberExpr, UnaryExpr, NamespaceDecl, NamespacedDecl, QualifiedName, MacroCallStmt
- **Nagłówek**: przyciski Compile | ▶ Run | ⬤ Debug | ⏹ Stop | Clear w `<qlang-toolbar>`; **+ New project** (tworzy nowy projekt przez `prompt`); **Open project ▾** (dropdown z sekcją "My projects" + "Examples")
- **Trzy kolumny**: Edytor | AST + Bytecode + Debugger (stacked) | WAT Explorer + Konsola + Błędy (stacked)
- Layout: `body { height: 100dvh; overflow: hidden }` — brak zewnętrznego scrolla
- Kolumny i widoki są rozciągane uchwytem (drag handle); widoki można przenosić między kolumnami i zmieniać ich kolejność (drag & drop)
- **Nagłówek**: `<qlang-toolbar>` owijający przyciski: Compile | ▶ Run | ⬤ Debug | ⏹ Stop | Clear; klik na przycisk z `data-action` dispatches `ql-*` event (bubbling); **Run, Debug i Compile są wyłączone** (`disabled`) podczas działania programu; **Run i Debug wyłączone** dopóki użytkownik nie kliknie Compile — `_compiled` flag w `main.js`, reset przy edycji/clear/błędach parse; **Stop wyłączony** gdy brak działającego programu; wszystkie przyciski mają style `:disabled` (szary, 50% opacity, `cursor: not-allowed`)

---

## 2. Edytor kodu

- `contenteditable` `<pre>` z dynamicznym `innerHTML` — brak nakładki textarea
- `syntaxHighlight(src, errorRanges?)` — **token-based**: wywołuje `tokenize(src)`, mapuje `token.type` → klasa CSS, komentarze w przerwach między tokenami przez `emitGap()`
- `applyHighlight(errorRanges?)` — nadpisuje `innerHTML` i przywraca pozycję kursora (`setCaretOffset`)
- Tab key: wstawia 4 spacje lub indentuje zaznaczenie; `Shift+Tab` dedentuje; oba wywołania przekazują `lastErrorRange`
- `getCaretOffset()` / `setCaretOffset()` — obliczają offset przez `Range.toString().length`

### Kolorowanie składni

Edytor automatycznie koloruje składnię podczas pisania (bazuje na tokenach, nie na regex):

| Element | Kolor |
|---|---|
| Słowa kluczowe (`if`, `while`, `return`...) | fioletowy |
| `macro` | fioletowy (keyword) |
| Typy (`i32`, `bool`, ...) | jasnoniebieski (sky) |
| Liczby i literały bool | pomarańczowy |
| Łańcuchy znakowe | zielony |
| Komentarze | szary, kursywa |
| Operatory | niebieski |
| Identyfikatory | biały |
| `@param`, `$name`, `#param` (tokeny makra) | dedykowane klasy CSS (identyfikatory) |
| Błędny fragment | czerwona falista linia (`hl-error`) |

### Wcięcia (Tab)

- `Tab` na pustym kursorze: wstawia 4 spacje
- `Tab` z zaznaczonym tekstem: indentuje każdą zaznaczoną linię o 4 spacje
- `Shift+Tab`: usuwa do 4 spacji z początku każdej zaznaczonej linii

### Auto-indent (Enter)

- `Enter` automatycznie wyrównuje wcięcie do poziomu poprzedniej linii
- Jeśli linia kończy się na `{`, dodaje dodatkowe 4 spacje wcięcia
- Implementacja w `main.js`: przechwycenie `keydown` Enter → `execCommand('insertText', '\n' + indent)`

---

## 3. Podświetlanie błędów

- Wavy underlines (**faliste podkreślenia**) zostały usunięte z UX — zamiast tego używany jest canonical-ref highlight (pomarańczowy kontur `sv-hl-active`)
- `showError(e)` w `main.js`: gdy błąd ma `canonicalRef`, wywołuje `navigateToRef(e.canonicalRef, getExpLog())`, które otwiera odpowiednie panele i podświetla cały łańcuch źródeł
- Bez `canonicalRef`: `highlightAndScrollSource('main', s, e)` (jedno podświetlenie w głównym edytorze)
- **Panel Errorów** (`<qlang-error-panel id="error-panel">`): owijuje `<pre id="out-errors">`; `setErrors(errors[])` renderuje klikalne `.err-line` spany z `data-canonical-ref`/`data-start`/`data-end`/`data-line`; dispatches `ql-error-click` event z `detail: {canonicalRef, start, end, line}`; `main.js` nasłuchuje `ql-error-click` → `handleErrorClick(detail)` → `navigateToRef` / `highlightSourceRange`; fallback: bezpośredni click listener na `outErrors` jeśli komponent nie jest dostępny
- `renderErrorList(container, errors)` — legacy fallback; buduje klikalne spany z `e.message`; zapisuje `data-start`, `data-line`, `data-canonical-ref`
- Livecompile: brak wywołania `applyHighlight(spans)` — `applyHighlight()` bez argumentów (czyste `setText` bez error ranges)

### Canonical Source Ref format

```
[Type] main[8:10-8:20]/macro:for_each:main:42[3:4-3:14] — message
```

- Każdy segment: `sourceId[startLine:startCol-endLine:endCol]` — **pełne sourceId** (np. `macro:for_each:main:42`, nie skrócone)
- `buildCanonicalRef(node, s, e)` — chodzi po `node.__src.callSite.source` w górę, zbiera segmenty; `formatSegment` używa pełnego `src.id`
- `parseCanonicalRef(str)` — zwraca `Segment[]` z `{ sourceId, label, startLine, startCol, endLine, endCol }`; `sourceId` = pełne ID, `label` = `segmentLabel(sourceId)` (display-only)
- `segmentLabel(fullId)` — skraca `'macro:for_each:main:42'` → `'macro:for_each'` (wyłącznie do wyświetlania: nav-bar, debugger crumbs)
- `findInfoBySourceId` w `macro-panel.js` — exact match na pełne sourceId (fallback: prefix match dla backward compat)

### TypeErrorNode w AST Explorer

- `ast-renderer.js` wstawia `TypeErrorNode` bezpośrednio po deklaracji, która jest właścicielem błędu
- Dopasowanie przez `errorBelongsTo(e, decl)`: `e.node.start >= decl.start && e.node.end <= decl.end`
- `.ast-TypeErrorNode > summary { color: var(--red) }` — czerwona etykieta w drzewie AST

---

## 6. Zaznaczanie wielowidokowe (crossSelection.js + highlight.js)

### Koordynator podświetleń (highlight.js)
- `initHighlight({ outAst, watRoot, outBytecode })` — wywoływane raz przy starcie z `main.js`
- `highlightAndScrollSource(sourceId, start, end, cls?)` — `view.scrollToOffset(start)` + rAF `view.addHighlightRange(...)`; highlight znika po scrollowaniu (akceptowalne)
- `applyChainHighlights(segments, activeIdx)` — czyści wszystkie widoki, nakłada `sv-hl-dimmed` na wszystkie segmenty poza aktywnym, `sv-hl-active` + scroll na aktywny segment
- `clearAll()` — czyści podświetlenia we wszystkich widokach (source + AST + WAT + bytecode)

### crossSelection.js (thin re-export shim)
- ~25 linii; czyste re-eksporty z `highlight.js` + backward-compat `highlightSourceRange` wrapper
- Eksportuje `setStmtMap`, `enclosingStmt`, `highlightSourceRange` (używane przez `main.js`)
- Handlery kliknięć AST/WAT/Bytecode — w pełni w `highlight.js`, nie w crossSelection
- Brak bezpośredniej manipulacji DOM; brak własnych listenerów

### Granulacja w widokach
| Widok | Granulacja highlight |
|---|---|
| Source | dokładny zakres węzła klikniętego |
| AST | kliknięty węzeł (`.ast-highlight`, niebieski) + równoległy stmt (`.ast-stmt-highlight`, bursztynowy) |
| WAT Explorer | wszystkie `.wat-line` z `_astNode === stmtNode` (identity-based, statement-level, multi-line) |
| Bytecode | wszystkie `.bc-byte` z `_astNode === stmtNode` (identity-based, statement-level) |
| Macro panel | `SourceView.highlightNode(astNode)` via `macro-view-ref.js` → rect overlay w wirtualnym pliku |

### Breakpointy (Map<sourceId, Set<line>>)
- `sourceBps` — `Map<sourceId, Set<line>>` — jeden map dla WSZYSTKICH źródeł ('main' + 'macro:...')
- `addBp(sourceId, line)` / `removeBp(sourceId, line)` / `hasBp(sourceId, line)` / `getBpLines(sourceId)`
- Klik w gutterze: `sv-gutter-click { line }` event → `addBp('main', line)` lub `removeBp`; po zmianie: `mainSv.setBpLines(getBpLines('main'))`
- `clearAllBps()` wywołuje `sourceBps.clear()` + `mainSv.setBpLines(new Set())`
- `triggerLiveCompile` wywołuje `clearAllBps()` przy **każdej** zmianie kodu
- W debug-session: `resolvedBreakpoints` = `Set<stmtId>` — mapowane z `sourceBps` przez `node.__src.id` + `offsetToLine`; `debugRun` sprawdza `ds.breakpoints.has(stmtId)` (numeryczny check)

---

## 4. Autocomplete

- Popup `#ac-popup`: `position: fixed`, pozycjonowany przez `range.getBoundingClientRect()`
- Auto-wyzwalany przy wpisywaniu identyfikatora (≥1 znak) lub po `.` / `::`
- Odświeżany po każdym `liveCompile` (`requestAnimationFrame(updateAc)` po zakończeniu kompilacji) — gwarantuje aktualny AST
- `getScopeItems(offset)` — przechodzi `lastAst`, zbiera widoczne nazwy: hoisted FuncDecl, VarDecl przed kursorem, params bieżącej funkcji, lokalne deklaracje w bloku, struct declarations, namespace prefixes, macro declarations
- Items: `Map<name, { typeStr, rawType, itemKind }>` — popup pokazuje typ obok nazwy (`.ac-type { opacity: 0.6 }`)
- `itemKind`: `'func'`, `'var'`, `'param'`, `'struct'`, `'namespace'`, `'macro'`
- Fallback: regex `getSourceIdents` gdy `!lastAst`
- Nawigacja: strzałki Up/Down, akceptacja: Tab/Enter, zamknięcie: Escape
- `AC_STATIC` — statyczne słowa kluczowe: `fn`, `let`, `mut`, `if`, `else`, `while`, `return`, `true`, `false`, `struct`, `namespace`, `defer`, `void`, `macro`

### Trzy tryby completion

#### 1. Namespace `::` completion
Po wpisaniu `Nazwa::` autocomplete pobiera członków namespace'u przez `getNamespaceMembers(nsName)`:
- `NamespacedDecl` (funkcje, zmienne deklarowane w namespace)
- Konstruktory struct: `T::of(...)`, `T::default()`
- Konstruktory skalarne: `i32::of(...)` itp.
- Aliasy: jeśli namespace jest aliasem, rozwiązuje do celu

#### 2. Dot-completion (po `.`)
Po wpisaniu `.` autocomplete sprawdza typ wyrażenia przed kropką przez `resolveChainedType(src, dotPos, scopeItems)`:
- `struct` → sugeruje pola struktury (z typami)
- `ptr<...>` → sugeruje `*` (dereferencja wskaźnika)
- `array<...>` → sugeruje `.[` (dostęp do elementu) i `size` (rozmiar tablicy)
- Nieznany/skalarny typ → brak sugestii (nie zgaduje)

#### 3. General completion
Dla zwykłego pisania identyfikatora: filtrowane dopasowanie z `AC_STATIC` + items z `getScopeItems(offset)`.

### Chained dot-completion (`resolveChainedType`)
`resolveChainedType(src, dotPos, scopeItems)` — skanuje wstecz od pozycji kropki, zbiera łańcuch `ident.ident.ident`, rozwiązuje typ na każdym etapie:
1. Pierwsza nazwa → lookup w `scopeItems` → `rawType`
2. Każda kolejna nazwa → `structFieldType(currentType, fieldName)` z `staticAnalysis.js`
3. Zwraca finalny typ lub `null`

Przykład: `obj.pos.x` → `obj: MyStruct` → `pos: Vec2` → `x: i32` → sugestie dla `i32` (brak)

---

## 5. Podpowiedzi typów (hover)

- Statyczne hover hinty dla keywordów i wbudowanych typów oraz słów kluczowych makr (`macro`, `expr`, `ident`, `block`, `type`, `any`, `$`, `@`, `#`, `T::of`, `T::default`, `namespace`) zdefiniowane są w stałej `HINTS` w `ide/hover.js`
- `buildHoverData(tokens, ast, expansionLog?, posOf?)` zwraca tablicę `HoverEntry`:
  - `{start, end, label, detail, _astNode?}`
  - `_astNode` ustawiony na wpisach z węzłów AST (Identifier, VarDecl, FuncDecl itd.) — używany przez `SourceView._handleClick` do identyfikacji klikniętego węzła
  - `posOf` — opcjonalna funkcja `n => {start, end}` mapująca węzły na współrzędne w wirtualnym pliku; domyślnie `n.start/n.end`; dla panelu makra: `n => ({start: n.src_start ?? n.start, end: n.src_end ?? n.end})`
  - `label` to nazwa lub operator wyświetlany w tooltipcik
  - `detail` to typ lub krótki opis funkcji / zachowania
- AST-based entries: `Identifier`, `VarDecl`, `FuncDecl`, `Param`, `StructDecl`, `StructField`, `MemberExpr`, `UnaryExpr` (`.*`), `NamespaceDecl`, `NamespacedDecl`, `QualifiedName`
- **Type annotation hover**: Param, VarDecl i StructField z adnotacją typu structural (np. `p: Point`) generują dodatkowy wpis hover na pozycji adnotacji; `staticTypeChecker.js` zachowuje `_typeAnnotStart`/`_typeAnnotEnd` z oryginalnego `UserTypeRef` zanim nadpisze `typeAnnot` rozwiązanym typem; `hover.js` emituje wpis z `label: typeStr(ty)` + `detail` pokazujący pola struct (dla StructType) lub sam typ
- **Namespace/Struct hover entries**:
  - `NamespaceDecl` — wyświetla `"namespace declaration"` lub `"alias for X::Y"` dla aliasów
  - `NamespacedDecl` — wyświetla pełną kwalifikowaną nazwę (`Ns::name`) + typ (np. `(i32, i32) → Vec2`)
  - `QualifiedName` z `_type` — wyświetla rozwiązany typ (np. `Vec2`)
  - `StructDecl` — wyświetla pola struktury i rozmiar w bajtach (np. `{ x: i32, y: i32 } (8 bytes)`)
  - `StructField` — wyświetla typ pola
  - `MemberExpr` z `.size` — wyświetla `u32 = N` (rozmiar tablicy)
- **Macro hover**: jeśli `expansionLog` przekazane, dla każdego `MacroCallStmt` dodawane jest wejście:
  - `label`: `'name!(…)'`
  - `detail`: sygnatura `macro(arr: expr, elem: ident, body: block)` (z `macroSig` w expansion log)
  - Pola expansion log: `{ name, end, callLine, macroSig, bodySource, source, expandedBody, args }`
- `bodySource` — wynik `stmtsToSourceMapped(substitutedStmts)` z `ast-to-source.js` — tekst wirtualnego pliku; pokazuje ciało makra z podstawionymi argumentami, zagnieżdżone wywołania makr jako składnia `name!(args)` (nie rozwinięte inline)
- Mousemove: `document.caretRangeFromPoint` → offset znakowy → wyszukanie trafienia w `lastHoverData`
- `lastHoverData` — offset-based, nie line:col

Przykłady:

```
x: i32
add: (i32, i32) → i32
arr: array<u8, 5>
as<T>(expr): creates a temporary value with the given type
array<T, N>: native raw sequential array with constant size
p.*: dereference pointer to the underlying type
a[0]: element type of the array or pointer
a.size: u32 = 5
```

---

## 5b. Macro Lens (przyciski rozwijania makr) + `<qlang-source-view>`

### Architektura Virtual File

Każdy `MacroExpansionNode` produkuje w expansion log `source: SourceBuffer` — wirtualny plik (obiekt `SourceBuffer` z `id`, `text`, `tokens`, `kind`, `callSite`).

**Kolejność operacji w `expandMacroCallStmt`** (kluczowa dla poprawności łańcucha):
```
1. substituteStmts()               → substitutedStmts  (klon szablonu z wstawionymi arg)
2. stmtsToSourceMapped(substituted) → bodyText + nodeSpans  (wirtualny plik na tym poziomie)
3. SourceBuffer.forMacro(...)      → expSource  (callSite.source = ctx.source = parent)
4. stamp __src / __src_start / __src_end na substituted nodes
5. expandStmtList(substituted, innerCtx)  gdzie innerCtx.source = expSource
   → rekurencja z poprawnym rodzicem w łańcuchu
```

- `stmtsToSourceMapped(stmts)` → `{ text, nodeSpans: Map<ASTNode, {start,end}> }` — generuje tekst i mapę pozycji (klasa `Cursor`); `substitutedStmts` mogą zawierać `MacroCallStmt` — renderowane jako `name!(args);`
- Węzły w `substitutedStmts` dostają właściwości `__src`, `src_start`, `src_end` — offsety w `source.text` tego poziomu
- `MacroExpansionNode` tworzony dla każdego wywołania dostaje `src_start/src_end` z `MacroCallStmt` który zastąpił, żeby `hover.js` mógł go pozycjonować w panelu zewnętrznym
- `source.tokens = tokenize(bodyText)` — dla syntax highlight w komponencie
- Łańcuch: `inner_node.__src = inner_source` → `inner_source.callSite.source = outer_source` → `outer_source.callSite.source = null` (main)

### `<qlang-source-view>` Web Component (`ide/source-view.js`)
Jednolity komponent widoku źródła — używany w obu miejscach:

#### Tryb `editable` (główny edytor)
- Element HTML: `<qlang-source-view id="main-sv" editable>`
- `connectedCallback` tworzy: `.sv-gutter` (numerki linii + BP dots) + `.sv-body` zawierający `#editor` (contenteditable pre) + `.sv-overlay` (overlay, z-index: 2) + adoptowane dzieci (`#macro-lens-layer`)
- `#macro-panels-row` — **osobny kontener** poniżej `<qlang-source-view>` (nie wewnątrz), flex row dla paneli makr
- `mainSv.setText(src, errorRanges?)` — syntax highlight → `#editor.innerHTML` + sync gutter; caret save/restore w callerze (`applyHighlight` w `main.js`)
- `mainSv.hoverData = hd` — ustawia tablicę `HoverEntry` po kompilacji
- `mainSv.setBpLines(Set<number>)` — odświeża klasy `bp-active` w gutterze
- Hover: obsługiwany wewnętrznie (mousemove/mouseleave na `#editor`) — `lsp.js` nie rejestruje już własnych handlerów hover

#### Tryb read-only (panel makra)
- Tworzony dynamicznie: `document.createElement('qlang-source-view')`
- `panelBody.appendChild(sv)` → `connectedCallback` fires → `.sv-pre` + `.sv-overlay` + `.sv-gutter` gotowe
- `sv.setContent(text, hoverData)` — syntax highlight + sync
- `sv.highlightNode(astNode)` — uses `node.src_start ?? node.start` → rect overlay
- `sv.clearHighlight()`
- `sv.addEventListener('sv-node-click', e => { const clickedNode = e.detail.node; ... })`

#### Podświetlanie (shared, oba tryby)
- `highlightRange(start, end)` — `_nodeAtOffset` (TreeWalker) + `range.getClientRects()` → `.sv-hl-rect` divs w `_overlay`
- Geometry reference: `_pre.getBoundingClientRect()` (w editable: ≈ sv-body, bo `inset: 0`)
- `_storedHighlights: Array<{start, end, className}>` — persyste highlights; redraw przy scroll + resize
- `_redrawHighlights()` wywoływana przez scroll listener na `_pre` (oba tryby) + `ResizeObserver`
- **Diagnostyka**: `console.warn('[sv] ...')` przy każdym silent exit w `_appendRect`: brak `_pre`/`_overlay`, null `start`/`end`, `_nodeAtOffset` failure, `getClientRects()` empty

### Lens + Panel (`ide/macro-panel.js`) — podłączony w `main.js`
- `main.js` importuje `initMacroPanels`, `updateMacroLenses` (alias `updateMacroPanels`), `closeAllPanels`, `refreshAllPanelBps` z `macro-panel.js`
- Inicjalizacja: `initMacroPanels(panelsRow, macroLensLayer, editor)` — po DOM refs w `main.js`
- `#macro-lens-layer` — absolutna warstwa nad edytorem (w `.sv-body`); zawiera przyciski `+` przy wywołaniach makr
- `#macro-panels-row` — kontener flex poniżej `<qlang-source-view>`; panele side-by-side (`.macro-panel` z `.macro-panel-header` + `.macro-panel-body`); max-height: 280px, overflow-x: auto
- `updateMacroLenses(expLog)` — zamyka WSZYSTKIE panele (`closeAllPanels()`), potem dla każdego wpisu z `callSite.sourceId === 'main'` tworzy `.macro-lens-btn`
- `_positionLensButtons()` — przelicza pozycję `top` każdego przycisku; wywoływana przy scroll
- `openExpansion(info, expLog)` — buduje `hoverData` z `posOf = n => ({start: n.__src_start ?? n.start, end: n.__src_end ?? n.end})`, tworzy element `qlang-source-view`, montuje w panelu, `setContent(text, hoverData)`; po otwarciu wywołuje `_addInnerLenses()` dla zagnieżdżonych makr
- Inner +lens: `_addInnerLenses(lensLayer, sv, parentSourceId, expLog)` — skanuje expLog po wpisach z `callSite.sourceId === parentSourceId`, pozycjonuje przyciski `+` w ciele panelu; klik otwiera zagnieżdżony panel przez `openExpansion(innerInfo, expLog)`
- **Brak pills w nagłówku** — usunięte na rzecz jednolitego mechanizmu +lens (ten sam w main i panelach)
- Klik w panelu makra → `sv-node-click { node }` → `highlightAndScrollSource` na call-site w rodzicu (`info.source.callSite.sourceId`), nie zawsze w main
- `hover.js` walk() zatrzymuje rekurencję na granicy `MacroExpansionNode` (wewnętrzne węzły należą do innej przestrzeni koordynat — własnego panelu podrzędnego)

---


- `syncAstHighlight()` wywoływana przy `click` i `keyup`
- Pobiera `getCaretOffset()`, szuka **najciaśniejszego** elementu `[data-start]` spełniającego `s <= offset <= e`
- Fallback: `[data-line]` gdy brak offsetów
- `ast-renderer.js` emituje `data-start` / `data-end` na każdym węźle `<details>`

---

## 13. Multi-file projects (VFS)

### VFS (`ide/vfs.js`)

```
vfs.projects           — Map<id, Project> (getter publiczny, read-only)
vfs.activeProject      — aktualnie aktywny Project lub null
vfs.createProject(name, files?, { isExample? }) → Project
vfs.deleteProject(id)
vfs.renameProject(id, newName)
vfs.setActiveProject(id)
vfs.setFile / getFile / createFile / deleteFile / renameFile
vfs.save() / vfs.load()
```

- Klucz localStorage: `qlang-vfs-v1`
- Invarianty: `main.qlang` zawsze istnieje w projekcie i nie może być usunięte/zmienione
- `isExample: true` → projekt sesyjny: `save()` go pomija; po odświeżeniu strony znika
- `#lastUserActiveId` — gdy aktywny jest example-project, `save()` zapisuje ostatni user-project jako `activeId`

### Pane „Project" (`<qlang-file-tree>`)

Prawy górny panel (dawny „Files") — pokazuje pliki bieżącego projektu:

- Header: `<input>` z nazwą projektu (edytowalne inline → `ft-project-rename`), przycisk 🗑 (→ `ft-project-delete`) i `+` (→ `ft-file-create`)
- Lista plików: `main.qlang` zawsze pierwszy z badge `entry`; pozostałe z przyciskiem ✕; dblclick → inline rename
- `ft-file-select` → przełącza aktywny plik w edytorze
- `ft-project-delete` → `confirm()` + `vfs.deleteProject()` + przełącz na inny projekt; blokowany gdy jeden projekt

### Tab bar (`#tab-bar`)

Wyświetlany powyżej edytora; jeden tab per plik aktywnego projektu:
- `tab-entry` class na `main.qlang` (oznacznik `●`)
- Aktywny tab: `tab-active`, kursyw informacja „Editing X — only main.qlang is compiled" gdy edytowany nie-main

### Dropdown „Open project"

Przycisk **Open project ▾** w nagłówku — lista przebudowywana przy każdym otwarciu:
```
MY PROJECTS          ← bold uppercase header
  User project 1
  User project 2
 ─────────────────   ← 1px separator
EXAMPLES             ← bold uppercase header
  Fibonacci          ← italic, muted
  Hangman            ← italic, muted
  …
```
- Wybór projektu użytkownika → `onProjectOpen(proj)` → `vfs.setActiveProject` + `activateProject`
- Wybór przykładu → `fetch` wszystkich plików → `vfs.createProject(name, files, { isExample: true })` → `activateProject`

### Przycisk „+ New project"

Obok „Open project" w headerze → `prompt('Project name:')` → `vfs.createProject(name)` → `activateProject`

---

## 7. Zwijalne panele

- Klik na `.pane-label` → toggle `pane-body-hidden` na ciele i `pane-collapsed` na `.sub-pane`
- Strzałka `▾` w nagłówku obraca się o 90° gdy panel zwinięty

---

## 8. WAT Explorer

- `renderWAT(watText, spans, enclosingStmt)` — buduje interaktywne drzewo HTML
  - **Diagnostyka**: `console.warn('[wat] renderWAT: watSpans is empty')` gdy `spans` puste lub brak — WAT cross-highlight nie będzie działać
  - Linie z otwierającymi słowami kluczowymi (`(module`, `(func`, `(if`, `(loop`, `(block`, `(then`, `(else`) → `<details open>` (zwijalna sekcja)
  - Zamykające `)` zamykają bieżący `<details>`
  - Pozostałe linie → `<span class="wat-line">`
  - Każdy element dostaje `_astNode` property — przypisywany przez `renderWAT` przez `enclosingStmt(bestSpan.astNode)`; brak `data-wat-start/end` na elementach DOM
  - Podświetlanie identity-based identycznie jak bytecode: `el._astNode === stmtNode`
- `watHighlightLine(line)` — tokenizuje tekst WAT i opakowuje tokeny w `<span>` z klasą CSS:
  - `wk` — słowa kluczowe WAT (`module`, `func`, `if`, …)
  - `wt` — typy WASM (`i32`, `i64`, `f32`, `f64`)
  - `wi` — instrukcje (`local.get`, `i32.add`, `call`, …)
  - `wn` — liczby
  - `ws` — stringi
  - `wr` — referencje (`$funcName`, `$localName`)
  - `wc` — komentarze (`;; ...`)

---

## 9. Bytecode View

### Funkcja `renderBytecode(bytes, byteSpans)`
Buduje hex dump binarnego WASM w `#out-bytecode`:
- Każde 16 bajtów → jeden `.bc-row` z adresem (`bc-addr`) i hex bytes (`bc-hex`)
- Każdy bajt to osobny `.bc-byte` `<span>` z klasą CSS z `classifyWasmBytes()` (np. `bc-opcode`, `bc-operand`, `bc-type`)
- Każdy `.bc-byte` dostaje `_astNode` property — bezpośredni ref na ASTNode (najciaśniejszy `ByteSpan` pokrywający ten bajt)
- `findByteSpan(byteSpans, absIdx, absIdx+1)` — tightest span overlapping this byte

### Podświetlanie bytecode
- `highlightBytecodeForNode(astNode)` — **identity-based**: podświetla dokładnie te bajty, których `_astNode === astNode`
- `.bc-highlight { background: rgba(137,180,250,0.15); outline: 1px solid var(--accent); }`
- Klik na `.bc-byte` → `_astNode` → `highlightSourceRange` (overlay) + highlight AST + WAT (identity-based)

### Stan + powiązania
```js
lastByteSpans: ByteSpan[]   // aktualizowany przy każdym Compile, czyszczony przy Clear
```

---

## 10. Czterokierunkowe podświetlenie (Source ↔ AST ↔ WAT ↔ Bytecode)

Podświetlenia używają:
- **Identity-based** (`_astNode ===`) — AST view, WAT Explorer i Bytecode view (obiekty AST jako property na DOM elementach)

Podświetlenie źródła (source) używa overlay (`highlightSourceRange`) zamiast natywnego `setSelectionRange`. Overlay jest przerysowywany przy scrollu edytora.

- `clearHighlights()` — usuwa `.ast-highlight`, `.ast-stmt-highlight`, `.wat-highlight`, `.bc-highlight` + czyści source overlay
- `highlightWatForNode(stmtNode)` — identity-based: `el._astNode === stmtNode` na `.wat-line`; identycznie jak bytecode
- `highlightAstForNode(astNode)` — podświetla element AST (`_astNode ===`) + bursztynowy highlight na enclosing stmt
- `highlightBytecodeForNode(astNode)` — podświetla bajty, których `_astNode === astNode`
- `highlightSourceRange(start, end)` — renderuje overlay prostokąty nad edytorem (custom highlight)
- **Klik w edytorze** (`syncAstHighlight`) → najciaśniejszy AST node → highlight WAT + Bytecode + stmt amber
- **Klik w AST** → `_astNode` → highlight source (`__src?.id ?? 'main'`, srcStart/srcEnd) + WAT (identity) + Bytecode (identity) + stmt amber
- **Klik w WAT** → `_astNode` na `.wat-line` → `enclosingStmt` → highlight source (`__src?.id ?? 'main'`) + AST + Bytecode
- **Klik w Bytecode** → `_astNode` → highlight source (`__src?.id ?? 'main'`) + AST + WAT (identity)

---

## 11. Przepływ akcji

**Compile:**
```
editor → tokenize → parse → expand   ← macro-expander.js (zwraca expansionLog)
→ typecheck → generate(ast)   ← jeden call zwraca wszystko
    { bytes, byteSpans, watText, watSpans, module, sSpans }
→ lastWasmBytes, lastWatSpans, lastModule, lastSSpans
→ renderAST + renderWAT + renderBytecode
→ buildHoverData(tokens, ast, expansionLog)  ← zawiera expand-on-hover entries
→ updateMacroPanels(expLog)  ← zamyka panele, odtwarza +lens dla top-level wywołań
→ applyHighlight(null)  — usuwa error underline
```

**Run:**
```
lastWasmBytes → SharedArrayBuffer (8+1024 B) → Worker(wasm-runner.js, mode:'run')
→ Worker: WebAssembly.instantiate(bytes, { env: write_utf8, print_utf8, input_utf8 })
→ Worker ←→ Main thread messages:
     'write' text   → consolePanel.write(text)  [biały — output WASM]
     'println' text  → consolePanel.write(text + '\n')  [biały]
     'input-wait'    → consolePanel.startInput(cb) → cb przekazuje dane przez SharedArrayBuffer
     'done' result,elapsed → log (niebieski), _enterState('idle')
     'error' message → log (niebieski), _enterState('idle')
→ Stop: Worker.terminate() + _enterState('idle')
```

**Debug:**
```
generate(ast, { debug: true }) → { bytes, stmtMap }
→ resolve breakpoints (sourceBps → stmtIds)
→ SharedArrayBuffer (8+1024 B) → Worker(wasm-runner.js, mode:'debug', breakpoints:[...])
→ Worker: WebAssembly.instantiate(bytes, { env: ..., dbg: { brk(stmtId) } })
→ brk(stmtId): Atomics.wait(ctrl, STATE_PAUSE) — Worker blokuje się w miejscu
→ Main thread:
     Step     → Atomics.store(ctrl, STATE_STEP) + Atomics.notify → Worker wznawia, pauzuje przy następnym brk()
     Continue → Atomics.store(ctrl, STATE_CONTINUE) + Atomics.notify → Worker wznawia, pauzuje tylko na breakpointach
     Stop     → Atomics.store(ctrl, STATE_ABORT) + Atomics.notify → Worker rzuca AbortExecution
→ Worker messages: 'pause' stmtId → highlight 4-way, 'write'/'println'/'input-wait' → konsola, 'done'/'error' → cleanup
→ O(1) stepping — pamięć WASM persystuje między krokami (brak replay)
```

### Import object (wasm-runner.js)
```js
importObject = {
  env: {
    write_utf8:  (ptr, len) => { /* odczytuje z wasmMemory, dekoduje UTF-8; postMessage({type:'write', text}) — odpowiada ext::print */ },
    print_utf8:  (ptr, len) => { /* jak wyżej; postMessage({type:'println', text}) — odpowiada ext::printLn; main thread dodaje \n */ },
    input_utf8:  (ptr, maxLen) => { /* Atomics.wait(ctrl, STATE_INPUT); blokuje Worker do Atomics.notify; STATE_ABORT → throw AbortExecution — odpowiada ext::input */ }
  },
  // tylko w trybie debug (mode === 'debug'):
  dbg: {
    brk: (stmtId) => { /* Atomics.wait(ctrl, STATE_PAUSE); stepMode='step' → pauzuje przy każdym brk(); stepMode='continue' → pauzuje tylko na breakpointach; STATE_ABORT → throw AbortExecution */ }
  }
}
```

### SharedArrayBuffer protocol (7 stanów)
```
STATE_IDLE     =  0   — Worker idle
STATE_INPUT    =  1   — Worker zablokowany, czeka na stdin
STATE_INPUTOK  =  2   — Main thread wypełnił bufor, Worker kontynuuje  
STATE_PAUSE    =  3   — Debug: Worker zablokowany na breakpoint
STATE_STEP     =  4   — Debug: resume, pauzuj przy następnym brk()
STATE_CONTINUE =  5   — Debug: resume, pauzuj tylko na breakpointach
STATE_ABORT    = -1   — abort z dowolnego stanu (Worker rzuca AbortExecution)
```
Layout: `[0..3] Int32 state | [4..7] Int32 len | [8..1031] Uint8 dane` (8+1024 B).
Wymaga COOP/COEP — serwer `start.js` ustawia nagłówki.

---

## 12. Debugger (panel Debugger)

### Lokalizacja
Środkowa kolumna, pod Bytecode View (domyślnie zwinięty — rozwija się po kliknięciu Debug).

### Przycisk Debug w nagłówku
- `⬤ Debug` — kompiluje z instrumentacją debug i startuje sesję
- Podczas sesji Debug: Debug jest wyszarzony (`disabled`), Stop w toolbarze jest aktywny
- Stop w toolbarze (`#btn-stop`) — kończy sesję (Run lub Debug)

### Toolbar panelu
| Przycisk | Działanie |
|---|---|
| ⏭ Step | Wykonaj jeden statement — `Atomics.store(ctrl, STATE_STEP)` + `Atomics.notify` |
| ▶ Continue | Wykonuj do breakpointa lub końca — `Atomics.store(ctrl, STATE_CONTINUE)` + `Atomics.notify` |

### Sekcje panelu
1. **Current Statement** — fragment źródła bieżącej instrukcji

### Breakpointy
- Kliknięcie w numer linii w gutterze toggle'uje breakpoint (czerwona kropka)
- Breakpointy aktywne tylko podczas sesji debug

### Mechanizm debugowania (Worker-based, O(1) stepping)
- Debug używa tego samego Worker (`wasm-runner.js`) co Run, z `mode: 'debug'`
- Worker dodaje `importObject.dbg.brk(stmtId)` — wywoływany przed każdym statementem w WASM
- `brk()` blokuje Worker przez `Atomics.wait(ctrl, STATE_PAUSE)` — Worker zostaje w dokładnym miejscu wykonania
- Main thread: Step → `STATE_STEP` (pauzuj przy następnym brk), Continue → `STATE_CONTINUE` (pauzuj na breakpointach)
- **O(1) stepping** — pamięć WASM persystuje, brak replay od początku
- I/O (ext::print, ext::input) działa identycznie jak w trybie Run — przez SharedArrayBuffer + konsola IDE

### Podświetlenie bieżącej instrukcji
Po każdym kroku (`'pause'` message) debugger podświetla bieżący `astNode` we wszystkich widokach (identity-based):
- Source: overlay highlight w odpowiednim `qlang-source-view` (main lub panel makra)
- AST: `highlightAstForNode(astNode)`
- WAT: `highlightWatForNode(astNode)`
- Bytecode: `highlightBytecodeForNode(astNode)`

### Stany sesji
```js
debugSession = {
  stmtMap:      Map,         // stmtId → ASTNode
  breakpoints:  Set,         // Set<stmtId> — resolved raz na start sesji
};
// + Worker state: _debugWorker, _debugCtrl, _debugLen, _debugInput
```

### Konsola w trybie Debug
Output z WASM (ext::print/printLn) → zielony tekst w konsoli.
Wiadomości IDE (start/stop/error) → niebieski tekst (`var(--accent)`).
Stdin (ext::input) → to samo pole stdin co w Run (consolePanel.startInput).
