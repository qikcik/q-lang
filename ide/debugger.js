// ide/debugger.js — debug session management
//
// Breakpoint state:
//   sourceBps : Map<sourceId, Set<line>>  — one map for ALL sources (user + macro)
//   addBp(sourceId, line) / removeBp / hasBp / getBpLines
//   clearAllBps()
//
// Debug session:
//   debugSession.breakpoints : Set<stmtId>  — resolved once at debug start
//   brk(stmtId): direct numeric check, no ASTNode identity
//
// Exports:
//   sourceBps, addBp, removeBp, hasBp, getBpLines, clearAllBps
//   stopDebugger()
//   initDebugger(generate, log)

import {
  clearSourceHighlight,
  highlightBytecodeForNode, highlightWatForNode, highlightAstForNode,
} from './crossSelection.js';

import { applyChainHighlights, clearAll, highlightNodeChain, nodeToChainSegments } from './highlight.js';
import { getSource } from './source-registry.js';
import { srcStart, srcEnd, offsetToLine, offsetToLineCol } from '../compiler/source.js';

import { getEditorText } from './editor.js';
import { getLastAst } from './lsp.js';
import { segmentLabel } from '../compiler/source-ref.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btnDebug    = document.getElementById('btn-debug');
const dbgPanel    = document.getElementById('debugger-panel');
const dbgInstr    = document.getElementById('dbg-instr');
const dbgStep     = document.getElementById('dbg-step');
const dbgContinue = document.getElementById('dbg-continue');
const dbgCanonical = document.getElementById('dbg-canonical');

// ── Breakpoint state ─────────────────────────────────────────────────────────
// One Map for all sources: 'main' for the main editor, 'macro:...' for expansions.
// Lines are 1-based within the source's text buffer.

export const sourceBps = new Map();  // Map<sourceId, Set<line>>

export function addBp(sourceId, line) {
  if (!sourceBps.has(sourceId)) sourceBps.set(sourceId, new Set());
  sourceBps.get(sourceId).add(line);
}

export function removeBp(sourceId, line) {
  sourceBps.get(sourceId)?.delete(line);
}

export function hasBp(sourceId, line) {
  return sourceBps.get(sourceId)?.has(line) ?? false;
}

export function getBpLines(sourceId) {
  return sourceBps.get(sourceId) ?? new Set();
}

export function clearAllBps() {
  sourceBps.clear();
}

// ── Debug session state ───────────────────────────────────────────────────────

let debugSession = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

let _onStopCb = null;
let _consolePanel = null;

export function stopDebugger() {
  _terminateDebug();
  _consolePanel?.cancelInput?.();
  debugSession = null;
  dbgInstr.textContent = '';
  dbgStep.disabled    = true;
  dbgContinue.disabled = true;
  clearDebugHighlights();
  _onStopCb?.();
}

function clearDebugHighlights() {
  document.querySelectorAll('.dbg-current-line').forEach(el => el.classList.remove('dbg-current-line'));
  if (dbgCanonical) dbgCanonical.innerHTML = '';
  clearAll();
}

function openDebuggerPane() {
  const subPane = dbgPanel.closest('.sub-pane');
  if (subPane && subPane.classList.contains('pane-collapsed')) {
    subPane.classList.remove('pane-collapsed');
    const label = subPane.querySelector('.pane-label');
    if (label) label.classList.remove('collapsed');
    const body = label?.nextElementSibling;
    if (body) body.classList.remove('pane-body-hidden');
  }
}

function highlightDebugStmt(stmtId) {
  clearDebugHighlights();
  const astNode = debugSession?.stmtMap?.get(stmtId);
  if (!astNode) return;

  // WAT / bytecode / AST highlights always use the full stmtMap node.
  highlightBytecodeForNode(astNode);
  highlightWatForNode(astNode);
  highlightAstForNode(astNode);

  // For if/while show the condition line, not the full block.
  const isBlock  = astNode.kind === 'IfStmt' || astNode.kind === 'WhileStmt';
  const dispNode = isBlock && astNode.condition ? astNode.condition : astNode;

  // Pick the node we have rendering coordinates for.
  const renderNode = dispNode.__src ? dispNode : astNode.__src ? astNode : null;

  if (renderNode?.__src) {
    const src = renderNode.__src;
    const s   = srcStart(renderNode);
    const e   = srcEnd(renderNode);
    const ls  = src.text.lastIndexOf('\n', s - 1) + 1;
    const le  = src.text.indexOf('\n', e);
    dbgInstr.textContent = src.text.substring(ls, le === -1 ? src.text.length : le).trim();
    highlightNodeChain(renderNode);
    _renderCanonicalPath(nodeToChainSegments(renderNode));
  } else {
    // No Source tagged — fall back to raw editor text (should not normally happen).
    const s = dispNode.start ?? astNode.start;
    const e = dispNode.end   ?? astNode.end   ?? s;
    if (s == null) { dbgInstr.textContent = ''; return; }
    const text  = getEditorText();
    const ls    = text.lastIndexOf('\n', s - 1) + 1;
    const le    = text.indexOf('\n', e);
    dbgInstr.textContent = text.substring(ls, le === -1 ? text.length : le).trim();
    const fallbackSegs = [{ sourceId: 'main', startLine: 0, startCol: s, endLine: 0, endCol: e }];
    applyChainHighlights(fallbackSegs, 0);
    _renderCanonicalPath(fallbackSegs);
  }
}

function _renderCanonicalPath(segments) {
  if (!dbgCanonical) return;
  dbgCanonical.innerHTML = '';
  if (segments.length === 0) return;
  segments.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'dbg-crumb-sep';
      sep.textContent = ' › ';
      dbgCanonical.appendChild(sep);
    }
    // Compute line:col range from raw offsets
    let rangeStr = '';
    const srcText = getSource(seg.sourceId)?.text ?? (seg.sourceId === 'main' ? getEditorText() : null);
    if (srcText) {
      const s = offsetToLineCol(srcText, seg.startCol);
      const e = offsetToLineCol(srcText, seg.endCol);
      rangeStr = `[${s.line}:${s.col}-${e.line}:${e.col}]`;
    }
    const crumb = document.createElement('span');
    crumb.className = 'dbg-crumb' + (i === segments.length - 1 ? ' dbg-crumb-active' : '');
    crumb.addEventListener('click', () => applyChainHighlights(segments, i));
    const labelSpan = document.createElement('span');
    labelSpan.textContent = segmentLabel(seg.sourceId);
    crumb.appendChild(labelSpan);
    if (rangeStr) {
      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'dbg-crumb-range';
      rangeSpan.textContent = rangeStr;
      crumb.appendChild(rangeSpan);
    }
    dbgCanonical.appendChild(crumb);
  });
}

// ── Debug Worker state ────────────────────────────────────────────────────────

const STATE_PAUSE    =  3;
const STATE_STEP     =  4;
const STATE_CONTINUE =  5;
const STATE_ABORT    = -1;
const STATE_INPUTOK  =  2;
const SHARED_BUF_SIZE = 8 + 1024;

let _debugWorker = null;
let _debugCtrl   = null;   // Int32Array view on sharedBuf[0]
let _debugLen    = null;   // Int32Array view on sharedBuf[4]
let _debugInput  = null;   // Uint8Array view on sharedBuf[8..]

function _terminateDebug() {
  if (_debugWorker) {
    if (_debugCtrl) {
      Atomics.store(_debugCtrl, 0, STATE_ABORT);
      Atomics.notify(_debugCtrl, 0, 1);
    }
    _debugWorker.terminate();
    _debugWorker = null;
  }
  _debugCtrl = _debugLen = _debugInput = null;
}

// ── Event listeners ───────────────────────────────────────────────────────────

export function initDebugger(generate, log, { onStart, onStop, consolePanel } = {}) {
  _onStopCb = onStop ?? null;
  _consolePanel = consolePanel ?? null;
  dbgStep.disabled    = true;
  dbgContinue.disabled = true;

  const encoder = new TextEncoder();
  const outConsole = document.getElementById('out-console');

  function _writeConsole(text)   { if (consolePanel?.write) consolePanel.write(text); else { outConsole.textContent += text; } }
  function _writeLnConsole(text) { _writeConsole(text + '\n'); }

  function _startDebugWorker(bytes, stmtMap, resolvedBreakpoints, wasmImports = []) {
    _terminateDebug();

    const sharedBuf = new SharedArrayBuffer(SHARED_BUF_SIZE);
    _debugCtrl  = new Int32Array(sharedBuf, 0, 1);
    _debugLen   = new Int32Array(sharedBuf, 4, 1);
    _debugInput = new Uint8Array(sharedBuf, 8);

    const worker = new Worker(new URL('./wasm-runner.js', import.meta.url), { type: 'module' });
    _debugWorker = worker;

    worker.onerror = () => {
      log('console', 'Debug worker failed to start');
      stopDebugger();
    };

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case 'write':   _writeConsole(data.text); break;
        case 'println': _writeLnConsole(data.text); break;
        case 'input-wait':
          consolePanel?.startInput(text => {
            const encoded = encoder.encode(text);
            const n = Math.min(encoded.length, 1024);
            _debugInput.set(encoded.subarray(0, n));
            Atomics.store(_debugLen, 0, n);
            Atomics.store(_debugCtrl, 0, STATE_INPUTOK);
            Atomics.notify(_debugCtrl, 0, 1);
          });
          break;
        case 'pause':
          highlightDebugStmt(data.stmtId);
          break;
        case 'done': {
          const { result, elapsed } = data;
          if (result !== undefined && result !== null) log('console', 'main() = ' + result);
          if (elapsed > 0) log('console', 'execution time: ' + elapsed.toFixed(3) + 'ms');
          log('console', '\u25ce Debug session ended');
          dbgInstr.textContent = '(finished)';
          stopDebugger();
          break;
        }
        case 'error':
          log('console', 'Runtime error: ' + data.message);
          stopDebugger();
          break;
      }
    };

    const bytesCopy = bytes.slice();
    worker.postMessage({
      bytes: bytesCopy,
      sharedBuf,
      mode: 'debug',
      breakpoints: [...resolvedBreakpoints],
      wasmImports,
    }, [bytesCopy.buffer]);
  }

  btnDebug.addEventListener('click', () => {
    if (debugSession) { stopDebugger(); return; }
    try {
      const ast = getLastAst();
      if (!ast) { log('console', 'Kliknij Compile przed Debug.'); return; }

      const { bytes, stmtMap, wasmImports } = generate(ast, { debug: true });
      if (!stmtMap || stmtMap.size === 0) {
        log('console', 'No statements to debug.');
        return;
      }
      openDebuggerPane();
      dbgStep.disabled    = false;
      dbgContinue.disabled = false;
      onStart?.();

      // Resolve breakpoints
      const resolvedBreakpoints = new Set();
      const mainText = getEditorText();
      for (const [stmtId, node] of stmtMap) {
        const nodeSrc = node.__src;
        if (!nodeSrc) continue;
        const line = offsetToLine(nodeSrc.text, srcStart(node));
        if (hasBp(nodeSrc.id, line)) { resolvedBreakpoints.add(stmtId); continue; }
        if (nodeSrc.kind === 'macro' && node.start != null) {
          const cs = nodeSrc.callSite;
          if (cs && node.start >= cs.start && node.start <= cs.end) {
            const mainLine = offsetToLine(mainText, node.start);
            if (hasBp('main', mainLine)) resolvedBreakpoints.add(stmtId);
          }
        }
      }

      debugSession = { stmtMap, breakpoints: resolvedBreakpoints };

      log('console', resolvedBreakpoints.size > 0
        ? '\u25ce Debug — running to first breakpoint\u2026'
        : '\u25ce Debug — stepping\u2026');

      _startDebugWorker(bytes, stmtMap, resolvedBreakpoints, wasmImports ?? []);
    } catch (e) {
      log('console', 'Debug compile error: ' + e.message);
      stopDebugger();
    }
  });

  dbgStep.addEventListener('click', () => {
    if (!debugSession || !_debugCtrl) return;
    Atomics.store(_debugCtrl, 0, STATE_STEP);
    Atomics.notify(_debugCtrl, 0, 1);
  });

  dbgContinue.addEventListener('click', () => {
    if (!debugSession || !_debugCtrl) return;
    Atomics.store(_debugCtrl, 0, STATE_CONTINUE);
    Atomics.notify(_debugCtrl, 0, 1);
  });

}
