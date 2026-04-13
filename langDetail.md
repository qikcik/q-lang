# QLang — Specyfikacja Szczegółowa

> Stan na: 2026-04-12 (aktualizacja: **`else if`**, **unary minus (`-expr`)**, `void`, `arr.[i]` BracketAccessExpr jako jedyna składnia, `pack`/`#expand`, `T::of/default`, makra; **strukty** — Item 13; **namespace'y** — Item 13; **literały znakowe `'x'`** i **konkatenacja sąsiednich string literals**)
> Iteracyjnie uzupełniana przy każdym zrealizowanym todo.
> Wprowadzenie i przegląd: [langIntro.md](langIntro.md)

---

## 1. Ogólne założenia

- Język kompilowany do WebAssembly (WASM MVP)
- Silne, statyczne typowanie z inferencją typów
- Składnia LL(2) — parsowanie od lewej do prawej bez backtrackingu
- Brak garbage collectora — zarządzanie pamięcią przez programistę (wskaźniki, tablice na stosie)
- Zmienne i stałe parsowane od lewej do prawej
- Brak null terminatorów, brak implicit coercji między typami

---

## 2. Typy wbudowane

### 2.1 Typy skalarne (mapowane na prymitywy WASM)

| Typ języka | WASM valtype | Uwagi |
|---|---|---|
| `i8`, `u8` | `i32` | sub-word, przechowywany jako i32 w WASM |
| `i16`, `u16` | `i32` | sub-word, przechowywany jako i32 w WASM |
| `i32`, `u32` | `i32` | |
| `i64`, `u64` | `i64` | |
| `f32` | `f32` | |
| `f64` | `f64` | |
| `bool` | `i32` | `true` = 1, `false` = 0 |

### 2.2 Typy wskaźnikowe

```
ptr<T>         — const wskaźnik do const wartości typu T (i32 w linear memory)
ptr<mut T>     — const wskaźnik do mutowalnej wartości (można pisać przez p.*)
mut ptr<T>     — mutowalny wskaźnik do const wartości (można przypisać nowy adres)
mut ptr<mut T> — mutowalny wskaźnik do mutowalnej wartości
```

Deklaracja:
```
p : ptr<i32> = &x;
```

Dereferencja (postfixowy operator `.*`):
```
v := p.*;           // odczyt wartości spod wskaźnika
```

> **Prefix `*p` nie istnieje** — dereferencja jest zawsze postfixowa (`p.*`). Dzięki temu wywołania przez wskaźniki na funkcje są liniowe: `fptr.*(args)` zamiast `(*fptr)(args)`.

### 2.3 Typy funkcyjne (function pointer)

```
ptr<fn(params) RetType>     — wskaźnik na funkcję
```

Deklaracja i wywołanie:
```
double := fn(n: i32) i32 { return n + n; };
fptr : ptr<fn(n: i32) i32> = &double;   // wskaźnik na funkcję
res := fptr.*(5);                        // wywołanie przez wskaźnik → 10
```

- `&funcName` zwraca indeks funkcji w tabeli WASM (typ `ptr<fn ...>`)
- `fptr.*(args)` dereferencjonuje wskaźnik i wywołuje funkcję (`call_indirect`)
- Nazwa parametru w typie jest opcjonalna: `ptr<fn(i32) i32>` = `ptr<fn(n: i32) i32>`
- Sygnatury muszą się zgadzać (typy parametrów i typ zwracany)

### 2.4 Typy tablicowe

```
array<T, N>         — const tablica N elementów T (elementy i binding są const)
array<mut T, N>     — const tablica z mutowalnymi elementami
mut array<mut T, N> — mutowalna tablica z mutowalnymi elementami
```

Inicjalizacja (wymaga jawnej adnotacji dla `mut`):
```
fib : array<i32, 5> = {1, 1, 2, 3, 5};              // const tablica, const elementy
slots : array<mut i32, 4> = {0, 0, 0, 0};            // const tablica, mut elementy
buf : mut array<mut i32, 4> = {10, 20, 30, 40};      // mut tablica, mut elementy
msg : array<u8, 5> = "hello";                        // const tablica, const elementy
```

Dostęp do elementu (odczyt):
```
v := arr.[i];    // BracketAccessExpr: jedyna składnia dostępu do elementu
```

Zapis do elementu (tylko gdy element `mut`):
```
slots.[0] = 99;  // OK: array<mut i32, 4>
fib.[0]   = 0;   // [Type] Error: Cannot assign to element of const array
```

Nadpisanie całej tablicy (wymaga `mut` na binding):
```
nums : mut array<mut i32, 3> = {1, 2, 3};
nums = {10, 20, 30};   // OK — binding jest mut, tablica nadpisana nowymi wartościami
```

Własność `.size` — **const** stała kompilacji (zawsze):
```
n := arr.size;   // const u32, równa N — znana w compile-time
```

Adres pierwszego elementu:
```
p : ptr<u8> = &arr;   // const ptr<u8> — adres bazowy
```

Tablica jest reprezentowana jako adres bazowy (`i32`) w linear memory.  
Rozmiar jest znany w compile-time i nie jest przechowywany w runtime.

---

### 2.5 Typy strukturalne (`struct`)

```
Vec2 := struct { x: i32; y: i32; };
```

Deklaracja struktury tworzy nowy typ `Vec2`. Pola są domyślnie **const**; oznaczone `mut` stają się mutowalne:

```
Counter := struct {
    id:    i32;           // równoważne z:  id: i32 = i32::default  →  0
    n:  mut i32 = 10;     // jawna wartość domyślna: n = 10
};
```

Pole bez jawnej inicjalizacji (`id: i32;`) jest równoważne `id: i32 = T::default` dla danego typu:

| Typ pola | Wartość `T::default` |
|---|---|
| `i8..u64` | `0` |
| `f32`, `f64` | `0.0` |
| `bool` | `false` |
| `SomeStruct` | zeroizacja pól rekurencyjnie |

Działa zarówno dla typów wbudowanych, jak i typów użytkownika (innych struktur).

Dostęp do pól (`MemberExpr`):
```
main := fn(v: Vec2) i32 {
    return v.x;       // odczyt pola
};
```

Zapis do pola (wymaga `mut` na polu):
```
update := fn(v: Vec2) void {
    v.n = v.n + 1;    // OK: pole 'n' jest mut
    // v.id = 5;      // [Type] Error: const field
};
```

Konstruktory struktury:
```
v1 : Vec2 = Vec2::default;        // wszystkie pola zerowe (0, 0.0, false)
v2 : Vec2 = Vec2::of(3, 7);       // podanie wartości pól w kolejności deklaracji
```

**Układ pamięci** (linear memory, natural alignment):
- Pola ułożone kolejno, z wyrównaniem `min(field_byte_size, 4)` bajtów
- `i32`/`u32` → 4 bajty, wyrównanie 4
- `f64`/`i64` → 8 bajtów, wyrównanie 4 (maksymalne wyrównanie = 4)
- `i8`/`u8` → 1 bajt, wyrównanie 1
- `i16`/`u16` → 2 bajty, wyrównanie 2
- Rozmiar całej struktury = suma pól z wstawionym paddingiem

**Przekazywanie przez funkcje**: argument struktury jest przekazywany jako `i32` — adres bazowy w linear memory.

---

## 3. Deklaracje i zmienne

Zmienne są domyślnie niemodyfikowalne. Operacje zapisu wymagają jawnej adnotacji `mut` w typie.

### 3.1 Zmienne

Wartości zmiennych nie można zmienić po inicjalizacji:

```
x := 5;         // i32 (inferred)
y : i32 = 10;   // i32 (explicit)
ok := true;     // bool
```

Próba przypisania jest **błędem kompilacji**:

```
x := 5;
x = 10;   // [Type] Error: Cannot assign to const variable 'x'
```

Nie ma możliwości przypisania przez `=` ani przez `[]`.

### 3.2 Zmienne mutowalne (`mut`)

Aby zmienna była mutowalna, należy podać pełną adnotację z `mut` przed typem:

```
x : mut i32 = 5;
x = 10;           // OK
x = x + 1;        // OK
```

> Forma inferred (`x := expr`) nie przyjmuje `mut` — jeśli potrzebujesz zmiennej mutowalnej, zawsze podaj pełny typ z `mut`.

### 3.3 Tablice: mut na dwóch poziomach

Tablica ma **dwa poziomy mutability**:
- **Outer `mut`** — czy binding (zmienna wskazująca na tablicę) jest mutowalny
- **Inner `mut` na elemencie** — czy elementy można modyfikować przez `[]`

```
// const tablica, const elementy — nic nie można modyfikować
fib : array<i32, 5> = {1, 1, 2, 3, 5};

// const tablica, mut elementy — można pisać przez [], ale nie przypisać całej tablicy
slots : array<mut i32, 4> = {0, 0, 0, 0};
slots[0] = 99;     // OK

// mut tablica, mut elementy — pełna mutowalność
buf : mut array<mut i32, 3> = {0, 0, 0};
buf[1] = 42;       // OK

// mut tablica, const elementy — binding mutowalny, ale [] jest const
// (użyteczne przy przyszłych wektorach / dynamic arrays — nadpisanie całej tablicy bez mutacji elementów)
data : mut array<i32, 3> = {1, 2, 3};
// data[0] = 5;    // [Type] Error: Cannot assign to element of const array
```

> **Nota**: Podwójny poziom `mut` (`mut array<mut T, N>`) może wydawać się nadmiarowy dla tablic o stałym rozmiarze, ale ta mechanika będzie kluczowa przy przyszłych wektorach (dynamic arrays), gdzie `mut` na binding pozwala na `push`/`pop`/`resize`, a `mut` na elemencie kontroluje zapis przez indeks.

### 3.4 Stringi i literały tablicowe

```
msg := "hello";        // const array<u8, 5> — elementy const
arr := {1, 2, 3};      // const array<i32, 3> — elementy const
```

Modyfikacja elementów literałów inferred jest błędem kompilacji. Żeby mieć mutowalną tablicę, wymagana jest jawna adnotacja:

```
buf : mut array<mut u8, 5> = "hello";
buf[0] = 72;   // OK — 'H'
```

### 3.5 Zakaz shadowingu

Deklaracja zmiennej o tej samej nazwie co jakakolwiek zmienna w tym lub zewnętrznym scope jest **błędem kompilacji** — shadowing jest całkowicie zakazany:

```
x := 5;
x := 10;     // [Type] Error: 'x' is already declared in this scope

main := fn() i32 {
    x := 3;  // [Type] Error: 'x' shadows an outer declaration
};
```

Dotyczy to również anonimowych bloków scope (patrz 3.11).

Każda nazwa musi być unikalna w obrębie całego widocznego leksykalnego zakresu.

### 3.6 Parametry funkcji

Parametry są niemodyfikowalne. Mutowalny parametr wymaga `mut` w jego typie:

```
func := fn(n: i32) i32 {
    // n = n + 1;   // Error: const param
    copy : mut i32 = n;
    copy = copy + 1;
    return copy;
};

funcMut := fn(n: mut i32) i32 {
    n = n + 1;   // OK — param mutowalny
    return n;
};
```

### 3.7 Inferencja typów

```
x := 5;           // i32
y := 3.14;        // f64
z := true;        // bool
```

| Literał | Inferowany typ |
|---|---|
| Całkowity (np. `5`) | `i32` |
| Zmiennoprzecinkowy (np. `3.14`) | `f64` |
| Boolean (`true`/`false`) | `bool` |
| Znak (np. `'A'`) | `u8` |
| Adres (`&x` gdzie `x: T`) | `ptr<T>` (wartość tymczasowa) |
| Literał tablicowy `{e,...}` | `array<T, N>` z niemodyfikowalnymi elementami |
| Literał String `"abc"` | `array<u8, N>` z niemodyfikowalnymi elementami |

### 3.8 Explicit typing i wskaźniki

```
x : i32 = 5;              // const
x : mut i32 = 5;          // mutable
p : ptr<i32> = &x;        // const wskaźnik (binding const)
p : mut ptr<i32> = &x;    // mutable wskaźnik (binding mutable — można przypisać nowy adres)
p : ptr<mut i32> = &x;    // const wskaźnik do mutowalnej wartości
```

### 3.9 Konwerter typów (`as`)

```
y := as<f32>(x);   // wartość tymczasowa typu f32
```

`as` to **konwerter typów dla typów skalarnych** (int, float, bool). Produkuje **wartość tymczasową** — nie jest zmienną. Wynik można przypisać do zmiennej (const lub mut).

**Ograniczenia:**
- Działa na typach skalarnych (int, float, bool) oraz na **array decay** (patrz niżej)
- Nie obsługuje wskaźników jako źródła (`ptr<T>` → cokolwiek)
- `mut` w typie docelowym (`as<mut i32>(x)`) jest **błędem** — as nie tworzy zmiennych

**Reguły konwersji:**
- `int` ↔ `int` (dowolne szerokości): zawsze dozwolone
- `float` ↔ `float`: zawsze dozwolone
- `int` ↔ `float`: zawsze dozwolone
- `bool` ↔ `int`: zawsze dozwolone (bool jest `i32` w WASM)
- `bool` ↔ `float`: zawsze dozwolone (przez pośrednią konwersję i32)
- `array<T, N>` → `ptr<T>`: dozwolone gdy typ elementu zgadza się z inner type wskaźnika (**array decay**)

**Array decay przez `as`:**
```
arr : array<i32, 3> = {1, 2, 3};
p := as<ptr<i32>>(arr);   // OK: decay — p wskazuje na pierwszy element
```
Jest jedynie skrótem dla `&arr` — zwraca adres bazowy tablicy. Przydatne gdy zmienna tablicowa
jest już wyrażeniem złożonym (np. wynikiem makra) i nie ma na nią nazwy jako l-value.
Niezgodność typów elementu i wskaźnika jest **błędem kompilacji**:
```
arr : array<i32, 3> = {1, 2, 3};
p := as<ptr<u8>>(arr);    // [Type] Error: element type mismatch
```
### 3.10 Konstruktory typów (`T::of`, `T::default`)

Konstruktory są dostępne dla typów skalarnych i struktur:

**Skalary:**
```
x := i32::of(3.7);          // tworzy wartość i32 z argumentu (z konwersją jeśli potrzeba)
z := i32::default;          // wartość zerowa: 0 dla int, 0.0 dla float, false dla bool
```

**Struktury:**
```
v : Vec2 = Vec2::default;         // wszystkie pola zerowe
v : Vec2 = Vec2::of(3, 7);        // pola w kolejności deklaracji: x=3, y=7
```

- `T::of(v)` dla skalara — odpowiednik `as<T>(v)` z explicitly constructor-oriented semantics
- `T::of(a, b, ...)` dla struktury — inicjalizuje pola w kolejności deklaracji; liczba i typy argumentów muszą pasować
- `T::default` — zero/domyślna wartość: `0` / `0.0` / `false` dla skalara; dla struktury — każde pole otrzymuje wartość z jawnej inicjalizacji pola lub `T::default` jeśli jej nie ma (tzn. `id: i32;` ≡ `id: i32 = i32::default`)
- Obsługiwane typy: skalary (`i8..u64`, `f32`, `f64`, `bool`) oraz user-defined struktury

### 3.11 Anonimowy blok scope (`ScopeBlock`)

Blok `{ ... }` może wystąpić samodzielnie jako statement — tworzy nowy leksykalny scope:

```
main := fn() i32 {
    r : mut i32 = 0;
    {
        tmp := 42;  // widoczne tylko w tym bloku
        r = tmp;
    }
    // tmp tutaj niewidoczne — [Type] Error: Undefined identifier 'tmp'
    return r;   // 42
};
```

- Pusty blok `{ }` jest poprawny
- Zmienne z zewnętrznego scope są dostępne wewnątrz (można modyfikować `mut`)
- Shadowing wciąż nielegalne — patrz 3.5
- W WASM blok nie ma odpowiednika — służy tylko jako granica leksykalna w kompilatorze
---

## 4. Wyrażenia logiczne

### 4.1 Short-circuit evaluation

Operatory `&&` i `||` korzystają z **short-circuit evaluation** — prawy operand nie jest ewaluowany, jeśli wynik został już zdeterminowany przez lewy operand:

```
true || expensive_func()   // expensive_func() NOT called — wynik to true
false && expensive_func()  // expensive_func() NOT called — wynik to false
```

To zabezpiecza przed ewaluacją wyrażeń, które mogą dereferencjonować nieważne wskaźniki lub wykonywać operacje o skutkach ubocznych, gdy nie są potrzebne.

---

## 5. Funkcje

### 5.1 Składnia

```
name := fn(param1: Type1, param2: Type2) RetType {
    // ciało
};
```

Przykład:
```
add := fn(a: i32, b: i32) i32 {
    return a + b;
};
```

Słowo kluczowe `fn` jest **wymagane** — jednoznacznie identyfikuje deklarację funkcji (bez konieczności lookahead w parserze).

### 5.2 Zasady

- Parametry muszą mieć jawnie podany identyfikator i typ (eliminuje niejednoznaczność parsowania)
- Typ zwracany jest jawny
- Instrukcja `return` wymagana dla typów innych niż `void`
- Funkcje są eksportowane do WASM exports automatycznie
- Binding funkcji jest **zawsze const** — nie można przypisać nowej wartości do nazwy funkcji
- Parametry są **const** domyślnie — mutowalny parametr wymaga `name: mut T`

### 5.3 Typ zwracany `void`

`void` oznacza brak wartości zwracanej. Funkcja nie emituje `[result ...]` w WASM i nie wymaga instrukcji `return`:

```
log := fn(x: i32) void {
    // efekt uboczny; brak return
};

flush := fn() void {
    return;   // jawny pusty return jest dozwolony
};

main := fn() i32 {
    log(42);   // wywołanie void-funkcji jako statement — bez ostrzeżenia
    return 0;
};
```

Próba zwrócenia wartości z funkcji `void` jest błędem:
```
bad := fn() void { return 42; };   // [Type] Error: Void function must not return a value
```

### 5.4 Lokalne funkcje

Funkcja może być zadeklarowana wewnątrz innej funkcji lub bloku:

```
main := fn() i32 {
    double := fn(x: i32) i32 {
        return x + x;
    };
    return double(5);   // 10
};
```

- Lokalna funkcja jest widoczna **po** jej deklaracji (nie jest hoistowana w bloku)
- Implementacja: **lambda-lifting** — kompilator wyciąga lokalną funkcję do poziomu modułu WASM; brak closureu (zmienne zewnętrznego zakresu nie są przechwytywane)
- W autocomplete pojawia się z podpowiedzią typu, np. `double: (i32) → i32`
- Składnia identyczna z deklaracją top-level

### 5.4 Wskaźniki na funkcje

Adres funkcji można pobrać przez `&` i przechowywać w `ptr<fn ...>`:

```
double := fn(n: i32) i32 { return n + n; };
fptr : ptr<fn(n: i32) i32> = &double;
res := fptr.*(5);   // 10 — wywołanie przez wskaźnik
```

- `&funcName` zwraca indeks w tabeli WASM (typ `ptr<fn(params) RetType>`)
- `fptr.*(args)` dereferencjonuje wskaźnik i wywołuje funkcję (`call_indirect`)
- Nazwa parametru w typie jest opcjonalna: `ptr<fn(i32) i32>` = `ptr<fn(n: i32) i32>`
- Sygnatury muszą się zgadzać — typy parametrów i typ zwracany
- **Nie można** brać adresu funkcji wbudowanej (`&ext__printLn` jest błędem)

### 5.5 Namespace `ext` — zewnętrzne funkcje runtime

Namespace `ext` jest **zarezerwowany** i nie może być nadpisany przez kod użytkownika.
Zawiera funkcje mapowane na importy WASM z modułu `env`:

| Sygnatura | Opis | Import WASM |
|---|---|---|
| `ext::print(buf: ptr<u8>, len: u32) void` | Wypisuje `len` bajtów UTF-8 z adresu `buf` — bez znaku nowej linii | `env.write_utf8` |
| `ext::printLn(buf: ptr<u8>, len: u32) void` | Wypisuje `len` bajtów UTF-8 z adresu `buf`, a następnie `\n` | `env.print_utf8` |
| `ext::input(buf: ptr<mut u8>, len: u32) u32` | Wczytuje dane od użytkownika do `buf` (maks. `len` bajtów), zwraca liczbę zapisanych bajtów | `env.input_utf8` |

Przykład użycia:

```
main := fn() void {
    // ext::print — zapis bez nowej linii; \n musi być w buforze
    msg : array<u8, 7> = "Hello!\n";
    ext::print(&msg, msg.size);

    // ext::printLn — automatyczna nowa linia
    label : array<u8, 5> = "Name:";
    ext::printLn(&label, label.size);

    // wczytanie i echo
    buf : array<mut u8, 8> = { 0, 0, 0, 0, 0, 0, 0, 0 };
    n := ext::input(&buf, 8);
    ext::print(&buf, n);
};
```

- `&buf` — adres bazowy tablicy (typ `ptr<u8>` lub `ptr<mut u8>`)
- `buf.size` — stała kompilacji `u32` równa liczbie elementów tablicy
- namespace `ext` nie może być deklarowany ani rozszerzany przez kod użytkownika

### 5.6 Makra (pełna specyfikacja)

Pełna specyfikacja systemu makr (higieniczne, token-substitution, faza 2.5 pipeline): [langExtensionMacro.md](langExtensionMacro.md)

Skrót:

```
inc := macro(x : ident) { @x = @x + 1; };
main := fn() i32 {
    n : mut i32 = 0;
    inc!(n);     // → n = n + 1;
    return n;    // 1
};
```

- Makra rozwijane po `parse()`, przed `typecheck()` — typ-safe po rozwinięciu
- Parametry: `expr` (opakowywany w `()`), `ident`, `block`, `type`, `any`
- Gensym `$name` — unikalna nazwa per wywołanie
- Stringify `#param` — tekst argumentu jako `array<u8, N>`

---

## 6. Wyrażenia

### 6.1 Operatory arytmetyczne

`+`, `-`, `*`, `/` — wymagają obu operandów tego samego typu numerycznego.  
Integer division: zaokrąglenie w kierunku zera (`div_s` w WASM).

### 6.2 Operatory unarne

| Operator | Znaczenie |
|---|---|
| `&expr` | Adres-of: zwraca `ptr<T>` gdzie `expr : T`; dla tablic zwraca `ptr<elemT>` (adres bazowy); dla funkcji zwraca `ptr<fn ...>` (indeks w tabeli) |
| `expr.*` | Dereferencja (postfix): zwraca `T` gdzie `expr : ptr<T>`; przy `ptr<fn>` dereferencja + `()` = wywołanie. Może być celem przypisania: `p.* = val` gdy `p : ptr<mut T>` |
| `!expr` | Logiczne NIE: wymaga `bool` → zwraca `bool` |
| `-expr` | Negacja arytmetyczna: wymaga typu numerycznego (`i32`, `u8`, `u16`, `u32`, `f64`) → zwraca ten sam typ. Np. `-1`, `-x`, `-(a + b)` |

### 6.3 Operatory indeksowania i dostępu do składowej

| Operator | Znaczenie |
|---|---|
| `arr.[i]` | Dostęp do elementu tablicy lub wskazanej wartości przez wskaźnik; `i` musi być int |
| `arr.size` | Stała kompilacji `u32` równa rozmiarowi tablicy `N`; dostępna tylko dla `array<T, N>` |

### 6.4 Operatory porównania

`==`, `!=`, `<`, `>`, `<=`, `>=` — oba operandy muszą być tego samego typu numerycznego (lub `bool` dla `==`/`!=`); wynik to zawsze `bool`.

> **Zakaz**: `==` i `!=` są **niedozwolone dla typów `f32` i `f64`** — porównywanie floatów przez równość jest semantycznie mylące ze względu na IEEE 754 (NaN ≠ NaN). Użyj porównań z epsilon lub jawnych comparatorów.
>
> ```
> x : f32 = 1.0;
> x == 1.0;   // [Type] Error: Operator '==' cannot be applied to 'f32'
> x < 1.001 && x > 0.999;   // OK — porównanie z zakresem
> ```

### 6.5 Operatory logiczne

`&&`, `||` — oba operandy muszą być dokładnie typ `bool`; wynik to `bool`.

> Dozwolone: `a == b && c != d`  
> Niedozwolone: `x && y` gdzie `x: i32` — wymagane `as<bool>(x) && as<bool>(y)`

### 6.6 Priorytety operatorów (malejąco)

1. Postfix: `expr[i]`, `expr.member`, `expr.*`, `expr(...)`
2. Unarne: `!`, `-`, `&`, `as<T>(...)`
3. Multiplikatywne: `*`, `/`
4. Addytywne: `+`, `-`
5. Porównania: `==`, `!=`, `<`, `>`, `<=`, `>=`
6. Logiczne AND: `&&`
7. Logiczne OR: `||`

---

## 7. Literały łańcuchowe i znakowe

### 7.1 Literał łańcuchowy (`STRING_LIT`)

```
"hello"        // STRING_LIT — surowy UTF-8
"line\nbreak"  // \n, \r, \t, \\ i \" obsługiwane jako escape sequences
```

Literał łańcuchowy jako inicjalizator tablicy `array<u8, N>`:
```
x : array<u8, 5> = "hello";   // bajty UTF-8, bez null terminatora
```

Token `STRING_LIT` ma wartość jako JS string (po przetworzeniu escape sequences).  
Długość w bajtach UTF-8 jest weryfikowana przez TypeChecker przy przypisaniu do `array<u8, N>`.

### 7.2 Konkatenacja sąsiednich literałów łańcuchowych

Dwa lub więcej literałów łańcuchowych napisanych **bezpośrednio obok siebie** (bez operatora) są łączone przez parser w jeden `StringLiteral`:

```
greeting := "Hello, " "World!";   // array<u8, 13> — "Hello, World!"

layout :=
    "########"
    "#      #"
    "#  @   #"
    "########";                     // array<u8, 32> — cztery wiersze
```

- Przydatne do rozkładania długich literałów na czytelne wiersze (np. inicjalizacja map)
- Łączone w fazie parsowania — brak kosztu runtime
- Span wynikowego węzła AST obejmuje cały ciąg literałów (od pierwszego `"` do ostatniego `"`)
- Typy i reguły przypisania identyczne jak dla pojedynczego literału

### 7.3 Literał znakowy (`CHAR_LIT`)

Literał `'x'` reprezentuje kod ASCII bajtu jako wartość typu **`u8`**:

```
ch := 'A';         // u8, wartość 65
nl := '\n';        // u8, wartość 10
wall := '#';       // u8, wartość 35
```

Obsługiwane escape sequences:

| Literał | Wartość | Opis |
|---|---|---|
| `'\n'` | 10 | newline |
| `'\r'` | 13 | carriage return |
| `'\t'` | 9 | tab |
| `'\0'` | 0 | null byte |
| `'\\'` | 92 | backslash |
| `'\''` | 39 | apostrof |

- Przedział wartości: 0–127 (ASCII). Znaki z kodem > 127 są **błędem leksykalnym**.
- `''` (pusty) jest **błędem leksykalnym**.
- Typ inferowany: `u8`. Kompatybilny z `i32` i innymi typami całkowitymi (przez standardowe reguły `isAssignable`).
- Codegen: `i32.const <wartość>` — analogicznie do innych `u8`.
- Użycie zamiast magic numbers:

```
// przed:
printByte(35);
if (cmd == 119) { ... }

// po:
printByte('#');
if (cmd == 'w') { ... }
```

---

## 8. Komentarze

```
// komentarz liniowy

/* komentarz
   blokowy */
```

---

## 9. Separatory liczb

```
1_000_000   →  1000000
```

---

## 10. Ograniczenia bieżącej implementacji

- Struktury wsparcie podstawowe (pola skalarne + tablice; brak zagnieżdżonych struktur w polach przy codegen)
- Brak modułów i importów użytkownika
- Brak tablic wielowymiarowych
- Top-level var decls nie są globalami WASM
- Namespace'd variables (`std::BAR := 42;`) — parser obsługuje, codegen/typechecker deferred do v2
- Brak `use std::foo;` (import do bieżącego scope)
- Brak private/public w namespace'ach — wszystko publiczne

---

## 11. Instrukcje sterowania przepływem

### 11.1 Instrukcja warunkowa `if` / `else if`

```
if (condition) {
    // gałąź true
} else if (other_condition) {
    // druga gałąź
} else {
    // gałąź domyślna (opcjonalnie)
}
```

- `condition` musi być dokładnie typem `bool`
- `else if` łańcuchuje warunki bez zagnieżdżania bloków — parser opakowuje kolejny `IfStmt` w syntetyczny `Block`
- Dowolna liczba `else if` jest dozwolona; końcowy `else` jest opcjonalny
- Do konwersji użyj `as<bool>(...)` lub operatora porównania (`x != 0`)

```
main := fn() i32 {
    x := 5;
    if (x > 10) {
        return 2;
    } else if (x > 3) {
        return 1;
    } else {
        return 0;
    }
};
```

### 11.2 `defer` — gwarantowane sprzątanie przy wyjściu

`defer` rejestruje kod do wykonania przy **wyjściu z bieżącego bloku `{}`** — jak w Zig. Zakres to blok, nie funkcja.

**Formy składniowe:**
```
defer <expr>;                // odroczone wyrażenie
defer <target> = <value>;    // odroczone przypisanie
defer { stmts };             // odroczone bloki (wiele instrukcji)
```

**Semantyka:**
- `defer` odpala przy **wyjściu z bloku `{}`**, w którym został zadeklarowany — przy fallthrough (koniec bloku) albo przy `return` (wewnątrz tego bloku lub zagnieżdżonym).
- Kilka `defer` w jednym bloku wykonywane jest w **odwrotnej kolejności** (LIFO) względem deklaracji.
- Przy `return` wewnątrz zagnieżdżonego bloku: odpalają defer-y ze WSZYSTKICH obejmujących bloków (od najbardziej zagnieżdżonego do zewnętrznego), aż do granicy funkcji.
- `defer` wewnątrz pętli odpala na końcu **każdej iteracji** (ciało pętli to osobny blok).
- `defer` widzi zmienne z otaczającego scope; przydatne np. do finalizacji licznika.

**Przykład — scope blokowy (nie funkcja):**
```
main := fn() void {
    {
        open := "open\n";
        ext::print(&open, open.size);
        defer {
            close := "close\n";
            ext::print(&close, close.size);
        };
        work := "work\n";
        ext::print(&work, work.size);
    }   // ← "close" drukuje się TUTAJ, na końcu tego bloku
    after := "after\n";
    ext::print(&after, after.size);
};
// output: open / work / close / after
```

**Przykład — cleanup przy wczesnym return:**
```
processResource := fn(ok: bool) void {
    opening := "Opening...\n";
    ext::print(&opening, opening.size);

    defer {
        closing := "Closing.\n";
        ext::print(&closing, closing.size);
    };

    if (!ok) {
        err := "Error!\n";
        ext::print(&err, err.size);
        return;          // ← defer wykona się PRZED tym return
    }

    done := "Done.\n";
    ext::print(&done, done.size);
    // defer wykona się tutaj też
};
```

**Implementacja kompilatora:**
- `defer` jako instrukcja nie trafia do codegen — usuwana przez `defer-pass.js` w fazie 3b.
- `defer-pass` wstawia kod odroczonego bloku **bezpośrednio przed każdym `ReturnStmt`** (w tym zagnieżdżonymi wewnątrz `if`/`while`) oraz na **końcu bloku** jeśli nie ma `return` (fallthrough).
- Lokalne zmienne z bloku `defer { ... }` są rejestrowane jako WASM locals raz (deduplicacja w `collectLocalDecls`).

---

### 11.3 Pętla `while`

```
while (condition) {
    // ciało pętli
}
```

- `condition` musi być typem `bool`
- Instrukcja `break` natychmiast kończy pętlę
- `break` poza pętlą jest błędem typecheckera

```
main := fn() i32 {
    i := 0;
    sum := 0;
    while (i < 10) {
        sum = sum + i;
        i = i + 1;
        if (sum > 20) { break; }
    }
    return sum;
};
```

---

## 12. Edytor (Mini-IDE)

→ Patrz [ide.md](ide.md) — pełna dokumentacja edytora: kolorowanie składni, wcięcia, autocomplete, hover, podświetlanie błędów, zwijalne panele.

---

## 13. Namespace'y

### 13.1 Zasady

| Operator | Znaczenie | Przykład |
|----------|-----------|---------|
| `::` | compile-time / static / namespace | `std::foo()`, `Player::of(1,2)`, `i32::default` |
| `.` | runtime member access | `player.hp`, `arr.[i]`, `p.*` |

`::` nigdy nie jest runtime member access. `.` nigdy nie jest namespace.

### 13.2 Deklaracja namespace

```
std := namespace;                         // pusty namespace
gfx := namespace Engine::Graphics;        // alias do istniejącego namespace
```

- Namespace'y są flat (top-level only, nie wewnątrz funkcji)
- Alias rozwijany rekurencyjnie: `gfx::draw()` → `Engine::Graphics::draw()`

### 13.3 Funkcje w namespace

```
math := namespace;
math::square := fn(x: i32) i32 { return x * x; };

main := fn() i32 {
    return math::square(5);   // 25
};
```

- Deklaracja: `A::B := fn(...) RetType { ... };`
- Zagnieżdżanie dozwolone: `A::B::C := fn(...)` → segmenty `['A','B','C']`
- W WASM: mangled name `$A__B` (double underscore separator)

### 13.4 Struct auto-namespace

Deklaracja struktury automatycznie tworzy namespace o jej nazwie z dwoma konstruktorami:

```
Player := struct { hp: mut i32; x: i32; };

Player::of(100, 50)           // constructor pozycyjny
Player::default               // zero-init
```

User może rozszerzyć namespace struktury o własne funkcje:

```
Player::kill := fn(p: ptr<mut Player>) void { p.*.hp = 0; };
```

### 13.5 Scalar namespace

Scalary (`i32`, `f64`, `bool`, ...) nie są keywordami — to zwykłe identyfikatory pre-rejestrowane w globalScope z namespace'ami:

```
x := i32::of(3.7);       // explicit conversion (odpowiednik as<i32>(3.7))
z := i32::default;        // zero value: 0
b := bool::default;       // false
```

Shadowing nazwy scalara jest błędem kompilacji:
```
i32 := 5;   // [Type] Error: 'i32' shadows an outer declaration
```

### 13.6 QualifiedName — AST

Parser przedstawia wszystkie wyrażenia `A::B`, `A::B(args)`, `A::B::C` jako jeden AST node:

```
QualifiedName {
    segments: string[],    // np. ['Player', 'of'], ['std', 'foo']
    args: Expr[] | null,   // null jeśli brak (), [] jeśli ()
    _resolvedKind: string  // ustawione przez type-checker
}
```

Type-checker resolve'uje `QualifiedName` i taguje `_resolvedKind`:

| `_resolvedKind` | Przykład | Znaczenie |
|----------------|---------|-----------|
| `'scalar-constructor'` | `i32::of(3.7)`, `f64::default` | Konstruktor skalara |
| `'struct-constructor'` | `Player::of(1,2)`, `Player::default` | Konstruktor struktury |
| `'namespace-func'` | `std::foo()`, `Player::kill(p)` | Funkcja z namespace |

### 13.7 Scope model

Klasa `Scope` (staticAnalysis.js) posiada `namespaces: Map<string, Scope>`:

- `defineNamespace(name)` — tworzy zagnieżdżony scope
- `resolveQualified(segments)` — resolve z alias expansion i namespace lookup
- `defineQualified(segments, ...)` — rejestruje symbol w zagnieżdżonym scope
- `findNamespace(name)` — szuka namespace w bieżącym scope i parent chain

### 13.8 Type-checker pipeline

| Pass | Co robi z namespace'ami |
|------|------------------------|
| **Pass 0** | Rejestruje `NamespaceDecl` — empty namespace lub alias |
| **Pass 1a** | Rejestruje `NamespacedDecl` z `FuncDecl` — mangle name + `defineQualified()` |
| **Pass 1b** | Struct placeholders — auto-namespace tworzony w Pass 2 |
| **Pass 2** | Pełne sprawdzanie — `inferQualifiedName()` resolve'uje segmenty |

### 13.9 Codegen

- `std::foo` → WASM function `$std__foo` (double underscore separator)
- `funcIndex` mapa: klucz = mangled name string
- `QualifiedName` z `_resolvedKind: 'namespace-func'` → `call $mangled`
- Struct constructors bez zmian — `emitStructInit` sprawdza `_resolvedKind`

### 13.10 Ograniczenia v1

- Namespace'y tylko top-level (nie wewnątrz funkcji)
- Brak `use std::foo;` (import do bieżącego scope)
- Brak private/public — wszystko publiczne
- Brak metod na strukturach (fn z implicit `self`) — tylko "static functions"
- Namespace'd variables (`std::BAR := 42;`) — parser obsługuje, ale typechecker nie rejestruje
  w namespace scope, codegen nie emituje `global.get`/`global.set`. Deferred do v2.
- `void` pozostaje keyword (nie namespace-owalny)
