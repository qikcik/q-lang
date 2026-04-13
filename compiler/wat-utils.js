// ─────────────────────────────────────────────────────────────────────────────
// wat-utils.js — Low-level utilities for WAT/WASM codegen
//
// Exports: canonType, elemByteSize, BumpAllocator, SExprBuilder,
//          BUILTINS, loadInstr, storeInstr, watArithOp, watCmpOp, watConvOp
// ─────────────────────────────────────────────────────────────────────────────

// ── Type helpers ──────────────────────────────────────────────────────────────

export function canonType(t) {
  if (!t) return 'i32';
  if (t.kind === 'ArrayType' || t.kind === 'PtrType' || t.kind === 'StructType') return 'i32';
  const n = t.name;
  if (n === 'void') return 'void';
  if (['i8','u8','i16','u16','i32','u32','bool'].includes(n)) return 'i32';
  if (['i64','u64'].includes(n)) return 'i64';
  if (n === 'f32') return 'f32';
  if (n === 'f64') return 'f64';
  return 'i32';
}

export function elemByteSize(name) {
  if (['i8','u8','bool'].includes(name))  return 1;
  if (['i16','u16'].includes(name))       return 2;
  if (['i32','u32','f32'].includes(name)) return 4;
  if (['i64','u64','f64'].includes(name)) return 8;
  return 4;
}

// ── BumpAllocator ─────────────────────────────────────────────────────────────

export const HEAP_BASE = 1024;

export class BumpAllocator {
  constructor(base = HEAP_BASE) { this.ptr = base; }
  alloc(byteSize, align = 4) {
    this.ptr = Math.ceil(this.ptr / align) * align;
    const addr = this.ptr;
    this.ptr += byteSize;
    return addr;
  }
  allocScalar(name) { const s = elemByteSize(name); return this.alloc(s, Math.min(s, 4)); }
  allocArray(name, n) { const s = elemByteSize(name); return this.alloc(s * n, Math.min(s, 4)); }
}

// ── Built-in imports ──────────────────────────────────────────────────────────
// Each entry maps a mangled QLang name (ext__X) to a WASM import (wasmModule.wasmField).
// The 'name' field is the WASM function name used inside the module ($ext__printLn etc.).

export const BUILTINS = [
  { name: 'ext__print',   wasmModule: 'env', wasmField: 'write_utf8',  params: ['i32','i32'], result: 'void' },
  { name: 'ext__printLn', wasmModule: 'env', wasmField: 'print_utf8',  params: ['i32','i32'], result: 'void' },
  { name: 'ext__input',   wasmModule: 'env', wasmField: 'input_utf8',  params: ['i32','i32'], result: 'i32'  },
];

// ── SExprBuilder ──────────────────────────────────────────────────────────────
// Builds a WatIR S-expr tree (nested arrays) and accumulates SSpans.

export class SExprBuilder {
  constructor() {
    this._root  = [];
    this._stack = [this._root];
    this.sSpans = [];
  }

  get _top() { return this._stack[this._stack.length - 1]; }

  push(node) { this._top.push(node); return node; }

  // Open a new sub-list [tag, ...], push into parent, returns closer.
  openList(tag) {
    const list = [tag];
    this._top.push(list);
    this._stack.push(list);
    return () => { this._stack.pop(); };
  }

  // Record span linking current top-list to an AST node.
  openSpan(astNode) {
    if (!astNode) return () => {};
    const node = this._top;
    const startIdx = node.length;
    return () => { this.sSpans.push({ node, startIdx, endIdx: node.length, astNode }); };
  }

  get root() { return this._root[0]; }
}

// ── Instruction name helpers ──────────────────────────────────────────────────

export function loadInstr(name) {
  if (name === 'i8')  return 'i32.load8_s';
  if (name === 'u8' || name === 'bool') return 'i32.load8_u';
  if (name === 'i16') return 'i32.load16_s';
  if (name === 'u16') return 'i32.load16_u';
  if (['i32','u32'].includes(name)) return 'i32.load';
  if (['i64','u64'].includes(name)) return 'i64.load';
  if (name === 'f32') return 'f32.load';
  if (name === 'f64') return 'f64.load';
  return 'i32.load';
}

export function storeInstr(name) {
  if (['i8','u8','bool'].includes(name)) return 'i32.store8';
  if (['i16','u16'].includes(name))      return 'i32.store16';
  if (['i32','u32'].includes(name))      return 'i32.store';
  if (['i64','u64'].includes(name))      return 'i64.store';
  if (name === 'f32')                    return 'f32.store';
  if (name === 'f64')                    return 'f64.store';
  return 'i32.store';
}

export function watArithOp(t, op) {
  const isFloat = t === 'f32' || t === 'f64';
  switch (op) {
    case '+': return `${t}.add`;
    case '-': return `${t}.sub`;
    case '*': return `${t}.mul`;
    case '/': return isFloat ? `${t}.div` : `${t}.div_s`;
    case '%': return `${t}.rem_s`;
    default:  throw new Error(`[WAT] Unknown arith op '${op}'`);
  }
}

export function watCmpOp(langTypeName, op) {
  const t      = canonType({ name: langTypeName });
  const isFloat  = t === 'f32' || t === 'f64';
  const isSigned = ['i8','i16','i32','i64'].includes(langTypeName);
  const s = isFloat ? '' : (isSigned ? '_s' : '_u');
  switch (op) {
    case '==': return `${t}.eq`;
    case '!=': return `${t}.ne`;
    case '<':  return isFloat ? `${t}.lt` : `${t}.lt${s}`;
    case '>':  return isFloat ? `${t}.gt` : `${t}.gt${s}`;
    case '<=': return isFloat ? `${t}.le` : `${t}.le${s}`;
    case '>=': return isFloat ? `${t}.ge` : `${t}.ge${s}`;
    default:   throw new Error(`[WAT] Unknown cmp op '${op}'`);
  }
}

export function watConvOp(from, to) {
  const table = {
    'i32→f32': 'f32.convert_i32_s', 'i32→f64': 'f64.convert_i32_s',
    'i64→f32': 'f32.convert_i64_s', 'i64→f64': 'f64.convert_i64_s',
    'f32→i32': 'i32.trunc_f32_s',   'f64→i32': 'i32.trunc_f64_s',
    'f32→i64': 'i64.trunc_f32_s',   'f64→i64': 'i64.trunc_f64_s',
    'f32→f64': 'f64.promote_f32',   'f64→f32': 'f32.demote_f64',
    'i32→i64': 'i64.extend_i32_s',  'i64→i32': 'i32.wrap_i64',
  };
  return table[`${from}→${to}`] ?? null;
}
