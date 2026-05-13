# QLang — Rozszerzenie: System Makr (v1)

> Uzupełnienie do [langDetail.md](langDetail.md)
> Stan na: 2026-05-13 (aktualizacja: `unpack!` §10, `pack` kind)

---

## 1. Motywacja

System makr pozwala definiować **user-defined control flow** (np. `for_each`, `assert`, `repeat`)
bez wprowadzania lambd/closures do języka. Makra działają jako **higieniczne szablony** —
kod z ciała makra jest wklejany w miejsce wywołania z odpowiednimi podstawieniami.

---

## 2. Pozycja w pipeline kompilatora

```
tokenize(src) → parse(tokens) → expand macros → typecheck(ast) → generate(ast) → WASM
```

Makra są rozwijane **po parsowaniu, przed typecheckiem**. Expander operuje na AST.

---

## 3. Definicja makra

```
name := macro(param1 : kind1, param2 : kind2, ...) {
    // ciało — szablon QLang z markerami $ i @
};
```

- Binding jest **zawsze const** (jak `fn`)
- Ciało jest **szablonem QLang** — nie jest ewaluowane przy definicji
- Każdy parametr **musi** mieć podany kind (nie ma domyślnego)

---

## 4. Kindy parametrów

Kindy są **rozłącznymi kategoriami** (partition). `expr` jest zawężone do wartości, `any` pokrywa wszystko:

| Kind    | Akceptuje                                                              | `@param` w kodzie                          |
|---------|------------------------------------------------------------------------|--------------------------------------------|
| `ident` | tylko goły identyfikator — gdy potrzebna nazwa jako l-value lub deklaracja | raw — może być l-value i nazwa deklaracji |
| `expr`  | wartość: ident OR wyrażenie złożone — **nie** block, **nie** typ       | `(@param)` — bezpieczne priorytety         |
| `block` | blok `{ ... }`                                                         | wklejony jako statement                    |
| `type`  | wyrażenie typowe                                                       | w pozycji typu                             |
| `any`   | cokolwiek — expr OR block OR type                                      | zależy od tego co wklejone                 |

`expr` akceptuje zarówno goły identyfikator jak i wyrażenie złożone:

```
for_each!(nums, val, { ... });        // OK: nums = ident → expr
for_each!(get_array(), val, { ... }); // OK: get_array() = expr
```

`ident` wymagany jest gdy parametr musi być **celem deklaracji** lub **l-value**.
`expr` **nie może** służyć jako cel deklaracji — expander owija argument nawiasami
(`@param` → `(@param)`), więc `@param := ...` rozwinęłoby się do `(@param) := ...`,
co jest nielegalną konstrukcją:

```
bad  := macro(x : expr)  { @x := 0; };  // błąd: (@x) := 0 jest nielegalne
good := macro(x : ident) { @x := 0; };  // OK: x podstawiane dosłownie
```

Przekazanie argumentu niezgodnego z kindem jest **błędem kompilacji** (sprawdzanym przed re-parsowaniem ciała):

| Naruszenie | Przykład | Komunikat błędu |
|---|---|---|
| `expr` ← blok | `assert!({ x = 1; })` | `'assert': parameter 'cond' (kind=expr) — got block argument` |
| `expr` ← goły typ | `assert!(i32)` | `'assert': parameter 'cond' (kind=expr) — got bare type 'i32'; use an expression` |
| `block` ← nie-blok | `repeat2!(x + 1)` | `'repeat2': parameter 'body' expects kind 'block', got non-block argument` |
| `ident` ← wyrażenie | `swap!(a + b, c)` | `'swap': parameter 'x' (kind=ident) requires a bare identifier, got: 'a + b'` |
| `type` ← nie-typ | `wrap!(42 + 1)` | `'wrap': parameter 'T' (kind=type) — expected type expression, got: '42 + 1'` |
| `type` ← blok | `wrap!({ })` | `'wrap': parameter 'T' (kind=type) — got block argument` |

Reguły walidacji `type`:
- Pierwszym tokenem musi być `IDENT` ze zbioru scalar types (`i32`, `f64`, `bool`, …) lub `KEYWORD` z grupy typów (`mut`, `ptr`, `array`, `fn`)
- Wyrażenie złożone zaczynające się od liczby, operatora itp. jest odrzucane

> Błędy kind-check mają format `[Macro] main:linia — komunikat` gdzie `linia` to numer linii wywołania makra w kodzie źródłowym.

---

## 5. Wywołanie makra

```
name!(arg1, arg2, ...);
```

- Sufiks `!` odróżnia wywołanie makra od wywołania funkcji
- Argumenty są dopasowane do kindów parametrów
- Bloki `{ }` mogą być przekazywane jako zwykłe argumenty wewnątrz `()`

---

## 6. Markery: `$` i `@`

System makr używa dokładnie **dwóch markerów**:

### 6.1 `$name` — moje (gensym / zmienne wewnętrzne)

Zmienne oznaczone `$` są **prywatne** dla rozwinięcia makra. Kompilator generuje unikalną nazwę
(gensym), aby uniknąć kolizji z kodem wywołującego:

```
repeat := macro(n : expr, body : block) {
    $i : mut u32 = 0;          // $i → __repeat_i_0042 (gensym)
    while ($i < @n) {
        @body;
        $i = $i + 1;
    }
};
```

`$i` nigdy nie koliduje z żadną zmienną w scope wywołania.

### 6.2 `@param` — twoje (z callsite)

Odwołanie do parametru makra. Zachowanie zależy od kontekstu:

| Kontekst                    | Efekt                                                        |
|-----------------------------|--------------------------------------------------------------|
| W wyrażeniu (`expr`)        | Podstawienie owiniete: `@arr.size` → `(nums).size`           |
| W deklaracji (`ident` only) | Nazwa zmiennej z callsite: `@elem := ...` → `val := ...`     |
| W pozycji typu (`type`)     | Podstawienie typu: `a : @T` → `a : i32`                      |
| Jako blok (`block`)         | Wklejenie bloku: `@body;` → `{ ... }`                        |

**IDE hover:** Najechanie na `@name` w ciele makra wyświetla podpowiedź z kindem i sposobem rozwinięcia:

| Kind    | Label              | Detail                                                                           |
|---------|--------------------|----------------------------------------------------------------------------------|
| `expr`  | `@name: expr`      | `expands to (@name)  —  wrapped in parens for safe operator precedence`          |
| `ident` | `@name: ident`     | `expands to name  —  raw substitution, valid as declaration target or l-value`   |
| `block` | `@name: block`     | `spliced raw as a statement block { ... }`                                       |
| `type`  | `@name: type`      | `expands to name  —  raw substitution in type annotation position`               |
| `any`   | `@name: any`       | `expands to name  —  raw, unconstrained (expr, block, type, or ident)`           |
| `pack`  | `@name: pack`      | `iterate elements with:  #expand val in @name { body }`                          |

---

## 7. Dostęp do elementów tablicy: `arr.[i]`

Nowy postfixowy operator **bracket access** — spójny z `p.*`:

```
v := arr.[i];       // odczyt elementu
arr.[0] = 99;       // zapis (gdy element mut)
```

> Stary zapis `arr[i]` zostaje zastąpiony przez `arr.[i]`.
> Dzięki temu w makrach `@arr.[$i]` jest jednoznaczne.

---

## 8. Konstruktory typów

Trzy uniformowe konstruktory dla dowolnego typu `T`:

| Konstruktor          | Znaczenie                                      |
|----------------------|------------------------------------------------|
| `T::of(value)`       | Tworzenie wartości typu T z podaną wartością   |
| `T::default`         | Wartość domyślna typu T (zero / false / 0.0)  |

```
x := i32::of(42);
y := f64::default;                          // 0.0
```

---

## 9. Przykłady makr

### 9.1 assert

```
assert := macro(cond : expr) {
    if (!@cond) {
        msg : array<u8, 16> = "assert failed!\n";
        ext::printLn(&msg, msg.size);
    }
};

// użycie:
assert!(x > 0);
```

### 9.2 for_each — iteracja po tablicy

```
for_each := macro(arr : expr, elem : ident, body : block) {
    $i : mut u32 = 0;
    while ($i < @arr.size) {
        @elem := @arr.[$i];
        @body;
        $i = $i + 1;
    }
};

// użycie:
total : mut i32 = 0;
for_each!(nums, val, {
    total = total + val;
});
```

### 9.3 for_find — iteracja z flagą „znaleziono"

```
for_find := macro(arr : expr, elem : ident, found : ident, body : block) {
    @found : mut bool = false;
    $i : mut u32 = 0;
    while ($i < @arr.size) {
        @elem := @arr.[$i];
        @body;
        $i = $i + 1;
    }
};

// użycie:
for_find!(nums, elem, hit, {
    if (elem == 30) {
        hit = true;
        break;
    }
});
```

### 9.4 swap

```
swap := macro(a : expr, b : expr, T : type) {
    $tmp : @T = @a;
    @a = @b;
    @b = $tmp;
};

// użycie:
x : mut i32 = 3;
y : mut i32 = 7;
swap!(x, y, i32);   // x == 7, y == 3
```

---

## 10. Wbudowane makro `unpack!` — iteracja po pakiecie wartości

`unpack!` jest wbudowanym makrem rozumianym bezpośrednio przez ekspander (nie user-defined).
Pozwala iterować po **literale pakietu `[e1, e2, ...]`** — liście wartości znanych w czasie kompilacji.
Odpowiada compile-time unrollowi pętli.

### Składnia

```
unpack!(vals, iterName, { body });
```

- `vals` — argument rodzaju `pack`: literał `[e1, e2, ...]` lub `@param` gdzie parametr ma rodzaj `pack`
- `iterName` — nowa nazwa zmiennej iteracji (rodzaj `ident`)
- `{ body }` — blok instrukcji; każdy element jest podstawiany w miejsce `iterName` (rodzaj `block`)

Expander generuje N kopii `body` — po jednej na każdy element pakietu.

### Przykład — sumowanie z literału pakietu

```
sum : mut i32 = 0;
unpack!([10, 20, 30], val, {
    sum = sum + val;
});
// sum == 60
```

`unpack!` rozwija się statycznie do:
```
sum = sum + 10;
sum = sum + 20;
sum = sum + 30;
```

### Przekazywanie pakietu przez makro

Makro przyjmuje pakiet jako parametr rodzaju `pack` i przekazuje go do `unpack!` przez `@param`:

```
sum_all := macro(vals : pack) {
    $total : mut i32 = 0;
    unpack!(@vals, $v, {
        $total = $total + $v;
    });
};

// użycie:
sum_all!([5, 10, 15]);   // $total == 30 wewnątrz makra
```

### Ograniczenia v1

- `vals` musi być literałem pakietu `[e, e, ...]` lub `@param` wskazującym na parametr rodzaju `pack`
- Goły identyfikator zamiast `@param` (np. `unpack!(arr, v, {...})`) jest błędem kompilacji z komunikatem diagnostycznym
- Brak zagnieżdżonych `unpack!` iterujących ten sam pakiet w tej samej funkcji (gensym `$v` koliduje)
a : mut i32 = 1;
b : mut i32 = 2;
swap!(a, b, i32);
```

### 9.5 repeat — powtórz N razy

```
repeat := macro(n : expr, body : block) {
    $i : mut u32 = 0;
    while ($i < @n) {
        @body;
        $i = $i + 1;
    }
};

// użycie:
counter : mut i32 = 0;
n : u32 = 5;
repeat!(n, {
    counter = counter + 1;
});
```

### 9.6 make_adder — pseudo-generics przez `type` kind

```
make_adder := macro(name : ident, T : type) {
    @name := fn(a : @T, b : @T) @T {
        return a + b;
    };
};

// użycie:
make_adder!(add_i32, i32);
make_adder!(add_f64, f64);
sum := add_i32(10, 20);    // 30
```

---

## 10. Stringify: `#param`

Prefiks `#` przed nazwą parametru (bez `@`) zamienia argument makra w **literał stringowy** `array<u8, N>`:

```
#param   →   "tekst argumentu dosłownie"
```

Działa na **dowolnym kindzie**:

| Wywołanie                | `#cond` po rozwinięciu |
|--------------------------|------------------------|
| `assert!(x > 0)`         | `"x > 0"`             |
| `assert!(done)`          | `"done"`               |
| `log_block!({ x = 1; })` | `"{ x = 1; }"`         |
| `log_type!(i32)`         | `"i32"`                |

### Przykład: assert z komunikatem

```
assert := macro(cond : expr) {
    if (!(@cond)) {
        msg := #cond;
        ext::printLn(&msg, msg.size);
    }
};

assert!(x > 0 && y < 10);
// drukuje: "x > 0 && y < 10"
```

### Zasady

- `#param` jest **wyrażeniem** typu `array<u8, N>` gdzie `N` = długość tekstu argumentu w UTF-8
- `N` jest wyznaczane **automatycznie** przez kompilator po rozwinięciu (compile-time, przed typecheckiem)
- Typ inferowany przy przypisaniu: `msg := #cond;` — nie ma potrzeby ręcznego podawania `N`
- `#` poza ciałem makra jest błędem leksykalnym

---


## 11. Ograniczenia

- Makra **nie mogą** wywoływać samych siebie (brak rekursji)