# Plan implementacji: Resilient Parser + Live LSP

> Data: 2026-04-09  
> Status: W trakcie implementacji

---

## TL;DR

Parser nigdy nie rzuca ParseError — zawsze zwraca częściowe AST z `ErrorNode`.
Pipeline zatrzymuje się po parse gdy są błędy (skip expand + typecheck).
IDE pokazuje częściowe AST + błędy jednocześnie.
`liveCompile()` działa na każdą zmianę w edytorze (debounce 150ms) — bez codegen.

Strategia recovery: **try-catch + skan do sync pointu** (prostsze od BFS pre-scan, ten sam efekt widoczny dla użytkownika). BFS pre-scan jako furtka architektoniczna.

---

## Pliki do modyfikacji

| Plik | Zmiana |
|------|--------|
| `compiler/parser.js` | ErrorNode, scanToTopLevel, scanToStatement, recovery w parseProgram + parseBlock |
| `compiler/pipeline.js` | compile() zwraca parseErrors; nowa liveCompile() |
| `compiler/staticTypeChecker.js` | guard na ErrorNode w checkDecl() + checkStmt() |
| `compiler/macro-expander.js` | weryfikacja pass-through ErrorNode |
| `compiler/ast-renderer.js` | nodeLabel() case 'ErrorNode' |
| `ide/main.js` | pokazywanie parseErrors, disable Run/Debug gdy błędy |
| `ide/lsp.js` | triggerLiveCompile() z debounce 150ms; guard w buildHoverData() |
| `tests/test.js` lub nowy plik | suity recovery parsera |
| wszystkie `*.md` | aktualizacja po każdym milestone |

---

## Milestones

| ID | Opis | Status |
|----|------|--------|
| M0 | Baseline 174/174 | ✅ |
| M1 | ErrorNode + top-level recovery (`parse()` never throws) | ✅ |
| M2 | Statement-level recovery (ErrorNode wewnątrz Block.body) | ✅ |
| M3 | Pipeline: `compile()` + `liveCompile()` API | ✅ |
| M4 | Downstream guards (TC, expander, renderer, lsp) | ✅ |
| M5 | IDE: partial AST w UI + disable Run/Debug | ✅ |
| M6 | Testy recovery | ✅ |
| M7 | Dokumentacja | ✅ |
| M8 | Live AST/LSP: `triggerLiveCompile()` debounced on `editor.input` | ✅ |
| M9 | Cleanup + edge cases | ✅ |

---

## Kluczowe decyzje architektoniczne

### ErrorNode
```js
{ kind: 'ErrorNode', error: ParseError, start, end }
```
- `start`/`end` = zakres tokenów objęty błędem
- `ParseError` zawiera `line`, `col`, `message`
- Żadnych pól wymaganych przez TC ani codegen

### Program node
```js
{ kind: 'Program', body: [...], errors: ParseError[] }
```
- `errors` zbiera wszystkie ParseError z recovery
- `body` może zawierać ErrorNode — jeden per "zepsuta deklaracja"

### Sync pointy
- **Top-level**: skan po `IDENT ':='` lub `IDENT ':'` przy `braceDepth==0`, lub EOF
- **Statement**: skan po `';'` lub `'}'` przy `depth==0`, lub EOF

### Pipeline API
```js
// Dotychczasowe — nie zmienia sygnatury, tylko dodaje pole:
compile(src) → { tokens, ast, expLog, parseErrors }

// Nowe — lekkie, bez codegen:
liveCompile(src, opts = {}) → { tokens, ast, expLog, parseErrors, typeErrors }
// opts.phases — furtka na future pasy (two-pass typecheck, typeof w #if)
```

- Gdy `parseErrors.length > 0`: skip `expand` + `typecheck` (AST bez `_type`)
- `liveCompile` nigdy nie rzuca — wszystkie błędy w polach wynikowych

### Live compile
- Debounce 150ms po `editor.input`
- Nie czyści stanu WAT / WASM (nie nadpisuje wyniku compile)
- `opts.phases` jako escape hatch: `{ phases: ['tokenize','parse','expand','typecheck'] }`

---

## Szczegółowy plan todów

### FAZA 0 — Baseline
- [ ] F0.1 Odpalić `node tests/test.js` → potwierdzić 174/174

### FAZA 1 — ErrorNode + top-level recovery (M1)
- [ ] F1.1 Dodać `errorNode(err)` helper w `compiler/parser.js`
- [ ] F1.2 Dodać `scanToTopLevelSyncPoint()` — skan z `braceDepth`, stop na IDENT `:=`/`:` przy depth==0 lub EOF
- [ ] F1.3 Otoczyć `parseDecl()` w `parseProgram()` try-catchem → push ErrorNode + scan
- [ ] F1.4 Dodać `errors: []` do Program node; zebrać wszystkie ParseError
- [ ] F1.5 `parse()` nigdy nie rzuca ParseError
- [ ] F1.6 Smoke test ręczny lub w REPL: `parse('bad !!! y := 2;')` → body = [ErrorNode, VarDecl], errors.length==1
- [ ] F1.7 Odpalić testy → 174/174

### FAZA 2 — Statement-level recovery (M2)
- [ ] F2.1 Dodać `scanToStatementSyncPoint()` — stop na `';'`/`'}'` przy depth==0 lub EOF
- [ ] F2.2 Otoczyć `parseStmt()` w `parseBlock()` try-catchem → push ErrorNode + scan
- [ ] F2.3 Test: funkcja z błędnym body → FuncDecl zachowana, body = [ErrorNode, ...]
- [ ] F2.4 Odpalić testy → 174/174

### FAZA 3 — Pipeline integration (M3)
- [ ] F3.1 `compile(src)` zbiera `ast.errors` → zwraca jako `parseErrors`
- [ ] F3.2 Gdy `parseErrors.length > 0`: pominąć expand + typecheck
- [ ] F3.3 Dodać `liveCompile(src, opts={})` do `pipeline.js`
- [ ] F3.4 `liveCompile` = tokenize + parse + expand (jeśli brak parseErrors) + typecheck (jeśli `opts.phases` zawiera 'typecheck')
- [ ] F3.5 `liveCompile` nigdy nie rzuca
- [ ] F3.6 Odpalić testy → 174/174

### FAZA 4 — Downstream guards (M4)
- [ ] F4.1 `staticTypeChecker.js`: `checkDecl()` — dodać `case 'ErrorNode': return;` (albo guard na wejściu)
- [ ] F4.2 `staticTypeChecker.js`: `checkStmt()` — analogiczny guard
- [ ] F4.3 `macro-expander.js`: zweryfikować że `expandDeclList()` pass-through dla nieznanego kind (jeśli nie — dodać)
- [ ] F4.4 `ast-renderer.js`: `nodeLabel()` — dodać `case 'ErrorNode': return '[ParseError] ' + node.error.message;`
- [ ] F4.5 `lsp.js`: `buildHoverData()` — guard na ErrorNode
- [ ] F4.6 Odpalić testy → 174/174

### FAZA 5 — IDE integration (M5)
- [ ] F5.1 `main.js`: po compile → jeśli `parseErrors.length > 0` → wyświetlić błędy w output panelu
- [ ] F5.2 `main.js`: gdy `parseErrors.length > 0` → disable przyciski Run / Debug
- [ ] F5.3 `main.js`: mimo błędów — renderować partial AST w AST Explorer
- [ ] F5.4 Odpalić testy → 174/174

### FAZA 6 — Testy (M6)
- [ ] F6.1 Test: top-level śmieć → ErrorNode + kolejne deklaracje OK
- [ ] F6.2 Test: błąd w środku funkcji → FuncDecl zachowana, ErrorNode w body
- [ ] F6.3 Test: wiele błędów → wiele ErrorNode + wiele parseErrors
- [ ] F6.4 Test: `compile()` z błędem nie rzuca
- [ ] F6.5 Test: `liveCompile()` z błędem nie rzuca, zwraca parseErrors
- [ ] F6.6 Test: poprawny kod po restarcie nadal produkuje te same wyniki co wcześniej (regresja)
- [ ] F6.7 Odpalić testy → ≥ 174/174

### FAZA 7 — Dokumentacja (M7)
- [ ] F7.1 Zaktualizować `archDetail.md` — dodać sekcję o ErrorNode + recovery strategy
- [ ] F7.2 Zaktualizować `archIntro.md` — wzmianka o resilient parser
- [ ] F7.3 Zaktualizować `langDetail.md` lub `langIntro.md` jeśli dotyczy błędów parse
- [ ] F7.4 Zaktualizować datę we wszystkich zmienionych `*.md`

### FAZA 8 — Live AST / LSP (M8)
- [ ] F8.1 `lsp.js`: dodać `triggerLiveCompile(src)` z debounce 150ms
- [ ] F8.2 `main.js`: podpiąć `editor.input` → `triggerLiveCompile(editor.value)`
- [ ] F8.3 Callback z `liveCompile`: odświeżyć AST Explorer, markers błędów (jeśli są) — BEZ czyszczenia WAT/WASM
- [ ] F8.4 Test dymny: wpisanie błędnego kodu → AST Explorer aktualizuje się na bieżąco
- [ ] F8.5 Odpalić testy → ≥ 174/174

### FAZA 9 — Cleanup (M9)
- [ ] F9.1 Przejrzeć TODO/FIXME w zmienionych plikach
- [ ] F9.2 Usunąć console.log debugowe (jeśli dodane)
- [ ] F9.3 Finalna pełna re-weryfikacja: `node tests/test.js` → ≥ 174/174
- [ ] F9.4 Finalna aktualizacja wszystkich `*.md`

---

## Notatki

- ErrorNode NIE powinien trafiać do typecheckera — skip gdy `parseErrors.length > 0`
- `liveCompile` opts.phases jako furtka na future: two-pass typecheck, `typeof` w `#if`
- Sync point heuristics mogą być niedoskonałe dla głęboko zagnieżdżonych błędów — to ok na tym etapie
- True BFS pre-scan (scan ALL tokens first, then parse) to future enhancement gdy będzie potrzeba
