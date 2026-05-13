# QLang — Namespace Plan

> Status: **ZAIMPLEMENTOWANE** — archiwum decyzji projektowych. Zob. [langDetail.md](langDetail.md) §13 i §10 ograniczenia. Namespace'd variables (`std::BAR := 42;`) — parser obsługuje, codegen/typechecker deferred do v2. **Namespace file imports** (`x := namespace "file.qlang"`) — zaimplementowane: `NamespaceImport` AST node, `compileMulti`, `liveCompileMulti`, per-file typecheck z `_filePrefix`, autocomplete przez `importEnv`.

---

## 1. Cele

- Flat namespace'y (top-level only) z aliasami
- Struct auto-tworzenie namespace → `Player::of`, `Player::kill`, `Player::count`
- Scalary (`i32`, `f64`…) traktowane identycznie jak structs — nie są keywordami
- Uogólnienie `TypeConstructorExpr` na `QualifiedName` — jedna ścieżka `::` w parserze
- Fundament pod `env::malloc` / `std::malloc` (wymienne alokatory)

---

## 2. Zasady

| Operator | Znaczenie | Przykład |
|----------|-----------|---------|
| `::` | compile-time / static / namespace | `std::foo()`, `Player::of(1,2)`, `i32::default` |
| `.` | runtime member access | `player.hp`, `arr.[i]`, `p.*` |

`::` nigdy nie jest runtime member access. `.` nigdy nie jest namespace.

---

## 3. Składnia

### 3.1 Deklaracja namespace

```
std := namespace;                         // pusty namespace
gfx := namespace Engine::Graphics;        // alias do istniejącego
```

### 3.2 Deklaracja w namespace (tylko top-level)

```
std::foo := fn() void {};
std::BAR := 42;
```

### 3.3 Struct auto-namespace

Struct automatycznie tworzy namespace o swojej nazwie:

```
Player := struct { hp: mut i32; x: i32; };

// Te dwa wchodzą automatycznie (jak dziś):
Player::of(100, 50)           // constructor (pozycyjny)
Player::default               // zero-init

// User może dołożyć:
Player::kill := fn(p: ptr<mut Player>) void { p.*.hp = 0; };
Player::count : mut i32 = 0;  // "static" variable
```

### 3.4 Użycie

```
std::foo();
n := Player::count;
Player::kill(p);
v := Player::of(3, 7);
x := i32::of(3.7);
z := i32::default;
```

### 3.5 Alias

```
gfx := namespace Engine::Graphics;
gfx::draw();          // → Engine::Graphics::draw()
```

### 3.6 Zagnieżdżanie

`A::B::C` dozwolone — parser zbiera łańcuch `IDENT (:: IDENT)*`.

---

## 4. Eliminacja TYPE_KW

### 4.1 Problem

Dziś `i32`, `f64`, `bool` itd. to osobna kategoria tokenów `TYPE_KW` w lexerze.
To wymusza osobne ścieżki w parserze (`TYPE_KW` vs `IDENT`) i blokuje traktowanie
scalarów jako namespace'ów.

### 4.2 Zmiana

Scalary stają się zwykłymi `IDENT`. Lexer nie rozróżnia `i32` od `Player`.

- Parser: `parseType()` — jedna ścieżka `IDENT` → zawsze emituje `UserTypeRef`
- Type-checker: `resolveType()` resolve'uje `UserTypeRef('i32')` → wbudowany scalar
- Scalary pre-rejestrowane w `globalScope` z namespace'm (`i32::of`, `i32::default`)

### 4.3 Shadowing

`i32 := 5;` — parser przepuści (IDENT), ale `Scope.define()` rzuci:
`'i32' shadows an outer declaration` (bo `i32` zarejestrowane w globalScope).

To istniejący mechanizm — Scope.define() sprawdza parent chain:
```js
// staticAnalysis.js — Scope.define():
let s = this.parent;
while (s) {
  if (s.symbols.has(name)) {
    throw new TypeError(`'${name}' shadows an outer declaration`, line);
  }
  s = s.parent;
}
```

### 4.4 `void` pozostaje keyword

`void` nie jest typem w normalnym sensie — nie można mieć `x : void`.
Zostawiamy jako KEYWORD, walidacja w `parseType()`.

### 4.5 Miejsca do zmiany

| Plik | Zmiana |
|------|--------|
| lexer.js | Usunięcie `TYPE_KEYWORDS`, `TT.TYPE_KW`. Scalary tokenizowane jako `IDENT`. |
| parser-exprs.js `parseType()` | Usunięcie `eat(TT.TYPE_KW)` fallback. Jedna ścieżka `IDENT` → `UserTypeRef`. |
| parser-exprs.js `parsePrimary()` | Usunięcie bloku `if (t.type === TT.TYPE_KW)`. `IDENT` + `::` obsługuje obie sytuacje. |
| macro-substitute.js | `TYPE_KW` check → sprawdzanie `SCALAR_TYPES.has(tok.value)` |
| staticTypeChecker.js | `_registerBuiltins()` rejestruje scalary w globalScope jako namespace |
| type-infer.js `resolveType()` | `UserTypeRef` resolve: sprawdź scope → scalar namespace / struct / error |
| test-lexer.js | Aktualizacja assertów `TYPE_KW` → `IDENT` |

---

## 5. Eliminacja TypeConstructorExpr → QualifiedName

### 5.1 Nowy AST node

```js
node('QualifiedName', {
    segments: ['Player', 'of'],   // chain: A::B::C → ['A','B','C']
    args: [...],                   // jeśli po ostatnim segmencie jest '(...)', null jeśli nie
    line, start, end
})
```

### 5.2 Parser

`::` w postfix loop (`parseCallOrPrimary`) buduje `QualifiedName`:

```
IDENT :: IDENT                → QualifiedName { segments: [a, b], args: null }
IDENT :: IDENT ( args )       → QualifiedName { segments: [a, b], args: [...] }
IDENT :: IDENT :: IDENT       → QualifiedName { segments: [a, b, c], args: null }
```

Nie ma rozróżnienia `of`/`default` w parserze — wszystko to `QualifiedName`.
Nie ma `TypeConstructorExpr`.

### 5.3 Type-checker — resolve i tagowanie

`QualifiedName` resolve'owany w `inferExpr()` → `resolveQualified(segments)`:

| Resolve result | `_resolvedKind` | Przykład |
|----------------|----------------|---------|
| Scalar constructor | `'scalar-constructor'` | `i32::of(3.7)`, `f64::default` |
| Struct constructor | `'struct-constructor'` | `Player::of(1,2)`, `Player::default` |
| Namespace function | `'namespace-func'` | `std::foo()`, `Player::kill(p)` |
| Namespace variable | `'namespace-var'` | `Player::count`, `std::BAR` |

### 5.4 Codegen dispatch

```js
case 'QualifiedName':
    switch (expr._resolvedKind) {
        case 'struct-constructor':  return emitStructConstructor(b, expr, ctx);
        case 'scalar-constructor':  return emitScalarConstructor(b, expr, ctx);
        case 'namespace-func':      // → emitExpr on CallExpr wrapper or direct call
        case 'namespace-var':       // → global.get / local.get z mangled name
    }
```

### 5.5 Migracja: emitStructInit guard

`emitStructInit()` (wat-emitter.js) sprawdza:
```js
// Dziś:
valueExpr.kind === 'TypeConstructorExpr' && valueExpr.method === 'default'
valueExpr.kind === 'TypeConstructorExpr' && valueExpr.method === 'of'

// Po:
valueExpr.kind === 'QualifiedName' && valueExpr._resolvedKind === 'struct-constructor'
    && valueExpr._method === 'default'
valueExpr.kind === 'QualifiedName' && valueExpr._resolvedKind === 'struct-constructor'
    && valueExpr._method === 'of'
```

`_method` ustawiany przez type-checker (ostatni segment: `segments[segments.length - 1]`).

### 5.6 Miejsca do zmiany

| Plik | Zmiana |
|------|--------|
| parser-exprs.js | `::` emituje `QualifiedName` zamiast `TypeConstructorExpr` |
| type-infer.js | `inferExpr` dispatch: `QualifiedName` → `inferQualifiedName()` |
| type-infer.js | Nowa `inferQualifiedName()` — resolve, validate args, tag `_resolvedKind` |
| wat-emitter.js | `emitExpr` dispatch: `QualifiedName` → switch na `_resolvedKind` |
| wat-emitter.js | `emitStructInit` — guard zmiana (patrz §5.5) |
| ast-renderer.js | Label dla `QualifiedName` |
| ast-to-source.js | Emit `QualifiedName` |
| macro-substitute.js | Deep-clone `QualifiedName` |
| macro-expander.js | Walk `QualifiedName` |
| Testy | Update `TypeConstructorExpr` → `QualifiedName` we wszystkich assertach |

---

## 6. Scope model — nested namespaces

### 6.1 Scope rozszerzenie

```js
class Scope {
    constructor(parent = null) {
        this.parent     = parent;
        this.symbols    = new Map();        // name → symbol
        this.namespaces = new Map();        // name → Scope
    }

    defineNamespace(name) {
        if (!this.namespaces.has(name)) {
            this.namespaces.set(name, new Scope(this));
        }
        return this.namespaces.get(name);
    }

    resolveQualified(segments, errorNode) {
        if (segments.length === 1) return this.resolve(segments[0], errorNode);

        const nsName = segments[0];

        // Alias expansion
        const sym = this.symbols.get(nsName);
        if (sym?.kind === 'namespace-alias') {
            const expanded = [...sym.target, ...segments.slice(1)];
            return this.resolveQualified(expanded, errorNode);
        }

        // Namespace lookup
        const ns = this.findNamespace(nsName);
        if (!ns) throw new TypeError(`Undefined namespace '${nsName}'`, errorNode);
        return ns.resolveQualified(segments.slice(1), errorNode);
    }

    findNamespace(name) {
        let scope = this;
        while (scope) {
            if (scope.namespaces.has(name)) return scope.namespaces.get(name);
            scope = scope.parent;
        }
        return null;
    }

    defineQualified(segments, type, kind, mut, line) {
        if (segments.length === 1) return this.define(segments[0], type, kind, mut, line);
        const ns = this.defineNamespace(segments[0]);
        return ns.defineQualified(segments.slice(1), type, kind, mut, line);
    }
}
```

### 6.2 Type-checker rejestracja builtinów

```js
_registerBuiltins() {
    // Scalar types as namespaces with of/default
    for (const name of ['i8','u8','i16','u16','i32','u32','i64','u64','f32','f64','bool']) {
        this.globalScope.define(name, { kind: 'Type', name, mut: false }, 'type', false, 0);
        const ns = this.globalScope.defineNamespace(name);
        ns.define('of',      { kind: 'scalar-constructor', typeName: name }, 'builtin', false, 0);
        ns.define('default', { kind: 'scalar-constructor', typeName: name }, 'builtin', false, 0);
    }

    // print
    this.globalScope.define('print', { ... }, 'builtin', false, 0);
}
```

### 6.3 Struct auto-namespace

```js
checkStructDecl(decl) {
    // ... buduj StructType jak dziś ...

    // Auto-create namespace with of/default
    const ns = this.globalScope.defineNamespace(decl.name);
    ns.define('of',      { kind: 'struct-constructor', structType: st }, 'builtin', false, decl.line);
    ns.define('default', { kind: 'struct-constructor', structType: st }, 'builtin', false, decl.line);
}
```

### 6.4 NamespaceDecl w top-level

Type-checker Pass 0 (przed Pass 1a funcs, 1b structs):
```js
for (const decl of ast.body) {
    if (decl.kind === 'NamespaceDecl') {
        if (decl.target) {
            // Alias: gfx := namespace Engine::Graphics;
            this.scope.define(decl.name, null, 'namespace-alias', false, decl.line);
            this.scope.symbols.get(decl.name).target = decl.target; // segments array
        } else {
            // Empty: std := namespace;
            this.scope.defineNamespace(decl.name);
        }
    }
}
```

Pass 1c: namespaced declarations (`std::foo := fn ...`):
```js
for (const decl of ast.body) {
    if (decl.kind === 'NamespacedDecl') {
        // decl.segments = ['std', 'foo'], decl.inner = FuncDecl | VarDecl
        // → define in nested scope via defineQualified
    }
}
```

---

## 7. Parser changes

### 7.1 Lexer

- Usunąć `TYPE_KEYWORDS` Set i `TT.TYPE_KW` z `TT`
- Dodać `'namespace'` do `KEYWORDS`
- Scalary (`i32` itp.) tokenizowane jako `IDENT`

### 7.2 `parseDecl()` — top-level

Rozszerzyć o:
```
IDENT ':=' 'namespace' ...             → NamespaceDecl
IDENT '::' IDENT+ ':=' 'fn' ...       → NamespacedDecl (inner = FuncDecl)
IDENT '::' IDENT+ ':=' expr ';'       → NamespacedDecl (inner = VarDecl)
IDENT '::' IDENT+ ':' type '=' ...    → NamespacedDecl (inner = VarDecl)
```

AST nodes:
```js
node('NamespaceDecl', { name, target: string[]|null, line, start, end })
node('NamespacedDecl', { segments: string[], inner: FuncDecl|VarDecl, line, start, end })
```

### 7.3 `parseCallOrPrimary()` — postfix `::`

Zamiast emitowania `TypeConstructorExpr` z hardkodowanym `of`/`default`:

```js
} else if (this.check(TT.OP, '::')) {
    this.pos++;  // consume '::'
    const segments = [expr];  // expr = first segment (Identifier | TypeRef)
    const memberTok = this.eat(TT.IDENT);
    segments.push(memberTok.value);

    // Chain: a::b::c
    while (this.check(TT.OP, '::')) {
        this.pos++;
        const next = this.eat(TT.IDENT);
        segments.push(next.value);
    }

    // Args?
    let args = null;
    let end  = memberTok.end;
    if (this.check(TT.PUNCT, '(')) {
        this.pos++;
        args = this.parseArgList();
        const close = this.eat(TT.PUNCT, ')');
        end = close.end;
    }

    const segStrs = segments.map(s => typeof s === 'string' ? s : s.name);
    expr = node('QualifiedName', {
        segments: segStrs, args,
        line: expr.line, start: expr.start, end
    });
}
```

### 7.4 `parsePrimary()` — cleanup

Usunąć blok `if (t.type === TT.TYPE_KW)`. `IDENT` + `::` idzie standardową ścieżką
IDENT → postfix `::` → `QualifiedName`.

### 7.5 `parseType()` — cleanup

Usunąć `eat(TT.TYPE_KW)` fallback. Jedna ścieżka:
```js
if (this.check(TT.IDENT)) {
    const ident = this.eat(TT.IDENT);
    return node('UserTypeRef', { name: ident.value, mut, ... });
}
this.error('Expected type');
```

Type-checker `resolveType()` resolve'uje `UserTypeRef('i32')` → `{ kind: 'Type', name: 'i32' }`.

---

## 8. Codegen — mangled names

Namespace'd functions w WASM:
- `std::foo` → WASM function name `$std__foo` (double underscore separator)
- `Player::kill` → `$Player__kill`
- Export name: `std__foo` (lub bez exportu — TBD, może tylko `main` eksportowane)

funcIndex mapa: klucz = mangled name string.

Namespace'd globals (np. `Player::count`):
- WASM global `$Player__count`
- QualifiedName z `_resolvedKind: 'namespace-var'` → `global.get $Player__count` / `global.set`

---

## 9. Kolejność implementacji

| Krok | Co | Breaking? |
|------|-----|-----------|
| 1 | Lexer: `namespace` keyword, usunięcie `TYPE_KW` | **Tak** — wymaga krok 2-3 atomowo |
| 2 | Parser `parseType()`: IDENT → UserTypeRef dla scalarów | **Tak** — wymaga krok 4 |
| 3 | Parser `parsePrimary()`: usunięcie TYPE_KW bloku | **Tak** |
| 4 | Type-checker: scalary w globalScope, `resolveType` obsługuje UserTypeRef('i32') | Naprawia krok 1-3 |
| 5 | Parser `parseDecl()`: NamespaceDecl, NamespacedDecl | Nie (nowa składnia) |
| 6 | Parser `parseCallOrPrimary()`: QualifiedName zamiast TypeConstructorExpr | **Tak** — wymaga krok 7-8 |
| 7 | Type-checker: inferQualifiedName(), Scope.namespaces, resolveQualified | Naprawia krok 6 |
| 8 | Codegen: QualifiedName dispatch, mangled names | Naprawia krok 6 |
| 9 | Support: ast-renderer, ast-to-source, macro-substitute, macro-expander | Naprawia krok 6 |
| 10 | macro-substitute.js: TYPE_KW → SCALAR_TYPES.has() | Fix |
| 11 | Testy: update + nowe test-namespace.js | Walidacja |

**Atomowe grupy:**
- Grupa A (TYPE_KW removal): kroki 1-4
- Grupa B (QualifiedName + namespaces): kroki 5-9
- Krok 10-11: fixup + testy

---

## 10. Ograniczenia v1

- Namespace'y tylko top-level (nie wewnątrz funkcji)
- Brak `use std::foo;` (import do bieżącego scope)
- Brak private/public — wszystko publiczne
- Brak metod na strukturach (fn z implicit `self`) — tylko "static functions" w namespace
- `void` pozostaje keyword (nie namespace-owalny)
- Brak namespace'd variables (WASM globals) — `std::BAR := 42;` parsuje się poprawnie, ale typechecker nie rejestruje w namespace scope, codegen nie emituje `global.get`/`global.set`. Deferred do v2.

---

## 12. Qualified type annotations (`QualifiedTypeRef`)

Importowany typ może być użyty **jako jawna adnotacja typowa** w deklaracjach zmiennych, parametrach funkcji i polach struktur.

**Zmienna lokalna:**
```
m := namespace "math.qlang";
v : m::Vec2 = m::Vec2::of(3, 4);       // explicit — zamiast type inference
w : mut m::Vec2 = m::Vec2::of(0, 0);   // mutable binding
```

**Parametr funkcji:**
```
getX := fn(v: m::Vec2) i32 {
    return v.x;
};
```

**Pole struktury (w pliku importującym):**
```
Entity := struct { id: i32; pos: m::Vec2; };
```

**AST node:**
```js
node('QualifiedTypeRef', {
    segments: string[],   // np. ['m', 'Vec2'] lub ['a', 'b', 'T']
    mut:      bool,       // true jeśli poprzedza 'mut'
    line, start, end
})
```

`parseType()` (parser-exprs.js) po zjedzeniu `IDENT` sprawdza `::` — jeśli obecne, zbiera kolejne segmenty i emituje `QualifiedTypeRef` zamiast `UserTypeRef`.

`resolveType()` (staticTypeChecker.js) obsługuje `QualifiedTypeRef` przez `scope.resolveQualified(segments)` — ten sam mechanizm alias expansion co dla `QualifiedName` w wyrażeniach. Jeśli segmenty wskazują na `StructType`, zwraca go (z propagacją `mut`); inaczej rzuca `TypeError`.

---

## 13. Circular imports — zachowanie

| Funkcja | Zachowanie przy cyklicznych importach |
|---------|---------------------------------------|
| `compileMulti` | Rzuca `Error("Circular import: '...'")`; wykrywane przez `visiting: Set` w rekurencyjnym resolverze |
| `liveCompileMulti` | Cicho pomija cykliczny plik (`if (visiting.has(filename)) return;` w `buildLiveImportEnv`) — plik po prostu nie trafia do `importEnv`; brakujący namespace → standard type error, bez throw |

---

## 11. Status implementacji

> Zaktualizowano: 2025-06

| Element | Status | Notatki |
|---------|--------|---------|
| TYPE_KW elimination | ✅ Done | Scalary jako IDENT, `resolveType` obsługuje `UserTypeRef('i32')` |
| QualifiedName (zamiast TypeConstructorExpr) | ✅ Done | Parser, typechecker, codegen, ast-renderer, ast-to-source |
| NamespaceDecl (`std := namespace;`) | ✅ Done | Parser + typechecker Pass 0 |
| Namespace alias (`gfx := namespace Engine::Graphics;`) | ✅ Done | Parser + typechecker alias expansion |
| NamespacedDecl + FuncDecl (`std::foo := fn()`) | ✅ Done | Parser + typechecker (mangled names) + codegen |
| NamespacedDecl + VarDecl (`std::BAR := 42;`) | ⬜ v2 | Parser obsługuje, brak: namespace scope registration + WASM globals |
| Struct auto-namespace (`Player::of`, `Player::default`) | ✅ Done | checkStructDecl tworzy namespace automatycznie |
| Scalar namespaces (`i32::of`, `i32::default`) | ✅ Done | `_registerBuiltins()` |
| Scope.namespaces + resolveQualified | ✅ Done | staticAnalysis.js |
| Codegen: mangled names (`A::B` → `$A__B`) | ✅ Done | wat-encoder.js |
| liveTypecheck (IDE) — namespace support | ✅ Done | Pass 0 + NamespacedDecl + resolveType synced |
| DEFAULT_SNIPPET + test-snippet.js | ✅ Done | Namespace examples w snippecie |
| `NamespaceImport` (`x := namespace "file.qlang"`) | ✅ Done | Parser, TypeChecker Pass 0 (`mountNamespace` z importEnv), `compileMulti` rozwiązuje importy |
| `compileMulti(src, getFile)` + `liveCompileMulti` | ✅ Done | Multi-file pipeline; `compile` = alias; `liveCompileMulti` zwraca `importEnv` |
| Autocomplete dla importowanych namespace'ów | ✅ Done | `getScopeItems` (NamespaceImport), `getNamespaceMembers` Case A+B, `importEnv` w ide-state; wyklucza built-in skalary z podpowiedzi |
| Qualified type annotations (`QualifiedTypeRef`) | ✅ Done | `parseType()` emituje `QualifiedTypeRef`; `resolveType()` obsługuje przez `scope.resolveQualified()`; działa w zmiennych, parametrach fn i polach struct |
| Circular imports — zachowanie | ✅ Done | `compileMulti`: rzuca `Error("Circular import")`. `liveCompileMulti`: cicho pomija cykl; brakujący plik → type error zamiast throw |
| Tests: test-namespace.js | ✅ Done | Parser, typechecker, codegen, liveCompile, QualifiedTypeRef, circular imports |
