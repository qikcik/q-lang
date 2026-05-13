# QLang — Refactor Council Notes

> Rada: A (Assembler), B (Paradigm Challenger), C (Java Architect), D (C++ Abomination), E (Haskell/Lisp), F (Junior), G (Deletion Wizard), H (Manager), J (Cognitive Scientist), K (Manual Tester)
> Format: każdy temat uruchamia pełny Micro-Plan. Wyniki są syntetyczne; debata odbywa się w chacie.

---

## 1. Mechanizm deklarowania importów WASM (`ext` → `extern!`)

### Summary

Obecny mechanizm opiera się na hardcoded `BUILTINS` w `wat-utils.js` i zarezerwowanym namespace `ext` rejestrowanym przez `_registerBuiltins()` w `staticTypeChecker.js`. To zamknięty system: żaden import poza trzema wbudowanymi nie jest możliwy bez modyfikacji kodu kompilatora. Użytkownik proponuje przejście na składnię deklaratywną — `print : fn(...) = extern!("env.print_utf8")`. Rada jednogłośnie popiera kierunek; spór dotyczył typów, nazwy i implikacji dla IDE.

**Kluczowa decyzja typologiczna**: WASM `import` section generuje funkcje wywoływane przez `call` (direct), nie przez `call_indirect` (table). Typ `ptr<fn>` w QLangu jest już zaalokowany dla *function pointers via table* (`call_indirect`). Mieszanie tych dwóch mechanizmów pod jednym typem złamałoby spójność codegen. Typ `fn(...)` (direct-callable, non-addressable) jest semantycznie poprawny dla runtime imports.

**Kluczowa decyzja nominalna**: `runtime_import` jest deskryptywne ale verbose i opisuje mechanizm, nie intencję. `extern` jest etablowanym idiomem (C, Zig, Rust). Sigil `!` sygnalizuje "compiler magic" — spójne z `unpack!` w tym języku. Rekomendacja: `extern!("module.field")`.

**Kluczowe ograniczenie IDE**: `wasm-runner.js` ma hardcoded `importObject`. Przeniesienie ciężaru deklaracji do użytkownika nie oznacza że IDE może host'ować dowolne funkcje — może obsługiwać predefiniowany zestaw. Kompilator musi eksportować `wasmImports[]` aby wasm-runner budował `importObject` dynamicznie (ale tylko z host-functions które IDE implementuje).

### Required Changes

- **Usunąć** `BUILTINS` array z `wat-utils.js` (linie 50–53) — zastąpić dynamicznym zbieraniem `ImportDecl` z AST.
- **Usunąć** `_registerBuiltins()` z `staticTypeChecker.js` (linie 34–80) i namespace `ext` — zastąpić sprawdzaniem `ImportDecl` nodes w scope.
- **Zaktualizować** `wat-encoder.js:buildWAT` — `collectAllFuncDecls` musi wyodrębnić `ImportDecl` nodes osobno; importy muszą iść pierwsze w function section (wymóg WASM spec).
- **Zaktualizować** `pipeline.js` — wynik `compile`/`compileMulti` musi zawierać `wasmImports: [{module, field, params, result}]`.
- **Zaktualizować** `wasm-runner.js` — `importObject.env` budowany dynamicznie z przekazanej listy `wasmImports`, z fallback błędu dla nieznanych funkcji.
- **Dodać** parser support dla `extern!(...)` jako wyrażenia inicjalizacyjnego w `VarDecl`/`ConstDecl`.
- **Dodać** nowy AST node `RuntimeImportExpr { module: string, field: string }`.
- **Zaktualizować** typechecker: `extern!("mod.field")` jako RHS deklaracji z typem `fn(...)` rejestruje binding jako `{kind: 'imported-func', mangledName, ...}`.

### Observations

- WASM spec wymaga żeby imported functions miały niższe indeksy niż lokalne funkcje — to inwariant który obecny kod zachowuje przez `BUILTINS.length` offset; nowy codegen musi go zachować przez sortowanie `ImportDecl` przed `FuncDecl`.
- `fn(...)` jako *typ wartości imported function* jest nowym konceptem w systemie typów — różni się od `ptr<fn>` (table pointer) i od zwykłego `fn` (local function). IDE hover musi odróżniać te przypadki.
- Obecne przykłady (`examples/showcase.qlang`, `examples/input-print.qlang`, `examples/hangman.qlang`, `examples/sokoban.qlang`) używają `ext::print`/`ext::printLn`/`ext::input` — wszystkie wymagają migracji.
- `wasm-runner.js` implementuje 3 host-functions. Jeśli user zadeklaruje import który nie jest w tym zestawie, dostanie `WebAssembly.LinkError` w runtime — to acceptable ale wymaga czytelnego error message.
- Decyzja o `extern!` vs keyword jest w dużej mierze estetyczna; ważniejszy jest nowy AST node i spójny codegen.

### Concrete Actions

- Dodać `ImportDecl` do parsera: `name : fn(params) rettype = extern!("mod.field");`
- Dodać `RuntimeImportExpr` do AST i typecheckera: weryfikuje `fn(...)` typ po lewej, rejestruje `{kind: 'imported-func', module, field, params, result}` w scope.
- Zmodyfikować `buildWAT` — wyodrębnić import-nodes z AST, umieścić je jako pierwsze przy budowie `funcIndex`.
- Dodać `wasmImports` do wyniku `pipeline.compileMulti`.
- Zaktualizować `wasm-runner.js` — dynamiczny `importObject` z przekazanej listy, obsługa nieznanych importów z komunikatem błędu.
- Przepisać `examples/*.qlang` zastępując `ext::print` → `print` (po zadeklarowaniu `extern!`).
- Zaktualizować `langDetail.md` §5.5 — zastąpić opis `ext` namespace opisem `extern!`.

### Needs Deeper Analysis

- **Scope importów**: importy deklarowane na poziomie pliku (globalny scope) — czy mogą być wewnątrz namespace'u? Czy `extern!` jest dozwolone wewnątrz `namespace Foo { ... }`?
- **Duplikaty**: dwie deklaracje `extern!` z tym samym `mod.field` — czy to błąd, czy alias?
- **Pierwszy klasa vs. opaque**: czy zadeklarowany import może być przekazany jako `ptr<fn>`? Semantycznie nie (to table index, nie import slot) — ale user może tego oczekiwać. Wymaga jawnej dokumentacji.
- **Multi-file projects**: jeśli plik A i plik B oba deklarują `print : fn(...) = extern!("env.print_utf8")`, kompilator powinien deduplikować sekcję `import` WASM — czy to jest automatyczne przez `funcIndex` map?
- **IDE extensibility**: czy IDE powinno wystawiać mechanizm rejestrowania custom host-functions przez użytkownika? To otworzy `extern!` na prawdziwe custom imports, ale zmienia scope projektu.

---

### Best Value to Noise Perspectives' Commentary

**A (Assembler)**: `fn(...)` dla importów i `ptr<fn>` dla tabeli — poprawna semantyka na poziomie bajtów. Zwracam uwagę: `ImportDecl` nodes muszą trafiać do `funcIndex` z indeksami 0..N-1 zanim jakikolwiek `FuncDecl` dostanie swój indeks. `wat-encoder.js:43-44` robi to przez `BUILTINS.forEach` — nowy kod musi zachować kolejność. Jeden poza-kolejnością import = złe wywołania wszystkich funkcji. Nie ma recovery.

**B (Paradigm Challenger)**: Rada wybrała `extern!` — słuszna decyzja. Ale warto rozważyć alternatywną składnię deklaratywną zamiast wyrażeniowej: `extern fn print(ptr: i32, len: i32) void from "env.print_utf8";` — bardziej jawne że to *deklaracja*, nie *przypisanie wartości*. Wyrażeniowa forma `= extern!(...)` sugeruje że to "wartość" którą można przypisać do zmiennej, co jest mylące.

**D (C++ Abomination)**: Consensus jest poprawny technicznie. Jedno zastrzeżenie: `table` i `elem` w `buildWAT` (linie 84-86) iterują `funcs` (local FuncDecls). Imported functions **nie mogą** trafić do tabeli funkcji — WASM spec tego zabrania. Nowy kod musi pilnować żeby `ImportDecl`-derived entries nie weszły do `elem` section. Aktualnie `BUILTINS` są bezpiecznie wykluczone bo `funcs = collectAllFuncDecls(ast)` zbiera tylko lokalne. Nowe podejście musi zachować to rozróżnienie.

**E (Haskell/Lisp)**: Ustalenie `fn(...)` jako *non-addressable* jest słuszne. Dopilnować: typechecker powinien odrzucać `&print` gdy `print` jest imported-func (tak jak dziś `&ext__printLn` to błąd — `langDetail.md:493`). Ten zakaz powinien być jawny w nowej specyfikacji. Jeśli pominąć ten szczegół, użytkownik spróbuje `&print` i dostanie niejasny błąd zamiast czytelnego komunikatu.

**J (Cognitive Scientist)**: Wyrażeniowa forma `= extern!(...)` ma jedną zaletę: wizualnie komunikuje że `print` jest *binding* (jak każde inne). To obniża cognitive load — nie ma nowej formy deklaracji do nauczenia. Wada: może sugerować re-assignment (`print = coś_innego`). Rozwiązanie: const binding + czytelny błąd przy próbie mutacji. Dla dokumentacji: przykład w `langDetail.md` powinien obok deklaracji pokazać od razu wywołanie — to zmniejszy questions jak F zadał.

**K (Manual Tester)**: Komisja zaakceptowała moje zastrzeżenie co do `wasm-runner.js`. Podkreślam: `wasmImports[]` z kompilatora musi być faktycznie użyty przez `wasm-runner.js` zanim feature zostanie uznana za gotową. Jeśli ktoś to zaimplementuje z "TODO: dynamicznie buildować importObject" i to TODO zostanie w kodzie przez 3 miesiące, to feature jest borken. K nie będzie klikał przez przykłady żeby weryfikować feature która jest broken by design.

**F (Junior)**: Dzięki że ktoś wytłumaczył różnicę między `call` a `call_indirect` — to było kluczowe. Ale mam jeszcze jedno pytanie którego nie było w debacie: jeśli `print` jest deklarowane na poziomie pliku (nie wewnątrz `main`), to czy jest widoczne w całym pliku? I czy można zadeklarować import wewnątrz funkcji? Pewnie nie, ale podręcznik powinien to jasno powiedzieć.

---

### Rejected Perspectives' Commentary

**H (Accidental Manager)**: Rada mnie odrzuciła za "myślenie w story-pointach". Fair. Ale mam jedno użyteczne pytanie: kto zaktualizuje przykłady? `examples/` to jedyne co większość użytkowników widzi. Jeśli `ext::print` zostanie w przykładach po refaktorze, error messages od nowych użytkowników będą bez sensu. To nie jest sprint planning, to delivery risk.

**C (Corporate Java Architect)**: Rozumiemy dlaczego mnie odrzucono — QLang to nie Spring. Ale: brak testów dla `extern!` przed implementacją to błąd. `test-codegen.js` i `test-typechecker.js` muszą mieć nowe suity dla `ImportDecl` + `RuntimeImportExpr` PRZED napisaniem kodu. To nie jest dogmatyczne TDD — to jedyny sposób żeby wiedzieć że nowy codegen nie psuje WASM function indices.

**G (Deletion Wizard)**: Mnie odrzucono za brak planu migracji. Plan jest prosty: (1) usuń BUILTINS, (2) usuń _registerBuiltins, (3) daj błąd kompilacji na `ext::` — stare przykłady przestają działać, to wymusza migrację, nie przeocza się jej. "Graceful migration" to prokrastynacja techniczna.

---

### Perspective Summary

Mechanizm `ext` namespace jest architektonicznym długiem — trzy hardcoded funkcje wbudowane w kompilator zamiast deklarowalnych przez użytkownika. Propozycja użytkownika jest słuszna w kierunku. Kluczowe ustalenia rady:

Typ `fn(...)` (direct-callable) jest semantycznie poprawny dla WASM imports, ponieważ importy kompilują się do `call` (direct), nie `call_indirect` (table) — typ `ptr<fn>` jest już zajęty przez function pointers via table i nie może być reużyty. Syntax `extern!("mod.field")` jest czytelniejszy niż `runtime_import(...)`: `extern` to etablowany idiom, `!` sigil sygnalizuje compiler-magic spójnie z `unpack!`.

Implementacja wymaga zmian w czterech warstwach: (1) parser — nowy `RuntimeImportExpr` node, (2) typechecker — `extern!` w inicjalizatorze const-binding z typem `fn(...)` rejestruje imported-func w scope, (3) codegen — `ImportDecl`-derived entries muszą mieć niższe funcIndex niż lokalne FuncDecl (wymóg WASM spec), i nie mogą trafić do sekcji `table`/`elem`, (4) runtime — `pipeline` eksportuje `wasmImports[]`, `wasm-runner.js` buduje `importObject` dynamicznie.

Największe ryzyko: indeksowanie funkcji w WASM binary. Jeden błąd w kolejności imports vs. locals = złe wywołania wszystkich funkcji bez oczywistego error message. Ten inwariant musi być pokryty testami przed refaktorem.

---

## Council Verdict

### 3 Big Bets
1. **`extern!("mod.field")` jako mechanizm user-declared WASM imports** — usuwa hardcoded `BUILTINS`, otwiera język na dowolne host-functions, spójny z istniejącą konwencją `!`-macros.
2. **Rozróżnienie `fn(...)` (import/direct) vs `ptr<fn>` (table/indirect)** — czyste, zgodne z WASM semantyką, nie wymaga nowych reserved words.
3. **`wasmImports[]` jako output pipeline** — oddziela kompilację od runtime, umożliwia dynamic `importObject` w IDE.

### 3 Things to Keep
1. **`!` sigil jako marker compiler-magic** — intuicyjny, `unpack!` już ustawia precedens.
2. **`ptr<fn>` dla function pointers via table** — `call_indirect` semantics, `fptr.*(args)` syntax — spójne i poprawne, nie zmieniać.
3. **Wyrażeniowa forma wiązania importu** (`name : fn(...) = extern!(...)`) — pasuje do istniejącego declaration syntax, nie tworzy nowej formy deklaracji.

### 3 Things to Kill
1. **`BUILTINS` array w `wat-utils.js`** — hardcoded global state, zastąpić AST-driven `ImportDecl` collection.
2. **`_registerBuiltins()` i namespace `ext`** — reserved namespace to anti-pattern w rozszerzalnym języku; ext::print stanie się przykładem migracji.
3. **`runtime_import` jako nazwa** — verbose, opisuje mechanizm nie intencję, odrzucone na rzecz `extern`.
