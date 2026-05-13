# Architecture Change Proposal

> Items 2, 3, 4, 5 implemented. Item 9 (pack MVP) implemented. See individual STATUS notes per section.

---

## 1. Two-pass typecheck/expand

> **STATUS: DEFERRED** — requires scope-snapshot at each `MacroCallStmt` site; deferred until macro system is more stable. See Option B in §Risk below.

**Motivation:**
- Today: `expand()` runs before `typecheck()`, so `_type` is not set on AST nodes during expansion → `typeof(x)` in `#if` is impossible.
- Today: a `MacroError` kills all LSP hints for the entire file, even for code outside macros.

**Proposed pipeline:**

```
tokenize → parse → typecheck(skipMacroCalls:true) → expand() → typecheck(newNodesOnly)
```

Phase 1 — `typecheck({ skipMacroCalls: true })`:
- Typechecks all ordinary code, sets `_type` on all non-macro nodes.
- Treats `MacroCallStmt` as opaque (skips without error).
- Always succeeds for well-typed non-macro code → LSP hover/autocomplete works for entire file even while a macro is being typed.

Phase 2 — `expand()`:
- Runs after phase 1, so `_type` is now set on all arguments passed to macros.
- Enables `typeof(x)` dispatch inside `#if`.

Phase 3 — `typecheck({ onlyNew: true })` (best-effort, wrapped in try/catch):
- Typechecks only the newly inserted nodes from expansion.
- Needs a **scope snapshot** at each `MacroCallStmt` site so the expander knows which scope to resume in.
- Two options for scope context:
  - **Option A (simpler):** re-run full typecheck (idempotent, already-typed nodes are no-ops) — double work but safe.
  - **Option B (efficient):** `scope.clone()` snapshot stored on each `MacroCallStmt` node at phase 1 boundary.

**Risk:** Medium. One extra guard in typechecker loop. Scope snapshot is the hardest part.

---

## 2. Resilient BFS parser

> **STATUS: IMPLEMENTED** — ErrorNode, top-level i statement-level recovery, `liveCompile()` z debounce, downstream guards w TC/expander/renderer/LSP. Parser nigdy nie rzuca — zwraca ErrorNode. `resilientParserPlan.md` — wszystkie milestones M0–M9 ✅.

---

## 3. `#expand` — rename from `#for val in vals`

> **STATUS: REMOVED** — `#expand val in @param { body }` has been removed from the language. Replaced by the built-in `unpack!` macro (§15). The `#name` stringify mechanism still works.

**Motivation:** QLang intentionally has no `for` loop in the language (it lives in std-library macros). Having `#for` as a compile-time construct is misleading. `#expand` is semantically honest: "expand this argument list at compile time".

**Change:** Rename the variadic comptime unroll syntax from:
```
#for val in vals { ... }
```
to:
```
#expand val in vals { ... }
```

**Open question:** Exact delimiters — `#expand val in vals { }` vs `#expand(val : vals) { }`.

**Dependency:** Requires two-pass pipeline (change 2) to support `typeof(val)` inside the body.

---

## 4. `void` return type + discard warning

> **STATUS: PARTIALLY IMPLEMENTED** — `void` return type, bare `return;`, and void codegen are live. Discard warning for non-void `ExprStmt` (calling a non-void function as a statement) not yet added.

**Motivation:** QLang is side-effect heavy and currently has no `void` type. Functions that exist only for their side effects must declare an arbitrary return type or use `_ := f()` as a discard pattern — both are unnatural.

**Change:**
- Add `void` as a valid return type keyword in the parser and typechecker.
- `fn() void { ... }` — function with no return value. No `return` expression required (bare `return;` or fall-through both allowed).
- `ExprStmt` (calling a function as a statement, e.g. `f(x);`) remains legal in the grammar for all return types.
- **Warning** (not error): if `f()` returns a non-`void` type and the result is discarded in an `ExprStmt`, the typechecker emits a `TypeWarning: return value of 'f' (i32) is discarded`.
- Functions returning `void` called as `ExprStmt` produce no warning — that is the intended usage.

**Grammar change:** minimal — `void` added to `type` rule as a terminal keyword. Typechecker adds one check in `ExprStmt` handling.

**Note:** No `_ =` discard operator for now. The explicit discard pattern can be revisited if the warning becomes too noisy in practice.

**Risk:** Low. Isolated to typechecker and codegen (void functions emit no return value instruction).

---

## 5. `arr.[n]` replaces `arr[n]` — unified bracket access syntax

> **STATUS: IMPLEMENTED** — `arr[i]`/`IndexExpr` removed from parser, typechecker, codegen, LSP, and ast-to-source. `arr.[i]`/`BracketAccessExpr` is the only syntax.

**Motivation:** Currently two syntaxes exist for array element access: `arr[i]` (standard) and `arr.[i]` (`BracketAccessExpr`, added for macro compatibility). Having both means two codepaths in the parser, typechecker, and codegen, and ambiguity for tooling and LLMs.

**Change:** Remove `arr[i]` from the grammar entirely. `arr.[i]` becomes the single canonical syntax for array element access everywhere — in user code, in macros, in documentation.

```
arr.[0]          // read
arr.[i] = 99;    // write (if array<mut T, N>)
```

**Rationale:** `.[i]` is consistent with other postfix operators (`.size`, `.*`, `.*(args)`) — all member/postfix operations begin with `.`. `[i]` is an inconsistency in the postfix chain.

**Cost:** Breaking change. All existing code using `arr[i]` must be updated. Tests updated. Spec updated.

**Risk:** Low for the compiler. Medium for migration (automated sed-replace is safe for non-nested cases).

---

## 6. `T::of` reserved for user-defined types

**Motivation:** `T::of(v)` currently duplicates `as<T>(v)` for scalar types. However, `T::of` has a distinct future role: it will be the canonical constructor syntax for user-defined types (structs, enums, etc.).

**Decision:** Do not remove `T::of`. Instead, clarify the semantic split:
- `as<T>(v)` — low-level scalar bitwise/numeric conversion (int↔float↔bool). Always exists for scalars.
- `T::of(v)` — constructor call. For scalars today it is equivalent to `as<T>`. For user-defined types in the future it will invoke a user-supplied constructor.
- `T::default` and `T::uninitialized` — zero/uninitialized value constructors. Carry over naturally to user-defined types.

**No change to the compiler today.** This is a documentation/spec clarification that reserves `T::of` for the constructor role and prevents removing it in a cleanup pass.

---

## 7. `slice<T>` — open design problem

**Motivation:** Every function operating on variable-length data currently requires a `ptr<T> + u32` pair (e.g. `print(p: ptr<u8>, size: u32)`). This is C from 1972. In practice, all string/buffer operations will look like this. A `slice<T>` fat pointer would eliminate the pattern entirely.

**Proposed semantics:**
```
slice<T>       // (ptr<T>, u32 size) — fat pointer, passed by value
slice<mut T>   // fat pointer to mutable elements
```

**This is a split problem — two parts need separate decisions:**

**Part A — language primitive:**
Does `slice<T>` need to be a first-class type in the language (with its own syntax in the type grammar, typechecker, codegen), or can it be expressed as a struct once structs exist? If it's a language primitive, it needs special treatment: `arr` implicitly coerces to `slice<T>` when passed to a function expecting one, `s.ptr` and `s.size` are built-in member accesses.

**Part B — std library:**
Most of the ergonomics (`slice` creation from arrays, string slicing, bounds-checked indexing) belongs in the std library. But the language must provide a stable ABI for slices before std can be written.

**Open questions:**
- Is `slice<T>` a built-in type or a std struct?
- Does implicit coerce from `array<T, N>` to `slice<T>` happen at call sites, or is it explicit?
- How does `slice<mut T>` interact with `array<T, N>` (const elements) — is coercion an error?
- What is the WASM representation — two `i32` locals passed as separate params, or a struct in linear memory?

**Decision:** Defer until structs exist. At that point, evaluate whether `slice<T>` as a language-level built-in (with implicit coerce) is worth the complexity over a std struct with explicit construction.

**Risk:** High if done before structs. Low as a std struct after structs.

---

## 8. Generics as macro sugar (QLangte++)

**Motivation:** Avoid a separate generics system that duplicates expander logic.

**Insight:** `fn<T>(a: T, b: T) T` is syntactic sugar for `macro(T: type)` + monomorphization in the expander. One mechanism, two syntaxes.

**Change:** `fn<T>` desugars to a `MacroDecl` with a `type`-kinded parameter. The expander handles monomorphization (one concrete copy per unique `T` call site).

**Risk:** Low design risk (unified). High implementation effort. QLang++ milestone only.

---

## 9. `pack` — variadic comptime type + `[...]` literal syntax

> **STATUS: IMPLEMENTED (MVP)** — `pack`/`pack<kind>` macro params, `PackLiteral` (`[...]`) primary, and `unpack!(vals, iter, { body })` built-in unroll are live (§15). `#expand` removed. Pack literal not assignable to a variable (typechecker guard). No implicit sugar (bare trailing args not auto-wrapped), no runtime collapse to `array<variant<...>>` (requires `variant`).

**Motivation:** Macros need a way to accept variable numbers of arguments. Functions need a way to pass heterogeneous lists. Both share the same compile-time concept: an ordered bag of values whose types are known statically.

---

### Literal syntax: `[...]` is canonical, bare args are sugar

**Canonical form — always unambiguous:**
```
log!(x, [42, "hello", true])   // explicit pack literal
zip!([1, 2, 3], [4, 5, 6])     // two explicit packs — required when macro has multiple pack params
```

**Syntactic sugar — bare trailing args collapse to implicit `[...]`:**
```
log!(x, 42, "hello", true)     // sugar for: log!(x, [42, "hello", true])
```

The rule: bare args after the last non-pack parameter are implicitly wrapped in `[...]`. This desugaring is defined in the spec, not the parser — the canonical AST always contains a `PackLiteral` node. Sugar is only at the source level.

**Constraint:** a `pack` parameter without explicit `[...]` must be the last parameter. The `[...]` form may appear in any position.

---

### Type: `pack<any>` by default

A `[...]` literal produces `pack<any>` — a compile-time heterogeneous sequence. The element types are tracked individually by the compiler but the pack itself has no single element type.

```
p := [1, true, "hi"];   // pack<any> — comptime only, no runtime representation
```

---

### In macros: narrowed to a specific kind

Inside a macro declaration, `pack` parameters can be narrowed to a `kind` — the same set used for scalar params today:

```
log   := macro(vals: pack)        { }   // pack<any>  — heterogeneous, types via #if typeof
sum   := macro(vals: pack<expr>)  { }   // all elements must be expressions (unevaluated AST)
names := macro(vals: pack<ident>) { }   // all elements must be identifiers
```

Type checking of individual elements happens inside `#expand` via `#if typeof`, consistent with the two-pass pipeline (change 2).

---

### Special case today: string literals `"..."`

String literals `"hello"` are already a `pack` of `u8` values. At a runtime assignment site they collapse to `array<u8, N>`:

```
x : array<u8, 5> = "hello";   // pack<u8> literal → array<u8, 5> at assignment
```

This is the only runtime collapse that exists today. It is the reference implementation for how pack → concrete type collapse works.

**Note:** Future implementations may need a dedicated `kind` for string packs in macro error reporting, since a bare `"..."` passed to a `pack<ident>` macro should produce a clear error rather than a confusing type mismatch.

---

### Future: runtime collapse to `array<variant<...>, N>`

When `variant` exists, a `pack<any>` passed to a function (not a macro) will collapse to `array<variant<T1, T2, ...>, N>` where the variant types are inferred from the elements:

```
// future
print_all := fn(vals: array<variant<i32, bool, str>, ?>) void { ... }
print_all!([42, true, "hi"])   // pack<any> → array<variant<i32, bool, str>, 3>
```

**Risk:** Low for the comptime/macro subset (Phase 1). High for the runtime collapse (requires `variant`).

---

## 10. `scope` binding modifier + phase system (REJECTED: unposible to guarantee safety)

**Motivation:** QLang needs a way to express that a value must not escape a given scope — e.g. stack-allocated buffers, RAII handles, arena slices. A full lifetime system (à la Rust) would be sound but far too complex. QLang instead adopts a single-level escape restriction that is formally sound without borrow checking.

**`scope` is a modifier, not a type:**
`scope` qualifies a binding, like `mut`. It is not part of the type grammar.
- `scope ptr<T>` — a pointer that cannot escape the current scope. Valid.
- `ptr<scope T>` — **ParseError**: `scope` cannot appear inside a type expression.

**Core invariant — `scope` cannot be stripped:**
A `scope T` value cannot be assigned to a non-`scope` binding. The other direction is always fine:
```
x: scope i32 = 42;
y: i32 = x;         // TypeError: cannot assign scope T to T
z: scope i32 = x;   // OK
```
This single rule eliminates the pointer-escape problem: a dangling reference cannot be created by widening the binding qualifier.

**Contagious `&` rule (makes the system sound):**
Taking the address of a `scope`-qualified value automatically produces a `scope ptr<T>`, not a plain `ptr<T>`:
```
&(scope T)  →  scope ptr<T>    // enforced by typechecker
```
Without this rule, `p: ptr<T> = &s` would silently strip the `scope` qualifier. With it, the typechecker rejects the assignment because `p` is not `scope`-qualified. The rule propagates transitively through every address-of expression that touches a `scope` value.

**Phase system (unified view):**

| Phase | Syntax | Meaning | Direction |
|---|---|---|---|
| 0 | `#T` | comptime — value known at compile time | ← can flow to any phase |
| 1 | `scope T` | local — cannot escape current scope | ← can flow to phase 2 |
| 2 | `T` | default — free runtime value | (baseline) |
| 3 | `global T` | *(future)* static — lives for the entire program | cannot receive phase 2+ values |

**Flow rule:** A value can flow towards *longer-lived* phases (0 → 1 → 2 is fine). Flowing towards *shorter-lived* phases is a TypeError — in particular, assigning a phase-2 local value to a `global` binding is rejected: the local may be on the stack, the global outlives it. **`global` is included here for completeness as the natural phase-3 extension — it is not scheduled for implementation.**

**Connection to `pack`:** `pack` values are phase 0 (comptime). `scope` is phase 1 (local). Both are instances of the same mechanism: "value cannot cross a phase boundary in the wrong direction." QLang intentionally stops here — it names the two boundary points that matter in practice rather than implementing a full modal type theory.

**Soundness note:** With the contagious `&` rule, the system is a *single-region ownership model*. There is only one constraint (scope cannot be stripped), and `&` propagates it. No lifetimes, no borrow checker. Estimated cost: ~100 lines in the typechecker.

**Note — function returning `scope T`:** Deferred. The semantics interact with macros and need a separate design pass.

**Risk:** Low for `scope`. `global` is future — excluded from current implementation scope.

---

---

## 11. `defer` — deterministic cleanup statement

> **STATUS: IMPLEMENTED** — `defer expr;` and `defer target = value;` keyword statements. A `deferPass` pipeline pass (after typecheck, before codegen) rewrites `DeferStmt` nodes by injecting deferred statements reversed before each `ReturnStmt` and at block end. Strategy is isolated in `compiler/defer-pass.js` for future swap.
>
> **Extension (stmt-form):** `defer target = value;` is now supported as an assignment-deferred statement. Parser detects `=` after the deferred expression and wraps it as an `AssignStmt` stored in `DeferStmt.stmt` (expr-form uses `DeferStmt.expr`). All pipeline stages (staticTypeChecker, defer-pass, macro-expander) handle both forms.
>
> **ptr-via-defer fix:** Scalars whose address is taken (`&local`) are assigned a shadow-stack slot. `emitIdent` now loads from that slot when `local.memAddr` is set, so writes via pointer (e.g. `defer cleanup(&tt)` where `cleanup` mutates `x.* = 0`) are reflected at the call site.

**Motivation:** The simplest possible resource-safety primitive. No new types, no ownership model, no lifetimes. Just "run this at scope exit."

**Syntax:**
```
{
    f : raw File = File::open("log.txt");
    defer File::close(f);       // registered here, executed at }
    f.write(data, len);
    // ... scope exits → File::close(f) runs automatically
}
```

**Rules:**
- `defer expr;` registers `expr` for execution when the enclosing `{ }` block exits — by fall-through, by `return`, or by early exit.
- Multiple `defer`s in the same block execute in reverse registration order (stack discipline).
- The deferred expression is evaluated at exit, not at the `defer` statement. Variables captured are by reference to the current scope.
- `defer` is a statement, not an expression. It cannot be nested inside a condition or loop without its own block.

**Codegen:** Transforms to a `try/finally`-style frame in WAT, or equivalently, an exit thunk injected at each block exit point.

**Risk:** Low. ~50 lines in codegen. No parser changes beyond a new statement keyword. No type system changes. Solves ~80% of resource management without ownership complexity.

**Dependency:** None. Can be implemented before structs.

---

## 12. `resource` — first-class ownership type *(VERY DISTANT FUTURE — possibly optional extension)*

> **STATUS: DESIGN ONLY — very distant future. Requires structs, methods, and `defer` (§11). May ship as an opt-in language extension rather than core QLang.**

**Motivation:** `defer` covers simple cases but leaves the programmer responsible for pairing every `open` with a `defer close`. For system-level code (files, sockets, GPU handles, arena slices) QLang needs a way to express that a value *owns* a resource and that the cleanup is automatic, zero-overhead, and composable — without the complexity of Rust lifetimes.

---

### `resource` as a declaration form

`resource` is a declaration keyword, analogous to `fn`. It is **not** a wrapper type like `resource<T>`.

```
File := resource {
    handle: ptr<u8>,
};

open  := construct<File>(path: ptr<u8>) { ... }   // RAII constructor
close := destruct<File>()               { ... }   // RAII destructor (auto-called)
write := method<File>(data: ptr<u8>, len: u32) void { ... }
```

A `resource` declaration defines a struct layout plus the compiler-known constructor/destructor pair. The compiler owns the cleanup discipline — the programmer cannot forget `close`.

---

### `raw` modifier — opt out of RAII

`raw` qualifies a binding, exactly like `mut`. `raw File` = unmanaged handle, C-style.

```
// RAII (default) — compiler inserts defer:
f :<- File::open("log.txt");    // :<- = RAII binding
f.write(data, len);
// scope exits → File::close(f) called automatically

// Manual (raw) — programmer manages lifetime:
h : raw File = File::open("log.txt");
File::write(h, data, len);
File::close(h);                 // explicit — no auto cleanup
```

**Rule:** `raw` is required for array storage and pointer manipulation (see below). Default (no `raw`) is always RAII.

---

### Ownership transfer with `<-` and `as<T>`

```
return <-f;                     // move out: f.valid = false, pending defer = no-op
g :<- <-f;                      // move into new RAII binding

as<File>(raw_h)                 // raw → RAII: compiler inserts defer for result
as<raw File>(f)                 // RAII → raw: f.valid = false, defer dropped
```

---

### `valid` — implicit validity field, with macro-style `@valid` override

Every `resource` has an implicit hidden boolean field `valid`. It is set to `false` after a move or destruct. This is the safety net:

```
f :<- File::open("log.txt");    // valid = true
g :<- <-f;                      // f.valid = false, g.valid = true
f.write(data, len);             // safe mode: panic — use after move
```

**`@valid` override — zero overhead by reusing an existing field:**

A resource can declare `@valid = expr` to replace the implicit bool with a computed property derived from existing fields. This is the "macro-as-property" mechanism: the `valid` check becomes an alias to the sentinel that already exists in the data.

```
File := resource {
    handle: ptr<u8>,
    @valid = (handle != null);  // reuse ptr sentinel — no extra field allocated
};

Fd := resource {
    fd: i32,
    @valid = (fd >= 0);         // reuse POSIX sentinel
};
```

- No extra memory: `valid` is computed from existing state, not stored.
- No overhead: the expression is inlined at every check site.
- Consistent API: code using `f.valid` or the compiler-inserted safe-mode guards works the same way regardless of whether `@valid` is overridden.

**Without `@valid`:** compiler allocates one hidden `bool` field at the end of the resource struct.

---

### Safe mode vs release mode

| Mode | Behaviour |
|---|---|
| **safe** (default in debug) | Compiler inserts `if (!f.valid) { panic("use after move"); }` before every method call on a resource. |
| **release** | No guards inserted. Zero overhead. Programmer is responsible (or uses `raw`). |

Safe mode is an opt-per-build flag, not a type-level annotation. The guards are the only runtime cost of the `resource` system.

---

### Structural rules

| Situation | Result |
|---|---|
| `array<File, N>` | **TypeError**: arrays cannot manage resource lifetimes. Use `array<raw File, N>` + manual `defer`. |
| `ptr<resource<T>>` | Allowed — power-user pattern for implementing smart-pointer types. |
| `struct { f: File }` | **TypeError**: "struct containing resource field must itself be declared as `resource`". Resources are contagious. |
| `struct { f: raw File }` | **Allowed** — `raw` strips ownership semantics. The struct is a plain data container; programmer manages `f`'s lifetime manually (via `defer` or explicit `close`). This closes the system: structs with unmanaged handles are expressible without forcing the struct into a `resource` declaration. |

---

### Macro compatibility

Macros expand inline in the caller's scope — no stack frame boundary is crossed during expansion. Therefore:
- `valid` is visible and accessible inside macro bodies that operate on a resource.
- The `defer` inserted by `:<-` belongs to the caller's scope, *outside* the macro expansion. Macros cannot accidentally extend the lifetime of a resource.
- Safe-mode guards inside macros compile identically to guards in regular code.

---

### Dependency chain

```
structs + methods  →  defer (§11)  →  resource (§12)
```

`resource` cannot be implemented before structs/methods exist. `defer` is independently shippable before structs and should be done first. Both are **QLang++ milestone** features.

**Note on scope as optional extension:** `resource` adds significant surface area to the type system (new keyword, new binding operators `:<-`, `<-`, ownership rules, `@valid`). If QLang targets scripting/education use cases, `resource` may ship as a separate opt-in module (`#feature resource`) that can be included in systems-programming builds but excluded from lighter profiles of the language.

---

## 13. Structs + wielopasowy type-check

> **STATUS: DESIGN — kolejny po podstawowych bugfixach**

---

### 13.1 Składnia deklaracji

```
Player := struct {
    name   : array<u8, 32> = "default";   // const field
    hp     : mut u32 = 30;                // mut field
};
```

- `struct { ... }` — nowe wyrażenie prawej strony dla `Name := struct { ... };`
- Pola z `mut` — analogia do `array<mut T, N>`: element uczestniczy w mutability rodzica
- Pole bez `mut` — zawsze const, niezależnie od binding
- Domyślna wartość pola jest wymagana (umożliwia `T::default` bez dodatkowej logiki)
- Brak słów kluczowych `class`, `impl`, `new` — struct to czysty typ danych

---

### 13.2 Mutability — dwa poziomy jak dla tablic

Reguła: pole `mut` jest zapisywalne **tylko gdy binding jest `mut`**. Identyczna mechanika co `array<mut T, N>`:

```
x : mut Player = Player::default;
x.hp = 50;       // OK — binding mut + pole mut
x.name = "ab";   // [Type] Error: field 'name' is const

y : Player = x;  // kopia (copy semantic), binding const
y.hp = 1;        // [Type] Error: binding const
```

**Łańcuchowy `mut` (zagnieżdżone structy):**

Każde ogniwo łańcucha musi mieć `mut`:

```
Weapon := struct { dmg : mut i32 = 5; };
Player := struct { name : array<u8,32> = "x"; weapon : mut Weapon; };

p : mut Player = Player::default;
p.weapon.dmg = 10;   // OK — p mut + weapon mut + dmg mut

q : Player = Player::default;
q.weapon.dmg = 1;    // [Type] Error: binding 'q' is const

Player2 := struct { weapon : Weapon; };
r : mut Player2 = Player2::default;
r.weapon.dmg = 10;   // [Type] Error: field 'weapon' is const
```

---

### 13.3 Copy semantics — płytka kopia bitowa

Przypisanie struct kopiuje bitowo (płytka kopia). `ptr<T>` wewnątrz struct kopiuje adres, nie wartość za nim — analogia do `array<ptr<T>, N>`.

---

### 13.4 `T::of` / `T::default` zwracają const `T`

`T::of` i `T::default` produkują **const `T`** — analogicznie do każdego innego wyrażenia w języku. Mutability binding pochodzi wyłącznie z jawnej adnotacji `mut` na zmiennej:

```
x : mut i32    = i32::of(5);          // OK — binding mut z adnotacji
y : i32        = i32::of(5);          // OK — binding const
p : mut Player = Player::of("x", 10); // OK — binding mut z adnotacji
q : Player     = Player::default;     // OK — binding const
```

**Uzasadnienie:** Spójność z istniejącą regułą języka — `mut` jest właściwością binding, nie wartości. `x := expr` zawsze daje const niezależnie od wyrażenia po prawej. `T::of` / `T::default` nie są wyjątkiem — `mut` na binding musi być zawsze jawne.

---

### 13.5 `as<T>` — mut decay

`as<T>` daje dokładnie tyle `mut` co jawnie napisane w `T`. Tymczasowa wartość z `as` jest l-value, ale `mut` w źródle nie przenosi się automatycznie:

```
x : mut Player = Player::default;
as<Player>(x).hp = 30;   // [Type] Error: field 'hp' is const (as<Player> → const Player)
```

Tabela mut decay przez `as`:

| Źródło | Cast | Wynik |
|---|---|---|
| `mut Player` | `as<Player>` | `Player` (const) |
| `ptr<mut T>` | `as<ptr<T>>` | `ptr<T>` (const pointee) |
| `mut ptr<T>` | `as<ptr<T>>` | `ptr<T>` (const binding) |

To ta sama reguła co dla binding: `mut` musi być zawsze jawne w typie docelowym.

---

### 13.6 `==` na structach — błąd

```
a == b;  // [Type] Error: Operator '==' cannot be applied to struct type 'Player'
```

Analogia z `f32` — ta sama klasa błędu.

---

### 13.7 Forward references przez `ptr<T>`

```
Node := struct {
    value : i32 = 0;
    next  : ptr<Node>;   // OK — ptr<T> nie wymaga kompletnej definicji T
};

Bad := struct {
    other : Bad;   // [Type] Error: Cannot use incomplete type 'Bad' by value (infinite size)
};
```

**Reguła:** `ptr<T>` gdzie `T` jest niezadeklarowane lub niekompletne jest dozwolone — ptr to zawsze `i32`. Użycie `T` bezpośrednio jako pola wymaga kompletnej definicji.

---

### 13.8 Wielopasowy type-check — wymagany dla structów

Forward references i wzajemna rekurencja między structami wymagają wielopasowego type-checkera:

```
tokenize → parse → [nameCollect → bodyResolve → typecheck] × N → done
```

**Przebieg 1 — nameCollect:**
- Zbiera nazwy wszystkich top-level deklaracji (`struct`, funkcje, makra)
- Rejestruje typy jako "znane nazwy" bez rozwiązywania ciał
- Umożliwia `ptr<Node>` w ciele `Node` bez błędu "undefined type"

**Przebieg 2 — bodyResolve:**
- Rozwiązuje typy pól wszystkich structów
- Sprawdza cykliczne osadzanie przez wartość (błąd) vs przez `ptr` (OK)
- Oblicza rozmiary (suma pól, alignment dla WASM linear memory)

**Przebieg 3+ — typecheck:**
- Standardowy type-check wyrażeń i przypisań
- W przypadku wzajemnej rekurencji / makr rozwijających nowe typy: pętla do stabilizacji (brak nowych błędów w kolejnym przebiegu)

**Związek z §1 (Two-pass typecheck/expand):** oba mechanizmy można połączyć w jeden uogólniony wielopasowy scheduler. Każdy przebieg jest idempotentny na już-sprawdzonych węzłach.

**Risk:** Medium. Wymaga refaktoryzacji type-checkera (aktualnie single-pass). Niezależne od resiliency parsera (§2). Blokuje §6 (slice), §12 (resource).

---

## 14. Trailing block sugar — `name!(args) { body };`

> **STATUS: IMPLEMENTED** — Parser: after `name!(...)`, if next token is `{`, consumed as trailing block arg appended to args. Fully backward-compatible.

**Motivation:** Macros taking a `block` as their last parameter currently require passing the block inside the argument list:

```
for_each!(nums, val, {
    total = total + val;
});
```

The closing `});` is visually noisy and makes user-defined macros look different from built-in control flow. Every language that supports user-defined control flow (Kotlin, Swift, Ruby, Nim) solves this with a trailing block / trailing lambda syntax.

---

### Change

When the last declared parameter of a macro has kind `block`, the caller may move the block argument outside the closing `)`:

```
// canonical (always valid)
for_each!(nums, val, { total = total + val; });

// trailing block sugar (allowed when last param is block)
for_each!(nums, val) {
    total = total + val;
};
```

Both forms parse to an identical `MacroCallStmt` AST node. The sugar is source-level only — the canonical AST always contains the block as a regular argument.

---

### Parser rule

after `name!(...)`, if the next token is `{`, always treat it as a trailing block. If the macro's last param is not `block`, the expander emits a kind-check error — identical to passing a block in the normal position. No parser ambiguity: `name!(x);` followed by a freestanding `ScopeBlock { }` on the next line already has `;` before `{`, so the greedy rule does not fire.

---

### Disambiguation

The key invariant: `MacroCallStmt` always ends with `;`. Therefore:

```
f!(x);        // ← ; before { → no trailing block
{ x = 1; }    // separate ScopeBlock (legal)

f!(x) { };    // ← { immediately after ) → trailing block, ; after }
```

No ambiguity with `ScopeBlock` — a freestanding block after `;` is always a separate statement.

---

### Constraint: last param only

Sugar applies only when the `block` parameter is last in the declaration:

```
// sugar available — block is last
for_each := macro(arr: expr, elem: ident, body: block) { ... };
for_each!(nums, val) { total = total + val; };   // OK

// sugar NOT available — block is not last
bad := macro(body: block, n: expr) { ... };
bad!({ x = 1; }, 5);   // must use canonical form
```

This mirrors the `pack` trailing-sugar rule (pack must also be last). Author of a macro signals that trailing-block is supported simply by placing `block` last.

---

### Effect on std-library control flow

With trailing block sugar, user-defined macros are visually indistinguishable from built-in control flow:

```
// stdlib macros with trailing block sugar:

for_each!(nums, val) {
    total = total + val;
};

repeat!(5) {
    counter = counter + 1;
};

while_true!(done) {
    done = check();
};

unpack!(@vals, v) {
    $s = $s + v;
};
```

QLang does not need `for` as a built-in keyword. The only constructs that must remain built-in are `while` (needs `break` in codegen) and `if` (needs `bool` check in TC). Everything else — `for`, `foreach`, `repeat`, `map`, `filter`, `defer`-style wrappers — can live in a std-library macro file, loaded before user code.

---

### Named block args (multi-block macros)

When a macro needs more than one block, trailing sugar does not apply. Named arguments inside `()` are the canonical form:

```
errorHandler!(
    try     = { risky_operation(); },
    catch   = { handle_error();   },
    finally = { cleanup();        }
);
```

Named args require a separate expander change (§14.1, see below) and are independent of trailing block sugar. Trailing sugar and named args are orthogonal features — trailing sugar is the 80% case (single body block), named args cover the remainder.

---

### §14.1 Named macro arguments (future)

**Not in scope for this proposal — recorded here for completeness.**

Syntax: `name = value` pairs inside `!(...)`. Expander matches by name instead of position. Out-of-order args allowed. Optional params (with default) become possible.

```
macro(try: block, catch: block, finally: block) { ... }
```

Requires expander changes: named-arg matching, optionality rules. Parser change: detect `IDENT '=' expr` inside `!(...)` as named arg (not assignment — `=` inside `!()` is unambiguous since `AssignStmt` never appears as an expression argument).

**Risk for §14.1:** Medium. Isolated to expander. No codegen changes.

---

### Implementation cost

| Component | Change |
|---|---|
| Parser | After `name!(...)`, if next token = `{`: consume as trailing block arg, expect `;` after `}` |
| Expander | No change — receives canonical `MacroCallStmt` with block arg in normal position |
| TC / Codegen | No change |
| LSP / hover | Trailing block arg should highlight as `block` kind — same as inline block |
| Tests | New suite: trailing block sugar for `for_each`, `repeat`, `unpack` |

**Risk:** Low. Parser addition of ~15 lines. Zero downstream changes. Fully backward-compatible (canonical form always valid).

---

## 15. `unpack!` — built-in macro for pack iteration

> **STATUS: IMPLEMENTED** — Built-in macro pre-registered in the expander. `unpack!(vals, iter, { body });` or with trailing block sugar `unpack!(vals, iter) { body };`. Params `(vals: pack, iter: ident, body: block)`. Kind-check errors identical to any other macro. `#expand` removed.

### Motivation

`#expand val in pack { body }` is a **compiler built-in** — it uses `#`. replace `#expand` with `unpack!(vals: pack, iter: ident, body: block)`

### Macro definition


Parameter kinds:
- `vals: pack` — the pack to iterate; caller passes it with `@name` to splice from the call-site pack binding
- `iter: ident` — name of the loop variable **at the call site**; no sigil at call-site (`ident` kind rule)
- `body: block` — the loop body; receives trailing block sugar (§14)

macro should be included in autocomplete mechanism, and under typehint it should show it type as `unpack : macro(vals: pack, iter: ident, body: block)`

### Call-site syntax

```qlang
// canonical form
unpack!(vals, v, { $s = $s + v; });

// trailing block sugar (§14)
unpack!(vals, v) {
    $s = $s + v;
};
```

Inside the body:
- `v` is the loop variable, bound fresh for every element by `#expand`
- `$s` is a gensym from an outer macro (if `unpack!` is called inside another macro body); or a regular binding at call-site

### Sigil rules at call-site

| Argument | Kind | Sigil at call-site | Reason |
|---|---|---|---|
| `@vals` | `pack` | `@` — splice existing pack | Substitution literal |
| `v` | `ident` | none | `ident` kind: bare name, no sigil |
| `{ ... }` | `block` | n/a — trailing sugar | Block literal |

This follows the same rule as `for_each!(nums, val) { ... }` — the loop variable name is always a bare identifier. keep mechanism of working from legacy `#expand val in @pack { body }`

### Expansion example

```qlang
// given:
vals : pack = [10, 20, 30];
sum : mut i32 = 0;
unpack!(@vals, v) {
    sum = sum + v;
};

// expands to (conceptually):
sum = sum + 10;
sum = sum + 20;
sum = sum + 30;
```

### Dependency

- §9 (`pack` type + `[...]` literal) — `vals: pack` param requires pack support
- §3 (`#expand` compiler built-in) — `unpack!` body uses `#expand @vals -> @iter { @body; }`
- §14 (trailing block sugar) — enables `unpack!(@vals, v) { ... };` call form

**Risk:** Low. The macro is pure user-space code once §3, §9, §14 are implemented. No compiler changes beyond those three.

---

## Implementation order (when ready)

| Priority | Change | Risk | Dependency |
|---|---|---|---|
| 1 | `arr.[n]` replaces `arr[n]` | Low | None |
| 2 | `pack` + `[...]` literal syntax | Low | None |
| 3 | `void` return type + discard warning | Low | None |
| 4 | Structs + wielopasowy type-check | Medium | None — blokuje slice, resource |
| 5 | Resilient BFS parser | High | Independent |
| 6 | `defer` statement | Low | None |

### WIP / Future

| Change | Risk | Dependency |
|---|---|---|
| Two-pass typecheck/expand | Medium | None |
| `#expand` syntax + `typeof` in `#if` | Medium | Two-pass typecheck |
| `slice<T>` | High | Structs first |
| Generics as macro sugar | High | `#expand` + `typeof` |
| `resource` ownership type | Very High | Structs + methods + `defer` |
