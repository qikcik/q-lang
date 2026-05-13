# QLang — Code Council Analysis
> Sesja: 2026-04-12 | Tematy: missing examples, edge cases, advanced game

---

## 1. Jakich przykładów brakuje żeby pokazać możliwości języka

### Consensus Leader: D (Senior C++ Abomination)

### Summary
Obecnych 4 przykładów (`fibonacci`, `showcase`, `hangman`, `input-print`) pokrywa może 30% cech języka. Widoczne są tylko `i32`, `bool`, `u8`, podstawowe `while`/`if`, proste makra i jeden namespace. Całkowicie nieobecne: `f32`/`f64`, `i64`/`u64`, `ptr<fn>` (function pointers), `defer`, `as<T>()`, nested struct, array decay, makro stringify (`#param`), gensym (`$name`), namespace aliases, `ptr<mut Struct>` mutation pattern. Każda z tych feature jest w spec i w testach jednostkowych — ale dla użytkownika IDE niewidoczna. `showcase.qlang` to cognitive overload: 120 linii, 7 konceptów jednocześnie, wynik `1272` bez kontekstu widocznego po Run. Potrzeba hierarchii: małe single-purpose examples per feature, potem kombinacyjne. `input-print.qlang` jest zduplikowane przez `hangman.qlang` (ten sam `ext::print` + `ext::input` pattern) i może zostać zastąpione lepszym przykładem. Najwyższy priorytet: `ptr<fn>` example, `defer` example, `f64` example — bo są "invisible features" dla każdego kto uczy się z pliku `examples/`.

### Required Changes
- Dodać `examples/pointers.qlang` — demonstracja `ptr<T>`, `ptr<mut T>`, dereferencja `p.*`, `ptr<fn>` + `call_indirect`, array decay przez `as<ptr<T>>(arr)`
- Dodać `examples/floats.qlang` — `f32`/`f64` arytmetyka, `as<f64>(i32)`, `i64` arytmetyka, konwersje między typami
- Dodać `examples/defer.qlang` — `defer` jako cleanup pattern, nested scopes z defer, kolejność wykonania
- Zastąpić `examples/input-print.qlang` bardziej informatywnym `examples/types.qlang` demonstrującym system typów

### Observations
- `showcase.qlang` zwraca `1272` — bez czytania kodu nie wiadomo co to znaczy; brak czytelnego widocznego efektu po Run
- `input-print.qlang` jest duplikatem pierwszych linii `hangman.qlang`; jeśli ma zostać, powinien być oznaczony jako "minimal I/O example"
- `langExtensionMacro.md` opisuje `#param` stringify i `#expand` — zero przykładów `.qlang` tego nie pokazuje
- Brak jakiegokolwiek przykładu z więcej niż jednym struct wchodzącym w interakcję
- `namespace` alias (`utils := namespace math`) jest w showcase ale efekt aliasu jest niewidoczny bez debuggera

### Concrete Actions
- `examples/function-pointers.qlang`: definicja 3 funkcji, array `array<ptr<fn(i32) i32>, 3>`, dispatch loop — 40 linii
- `examples/defer.qlang`: `defer` w funkcji ze wczesnym returnm, nested scopes, cleanup ordering — 30 linii
- `examples/floats.qlang`: `f64` arytmetyka, średnia tablicy jako `f64`, `as<f64>()` konwersja, porównania — 40 linii
- `examples/macros-advanced.qlang`: makro z `#param` stringify, `$gensym`, makro-w-makro kompozycja — 50 linii
- `examples/structs-ptr.qlang`: dwa structs (`Node`, `List`), mutacja przez `ptr<mut Node>`, przekazywanie adresu — 50 linii
- Zaktualizować `examples/index.json` z opisami i grupowaniem (Basics / Types / Structs / Macros / Advanced)

### Needs Deeper Analysis
- Czy `#param` stringify i `#expand` są zaimplementowane w obecnym `macro-expander.js` — jeśli nie, przykład nie może istnieć przed implementacją
- Czy `array<ptr<fn...>, N>` dispatch jest przetestowane w `test-codegen.js` — function pointer array to kombinacja dwóch osobnych feature

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: Priorytet examples jest: `ptr<fn>` > `defer` > `f64` > makra advanced. Function pointers są kluczowe bo `call_indirect` to architektoniczny workon dla każdego pattern dispatch — i nikt tego nie widzi w examples. `defer` jest critical w języku bez GC — pokazuje idiom sprzątania. Float math bez przykładu to "feature exists on paper only".

**B (Open-Source Paradigm Challenger)**: `function-pointers.qlang` powinien celowo pokazać dispatch table pattern — nie tylko "mam pointer i wywołuję". Chodzi o to że `array<ptr<fn...>, N>` jest tym co w innych językach jest vtable lub trait object. To jest systems programming feature i example powinien to komunikować wprost.

**J (Cognitive Scientist)**: Hierarchia examples powinna być explicite zakomunikowana w IDE — osobna sekcja "Feature Examples" vs "Programs". `showcase.qlang` powinno być przeniesione do sekcji "Programs" z opisem "pokazuje wszystkie feature razem". Single-concept examples powinny być pierwszym co user widzi.

**K (Reluctant Manual Tester)**: Każdy nowy example musi mieć jasny "co zobaczysz po Run" — albo jako komentarz w pierwszej linii, albo jako opis w `index.json`. `showcase.qlang` i nowe examples z numerycznym wynikiem powinny mieć ten wynik explicite nazwany, nie tylko pokazany jako magic number `1272`.

**A (Assembler Pragmatist)**: `floats.qlang` musi pokazać że `f64` to 8 bajtów i alignment 4 w WASM — nie 8. Jeśli ktoś zakłada że f64 ma alignment 8 to będzie miał bug w struct layout. Przynajmniej komentarz w example.

---

### Rejected Perspectives' Commentary

**G (Deletion Wizard)**: Usunąłem `input-print.qlang` z listy priorytetów bo jest duplikatem. Reszta konsensusu dodaje 6 nowych plików — zamiast tego proponuję: jeden plik `examples/language-tour.qlang` z sekcjami, każda 20 linii, komentarze jako nagłówki. Sześć plików to sześć context switchów dla użytkownika.

**H (Accidental Manager)**: Zdefiniujbym "feature coverage matrix" jako artefakt — tabela feature vs example, checkmarks gdzie pokryte. Done criteria dla każdego nowego example: przechodzi kompilację, zwraca oczekiwany wynik, jest w `index.json`. Bez tego nie wiemy kiedy "done".

**E (Lisp/Haskell Pipeline Fanatic)**: Consensus skupia się na individual features. Brakuje przykładu który pokazuje compositional power systemu makr — że można zbudować mini-DSL w QLang. `macros-advanced.qlang` dotyka tego ale nie wystarczająco. Makro które generuje inne makro albo transformuje AST w nietrywialny sposób — to byłby prawdziwy showcase systemów makr.

### Perspective Summary
Język ma bogaty system typów i feature set który jest prawie całkowicie niewidoczny z poziomu `examples/`. Istniejące 4 pliki tworzą fałszywe wrażenie prostego języka skryptowego z `i32` i `string`. Priorytetowe luki to: function pointers (architektoniczne), defer (idiomatyczne w no-GC języku), floats (typ istnieje ale zero użycia), advanced macros (najciekawsza feature bez demonstracji). Format issue: examples mieszają "programs" z "feature demos" bez rozróżnienia. Optymalne wyjście: 5-6 nowych focused examples + reorganizacja `index.json` z kategoryzacją + czytelny "po Run zobaczysz X" w każdym pliku.

---

## 2. Jakich przykładów brakuje żeby przetestować edge cases i performance

### Consensus Leader: A (Assembler Pragmatist)

### Summary
Test suite pokrywa "happy path" dla każdej feature ale systematycznie omija boundary values, type edge cases i numeric extrema. Brakuje: negative tests dla `array<T, 0>` (zero-size array), boundary arithmetic dla `u32` underflow w warunkach iteracji, `i64` i `u64` operacje (w ogóle nie przetestowane poza lexerem), nested struct layout verification (może być alignment bug w `wat-emitter.js`), `ptr<fn>` table saturation, `defer` w nested scopes, macro gensym z dziesiątkami nested calls. Performance: brak benchmarku który odróżni O(n) od O(n²) algorytm w codegen — np. rekurencja deep vs iteracja. K identyfikuje critical assumption bug: `ext::input` przy wpisaniu więcej danych niż bufor — zachowanie jest nieokreślone i niesprawdzone. Brak testów na czytelność error messages — tylko czy błąd jest rzucony, nie czy komunikat jest zrozumiały.

### Required Changes
- Dodać testy boundary w `test-codegen.js`: `array<T, 1>` (single element), `array<T, 0>` (czy kompilator odrzuca czy pozwala), `arr.[arr.size - 1]` (last valid index)
- Dodać testy `i64`/`u64` arytmetyki: overflow behavior, shift operations, `as<i64>(i32)`
- Dodać testy nested struct layout: struct z polami mixed-width (`u8`, `i32`, `u8`) — sprawdzić padding w wygenerowanym WAT
- Dodać test `defer` w nested scopes + `defer` po wczesnym `return`

### Observations
- `test-typechecker.js` sprawdza *czy* błąd jest rzucony, ale nigdzie nie sprawdza treści error message — `[Type] Error: Cannot assign to const variable 'x'` mogłoby brzmieć inaczej i test by nie zauważył
- `ext::input` z inputem dłuższym niż bufor: WASM truncates silently — użytkownik nie dostanie żadnego sygnału; to jest assumption bug w `hangman.qlang` (ibuf rozmiar 4, gracz wpisuje "QLANG\n" = 6 bajtów → bugged state)
- Brak jakiegokolwiek performance benchmark w automated tests — `fib_rec(30)` jest w examples ale nie w test suite z mierzeniem czasu
- Macro gensym: nie ma testu z 50+ nested macro calls sprawdzającego unikalność generowanych nazw
- Brak negatywnego testu dla `ptr<fn>` wywołanego z złą sygnaturą (type checker powinien to złapać)

### Concrete Actions
- `tests/test-numeric-edge.js` — nowy plik: testy `i64` operacji, `u32` underflow/overflow, `as<i64>()` chain, `f64` precision
- `tests/test-memory-layout.js` — nowy plik: weryfikacja offsetów pól struct przez WAT output inspection; testuj `sizeof` mixed struct
- W `test-codegen.js`: dodać test `array<i32, 1>` + `array<i32, 0>` (expect error lub trap)
- W `test-macros.js`: dodać test gensym przy 20 nested calls tego samego makra — sprawdź że generated names są unikalne
- W `test-defer.js`: dodać test defer w nested scope (3 poziomy) + defer po early return — sprawdź kolejność
- Manual test (K): wpisz string dłuższy niż bufor w `hangman.qlang` — udokumentować zachowanie w `KNOWN_ISSUES.md`

### Needs Deeper Analysis
- `array<T, 0>` — czy parser akceptuje? Czy typechecker odrzuca? Czy jest zdefiniowane zachowanie? Nie widać tego nigdzie w spec ani w testach
- Nested struct memory layout: czy `wat-emitter.js` poprawnie sumuje rozmiary inner struct z paddingiem przy obliczaniu offsetu outer struct field
- Performance ceiling: przy jakim `n` `fib_rec(n)` przekracza WASM call stack limit w przeglądarce? Nie ma benchmarku.

---

### Best Value to Noise Perspectives' Commentary

**A (Assembler Pragmatist)**: Mixed-field struct alignment to potencjalny silent bug. `struct { a: u8; b: i32; c: u8; }` — jeśli emitter po prostu sumuje bajty bez padding, `b` będzie na adresie 1 zamiast 4. WASM `i32.load` na unaligned adresie daje undefined behavior. Ten test musi istnieć.

**D (Senior C++ Abomination)**: `defer` w nested scopes z early return to najbardziej nasty edge case. Semantyka: defer runs w odwrotnej kolejności deklaracji per scope level, parent scope defers run po dziecku. Jeśli implementacja jest rekurencyjna przez scope stack, może mieć bug przy 4+ poziomach zagnieżdżenia.

**B (Open-Source Paradigm Challenger)**: Ackermann(3, 4) = 125 iteracji przez interpreter — dobry smoke test dla call stack depth. Jeśli WASM runner nie ma configured stack depth, `fib_rec(40)` może go nie zabić ale `ackermann(3, 6)` na pewno. Benchmark który testuje limity jest cenniejszy niż benchmark który tylko mierzy czas.

**J (Cognitive Scientist)**: Error message quality jest testowalnym artyfaktem. Powinien istnieć test: `compile(src_with_error).errors[0].message` matches `/Cannot assign to const/` — nie tylko `errors.length > 0`. Użytkownik czyta error, nie kod testu.

---

### Rejected Perspectives' Commentary

**E (Lisp/Haskell Pipeline Fanatic)**: Consensus ignoruje macro composition edge cases. `macro A wywołuje macro B` gdzie B używa `$gensym` — czy namespace gensymów jest izolowany per-invocation per-level czy globalny? To może być źródłem subtelnych bugów w production macros i żaden test tego nie sprawdza.

**G (Deletion Wizard)**: Nowe pliki testowe: `test-numeric-edge.js` i `test-memory-layout.js`. Usunąłbym duplikatywne testy z `test-codegen.js` zamiast dodawać nowe pliki obok. Rosnąca liczba plików to rosnący overhead rozumieniu co gdzie jest.

**H (Accidental Manager)**: "Needs Deeper Analysis" to backlog. Zróbmy ticket na każdy punkt i przypisz do sprintu. Mam TODO: (1) spec `array<T, 0>`, (2) nested struct layout doc, (3) performance baseline doc. To są deliverables, nie "analysis".

### Perspective Summary
Test suite jest szeroka ale płytka: pokrywa feature paths ale nie boundary conditions. Trzy krytyczne luki: (1) numeric edge cases dla `i64`/`u64` i float — te typy istnieją w spec ale ich limity są niesprawdzone; (2) struct memory layout verification — cicha błędy paddingu nie będą wykryte przez functional tests; (3) `ext::input` overflow assumption bug — user wpisujący więcej danych niż bufor dostaje skrócony input bez żadnego sygnału. Jedno krytyczne pytanie bez odpowiedzi: co to jest `array<T, 0>` w QLang — legalne, błąd kompilacji, czy crashuje? To powinno być w spec i w teście w ciągu jednej sesji.

---

## 3. Jaką bardziej zaawansowaną grę można zaimplementować żeby przetestować wszystkie funkcjonalności języka

> **Aktualizacja (sesja 2):** Snake odrzucony — wymaga non-blocking input i clear-screen, których QLang nie ma. Rekomenduję Sokoban.

### Consensus Leader: D (Senior C++ Abomination)

### I/O Constraints QLang (zebrane przed analizą)
- Wyłącznie `ext::print` / `ext::printLn` / `ext::input` (blocking, line-buffered)
- Brak operatora `%` (modulo nie istnieje)
- Brak operatorów bitowych
- Brak timer / sleep / rand
- Brak cursor control / clear-screen
- Tablice fixed-size, bump allocator

### Summary
Jedynym viable kategoria gry dla QLang jest **turn-based**, gdzie każdy stan planszy drukowany jest od nowa po każdym wyjściu i input jest blokujący. Snake odrzucony (real-time + clear-screen). Roguelike odrzucony (random wymagałby LCG a `%` nie istnieje). Dungeon text adventure odrzucony (parsowanie komend `u8`-po-`u8` bez stdlib zdominowałoby kod). Rekomendacja: **Sokoban z jednym hardcoded poziomem** — gracz pcha skrzynki na cele (8×8 plansza), jedna turę = jedna litera (`w`/`a`/`s`/`d`/`r`/`q`), plansza drukowana po każdym ruchu. Sokoban naturalnie wymaga 5 genuinely różnych dispatch-functions (`move_up`, `move_down`, `move_left`, `move_right`, `reset`) przez `array<ptr<fn(ptr<mut State>) void>, 5>` — każda robi inne obliczenie na współrzędnych. Tile encoding jako `u8` (0=puste, 1=ściana, 2=gracz, 3=skrzynka, 4=cel, 5=skrzynka@cel, 6=gracz@cel) bez bitwise — wszystkie sprawdzenia przez `if tile == CONSTANT`. Makro `print_board!(state)` — renderuje planszę u8-tile do ASCII. `defer` dla komunikatu win/lose do end of main. ~210 linii. Alternatywa: **Connect Four** (~160 linii) — mniejszy scope, ale win-detection scan 4-kierunkowy jest mniej interesujący architektonicznie.

### Required Changes
- Zastąpić Snake → `examples/sokoban.qlang` jako flagship advanced example — ~210 linii
- Feature mapping musi być explicite jako komentarz na początku pliku

### Observations
- Sokoban testuje naturalnie: struct (`State`), `array<mut u8, 64>` board (8×8), `ptr<mut State>` mutation, `array<ptr<fn...>, 5>` dispatch, makro renderowania, `defer`, `while` game loop, `u8`/`i32` arytmetyka, `as<u8>()` konwersja tile na ASCII char
- Sokoban NIE testuje: `f64`, `i64` — żadna turn-based gra integrowa nie testuje float naturalnie; te typy wymagają osobnych examples
- `ptr<fn>` dispatch jest tu *genuinely* różnicujący: `move_up` liczy `pos - WIDTH`, `move_down` liczy `pos + WIDTH`, `move_left` liczy `pos - 1` z boundary check na kolumnę, `move_right` liczy `pos + 1` z boundary check — każda funkcja ma inną logikę
- Win condition: count skrzynek na celach rośnie przy każdym ruchu — naturalny counter pattern
- Edge cases dla K: push box into wall, push box into second box (illegal), push box off the edge of board, enter multiple chars per turn (leftover stays in input buffer for next turn), restart via `r`
- Brak modulo nie stanowi problemu — boundary checks: `if next_col < 0 || next_col >= 8` zamiast `% 8`
- Connect Four jako alternatywa: prostszy (~160 linii), win detection przez 4 direction scan functions jest naturalnym `ptr<fn>` use, ale mniej ciekawa logika push mechanics

### Concrete Actions
- **`examples/sokoban.qlang`** — implementacja z feature coverage map jako header:
  ```
  // Feature coverage:
  // [struct]    State { board: array<mut u8, 64>; px: mut i32; py: mut i32; boxes_done: mut i32; moves: mut i32; }
  // [ptr<mut>]  mutation State przez ptr<mut State>
  // [ptr<fn>]   move_dispatch: array<ptr<fn(ptr<mut State>) void>, 5>
  // [array]     board 8x8 jako flat array<mut u8, 64>
  // [macro]     print_board!(state) — renderuje board tile po tile
  // [defer]     win/lose message wypisany na końcu main
  // [while]     main game loop
  // [u8/i32]    tile encoding u8, coordinates i32
  // [as<u8>]    tile constant → ASCII char
  // [namespace] State:: konstruktory i helper functions
  ```
- Planszę 8×8 zakodować jako hardcoded `array<u8, 64>` literal — jeden piękny poziom Sokobana z 3 skrzynkami i 3 celami
- Grę implementować w 3 sekcjach: (1) Typy i tile constants, (2) Logic functions (move_X, check_win), (3) Main + game loop
- Tile constants jako top-level const: `EMPTY := 0`, `WALL := 1`, etc. — demonstracja const pattern

### Needs Deeper Analysis
- Czy `array<ptr<fn(ptr<mut State>) void>, 5>` jest poprawną składnią QLang i czy codegen obsługuje array of function pointers — to kombinacja feature która może nie być przetestowana razem
- Leftover input bytes po wpisaniu więcej niż 1 znaku: czy `ext::input` z buforem 4 konsumuje całą linię czy tylko 4 bajty — zachowanie przy wpisaniu "wasd\n" może powodować 5 kolejnych tur zamiast 1

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: `move_left` i `move_right` muszą sprawdzać granicę *kolumny* — nie tylko że `next_pos >= 0`. Gracz na pozycji `pos=7` (prawy brzeg) ruszając się w prawo dostałby `pos=8` czyli pierwsze pole następnego wiersza. To jest classical flat-array grid bug. `if (next_col < 0 || next_col >= 8) return;` to jedyna poprawna boundary check — i jest to naturalne miejsce do pokazania `i32` konwersji z `pos % 8` — ale modulo nie istnieje, więc: `col := px - (px / 8) * 8` ze `as<i32>()` chain. Albo trzymać `px` i `py` osobno i nie używać flat index dla boundary checks. Strukturalnie trzymać `px`/`py` osobno jest zgodne z propozycją w struct `State`.

**A (Assembler Pragmatist)**: State struct: `board` = 64 bajtów, `px` `py` `boxes_done` `moves` = 4×4 = 16 bajtów. Total ~80 bajtów. Plus tile constants — zero overhead. WASM stack bezpieczny. Ale: `array<ptr<fn...>, 5>` to 5 function-table indices = 20 bajtów. Mieszczą się razem. Memory footprint: minimalny.

**J (Cognitive Scientist)**: Tile encoding `0..6` z siedmioma wartościami jest kognitivnie gęste — debugger i user muszą pamiętać co każda liczba znaczy. Rekomendacja: tile constants jako top-level named consts (pokazano w Concrete Actions) plus komentarz `// tile map:` na początku pliku. To zmniejsza cognitive load i jest dobrym idiomatic QLang pattern.

**K (Reluctant Manual Tester)**: Leftover input bug jest krytyczny. Jeśli `ext::input` czyta do newline ale bufor ma rozmiar 2, i user wpisał `wa\n` = 3 bajty, to co zostaje w stdin? Następna tura może dostać `\n` jako input co jest "empty move". To jest K-territory: nie implementacja bug, ale *assumption bug* – zakładamy że user wpisuje 1 znak. Wymaga manualnego testu i ewentualnego flushing loop po każdym ruchu.

**B (Open-Source Paradigm Challenger)**: Sokoban z jednym poziomem jest dobry. Ale encoding 7 wartości tile bez enum jest bolesny — właśnie to Zig rozwiązuje przez `const enum`. QLang powinien dostać enum w v2 i Sokoban będzie naturalnym migration target pokazującym why enums matter. Sokoban przypadkowo staje się argumentem za następnym feature.

---

### Rejected Perspectives' Commentary

**E (Lisp/Haskell Pipeline Fanatic)**: Sokoban to stateful mutation fest — absolutnie żadnej composability. Każda funkcja `move_X` mutuje przez ptr i zwraca void. Nie ma tu żadnego functional pattern. Rozumiem że to jest limitacja języka+gry, ale nie udawajmy że to "testuje system typów w głębi". Testuje mutowalność. To jest mechanika, nie architektura. Oczekuję przykładu po Sokobanie który pokaże że QLang ma coś do zaoferowania poza imperative mutation.

**H (Accidental Manager)**: Mam story map: (1) Render empty board, (2) Player movement, (3) Box push logic, (4) Win detection, (5) Game loop + restart. Pięć mergeable stories. Każda ma acceptance test. Nie pytajcie mnie o implementację — mam sprint planning.

**C (Corporate Java Architect)**: Connect Four byłoby czystsze architektonicznie — `Board` namespace z `Board::drop`, `Board::check_win`, `Board::render`. Sokoban miesza rendering z logiką w `move_X` functions. Separacja warstw jest lepsza w Connect Four nawet jeśli logika jest prostsza. Ale zgadzam się że Sokoban wygrywa coverage per line i edge case richness.

### Perspective Summary
Snake wymaga I/O capabilities których QLang nie posiada (non-blocking input, screen clearing). Turn-based gry z blocking I/O są jedyną kategorią. Sokoban jest optymalnym wyborem: jeden hardcoded poziom eliminuje potrzebę randomu i modulo, push mechanics generują genuinely różne `ptr<fn>` dispatch functions, flat array board naturalnie testuje `u8` encoding i `i32` coordinate arithmetic, `defer` ma naturalne miejsce. Kluczowa pułapka implementacyjna: flat-array boundary checking bez `%` wymaga trzymania `px`/`py` osobno zamiast single flat index — to jest pierwsza decyzja designu która musi być poprawna. Leftover input bytes są assumption bugiem wymagającym manualnego testu przez K. `f64` i `i64` naturalnie NIE pasują do żadnej turn-based gry integrowej — wymagają osobnych focused examples, nie gry.

---

## Council Verdict

### 3 Big Bets
1. **`examples/sokoban.qlang`** — flagship advanced example, ~210 linii, testuje 80% feature, pierwsze realne `ptr<fn>` dispatch w repo; Snake odrzucony (wymaga non-blocking I/O + clear-screen)
2. **Feature-focused single examples** — seria `pointers.qlang`, `defer.qlang`, `floats.qlang`, `macros-advanced.qlang` — każdy 30-50 linii, feature coverage map jako header, reorganizacja `index.json`
3. **Numeric & layout edge tests** — `test-numeric-edge.js` + `test-memory-layout.js` — szczególnie mixed-field struct alignment i `array<T, 0>` spec

### 3 Things to Keep
1. **`hangman.qlang`** — najlepszy obecny example: interaktywny, widoczny efekt, naturalne użycie I/O, while loop, string operations
2. **`fibonacci.qlang`** — dobry "hello world" proof-of-concept, iterative vs recursive comparison pattern jest wzorcowy
3. **`showcase.qlang`** — ma wartość jako "everything in one place" reference ale powinno być oznaczone jako "Reference" nie "Showcase" i przeniesione do osobnej kategorii

### 3 Things to Kill
1. **`input-print.qlang`** — duplikat pierwszych 3 linii hangman; jeśli zostaje, przemianować na `minimal-io.qlang` z explicite "minimal example" labelem, nie jako showcase language capability
2. **Brak feature coverage maps** — każdy obecny example zakłada że czytelnik domyśli się co demonstruje; to musi skończyć się z każdym nowym example
3. **"Testy sprawdzają czy błąd jest rzucony"** — `test-typechecker.js` pattern `errors.length > 0` bez weryfikacji treści message; dodać minimum jedno assertion na message substring dla każdego error testu

---

---

# QLang — Code Council Analysis
> Sesja: 2026-05-13 | Temat: Analiza synchronizacji dokumentacji *.md z implementacją

---

## 4. `langDetail.md` + `langIntro.md` — dywergencja dokumentacji języka

### Consensus Leader: D (Senior C++ Abomination)

### Summary
Oba pliki `langDetail.md` i `langIntro.md` mają datę `2026-04-12` i nie odzwierciedlają co najmniej pięciu zaimplementowanych features: `defer`, `pack`/`unpack!`, `break`, literały znakowe `'x'`, konkatenacja stringów. Najpoważniejszy błąd faktyczny: `langDetail.md` §3.3 używa starej składni `arr[i]` (`slots[0] = 99; // OK`) zamiast `arr.[i]` — tymczasem `changeProposal.md` potwierdza że `IndexExpr` (`arr[i]`) zostało usunięte z parsera. Użytkownik próbujący wkleić przykład z dokumentacji dostanie błąd parsowania. `langIntro.md` nie mówi nic o `defer`, `pack`, `void`, `break`, `ScopeBlock` ani literałach znakowych. `langExtensionMacro.md` §9.2 urywa się w połowie przykładu (plik ma 241 linii i kończy na `}` bez zamknięcia sekcji). Sekcja `pack` kind jest wymieniona w tabeli kindów ale nie ma własnego opisu ani przykładu mimo że `pack`/`unpack!` jest IMPLEMENTED (MVP) per `changeProposal.md`. Dokumentacja języka jest kompletna do circa 2026-04-12 — niemal miesiąc za implementacją.

### Required Changes
- **Krytyczny błąd faktyczny**: `langDetail.md` §3.3 — zmienić `slots[0] = 99` → `slots.[0] = 99` (i analogiczne wystąpienia `arr[i]` → `arr.[i]`); `arr.[i]` to jedyna legalna składnia od implementacji changeProposal item 5
- Dodać sekcję `defer` do `langDetail.md` (odpowiednik §defer): semantyka LIFO, kolejność przed `return`, interakcja z zagnieżdżonymi scope'ami, przykład cleanup pattern
- Dodać sekcję `break` do `langDetail.md` (jest w `AC_STATIC`, jest w kodzie, nie ma w specyfikacji)
- Zaktualizować `langIntro.md` — dodać wzmiankę o `defer`, `void`, literałach znakowych, konkatenacji stringów

### Observations
- `lang​Detail.md` §3.3 `buf[0] = 72; // OK` — takie samo wystąpienie starego składni `arr[i]`; przeszukać cały plik na wzorzec `arr[` i podmienić
- `langExtensionMacro.md` kończy się na otwartej sekcji §9.2 `for_each` — brakuje przykładów `swap!`, `assert!`, sekcji `pack` kind z przykładem `unpack!`
- `langIntro.md` §2 kończy się urwaną sekcją tablicy (ostatnia linijka to ` ``` `) — wizualny sygnał że plik jest niekompletny
- Sekcja `defer` w `langDetail.md` powinna explicite powiedzieć że `return expr` ewaluuje wyrażenie zanim uruchomią się deferred statementy (kluczowa subtelność per feedback F)
- `langDetail.md` §10 Ograniczenia wymienia "brak zagnieżdżonych struktur w polach przy codegen" — weryfikować czy to nadal prawda

### Concrete Actions
- Szukaj/zamień w `langDetail.md`: `arr[i]` → `arr.[i]`, `arr[0]` → `arr.[0]`, `buf[0]` → `buf.[0]`
- Dodać do `langDetail.md` nową sekcję §12 `defer`:
  ```
  defer expr;           // odłożona pojedyncza instrukcja
  defer x = val;        // odłożone przypisanie
  defer { blok };       // odłożony blok
  ```
  Z opisem: LIFO, wstrzykiwane przed każdym `return`, przy fallthrough na końcu bloku; wartość return-expression jest obliczana przed uruchomieniem deferred.
- Dodać do `langDetail.md` §13 `break` — legalna tylko wewnątrz `while`, przerywa pętlę
- Dodać do `langExtensionMacro.md` sekcję §10 `pack` kind z przykładem `unpack!`
- Zaktualizować daty "Stan na:" w obu plikach na 2026-05-13

### Needs Deeper Analysis
- `langDetail.md` §10 "brak zagnieżdżonych struktur w polach przy codegen" — czy `struct A { b: B; }` działa przy codegen gdy `B` ma pola skalarne? Sprawdzić `test-struct.js`
- `langExtensionMacro.md` §7 mówi `arr.[i]` — plik wydaje się zaktualizowany co do tej składni, więc tylko sekcja pack i truncated §9 wymagają uzupełnienia

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: Błąd `arr[i]` w §3.3 to nie tylko doc-bug — to potencjalnie dezorientuje nowych użytkowników którzy próbują składni z dokumentacji. W systemowych językach "dokumentacja = kontrakt". Tutaj kontrakt jest naruszony. Priorytet zero: naprawić przykłady kodu w langDetail przed wszystkim innym.

**A (Assembler Pragmatist)**: Wszystkie wystąpienia `arr[i]` w dokumentacji — szybki grep wykaże dokładnie ile ich jest. Zrobić to zanim cokolwiek innego.

**J (Cognitive Scientist)**: Sekcja `defer` musi zawierać przykład który pokazuje "kiedy to się odpala" — nie tylko składnię. Kluczowa jest wizualna prezentacja: "piszesz na górze, odpala się na dole". Cognitive model użytkownika domyślnie zakłada że `defer` jest "po return" — spec musi ten model korygować explicite.

**K (Reluctant Manual Tester)**: `langDetail.md` §10 mówi że  `Namespace'd variables` są deferred to v2 — OK. Ale czy user wie że `std::BAR := 42;` jest parsowane ale ignorowane przez codegen czy rzuca błąd? To jest K-assumption: zakładamy że user nie spróbuje tej składni. Może spróbuje.

**B (Open-Source Paradigm Challenger)**: `defer` jako AST-rewrite pass (nie runtime construct) jest architektonicznie ciekawą decyzją — warto to explicite zaznaczyć w sekcji jako "note dla implementorów". Zig ma `defer` jako runtime construct (odwrócony stack). QLang robi to w compile-time. Różnica ma implikacje dla future design.

**C (Corporate Java Architect)**: Tabela feature→status w §10 Ograniczenia jest niekompletna i nie ma "implemented yes/no". Zamienić na dwie sekcje: "Implemented features" i "Known limitations" — jeden wzrok, jasny podział.

---

### Rejected Perspectives' Commentary

**H (Accidental Manager)**: Pięć ticketów na dokumentację — każdy z description of done. Nie będę tu pisał backlogu. Chodzi o to żeby naprawić pliki, nie planować naprawianie plików.

**G (Deletion Wizard)**: `langIntro.md` jest duplikatem `langDetail.md` na pierwszy rzut oka — warto rozważyć usunięcie. Ale consensus zdecydował że obie warstwy są potrzebne. Zostawiam pod protest: dwa pliki = podwójny koszt utrzymania.

**E (Lisp/Haskell Pipeline Fanatic)**: Dokumentacja `defer` powinna wyjaśnić że jest to fold nad listą DeferStmt w AST — nowa sekwencja instrukcji zamiast oryginalnych. Ten model jest precyzyjniejszy niż "odpala przed return". Consensus nie uwzględnił tej warstwy.

### Perspective Summary
`langDetail.md` i `langIntro.md` są miesiąc w tyle za implementacją. Jeden błąd faktyczny (składnia `arr[i]`) jest krytyczny ponieważ generuje błędy parsowania przy kopiowaniu z dokumentacji. Cztery brakujące sekcje (`defer`, `break`, `pack`/`unpack!`, char literals) to hidden features niemożliwe do odkrycia przez użytkownika czytającego spec. Hierarchia pilności: (1) napraw `arr[i]` → `arr.[i]`, (2) dodaj sekcję `defer`, (3) dodaj break, (4) uzupełnij langExtensionMacro §pack. Daty "Stan na:" powinny być aktualizowane przy każdej zmianie — obecnie są martwym sygnałem.

---

## 5. `langExtensionMacro.md` — urwany plik; `namespace.md` — zombie-proposal

### Consensus Leader: D (Senior C++ Abomination)

### Summary
`namespace.md` ma header `> Status: propozycja (2026-04-11)` — ale namespace jest zaimplementowany. `test-namespace.js` istnieje, `QualifiedName` jest w `parser.js`, `inferQualifiedName()` jest w `type-infer.js`, `NamespaceDecl`/`NamespacedDecl` są w parserze. Wszystkie sekcje `namespace.md` (§3 składnia, §4 eliminacja TYPE_KW, §5 eliminacja TypeConstructorExpr→QualifiedName, §6 scope model) opisują implementację która już jest. Jedyna sekcja która jest still-deferred: namespace'd variables (`std::BAR := 42`) — explicite wymienione w `langDetail.md` §10. `namespace.md` powinno zostać przeniesione do `docs/history/` jako implementation record albo przekształcone w reference documentation usuwając "Status: propozycja". `langExtensionMacro.md` urywa się po §9.2 `for_each` — brakuje przykładów `swap!`/`assert!` i całkowicie brakuje sekcji o `pack` kind mimo że MVP jest zaimplementowany (changeProposal item 9).

### Required Changes
- `namespace.md`: usunąć lub zmienić header `> Status: propozycja` — implementacja jest zrobiona; przenieść do `docs/history/namespace-impl.md` jako archived implementation notes, albo zaktualizować status na `> Status: ZAIMPLEMENTOWANE (2026-04-11)` z notą co jest deferred
- `langExtensionMacro.md`: dodać sekcję §10 `pack` kind — opis `pack<any>`, `pack<expr>`, reguła "ostatni parametr", `[...]` literal, `unpack!` built-in z przykładem
- `langExtensionMacro.md`: dodać przykłady §9.3 `swap!` i §9.4 pełny `assert!` z wywołaniem i rozwinięciem

### Observations
- `namespace.md` §3.5 (alias `gfx := namespace Engine::Graphics`) — zaimplementowane, ale `langDetail.md` nie ma tej składni; aliasy namespace są jedyną brakującą reference w langDetail
- `namespace.md` §7 Parser changes i §7.3 `parseCallOrPrimary()` pokazują wewnętrzne detale implementacji które są nieodpowiednie dla dokumentacji języka (OK w docs/history)
- `langExtensionMacro.md` §6.1 `$name` gensym — dobrze opisany. §6.2 `@param` — dobrze opisany. §7 `arr.[i]` — aktualny. §8 `T::of`/`T::default` — aktualny
- `changeProposal.md` item 3 mówi "`#expand` has been removed, replaced by `unpack!`" — `langExtensionMacro.md` tabel kindów nadal wymienia `pack` w wierszu tabeli ale nie ma sekcji opisującej jak `unpack!` działa

### Concrete Actions
- Zmienić header `namespace.md` na: `> Status: ZAIMPLEMENTOWANE — archiwum decyzji projektowych. Zob. langDetail.md §namespace.`
- Dodać do `langDetail.md` §namespace wzmiankę o aliasach (`gfx := namespace Engine::Graphics; gfx::draw();`)
- Dodać do `langExtensionMacro.md` sekcję §10:
  ```
  ## 10. Pack — argumenty wariadic
  pack<kind>  — comptime-only sekwencja argumentów
  [v1, v2, v3]  — PackLiteral
  unpack!(vals, iter, { ciało })  — built-in rozwinięcie
  ```
- Dodać do `langExtensionMacro.md` kompletny przykład `unpack!` z `LogAll!`
- `changeProposal.md` item 3: `#expand` removed — upewnić się że `langExtensionMacro.md` nie wspomina `#expand` (usunąć ewentualne wzmianki)

### Needs Deeper Analysis
- Czy `pack<expr>` vs `pack<any>` jest kiedykolwiek differentiated w obecnym type-checkerze? `changeProposal.md` mówi MVP — może tylko `pack<any>` działa
- Jak dokładnie `unpack!` wygląda w AST po expanacji? `macro-expander.js` ma `expandUnpack` — warto przejrzeć `macro-unpack.js` aby sfinalizować przykład w docs

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: `namespace.md` w docs/history to właściwe miejsce. Ale zanim tam trafi — ktoś musi upewnić się że wszystkie dobre examples z §3 są przeniesione do `langDetail.md` (alias namespace, struct auto-namespace, `Player::kill`). Informacja nie może zniknąć, tylko zmienić lokalizację.

**A (Assembler Pragmatist)**: Grep na `#expand` w całym projekcie — jeden wynik: `changeProposal.md` item 3. `langExtensionMacro.md` nie wspomina `#expand`. Nie ma czego usuwać. Jeden mniej task.

**C (Corporate Java Architect)**: Dwa pliki opisujące system makr (`langDetail.md` §5.6 odsyłającego do `langExtensionMacro.md`) to fragment architektury docs który działa — cross-reference jest poprawny. Ale `pack` jest wymieniony w tabeli kindów `langExtensionMacro.md` bez własnej sekcji — to jest broken reference pattern.

**J (Cognitive Scientist)**: `unpack!` jest built-in makrem. Użytkownik który szuka "jak iterować po pack" znajdzie `unpack!` w auto-complete (bo jest keywordem?) albo wcale go nie znajdzie. Discoverability wymaga albo sekcji w docs albo hover hint w IDE dla `unpack`.

**K (Reluctant Manual Tester)**: `gfx := namespace Engine::Graphics; gfx::draw();` — czy to naprawdę działa? Napisałbym 4-liniowy test w IDE. Jeśli działa, to fajne. Jeśli nie — wtedy `langDetail.md` §10 powinno to wymienić jako ograniczenie.

---

### Rejected Perspectives' Commentary

**F (Confused Junior)**: Nie wiem co to jest `pack`. Może dokumentacja jest prosta i ja po prostu nie rozumiem. Ale `unpack!` nie jest w żadnym przykładzie `.qlang` — czy to w ogóle jest feature dla użytkowników czy tylko dla kompilatora?

**G (Deletion Wizard)**: `namespace.md` — usunąć. Nie archiwizować, usunąć. Treść implementacyjna jest w `archDetail.md`. Treść językowa powinna być w `langDetail.md`. Archiwum historyczne które i tak nikt nie czyta to hoardowanie dokumentów.

**H (Accidental Manager)**: Status na dokumentach powinien być automatycznie śledzony przez CI. Jeśli nie ma CI, powinien być aktualizowany przy każdym merge'u. Definition of done: zmiana implementacji = zmiana statusu w docs. Backlog: ticket na dodanie docs-check do merge checklist.

### Perspective Summary
`namespace.md` to zombie-proposal: opisuje plan który był już wdrożony przez miesiąc. Powinno być wyraźnie oznaczone jako "zaimplementowane" lub przeniesione do historii — ale krytyczne examples (aliasy namespace) muszą najpierw wylądować w `langDetail.md`. `langExtensionMacro.md` urwał się przy §9.2 i brakuje kompletnego opisu `pack`/`unpack!` który według `changeProposal.md` ma status MVP. Priorytet: (1) status namespace.md, (2) przenieść alias examples do langDetail, (3) sekcja pack w langExtensionMacro.

---

## 6. `archIntro.md` — stara lista plików; `archDetail.md` — drobne luki

### Consensus Leader: D (Senior C++ Abomination)

### Summary
`archIntro.md` (stan 2026-04-12) ma sekcję §3 "Struktura plików" która jest fork'iem §2 w `archDetail.md` z datą 2026-05-13. Różnica: `archIntro.md` nie wymienia: `parser-base.js`, `parser-exprs.js` (parser split na 3 pliki), `type-infer.js`, `ast-renderer.js`, `ast-to-source.js`, `defer-pass.js`, `source-ref.js`, `source-buffer.js`, `vfs.js`, `file-tree.js`, `project-ui.js`, `examples.js`, `source-registry.js`. Lista kompilatora jest z przed-split'u parsera i przed-split'u typecheckera. `archIntro.md` diagnogram pipeline jest niekompletny: nie pokazuje `deferPass`. `archDetail.md` jest najaktualniejszym plikiem projektu i jest w dużej mierze poprawny — drobna luka: §12 Testy regresji nie wymienia `test-ast-renderer.js`, `test-vfs.js`, `test-ide-smoke.js`, `test-ide-ui.js`, `test-ide-logic.js`. Pipeline diagram sekcji §3 używa `typechecker.js` jako label fazy 3 — po refaktorze to barrel file; właściwy plik to `staticTypeChecker.js`, ale to jest wewnętrzna informacja poprawnie wyjaśniona w §6.

### Required Changes
- `archIntro.md` §3 Struktura plików: aktualizacja listy kompilatora (dodać `parser-base.js`, `parser-exprs.js`, `type-infer.js`, `ast-renderer.js`, `ast-to-source.js`, `defer-pass.js`, `source-ref.js`, `source-buffer.js`) i listy IDE (`vfs.js`, `file-tree.js`, `project-ui.js`, `examples.js`)
- `archIntro.md` §2 Pipeline diagram: dodać strzałkę `deferPass(ast)` między `typecheck` a `generate`
- `archIntro.md` zaktualizować datę "Stan na:"
- `archDetail.md` §12: dodać brakujące pliki testowe do listy

### Observations
- `archIntro.md` i `archDetail.md` mają zdublowaną sekcję "Struktura plików" — można rozważyć odesłanie z intro do detail zamiast utrzymywania 2 kopii
- `archDetail.md` §3 diagram pipeline poprawnie pokazuje `deferPass` jako osobną strzałkę — tylko `archIntro.md` tego nie ma
- `archDetail.md` §6 poprawnie dokumentuje split typecheckera (TypeInferBase, TypeChecker, barrel typechecker.js) — nie ma tu błędu, tylko niespójność z diagramem wyżej
- `archIntro.md` wzmiankuje `compiler/pipeline.js` poprawnie i `liveCompile()` — ta część jest aktualna

### Concrete Actions
- `archIntro.md` sekcja compiler — podmienić całą listę plików kompilatora na aktualną z `archDetail.md` (kopiuj, skróć opisy do jednej linii)
- `archIntro.md` sekcja IDE — dodać `vfs.js`, `file-tree.js`, `project-ui.js`, `examples.js` z jednozdaniowym opisem
- `archIntro.md` big picture pipeline — dodać krok między typecheck a generate:
  ```
      ▼  deferPass(ast)     ← defer-pass.js  (rewrite DeferStmt → inline)
  Typed AST (bez DeferStmt)
  ```
- `archDetail.md` §12: uzupełnić listę plików testowych o wszystkie brakujące

### Needs Deeper Analysis
- Czy `archIntro.md` ma sens jako osobny plik skoro `archDetail.md` ma §1 Filozofia i §2 Struktura która jest kompletna? Może `archIntro.md` powinno być po prostu krótkim "quick orientation" (5-10 linii + link) zamiast 114-liniowym plikiem z duplikatami?

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: Lista plików IDE w `archIntro.md` jest najgorsza — nie ma VFS i multi-file project które są największą funkcjonalnością dodaną od ostatniej aktualizacji. Ktoś kto wchodzi do projektu po raz pierwszy dostaje fałszywy obraz że IDE to tylko edytor z podświetlaniem.

**J (Cognitive Scientist)**: Dwa pliki architektoniczne z różnymi datami aktualności to cognitive overload navigation. Użytkownik nie wie który jest "bardziej prawdziwy". Jasna hierarchia: "intro = nawigacja, detail = prawda" musi być explicite w README i na górze każdego pliku.

**A (Assembler Pragmatist)**: Defer pass: jeden krok, jedno wejście, jedno wyjście. Dodanie go do diagramu to dosłownie jedna linia tekstu. Zrób to teraz.

**C (Corporate Java Architect)**: §12 Testy regresji w `archDetail.md` powinno być generowane automatycznie (np. przez skrypt listy `tests/test-*.js`) żeby nie rozjeżdżało się z rzeczywistością. Manual maintenance tabeli = guaranteed drift.

**B (Open-Source Paradigm Challenger)**: Barrel file `typechecker.js` to anti-pattern w Zig/Rust world. W JS to dość normalne. Ale warto to explicite zaznaczyć w docs jako "dla backward compat" żeby przyszły maintainer nie skasował go myśląc że to dead code.

---

### Rejected Perspectives' Commentary

**G (Deletion Wizard)**: Usunąć `archIntro.md`, sekcja "Quick orientation" w README wystarczy. Dwa pliki = dwa miejsca do aktualizacji = gwarantowany drift. `archDetail.md` ma już §1 Filozofia które jest lepszym intro.

**E (Lisp/Haskell Pipeline Fanatic)**: Pipeline diagram powinien pokazywać typy na każdej strzałce — `Source → Token[] → AST → TypedAST → DeferAST → WatModule + SSpans → Bytes + Spans`. To jest precyzyjny opis przepływu danych. Obecny diagram mówi "co się dzieje" ale nie "jakie typy przepływają".

**F (Confused Junior)**: Skąd mam wiedzieć kiedy czytać `archIntro.md` a kiedy `archDetail.md`? README mówi: najpierw intro, potem detail. OK, ale intro jest stare. Czytam stare intro → mam stary obraz → czytam detail → muszę "odczynnić" to co przeczytałem. Może najpierw dać warning w intro że detail jest bardziej aktualny?

### Perspective Summary
`archIntro.md` jest 30+ dni za `archDetail.md` — dwie najbardziej zauważalne luki to: pominięty split parsera (3 pliki zamiast 1) i brak `deferPass` w diagramie pipeline. To nie są kosmiczne zmiany a efekt jest taki że dokument daje fałszywy obraz architektury. `archDetail.md` jest w dobrej kondycji z drobnymi lukami w liście testów. Strategicznie: rozważyć czy `archIntro.md` w ogóle ma rację bytu jako osobny plik — alternatywnie to mógłby być jeden akapit "quick overview" w README.

---

## 7. `ide.md` — marginalnie nieaktualny; `wayOfWork.md` — tabela komponentów stara

### Consensus Leader: D (Senior C++ Abomination)

### Summary
`ide.md` jest najaktualniejszym plikiem dokumentacyjnym (stan 2026-05-13) i pokrywa wszystkie istotne feature IDE w tym multi-file project, VFS, debugger, hover, autocomplete, breakpoints. Drobna nieaktualność: §2 editor wzmiankuje parametr `lastErrorRange` przekazywany z Tab/Shift+Tab do `applyHighlight()` — po przejściu na canonical-ref highlights `lastErrorRange` może być martwym parametrem. `wayOfWork.md` §11 tabela "Istniejące komponenty" nie zawiera `<qlang-file-tree>` i nie ma zaktualizowanego API `<qlang-console>` (plik opisuje `log()`, `clear()` ale nie `write()`, `startInput(cb)`, `cancelInput()`). `<qlang-source-view>` w tabeli nie pokazuje pełnego API (brakuje `getEditorLine`, `setSelectionRange`, `getSelectionOffsets`). Ponieważ `wayOfWork.md` to filozofia i meta-zasady, lista komponentów jest tam semantycznie nie na miejscu i powinna zostać przeniesiona do `ide.md`.

### Required Changes
- `wayOfWork.md` §11 tabela komponentów: dodać `<qlang-file-tree>` z API `setFiles()`, zdarzeniami `ft-file-*`, `ft-project-*`
- `wayOfWork.md` §11: zaktualizować `<qlang-console>` API o `write()`, `startInput(cb)`, `cancelInput()`
- `wayOfWork.md` §11 lub `ide.md`: przenieść tabelę komponentów do `ide.md` — `wayOfWork.md` to zasady pracy, nie reference do API

### Observations
- `ide.md` §2 wzmiankuje `lastErrorRange` przy Tab key — weryfikacja w `main.js`/`editor.js` czy ten parametr jest nadal przekazywany, czy usunięty po canonical-ref refaktorze
- `ide.md` §2 wzmiankuje `execCommand('insertText', ...)` dla auto-indent — `execCommand` jest deprecated w modern browsers (Firefox/Chrome ostrzegają w konsoli); to implementacyjna kwestia, nie doc-kwestia, ale warta notatki
- `ide.md` jest jedynym plikiem który poprawnie dokumentuje SharedArrayBuffer 7-state protocol — ta informacja jest krytyczna dla przyszłego maintainera debuggera
- `wayOfWork.md` §10 "skupiaj sie bardziej na testach smoke'owych" — spójne z istniejącym `test-ide-smoke.js`

### Concrete Actions
- Dodać do `wayOfWork.md` §11 tabeli: `<qlang-file-tree>` row
- Zaktualizować `wayOfWork.md` §11 `<qlang-console>` API: `write(text)`, `log(msg)`, `clear()`, `startInput(cb)`, `cancelInput()`
- Dodać notę w `ide.md` §2 editor przy auto-indent: "Implementacja przez `execCommand` (deprecated) — kandydat do zastąpienia `insertText`-based API"

### Needs Deeper Analysis
- `lastErrorRange` w Tab handler — czy `applyHighlight()` bez argumentów (po canonical-ref zmianach) nadal przyjmuje `lastErrorRange`? Jeśli nie, parametr jest redundantny w opisie

---

### Best Value to Noise Perspectives' Commentary

**D (Senior C++ Abomination)**: `ide.md` jest w dobrej kondycji — najrzadziej widuje się dokumentację IDE która faktycznie opisuje wewnętrzny protocol współdzielonej pamięci. SharedArrayBuffer 7-state protocol jest dobrze udokumentowany. Nie psuć.

**J (Cognitive Scientist)**: Przenosiny tabeli komponentów z `wayOfWork.md` do `ide.md` to właściwy ruch — "zasady pracy" i "reference API" to różne cognitive contexts. Użytkownik szukający jak używać `<qlang-console>` nie szuka go w pliku o filozofii projektu.

**A (Assembler Pragmatist)**: `execCommand` deprecated — prawda. Ale działa. Nie naprawiać dopóki nie zepsute. Nota w docs wystarczy.

**C (Corporate Java Architect)**: API dokumentacja komponentów powinna mieć tabelę: metoda, parametry, return, zdarzenia. Obecny format to niestrukturyzowany opis. Dla 8 komponentów structured table byłaby wielokrotnie bardziej użyteczna.

**K (Reluctant Manual Tester)**: `startInput(cb)` w `<qlang-console>` — czy `cb` jest wywoływane z całym stringiem czy z poszczególnymi znakami? Dokumentacja nie mówi. Assumption bug.

---

### Rejected Perspectives' Commentary

**G (Deletion Wizard)**: §10 w `ide.md` — "→ Patrz archDetail.md sekcja 9 — dokumentacja renderowania bytecode" — to jest stub, nie dokumentacja. Albo napisać sekcję w `ide.md`, albo usunąć reference i przenieść opis do `archDetail.md` where it linki bezpośrednio.

**E (Lisp/Haskell Pipeline Fanatic)**: `highlight.js` jest opisany jako "koordynator" — ale nie ma diagrama przepływu zdarzeń. Kto wywołuje `highlightAndScrollSource`? Kto wywołuje `clearAll`? Bez event flow diagram to jest lista metod bez kontekstu.

**H (Accidental Manager)**: Backlog: (1) przenieść tabelę komponentów, (2) zaktualizować API, (3) nota o execCommand. Trzy godziny pracy razem. Done criteria: `wayOfWork.md` nie zawiera implementation reference, `ide.md` ma kompletną tabelę komponentów.

### Perspective Summary
`ide.md` jest w najlepszej kondycji ze wszystkich plików dokumentacyjnych — jedyna akcja to drobne korekty i nota o `execCommand`. `wayOfWork.md` ma stale komponentów która jest miejscem semantycznie złym (filozofia pracy ≠ API reference) i jest 1 iterację za aktualnością. Kluczowe: przenieść tabelę do `ide.md`, zaktualizować API `<qlang-console>` i dodać `<qlang-file-tree>`.

---

## 8. `README.md` — entry point kłamie; `docs/history/` — jeden otwarty status

### Consensus Leader: B (Open-Source Paradigm Challenger)

### Summary
`README.md` jest minimalistyczny i dobry — ale jeden krytyczny błąd: "*Open `index.html` in a browser*" nie działa bez `SharedArrayBuffer` który wymaga COOP/COEP headers, a te są serwowane tylko przez `node start.js`. Użytkownik otwierający `index.html` bezpośrednio dostanie błąd instancjacji WASM (lub cichy brak input/debugger). `docs/history/changeProposal.md` item 1 (two-pass typecheck/expand) nie ma żadnej `STATUS:` noty mimo że items 2, 3, 4, 5, 9 mają. Item 7 (slice) i 8 (generics) są explicite deferred. Item 1 wygląda więc jak "w toku" gdy de facto jest też deferred. `docs/history/resilientParserPlan.md` jest kompletnie zarchiwizowanym dokumentem — wszystkie milestony M0–M9 ✅. `changeProposal.md` item 4 (void) ma `STATUS: PARTIALLY IMPLEMENTED — discard warning not yet added` — to jest nadal aktualne.

### Required Changes
- `README.md`: zmienić "*Open `index.html` in a browser*" na:
  ```
  ## Development server
  node start.js   — starts server with COOP/COEP headers (required for SharedArrayBuffer)
  Then open: http://localhost:PORT
  
  Direct file:// access does not work (missing SharedArrayBuffer headers).
  ```
- `changeProposal.md` item 1: dodać `> STATUS: DEFERRED — requires scope-snapshot at MacroCallStmt; deferred until macro system is more stable.`

### Observations
- `README.md` reading order nie wymienia `wayOfWork.md`, `namespace.md`, `langExtensionMacro.md` — to jest świadoma decyzja (nie alle-hands dokumenty w README) czy przeoczenie? Prawdopodobnie świadoma — OK
- `changeProposal.md` item 4 (void) — partial: `void` i `return;` zaimplementowane, discard warning NIE. To jest bug-worthy future task — można dodać jako Concrete Action w osobnym issue
- `changeProposal.md` item 6 (`T::of` reserved) jest documentation-only change — nadal aktualny i nie wymaga kodu
- `resilientParserPlan.md` jest czystą historią — nic do zmiany

### Concrete Actions
- `README.md`: zaktualizować sekcję "Entry point" z instrukcją uruchomienia przez `node start.js`
- `changeProposal.md` item 1: dodać STATUS: DEFERRED note
- `changeProposal.md` item 4: zaktualizować STATUS na: `STATUS: MOSTLY IMPLEMENTED — void return type, return;, void codegen live. Discard warning (ExprStmt non-void) still missing.`

### Needs Deeper Analysis
- Czy `start.js` serwuje na stałym porcie? README nie podaje portu — sprawdzić `start.js` i podać w README.

---

### Best Value to Noise Perspectives' Commentary

**B (Open-Source Paradigm Challenger)**: README jako kontrakt z użytkownikiem — "open index.html" jest złamanym kontraktem. Pierwsze 5 minut projektu jest zdeterminowane przez README. Naprawić przed wszystkim innym.

**K (Reluctant Manual Tester)**: Otwierałem `index.html` bezpośrednio i nie działał debugger — dokładnie to co council opisuje. To jest assumption bug numer 1 w projekcie. Nowy użytkownik zakłada że "plik HTML = otwórz w przeglądarce". Nie tutaj.

**J (Cognitive Scientist)**: README jest gateway document — 6 linii o strukturze, 3 linii o testach, 2 linijki o entry point. Krótki README jest dobry. Ale te 2 linijki o entry point są błędne. One mistake in the first thing they read.

**A (Assembler Pragmatist)**: `start.js` — sprawdzić port. Jeśli hardcoded to dać wprost w README. Jeśli dynamiczny — dać `node start.js` i powiedzieć że wypisze port.

**D (Senior C++ Abomination)**: `changeProposal.md` item 1 (two-pass) — to jest architecturally highest-value deferred feature. Kiedy to wdrożymy, `typeof(x)` w `#if` stanie się możliwe i system makr skoczy o order of magnitude. Warto zostawić jako "deferred" z explicite powodem dlaczego jeszcze nie.

---

### Rejected Perspectives' Commentary

**G (Deletion Wizard)**: `docs/history/changeProposal.md` — usunąć. Historia decyzji jest w gitlogu. Utrzymywanie tego pliku to cargo cult archiwizacji.

**H (Accidental Manager)**: README powinno mieć sekcję "Contributing" z linkiem do `wayOfWork.md`. Done criteria dla każdego PR: aktualizacja docs, aktualizacja tests, aktualizacja README jeśli zmiana entry point.

**C (Corporate Java Architect)**: `changeProposal.md` powinno mieć structured YAML header: `status: deferred|implemented|open|cancelled` per item. Wtedy automatycznie parsowalne. Markdown table z kolumnami jest minimum.

### Perspective Summary
README ma jeden krytyczny błąd który uderza każdego nowego użytkownika: `index.html` w file:// nie działa bez serwera. To jest fix który można zrobić w 3 minuty i powinien być zrobiony natychmiast. `changeProposal.md` item 1 (two-pass typecheck) powinno dostać STATUS: DEFERRED żeby status był spójny z innymi itemami w pliku. Reszta docs/history jest albo poprawnie zarchiwizowana (resilientParserPlan) albo ma aktualne notatki statusu.

---

## Council Verdict — Sesja 2026-05-13

### 3 Big Bets
1. **Naprawić `langDetail.md` i `langIntro.md`** — brakujący `defer`, `break`, `pack`/`unpack!`, literały znakowe; krytyczny błąd faktyczny `arr[i]` → `arr.[i]`; te pliki są głównymi referencjami języka i muszą być aktualne
2. **Zakończyć `namespace.md` jako zombie-proposal** — zmienić status na ZAIMPLEMENTOWANE lub przenieść do `docs/history/`; przenieść examples alias namespace do `langDetail.md`
3. **README entry point fix** — 3-minutowa zmiana która eliminuje confusion każdego nowego użytkownika

### 3 Things to Keep
1. **`archDetail.md`** jako primary source of truth o architekturze — najaktualniejszy, najdokładniejszy, pokrywa all layers; drobne aktualizacje wystarczą
2. **`ide.md`** jako wyjątkowo dobry przykład IDE documentation — SharedArrayBuffer protocol, autocomplete trzy tryby, breakpoint semantics — rzadko spotykana jakość
3. **`changeProposal.md`** w `docs/history/` jako decision log — invaluable dla przyszłych maintainerów którzy będą pytać "dlaczego tak nie zrobiliśmy" przy item 1 (two-pass), 7 (slice), 8 (generics)

### 3 Things to Kill
1. **`arr[i]` w przykładach dokumentacji** — stara składnia, już usunięta z parsera, natychmiastowy grep i podmiana
2. **"Stan na: 2026-04-12"** jako data w `langDetail.md`, `langIntro.md`, `archIntro.md` — daty które kłamią są gorsze niż brak dat; albo aktualizować przy każdej zmianie albo usunąć z headerów
3. **Tabela komponentów w `wayOfWork.md`** — semantycznie nie na miejscu (filozofia pracy ≠ API reference), stale, przenieść do `ide.md`
