// ─────────────────────────────────────────────────────────────────────────────
// type-infer.js — expression type inference (base class for TypeChecker)
//
// TypeInferBase contains all infer*() methods.  It assumes that subclasses
// provide:
//   this.scope          — current Scope (with .resolve())
//   this.inferExpr()    — dispatches to the methods below (defined here)
//
// TypeChecker (staticTypeChecker.js) extends TypeInferBase and adds:
//   check*, checkBlock, checkStmt, checkAssign, etc.
// ─────────────────────────────────────────────────────────────────────────────

import {
  TypeError,
  INT_TYPES, FLOAT_TYPES,
  typeEq, typeStr,
  isNumeric, isInt, isArray, isPtr, isFunc, isStruct,
  isAssignable, canAsConvert,
  structFieldType,
} from './staticAnalysis.js';

export class TypeInferBase {

  // ── expression dispatch ───────────────────────────────────────────────────

  inferExpr(expr) {
    switch (expr.kind) {
      case 'Literal':             return this.inferLiteral(expr);
      case 'Identifier':          return this.inferIdent(expr);
      case 'BinaryExpr':          return this.inferBinary(expr);
      case 'UnaryExpr':           return this.inferUnary(expr);
      case 'CallExpr':            return this.inferCall(expr);
      case 'AsExpr':              return this.inferAs(expr);
      case 'ArrayLiteral':        return this.inferArrayLiteral(expr);
      case 'StringLiteral':       return this.inferStringLiteral(expr);
      case 'PackLiteral':         return this.inferPackLiteral(expr);
      case 'BracketAccessExpr':   return this.inferIndexExpr(expr);
      case 'MemberExpr':          return this.inferMemberExpr(expr);
      case 'QualifiedName':       return this.inferQualifiedName(expr);
      default:
        throw new TypeError(`Unknown expression kind '${expr.kind}'`, expr.line);
    }
  }

  // ── literal ───────────────────────────────────────────────────────────────

  inferLiteral(expr) {
    let t;
    if (expr.isBool)       t = { kind: 'Type', name: 'bool', mut: false };
    else if (expr.isFloat) t = { kind: 'Type', name: 'f64',  mut: false };
    else if (expr.isChar)  t = { kind: 'Type', name: 'u8',   mut: false };
    else                   t = { kind: 'Type', name: 'i32',  mut: false };
    expr._type = t;
    return t;
  }

  // ── identifier ────────────────────────────────────────────────────────────

  inferIdent(expr) {
    const sym  = this.scope.resolve(expr.name, expr.line);
    expr._type = sym.type;
    expr._mut  = sym.mut;
    return sym.type;
  }

  // ── binary ────────────────────────────────────────────────────────────────

  inferBinary(expr) {
    const lt = this.inferExpr(expr.left);
    const rt = this.inferExpr(expr.right);

    if (expr.op === '&&' || expr.op === '||') {
      const boolTy = { kind: 'Type', name: 'bool', mut: false };
      if (!typeEq(lt, boolTy))
        throw new TypeError(`'${expr.op}' left operand must be 'bool', got '${typeStr(lt)}'`, expr.left);
      if (!typeEq(rt, boolTy))
        throw new TypeError(`'${expr.op}' right operand must be 'bool', got '${typeStr(rt)}'`, expr.right);
      expr._type = boolTy;
      return boolTy;
    }

    const CMP_ORDERED = ['<', '>', '<=', '>='];
    const CMP_EQ      = ['==', '!='];
    if (CMP_ORDERED.includes(expr.op) || CMP_EQ.includes(expr.op)) {
      if (CMP_ORDERED.includes(expr.op)) {
        if (!isNumeric(lt) || !isNumeric(rt))
          throw new TypeError(
            `Operator '${expr.op}' requires numeric operands, got '${typeStr(lt)}' and '${typeStr(rt)}'`,
            expr,
          );
      } else {
        if (lt.name === 'f32' || lt.name === 'f64' || rt.name === 'f32' || rt.name === 'f64')
          throw new TypeError(
            `Operator '${expr.op}' cannot be applied to floating-point types ('${typeStr(lt)}', '${typeStr(rt)}') — use ordered comparisons or an epsilon check`,
            expr,
          );
        const isComparable = t => isNumeric(t) || (t.name === 'bool' && !isPtr(t));
        if (!isComparable(lt) || !isComparable(rt))
          throw new TypeError(
            `Operator '${expr.op}' requires comparable operands, got '${typeStr(lt)}' and '${typeStr(rt)}'`,
            expr,
          );
      }
      if (!typeEq(lt, rt) && !isAssignable(lt, rt) && !isAssignable(rt, lt))
        throw new TypeError(`Type mismatch in '${expr.op}': '${typeStr(lt)}' vs '${typeStr(rt)}'`, expr);
      const opTy = (lt.name === 'i32' || lt.name === 'f64') && !typeEq(lt, rt) ? rt : lt;
      expr._operandType = opTy;
      const boolTy = { kind: 'Type', name: 'bool', mut: false };
      expr._type = boolTy;
      return boolTy;
    }

    if (!isNumeric(lt) || !isNumeric(rt)) {
      throw new TypeError(
        `Operator '${expr.op}' requires numeric operands, got '${typeStr(lt)}' and '${typeStr(rt)}'`,
        expr,
      );
    }

    if (!typeEq(lt, rt)) {
      if (INT_TYPES.has(lt.name) && INT_TYPES.has(rt.name)) {
        const unified = lt.name !== 'i32' ? lt : rt;
        expr.left._type = unified;
        expr.right._type = unified;
        expr._type = unified;
        return unified;
      }
      if (FLOAT_TYPES.has(lt.name) && FLOAT_TYPES.has(rt.name)) {
        const unified = lt.name !== 'f64' ? lt : rt;
        expr.left._type = unified;
        expr.right._type = unified;
        expr._type = unified;
        return unified;
      }
      throw new TypeError(
        `Type mismatch in '${expr.op}': '${typeStr(lt)}' vs '${typeStr(rt)}'`,
        expr,
      );
    }

    expr._type = lt;
    return lt;
  }

  // ── unary ─────────────────────────────────────────────────────────────────

  inferUnary(expr) {
    if (expr.op === '!') {
      const t = this.inferExpr(expr.operand);
      const boolTy = { kind: 'Type', name: 'bool', mut: false };
      if (!typeEq(t, boolTy))
        throw new TypeError(`'!' operator requires 'bool', got '${typeStr(t)}'`, expr);
      expr._type = boolTy;
      return boolTy;
    }

    if (expr.op === '-') {
      const t = this.inferExpr(expr.operand);
      const name = t?.name;
      if (!name || !['i32', 'u8', 'u16', 'u32', 'f64'].includes(name))
        throw new TypeError(`'-' operator requires numeric type, got '${typeStr(t)}'`, expr);
      expr._type = t;
      return t;
    }

    if (expr.op === '&') {
      const t = this.inferExpr(expr.operand);
      const inner = isArray(t) ? { ...t.elemType, mut: false } : { ...t, mut: false };
      const ptrType = { kind: 'PtrType', inner, mut: false };
      expr._type = ptrType;
      return ptrType;
    }

    if (expr.op === '*') {
      const t = this.inferExpr(expr.operand);
      if (!isPtr(t)) throw new TypeError(`Cannot dereference non-pointer type '${typeStr(t)}'`, expr);
      expr._type = t.inner;
      return t.inner;
    }

    throw new TypeError(`Unknown unary operator '${expr.op}'`, expr.line);
  }

  // ── call ──────────────────────────────────────────────────────────────────

  inferCall(expr) {
    const calleeType = this.inferExpr(expr.callee);
    const calleeName = expr.callee.kind === 'Identifier' ? expr.callee.name : null;
    // Propagate _mangledName so codegen emits the correct WASM function name
    // for calls to functions from imported files (which are renamed with a file prefix).
    if (calleeType._mangledName && expr.callee.kind === 'Identifier') {
      expr.callee._mangledName = calleeType._mangledName;
    }

    if (!isFunc(calleeType) && calleeType.name !== '__builtin__') {
      throw new TypeError(`'${calleeName ?? 'expression'}' is not a function`, expr.callee);
    }

    const ft = calleeType;

    if (expr.args.length !== ft.paramTypes.length) {
      throw new TypeError(
        `'${calleeName ?? 'function'}' expects ${ft.paramTypes.length} argument(s), got ${expr.args.length}`,
        expr,
      );
    }

    for (let i = 0; i < expr.args.length; i++) {
      const at = this.inferExpr(expr.args[i]);
      const pt = ft.paramTypes[i];
      if (!isAssignable(at, pt)) {
        throw new TypeError(
          `Argument ${i + 1} of '${calleeName ?? 'function'}': expected '${typeStr(pt)}', got '${typeStr(at)}'`,
          expr.args[i].line,
        );
      }
      expr.args[i]._type = pt;
    }

    expr._type = ft.returnType;
    return ft.returnType;
  }

  // ── as ────────────────────────────────────────────────────────────────────

  inferAs(expr) {
    const fromType = this.inferExpr(expr.expr);
    // Resolve UserTypeRef to concrete type (e.g. UserTypeRef('bool') → Type('bool'))
    const toType   = this.resolveType ? this.resolveType(expr.asType, expr) ?? expr.asType : expr.asType;
    expr.asType    = toType; // update for codegen

    if (isPtr(fromType)) {
      throw new TypeError(
        `'as' operation does not support pointer types as source (got '${typeStr(fromType)}')`,
        expr.line,
      );
    }
    if (isArray(fromType)) {
      if (isPtr(toType) && typeEq(fromType.elemType, toType.inner)) {
        expr._type = toType;
        return toType;
      }
      throw new TypeError(
        `'as' operation does not support array types as source (got '${typeStr(fromType)}')`,
        expr.line,
      );
    }
    if (isPtr(toType)) {
      throw new TypeError(
        `'as' operation does not support pointer types as target (got '${typeStr(toType)}')`,
        expr.line,
      );
    }
    if (isArray(toType)) {
      throw new TypeError(
        `'as' operation does not support array types as target (got '${typeStr(toType)}')`,
        expr.line,
      );
    }
    if (toType.mut) {
      throw new TypeError(
        `'as' operation cannot produce mutable types — target cannot be 'mut'`,
        expr.line,
      );
    }
    if (!canAsConvert(fromType, toType)) {
      throw new TypeError(
        `Cannot convert '${typeStr(fromType)}' to '${typeStr(toType)}' via 'as'`,
        expr.line,
      );
    }

    expr._type = toType;
    return toType;
  }

  // ── arrays ────────────────────────────────────────────────────────────────

  inferArrayLiteral(expr) {
    if (expr.elements.length === 0) {
      throw new TypeError('Empty array literal requires explicit type annotation', expr.line);
    }
    const elemTypes = expr.elements.map(e => this.inferExpr(e));
    const anchor = elemTypes[0];
    for (let i = 1; i < elemTypes.length; i++) {
      if (!isAssignable(elemTypes[i], anchor) && !isAssignable(anchor, elemTypes[i])) {
        throw new TypeError(
          `Array literal element ${i} type '${typeStr(elemTypes[i])}' incompatible with '${typeStr(anchor)}'`,
          expr.elements[i].line,
        );
      }
    }
    const arrType = {
      kind: 'ArrayType',
      elemType: { ...anchor, mut: false },
      size: expr.elements.length,
      mut: false,
    };
    expr._type = arrType;
    return arrType;
  }

  inferStringLiteral(expr) {
    const bytes = new TextEncoder().encode(expr.value);
    expr._utf8Bytes = bytes;
    const arrType = {
      kind: 'ArrayType',
      elemType: { kind: 'Type', name: 'u8', mut: false },
      size: bytes.length,
      mut: false,
    };
    expr._type = arrType;
    return arrType;
  }

  inferPackLiteral(expr) {
    for (const el of expr.elements) this.inferExpr(el);
    const packType = { kind: 'Type', name: 'pack', mut: false };
    expr._type = packType;
    return packType;
  }

  // ── index access ──────────────────────────────────────────────────────────

  inferIndexExpr(expr) {
    const baseTy = this.inferExpr(expr.base);
    const idxTy  = this.inferExpr(expr.index);

    if (!isInt(idxTy)) {
      throw new TypeError(
        `Array index must be an integer, got '${typeStr(idxTy)}'`,
        expr.index.line,
      );
    }

    let elemTy;
    if (isArray(baseTy)) {
      elemTy = baseTy.elemType;
      // _elemMut ordering invariant: must be set before checkAssign reads it.
      expr._elemMut = baseTy.elemType.mut ?? false;
    } else if (isPtr(baseTy)) {
      elemTy = baseTy.inner;
      expr._elemMut = baseTy.inner.mut ?? false;
    } else {
      throw new TypeError(
        `Cannot index non-array, non-pointer type '${typeStr(baseTy)}'`,
        expr.line,
      );
    }

    expr._elemType = elemTy;
    expr._type     = elemTy;
    return elemTy;
  }

  // ── member access ─────────────────────────────────────────────────────────

  inferMemberExpr(expr) {
    const objTy = this.inferExpr(expr.obj);
    if (isArray(objTy) && expr.member === 'size') {
      expr._arraySize = objTy.size;
      const t = { kind: 'Type', name: 'u32', mut: false };
      expr._type = t;
      return t;
    }
    if (isStruct(objTy)) {
      const fieldTy = structFieldType(objTy, expr.member);
      if (!fieldTy) {
        throw new TypeError(
          `Struct '${objTy.name}' has no field '${expr.member}'`,
          expr,
        );
      }
      // Expose field mutability and byte offset for codegen
      const structField = objTy.fields.find(f => f.name === expr.member);
      expr._fieldMut    = structField.mut;
      expr._fieldOffset = objTy.fieldOffsets.get(expr.member);
      expr._type = fieldTy;
      return fieldTy;
    }
    if (expr.member === 'size') {
      throw new TypeError(
        `'.size' is only available on array types, got '${typeStr(objTy)}'`,
        expr,
      );
    }
    throw new TypeError(`Unknown member '${expr.member}' on type '${typeStr(objTy)}'`, expr);
  }

  // ── qualified name (A::B, A::B::C, A::B(args)) ─────────────────────────

  inferQualifiedName(expr) {
    const segments = expr.segments;
    const args     = expr.args;
    const sym      = this.scope.resolveQualified(segments, expr);
    const resolved = sym.type;

    if (!resolved) {
      throw new TypeError(
        `'${segments.join('::')}' could not be resolved`,
        expr,
      );
    }

    const method = segments[segments.length - 1]; // last segment: 'of', 'default', etc.

    // ── scalar constructor (i32::of, f64::default, etc.) ──────────────
    if (resolved.kind === 'scalar-constructor') {
      const scalarType = { kind: 'Type', name: resolved.typeName, mut: false };
      expr._resolvedKind = 'scalar-constructor';
      expr._method       = method;

      if (method === 'default') {
        expr._type = scalarType;
        return scalarType;
      }
      if (method === 'of') {
        if (!args || args.length !== 1) {
          throw new TypeError(
            `'${resolved.typeName}::of' expects 1 argument, got ${args?.length ?? 0}`,
            expr,
          );
        }
        const argTy = this.inferExpr(args[0]);
        if (!isAssignable(argTy, scalarType) && !isAssignable(scalarType, argTy)) {
          throw new TypeError(
            `'${resolved.typeName}::of(...)': argument type '${typeStr(argTy)}' is not compatible with '${typeStr(scalarType)}'`,
            expr,
          );
        }
        args[0]._type = scalarType;
        expr._type = scalarType;
        return scalarType;
      }
      throw new TypeError(
        `Unknown method '${method}' on scalar '${resolved.typeName}' — only 'of' and 'default' are supported`,
        expr,
      );
    }

    // ── struct constructor (Player::of, Player::default) ──────────────
    if (resolved.kind === 'struct-constructor') {
      const structType = resolved.structType;
      expr._resolvedKind = 'struct-constructor';
      expr._method       = method;

      if (method === 'default') {
        expr._type = structType;
        return structType;
      }
      if (method === 'of') {
        const fields = structType.fields;
        if (!args || args.length !== fields.length) {
          throw new TypeError(
            `'${structType.name}::of' expects ${fields.length} argument(s), got ${args?.length ?? 0}`,
            expr,
          );
        }
        for (let i = 0; i < fields.length; i++) {
          const argTy = this.inferExpr(args[i]);
          if (!isAssignable(argTy, fields[i].type)) {
            throw new TypeError(
              `'${structType.name}::of' field '${fields[i].name}': expected '${typeStr(fields[i].type)}', got '${typeStr(argTy)}'`,
              args[i],
            );
          }
        }
        expr._type = structType;
        return structType;
      }
      throw new TypeError(
        `Unknown method '${method}' on struct '${structType.name}' — only 'of' and 'default' are supported`,
        expr,
      );
    }

    // ── namespace function call ───────────────────────────────────────
    if (sym.kind === 'func' && resolved?.name === '__func__') {
      const funcType = resolved;
      expr._resolvedKind = 'namespace-func';
      expr._mangledName  = funcType._mangledName || segments.join('__');

      if (!args || args.length === 0) {
        // Bare reference without call args — treat as void call if the function has no params
        if (funcType.paramTypes.length === 0) {
          expr._type = funcType.returnType;
          return funcType.returnType;
        }
        throw new TypeError(
          `'${segments.join('::')}' expects ${funcType.paramTypes.length} argument(s), got 0`,
          expr,
        );
      }

      if (args.length !== funcType.paramTypes.length) {
        throw new TypeError(
          `'${segments.join('::')}' expects ${funcType.paramTypes.length} argument(s), got ${args.length}`,
          expr,
        );
      }
      for (let i = 0; i < args.length; i++) {
        const argTy = this.inferExpr(args[i]);
        if (!isAssignable(argTy, funcType.paramTypes[i])) {
          throw new TypeError(
            `'${segments.join('::')}': argument ${i + 1} type '${typeStr(argTy)}' is not assignable to '${typeStr(funcType.paramTypes[i])}'`,
            args[i],
          );
        }
      }
      expr._type = funcType.returnType;
      return funcType.returnType;
    }

    throw new TypeError(
      `'${segments.join('::')}' resolved to unsupported kind '${resolved?.kind ?? sym.kind}'`,
      expr,
    );
  }
}
