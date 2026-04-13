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
