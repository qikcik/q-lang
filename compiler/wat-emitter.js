// ─────────────────────────────────────────────────────────────────────────────
// wat-emitter.js — AST nodes → WatIR S-expr instructions
//
// Exports: emitFunc, emitStmt, emitExpr
// ─────────────────────────────────────────────────────────────────────────────

import {
  canonType, elemByteSize, BumpAllocator, SExprBuilder,
  loadInstr, storeInstr, watArithOp, watCmpOp, watConvOp,
} from './wat-utils.js';
import { isStruct, typeByteSize, fieldByteOffset } from './staticAnalysis.js';

// ── Function emitter ──────────────────────────────────────────────────────────

export function emitFunc(b, funcDecl, funcIndex, sigIndex, importCount, dbgCtx) {
  const locals     = new Map();
  const paramCount = funcDecl.params.length;

  funcDecl.params.forEach((p, i) => {
    locals.set(p.name, { index: i, wasmType: canonType(p.typeAnnot) });
  });

  const localDecls   = collectLocalDecls(funcDecl.body);
  let   localIdx     = paramCount;
  const localsByNode = new Map();

  // ── Compute shadow-stack frame layout for array and struct locals ────────
  let frameBytes = 0;
  for (const decl of localDecls) {
    const t = decl._type;
    if (t.kind === 'ArrayType') {
      const elemSize    = elemByteSize(t.elemType.name);
      const align       = Math.min(elemSize, 4);
      frameBytes        = Math.ceil(frameBytes / align) * align;
      const frameOffset = frameBytes;
      frameBytes       += elemSize * t.size;
      const idx  = localIdx++;
      const info = { index: idx, wasmType: 'i32', frameOffset, isArray: true, arrayType: t };
      localsByNode.set(decl, info);
      locals.set(decl.name, info);
    } else if (isStruct(t)) {
      const align       = Math.min(t.byteSize, 4);
      frameBytes        = Math.ceil(frameBytes / align) * align;
      const frameOffset = frameBytes;
      frameBytes       += t.byteSize;
      const idx  = localIdx++;
      const info = { index: idx, wasmType: 'i32', frameOffset, isStruct: true, structType: t };
      localsByNode.set(decl, info);
      locals.set(decl.name, info);
    } else {
      const idx  = localIdx++;
      const info = { index: idx, wasmType: canonType(t) };
      localsByNode.set(decl, info);
      locals.set(decl.name, info);
    }
  }

  const hasFrame       = frameBytes > 0;
  const frameLocalName = '$__frame';
  if (hasFrame) localIdx++;

  const bump = new BumpAllocator();

  // ── Emit function header ──────────────────────────────────────────────────
  const closeFunc = b.openList('func');
  const funcNode  = b._top;              // capture reference for FuncDecl span
  b.push(`$${funcDecl.name}`);
  funcDecl.params.forEach(p => b.push(['param', `$${p.name}`, canonType(p.typeAnnot)]));
  if (funcDecl.returnType?.name !== 'void') {
    b.push(['result', canonType(funcDecl.returnType)]);
  }
  localDecls.forEach(d => {
    const wt = (d._type.kind === 'ArrayType' || isStruct(d._type)) ? 'i32' : canonType(d._type);
    b.push(['local', `$${d.name}`, wt]);
  });
  if (hasFrame) b.push(['local', frameLocalName, 'i32']);

  const ctx = {
    locals, localsByNode, funcIndex, bump, labelDepth: 0, breakStack: [], sigIndex, importCount,
    frame: hasFrame ? { localName: frameLocalName, size: frameBytes } : null,
    dbgCtx,
  };

  // ── Frame setup ───────────────────────────────────────────────────────────
  if (hasFrame) {
    b.push(['global.get', '$__sp']);
    b.push(['local.set', frameLocalName]);
    b.push(['global.get', '$__sp']);
    b.push(['i32.const', frameBytes]);
    b.push('i32.add');
    b.push(['global.set', '$__sp']);
  }

  for (const stmt of funcDecl.body.body) emitStmt(b, stmt, ctx);

  closeFunc();
  // Append FuncDecl span last — sExprToWasm uses last-wins, so this overrides any stmt entries.
  b.sSpans.push({ node: funcNode, startIdx: 0, endIdx: funcNode.length, astNode: funcDecl });
}

// Collect all local VarDecl nodes (not including nested FuncDecl bodies)
function collectLocalDecls(block) {
  const result = [];
  const seen   = new Set();   // deduplicate by node identity (shared nodes from defer-pass)
  function walk(stmts) {
    for (const s of stmts) {
      if (s.kind === 'VarDecl') {
        if (!seen.has(s)) { seen.add(s); result.push(s); }
      } else if (s.kind === 'IfStmt') {
        walk(s.then.body);
        if (s.elseBranch) walk(s.elseBranch.body);
      } else if (s.kind === 'WhileStmt') {
        walk(s.body.body);
      } else if (s.kind === 'ScopeBlock') {
        walk(s.body);
      } else if (s.kind === 'MacroExpansionNode') {
        walk(s.body);
      }
    }
  }
  walk(block.body);
  return result;
}

// ── Statement emitters ────────────────────────────────────────────────────────

export function emitStmt(b, stmt, ctx) {
  // ScopeBlock and MacroExpansionNode are transparent wrappers that
  // immediately delegate to their children — giving them their own debug step
  // would create a confusing pause that maps to the wrapper span, not the
  // actual executing statement.  Skip instrumentation here; the child stmts
  // will each receive their own debug call in the recursive emitStmt calls
  // below.
  if (ctx.dbgCtx && stmt.kind !== 'FuncDecl'
      && stmt.kind !== 'ScopeBlock'
      && stmt.kind !== 'MacroExpansionNode'
      && stmt.kind !== 'MacroDecl'
      && stmt.kind !== 'WhileStmt') {  // WhileStmt injects per-iteration inside the loop
    const id = ctx.dbgCtx.nextId();
    ctx.dbgCtx.stmtMap.set(id, stmt);
    if (ctx.dbgCtx.inject) {
      b.push(['i32.const', id]);
      b.push(['call', '$__dbg']);
    }
  }
  switch (stmt.kind) {
    case 'VarDecl':    return emitVarDecl(b, stmt, ctx);
    case 'ReturnStmt': return emitReturnStmt(b, stmt, ctx);
    case 'ExprStmt':   return emitExprStmt(b, stmt, ctx);
    case 'AssignStmt': return emitAssignStmt(b, stmt, ctx);
    case 'IfStmt':     return emitIfStmt(b, stmt, ctx);
    case 'WhileStmt':  return emitWhileStmt(b, stmt, ctx);
    case 'BreakStmt':  return emitBreakStmt(b, stmt, ctx);
    case 'ScopeBlock':        return stmt.body.forEach(s => emitStmt(b, s, ctx));
    case 'MacroExpansionNode': return stmt.body.forEach(s => emitStmt(b, s, ctx));
    case 'MacroDecl':          return;
    case 'FuncDecl':           return; // lambda-lifted
    default: throw new Error(`[WAT] Unknown stmt kind '${stmt.kind}'`);
  }
}

function emitVarDecl(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  const local = ctx.localsByNode?.get(stmt) ?? ctx.locals.get(stmt.name);
  if (!local) throw new Error(`[WAT] Undeclared local '${stmt.name}'`);
  if (local.isArray) {
    const addrBase = getAddrBase(local, ctx);
    emitArrayInit(b, stmt.value, addrBase, local.arrayType, ctx);
    emitBaseAddr(b, addrBase, 0);
    b.push(['local.set', `$${stmt.name}`]);
  } else if (local.isStruct) {
    // Initialise struct in its frame slot
    const baseAddr = getAddrBase(local, ctx);
    emitStructInit(b, stmt.value, baseAddr, local.structType, ctx);
    emitBaseAddr(b, baseAddr, 0);
    b.push(['local.set', `$${stmt.name}`]);
  } else {
    emitExpr(b, stmt.value, ctx);
    b.push(['local.set', `$${stmt.name}`]);
  }
  close();
}

function emitReturnStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  if (stmt.value !== null && stmt.value !== undefined) {
    emitExpr(b, stmt.value, ctx);
  }
  if (ctx.frame) {
    b.push(['local.get', ctx.frame.localName]);
    b.push(['global.set', '$__sp']);
  }
  b.push('return');
  close();
}

function emitExprStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  emitExpr(b, stmt.expr, ctx);
  if (stmt.expr._type?.name !== 'void') {
    b.push('drop');
  }
  close();
}

function emitAssignStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  if (stmt.target.kind === 'Identifier') {
    const local = ctx.locals.get(stmt.target.name);
    if (local.isArray) {
      const addrBase = getAddrBase(local, ctx);
      emitArrayInit(b, stmt.value, addrBase, local.arrayType, ctx);
    } else {
      emitExpr(b, stmt.value, ctx);
      b.push(['local.set', `$${stmt.target.name}`]);
    }
  } else if (stmt.target.kind === 'BracketAccessExpr') {
    const elemName = stmt.target._elemType.name;
    const elemSize = elemByteSize(elemName);
    emitExpr(b, stmt.target.base, ctx);
    emitExpr(b, stmt.target.index, ctx);
    b.push(['i32.const', elemSize]);
    b.push('i32.mul');
    b.push('i32.add');
    emitExpr(b, stmt.value, ctx);
    b.push(storeInstr(elemName));
  } else if (stmt.target.kind === 'MemberExpr') {
    // Struct field write: <base-addr>; i32.const fieldOffset; i32.add; <value>; store
    // obj may be an Identifier (local struct) or a UnaryExpr{*} (pointer deref).
    // emitExpr handles both: Identifier → local.get (frame ptr); *ptr → the pointer
    // value itself (struct deref emits no load, just the address — see emitUnary).
    const fieldOffset = stmt.target._fieldOffset;
    const fieldType   = stmt.target._type;
    const fieldName   = fieldType.name;
    emitExpr(b, stmt.target.obj, ctx);
    if (fieldOffset !== 0) {
      b.push(['i32.const', fieldOffset]);
      b.push('i32.add');
    }
    emitExpr(b, stmt.value, ctx);
    b.push(storeInstr(fieldName));
  } else if (stmt.target.kind === 'UnaryExpr' && stmt.target.op === '*') {
    emitExpr(b, stmt.target.operand, ctx);
    emitExpr(b, stmt.value, ctx);
    b.push(storeInstr(stmt.target._type?.name ?? 'i32'));
  }
  close();
}

function emitIfStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  emitExpr(b, stmt.condition, ctx);
  ctx.labelDepth++;

  const thenB = new SExprBuilder(); thenB.sSpans = b.sSpans;
  const closeThen = thenB.openList('then');
  for (const s of stmt.then.body) emitStmt(thenB, s, ctx);
  closeThen();

  if (stmt.elseBranch) {
    const elseB = new SExprBuilder(); elseB.sSpans = b.sSpans;
    const closeElse = elseB.openList('else');
    for (const s of stmt.elseBranch.body) emitStmt(elseB, s, ctx);
    closeElse();
    b.push(['if', thenB.root, elseB.root]);
    // Both branches terminate (all paths return/break) → code after this if is
    // unreachable. Emit 'unreachable' so the WASM validator accepts the
    // polymorphic stack state (e.g. function return type still satisfied).
    if (blockTerminates(stmt.then) && blockTerminates(stmt.elseBranch)) {
      b.push('unreachable');
    }
  } else {
    b.push(['if', thenB.root]);
  }

  ctx.labelDepth--;
  close();
}

// Returns true if every execution path through `block` ends in a terminator
// (return or break), meaning no fall-through is possible.
function blockTerminates(block) {
  const stmts = Array.isArray(block) ? block : block.body;
  return stmts.some(stmtTerminates);
}

function stmtTerminates(stmt) {
  switch (stmt.kind) {
    case 'ReturnStmt': return true;
    case 'BreakStmt':  return true;
    case 'IfStmt':
      return !!stmt.elseBranch &&
             blockTerminates(stmt.then) &&
             blockTerminates(stmt.elseBranch);
    case 'ScopeBlock':
    case 'MacroExpansionNode':
      return blockTerminates(stmt.body);
    default: return false;
  }
}

function emitWhileStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  ctx.labelDepth++;
  const blockDepth = ctx.labelDepth;
  ctx.breakStack.push(blockDepth);
  ctx.labelDepth++;

  const loopB = new SExprBuilder(); loopB.sSpans = b.sSpans;
  const closeLoop = loopB.openList('loop');

  // Inject debug step at the top of each iteration (before condition eval).
  // Maps to the WhileStmt node so WAT/bytecode cross-selection still works.
  if (ctx.dbgCtx) {
    const id = ctx.dbgCtx.nextId();
    ctx.dbgCtx.stmtMap.set(id, stmt);
    if (ctx.dbgCtx.inject) {
      loopB.push(['i32.const', id]);
      loopB.push(['call', '$__dbg']);
    }
  }
  emitExpr(loopB, stmt.condition, ctx);
  loopB.push('i32.eqz');
  loopB.push(['br_if', 1]);
  for (const s of stmt.body.body) emitStmt(loopB, s, ctx);
  loopB.push(['br', 0]);
  closeLoop();

  b.push(['block', loopB.root]);

  ctx.labelDepth -= 2;
  ctx.breakStack.pop();
  close();
}

function emitBreakStmt(b, stmt, ctx) {
  const close = b.openSpan(stmt);
  if (ctx.breakStack.length === 0) throw new Error('[WAT] break outside loop');
  const relIdx = ctx.labelDepth - ctx.breakStack.at(-1);
  b.push(['br', relIdx]);
  close();
}

// ── Expression emitters ───────────────────────────────────────────────────────

export function emitExpr(b, expr, ctx) {
  switch (expr.kind) {
    case 'Literal':              return emitLiteral(b, expr);
    case 'Identifier':           return emitIdent(b, expr, ctx);
    case 'BinaryExpr':           return emitBinary(b, expr, ctx);
    case 'UnaryExpr':            return emitUnary(b, expr, ctx);
    case 'CallExpr':             return emitCall(b, expr, ctx);
    case 'AsExpr':               return emitAs(b, expr, ctx);
    case 'ArrayLiteral':         return emitArrayLiteralExpr(b, expr, ctx);
    case 'StringLiteral':        return emitStringLiteralExpr(b, expr, ctx);
    case 'BracketAccessExpr':    return emitIndexExpr(b, expr, ctx);
    case 'MemberExpr':           return emitMemberExpr(b, expr, ctx);
    case 'QualifiedName':        return emitQualifiedName(b, expr, ctx);
    default: throw new Error(`[WAT] Unknown expr kind '${expr.kind}'`);
  }
}

function emitLiteral(b, expr) {
  const close = b.openSpan(expr);
  const t = canonType(expr._type);
  if (t === 'i32')      b.push(['i32.const', expr.isBool ? (expr.value ? 1 : 0) : Math.trunc(expr.value)]);
  else if (t === 'i64') b.push(['i64.const', Math.trunc(expr.value)]);
  else if (t === 'f32') b.push(['f32.const', expr.value]);
  else                  b.push(['f64.const', expr.value]);
  close();
}

function emitIdent(b, expr, ctx) {
  const close = b.openSpan(expr);
  b.push(['local.get', `$${expr.name}`]);
  close();
}

function emitBinary(b, expr, ctx) {
  const close = b.openSpan(expr);
  const CMP = new Set(['==','!=','<','>','<=','>=']);

  if (expr.op === '&&') {
    emitExpr(b, expr.left, ctx);
    const thenAnd = new SExprBuilder(); thenAnd.sSpans = b.sSpans;
    const closeThenAnd = thenAnd.openList('then');
    emitExpr(thenAnd, expr.right, ctx);
    closeThenAnd();
    const elseAnd = new SExprBuilder(); elseAnd.sSpans = b.sSpans;
    const closeElseAnd = elseAnd.openList('else');
    elseAnd.push(['i32.const', 0]);
    closeElseAnd();
    b.push(['if', 'i32', thenAnd.root, elseAnd.root]);
  } else if (expr.op === '||') {
    emitExpr(b, expr.left, ctx);
    const thenOr = new SExprBuilder(); thenOr.sSpans = b.sSpans;
    const closeThenOr = thenOr.openList('then');
    thenOr.push(['i32.const', 1]);
    closeThenOr();
    const elseOr = new SExprBuilder(); elseOr.sSpans = b.sSpans;
    const closeElseOr = elseOr.openList('else');
    emitExpr(elseOr, expr.right, ctx);
    closeElseOr();
    b.push(['if', 'i32', thenOr.root, elseOr.root]);
  } else {
    emitExpr(b, expr.left, ctx);
    emitExpr(b, expr.right, ctx);
    if (CMP.has(expr.op)) {
      const ltype = expr._operandType?.name ?? expr.left._type?.name ?? 'i32';
      b.push(watCmpOp(ltype, expr.op));
    } else {
      b.push(watArithOp(canonType(expr._type), expr.op));
    }
  }
  close();
}

function emitUnary(b, expr, ctx) {
  const close = b.openSpan(expr);
  if (expr.op === '!') {
    emitExpr(b, expr.operand, ctx);
    b.push('i32.eqz');
  } else if (expr.op === '&') {
    const ident   = expr.operand;
    const funcIdx = ctx.funcIndex.get(ident.name);
    if (funcIdx !== undefined && funcIdx >= ctx.importCount) {
      b.push(['i32.const', funcIdx - ctx.importCount]);
    } else {
      const local = ctx.locals.get(ident.name);
      if (local.isArray || local.isStruct) {
        // Both arrays and structs are stored on the shadow stack — the local
        // variable already holds their base address (i32 frame pointer).
        b.push(['local.get', `$${ident.name}`]);
      } else {
        if (local.memAddr === undefined) {
          local.memAddr = ctx.bump.allocScalar(ident._type?.name ?? 'i32');
        }
        const addr     = local.memAddr;
        const elemName = ident._type?.name ?? 'i32';
        b.push(['i32.const', addr]);
        emitExpr(b, ident, ctx);
        b.push(storeInstr(elemName));
        b.push(['i32.const', addr]);
      }
    }
  } else if (expr.op === '*') {
    emitExpr(b, expr.operand, ctx);
    // Struct dereference: the "value" of a struct is its base address — do not
    // emit a memory load.  The address on the stack is consumed by the
    // surrounding MemberExpr or passed as-is.  For scalar types, load normally.
    if (!isStruct(expr._type)) {
      b.push(loadInstr(expr._type?.name ?? 'i32'));
    }
  } else if (expr.op === '-') {
    const ty = expr._type?.name ?? 'i32';
    if (ty === 'f64') {
      emitExpr(b, expr.operand, ctx);
      b.push('f64.neg');
    } else {
      b.push(['i32.const', 0]);
      emitExpr(b, expr.operand, ctx);
      b.push('i32.sub');
    }
  }
  close();
}

function emitCall(b, expr, ctx) {
  const close = b.openSpan(expr);
  if (expr.callee.kind === 'UnaryExpr' && expr.callee.op === '*') {
    const innerType = expr.callee._type;
    if (innerType?.name === '__func__') {
      const paramTypes = innerType.paramTypes.map(p => canonType(p));
      const resultType = canonType(innerType.returnType);
      const typeIdx    = ctx.sigIndex.get(paramTypes.join(',') + ':' + resultType);
      if (typeIdx === undefined) throw new Error('[WAT] No type for indirect call');
      for (const arg of expr.args) emitExpr(b, arg, ctx);
      emitExpr(b, expr.callee.operand, ctx);
      b.push(['call_indirect', ['type', `$t${typeIdx}`]]);
      close();
      return;
    }
  }
  for (const arg of expr.args) emitExpr(b, arg, ctx);
  b.push(['call', `$${expr.callee.name}`]);
  close();
}

function emitAs(b, expr, ctx) {
  const close = b.openSpan(expr);
  const from  = canonType(expr.expr._type);
  const to    = canonType(expr.asType);
  emitExpr(b, expr.expr, ctx);
  if (from !== to) { const op = watConvOp(from, to); if (op) b.push(op); }
  close();
}

function emitIndexExpr(b, expr, ctx) {
  const close    = b.openSpan(expr);
  const elemName = expr._elemType.name;
  const elemSize = elemByteSize(elemName);
  emitExpr(b, expr.base, ctx);
  emitExpr(b, expr.index, ctx);
  b.push(['i32.const', elemSize]);
  b.push('i32.mul');
  b.push('i32.add');
  b.push(loadInstr(elemName));
  close();
}

function emitMemberExpr(b, expr, ctx) {
  const close = b.openSpan(expr);
  if (expr.member === 'size') {
    b.push(['i32.const', expr._arraySize]);
  } else {
    // Struct field read: base address + fieldOffset → load
    emitExpr(b, expr.obj, ctx);
    const offset = expr._fieldOffset ?? 0;
    if (offset !== 0) {
      b.push(['i32.const', offset]);
      b.push('i32.add');
    }
    b.push(loadInstr(expr._type.name ?? 'i32'));
  }
  close();
}

function emitQualifiedName(b, expr, ctx) {
  const close = b.openSpan(expr);
  const kind  = expr._resolvedKind;
  const method = expr._method;

  if (kind === 'scalar-constructor') {
    const t = canonType(expr._type);
    if (method === 'default') {
      if (expr._type?.kind === 'ArrayType') {
        const at   = expr._type;
        const addr = ctx.bump.allocArray(at.elemType.name, at.size);
        const es   = elemByteSize(at.elemType.name);
        for (let i = 0; i < at.size; i++) {
          b.push(['i32.const', addr + i * es]);
          b.push([`${canonType(at.elemType)}.const`, 0]);
          b.push(storeInstr(at.elemType.name));
        }
        b.push(['i32.const', addr]);
      } else {
        b.push([`${t}.const`, 0]);
      }
    } else if (method === 'of') {
      const arg0 = expr.args[0];
      emitExpr(b, arg0, ctx);
      const fromT = canonType(arg0._type);
      if (fromT !== t) {
        const op = watConvOp(fromT, t);
        if (op) b.push(op);
      }
    }
  } else if (kind === 'struct-constructor') {
    // Struct constructors are handled by emitStructInit at VarDecl / AssignStmt level.
    // If we reach here, it means the struct constructor appears as an expression
    // (not directly in a VarDecl/Assign context). This is not yet supported.
    throw new Error(`[WAT] Struct constructor '${expr.segments.join('::')}' in expression context — not yet supported`);
  } else if (kind === 'namespace-func') {
    // Namespace function call: emit args then call with mangled name
    if (expr.args) {
      for (const arg of expr.args) emitExpr(b, arg, ctx);
    }
    b.push(['call', `$${expr._mangledName}`]);
  } else {
    throw new Error(`[WAT] Unknown QualifiedName _resolvedKind '${kind}'`);
  }
  close();
}

// ── Array helpers ─────────────────────────────────────────────────────────────

function emitArrayLiteralExpr(b, expr, ctx) {
  const close = b.openSpan(expr);
  const at    = expr._type;
  const addr  = ctx.bump.allocArray(at.elemType.name, at.size);
  emitArrayInit(b, expr, addr, at, ctx);
  b.push(['i32.const', addr]);
  close();
}

function emitStringLiteralExpr(b, expr, ctx) {
  const close = b.openSpan(expr);
  const at    = expr._type;
  const addr  = ctx.bump.allocArray('u8', at.size);
  emitArrayInit(b, expr, addr, at, ctx);
  b.push(['i32.const', addr]);
  close();
}

function emitArrayInit(b, valueExpr, addrBase, arrayType, ctx) {
  const elemName = arrayType.elemType.name;
  const elemSize = elemByteSize(elemName);
  const stOp     = storeInstr(elemName);

  if (valueExpr.kind === 'ArrayLiteral') {
    for (let i = 0; i < valueExpr.elements.length; i++) {
      emitBaseAddr(b, addrBase, i * elemSize);
      emitExpr(b, valueExpr.elements[i], ctx);
      b.push(stOp);
    }
  } else if (valueExpr.kind === 'StringLiteral') {
    for (let i = 0; i < valueExpr._utf8Bytes.length; i++) {
      emitBaseAddr(b, addrBase, i);
      b.push(['i32.const', valueExpr._utf8Bytes[i]]);
      b.push('i32.store8');
    }
  } else if (valueExpr.kind === 'Identifier') {
    for (let i = 0; i < arrayType.size; i++) {
      const offset = i * elemSize;
      emitBaseAddr(b, addrBase, offset);
      b.push(['local.get', `$${valueExpr.name}`]);
      if (offset > 0) { b.push(['i32.const', offset]); b.push('i32.add'); }
      b.push(loadInstr(elemName));
      b.push(stOp);
    }
  } else {
    throw new Error(`[WAT] Cannot init array from '${valueExpr.kind}'`);
  }
}

function getAddrBase(local, ctx) {
  if (local.frameOffset !== undefined && ctx.frame) {
    return { frameLocalName: ctx.frame.localName, frameOffset: local.frameOffset };
  }
  return local.memAddr;
}

function emitStructInit(b, valueExpr, addrBase, structType, ctx) {
  if (valueExpr === null || valueExpr === undefined ||
      (valueExpr.kind === 'QualifiedName' && valueExpr._resolvedKind === 'struct-constructor' && valueExpr._method === 'default')) {
    // Fill each field with its default value or zero
    for (const field of structType.fields) {
      const offset = structType.fieldOffsets.get(field.name);
      emitBaseAddr(b, addrBase, offset);
      if (field.defaultValue != null) {
        emitExpr(b, field.defaultValue, ctx);
      } else {
        b.push([`${canonType(field.type)}.const`, 0]);
      }
      b.push(storeInstr(field.type.name ?? 'i32'));
    }
  } else if (valueExpr.kind === 'QualifiedName' && valueExpr._resolvedKind === 'struct-constructor' && valueExpr._method === 'of') {
    // Struct literal: Vec2::of(1, 2) — emit each arg into its field slot
    const fields = structType.fields;
    for (let i = 0; i < fields.length; i++) {
      const field  = fields[i];
      const offset = structType.fieldOffsets.get(field.name);
      emitBaseAddr(b, addrBase, offset);
      emitExpr(b, valueExpr.args[i], ctx);
      b.push(storeInstr(field.type.name ?? 'i32'));
    }
  } else if (valueExpr.kind === 'Identifier') {
    // Copy struct by fields
    for (const field of structType.fields) {
      const offset = structType.fieldOffsets.get(field.name);
      emitBaseAddr(b, addrBase, offset);
      b.push(['local.get', `$${valueExpr.name}`]);
      if (offset !== 0) { b.push(['i32.const', offset]); b.push('i32.add'); }
      b.push(loadInstr(field.type.name ?? 'i32'));
      b.push(storeInstr(field.type.name ?? 'i32'));
    }
  } else {
    throw new Error(`[WAT] Cannot init struct from '${valueExpr.kind}'`);
  }
}

function emitBaseAddr(b, addrBase, elemOffset) {
  if (typeof addrBase === 'number') {
    b.push(['i32.const', addrBase + elemOffset]);
  } else {
    b.push(['local.get', addrBase.frameLocalName]);
    const total = addrBase.frameOffset + elemOffset;
    if (total > 0) { b.push(['i32.const', total]); b.push('i32.add'); }
  }
}
