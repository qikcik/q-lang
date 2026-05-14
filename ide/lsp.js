// lsp.js — editor utilities: autocomplete, hover tooltips,
//           AST sync-highlight, buildLineIndex, error navigation.
//
// State lives in ide-state.js (single source of truth).
// This module re-exports state accessors for backward compatibility.
//
// Exported utilities:
//   buildLineIndex(ast) → Map
//   buildHoverData(tokens, ast) → HoverEntry[]
//   syncAstHighlight()
//   updateAc(), hidePopup()
//   acState — { visible, items, selected }
//
// Editor DOM helpers (getEditorText, getCaretOffset, etc.) live in ./editor.js

import { typeStr, isStruct, isArray, isPtr, isFunc, structFieldType } from '../compiler/staticAnalysis.js';
import { escHtml, syntaxHighlight } from './views.js';
import {
  enclosingStmt, clearHighlights,
  highlightWatForNode, highlightBytecodeForNode,
} from './crossSelection.js';

import {
  getEditorText, getCaretOffset, setCaretOffset,
  getSelectionOffsets, setSelectionRange, getEditorLine,
} from './editor.js';

import {
  setLastAst, getLastAst,
  setLastTokens, getLastTokens,
  setLastHoverData, getLastHoverData,
  setLastLineIndex, getLastLineIndex,
  setLastErrorRange, getLastErrorRange,
  setLastErrorRanges, getLastErrorRanges,
  setLastErrorInfo,
  setLastImportEnv, getLastImportEnv,
} from './ide-state.js';

// ── Re-exports for backward compatibility ─────────────────────────────────────
// main.js and other callers import these from lsp.js — re-export from ide-state.
export {
  setLastAst, getLastAst,
  setLastTokens,
  setLastHoverData, setLastLineIndex, getLastLineIndex,
  setLastErrorRange, setLastErrorRanges, setLastErrorInfo,
  getLastErrorRanges,
  setLastImportEnv,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const editor      = document.getElementById('editor');
const outAst      = document.getElementById('out-ast');

const astStatus   = document.getElementById('ast-status');

// ── Autocomplete state ────────────────────────────────────────────────────────

export const acState = { visible: false, items: [], selected: 0 };

// ── AST line index ────────────────────────────────────────────────────────────

export function buildLineIndex(ast) {
  const map = new Map();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if ('kind' in node && node.line != null) {
      if (!map.has(node.line)) map.set(node.line, []);
      map.get(node.line).push(node);
    }
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === 'object') walk(val);
    }
  })(ast);
  return map;
}

// ── Sync AST highlight with cursor ───────────────────────────────────────────

export function syncAstHighlight() {
  clearHighlights();
  const offset = getCaretOffset();
  let bestEl = null, bestLen = Infinity;
  outAst.querySelectorAll('[data-start]').forEach(el => {
    const s = +el.dataset.start, e = +el.dataset.end;
    if (s <= offset && offset <= e) {
      const len = e - s;
      if (len < bestLen) { bestLen = len; bestEl = el; }
    }
  });
  if (!bestEl && getLastLineIndex()) {
    const line    = getEditorLine();
    const targets = outAst.querySelectorAll('[data-line="' + line + '"]');
    targets.forEach(el => el.classList.add('ast-highlight'));
    if (targets.length > 0) targets[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (bestEl) {
    bestEl.classList.add('ast-highlight');
    let p = bestEl.parentElement;
    while (p && p !== outAst) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentElement; }
    bestEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const astNode = bestEl._astNode;
    if (astNode) {
      const stmtNode = enclosingStmt(astNode);
      if (stmtNode) {
        outAst.querySelectorAll('[data-start]').forEach(el => {
          if (el._astNode === stmtNode) el.classList.add('ast-stmt-highlight');
        });
      }
      highlightWatForNode(stmtNode);
      highlightBytecodeForNode(stmtNode);
    }
  }
}

// ── Hover data builder — delegates to hover.js ───────────────────────────────

export { buildHoverData } from './hover.js';

// ── Autocomplete ──────────────────────────────────────────────────────────────

const AC_STATIC = [
  'return','as','if','else','while','break','mut','ptr','array','fn',
  'i8','u8','i16','u16','i32','u32','i64','u64','f32','f64','bool',
  'print','true','false','struct','namespace','defer','void','macro',
  'import','extern',
];

function getWordAtCursor() {
  const src = getEditorText();
  const pos = getCaretOffset();
  let start = pos;
  while (start > 0 && /[a-zA-Z0-9_]/.test(src[start - 1])) start--;
  return { word: src.slice(start, pos), wordStart: start, src, pos };
}

function getSourceIdents(src, skipStart, skipEnd) {
  const idents = new Set();
  const re = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= skipStart && m.index < skipEnd) continue;
    if (!AC_STATIC.includes(m[0])) idents.add(m[0]);
  }
  return [...idents].sort();
}

// Returns Map<name, { typeStr: string|null, rawType: object|null, itemKind: string }>
// itemKind: 'func' | 'var' | 'param' | 'struct' | 'namespace' | 'macro' | 'keyword'
function getScopeItems(offset) {
  const ast = getLastAst();
  if (!ast) return new Map();
  const items = new Map();
  const setItem = (name, type, kind) => items.set(name, { typeStr: type ? typeStr(type) : null, rawType: type ?? null, itemKind: kind });

  for (const decl of ast.body ?? []) {
    if (decl.kind === 'FuncDecl') {
      setItem(decl.name, decl._type, 'func');
    } else if (decl.kind === 'VarDecl' && decl.end <= offset) {
      setItem(decl.name, decl._type, 'var');
    } else if (decl.kind === 'StructDecl') {
      setItem(decl.name, decl._type, 'struct');
    } else if (decl.kind === 'NamespaceDecl') {
      setItem(decl.name, null, 'namespace');
    } else if (decl.kind === 'NamespaceImport') {
      setItem(decl.alias, null, 'namespace');
    } else if (decl.kind === 'MacroDecl') {
      setItem(decl.name, null, 'macro');
    } else if (decl.kind === 'NamespacedDecl') {
      // Register the namespace prefix
      const nsName = decl.segments[0];
      if (!items.has(nsName)) setItem(nsName, null, 'namespace');
    }
  }

  function enter(node) {
    if (!node || typeof node !== 'object') return;
    if (node.start == null || offset < node.start || offset > node.end) return;
    if (node.kind === 'FuncDecl') {
      for (const p of node.params ?? []) {
        setItem(p.name, p._type ?? p.typeAnnot, 'param');
      }
    }
    if (node.kind === 'Block') {
      for (const stmt of node.body ?? []) {
        if (stmt.kind === 'VarDecl'  && stmt.end <= offset) setItem(stmt.name, stmt._type, 'var');
        if (stmt.kind === 'FuncDecl' && stmt.end <= offset) setItem(stmt.name, stmt._type, 'func');
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'kind' || k === '_type' || k === 'start' || k === 'end' || k === 'line') continue;
      if (Array.isArray(v))                        v.forEach(enter);
      else if (v && typeof v === 'object' && v.kind) enter(v);
    }
  }
  for (const decl of ast.body ?? []) enter(decl);

  return items;
}

// Get namespace members for autocomplete (namespace name → list of {label, typeStr})
function getNamespaceMembers(nsName) {
  const ast = getLastAst();
  if (!ast) return [];
  const members = [];
  for (const decl of ast.body ?? []) {
    if (decl.kind === 'NamespacedDecl' && decl.segments[0] === nsName) {
      const memberName = decl.segments.slice(1).join('::');
      const ts = decl.inner._type ? typeStr(decl.inner._type) : null;
      members.push({ label: memberName, typeStr: ts });
    }
  }
  // Struct and scalar types create namespaces with of/default constructors
  for (const decl of ast.body ?? []) {
    if (decl.kind === 'StructDecl' && decl.name === nsName) {
      members.push({ label: 'of', typeStr: `${nsName}::of(...)` });
      members.push({ label: 'default', typeStr: `${nsName}::default` });
    }
  }
  // Scalar types
  const SCALARS = ['i8','u8','i16','u16','i32','u32','i64','u64','f32','f64','bool'];
  if (SCALARS.includes(nsName)) {
    if (!members.find(m => m.label === 'of'))      members.push({ label: 'of', typeStr: `${nsName}::of(value)` });
    if (!members.find(m => m.label === 'default'))  members.push({ label: 'default', typeStr: `${nsName}::default` });
  }
  // Namespace alias resolution: find target and recurse
  for (const decl of ast.body ?? []) {
    if (decl.kind === 'NamespaceDecl' && decl.name === nsName && decl.target) {
      members.push(...getNamespaceMembers(decl.target[0]));
    }
  }

  // ── Imported namespace members ──────────────────────────────────────────────
  const importEnv = getLastImportEnv();
  if (importEnv?.size) {
    // Case A: nsName is a NamespaceImport alias (e.g. 'm' from 'm := namespace "math.qlang"')
    // Show the top-level names exported by that file.
    const BUILTIN_NS = new Set(['i8','u8','i16','u16','i32','u32','i64','u64','f32','f64','bool','ext']);
    for (const decl of ast?.body ?? []) {
      if (decl.kind === 'NamespaceImport' && decl.alias === nsName) {
        const entry = importEnv.get(decl.filename);
        if (!entry) continue;
        const scope = entry.scope;
        // Sub-namespaces (e.g. 'Vec2' from Vec2::dot declarations and struct constructors)
        // Skip built-in scalar namespaces registered by _registerBuiltins — they are present
        // in every imported scope but are NOT exported symbols of the user's file.
        for (const nsKey of scope.namespaces?.keys() ?? []) {
          if (BUILTIN_NS.has(nsKey)) continue;
          if (!members.find(m => m.label === nsKey)) members.push({ label: nsKey, typeStr: null });
        }
        // Plain top-level functions (non-namespaced) registered under original names in scope.symbols
        for (const [symName, sym] of scope.symbols ?? []) {
          if (sym.kind === 'func' && sym.type?.name === '__func__') {
            if (!members.find(m => m.label === symName))
              members.push({ label: symName, typeStr: typeStr(sym.type) });
          }
        }
      }
    }

    // Case B: nsName may be a namespace inside an imported scope (e.g. 'Vec2' from math.qlang)
    // Show methods: of, default, dot, len_sq, ...
    for (const entry of importEnv.values()) {
      const subNs = entry.scope.namespaces?.get(nsName);
      if (!subNs) continue;
      for (const [mName, sym] of subNs.symbols ?? []) {
        if (members.find(m => m.label === mName)) continue;
        let ts = null;
        if (sym.type?.kind === 'struct-constructor') {
          const sn = sym.type.structType?.name ?? nsName;
          ts = mName === 'of' ? `${sn}::of(...)` : `${sn}::default`;
        } else if (sym.type) {
          ts = typeStr(sym.type);
        }
        members.push({ label: mName, typeStr: ts });
      }
    }
  }

  return members;
}

// ── Chained dot-type resolution ───────────────────────────────────────────────
// Given source text and a dot position (the `.` just before the cursor),
// scan backwards to collect a chain like `player.pos.` → ['player', 'pos']
// and resolve through scope → structFieldType at each step.
// Returns the resolved type object at the end of the chain, or null.
// Exported for testing.

export function resolveChainedType(src, dotPos, scopeItems) {
  // Collect chain segments scanning backwards from dotPos.
  // Pattern: ident.ident.ident.  (cursor is after last dot)
  const segments = [];
  let pos = dotPos; // pos points at the '.'

  while (true) {
    // Before the dot (or start): expect an identifier
    let idEnd = pos;
    let idStart = idEnd;
    while (idStart > 0 && /[a-zA-Z0-9_]/.test(src[idStart - 1])) idStart--;
    if (idStart === idEnd) break; // no identifier before dot
    segments.unshift(src.slice(idStart, idEnd));

    // Before the identifier: is there another dot?
    if (idStart > 0 && src[idStart - 1] === '.') {
      pos = idStart - 1;
    } else {
      break;
    }
  }

  if (segments.length === 0) return null;

  // Resolve the first segment from scope
  const baseInfo = scopeItems.get(segments[0]);
  if (!baseInfo?.rawType) return null;

  // Walk the chain: base → field1 → field2 → ...
  let currentType = baseInfo.rawType;
  for (let i = 1; i < segments.length; i++) {
    if (isStruct(currentType)) {
      const fieldTy = structFieldType(currentType, segments[i]);
      if (!fieldTy) return null;
      currentType = fieldTy;
    } else if (isArray(currentType) && segments[i] === 'size') {
      currentType = { kind: 'Type', name: 'u32', mut: false };
    } else if (isPtr(currentType) && segments[i] === '*') {
      currentType = currentType.inner;
    } else {
      return null; // can't chain further
    }
  }

  return currentType;
}

const acPopup = Object.assign(document.createElement('div'), { id: 'ac-popup' });
document.body.appendChild(acPopup);

function renderPopup() {
  acPopup.innerHTML = acState.items.map(function(item, i) {
    const cls  = 'ac-item' + (i === acState.selected ? ' ac-sel' : '');
    const hint = item.typeStr ? ' <span class="ac-type">' + escHtml(item.typeStr) + '</span>' : '';
    return '<div class="' + cls + '" data-i="' + i + '">' + escHtml(item.label) + hint + '</div>';
  }).join('');
}

function showPopup() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect  = range.getBoundingClientRect();
  const lineH = parseFloat(getComputedStyle(editor).lineHeight);
  const top   = rect.height > 0 ? rect.bottom : (rect.top || 0) + lineH;
  acPopup.style.top     = top + 'px';
  acPopup.style.left    = rect.left + 'px';
  acPopup.style.display = 'block';
  acState.visible = true;
}

export function hidePopup() {
  acPopup.style.display = 'none';
  acState.visible = false;
}

function applyItem() {
  if (!acState.items.length) return;
  const chosen = acState.items[acState.selected].label;
  const { word, wordStart, src, pos } = getWordAtCursor();
  editor.innerHTML = syntaxHighlight(
    src.slice(0, wordStart) + chosen + src.slice(pos),
    getLastErrorRange() ? [getLastErrorRange()] : null,
  );
  setCaretOffset(wordStart + chosen.length);
  hidePopup();
}

export function updateAc() {
  const { word, wordStart, src } = getWordAtCursor();

  // ── :: completion (namespaces, struct constructors, scalar constructors) ──
  // Detect pattern: Ident:: or Ident::partial
  const beforeWord = src.slice(0, wordStart);
  const nsMatch = beforeWord.match(/([a-zA-Z_][a-zA-Z0-9_]*)::$/);
  if (nsMatch) {
    const nsName = nsMatch[1];
    const members = getNamespaceMembers(nsName);
    // Also offer struct/namespace names from scope that start with the typed prefix
    const matches = word.length > 0
      ? members.filter(m => m.label.startsWith(word))
      : members;
    if (!matches.length) { hidePopup(); return; }
    acState.items = matches;
    acState.selected = 0;
    renderPopup(); showPopup(); return;
  }

  // ── Dot completion (struct fields, array.size, ptr.*, chained) ───────
  if (wordStart > 0 && src[wordStart - 1] === '.') {
    const dotPos = wordStart - 1;
    const resolvedType = resolveChainedType(src, dotPos, getScopeItems(dotPos));

    let members = [];
    if (resolvedType && isStruct(resolvedType)) {
      for (const f of resolvedType.fields ?? []) {
        members.push({ label: f.name, typeStr: (f.mut ? 'mut ' : '') + typeStr(f.type) });
      }
    } else if (resolvedType && isPtr(resolvedType)) {
      members.push({ label: '*', typeStr: typeStr(resolvedType.inner) });
    } else if (resolvedType && isArray(resolvedType)) {
      members.push({ label: '[', typeStr: `${typeStr(resolvedType.elemType)}  (index access)` });
      members.push({ label: 'size', typeStr: `u32  =  ${resolvedType.size}` });
    } else {
      // Scalar, non-composite, or unknown type — no members to offer
    }

    const matches = members.filter(m => m.label.startsWith(word));
    if (!matches.length) { hidePopup(); return; }
    acState.items = matches;
    acState.selected = 0;
    renderPopup(); showPopup(); return;
  }

  if (word.length < 1) { hidePopup(); return; }

  // ── General completion (keywords + scope symbols) ──────────────────────
  const candidates = new Map();
  for (const k of AC_STATIC) candidates.set(k, { label: k, typeStr: null });
  for (const [name, info] of getScopeItems(wordStart)) {
    candidates.set(name, { label: name, typeStr: info.typeStr });
  }
  if (!getLastAst()) {
    for (const id of getSourceIdents(src, wordStart, wordStart + word.length)) {
      if (!candidates.has(id)) candidates.set(id, { label: id, typeStr: null });
    }
  }

  const matches = [];
  for (const [name, item] of candidates) {
    if (name !== word && name.startsWith(word)) matches.push(item);
  }
  matches.sort((a, b) => a.label.localeCompare(b.label));

  if (!matches.length) { hidePopup(); return; }
  acState.items = matches; acState.selected = 0;
  renderPopup(); showPopup();
}

// ── Tab key + AC keyboard events ─────────────────────────────────────────────

editor.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  if (acState.visible) return;
  e.preventDefault();
  const text = getEditorText();
  const { start, end } = getSelectionOffsets();

  if (!e.shiftKey) {
    if (start === end) {
      document.execCommand('insertText', false, '    ');
    } else {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const selected  = text.slice(lineStart, end);
      const indented  = selected.replace(/^/gm, '    ');
      editor.innerHTML = syntaxHighlight(
        text.slice(0, lineStart) + indented + text.slice(end),
        getLastErrorRange() ? [getLastErrorRange()] : null,
      );
      setSelectionRange(lineStart, lineStart + indented.length);
    }
  } else {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const selected  = text.slice(lineStart, end);
    const dedented  = selected.replace(/^ {1,4}/gm, '');
    editor.innerHTML = syntaxHighlight(
      text.slice(0, lineStart) + dedented + text.slice(end),
      getLastErrorRange() ? [getLastErrorRange()] : null,
    );
    setSelectionRange(lineStart, lineStart + dedented.length);
  }

  updateAc();
});

editor.addEventListener('keydown', e => {
  if (!acState.visible) return;
  if (e.key === 'Escape') {
    e.preventDefault(); hidePopup();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    acState.selected = (acState.selected + 1) % acState.items.length;
    renderPopup();
    acPopup.querySelectorAll('.ac-item')[acState.selected]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acState.selected = (acState.selected - 1 + acState.items.length) % acState.items.length;
    renderPopup();
    acPopup.querySelectorAll('.ac-item')[acState.selected]?.scrollIntoView({ block: 'nearest' });
  } else if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
    e.preventDefault();
    applyItem();
  }
});

acPopup.addEventListener('mousedown', e => {
  const item = e.target.closest('.ac-item');
  if (!item) return;
  e.preventDefault();
  acState.selected = +item.dataset.i;
  applyItem();
});

editor.addEventListener('blur', () => setTimeout(hidePopup, 120));

editor.addEventListener('click',  syncAstHighlight);
editor.addEventListener('keyup',  syncAstHighlight);

// ── AST hover status bar ──────────────────────────────────────────────────────

outAst.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-start],[data-line]');
  if (!el) return;
  const kind = [...el.classList].find(c => c.startsWith('ast-') && c !== 'ast-node' && c !== 'ast-highlight');
  const pos  = el.dataset.start != null
    ? `[${el.dataset.start}..${el.dataset.end})`
    : `line ${el.dataset.line}`;
  astStatus.textContent = 'AST: ' + pos + ' -> ' + (kind ? kind.slice(4) : '');
});
outAst.addEventListener('mouseleave', () => { astStatus.textContent = ''; });

// Error click handling moved to main.js (uses <qlang-error-panel> events).

// Hover tooltip is handled by <qlang-source-view> internally.
