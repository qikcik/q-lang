# QLang — Game Development Architecture — Refined Plan

> Session: 2026-05-14 (iteration 3: 2026-05-14)
> Scope: Adding game development support to QLang  
> Council Leader (all topics): **D — Senior C++ Abomination**  
> Topics: 7 (API Layer, IDE Canvas, Input Sync, Game Loop, WebGL Abstraction, WASM Memory, QLang API Design)

**Glosariusz skrótów:**
- **SAB** = `SharedArrayBuffer` — wspólna pamięć między Worker a main thread; dostęp przez `Atomics.load/store/wait/notify`
- **RAF** = `requestAnimationFrame` — browser callback przed każdą klatką (~16ms przy 60fps); woła się tylko w main thread

## Otwarte pytania do Autora (odpowiedź wpłynie na decyzje poniżej)
- **Browsers:** Chrome-only / Chrome+Firefox / wszystkie incl. Safari iOS? → determinuje WebGPU vs WebGL2
- **Canvas layout:** panel wewnątrz IDE (jak konsola), czy modal overlay nad IDE?
- **Game complexity:** Pong/Snake/Sokoban, czy platformer z fizyką (tysiące entity/frame)?
- **Native targets:** czy QLang kiedyś na ARM/x86? Jeśli tak, API portability priorytet >= feature richness.

## Errata (błędy faktyczne odkryte przez code inspection)

### E1 — HEAP_BASE = 1024 (nie 65536)
Kod `wat-utils.js` linia 35: `export const HEAP_BASE = 1024`. Pierwotny raport błędnie pisał 65536. Shadowstack startuje od 1024; przy `(memory 1)` = 64KB jest ~63KB przestrzeni roboczej. Każda funkcja z array/struct locals alokuje w górę od 1024. String/array literals też używają BumpAllocator(base=1024) per-function — ich adresy są STATYCZNE (compile-time), ale dane inicjalizowane przez store-instructions runtime. Dwie różne funkcje mogą nakladać sie na te same adresy w 1024+ — jest to safe tylko dlatego że WASM jest single-threaded i stringi są re-inicjalizowane przy każdym wywołaniu. Jest to istniejący potential bug jeśli funcA woła funcB i obie mają literały na tych samych adresach: funcA po powrocie funcB widzi zmodyfikowane adresy.

### E2 — Krytyczny bug: extern! w imported namespace nie trafia do WASM import section
`pipeline.js` linia 147 (aktualny kod):
```js
if (decl.kind === 'FuncDecl' || decl.kind === 'NamespacedDecl') importedBodies.push(decl);
```
`VarDecl` z `_isRuntimeImport = true` (=extern! declarations) są WYKLUCZONE z merged AST. `buildWAT` → `collectAllImportDecls` operuje na `ast.body` i nie znajdzie extern! z importowanych plików. Wynik: WASM import section pominie wszystkie extern! z `gfx.qlang` → runtime "Unknown host function".

**Fix (jednolinijkowy, `pipeline.js` linia ~147):**
```js
if (decl.kind === 'FuncDecl' || decl.kind === 'NamespacedDecl'
    || (decl.kind === 'VarDecl' && decl._isRuntimeImport)) importedBodies.push(decl);
```
Ten fix musi być zrobiony i przetestowany ZANIM napiszemy `gfx.qlang`.

## Taksonomia extern! — Pull / Push / Sync

Obecny `extern!` mechanizm jest de facto 3-kategoriowym IPC. Każda nowa funkcja systemu/grafiki/inputu musi być sklasyfikowana:

| Kategoria | Semantyka | Przykłady | Atomics? |
|---|---|---|---|
| **Pull** | WASM pyta hosta, natychmiastowa odpowiedź (czyta z SAB) | `is_key_down`, `get_mouse_x`, `get_frame_time`, `window_should_close` | Nie — atomowy odczyt SAB |
| **Push** | WASM wysyła do hosta, brak odpowiedzi | `draw_rect`, `draw_line`, `play_sound`, `log_msg` | Nie — void call |
| **Sync** | WASM blokuje czekając na sygnał hosta | `begin_frame`, `stdin_read`, `debugger_brk` | TAK — Atomics.wait |

Zasada projektowa: **minimalizuj Sync** (blokuje Worker). Każdy Push jest "przenosny" na message-passing w przyszłości. Każdy Pull wymaga dedykowanego SAB slot lub małego pola w input SAB.

## Renderer Interface Pattern

Implementacja WebGL2 w `wasm-runner.js` powinna być klasą:
```js
class WebGL2Renderer {
  constructor(w, h) { /* create OffscreenCanvas, init WebGL2 */ }
  beginFrame() { this.batch.reset(); gl.clear(...); }
  endFrame()   { this.batch.flush(gl); return this.canvas.transferToImageBitmap(); }
  drawRect(x, y, w, h, rgba) { this.batch.pushRect(x, y, w, h, rgba); }
  drawLine(x0, y0, x1, y1, rgba) { this.batch.pushLine(...); }
  drawCircle(cx, cy, r, rgba) { this.batch.pushCircle(...); }
  drawRectOutline(x, y, w, h, thick, rgba) { ... }
}
```
Interfejs tej klasy = stabilna granica. Przejście na WebGPU = `class WebGPURenderer` z identycznym API. Switch w `init_window`: `renderer = supportsWebGPU ? new WebGPURenderer(...) : new WebGL2Renderer(...)`. Dla v1: WebGL2Renderer only.

---

## 1. API Layer Strategy

### Summary
Dwuwarstwowy system. Warstwa 0: ~18 `extern!` host functions w `wasm-runner.js` (moduł `"gfx"`) implementowane przez `WebGL2Renderer` class. Warstwa 1: plik `examples/gfx.qlang` z extern! deklaracjami — czytelny przez programistę, modyfikowalny, pozycjonowany jako "user-modifiable stdlib", nie locked runtime. JS-side batching (wewnątrz `end_frame`) ukrywa per-call overhead. OffscreenCanvas tworzony PO STRONIE WORKERA (`new OffscreenCanvas`) — nie transferowany z DOM, co pozwala na re-run bez teardown. Backend jest WebGL2 dla v1. Architektura umożliwia wymianę na WebGPU bez zmiany QLang API.

### Required Changes
- Fix **E2 bug** w `pipeline.js` (linia ~147): dodaj `|| (decl.kind === 'VarDecl' && decl._isRuntimeImport)` — bez tego nic nie zadziała
- Dodaj `hostFunctions.gfx` namespace do `ide/wasm-runner.js` — `WebGL2Renderer` class + 18 host functions (patrz Section 7 dla pełnej listy)
- Implementuj JS-side batch accumulator: 3 osobne batche (rects, lines, circles) pre-alokowane jako `Float32Array` przy `init_window`
- Stwórz `examples/gfx.qlang` z extern! deklaracjami (patrz Section 7)
- Stwórz `examples/keys.qlang` z named key constants + color constants

### Concrete Function API (18 funkcji v1)
```qlang
// Window / Frame                               Kategoria
init_window     : fn(w: i32, h: i32) void      = extern!("gfx.init_window");    // SYNC
begin_frame     : fn() void                     = extern!("gfx.begin_frame");    // SYNC
end_frame       : fn() void                     = extern!("gfx.end_frame");      // PUSH
window_should_close : fn() bool                 = extern!("gfx.window_should_close"); // PULL (v1: always false)
get_screen_w    : fn() i32                      = extern!("gfx.get_screen_w");   // PULL
get_screen_h    : fn() i32                      = extern!("gfx.get_screen_h");   // PULL

// Drawing
clear_background : fn(color: i32) void          = extern!("gfx.clear_background"); // PUSH
draw_rect        : fn(x:i32, y:i32, w:i32, h:i32, color:i32) void = extern!("gfx.draw_rect");
draw_rect_outline: fn(x:i32, y:i32, w:i32, h:i32, thick:i32, color:i32) void = extern!("gfx.draw_rect_outline");
draw_line        : fn(x0:i32, y0:i32, x1:i32, y1:i32, color:i32) void = extern!("gfx.draw_line");
draw_circle      : fn(cx:i32, cy:i32, r:i32, color:i32) void = extern!("gfx.draw_circle");

// Input — keyboard
is_key_down      : fn(key: i32) bool            = extern!("gfx.is_key_down");    // PULL
is_key_pressed   : fn(key: i32) bool            = extern!("gfx.is_key_pressed"); // PULL (edge)

// Input — mouse
get_mouse_x      : fn() i32                     = extern!("gfx.get_mouse_x");    // PULL
get_mouse_y      : fn() i32                     = extern!("gfx.get_mouse_y");    // PULL
is_mouse_btn_down: fn(btn: i32) bool            = extern!("gfx.is_mouse_btn_down"); // PULL

// Time
get_frame_time   : fn() f32                     = extern!("gfx.get_frame_time"); // PULL (sekundy)

// Color packing helper (QLang-level, nie extern!)
// color := (r << 24) | (g << 16) | (b << 8) | 255;
```
Kolory: packed RGBA_8888 jako `i32` (0xFF_RR_GG_BB kolejność). Stałe w `colors.qlang`: `RED := 0xFF0000FF;` etc.  
Koordynaty: pixel (0,0) = top-left — spójne z Raylib, HTML Canvas.  
`get_frame_time` zwraca f32 w sekundach (np. 0.0167 dla 60fps) — użyj do delta-physics.

### Architecture Notes

**Portability:** Wszystkie 18 funkcji mają 1:1 odpowiedniki w SDL2 (przyszły ARM/x86 target): `SDL_RenderDrawRect`, `SDL_PollEvent`, `SDL_GetTicks64` / `SDL_GetPerformanceCounter`. `window_should_close` ↔ `SDL_QUIT event flag`.

**Batch renderer:** `WebGL2Renderer` trzyma 3 pre-alokowane Float32Array (rects, lines, circles; max 1024 per frame). Każda seria primitywów tego samego typu → jeden draw call w `end_frame`. Nie alokuj per-frame. Kiedy batch full: emituj `{ type: 'warn', message: 'batch overflow' }` + discard (nie crash).

**WebGL2 vs WebGPU:** WebGL2 dla v1 — szersze wsparcie, prostszy setup. `WebGL2Renderer` class zapewnia że przejście na WebGPU to podmiana klasy, nie refaktor całego kodu. Jeśli potrzebujesz compute shaders (GPU physics) — to argument za WebGPU od razu; powiedz.

**Dynamic memory allocation:** NIE wymagana dla v1. Wzorzec `array<Entity, MAX_ENTITIES>` + `entity_count : mut i32` jest standardem w high-perf game development (Data-Oriented Design). Sokoban, Pong, Snake mieszczą się trivially w stack arrays.

**IPC foundation:** NIE robimy osobnego IPC mechanizmu. Istniejący `extern!` model z Atomics już jest 3-kategoriowym IPC (Pull/Push/Sync) udokumentowanym powyżej. Formalizujemy dokumentacją, nie nową składnią.

### Observations
- The existing `wasmImports` mechanism in `codegen.js` / `wat-encoder.js` / `wasm-runner.js` is already designed for exactly this pattern — `extern!("gfx.draw_rect", ...)` will produce an import entry the runner resolves against `hostFunctions.gfx.draw_rect`. No new language features required.
- Emscripten-compiled games use an identical pattern (host functions in the `env` module). This is a proven approach.
- Functional draw-list approach (Topic 1 E) is architecturally superior but requires fixed-size stack arrays visible to the programmer. Deferred to v2.

### Concrete Actions
- [x] Define the exact 20-function host API surface (see Topic 5 for the list)
- [x] Implement `hostFunctions.gfx` in `wasm-runner.js` using worker-owned `OffscreenCanvas` WebGL2 context
- [x] Write `examples/gfx.qlang` with `extern!` bindings + QLang-level wrappers
- [x] Write `examples/keys.qlang` with key code constants
- [x] Write `examples/pong.qlang` as acceptance test

### Needs Deeper Analysis
- **[DECYZJA UŻYTKOWNIKA]** Browser support target (determinuje WebGL2 vs WebGPU)
- **[DECYZJA UŻYTKOWNIKA]** Lokacja `gfx.qlang`: `examples/` (user-modifiable) vs `stdlib/` (oficjalne)?
- OffscreenCanvas + WebGL2 w Workers: Chrome 69+, Firefox 105+, Safari 16.4+. Przetestować w Firefox przed release (COEP headers via start.js są required).

---

## 2. IDE Canvas Window Integration

### Summary
`<qlang-canvas>` Web Component — wzorzec identyczny jak `<qlang-console>`. Adopts pre-existing `<canvas>` element z `index.html`. `<canvas>` jest hidden by default, pojawia się gdy program woła `gfx::init_window`. Rendering odbywa się **wyłącznie po stronie Workera** przez `new OffscreenCanvas(w, h)` z WebGL2 context. Per-frame: `OffscreenCanvas.transferToImageBitmap()` PostMessage → `ImageBitmapRenderingContext.transferFromImageBitmap()` na DOM canvas — zero-copy transfer. OffscreenCanvas jest tworzony przez Worker (nie transferowany z DOM), więc re-run = nowy Worker = nowy OffscreenCanvas — bez teardown problemów.

### Pełna sekwencja init_window (handshake)
```
Worker (init_window host fn):           Main thread (main.js):
  1. inputBuf = new SAB(64)
  2. store STATE_EXT_WAIT(6) in ctrl
  3. postMessage({                  →   4. receives 'window-open'
       type:'window-open',              5. saves inputBuf reference
       w, h, inputBuf                   6. shows <qlang-canvas> panel + resize
     })                                    (canvas.show(w, h))
  Atomics.wait(ctrl, 0, EXT_WAIT)  ←   7. store STATE_IDLE in ctrl
                                         Atomics.notify(ctrl, 0)
  8. wakes up, check ABORT
  9. renderer = new WebGL2Renderer(w,h)
  10. return (WASM continues)

Per-frame (end_frame host fn):
  bitmap = renderer.endFrame()
  postMessage({type:'frame', bitmap},   →  dom_ctx.transferFromImageBitmap(bitmap)
              [bitmap])                    (ImageBitmapRenderingContext)
```

**Dlaczego Worker tworzy inputBuf** (nie main thread): Worker wysyła inputBuf w tym samym postMessage co `window-open`, zanim main thread w ogóle widzi wiadomość. Main thread dostaje inputBuf gotowy. Nie ma timing race. Main thread MUSI zacząć pisać input state dopiero PO tym jak zaloguje inputBuf z 'window-open' message — i to zawsze jest PRZED pierwszym `begin_frame` (który też jest wstrzymany przez Atomics). Sekwencja jest deterministyczna.

### Stop sequence
```
User clicks Stop:
  main.js: stopGameRaf()         ← cancel requestAnimationFrame
           Atomics.store(ctrl, -1)  ← STATE_ABORT
           Atomics.notify(ctrl, 0)

Worker (blocked in begin_frame or win_init):
  wakes, reads STATE_ABORT → throws AbortExecution
  caught by try/catch → postMessage({type:'done'})

Main thread 'done' handler:
  stopGameRaf() (idempotent)
  canvas stays visible (last frame preserved)
  hide canvas on next Compile/Run call
```

### Required Changes
- Stwórz `ide/qlang-canvas.js` — Web Component; API: `show(w, h)`, `blit(bitmap)`, `hide()`; adopts `<canvas>` child; `tabindex="0"` dla keyboard focus
- Dodaj `<canvas id="game-canvas">` do `index.html` — hidden by default; opcja layout: **[DECYZJA UŻYTKOWNIKA]** panel 4-ta kolumna vs modal overlay
- Dodaj `STATE_EXT_WAIT = 6` do `wasm-runner.js` (zastępuje osobne WIN_INIT i FRAME_WAIT)
- Przemianuj `STATE_PAUSE→STATE_DBG_PAUSE`, `STATE_STEP→STATE_DBG_STEP`, `STATE_CONTINUE→STATE_DBG_CONT` w `wasm-runner.js`
- Handlery `window-open`, `frame`, `done`/`error` w `ide/main.js`
- `startGameRaf(ctrl)` / `stopGameRaf()` w `ide/main.js`

### Needs Deeper Analysis
- **[DECYZJA UŻYTKOWNIKA]** Layout: 4-ta kolumna (IDE layout extension) vs modal overlay (pełnoekranowe okno gry). Komponent jest niezależny od decyzji — dostosuje się.
- Kiedy program exit (nie-game program, np. Hangman): canvas pozostaje ukryty. Przy następnym Run gry: `show()` go odkrywa. Upewnij się że `hide()` woła się przy każdym `Compile` click, nie tylko przy `done` message.

### Required Changes (old — zastąpione powyżej, usunięte)

---

## 3. Input Capture & WASM-JS Synchronization

### Summary
Osobny 64-bajtowy SharedArrayBuffer (`inputBuf`) tworzony przez Worker przy `init_window`. Layout:

```
Bytes  0–15  : key bitset     (4 × Int32 = 128 bitów, jeden bit per keycode 0–127)
Bytes 16–19  : mouse X        (Int32, pixel coords relative to canvas)
Bytes 20–23  : mouse Y        (Int32)
Bytes 24–27  : mouse buttons  (Int32 bitfield: bit0=LMB, bit1=RMB, bit2=MMB)
Bytes 28–31  : prev key word0 (Int32) ← JS-side only, dla is_key_pressed edge detection
Bytes 32–35  : prev key word1
Bytes 36–39  : prev key word2
Bytes 40–43  : prev key word3
Bytes 44–63  : reserved       (touch coords v2, gamepad v2)
```

Main thread pisze `keydown`/`keyup` na `Atomics.store` w key bitset. Mouse events na canvas — pozycja relativna do `getBoundingClientRect()` (obliczana fresh per event). WASM czyta przez Pull-category host functions w `wasm-runner.js`: `is_key_down(k)` = `(Atomics.load(inputArr, k>>5) >>> (k&31)) & 1`. `is_key_pressed(k)` = jest down teraz && nie był down prev — prev-state aktualizowany przez Worker na początku `begin_frame`.

### Szczegół: is_key_pressed implementacja
```js
// Wewnątrz Worker (begin_frame host function):
// Skopiuj current key state do prev key state (bytes 28-43 w inputBuf)
for (let i = 0; i < 4; i++) {
  const cur = Atomics.load(inputArr, i);      // words 0-3 (current)
  prevKeyArr[i] = cur;                         // words 7-10 w inputBuf (prev) — nie Atomics, bo Worker-private
}

// is_key_pressed(k) host function:
const word = Math.floor(k / 32);
const bit  = k % 32;
const down = (Atomics.load(inputArr, word) >>> bit) & 1;
const prev = (prevKeyArr[word] >>> bit) & 1;
return (down && !prev) ? 1 : 0;
```
`prevKeyArr` to zwykła `Int32Array` na bytes 28–43 w `inputBuf` — zapisywana TYLKO przez Worker, więc nie potrzebuje Atomics.

### Canvas focus dla keyboard events
```js
// W qlang-canvas.js show():
this._canvas.setAttribute('tabindex', '0');
this._canvas.focus();  // przejęcie focus od edytora

// W main.js — keyboard event listeners na canvas (nie window):
canvasEl.addEventListener('keydown', e => {
  const k = e.keyCode;
  if (k < 128) Atomics.or(inputArr, k >> 5, 1 << (k & 31));
  e.preventDefault();
}, { capture: true });
canvasEl.addEventListener('keyup', e => {
  const k = e.keyCode;
  if (k < 128) Atomics.and(inputArr, k >> 5, ~(1 << (k & 31)));
  e.preventDefault();
});
```

Używamy `Atomics.or`/`Atomics.and` (not just store) żeby atomic modyfikacja — ochrona przed race na granicy keydown/keyup przy intensywnym typing.

### Required Changes
- `inputBuf = new SharedArrayBuffer(64)` — tworzony w Worker `init_window` host fn, wysyłany w `window-open` postMessage
- Keyboard event listeners na `<qlang-canvas>` element (nie `window`) — rejestrowane TYLKO gdy canvas stworzony (po `window-open`)
- Mouse event listeners: `mousemove`, `mousedown`, `mouseup` na canvas  
- `is_key_down`, `is_key_pressed`, `get_mouse_x`, `get_mouse_y`, `is_mouse_btn_down` host functions w `wasm-runner.js` (Pull — na Atomics.load, bez blokowania)
- `examples/keys.qlang`: `KEY_UP := 38; KEY_DOWN := 40; KEY_LEFT := 37; KEY_RIGHT := 39; ...`
- `examples/colors.qlang`: `RED := 0xFF0000FF; GREEN := 0x00FF00FF; BLUE := 0x0000FFFF; WHITE := 0xFFFFFFFF; BLACK := 0x000000FF; YELLOW := 0xFFFF00FF; TRANSPARENT := 0x00000000;`

---

## 4. Game Loop Architecture — STATE Machine

### Pełna mapa stanów (zaktualizowana)
```
STATE_IDLE       =  0   (Worker running)
STATE_INPUT      =  1   (stdin blocking — protokół danych, Worker czyta SAB po wakeup)
STATE_INPUTOK    =  2   (stdin data ready)
STATE_DBG_PAUSE  =  3   (debug breakpoint hit)         ← rename z STATE_PAUSE
STATE_DBG_STEP   =  4   (debug: step)                  ← rename z STATE_STEP
STATE_DBG_CONT   =  5   (debug: continue)              ← rename z STATE_CONTINUE
STATE_EXT_WAIT   =  6   (external signal wait)         ← NEW, zastępuje FRAME_WAIT + WIN_INIT
STATE_ABORT      = -1
```

**Dlaczego STATE_EXT_WAIT zamiast osobnych FRAME_WAIT i WIN_INIT:**  
Worker po `Atomics.wait` sprawdza TYLKO: `STATE_ABORT` (abort) lub `STATE_IDLE` (kontynuuj). Nie potrzebuje wiedzieć "który typ wait" — wie to z kontekstu (właśnie wywołał `begin_frame` albo `init_window`). Main thread wie co robić z `postMessage.type`, nie ze stanu w SAB. Dwa osobne stany dla tego samego protokołu (Worker blokuje → main notifyuje) to zbędna komplikacja.

**Dlaczego STATE_INPUT/INPUTOK pozostają osobne:**  
To INNY protokół: Worker czeka, main thread **zapisuje dane do SAB** (stdin buffer), zmienia stan na INPUTOK, notifyuje. Worker po wakeup **czyta dane z SAB**. Dwukierunkowy protokół danych ≠ jednostronny sygnał.

**DBG_ prefix:** grupuje stany debuggera wizualnie, ułatwia debugging log (`state=3` → `state=DBG_PAUSE`).

### Summary
Game loop opiera się na `STATE_EXT_WAIT`. WASM woła `begin_frame()` → Worker ustawia `STATE_EXT_WAIT` i blokuje `Atomics.wait`. Main thread (RAF loop) sprawdza: jeśli `Atomics.load(ctrl,0) === STATE_EXT_WAIT` → ustaw `STATE_IDLE` i `Atomics.notify`. Jeśli Worker przetwarza poprzednią klatkę (stan ≠ EXT_WAIT) — RAF tick jest skipped (frame drop, poprawne zachowanie). Stop = `STATE_ABORT` — Worker budzi się i rzuca `AbortExecution`.

### RAF loop w main.js
```js
const STATE_EXT_WAIT = 6;  // Worker waiting for external event
let _rafId = null;

function startGameRaf(ctrl) {
  if (_rafId !== null) return;  // idempotent
  function tick() {
    if (Atomics.load(ctrl, 0) === STATE_EXT_WAIT) {
      Atomics.store(ctrl, 0, 0);  // STATE_IDLE
      Atomics.notify(ctrl, 0);
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

function stopGameRaf() {
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
}
```
RAF start: na `'window-open'` message. RAF stop: na `'done'`, `'error'`, Stop button click.

### begin_frame / end_frame (Worker side)
```js
hostFunctions.gfx = {
  begin_frame: () => {
    // 1. Copy current key state to prev key state for is_key_pressed
    for (let i = 0; i < 4; i++) prevKeyArr[i] = Atomics.load(inputArr, i);
    // 2. Wait for RAF tick (STATE_EXT_WAIT = generic external signal)
    Atomics.store(ctrl, 0, STATE_EXT_WAIT);
    Atomics.wait(ctrl, 0, STATE_EXT_WAIT);
    if (Atomics.load(ctrl, 0) === STATE_ABORT) throw new AbortExecution();
    // 3. Reset batch
    renderer.beginFrame();
  },
  end_frame: () => {
    const bitmap = renderer.endFrame();
    self.postMessage({ type: 'frame', bitmap }, [bitmap]);
    // Update frame time for next get_frame_time() call
    _lastFrameMs = performance.now() - _lastFrameStart;
    _lastFrameStart = performance.now();
  },
  get_frame_time: () => _lastFrameMs / 1000.0,  // returns f32 seconds
  window_should_close: () => 0,  // always false in v1 (web platform)
};
```

### Required Changes
- Dodaj `STATE_EXT_WAIT = 6` do `wasm-runner.js`; przemianuj `STATE_PAUSE/STEP/CONTINUE` na `STATE_DBG_PAUSE/DBG_STEP/DBG_CONT`
- Implementuj `begin_frame`, `end_frame`, `window_should_close`, `get_frame_time` host functions
- W `init_window` host fn: użyj `STATE_EXT_WAIT` (identyczny protokół jak `begin_frame`)
- `startGameRaf(ctrl)` / `stopGameRaf()` w `ide/main.js`
- Stop button: `stopGameRaf()` + `Atomics.store(ctrl, -1)` + `Atomics.notify` — identycznie jak debug stop

### Open question: get_frame_time transport
`get_frame_time()` zwraca `f32`. Host function zwraca JS number → WASM widzi f32 przez return type. Wymaga żeby QLang type checker zaakceptował `f32` jako return type z extern! — prawdopodobnie działa już dziś. Verify w test.

### Deprecated from previous plan
Usunąłem `GET_FRAME_TIME przez SAB slot` — niepotrzebne. Synchronous extern! call (Pull category) zwracający f32 jest prostszy i wystarczający.

---

## 5. WebGL Abstraction — WebGL2Renderer

### Summary
Cała grafika jest enkapsulowana w klasie `WebGL2Renderer` działającej po stronie Workera. Klasa tworzy `OffscreenCanvas`, inicjalizuje WebGL2 context, kompiluje shadery raz przy `init_window`.

**Architektura batch:** trzy osobne pre-alokowane `Float32Array` (rectBuf, lineBuf, circleBuf). Dlaczego trzy zamiast jednego:
- Rects i circles używają `gl.TRIANGLES`; lines używają `gl.LINES`. Nie można mieszać trybów w jednym draw call → minimum 3 draw calls niezależnie od liczby buforów.
- Vertex format jest IDENTYCZNY dla wszystkich typów: `(x, y, r, g, b, a)` — więc jeden `Float32Array` z 3 regionami `[rect_region | line_region | circle_region]` byłby technicznie poprawny i równoważny.
- Trzy osobne tablice = prostszy kod: każda zawsze zaczyna od indeksu 0, brak obliczania offsetów.
- Jeden bufor z 3 regionami = jeden `new Float32Array`, identyczna liczba draw calls, nieco bardziej złożony indexing.
- Wybór: **trzy tablice dla v1** (prostszy kod). Konsolidacja do jednego buforu to poprawny refaktor jeśli zajdzie potrzeba.
- Interfejs klasy = stabilna granica umożliwiająca wymianę na WebGPU bez dotykania QLang kodu.

```js
class WebGL2Renderer {
  constructor(w, h) {
    this.canvas = new OffscreenCanvas(w, h);
    const gl = this.canvas.getContext('webgl2');
    this.gl = gl;
    this.w = w; this.h = h;
    this._setupShaders(gl);
    // 3 wstępnie alokowane batche
    this.rectBuf  = new Float32Array(1024 * 6 * 6);  // 6 vertexes per rect, 6 floats each
    this.lineBuf  = new Float32Array(1024 * 2 * 6);
    this.circBuf  = new Float32Array(1024 * 32 * 6 * 3);  // N=32 triangles
    this.rectN = 0; this.lineN = 0; this.circN = 0;
    this._inFrame = false;
  }
  beginFrame()    { gl.clear(gl.COLOR_BUFFER_BIT); this.rectN=0; this.lineN=0; this.circN=0; this._inFrame=true; }
  endFrame()      { this._flush(); this._inFrame=false; return this.canvas.transferToImageBitmap(); }
  drawRect(x,y,w,h,rgba) { if(w<=0||h<=0) return; this._pushRect(x,y,w,h,rgba); }
  drawLine(x0,y0,x1,y1,rgba) { this._pushLine(x0,y0,x1,y1,rgba); }
  drawCircle(cx,cy,r,rgba) { if(r<=0) return; this._pushCircle(cx,cy,r,rgba); }
  drawRectOutline(x,y,w,h,thick,rgba) { /* 4 draw_rect calls */ }
}
```

### Shadery (ortho projection, top-left coords)
Vertex shader:
```glsl
attribute vec2 a_pos; attribute vec4 a_color; varying vec4 v_color; uniform vec2 u_res;
void main() {
  gl_Position = vec4((a_pos.x/u_res.x)*2.0-1.0, 1.0-(a_pos.y/u_res.y)*2.0, 0.0, 1.0);
  v_color = a_color;
}
```
Fragment shader: `precision mediump float; varying vec4 v_color; void main() { gl_FragColor = v_color; }`

### Batch overflow
Kiedy batch pełny: `self.postMessage({ type: 'warn', message: 'gfx: batch overflow' })` + skip (nie crash). Batch capacity 1024 per typ = sufficient for Pong/Snake/Sokoban.

### Required Changes
- Stwórz `WebGL2Renderer` class w `wasm-runner.js` (lub oddzielny `ide/gfx-renderer.js` importowany przez Worker)  
- Każdy batch to osobna `Float32Array` pre-alokowana przy init — zero per-frame alokacji
- Color unpacking: `r = (c >>> 24)/255; g = ((c>>>16)&0xFF)/255; b = ((c>>>8)&0xFF)/255; a = (c&0xFF)/255`
- Guard: `drawRect` / `drawCircle` ignoruje w ≤ 0 lub h ≤ 0 lub r ≤ 0
- `_inFrame` flag: `drawRect` poza `begin/end` bracket → `postMessage({ type:'error', message:'gfx: draw outside frame' })`

### Needs Deeper Analysis
- `gfx-renderer.js` jako oddzielny plik vs inline w `wasm-runner.js`. Jeśli `wasm-runner.js` przekroczy 300 linii z renderem — split jest obowiązkowy (reguła 600 linii; celujemy w 300).
- WebGPU swap path: `class WebGPURenderer` z identycznym interfejsem. Switch w `init_window`: `renderer = supportsWebGPU ? new WebGPURenderer(w,h) : new WebGL2Renderer(w,h)`. V1 = WebGL2 only.
- Text rendering (v2): bitmap font atlas lub canvas2D → texture upload. Nie blokuje v1.



---

## 6. WASM Memory Model

### HEAP_BASE = 1024 (ERRATA — patrz sekcja Errata powyżej)
`wat-utils.js` linia 35: `export const HEAP_BASE = 1024`. Shadow stack `$__sp` i string/array literały startują od 1024:
- `(memory 1)` = 64KB → ~63KB przestrzeni roboczej od 1024 do 65535
- `(memory 4)` = 256KB → ~261KB przestrzeni roboczej

**Potential bug (istniejący):** Dwie funkcje kompilują string literały do tych samych statycznych adresów (oboje zaczynają BumpAllocator od 1024). Jeśli funcA woła funcB i obie mają string literały, funcB nadpisze pamięć funcA. WASM jest single-threaded → safe dopóki funcA nie używa literału po powrocie z funcB. W grach (main loop, brak skomplikowanych call trees z literałami) niskie ryzyko.

### Required Changes
- `compiler/wat-encoder.js`: `(memory 1)` → `(memory 4)` — jedna linia
- Upewnij się że testy nie zakładają `(memory 1)` (grep test files)

### Needs Deeper Analysis
- Test: `foo := fn() string { return "aaa"; }; bar := fn() void { foo(); print(foo()); }` — dwa wywołania foo() powinny być deterministyczne (są, bo WASM single-threaded i stringi są re-init przy każdym wywołaniu)
- `HEAP_BASE` rename: kognitywnie "HEAP" sugeruje heap-alokację, ale to stos. Rename → `SHADOW_STACK_BASE` w v2.
- V2: jeśli gra ma >61KB statycznych danych — `HEAP_BASE` musi być obliczane z rozmiaru sekcji danych zamiast hardcoded 1024. Latent bug.

---

## 7. QLang Language-Side API Design

### Krytyczny Bug E2 — Fix w pipeline.js (PREREQUISITE)

Przed napisaniem `gfx.qlang` MUSISZ naprawić jeden bug:

**`compiler/pipeline.js` linia ~147:**
```js
// CURRENT (broken — extern! z importowanych plików nie trafia do WASM import section):
if (decl.kind === 'FuncDecl' || decl.kind === 'NamespacedDecl') importedBodies.push(decl);

// FIX:
if (decl.kind === 'FuncDecl' || decl.kind === 'NamespacedDecl'
    || (decl.kind === 'VarDecl' && decl._isRuntimeImport)) importedBodies.push(decl);
```

Ten bug powoduje że `compileMulti` buduje merged AST BEZ extern! deklaracji z importowanych plików. `buildWAT → collectAllImportDecls` operuje na `ast.body` głównego pliku i nie znajdzie `draw_rect : fn(...) = extern!("gfx.draw_rect")` z `gfx.qlang`. Wynik: WASM import section jest pusta → runtime "Unknown host function".

**Test najpierw, potem fix:**
```js
// tests/test-namespace.js (lub nowy test-game-api.js)
// 1. Kompiluj program który importuje plik z extern!
// 2. Sprawdź że WASM binary zawiera import section z ("gfx", "draw_rect")
// 3. Potwierdź że test czerwony przed fixem, zielony po fixie
```

### Zawartość gfx.qlang
```qlang
// examples/gfx.qlang — Game graphics API (extern! bindings for gfx module)
// Import jako: gfx := namespace "gfx.qlang";
// Wszystkie kolory: packed RGBA_8888 jako i32 (0xRRGGBBAA)
// Koordynaty: pixel (0,0) = top-left

// Window / Frame
init_window      : fn(w: i32, h: i32) void          = extern!("gfx.init_window");
begin_frame      : fn() void                          = extern!("gfx.begin_frame");
end_frame        : fn() void                          = extern!("gfx.end_frame");
window_should_close : fn() bool                       = extern!("gfx.window_should_close");
get_screen_w     : fn() i32                           = extern!("gfx.get_screen_w");
get_screen_h     : fn() i32                           = extern!("gfx.get_screen_h");

// Drawing
clear_background : fn(color: i32) void                = extern!("gfx.clear_background");
draw_rect        : fn(x:i32, y:i32, w:i32, h:i32, color:i32) void = extern!("gfx.draw_rect");
draw_rect_outline: fn(x:i32, y:i32, w:i32, h:i32, thick:i32, color:i32) void = extern!("gfx.draw_rect_outline");
draw_line        : fn(x0:i32, y0:i32, x1:i32, y1:i32, color:i32) void = extern!("gfx.draw_line");
draw_circle      : fn(cx:i32, cy:i32, r:i32, color:i32) void = extern!("gfx.draw_circle");

// Input — keyboard
is_key_down      : fn(key: i32) bool                  = extern!("gfx.is_key_down");
is_key_pressed   : fn(key: i32) bool                  = extern!("gfx.is_key_pressed");

// Input — mouse
get_mouse_x      : fn() i32                           = extern!("gfx.get_mouse_x");
get_mouse_y      : fn() i32                           = extern!("gfx.get_mouse_y");
is_mouse_btn_down: fn(btn: i32) bool                  = extern!("gfx.is_mouse_btn_down");

// Time
get_frame_time   : fn() f32                           = extern!("gfx.get_frame_time");
```

### Required Changes
- Fix `compiler/pipeline.js` linia ~147 (Bug E2) — **PREREQUISITE #1**
- Napisz test weryfikujący fix (test-namespace.js lub nowy test-game-api.js)
- Stwórz `examples/gfx.qlang` z powyższą zawartością
- Stwórz `examples/keys.qlang`: `KEY_UP := 38; KEY_DOWN := 40; KEY_LEFT := 37; KEY_RIGHT := 39; KEY_SPACE := 32; KEY_ENTER := 13; KEY_ESC := 27;`
- Stwórz `examples/colors.qlang`: `RED := 0xFF0000FF; GREEN := 0x00FF00FF; BLUE := 0x0000FFFF; WHITE := 0xFFFFFFFF; BLACK := 0x000000FF; YELLOW := 0xFFFF00FF; TRANSPARENT := 0x00000000;`
- Zaktualizuj `examples/index.json`

### Needs Deeper Analysis
- Lokacja: `examples/gfx.qlang` (user-modifiable, nie locked) vs przyszłe `stdlib/gfx.qlang`
- `get_frame_time` zwraca `f32` — czy type checker zaakceptuje `f32` jako return type z extern!? Verify.

---

## Council Verdict — Zaktualizowane po code inspection

### 3 Big Bets (nowe — po code inspection)

1. **Fix Bug E2 w `pipeline.js` linia ~147 JAKO PREREQUISITE #1.** Bez tego nic nie zadziała — wszystkie extern! z `gfx.qlang` są cicho pomijane w WASM import section. Fix to jeden wiersz. Test najpierw.

2. **`WebGL2Renderer` class jako stabilna granica między JS-host a QLang API.** OffscreenCanvas Worker + ImageBitmap transfer = zero-copy, survives re-runs. Klasa enkapsuluje cały WebGL state machine. Przejście na WebGPU = podmiana klasy, nie refaktor.

3. **Pull/Push/Sync taksonomia dla wszystkich nowych extern!.** Każda nowa host function MUSI być sklasyfikowana zanim zostanie zaimplementowana. Sync (Atomics.wait) ma wysokie koszty — minimalizuj. Pull (SAB read) jest tanie. Push (void call) jest fire-and-forget.

### 3 Prerequisity przed pierwszą grą działającą end-to-end

1. **Fix pipeline.js Bug E2** — jeden wiersz, test czerwony→zielony
2. **`(memory 4)` w wat-encoder.js** — jeden wiersz, testy pass
3. **WebGL2Renderer + begin_frame/end_frame host functions** w wasm-runner.js

### 3 Rzeczy których NIE robimy w v1

1. **Dynamic memory allocation (malloc/free).** ECS pattern (`array<Entity, MAX_ENTITIES>`) wystarczy na Pong/Snake/Sokoban. Defer.
2. **Nowy IPC mechanizm.** Istniejący `extern!` (Pull/Push/Sync) jest wystarczający. Formalizujemy dokumentacją.
3. **Textury, WebGPU, text rendering.** Colored geometry wystarczy. Kill for v1.

