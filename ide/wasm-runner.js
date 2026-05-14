// ide/wasm-runner.js — Web Worker for running QLang WASM programs
//
// Handles both Run and Debug modes via Atomics.wait() blocking.
//
// SharedArrayBuffer layout (8 + 1024 bytes):
//   [0..3]    Int32  state (see STATE_* below)
//   [4..7]    Int32  input byte count
//   [8..1031] Uint8  input data (max 1024 bytes)
//
// Incoming: { bytes, sharedBuf, mode: 'run'|'debug', breakpoints?: number[] }
//
// Outgoing:
//   { type: 'write',      text }                    — ext::print  (no newline)
//   { type: 'println',    text }                    — ext::printLn (main adds \n)
//   { type: 'input-wait' }                          — ext::input waiting for stdin
//   { type: 'pause',      stmtId }                 — debug: paused at brk()
//   { type: 'window-open', w, h, inputBuf }        — game: init_window called
//   { type: 'frame',       bitmap }                — game: end_frame bitmap
//   { type: 'warn',        message }               — runtime warning (batch overflow etc.)
//   { type: 'done',        result, elapsed }
//   { type: 'error',       message }

const STATE_IDLE      =  0;
const STATE_INPUT     =  1;   // Worker blocked — waiting for stdin
const STATE_INPUTOK   =  2;   // Main thread filled input buffer
const STATE_DBG_PAUSE =  3;   // Debug: Worker blocked at breakpoint
const STATE_DBG_STEP  =  4;   // Debug: resume, pause at next brk()
const STATE_DBG_CONT  =  5;   // Debug: resume, pause only at breakpoints
const STATE_EXT_WAIT  =  6;   // Worker waiting for external signal (begin_frame / init_window)
const STATE_ABORT     = -1;
const GAME_DIAG = true;
const GAME_DIAG_PERIOD_MS = 2000;

import { WebGL2Renderer } from './gfx-renderer.js';

class AbortExecution {}

const decoder = new TextDecoder('utf-8');

function newDiagStat() {
  return { n: 0, sum: 0, max: 0 };
}

function diagSample(stat, value) {
  if (!Number.isFinite(value) || value < 0) return;
  stat.n++;
  stat.sum += value;
  if (value > stat.max) stat.max = value;
}

function diagAvg(stat) {
  return stat.n > 0 ? (stat.sum / stat.n) : 0;
}

self.onmessage = async ({ data }) => {
  const { bytes, sharedBuf, mode, breakpoints: bpArr, wasmImports = [], telemetryEnabled = true } = data;
  const isDebug     = mode === 'debug';
  const breakpoints = new Set(bpArr ?? []);

  const ctrl     = new Int32Array(sharedBuf, 0, 1);
  const lenArr   = new Int32Array(sharedBuf, 4, 1);
  const inputBuf = new Uint8Array(sharedBuf, 8);

  let wasmMemory = null;
  let stepMode   = isDebug ? 'step' : null;

  // Game state (populated by gfx.init_window)
  let renderer       = null;
  let gameInputBuf   = null;   // SAB for input — created by Worker, sent to main via window-open
  let inputArr       = null;   // Int32Array view of gameInputBuf (key bitset + mouse)
  let prevKeyArr     = new Int32Array(4);  // previous-frame key state for is_key_pressed
  let _lastFrameMs   = 16.67;
  let _lastFrameStart = 0;
  let _frameActiveStart = 0;
  let _diag = {
    enabled: GAME_DIAG && telemetryEnabled,
    lastFlush: performance.now(),
    frames: 0,
    frameMs: newDiagStat(),
    waitMs: newDiagStat(),
    activeMs: newDiagStat(),
  };

  function maybeFlushDiag(reason = 'periodic') {
    if (!_diag.enabled) return;
    const now = performance.now();
    if (reason === 'periodic' && (now - _diag.lastFlush) < GAME_DIAG_PERIOD_MS) return;
    self.postMessage({
      type: 'diag-gfx',
      metrics: {
        frames: _diag.frames,
        frameAvgMs: diagAvg(_diag.frameMs),
        frameMaxMs: _diag.frameMs.max,
        waitAvgMs: diagAvg(_diag.waitMs),
        waitMaxMs: _diag.waitMs.max,
        activeAvgMs: diagAvg(_diag.activeMs),
        activeMaxMs: _diag.activeMs.max,
      },
    });
    _diag.lastFlush = now;
    _diag.frames = 0;
    _diag.frameMs = newDiagStat();
    _diag.waitMs = newDiagStat();
    _diag.activeMs = newDiagStat();
  }

  // All host functions available to extern! declarations
  const hostFunctions = {
    gfx: {
      // ── Window / Frame ───────────────────────────────────────────────────
      init_window: (w, h) => {
        // Create input SAB (Worker-owned; 64 bytes)
        //   bytes  0-15: key bitset (4 × Int32 = 128 bits, one per keycode 0-127)
        //   bytes 16-19: mouse X
        //   bytes 20-23: mouse Y
        //   bytes 24-27: mouse buttons bitfield
        //   bytes 28-43: prev key state (Worker-private, for is_key_pressed)
        gameInputBuf = new SharedArrayBuffer(64);
        inputArr     = new Int32Array(gameInputBuf);
        prevKeyArr   = new Int32Array(4);
        Atomics.store(ctrl, 0, STATE_EXT_WAIT);
        self.postMessage({ type: 'window-open', w, h, inputBuf: gameInputBuf });
        Atomics.wait(ctrl, 0, STATE_EXT_WAIT);
        if (Atomics.load(ctrl, 0) === STATE_ABORT) throw new AbortExecution();
        renderer = new WebGL2Renderer(w, h);
        _lastFrameStart = performance.now();
      },

      begin_frame: () => {
        if (!renderer) return;
        // Copy current key state to prev (for is_key_pressed)
        for (let i = 0; i < 4; i++) prevKeyArr[i] = Atomics.load(inputArr, i);
        Atomics.store(ctrl, 0, STATE_EXT_WAIT);
        const waitStart = performance.now();
        Atomics.wait(ctrl, 0, STATE_EXT_WAIT);
        diagSample(_diag.waitMs, performance.now() - waitStart);
        if (Atomics.load(ctrl, 0) === STATE_ABORT) throw new AbortExecution();
        renderer.beginFrame();
        _frameActiveStart = performance.now();
      },

      end_frame: () => {
        if (!renderer) return;
        const activeMs = _frameActiveStart > 0 ? (performance.now() - _frameActiveStart) : 0;
        const bitmap = renderer.endFrame();
        self.postMessage({ type: 'frame', bitmap }, [bitmap]);
        _lastFrameMs    = performance.now() - _lastFrameStart;
        _lastFrameStart = performance.now();
        _diag.frames++;
        diagSample(_diag.frameMs, _lastFrameMs);
        diagSample(_diag.activeMs, activeMs);
        maybeFlushDiag('periodic');
      },

      window_should_close: () => 0,  // always false in v1 (web)

      get_screen_w: () => renderer?.w ?? 0,
      get_screen_h: () => renderer?.h ?? 0,

      get_frame_time: () => _lastFrameMs / 1000.0,

      // ── Drawing ──────────────────────────────────────────────────────────
      clear_background:  (color)                    => renderer?.clearBackground(color),
      draw_rect:         (x, y, w, h, color)        => renderer?.drawRect(x, y, w, h, color),
      draw_rect_outline: (x, y, w, h, thick, color) => renderer?.drawRectOutline(x, y, w, h, thick, color),
      draw_line:         (x0, y0, x1, y1, color)    => renderer?.drawLine(x0, y0, x1, y1, color),
      draw_circle:       (cx, cy, r, color)          => renderer?.drawCircle(cx, cy, r, color),

      // ── Input — keyboard ─────────────────────────────────────────────────
      is_key_down: (k) => {
        if (!inputArr || k < 0 || k >= 128) return 0;
        return (Atomics.load(inputArr, k >> 5) >>> (k & 31)) & 1;
      },
      is_key_pressed: (k) => {
        if (!inputArr || k < 0 || k >= 128) return 0;
        const word = k >> 5, bit = k & 31;
        const down = (Atomics.load(inputArr, word) >>> bit) & 1;
        const prev = (prevKeyArr[word] >>> bit) & 1;
        return (down & ~prev) & 1;
      },

      // ── Input — mouse ────────────────────────────────────────────────────
      get_mouse_x:      () => inputArr ? Atomics.load(inputArr, 4) : 0,  // word 4 = bytes 16-19
      get_mouse_y:      () => inputArr ? Atomics.load(inputArr, 5) : 0,  // word 5 = bytes 20-23
      is_mouse_btn_down: (btn) => {
        if (!inputArr || btn < 0 || btn > 2) return 0;
        return (Atomics.load(inputArr, 6) >>> btn) & 1;  // word 6 = bytes 24-27
      },
    },
    env: {
      write_utf8: (ptr, len) => {
        if (!wasmMemory) return;
        self.postMessage({ type: 'write', text: decoder.decode(new Uint8Array(wasmMemory.buffer, ptr, len)) });
      },
      print_utf8: (ptr, len) => {
        if (!wasmMemory) return;
        self.postMessage({ type: 'println', text: decoder.decode(new Uint8Array(wasmMemory.buffer, ptr, len)) });
      },
      input_utf8: (ptr, maxLen) => {
        if (!wasmMemory) return 0;
        Atomics.store(ctrl, 0, STATE_INPUT);
        self.postMessage({ type: 'input-wait' });
        Atomics.wait(ctrl, 0, STATE_INPUT);
        const s = Atomics.load(ctrl, 0);
        if (s === STATE_ABORT) throw new AbortExecution();
        const n = Math.min(lenArr[0], maxLen);
        if (n > 0) new Uint8Array(wasmMemory.buffer, ptr, n).set(inputBuf.subarray(0, n));
        Atomics.store(ctrl, 0, STATE_IDLE);
        return n;
      },
    },
  };

  // Build importObject dynamically from wasmImports
  const importObject = {};
  for (const { module, field } of wasmImports) {
    const fn = hostFunctions[module]?.[field];
    if (!fn) {
      self.postMessage({ type: 'error', message: `Unknown host function: ${module}.${field}` });
      return;
    }
    importObject[module] ??= {};
    importObject[module][field] = fn;
  }

  if (isDebug) {
    importObject.dbg = {
      brk: (stmtId) => {
        if (stepMode === 'continue' && !breakpoints.has(stmtId)) return;
        Atomics.store(ctrl, 0, STATE_DBG_PAUSE);
        self.postMessage({ type: 'pause', stmtId });
        Atomics.wait(ctrl, 0, STATE_DBG_PAUSE);
        const cmd = Atomics.load(ctrl, 0);
        if (cmd === STATE_ABORT) throw new AbortExecution();
        stepMode = (cmd === STATE_DBG_STEP) ? 'step' : 'continue';
        Atomics.store(ctrl, 0, STATE_IDLE);
      },
    };
  }

  try {
    const { instance } = await WebAssembly.instantiate(bytes, importObject);
    wasmMemory = instance.exports.memory;
    const mainFn = instance.exports.main;
    if (typeof mainFn !== 'function') {
      self.postMessage({ type: 'error', message: 'No exported function named "main" found.' });
      return;
    }
    const t0      = performance.now();
    const result  = mainFn();
    const elapsed = performance.now() - t0;
    maybeFlushDiag('done');
    self.postMessage({ type: 'done', result, elapsed });
  } catch (e) {
    if (e instanceof AbortExecution) {
      maybeFlushDiag('abort');
      self.postMessage({ type: 'done', result: undefined, elapsed: 0 });
    } else {
      self.postMessage({ type: 'error', message: e.message });
    }
  }
};
