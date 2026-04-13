// codegen.js — orchestrator: AST → WatIR → WAT text + WASM binary
// generate(ast)              → { bytes, byteSpans, watText, watSpans }
// sExprToWasm(module, sSpans?) → { bytes: Uint8Array, byteSpans: ByteSpan[] }
//
// ByteSpan granularity: per-expression/statement (debugger-ready).
// Each expression, statement, and control-flow block gets its own span.
// Function-level span is preserved as the coarsest entry.

export class CodegenError extends Error {
  constructor(msg, astNode = null) {
    super(`[CodeGen] ${msg}`);
    this.name    = 'CodegenError';
    this.astNode = astNode;
  }
}

import { buildWAT, watToText } from './wat-encoder.js';
import {
  WASM_MAGIC, WASM_VERSION,
  SECTION_ID,
  encodeSection, encodeVec, encodeULEB128, encodeSLEB128,
  encodeF32, encodeF64,
  encodeFuncType, encodeString, encodeLocal,
  wasmValtype, instrByte,
  OP, VALTYPE,
} from './wasm-encoder.js';

// ── Public API ────────────────────────────────────────────────────────────────

// generate(ast) → { bytes, byteSpans, watText, watSpans }
//   bytes: Uint8Array        — WASM binary
//   byteSpans: ByteSpan[]   — [{ byteStart, byteEnd, astNode }] one per function (MVP)
//   watText: string         — WAT S-expression text for WAT Explorer
//   watSpans: TextSpan[]    — [{ watStart, watEnd, astNode }] char offsets in watText
export function generate(ast, { debug = false } = {}) {
  const { module, sSpans, stmtMap }      = buildWAT(ast, { debug });
  const { text: watText, spans: watSpans } = watToText(module, sSpans);
  const { bytes, byteSpans }             = sExprToWasm(module, sSpans);
  return { bytes, byteSpans, watText, watSpans, module, sSpans, stmtMap };
}

// sExprToWasm(module, sSpans?) → { bytes: Uint8Array, byteSpans: ByteSpan[] }
// ByteSpan = { byteStart: number, byteEnd: number, astNode: ASTNode }
// Per-expression: spans for every expression/statement + one coarse span per function.
function sExprToWasm(module, sSpans = []) {
  const maps     = buildIndexMaps(module);
  const children = module.slice(1);          // skip 'module' tag

  const typeNodes   = children.filter(c => c[0] === 'type');
  const importNodes = children.filter(c => c[0] === 'import');
  const memoryNodes = children.filter(c => c[0] === 'memory');
  const globalNodes = children.filter(c => c[0] === 'global');
  const tableNodes  = children.filter(c => c[0] === 'table');
  const exportNodes = children.filter(c => c[0] === 'export');
  const elemNodes   = children.filter(c => c[0] === 'elem');
  const funcNodes   = children.filter(c => c[0] === 'func');

  // ── Type section ─────────────────────────────────────────────────────────
  // ['type', '$tN', ['func', ['param', T]*, ['result', T]]]
  const typeEntries = typeNodes.map(t => {
    const [,, funcNode] = t;
    const sigParts = funcNode.slice(1);
    const params  = sigParts.filter(a => a[0] === 'param').map(a => wasmValtype(a[a.length - 1]));
    const results = sigParts.filter(a => a[0] === 'result').map(a => wasmValtype(a[1]));
    return encodeFuncType(params, results);
  });
  const typeSection = encodeSection(SECTION_ID.type, encodeVec(typeEntries));

  // ── Import section ────────────────────────────────────────────────────────
  // ['import', 'mod', 'field', ['func', '$name', ['param', T]*, ['result', T]]]
  const importEntries = importNodes.map(imp => {
    const [, mod, field, funcNode] = imp;
    const sigKey  = sigKeyOfFuncNode(funcNode);
    const typeIdx = maps.typeIds.get(sigKey);
    if (typeIdx === undefined) throw new Error(`[CodeGen] No type for import sig '${sigKey}'`);
    return [...encodeString(mod), ...encodeString(field), 0x00, ...encodeULEB128(typeIdx)];
  });
  const importSection = encodeSection(SECTION_ID.import, encodeVec(importEntries));

  // ── Function section ──────────────────────────────────────────────────────
  const funcTypeEntries = funcNodes.map(f => {
    const sigKey  = sigKeyOfFuncNode(f);
    const typeIdx = maps.typeIds.get(sigKey);
    if (typeIdx === undefined) throw new Error(`[CodeGen] No type for func '${f[1]}'`);
    return encodeULEB128(typeIdx);
  });
  const funcSection = encodeSection(SECTION_ID.function, encodeVec(funcTypeEntries));

  // ── Table section ─────────────────────────────────────────────────────────
  // ['table', N, 'funcref']
  const tableSection = tableNodes.length > 0
    ? encodeSection(SECTION_ID.table, encodeVec(
        tableNodes.map(t => [0x70, 0x00, ...encodeULEB128(t[1])])))
    : [];

  // ── Memory section ────────────────────────────────────────────────────────
  // ['memory', N]
  const memorySection = encodeSection(
    SECTION_ID.memory,
    encodeVec(memoryNodes.map(m => [0x00, ...encodeULEB128(m[1])])),
  );

  // ── Global section ─────────────────────────────────────────────────────────
  // ['global', '$name', ['mut', 'i32'], ['i32.const', n]]
  const globalEntries = globalNodes.map(g => {
    const mutNode  = g[2];                   // ['mut', 'i32']
    const initNode = g[3];                   // ['i32.const', n]
    const vt       = wasmValtype(mutNode[1]);
    const initBytes = encodeInstr(initNode, maps, new Map());
    return [vt, 0x01, ...initBytes, OP.end]; // 0x01 = mutable
  });
  const globalSection = globalEntries.length > 0
    ? encodeSection(SECTION_ID.global, encodeVec(globalEntries))
    : [];

  // ── Export section ────────────────────────────────────────────────────────
  // ['export', 'name', ['func', '$fn']] | ['export', 'name', ['memory', idx]]
  const exportEntries = exportNodes.map(exp => {
    const [, name, ref] = exp;
    if (ref[0] === 'func') {
      const idx = maps.funcIds.get(ref[1]);
      if (idx === undefined) throw new Error(`[CodeGen] Unknown export func '${ref[1]}'`);
      return [...encodeString(name), 0x00, ...encodeULEB128(idx)];
    }
    if (ref[0] === 'memory') {
      return [...encodeString(name), 0x02, ...encodeULEB128(ref[1])];
    }
    throw new Error(`[CodeGen] Unknown export kind '${ref[0]}'`);
  });
  const exportSection = encodeSection(SECTION_ID.export, encodeVec(exportEntries));

  // ── Element section ───────────────────────────────────────────────────────
  // ['elem', ['i32.const', 0], 'func', '$f1', '$f2', ...]
  const elementSection = elemNodes.length > 0
    ? encodeSection(SECTION_ID.element, encodeVec(elemNodes.map(elem => {
        const [, offsetExpr, , ...funcRefs] = elem;   // skip 'elem', offsetExpr, 'func'
        return [
          0x00,                                        // active, table 0
          OP.i32_const, ...encodeSLEB128(offsetExpr[1]), OP.end,
          ...encodeULEB128(funcRefs.length),
          ...funcRefs.flatMap(ref => encodeULEB128(maps.funcIds.get(ref))),
        ];
      })))
    : [];

  // ── Code section: build bodies + track byte offsets for ByteSpan ──────────
  // Build lookup: S-expr parent node → SSpan[] (for per-expression tracking)
  const sSpansByParent = new Map();
  for (const sp of sSpans) {
    let list = sSpansByParent.get(sp.node);
    if (!list) { list = []; sSpansByParent.set(sp.node, list); }
    list.push(sp);
  }

  const codeBodiesResult = funcNodes.map(f => encodeFunc(f, maps, sSpansByParent));
  const codeBodies       = codeBodiesResult.map(r => r.encoded);

  // Assemble prefix (everything before the code section) to know its byte length.
  const prefixBytes = [
    ...WASM_MAGIC, ...WASM_VERSION,
    ...typeSection,  ...importSection, ...funcSection,
    ...tableSection, ...memorySection, ...globalSection, ...exportSection,
    ...elementSection,
  ];

  // Build code section content (count + all bodies) to size it.
  const countBytes       = encodeULEB128(funcNodes.length);
  const bodiesFlat       = codeBodies.flat();
  const codeContent      = [...countBytes, ...bodiesFlat];
  const sectionSizeBytes = encodeULEB128(codeContent.length);

  // First function body starts at:
  //   prefixBytes.length + 1 (section id) + sectionSizeBytes.length + countBytes.length
  let bodyOffset = prefixBytes.length + 1 + sectionSizeBytes.length + countBytes.length;

  // Map S-expr func-node (object identity) → AST node for function-level spans.
  const sSpanAstByNode = new Map();
  for (const sp of sSpans) {
    sSpanAstByNode.set(sp.node, sp.astNode); // last-wins: FuncDecl spans are pushed last in emitFunc
  }

  const byteSpans = [];
  for (let fi = 0; fi < funcNodes.length; fi++) {
    const { encoded, instrOffset, relSpans } = codeBodiesResult[fi];
    const funcAbsStart = bodyOffset;

    // Per-expression ByteSpans (granular, for debugger)
    for (const rs of relSpans) {
      byteSpans.push({
        byteStart: funcAbsStart + instrOffset + rs.byteStart,
        byteEnd:   funcAbsStart + instrOffset + rs.byteEnd,
        astNode:   rs.astNode,
      });
    }

    // Function-level ByteSpan (coarse, backward-compat)
    const astNode = sSpanAstByNode.get(funcNodes[fi]);
    if (astNode) byteSpans.push({ byteStart: funcAbsStart, byteEnd: funcAbsStart + encoded.length, astNode });

    bodyOffset += encoded.length;
  }

  const codeSection = [SECTION_ID.code, ...sectionSizeBytes, ...codeContent];
  return {
    bytes:     new Uint8Array([...prefixBytes, ...codeSection]),
    byteSpans,
  };
}

// ── Index maps ────────────────────────────────────────────────────────────────

function buildIndexMaps(module) {
  const typeIds   = new Map();   // sigKey | '$tN' → typeIndex
  const funcIds   = new Map();   // '$name'        → funcIndex (imports first)
  const globalIds = new Map();   // '$name'        → globalIndex
  const children  = module.slice(1);

  // Globals
  children.filter(c => c[0] === 'global').forEach((g, i) => {
    globalIds.set(g[1], i);              // '$__sp' → 0
  });

  // Types: map by signature string AND by symbolic '$tN' name
  children.filter(c => c[0] === 'type').forEach((t, i) => {
    typeIds.set(t[1], i);                        // '$t0' → 0
    const key = sigKeyOfFuncNode(t[2]);
    if (!typeIds.has(key)) typeIds.set(key, i);  // sigKey → index
  });

  // Imports first (lower func indices)
  let funcIdx = 0;
  children.filter(c => c[0] === 'import').forEach(imp => {
    funcIds.set(imp[3][1], funcIdx++);   // '$name' → index
  });

  // User funcs
  children.filter(c => c[0] === 'func').forEach(f => {
    funcIds.set(f[1], funcIdx++);        // '$name' → index
  });

  return { typeIds, funcIds, globalIds };
}

// Canonical signature key for a func S-expr node.
// Accepts both named   ['func', '$n', ['param','$p','T'], ..., ['result','T'], ...]
// and unnamed          ['func',       ['param','T'],       ..., ['result','T']]
function sigKeyOfFuncNode(funcNode) {
  let rest = funcNode.slice(1);   // drop 'func' tag
  if (typeof rest[0] === 'string' && rest[0].startsWith('$')) rest = rest.slice(1);
  const params  = rest.filter(a => Array.isArray(a) && a[0] === 'param')
                      .map(a => a[a.length - 1]);
  const results = rest.filter(a => Array.isArray(a) && a[0] === 'result')
                      .map(a => a[1]);
  return params.join(',') + ':' + (results[0] ?? 'void');
}

// ── Function body encoder ─────────────────────────────────────────────────────

function encodeFunc(funcNode, maps, sSpansByParent) {
  // ['func', '$name', ['param','$p','T']*, ['result','T'], ['local','$x','T']*, ...instrs]
  const rest     = funcNode.slice(2);   // skip 'func' tag and '$name'
  const localMap = new Map();           // '$name' → WASM local index
  let   li       = 0;                  // next local index counter

  // Walk header in spec order: params → result → locals
  let i = 0;
  while (i < rest.length && Array.isArray(rest[i]) && rest[i][0] === 'param') {
    const item = rest[i++];
    if (item.length === 3) localMap.set(item[1], li);  // named param
    li++;
  }
  while (i < rest.length && Array.isArray(rest[i]) && rest[i][0] === 'result') i++;

  const localDecls = [];
  while (i < rest.length && Array.isArray(rest[i]) && rest[i][0] === 'local') {
    const item = rest[i++];
    if (item.length === 3) localMap.set(item[1], li);  // named local
    li++;
    localDecls.push(item);
  }
  const bodyInstrs = rest.slice(i);

  // Build WASM locals vector (non-param locals)
  const wasmLocals = groupLocals(localDecls.map(l => wasmValtype(l[l.length - 1])));

  // Encode body instructions with per-expression span tracking
  const bodyStartIdx = 2 + i; // index in funcNode where body instructions begin
  const { bytes: bodyInstrBytes, spans: relSpans } =
    encodeBlock(funcNode, bodyStartIdx, bodyInstrs, maps, localMap, sSpansByParent);

  const localsEncoded = encodeVec(wasmLocals);
  const body          = [...localsEncoded, ...bodyInstrBytes, OP.end];
  const sizePrefix    = encodeULEB128(body.length);

  return {
    encoded:     [...sizePrefix, ...body],
    instrOffset: sizePrefix.length + localsEncoded.length,
    relSpans,
  };
}

function groupLocals(valtypes) {
  const groups = [];
  for (const vt of valtypes) {
    if (groups.length > 0 && groups[groups.length - 1][1] === vt) {
      groups[groups.length - 1][0]++;
    } else {
      groups.push([1, vt]);
    }
  }
  return groups.map(([count, vt]) => encodeLocal(count, vt));
}

// ── Instruction encoder ───────────────────────────────────────────────────────

function encodeInstr(node, maps, localMap) {
  // ── Atom (plain opcode string, e.g. 'i32.eqz', 'return', 'i32.store8') ─────
  if (typeof node === 'string') {
    const opByte = instrByte(node);
    if (isMemInstr(node)) return [opByte, memArgAlign(node), 0x00];
    return [opByte];
  }

  const [tag, ...args] = node;

  switch (tag) {
    // Constants
    case 'i32.const': return [OP.i32_const, ...encodeSLEB128(args[0])];
    case 'i64.const': return [OP.i64_const, ...encodeSLEB128(args[0])];
    case 'f32.const': return [OP.f32_const, ...encodeF32(args[0])];
    case 'f64.const': return [OP.f64_const, ...encodeF64(args[0])];

    // Locals
    case 'local.get': {
      const idx = localMap.get(args[0]);
      if (idx === undefined) throw new Error(`[CodeGen] Unknown local '${args[0]}'`);
      return [OP.local_get, ...encodeULEB128(idx)];
    }
    case 'local.set': {
      const idx = localMap.get(args[0]);
      if (idx === undefined) throw new Error(`[CodeGen] Unknown local '${args[0]}'`);
      return [OP.local_set, ...encodeULEB128(idx)];
    }

    // Branches
    case 'br':    return [OP.br,    ...encodeULEB128(args[0])];
    case 'br_if': return [OP.br_if, ...encodeULEB128(args[0])];

    // Structured control flow
    case 'if': {
      // ['if', ['then', ...instrs], ['else', ...instrs]?]
      // or with result type: ['if', 'i32', ['then', ...], ['else', ...]]
      let thenNode, elseNode, blockType = 0x40;
      if (typeof args[0] === 'string') {
        blockType = VALTYPE[args[0]] ?? 0x40;
        thenNode = args[1];
        elseNode = args[2];
      } else {
        thenNode = args[0];
        elseNode = args[1];
      }
      const bytes = [OP.if, blockType];
      for (const instr of thenNode.slice(1)) bytes.push(...encodeInstr(instr, maps, localMap));
      if (elseNode) {
        bytes.push(OP.else);
        for (const instr of elseNode.slice(1)) bytes.push(...encodeInstr(instr, maps, localMap));
      }
      bytes.push(OP.end);
      return bytes;
    }
    case 'block': {
      // ['block', ['loop', ...instrs]]
      const loopNode = args[0];
      const bytes = [OP.block, 0x40, OP.loop, 0x40];
      for (const instr of loopNode.slice(1)) bytes.push(...encodeInstr(instr, maps, localMap));
      bytes.push(OP.end, OP.end);
      return bytes;
    }

    // Globals
    case 'global.get': {
      const idx = maps.globalIds?.get(args[0]) ?? 0;
      return [OP.global_get, ...encodeULEB128(idx)];
    }
    case 'global.set': {
      const idx = maps.globalIds?.get(args[0]) ?? 0;
      return [OP.global_set, ...encodeULEB128(idx)];
    }

    // Calls
    case 'call': {
      const idx = maps.funcIds.get(args[0]);
      if (idx === undefined) throw new Error(`[CodeGen] Unknown function '${args[0]}'`);
      return [OP.call, ...encodeULEB128(idx)];
    }
    case 'call_indirect': {
      // ['call_indirect', ['type', '$tN']]
      const typeRef = args[0];
      const typeIdx = maps.typeIds.get(typeRef[1]);
      if (typeIdx === undefined) throw new Error(`[CodeGen] Unknown type '${typeRef[1]}'`);
      return [OP.call_indirect, ...encodeULEB128(typeIdx), 0x00];
    }

    // All other tags: arithmetic, comparison, conversion opcodes
    default: {
      const opByte = instrByte(tag);
      if (isMemInstr(tag)) return [opByte, memArgAlign(tag), 0x00];
      if (args.length === 0) return [opByte];
      return [opByte, ...args.flatMap(a => (typeof a === 'number' ? encodeULEB128(a) : []))];
    }
  }
}

// True for load/store instructions that need a memarg (align + offset bytes).
function isMemInstr(name) {
  return name.includes('.load') || name.includes('.store');
}

// ── Per-expression span tracking (debugger-ready ByteSpan) ────────────────────

// Encode a list of instructions `instrs` as children of `parentNode`, with
// `childStartIdx` = the S-expr index of instrs[0] inside parentNode.
// Recurses into compound blocks (if, block/loop) to collect inner-stmt spans.
// Returns { bytes: number[], spans: RelSpan[] } — all offsets relative to bytes[0].
// RelSpan = { byteStart, byteEnd, astNode }
function encodeBlock(parentNode, childStartIdx, instrs, maps, localMap, sSpansByParent) {
  const bytes   = [];
  const spans   = [];
  const offsets = [];   // { start, end } per instruction in `instrs`

  for (let j = 0; j < instrs.length; j++) {
    const instrOff = bytes.length;
    const node = instrs[j];

    if (typeof node === 'string') {
      bytes.push(...encodeInstr(node, maps, localMap));
    } else {
      const [tag, ...args] = node;

      if (tag === 'if') {
        let thenNode, elseNode, blockType = 0x40;
        if (typeof args[0] === 'string') {
          blockType = VALTYPE[args[0]] ?? 0x40; thenNode = args[1]; elseNode = args[2];
        } else { thenNode = args[0]; elseNode = args[1]; }

        bytes.push(OP.if, blockType);

        const thenBase   = bytes.length;
        const thenResult = encodeBlock(thenNode, 1, thenNode.slice(1), maps, localMap, sSpansByParent);
        bytes.push(...thenResult.bytes);
        for (const s of thenResult.spans)
          spans.push({ byteStart: thenBase + s.byteStart, byteEnd: thenBase + s.byteEnd, astNode: s.astNode });

        if (elseNode) {
          bytes.push(OP.else);
          const elseBase   = bytes.length;
          const elseResult = encodeBlock(elseNode, 1, elseNode.slice(1), maps, localMap, sSpansByParent);
          bytes.push(...elseResult.bytes);
          for (const s of elseResult.spans)
            spans.push({ byteStart: elseBase + s.byteStart, byteEnd: elseBase + s.byteEnd, astNode: s.astNode });
        }

        bytes.push(OP.end);

      } else if (tag === 'block') {
        const loopNode = args[0];
        bytes.push(OP.block, 0x40, OP.loop, 0x40);
        const loopBase   = bytes.length;
        const loopResult = encodeBlock(loopNode, 1, loopNode.slice(1), maps, localMap, sSpansByParent);
        bytes.push(...loopResult.bytes);
        for (const s of loopResult.spans)
          spans.push({ byteStart: loopBase + s.byteStart, byteEnd: loopBase + s.byteEnd, astNode: s.astNode });
        bytes.push(OP.end, OP.end);

      } else {
        bytes.push(...encodeInstr(node, maps, localMap));
      }
    }

    offsets.push({ start: instrOff, end: bytes.length });
  }

  // Match SSpans whose node is this parentNode
  const parentSpans = sSpansByParent.get(parentNode);
  if (parentSpans) {
    for (const sp of parentSpans) {
      const iStart = sp.startIdx - childStartIdx;
      const iEnd   = sp.endIdx   - childStartIdx;
      if (iStart < 0 || iEnd > instrs.length || iStart >= iEnd) continue;
      spans.push({
        byteStart: offsets[iStart].start,
        byteEnd:   offsets[iEnd - 1].end,
        astNode:   sp.astNode,
      });
    }
  }

  return { bytes, spans };
}

// Returns log2(natural_alignment) for a load/store instruction name.
function memArgAlign(name) {
  if (name.includes('8'))  return 0;   // 1-byte
  if (name.includes('16')) return 1;   // 2-byte
  if (name === 'i32.load' || name === 'i32.store' ||
      name === 'f32.load' || name === 'f32.store') return 2;
  return 3;                            // i64/f64: 8-byte
}
