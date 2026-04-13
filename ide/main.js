// ide/main.js — Mini-IDE entry point (ES module)

import { compile, liveCompile } from '../compiler/pipeline.js';
import { generate }  from '../compiler/codegen.js';
import { renderAST } from '../compiler/ast-renderer.js';

import { renderWAT, renderBytecode } from './views.js';
import './source-view.js';

import { registerView } from './source-registry.js';
import {
  setStmtMap, enclosingStmt,
  highlightSourceRange,
  highlightAstForNode, highlightWatForNode, highlightBytecodeForNode,
} from './crossSelection.js';
import { initHighlight, highlightNodeChain, clearAll as clearAllHighlights } from './highlight.js';

import {
  acState, updateAc, buildLineIndex, buildHoverData,
  setLastAst, setLastTokens, setLastHoverData, setLastLineIndex, getLastLineIndex,
  setLastErrorRange, setLastErrorRanges, setLastErrorInfo, getLastErrorRanges,
} from './lsp.js';
import { getEditorText, getCaretOffset, setCaretOffset } from './editor.js';

import {
  addBp, removeBp, hasBp, getBpLines, clearAllBps,
  stopDebugger, initDebugger,
} from './debugger.js';

import './lang-docs.js';

import {
  initMacroPanels,
  updateMacroLenses as updateMacroPanels,
  closeAllPanels,
  refreshAllPanelBps,
} from './macro-panel.js';
import { setExpLog, getExpLog } from './ide-state.js';
import { navigateToRef } from './navigate.js';
import { initExamples } from './examples.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const editor  = document.getElementById('editor');
const mainSv  = document.getElementById('main-sv');
const btnCompile  = document.getElementById('btn-compile');
const btnRun      = document.getElementById('btn-run');
const btnStop     = document.getElementById('btn-stop');
const btnClear    = document.getElementById('btn-clear');
const outConsole  = document.getElementById('out-console');
const outErrors   = document.getElementById('out-errors');
const outAst      = document.getElementById('out-ast');
const outBytecode = document.getElementById('out-bytecode');
const watRoot     = document.getElementById('wat-root');

// Component refs (graceful fallback if not yet upgraded)
const errorPanel   = document.getElementById('error-panel');
const consolePanel = document.getElementById('console-panel');

// Register mainSv as the view for 'main' source so debugger.js can route
// highlightInSource('main', ...) to it (same mechanism as macro panel views).
registerView('main', mainSv);

// Wire up the central highlight coordinator now that all DOM refs are known.
initHighlight({ outAst, watRoot, outBytecode });

// Wire up macro panel system.
const macroLensLayer = document.getElementById('macro-lens-layer');
const panelsRow      = document.getElementById('macro-panels-row');
initMacroPanels(panelsRow, macroLensLayer, editor);

// ── Stale helpers ────────────────────────────────────────────────────────────
function markStale() {
  watRoot.setAttribute('data-stale', '1');
  outBytecode.setAttribute('data-stale', '1');
}
function clearStale() {
  watRoot.removeAttribute('data-stale');
  outBytecode.removeAttribute('data-stale');
}

// ── State ─────────────────────────────────────────────────────────────────────

let lastWasmBytes = null;
let lastModule    = null;
let lastSSpans    = [];
let _compiled     = false;    // true after successful Compile; gates Run/Debug
let _programState = 'idle';   // 'idle' | 'running' | 'debugging'

function setCompiled(flag) {
  _compiled = flag;
  _syncButtons();
}

/** Update button enabled/disabled to reflect _compiled + _programState */
function _syncButtons() {
  const busy = _programState !== 'idle';
  btnCompile.disabled = busy;
  btnRun.disabled     = !_compiled || busy;
  btnStop.disabled    = !busy;
  const btnDebug = document.getElementById('btn-debug');
  if (btnDebug) btnDebug.disabled = !_compiled || busy;
}

function _enterState(state) {
  _programState = state;
  _syncButtons();
}

// Initial state: Run/Debug disabled until first Compile
setCompiled(false);

// ── Editor helpers ────────────────────────────────────────────────────────────

function applyHighlight(errorRanges) {
  const text = getEditorText();
  const pos  = getCaretOffset();
  mainSv.setText(text, errorRanges);
  setCaretOffset(pos);
}

mainSv.addEventListener('sv-node-click', e => {
  const clickedNode = e.detail.node;
  if (!clickedNode) return;
  clearAllHighlights();
  highlightNodeChain(clickedNode);
  highlightAstForNode(clickedNode);
  const stmt = enclosingStmt(clickedNode);
  highlightWatForNode(stmt);
  highlightBytecodeForNode(stmt);
});

mainSv.addEventListener('sv-gutter-click', e => {
  const line = e.detail.line;
  if (hasBp('main', line)) {
    removeBp('main', line);
  } else {
    addBp('main', line);
  }
  mainSv.setBpLines(getBpLines('main'));
  refreshAllPanelBps();
});

// ── Editor input events ───────────────────────────────────────────────────────
// Live compile — debounced, 150ms. Runs full pipeline except codegen.
// Updates AST Explorer, hover data, error panel. Does NOT clear WAT/WASM.
let _liveTimer = null;
function triggerLiveCompile(src) {
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(() => {
    clearAllBps();
    mainSv.setBpLines(new Set());
    const { tokens, ast, expLog, parseErrors, typeErrors } = liveCompile(src);
    if (!ast) return; // lex error — leave existing state
    markStale();       // new AST → WAT/bytecode from previous compile are now stale
    setLastAst(ast);
    setLastTokens(tokens);
    setLastLineIndex(buildLineIndex(ast));
    const hd = buildHoverData(tokens, ast, expLog);
    setLastHoverData(hd);
    mainSv.hoverData = hd;
    setExpLog(expLog);
    outAst.replaceChildren(renderAST(ast));
    updateMacroPanels(expLog);

    requestAnimationFrame(updateAc);

    const allErrors = [...parseErrors, ...typeErrors];
    if (allErrors.length > 0) {
      if (errorPanel?.setErrors) errorPanel.setErrors(allErrors);
      else renderErrorList(outErrors, allErrors);
      // highlight both parse and type error spans in the editor
      const allSpans = allErrors
        .filter(e => e.start != null)
        .map(e => ({ start: e.start, end: e.end ?? e.start + 1 }));
      setLastErrorRanges(allSpans.length > 0 ? allSpans : null);
      applyHighlight(allSpans.length > 0 ? allSpans : null);
    } else {
      if (errorPanel?.clear) errorPanel.clear(); else outErrors.replaceChildren();
      setLastErrorRanges(null);
      applyHighlight(null);
    }
  }, 150);
}
editor.addEventListener('input', () => {
  setCompiled(false);
  lastWasmBytes = null;
  const errRanges = getLastErrorRanges();
  applyHighlight(errRanges.length > 0 ? errRanges : null);
  requestAnimationFrame(updateAc);
  triggerLiveCompile(getEditorText());
});

editor.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (acState.visible) return;
  e.preventDefault();
  const src  = getEditorText();
  const pos  = getCaretOffset();
  const lineStart = src.lastIndexOf('\n', pos - 1) + 1;
  const currentLine = src.slice(lineStart, pos);
  const indent = currentLine.match(/^(\s*)/)[1];
  // Extra indent after opening brace
  const extra = currentLine.trimEnd().endsWith('{') ? '    ' : '';
  document.execCommand('insertText', false, '\n' + indent + extra);
});

editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

// ── Compile ───────────────────────────────────────────────────────────────────

/**
 * Given an already-parsed AST, run codegen and render WAT + Bytecode panels.
 * Also updates module-level state (lastWasmBytes, lastModule, lastSSpans, stmtMap).
 * Called from btnCompile AND from the debug start path.
 */
function applyGenerateResult(ast) {
  const { bytes, byteSpans, watText, watSpans, module, sSpans, stmtMap } = generate(ast);
  lastWasmBytes = bytes;
  lastModule    = module;
  lastSSpans    = sSpans;
  setStmtMap(stmtMap);
  watRoot.replaceChildren(renderWAT(watText, watSpans, enclosingStmt));
  renderBytecode(outBytecode, bytes, byteSpans, enclosingStmt);
  clearStale();
}

btnCompile.addEventListener('click', () => {
  clearOutputs();
  try {
    const src             = getEditorText();
    const { tokens, ast, expLog, parseErrors } = compile(src);
    setLastTokens(tokens);
    setLastAst(ast);
    setLastLineIndex(buildLineIndex(ast));
    const hd = buildHoverData(tokens, ast, expLog);
    setLastHoverData(hd);
    mainSv.hoverData = hd;
    setExpLog(expLog);
    outAst.replaceChildren(renderAST(ast));

    if (parseErrors.length > 0) {
      setCompiled(false);
      if (errorPanel?.setErrors) errorPanel.setErrors(parseErrors);
      else renderErrorList(outErrors, parseErrors);
      log('console', `\u2717 ${parseErrors.length} parse error(s) \u2014 popraw kod, aby uruchomi\u0107`);
      const first = parseErrors[0];
      if (first.start != null) {
        const end = first.end ?? first.start + 1;
        setLastErrorRange({ start: first.start, end });
        applyHighlight(parseErrors.map(e => ({ start: e.start ?? 0, end: e.end ?? (e.start ?? 0) + 1 })));
      }
      return;
    }

    setLastErrorRange(null);
    setExpLog(expLog);
    applyGenerateResult(ast);
    updateMacroPanels(expLog);
    setCompiled(true);

    log('console', '\u2713 Kompilacja OK \u2014 kliknij Run aby uruchomi\u0107 main()');
    applyHighlight(null);
  } catch (e) {
    setCompiled(false);
    showError(e);
  }
});

// ── Run ───────────────────────────────────────────────────────────────────────

// SharedArrayBuffer layout: [0..3]=state  [4..7]=len  [8..1031]=data
const STATE_IDLE  =  0;
const STATE_READY =  2;
const STATE_ABORT = -1;
const SHARED_BUF_SIZE = 8 + 1024;

let _runWorker = null;   // active Worker, if any

function _terminateRun() {
  if (!_runWorker) return;
  _runWorker.terminate();
  _runWorker = null;
  consolePanel?.cancelInput?.();
  _enterState('idle');
}

btnRun.addEventListener('click', () => {
  if (!_compiled || !lastWasmBytes) return;

  _terminateRun();   // cancel any previous run
  _enterState('running');

  const sharedBuf = new SharedArrayBuffer(SHARED_BUF_SIZE);
  const ctrl      = new Int32Array(sharedBuf, 0, 1);
  const lenArr    = new Int32Array(sharedBuf, 4, 1);
  const inputBuf  = new Uint8Array(sharedBuf, 8);
  const encoder   = new TextEncoder();

  const worker = new Worker(new URL('./wasm-runner.js', import.meta.url), { type: 'module' });
  _runWorker = worker;

  worker.onerror = () => {
    log('console', 'Worker failed to start');
    _runWorker = null;
    _enterState('idle');
  };

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'write':
        if (consolePanel?.write) consolePanel.write(data.text);
        else { outConsole.appendChild(document.createTextNode(data.text)); outConsole.scrollTop = outConsole.scrollHeight; }
        break;
      case 'println':
        if (consolePanel?.write) consolePanel.write(data.text + '\n');
        else { outConsole.appendChild(document.createTextNode(data.text + '\n')); outConsole.scrollTop = outConsole.scrollHeight; }
        break;
      case 'input-wait':
        consolePanel?.startInput(text => {
          const bytes = encoder.encode(text);
          const n = Math.min(bytes.length, 1024);
          inputBuf.set(bytes.subarray(0, n));
          Atomics.store(lenArr, 0, n);
          Atomics.store(ctrl, 0, STATE_READY);
          Atomics.notify(ctrl, 0, 1);
        });
        break;
      case 'done': {
        const { result, elapsed } = data;
        if (result !== undefined && result !== null) log('console', 'main() = ' + result);
        log('console', 'execution time: ' + elapsed.toFixed(3) + 'ms');
        worker.terminate();
        _runWorker = null;
        consolePanel?.cancelInput?.();
        _enterState('idle');
        break;
      }
      case 'error':
        log('console', 'Runtime error: ' + data.message);
        worker.terminate();
        _runWorker = null;
        consolePanel?.cancelInput?.();
        _enterState('idle');
        break;
    }
  };

  // Transfer a copy so lastWasmBytes stays intact for the debugger
  const bytesCopy = lastWasmBytes.slice();
  worker.postMessage({ bytes: bytesCopy, sharedBuf, mode: 'run' }, [bytesCopy.buffer]);
});

// ── Stop ──────────────────────────────────────────────────────────────────────

btnStop.addEventListener('click', () => {
  if (_programState === 'running') {
    log('console', '⏹ Program stopped');
    _terminateRun();
  } else if (_programState === 'debugging') {
    stopDebugger();   // calls _enterState('idle') via onStop callback
    log('console', '◎ Debug session stopped');
  }
});

// ── Clear ─────────────────────────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  _terminateRun();
  clearOutputs();
  lastWasmBytes = null;
  setCompiled(false);
  setLastHoverData([]);
  setLastTokens(null);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearOutputs() {
  if (consolePanel?.clear) consolePanel.clear(); else outConsole.textContent = '';
  if (errorPanel?.clear)   errorPanel.clear();   else outErrors.replaceChildren();
  outAst.replaceChildren();
  outBytecode.replaceChildren();
  watRoot.replaceChildren();
  clearStale();
  setLastLineIndex(null);
  setLastErrorRange(null);
  setLastErrorInfo(null);
  setLastAst(null);
  setStmtMap(null);
  lastModule = null;
  lastSSpans = [];
  clearAllBps();
  mainSv.setBpLines(new Set());
  stopDebugger();
}

function log(panel, msg) {
  if (panel === 'errors') {
    if (errorPanel?.log) errorPanel.log(msg);
    else {
      const span = document.createElement('span');
      span.className = 'err-line';
      span.textContent = msg;
      outErrors.appendChild(span);
      outErrors.appendChild(document.createTextNode('\n'));
    }
  } else {
    if (consolePanel?.log) consolePanel.log(msg);
    else {
      const span = document.createElement('span');
      span.style.color = 'var(--accent, #89b4fa)';
      span.textContent = msg + '\n';
      outConsole.appendChild(span);
      outConsole.scrollTop = outConsole.scrollHeight;
    }
  }
}

function showError(e) {
  const msg = e.message || String(e);
  if (errorPanel?.setErrors) errorPanel.setErrors([e]);
  else renderErrorList(outErrors, [e]);
  log('console', '\u2717 ' + msg);
  setLastErrorInfo({ start: e.start ?? null, end: e.end ?? null, line: e.line ?? null });
  if (e.canonicalRef) {
    navigateToRef(e.canonicalRef, getExpLog());
  } else if (e.start != null) {
    const end = e.end ?? e.start + 1;
    setLastErrorRange({ start: e.start, end });
    applyHighlight([{ start: e.start, end }]);
  } else if (e.line != null) {
    const src = getEditorText();
    const lines = src.split('\n');
    const lineIdx = e.line - 1;
    if (lineIdx >= 0 && lineIdx < lines.length) {
      let lineStart = 0;
      for (let i = 0; i < lineIdx; i++) lineStart += lines[i].length + 1;
      const lineEnd = lineStart + lines[lineIdx].length;
      setLastErrorRange({ start: lineStart, end: lineEnd });
      applyHighlight([{ start: lineStart, end: lineEnd }]);
    }
  }
}

// Render list of errors as clickable spans into a container element.
// Each span carries data-start / data-line for click-to-navigate.
function renderErrorList(container, errors) {
  container.replaceChildren();
  for (const e of errors) {
    const span = document.createElement('span');
    span.className = 'err-line';
    span.textContent = e.message || String(e);
    if (e.canonicalRef)    span.dataset.canonicalRef = e.canonicalRef;
    if (e.start != null)   span.dataset.start = String(e.start);
    if (e.end   != null)   span.dataset.end   = String(e.end);
    if (e.line  != null)   span.dataset.line  = String(e.line);
    container.appendChild(span);
  }
}

// Click an error line → scroll + highlight the offending range in source.
// Uses the ql-error-click event from <qlang-error-panel> when available,
// with a fallback direct click handler on the raw <pre>.
function handleErrorClick(detail) {
  if (detail.canonicalRef) {
    navigateToRef(detail.canonicalRef, getExpLog());
  } else if (detail.start != null) {
    const end = detail.end ?? detail.start + 1;
    highlightSourceRange('main', detail.start, end);
  } else if (detail.line != null) {
    const text = getEditorText();
    const lines = text.split('\n');
    let ls = 0;
    for (let i = 0; i < detail.line - 1 && i < lines.length; i++) ls += lines[i].length + 1;
    const le = ls + (lines[detail.line - 1]?.length ?? 0);
    highlightSourceRange('main', ls, le);
  }
}

if (errorPanel) {
  errorPanel.addEventListener('ql-error-click', e => handleErrorClick(e.detail));
} else {
  outErrors.addEventListener('click', e => {
    const span = e.target.closest('.err-line');
    if (!span) return;
    handleErrorClick({
      canonicalRef: span.dataset.canonicalRef || null,
      start:        span.dataset.start != null ? +span.dataset.start : null,
      end:          span.dataset.end   != null ? +span.dataset.end   : null,
      line:         span.dataset.line  != null ? +span.dataset.line  : null,
    });
  });
}

// ── Debugger init ─────────────────────────────────────────────────────

initDebugger(generate, log, {
  onStart: () => _enterState('debugging'),
  onStop:  () => _enterState('idle'),
  consolePanel,
});

// ── Load default example + startup compile ─────────────────────────────────

fetch(new URL('../examples/showcase.qlang', import.meta.url))
  .then(r => r.text())
  .then(text => { text = text.replace(/\r\n/g, '\n'); mainSv.setText(text); triggerLiveCompile(text); })
  .catch(() => triggerLiveCompile(''));

// ── Examples picker ────────────────────────────────────────────────────

initExamples(text => { mainSv.setText(text); setCompiled(false); triggerLiveCompile(text); });