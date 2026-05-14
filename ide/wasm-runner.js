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
//   { type: 'write',   text }           — ext::print  (no newline)
//   { type: 'println', text }           — ext::printLn (main adds \n)
//   { type: 'input-wait' }              — ext::input waiting for stdin
//   { type: 'pause',   stmtId }        — debug: paused at brk()
//   { type: 'done',    result, elapsed }
//   { type: 'error',   message }

const STATE_IDLE     =  0;
const STATE_INPUT    =  1;   // Worker blocked — waiting for stdin
const STATE_INPUTOK  =  2;   // Main thread filled input buffer
const STATE_PAUSE    =  3;   // Debug: Worker blocked at breakpoint
const STATE_STEP     =  4;   // Debug: resume, pause at next brk()
const STATE_CONTINUE =  5;   // Debug: resume, pause only at breakpoints
const STATE_ABORT    = -1;

class AbortExecution {}

const decoder = new TextDecoder('utf-8');

self.onmessage = async ({ data }) => {
  const { bytes, sharedBuf, mode, breakpoints: bpArr, wasmImports = [] } = data;
  const isDebug     = mode === 'debug';
  const breakpoints = new Set(bpArr ?? []);

  const ctrl     = new Int32Array(sharedBuf, 0, 1);
  const lenArr   = new Int32Array(sharedBuf, 4, 1);
  const inputBuf = new Uint8Array(sharedBuf, 8);

  let wasmMemory = null;
  let stepMode   = isDebug ? 'step' : null;

  // All host functions available to extern! declarations
  const hostFunctions = {
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
        Atomics.store(ctrl, 0, STATE_PAUSE);
        self.postMessage({ type: 'pause', stmtId });
        Atomics.wait(ctrl, 0, STATE_PAUSE);
        const cmd = Atomics.load(ctrl, 0);
        if (cmd === STATE_ABORT) throw new AbortExecution();
        stepMode = (cmd === STATE_STEP) ? 'step' : 'continue';
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
    self.postMessage({ type: 'done', result, elapsed });
  } catch (e) {
    if (e instanceof AbortExecution) {
      self.postMessage({ type: 'done', result: undefined, elapsed: 0 });
    } else {
      self.postMessage({ type: 'error', message: e.message });
    }
  }
};
