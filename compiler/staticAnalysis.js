// ─────────────────────────────────────────────────────────────────────────────
// staticAnalysis.js — type representations, helpers, scope / symbol table
// ─────────────────────────────────────────────────────────────────────────────
//
// Type representations:
//   Scalar:     { kind: 'Type',       name: string }
//   Pointer:    { kind: 'PtrType',    inner: TypeNode }
//   Array:      { kind: 'ArrayType',  elemType: TypeNode, size: number }
//   StructType: { kind: 'StructType', name: string, fields: StructField[],
//                  byteSize: number, fieldOffsets: Map<string,number> }
//   StructField: { name, type, mut, defaultValue: Expr|null }  (resolved — not parser AST)
//   Func:       { name: '__func__',   returnType, paramTypes }
//   Builtin:    { name: '__builtin__', returnType, paramTypes }
//

import { buildCanonicalRef } from './source-ref.js';

export class TypeError extends Error {
  constructor(msg, lineOrNode, start, end) {
    const isNode = lineOrNode && typeof lineOrNode === 'object';
    const line   = isNode ? lineOrNode.line : lineOrNode;
    const srcId  = isNode ? (lineOrNode.__src?.id ?? 'main') : 'main';

    // Build canonical ref for rich location info
    let canonicalRef;
    if (isNode) {
      canonicalRef = buildCanonicalRef(lineOrNode);
    } else {
      // Only have line number — emit simplified 'main[L:1]' form
      const srcLabel = srcId.startsWith('macro:')
        ? srcId.split(':').slice(0, 2).join(':')
        : srcId;
      canonicalRef = `${srcLabel}[${line ?? '?'}:1]`;
    }

    super(`[Type] ${canonicalRef} — ${msg}`);
    this.line         = line;
    this.src          = srcId;
    this.canonicalRef = canonicalRef;
    if (isNode) {
      this.start = lineOrNode.start ?? null;
      this.end   = lineOrNode.end   ?? null;
      this.node  = lineOrNode;
    } else {
      this.start = start ?? null;
      this.end   = end   ?? null;
      this.node  = null;
    }
  }
}

// ── type constants ────────────────────────────────────────────────────────────

export const INT_TYPES   = new Set(['i8','u8','i16','u16','i32','u32','i64','u64']);
export const FLOAT_TYPES = new Set(['f32','f64']);
export const NUM_TYPES   = new Set([...INT_TYPES, ...FLOAT_TYPES]);
// PACK_KIND: macro-subsystem-only aggregate kind. Not a type, cannot be inferred,
// cannot be stored in a variable. Valid only as macro parameter kind 'pack' or 'pack<T>'.
export const PACK_KIND = 'pack';

// UNKNOWN_TYPE_STR: sentinel string used when a type cannot be determined.
// Used in typeStr() and error messages. Named constant for greppability.
export const UNKNOWN_TYPE_STR = '?';
// ── type helpers ──────────────────────────────────────────────────────────────

export function typeEq(a, b) {
  if (a.kind === 'ArrayType' && b.kind === 'ArrayType') {
    return a.size === b.size && typeEq(a.elemType, b.elemType);
  }
  if (a.kind === 'PtrType' && b.kind === 'PtrType') {
    return typeEq(a.inner, b.inner);
  }
  if (a.kind === 'StructType' && b.kind === 'StructType') {
    return a.name === b.name;
  }
  if (a.name === '__func__' && b.name === '__func__') {
    if (!typeEq(a.returnType, b.returnType)) return false;
    if (a.paramTypes.length !== b.paramTypes.length) return false;
    return a.paramTypes.every((p, i) => typeEq(p, b.paramTypes[i]));
  }
  if (a.kind !== b.kind) return false;
  return a.name === b.name;
}

export function typeStr(t) {
  if (!t) return UNKNOWN_TYPE_STR;
  if (t.kind === 'ArrayType') {
    return (t.mut ? 'mut ' : '') + `array<${typeStr(t.elemType)}, ${t.size}>`;
  }
  if (t.kind === 'PtrType') {
    return (t.mut ? 'mut ' : '') + `ptr<${typeStr(t.inner)}>`;
  }
  if (t.kind === 'StructType') {
    return (t.mut ? 'mut ' : '') + t.name;
  }
  if (t.name === '__func__') {
    return 'fn(' + (t.paramTypes || []).map(typeStr).join(', ') + ') ' + typeStr(t.returnType);
  }
  if (t.name === '__builtin__') return t.builtinName || 'builtin';
  return (t.mut ? 'mut ' : '') + (t.name || UNKNOWN_TYPE_STR);
}

export function isNumeric(t) {
  return t.kind !== 'PtrType' && t.kind !== 'ArrayType' && NUM_TYPES.has(t.name);
}

export function isInt(t) {
  return t.kind !== 'PtrType' && t.kind !== 'ArrayType' && INT_TYPES.has(t.name);
}

export function isArray(t) {
  return t.kind === 'ArrayType';
}

export function isPtr(t) {
  return t.kind === 'PtrType';
}

export function isFunc(t) {
  return t.name === '__func__';
}

// Normalize parser FuncType nodes to internal __func__ representation
export function normalizeType(t) {
  if (!t) return t;
  if (t.kind === 'FuncType') {
    return { name: '__func__', mut: false, returnType: normalizeType(t.returnType), paramTypes: t.paramTypes.map(normalizeType) };
  }
  if (t.kind === 'PtrType') {
    return { ...t, inner: normalizeType(t.inner) };
  }
  if (t.kind === 'ArrayType') {
    return { ...t, elemType: normalizeType(t.elemType) };
  }
  return t;
}

// Byte size of one element of a scalar type
export function elemByteSize(typeName) {
  if (['i8','u8','bool'].includes(typeName)) return 1;
  if (['i16','u16'].includes(typeName))      return 2;
  if (['i32','u32','f32'].includes(typeName)) return 4;
  if (['i64','u64','f64'].includes(typeName)) return 8;
  return 4;
}

// Byte size of any resolved type (scalar, array, struct — packed layout)
export function typeByteSize(t) {
  if (!t) return 4;
  if (t.kind === 'Type')      return elemByteSize(t.name);
  if (t.kind === 'PtrType')   return 4;    // pointers are 4 bytes in wasm32
  if (t.kind === 'ArrayType') return t.size * typeByteSize(t.elemType);
  if (t.kind === 'StructType') return t.byteSize;
  return 4;
}

// ── struct type helpers ───────────────────────────────────────────────────────

export function isStruct(t) {
  return t?.kind === 'StructType';
}

// Build a resolved StructType from an array of resolved field descriptors.
//   resolvedFields: [{ name, type, mut }]
// Layout: natural alignment — field start is aligned to min(fieldByteSize, 4).
// Returns a StructType with byte layout pre-computed.
export function buildStructType(name, resolvedFields) {
  const fieldOffsets = new Map();
  let byteSize       = 0;
  for (const f of resolvedFields) {
    const fs    = typeByteSize(f.type);
    const align = Math.min(fs, 4);
    byteSize    = Math.ceil(byteSize / align) * align;
    fieldOffsets.set(f.name, byteSize);
    byteSize += fs;
  }
  return { kind: 'StructType', name, fields: resolvedFields, byteSize, fieldOffsets };
}

// Retrieve a field type by name (returns undefined if not found)
export function structFieldType(st, fieldName) {
  return st.fields.find(f => f.name === fieldName)?.type;
}

// Byte offset of a named field within a struct (returns -1 if not found)
export function fieldByteOffset(st, fieldName) {
  const off = st.fieldOffsets.get(fieldName);
  return off !== undefined ? off : -1;
}

// Numeric compatibility: can literal type 'from' be stored as 'to'?
// Loose rule: any integer literal is assignable to any integer variable.
// Similarly, any float literal is assignable to any float variable.
// Explicit cast via as<T>() is NOT required for same-family numeric types.
export function isAssignable(from, to) {
  // Struct ↔ Struct: same named type
  if (from.kind === 'StructType' && to.kind === 'StructType') {
    return from.name === to.name;
  }
  // Array ↔ Array: same size and compatible element types
  if (isArray(from) && isArray(to)) {
    return from.size === to.size && isAssignable(from.elemType, to.elemType);
  }
  // Array decay: array<T,N> → ptr<T> (array passed where pointer expected)
  if (isArray(from) && isPtr(to)) {
    return typeEq(from.elemType, to.inner);
  }
  // Ptr ↔ Ptr: compatible inner types
  if (isPtr(from) && isPtr(to)) {
    return typeEq(from.inner, to.inner);
  }
  if (isArray(from) || isArray(to)) return false;
  if (isPtr(from) || isPtr(to)) return false;
  if (typeEq(from, to)) return true;
  // Allow any int literal into any int type
  if (INT_TYPES.has(from.name) && INT_TYPES.has(to.name)) return true;
  // Allow any float literal into any float type
  if (FLOAT_TYPES.has(from.name) && FLOAT_TYPES.has(to.name)) return true;
  return false;
}

// Scalar type conversion via 'as' operator
export function canAsConvert(from, to) {
  const fromName = from.name;
  const toName   = to.name;

  if (typeEq(from, to)) return true;
  if (INT_TYPES.has(fromName) && INT_TYPES.has(toName)) return true;
  if (FLOAT_TYPES.has(fromName) && FLOAT_TYPES.has(toName)) return true;
  if (INT_TYPES.has(fromName) && FLOAT_TYPES.has(toName)) return true;
  if (FLOAT_TYPES.has(fromName) && INT_TYPES.has(toName)) return true;
  if (fromName === 'bool' && INT_TYPES.has(toName)) return true;
  if (INT_TYPES.has(fromName) && toName === 'bool') return true;
  if (fromName === 'bool' && FLOAT_TYPES.has(toName)) return true;
  if (FLOAT_TYPES.has(fromName) && toName === 'bool') return true;
  return false;
}

// ── scope / symbol table ──────────────────────────────────────────────────────

export class Scope {
  constructor(parent = null) {
    this.parent     = parent;
    this.symbols    = new Map(); // name → { type, kind, mut, line }
    this.namespaces = null;      // lazy: Map<string, Scope> — allocated only when needed
  }

  define(name, type, kind, mut, line) {
    if (this.symbols.has(name)) {
      throw new TypeError(`'${name}' is already declared in this scope`, line);
    }
    let s = this.parent;
    while (s) {
      if (s.symbols.has(name)) {
        throw new TypeError(`'${name}' shadows an outer declaration`, line);
      }
      s = s.parent;
    }
    this.symbols.set(name, { type, kind, mut: mut ?? false });
  }

  resolve(name, line) {
    let scope = this;
    while (scope) {
      if (scope.symbols.has(name)) return scope.symbols.get(name);
      scope = scope.parent;
    }
    throw new TypeError(`Undefined identifier '${name}'`, line);
  }

  // ── namespace support ───────────────────────────────────────────────────

  defineNamespace(name) {
    if (!this.namespaces) this.namespaces = new Map();
    if (!this.namespaces.has(name)) {
      this.namespaces.set(name, new Scope(this));
    }
    return this.namespaces.get(name);
  }

  findNamespace(name) {
    let scope = this;
    while (scope) {
      if (scope.namespaces && scope.namespaces.has(name)) return scope.namespaces.get(name);
      scope = scope.parent;
    }
    return null;
  }

  resolveQualified(segments, errorNode) {
    if (segments.length === 1) return this.resolve(segments[0], errorNode);

    const nsName = segments[0];

    // Alias expansion — walk parent chain to find namespace-alias symbols
    let scope = this;
    while (scope) {
      const sym = scope.symbols.get(nsName);
      if (sym?.kind === 'namespace-alias') {
        const expanded = [...sym.target, ...segments.slice(1)];
        return this.resolveQualified(expanded, errorNode);
      }
      scope = scope.parent;
    }

    // Namespace lookup
    const ns = this.findNamespace(nsName);
    if (!ns) throw new TypeError(`Undefined namespace '${nsName}'`, errorNode);
    return ns.resolveQualified(segments.slice(1), errorNode);
  }

  defineQualified(segments, type, kind, mut, line) {
    if (segments.length === 1) return this.define(segments[0], type, kind, mut, line);
    const ns = this.defineNamespace(segments[0]);
    return ns.defineQualified(segments.slice(1), type, kind, mut, line);
  }
}
