// ─────────────────────────────────────────────────────────────────────────────
// WASM Binary Encoder — low-level helpers for WebAssembly binary format
// https://webassembly.github.io/spec/core/binary/index.html
// ─────────────────────────────────────────────────────────────────────────────

// ── LEB128 encoding ───────────────────────────────────────────────────────────

export function encodeULEB128(value) {
  const out = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    out.push(byte);
  } while (value !== 0);
  return out;
}

export function encodeSLEB128(value) {
  const out = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

// ── IEEE 754 helpers ──────────────────────────────────────────────────────────

export function encodeF32(value) {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true); // little-endian
  return [...new Uint8Array(buf)];
}

export function encodeF64(value) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return [...new Uint8Array(buf)];
}

// ── Vector encoding (WASM vec(x*)) ───────────────────────────────────────────

export function encodeVec(items) {
  return [...encodeULEB128(items.length), ...items.flat()];
}

// ── Section builder ───────────────────────────────────────────────────────────

export function encodeSection(id, contents) {
  const flat = contents.flat(Infinity);
  return [id, ...encodeULEB128(flat.length), ...flat];
}

// ── WASM value types ──────────────────────────────────────────────────────────

export const VALTYPE = Object.freeze({
  i32:  0x7f,
  i64:  0x7e,
  f32:  0x7d,
  f64:  0x7c,
});

// Map language type name to WASM valtype byte
export function wasmValtype(typeName) {
  if (typeName in VALTYPE) return VALTYPE[typeName];
  // Pointer types are i32 (address)
  return VALTYPE.i32;
}

// ── WASM opcodes ──────────────────────────────────────────────────────────────

export const OP = Object.freeze({
  unreachable:  0x00,
  nop:          0x01,
  block:        0x02,
  loop:         0x03,
  if:           0x04,
  else:         0x05,
  end:          0x0b,
  br:           0x0c,
  br_if:        0x0d,
  return:       0x0f,
  call:         0x10,
  call_indirect: 0x11,
  drop:         0x1a,
  local_get:    0x20,
  local_set:    0x21,
  local_tee:    0x22,
  global_get:   0x23,
  global_set:   0x24,
  i32_load:     0x28,
  i64_load:     0x29,
  f32_load:     0x2a,
  f64_load:     0x2b,
  i32_load8_s:  0x2c,
  i32_load8_u:  0x2d,
  i32_load16_s: 0x2e,
  i32_load16_u: 0x2f,
  i64_load8_s:  0x30,
  i64_load8_u:  0x31,
  i64_load16_s: 0x32,
  i64_load16_u: 0x33,
  i64_load32_s: 0x34,
  i64_load32_u: 0x35,
  i32_store:    0x36,
  i64_store:    0x37,
  f32_store:    0x38,
  f64_store:    0x39,
  i32_store8:   0x3a,
  i32_store16:  0x3b,
  i64_store8:   0x3c,
  i64_store16:  0x3d,
  memory_size:  0x3f,
  memory_grow:  0x40,
  i32_const:    0x41,
  i64_const:    0x42,
  f32_const:    0x43,
  f64_const:    0x44,
  i32_eqz:      0x45,
  i32_eq:       0x46,
  i32_ne:       0x47,
  i32_lt_s:     0x48,
  i32_lt_u:     0x49,
  i32_gt_s:     0x4a,
  i32_gt_u:     0x4b,
  i32_le_s:     0x4c,
  i32_le_u:     0x4d,
  i32_ge_s:     0x4e,
  i32_ge_u:     0x4f,
  i64_eqz:      0x50,
  i64_eq:       0x51,
  i64_ne:       0x52,
  i64_lt_s:     0x53,
  i64_lt_u:     0x54,
  i64_gt_s:     0x55,
  i64_gt_u:     0x56,
  i64_le_s:     0x57,
  i64_le_u:     0x58,
  i64_ge_s:     0x59,
  i64_ge_u:     0x5a,
  f32_eq:       0x5b,
  f32_ne:       0x5c,
  f32_lt:       0x5d,
  f32_gt:       0x5e,
  f32_le:       0x5f,
  f32_ge:       0x60,
  f64_eq:       0x61,
  f64_ne:       0x62,
  f64_lt:       0x63,
  f64_gt:       0x64,
  f64_le:       0x65,
  f64_ge:       0x66,
  i32_add:      0x6a,
  i32_sub:      0x6b,
  i32_mul:      0x6c,
  i32_div_s:    0x6d,
  i32_div_u:    0x6e,
  i32_and:      0x71,
  i32_or:       0x72,
  i32_xor:      0x73,
  i64_add:      0x7c,
  i64_sub:      0x7d,
  i64_mul:      0x7e,
  i64_div_s:    0x7f,
  f32_abs:      0x8b,
  f32_neg:      0x8c,
  f32_ceil:     0x8d,
  f32_floor:    0x8e,
  f32_trunc:    0x8f,
  f32_nearest:  0x90,
  f32_sqrt:     0x91,
  f32_add:      0x92,
  f32_sub:      0x93,
  f32_mul:      0x94,
  f32_div:      0x95,
  f32_min:      0x96,
  f32_max:      0x97,
  f32_copysign: 0x98,
  f64_abs:      0x99,
  f64_neg:      0x9a,
  f64_ceil:     0x9b,
  f64_floor:    0x9c,
  f64_trunc:    0x9d,
  f64_nearest:  0x9e,
  f64_sqrt:     0x9f,
  f64_add:      0xa0,
  f64_sub:      0xa1,
  f64_mul:      0xa2,
  f64_div:      0xa3,
  f64_min:      0xa4,
  f64_max:      0xa5,
  f64_copysign: 0xa6,
  i32_trunc_f32_s: 0xa8,
  i32_trunc_f64_s: 0xaa,
  i64_trunc_f32_s: 0xae,
  i64_trunc_f64_s: 0xb0,
  f32_convert_i32_s: 0xb2,
  f32_convert_i64_s: 0xb4,
  f64_convert_i32_s: 0xb7,
  f64_convert_i64_s: 0xb9,
  f32_demote_f64:    0xb6,
  f64_promote_f32:   0xbb,
});

// Convert a WAT instruction name to its opcode byte.
// e.g. 'i32.add' → OP['i32_add'] → 0x6a
export function instrByte(name) {
  const key = name.replaceAll('.', '_');
  if (!(key in OP)) throw new Error(`[instrByte] Unknown instruction '${name}'`);
  return OP[key];
}

// ── WASM binary boilerplate ───────────────────────────────────────────────────

export const WASM_MAGIC   = [0x00, 0x61, 0x73, 0x6d];
export const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];

export const SECTION_ID = Object.freeze({
  custom:   0,
  type:     1,
  import:   2,
  function: 3,
  table:    4,
  memory:   5,
  global:   6,
  export:   7,
  start:    8,
  element:  9,
  code:     10,
  data:     11,
});

// Encode a function type entry: (params) → (results)
export function encodeFuncType(paramTypes, resultTypes) {
  return [
    0x60,
    ...encodeVec(paramTypes),
    ...encodeVec(resultTypes),
  ];
}

// Encode a string as WASM name
export function encodeString(str) {
  const bytes = [...new TextEncoder().encode(str)];
  return [...encodeULEB128(bytes.length), ...bytes];
}

// Encode a local variable group: (count, valtype)
export function encodeLocal(count, valtype) {
  return [...encodeULEB128(count), valtype];
}
