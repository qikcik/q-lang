# QLang — Wprowadzenie do języka

> Stan na: 2026-04-12 (aktualizacja: **`else if`**, **unary minus (`-expr`)**, makra, BracketAccessExpr arr.[i], QualifiedName T::of/default, **struktury**, **namespace'y**)
> Pełna specyfikacja z przykładami: [langDetail.md](langDetail.md)

---

## 1. Ogólne założenia

- Język kompilowany do WebAssembly (WASM MVP)
- Silne, statyczne typowanie z inferencją typów
- Składnia LL(2) — parsowanie od lewej do prawej bez backtrackingu
- Brak garbage collectora — zarządzanie pamięcią przez programistę (wskaźniki, tablice na stosie)
- Zmienne domyślnie niemodyfikowalne (`const`); mutowalność wymaga jawnego `mut`
- Brak null terminatorów, brak implicit coercji między typami

---

## 2. System typów — przegląd

### Typy skalarne
`i8`, `u8`, `i16`, `u16`, `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `bool`

Scalary nie są keywordami — to zwykłe identyfikatory z pre-rejestrowanymi namespace'ami (`i32::of`, `i32::default`).

### Wskaźniki
`ptr<T>` — wskaźnik (i32 w linear memory). Dereferencja postfixowa: `p.*`

### Wskaźniki na funkcje
`ptr<fn(params) RetType>` — wywołanie: `fptr.*(args)`

### Struktury
```
Vec2 := struct { x: i32; y: mut i32 = 0; };
main := fn() i32 {
    v : Vec2 = Vec2::of(3, 7);
    return v.x;
};
```

- Pola domyślnie const; `mut` na polu pozwala na zapis
- Konstruktory: `Vec2::default` (wszystkie pola = 0) / `Vec2::of(a, b)` (pola w kolejności deklaracji)
- Struct automatycznie tworzy namespace o swojej nazwie (patrz §4)
- Przekazywane przez funkcje jako `i32` (adres bazowy w linear memory)

---

### Tablice
`array<T, N>` — stałorozmiarna, na stosie. Element: `arr.[i]`, rozmiar: `arr.size`

### Mutability (dwa poziomy)
```
x : mut i32 = 5;                           // mut skalar
arr : mut array<mut i32, 3> = {1, 2, 3};   // mut binding + mut elementy
p : ptr<mut i32> = &x;                     // const ptr, mut pointee
```

---

## 3. Deklaracje i zmienne

```
x := 5;              // const, inferred i32
y : mut i32 = 10;    // mutable, explicit
arr := {1, 2, 3};    // const array<i32, 3>
msg := "hello";      // const array<u8, 5>
```

- Inferred (`x := expr`) — zawsze const
- Explicit z `mut` — mutable
- Shadowing zabroniony (błąd kompilacji)
- Anonimowy blok `{ ... }` jako statement tworzy nowy leksykalny scope (`ScopeBlock`)
- Konwersja typów: `as<f32>(x)` (tylko skalary)

---

## 4. Namespace'y

Operator `::` oznacza compile-time / static / namespace access. Operator `.` oznacza runtime member access. Nigdy odwrotnie.

### Deklaracja namespace
```
math := namespace;                        // pusty namespace
gfx  := namespace Engine::Graphics;       // alias do istniejącego
```

### Funkcje w namespace
```
math::square := fn(x: i32) i32 { return x * x; };
math::square(5);   // wywołanie → 25
```

### Struct auto-namespace
Deklaracja struktury automatycznie tworzy namespace o jej nazwie:
```
Player := struct { hp: mut i32; x: i32; };
Player::of(100, 50)           // constructor (pozycyjny)
Player::default               // zero-init
Player::kill := fn(p: ptr<mut Player>) void { p.*.hp = 0; };   // user-defined
```

### Aliasy
```
gfx := namespace Engine::Graphics;
gfx::draw();          // → Engine::Graphics::draw()
```

### Zagnieżdżanie
`A::B::C` dozwolone — parser zbiera łańcuch `IDENT (:: IDENT)*`.

### Ograniczenia v1
- Namespace'y tylko top-level (nie wewnątrz funkcji)
- Brak `use std::foo;` (import do bieżącego scope)
- Brak private/public — wszystko publiczne
- Namespace'd variables (`std::BAR := 42;`) — parser obsługuje, codegen deferred do v2

---

## 5. Makra

QLang posiada system higienicznych makr— rozwijanych po parsowaniu, przed type-checkingiem:

```
inc := macro(x : ident) { @x = @x + 1; };
main := fn() i32 {
    n : mut i32 = 0;
    inc!(n);             // expands to: n = n + 1;
    return n;
};
```

- Parametry mają rodzaj: `expr`, `ident`, `block`, `type`, `any`
- `@param` — podstawienie argumentu; `expr` i `block` bezpieczne priorytetowo
- `$name` — gensym: unikalna nazwa per wywołanie (brak kolizji z zewnętrznym scope)
- `#param` — stringify: tekst argumentu jako `array<u8, N>`
- Pełna specyfikacja: [langExtensionMacro.md](langExtensionMacro.md)

---

## 6. Konstruktory typów (`T::of`, `T::default`)

Konstruktory dostępne przez namespace `::` — dla scalarów i struktur:

```
x := i32::of(3.7);          // explicit conversion
z := i32::default;          // zero value (0)
v : Vec2 = Vec2::of(3, 7);  // struct constructor
```

---

## 7. Funkcje

```
add := fn(a: i32, b: i32) i32 {
    return a + b;
};
```

- Parametry z jawnym typem, typ zwracany jawny
- Lokalne funkcje: lambda-lifting (brak closures)
- Wskaźniki na funkcje: `&funcName` + `fptr.*(args)`
- Zewnętrzne funkcje dostępne przez namespace `ext` (patrz sekcja 6)

---

## 8. Wyrażenia i operatory

| Kategoria | Operatory |
|---|---|
| Arytmetyczne | `+`, `-`, `*`, `/` |
| Porównania | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Logiczne | `&&`, `\|\|`, `!` (short-circuit) |
| Unarne | `-expr` (negacja), `&expr` (adres), `expr.*` (deref postfix) |
| Konwersja | `as<T>(expr)` |
| Indeksowanie | `arr.[i]`, `arr.size` |

---

## 9. Przepływ sterowania

- `if (cond) { ... } else if (cond2) { ... } else { ... }` — warunek musi być `bool`; `else if` łańcuchuje warunki
- `while (cond) { ... }` + `break`
- `return expr;`
