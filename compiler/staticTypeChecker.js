// ─────────────────────────────────────────────────────────────────────────────
// staticTypeChecker.js — TypeChecker class + typecheck() entry point
//
// Class hierarchy:
//   TypeInferBase (type-infer.js)  — all infer*() expression methods
//   TypeChecker   (this file)      — scope, declarations, statements, checkAssign
// ─────────────────────────────────────────────────────────────────────────────

import {
  TypeError,
  Scope,
  typeEq, typeStr,
  isArray, isPtr, isFunc, isStruct,
  normalizeType, isAssignable,
  buildStructType, typeByteSize,
  PACK_KIND,
} from './staticAnalysis.js';
import { TypeInferBase } from './type-infer.js';

export { TypeError, typeStr };

// ── checker ───────────────────────────────────────────────────────────────────

export class TypeChecker extends TypeInferBase {
  constructor() {
    super();
    this.globalScope = new Scope(null);
    this.scope       = this.globalScope;
    this.loopDepth   = 0;
    this.errors      = null;  // when set (array), enables resilient per-stmt error collection
    this._registerBuiltins();
  }

  _registerBuiltins() {
    // Scalar types: registered as type symbols in globalScope + namespaces with of/default
    const SCALAR_NAMES = ['i8','u8','i16','u16','i32','u32','i64','u64','f32','f64','bool'];
    for (const name of SCALAR_NAMES) {
      const scalarType = { kind: 'Type', name, mut: false };
      this.globalScope.define(name, scalarType, 'type', false, 0);
      const ns = this.globalScope.defineNamespace(name);
      ns.define('of',      { kind: 'scalar-constructor', typeName: name }, 'builtin', false, 0);
      ns.define('default', { kind: 'scalar-constructor', typeName: name }, 'builtin', false, 0);
    }

  }

  pushScope() { this.scope = new Scope(this.scope); }
  popScope()  { this.scope = this.scope.parent; }

  // ── program ────────────────────────────────────────────────────────────────

  check(ast, importEnv = null) {
    // Pass 0: register namespace declarations (empty + alias) and file imports
    for (const decl of ast.body) {
      if (decl.kind === 'NamespaceDecl') {
        if (decl.target) {
          // Alias: gfx := namespace Engine::Graphics;
          this.scope.define(decl.name, null, 'namespace-alias', false, decl.line);
          this.scope.symbols.get(decl.name).target = decl.target;
        } else {
          // Empty: std := namespace;
          this.scope.defineNamespace(decl.name);
        }
      }
      if (decl.kind === 'NamespaceImport') {
        const nsKey = _filenameToNsKey(decl.filename);
        const entry = importEnv?.get(decl.filename);
        if (!entry) {
          throw new TypeError(`File not found for import: '${decl.filename}'`, decl);
        }
        this.globalScope.mountNamespace(nsKey, entry.scope);

        if (decl.alias === null) {
          // Wildcard: import "file.qlang" — expose all user-defined symbols directly
          for (const [name, sym] of entry.scope.symbols) {
            if (sym.kind === 'type') continue; // skip scalar builtins (i32, u8, etc.)
            try {
              this.scope.define(name, sym.type, sym.kind, sym.mut ?? false, decl.line);
            } catch {
              throw new TypeError(
                `Wildcard import conflict in '${decl.filename}': name '${name}' already defined`,
                decl,
              );
            }
          }
          // Mount user-created namespaces (struct constructors, function namespaces)
          if (entry.scope.namespaces) {
            for (const [nsName, nsScope] of entry.scope.namespaces) {
              if (!this.globalScope.namespaces?.has(nsName)) {
                this.globalScope.mountNamespace(nsName, nsScope);
              }
            }
          }
        } else {
          // Aliased: m := import "file.qlang"
          this.scope.define(decl.alias, null, 'namespace-alias', false, decl.line);
          this.scope.symbols.get(decl.alias).target = [nsKey];
        }
      }
    }

    // Pass 1a: register all top-level function signatures
    for (const decl of ast.body) {
      if (decl.kind === 'ErrorNode') continue;
      if (decl.kind === 'FuncDecl') {
        // When typechecking an imported file in isolation (_filePrefix is set),
        // rename the FuncDecl.name with the prefix to ensure unique WASM names.
        // Register under the ORIGINAL name in scope so intra-file calls still resolve.
        const originalName = decl.name;
        const mangledName  = this._filePrefix ? this._filePrefix + '__' + originalName : null;
        if (mangledName) decl.name = mangledName; // rename for WASM emit
        // Resolve scalar UserTypeRefs in param types (struct refs resolved in Pass 2)
        const paramTypes = decl.params.map(p => {
          try { return this.resolveType(p.typeAnnot, p); } catch { return p.typeAnnot; }
        });
        let returnType;
        try { returnType = this.resolveType(decl.returnType, decl); } catch { returnType = decl.returnType; }
        const funcType = { name: '__func__', mut: false, returnType, paramTypes };
        if (mangledName) funcType._mangledName = mangledName;
        this.scope.define(originalName, funcType, 'func', false, decl.line);
        decl._type = funcType;
      }
      // Namespaced function: A::B := fn(...) — mangle name + register in namespace scope
      if (decl.kind === 'NamespacedDecl' && decl.inner.kind === 'FuncDecl') {
        const mangledName = decl.segments.join('__');
        decl.inner.name = mangledName;
        const fd = decl.inner;
        const paramTypes = fd.params.map(p => {
          try { return this.resolveType(p.typeAnnot, p); } catch { return p.typeAnnot; }
        });
        let returnType;
        try { returnType = this.resolveType(fd.returnType, fd); } catch { returnType = fd.returnType; }
        const funcType = { name: '__func__', mut: false, returnType, paramTypes, _mangledName: mangledName };
        this.scope.defineQualified(decl.segments, funcType, 'func', false, fd.line);
        fd._type = funcType;
      }
      // extern! runtime import: name : fn(...) T = extern!("module.field");
      if (decl.kind === 'VarDecl' && decl.value?.kind === 'RuntimeImportExpr') {
        const rie = decl.value;
        if (!decl.typeAnnot) throw new TypeError(`extern! declaration requires an explicit function type annotation`, decl);
        const funcType = this.resolveType(decl.typeAnnot, decl);
        if (!isFunc(funcType)) throw new TypeError(`extern! type annotation must be a function type`, decl);
        this._runtimeImports ??= new Set();
        const importKey = `${rie.module}.${rie.field}`;
        if (this._runtimeImports.has(importKey)) throw new TypeError(`Duplicate extern! declaration for '${importKey}'`, decl);
        this._runtimeImports.add(importKey);
        const mangledName = this._filePrefix ? `${this._filePrefix}__${decl.name}` : decl.name;
        Object.assign(funcType, { _isRuntimeImport: true, _wasmModule: rie.module, _wasmField: rie.field, _mangledName: mangledName });
        this.scope.define(decl.name, funcType, 'func', false, decl.line);
        decl._type = funcType;
        decl._isRuntimeImport = true;
      }
    }

    // Pass 1b: register struct names as placeholders (allows forward/mutual refs)
    for (const decl of ast.body) {
      if (decl.kind !== 'StructDecl') continue;
      const placeholder = { kind: 'StructType', name: decl.name, fields: [], byteSize: 0, fieldOffsets: new Map() };
      this.scope.define(decl.name, placeholder, 'struct', false, decl.line);
      decl._type = placeholder;
    }

    // Pass 2: fully check all declarations (resolves struct fields in place)
    for (const decl of ast.body) {
      this.checkDecl(decl);
    }

    return ast;
  }

  // ── declarations ──────────────────────────────────────────────────────────

  checkDecl(decl) {
    if (decl.kind === 'ErrorNode')    return; // skip — parse failed, no type info available
    if (decl.kind === 'VarDecl')      return this.checkVarDecl(decl, this.scope);
    if (decl.kind === 'FuncDecl')     return this.checkFuncDecl(decl);
    if (decl.kind === 'MacroDecl')    return; // consumed by expander before typecheck
    if (decl.kind === 'StructDecl')   return this.checkStructDecl(decl);
    if (decl.kind === 'NamespaceDecl')   return; // processed in Pass 0
    if (decl.kind === 'NamespaceImport')  return; // processed in Pass 0 via importEnv
    if (decl.kind === 'NamespacedDecl')   return this.checkNamespacedDecl(decl);
    throw new TypeError(`Unknown declaration kind '${decl.kind}'`, decl.line);
  }

  // ── namespaced declaration ─────────────────────────────────────────────────

  checkNamespacedDecl(decl) {
    if (decl.inner.kind === 'FuncDecl') return this.checkFuncDecl(decl.inner);
    if (decl.inner.kind === 'VarDecl')  return this.checkVarDecl(decl.inner, this.scope, true);
    throw new TypeError(`Unsupported namespaced declaration kind '${decl.inner.kind}'`, decl);
  }

  // ── struct declaration ───────────────────────────────────────────────────────────────

  checkStructDecl(decl) {
    // Resolve each field's type annotation and validate.
    // Circular value-embedding is detected via a 'resolving' set.
    if (!this._structResolving) this._structResolving = new Set();
    if (this._structResolving.has(decl.name)) {
      throw new TypeError(
        `Circular struct value-embedding: '${decl.name}' contains itself — use a pointer instead`,
        decl,
      );
    }
    this._structResolving.add(decl.name);

    const resolvedFields = [];
    for (const field of decl.fields) {
      const origAnnot = field.typeAnnot;
      const resolvedType = this.resolveType(field.typeAnnot, field);
      // Preserve source position of the type annotation for hover/IDE
      if (origAnnot?.start != null) {
        field._typeAnnotStart = origAnnot.start;
        field._typeAnnotEnd   = origAnnot.end;
      }
      // Validate default value type compatibility
      if (field.defaultValue !== null) {
        const dvTy = this.inferExpr(field.defaultValue);
        if (!isAssignable(dvTy, resolvedType)) {
          throw new TypeError(
            `Struct field '${field.name}' default value type '${typeStr(dvTy)}' is not assignable to '${typeStr(resolvedType)}'`,
            field,
          );
        }
        field.defaultValue._type = resolvedType;
      }
      field._type = resolvedType;
      resolvedFields.push({ name: field.name, type: resolvedType, mut: field.mut, defaultValue: field.defaultValue ?? null });
    }

    this._structResolving.delete(decl.name);

    // Mutate the placeholder StructType registered in Pass 1b
    const st = buildStructType(decl.name, resolvedFields);
    const placeholder = decl._type;
    Object.assign(placeholder, st);  // fill in-place so scope references update

    // Auto-create namespace with of/default constructors
    const ns = this.globalScope.defineNamespace(decl.name);
    ns.define('of',      { kind: 'struct-constructor', structType: placeholder }, 'builtin', false, decl.line);
    ns.define('default', { kind: 'struct-constructor', structType: placeholder }, 'builtin', false, decl.line);

    return placeholder;
  }

  // Resolve a parser type annotation to a fully-resolved internal type.
  // Recursively resolves UserTypeRef inside PtrType, ArrayType, FuncType.
  // Also handles QualifiedTypeRef: m::Vec2 where m is a NamespaceImport alias.
  resolveType(typeAnnot, errorNode) {
    if (!typeAnnot) return null;
    if (typeAnnot.kind === 'UserTypeRef') {
      const sym = this.scope.resolve(typeAnnot.name, errorNode);
      if (sym.kind === 'type' && sym.type?.kind === 'Type') {
        // Scalar type (i32, f64, bool, etc.) — registered by _registerBuiltins
        return { ...sym.type, mut: typeAnnot.mut ?? false };
      }
      if (sym.type?.kind === 'StructType') {
        return { ...sym.type, mut: typeAnnot.mut ?? false };
      }
      throw new TypeError(
        `'${typeAnnot.name}' is not a type`,
        errorNode,
      );
    }
    if (typeAnnot.kind === 'QualifiedTypeRef') {
      // e.g. m::Vec2 — resolve through namespace chain (namespace-alias expansion in Scope)
      const sym = this.scope.resolveQualified(typeAnnot.segments, errorNode);
      if (sym?.type?.kind === 'StructType') {
        return { ...sym.type, mut: typeAnnot.mut ?? false };
      }
      throw new TypeError(
        `'${typeAnnot.segments.join('::')}' is not a type`,
        errorNode,
      );
    }
    if (typeAnnot.kind === 'PtrType') {
      return { ...typeAnnot, inner: this.resolveType(typeAnnot.inner, errorNode) };
    }
    if (typeAnnot.kind === 'ArrayType') {
      return { ...typeAnnot, elemType: this.resolveType(typeAnnot.elemType, errorNode) };
    }
    if (typeAnnot.kind === 'FuncType') {
      return {
        name: '__func__', mut: false,
        returnType: this.resolveType(typeAnnot.returnType, errorNode),
        paramTypes: typeAnnot.paramTypes.map(p => this.resolveType(p, errorNode)),
      };
    }
    return normalizeType(typeAnnot);
  }

  checkVarDecl(decl, scope, isNamespacedTopLevel = false) {
    // extern! declarations are fully handled in Pass 1a — skip deep checking.
    if (decl._isRuntimeImport) return;

    // Language rule: top-level (global) vars are immutable constants only.
    if (scope === this.globalScope && decl.typeAnnot?.mut) {
      throw new TypeError(
        `Top-level variable '${decl.name}' cannot be 'mut'`,
        decl,
      );
    }

    // Temporary hard stop: namespace-level variables must be assigned directly
    // from literals until a full const-eval mechanism is designed.
    if (scope === this.globalScope && isNamespacedTopLevel) {
      const k = decl.value?.kind;
      if (k !== 'Literal' && k !== 'StringLiteral') {
        throw new TypeError(
          `Namespace-level variable '${decl.name}' must be assigned from a literal`,
          decl,
        );
      }
    }

    // Resolve type annotation (handles UserTypeRef for struct types)
    if (decl.typeAnnot) {
      const origAnnot = decl.typeAnnot;
      decl.typeAnnot = this.resolveType(decl.typeAnnot, decl) ?? normalizeType(decl.typeAnnot);
      // Preserve source position of the type annotation for hover/IDE
      if (origAnnot?.start != null && decl._typeAnnotStart == null) {
        decl._typeAnnotStart = origAnnot.start;
        decl._typeAnnotEnd   = origAnnot.end;
      }
    }
    const valueType = this.inferExpr(decl.value);

    // Pack guard: 'pack' is a compile-time-only type; it cannot be stored in a
    // runtime variable binding.  Pass the literal directly to a macro call or
    // use '@ident' splice syntax inside an unpack! call.
    if (valueType.name === PACK_KIND) {
      throw new TypeError(
        `'pack' is a compile-time-only type and cannot be stored in a runtime ` +
        `variable binding. Pass the literal directly to a macro call or use ` +
        `'@ident' splice syntax.`,
        decl,
      );
    }

    if (decl.typeAnnot) {
      if (isArray(decl.typeAnnot)) {
        if (!isArray(valueType)) {
          throw new TypeError(
            `Expected array type '${typeStr(decl.typeAnnot)}', got '${typeStr(valueType)}'`,
            decl,
          );
        }
        if (decl.typeAnnot.size !== valueType.size) {
          throw new TypeError(
            `Array size mismatch: annotation says ${decl.typeAnnot.size}, literal has ${valueType.size} elements`,
            decl,
          );
        }
        if (decl.value.kind === 'ArrayLiteral') {
          for (const el of decl.value.elements) {
            el._type = decl.typeAnnot.elemType;
          }
        }
        decl._type = decl.typeAnnot;
      } else {
        if (!isAssignable(valueType, decl.typeAnnot)) {
          throw new TypeError(
            `Cannot assign '${typeStr(valueType)}' to '${typeStr(decl.typeAnnot)}'`,
            decl,
          );
        }
        decl._type = decl.typeAnnot;
      }
    } else {
      decl._type = { ...valueType, mut: false };
    }

    // Do not propagate const metadata through local temporaries.
    // Global consts may carry _constValue for direct Identifier reads,
    // but locals must always be treated as runtime values.
    if (scope !== this.globalScope && decl._type && decl._type._constValue !== undefined) {
      delete decl._type._constValue;
    }

    const bindingMut = decl.typeAnnot ? (decl.typeAnnot.mut ?? false) : false;
    scope.define(decl.name, decl._type, 'var', bindingMut, decl.line);

    // Store raw literal value for immutable global constants.
    // This is not const-eval: only direct Literal nodes are supported.
    if (scope === this.globalScope) {
      if (decl.value?.kind === 'Literal') {
        decl._type._constValue = decl.value.value;
        const sym = scope.symbols.get(decl.name);
        if (sym?.type) sym.type._constValue = decl.value.value;
      }
    }

    decl.value._type = decl._type;
    return decl._type;
  }

  checkFuncDecl(decl) {
    this.pushScope();

    // Resolve return type (may contain UserTypeRef for struct return types)
    decl.returnType = this.resolveType(decl.returnType, decl) ?? decl.returnType;
    if (decl._type) decl._type.returnType = decl.returnType;

    for (let i = 0; i < decl.params.length; i++) {
      const param = decl.params[i];
      const origAnnot = param.typeAnnot;
      const resolvedType = this.resolveType(param.typeAnnot, param);
      const paramMut     = resolvedType.mut ?? false;
      this.scope.define(param.name, resolvedType, 'var', paramMut, param.line);
      param._type    = resolvedType;
      param.typeAnnot = resolvedType;  // update so codegen sees resolved type
      // Preserve source position of the type annotation for hover/IDE
      if (origAnnot?.start != null) {
        param._typeAnnotStart = origAnnot.start;
        param._typeAnnotEnd   = origAnnot.end;
      }
      if (decl._type) decl._type.paramTypes[i] = resolvedType;
    }

    const savedReturn    = this.currentReturnType;
    this.currentReturnType = decl.returnType;
    this.checkBlock(decl.body);
    this.currentReturnType = savedReturn;

    this.popScope();
  }

  // ── block / statements ────────────────────────────────────────────────────

  checkBlock(block) {
    this.pushScope();
    for (const stmt of block.body) {
      if (this.errors !== null) {
        const savedScope      = this.scope;
        const savedReturnType = this.currentReturnType;
        const savedLoopDepth  = this.loopDepth;
        try {
          this.checkStmt(stmt);
        } catch (e) {
          this.errors.push(e);
          this.scope            = savedScope;
          this.currentReturnType = savedReturnType;
          this.loopDepth        = savedLoopDepth;
        }
      } else {
        this.checkStmt(stmt);
      }
    }
    this.popScope();
  }

  checkStmt(stmt) {
    if (stmt.kind === 'ErrorNode')          return; // parse-error placeholder
    if (stmt.kind === 'MacroExpansionNode') {
      // Inline body into current scope (no new scope — mirrors flat-splice semantics)
      for (const s of stmt.body) this.checkStmt(s);
      return;
    }
    if (stmt.kind === 'MacroDecl') return;
    if (stmt.kind === 'ReturnStmt') {
      const ret = this.currentReturnType;
      if (ret?.name === 'void') {
        if (stmt.value !== null && stmt.value !== undefined) {
          throw new TypeError(
            `Void function must not return a value`,
            stmt.line,
          );
        }
        stmt._type = ret;
        return;
      }
      const t = this.inferExpr(stmt.value);
      if (!isAssignable(t, ret)) {
        throw new TypeError(
          `Return type mismatch: expected '${typeStr(ret)}', got '${typeStr(t)}'`,
          stmt.line,
        );
      }
      stmt.value._type = ret;
      stmt._type = ret;
      return;
    }

    if (stmt.kind === 'VarDecl') {
      this.checkVarDecl(stmt, this.scope);
      return;
    }

    if (stmt.kind === 'FuncDecl') {
      const paramTypes = stmt.params.map(p => p.typeAnnot);
      const funcType   = { name: '__func__', mut: false, returnType: stmt.returnType, paramTypes };
      stmt._type = funcType;
      this.scope.define(stmt.name, funcType, 'func', false, stmt.line);
      this.checkFuncDecl(stmt);
      return;
    }

    if (stmt.kind === 'ExprStmt') {
      this.inferExpr(stmt.expr);
      return;
    }

    if (stmt.kind === 'AssignStmt') {
      return this.checkAssign(stmt);
    }

    if (stmt.kind === 'IfStmt')    return this.checkIfStmt(stmt);
    if (stmt.kind === 'WhileStmt') return this.checkWhileStmt(stmt);
    if (stmt.kind === 'BreakStmt') {
      if (this.loopDepth === 0) throw new TypeError("'break' outside of loop", stmt.line);
      return;
    }

    if (stmt.kind === 'ScopeBlock') {
      this.checkBlock({ body: stmt.body, line: stmt.line, start: stmt.start, end: stmt.end });
      return;
    }

    if (stmt.kind === 'DeferStmt') {
      // deferPass rewrites DeferStmt before codegen; typecheck only validates the inner expr/stmt.
      if (stmt.stmt) {
        this.checkStmt(stmt.stmt);
      } else {
        this.inferExpr(stmt.expr);
      }
      return;
    }

    if (stmt.kind === 'MacroCallStmt') {
      throw new TypeError(
        `Macro call '${stmt.name}!(...)' was not expanded — run expand() before typecheck()`,
        stmt.line,
      );
    }

    throw new TypeError(`Unknown statement kind '${stmt.kind}'`, stmt.line);
  }


  checkIfStmt(stmt) {
    const condTy = this.inferExpr(stmt.condition);
    if (!typeEq(condTy, { kind: 'Type', name: 'bool', mut: false }))
      throw new TypeError(`If condition must be 'bool', got '${typeStr(condTy)}'`, stmt);
    this.checkBlock(stmt.then);
    if (stmt.elseBranch) this.checkBlock(stmt.elseBranch);
  }

  checkWhileStmt(stmt) {
    const condTy = this.inferExpr(stmt.condition);
    if (!typeEq(condTy, { kind: 'Type', name: 'bool', mut: false }))
      throw new TypeError(`While condition must be 'bool', got '${typeStr(condTy)}'`, stmt);
    this.loopDepth++;
    this.checkBlock(stmt.body);
    this.loopDepth--;
  }

  checkAssign(stmt) {
    const valueTy = this.inferExpr(stmt.value);

    if (stmt.target.kind === 'Identifier') {
      const sym = this.scope.resolve(stmt.target.name, stmt.target.line);
      if (sym.kind === 'func' || sym.kind === 'builtin') {
        throw new TypeError(
          `Cannot assign to function '${stmt.target.name}' — function bindings are always const`,
          stmt.target,
        );
      }
      if (!sym.mut) {
        throw new TypeError(
          `Cannot assign to const variable '${stmt.target.name}' (type: ${typeStr(sym.type)}) — declare with 'mut' to allow mutation`,
          stmt.target,
        );
      }

      if (isArray(sym.type)) {
        if (!isAssignable(valueTy, sym.type)) {
          throw new TypeError(
            `Cannot assign '${typeStr(valueTy)}' to array '${stmt.target.name}' of type '${typeStr(sym.type)}' — sizes or element types are incompatible`,
            stmt,
          );
        }
        if (stmt.value.kind === 'ArrayLiteral') {
          for (const el of stmt.value.elements) {
            el._type = sym.type.elemType;
          }
        }
        stmt.target._type = sym.type;
        stmt._type        = sym.type;
        return sym.type;
      }

      if (!isAssignable(valueTy, sym.type)) {
        throw new TypeError(
          `Cannot assign '${typeStr(valueTy)}' to variable '${stmt.target.name}' of type '${typeStr(sym.type)}'`,
          stmt,
        );
      }
      stmt.target._type = sym.type;
      stmt._type        = sym.type;
      return sym.type;
    }

    if (stmt.target.kind === 'BracketAccessExpr') {
      const targetTy = this.inferIndexExpr(stmt.target);
      if (!stmt.target._elemMut) {
        throw new TypeError(
          `Cannot assign to element of const array — element type is '${typeStr(targetTy)}' (not mut). Declare element type with 'mut' to allow mutation, e.g. array<mut ${targetTy.name || '?'}, N>`,
          stmt.target,
        );
      }
      if (!isAssignable(valueTy, targetTy)) {
        throw new TypeError(
          `Cannot assign '${typeStr(valueTy)}' to element of type '${typeStr(targetTy)}'`,
          stmt,
        );
      }
      stmt._type = targetTy;
      return targetTy;
    }

    if (stmt.target.kind === 'MemberExpr') {
      const targetTy = this.inferMemberExpr(stmt.target);
      if (!stmt.target._fieldMut) {
        throw new TypeError(
          `Cannot assign to const field '${stmt.target.member}' — declare it with 'mut' to allow mutation`,
          stmt.target,
        );
      }
      if (!isAssignable(valueTy, targetTy)) {
        throw new TypeError(
          `Cannot assign '${typeStr(valueTy)}' to field '${stmt.target.member}' of type '${typeStr(targetTy)}'`,
          stmt,
        );
      }
      stmt._type = targetTy;
      return targetTy;
    }

    if (stmt.target.kind === 'UnaryExpr' && stmt.target.op === '*') {
      const ptrTy = this.inferExpr(stmt.target.operand);
      if (!isPtr(ptrTy)) {
        throw new TypeError(`Cannot assign through non-pointer type '${typeStr(ptrTy)}'`, stmt.target);
      }
      const targetTy = ptrTy.inner;
      stmt.target._type = targetTy;
      if (!targetTy.mut) {
        throw new TypeError(
          `Cannot assign through pointer to const — pointee type is '${typeStr(targetTy)}' (not mut). Declare pointee type with 'mut' to allow mutation, e.g. ptr<mut ${targetTy.name ?? '?'}>`,
          stmt.target,
        );
      }
      if (!isAssignable(valueTy, targetTy)) {
        throw new TypeError(
          `Cannot assign '${typeStr(valueTy)}' through pointer to '${typeStr(targetTy)}'`,
          stmt,
        );
      }
      stmt._type = targetTy;
      return targetTy;
    }

    throw new TypeError(`Invalid assignment target '${stmt.target.kind}'`, stmt.line);
  }
}

// Map a filename to a unique internal namespace key used when mounting imported file scopes.
// E.g. 'utils.qlang' → '__f_utils_qlang'
export function _filenameToNsKey(filename) {
  return '__f_' + filename.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

export function typecheck(ast, importEnv = null) {
  const tc = new TypeChecker();
  tc.check(ast, importEnv);
  return ast;
}

// liveTypecheck — resilient typecheck for live IDE feedback.
// Collects ALL type errors (per statement + per declaration) instead of throwing on first.
// tc.errors enables resilient per-statement recovery inside checkBlock.
// Outer per-declaration try-catch catches errors before checkBlock runs (e.g. param types).
// Stores results in ast.typeErrors.
export function liveTypecheck(ast, importEnv = null) {
  ast.typeErrors = [];
  const tc = new TypeChecker();
  tc.errors = ast.typeErrors; // enable resilient per-stmt mode in checkBlock

  // Pass 0: register namespace declarations (empty + alias) and file imports — resilient
  for (const decl of ast.body) {
    if (decl.kind === 'NamespaceDecl') {
      try {
        if (decl.target) {
          tc.scope.define(decl.name, null, 'namespace-alias', false, decl.line);
          tc.scope.symbols.get(decl.name).target = decl.target;
        } else {
          tc.scope.defineNamespace(decl.name);
        }
      } catch (e) {
        ast.typeErrors.push(e);
      }
    }
    if (decl.kind === 'NamespaceImport') {
      try {
        const nsKey = _filenameToNsKey(decl.filename);
        const entry = importEnv?.get(decl.filename);
        if (!entry) {
          ast.typeErrors.push(new TypeError(`File not found for import: '${decl.filename}'`, decl));
          continue;
        }
        tc.globalScope.mountNamespace(nsKey, entry.scope);
        if (decl.alias === null) {
          for (const [name, sym] of entry.scope.symbols) {
            if (sym.kind === 'type') continue;
            try {
              tc.scope.define(name, sym.type, sym.kind, sym.mut ?? false, decl.line);
            } catch {
              throw new TypeError(
                `Wildcard import conflict in '${decl.filename}': name '${name}' already defined`,
                decl,
              );
            }
          }
          if (entry.scope.namespaces) {
            for (const [nsName, nsScope] of entry.scope.namespaces) {
              if (!tc.globalScope.namespaces?.has(nsName)) {
                tc.globalScope.mountNamespace(nsName, nsScope);
              }
            }
          }
        } else {
          tc.scope.define(decl.alias, null, 'namespace-alias', false, decl.line);
          tc.scope.symbols.get(decl.alias).target = [nsKey];
        }
      } catch (e) {
        ast.typeErrors.push(e);
      }
    }
  }

  // Pass 1a: register all top-level function signatures (resilient)
  for (const decl of ast.body) {
    if (decl.kind === 'ErrorNode') continue;
    if (decl.kind === 'FuncDecl') {
      try {
        const originalName = decl.name;
        const mangledName  = tc._filePrefix ? tc._filePrefix + '__' + originalName : null;
        if (mangledName) decl.name = mangledName;
        const paramTypes = decl.params.map(p => {
          try { return tc.resolveType(p.typeAnnot, p); } catch { return p.typeAnnot; }
        });
        let returnType;
        try { returnType = tc.resolveType(decl.returnType, decl); } catch { returnType = decl.returnType; }
        const funcType = { name: '__func__', mut: false, returnType, paramTypes };
        if (mangledName) funcType._mangledName = mangledName;
        tc.scope.define(originalName, funcType, 'func', false, decl.line);
        decl._type = funcType;
      } catch (e) {
        ast.typeErrors.push(e);
      }
    }
    // Namespaced function: A::B := fn(...) — mangle name + register in namespace scope
    if (decl.kind === 'NamespacedDecl' && decl.inner.kind === 'FuncDecl') {
      try {
        const mangledName = decl.segments.join('__');
        decl.inner.name = mangledName;
        const fd = decl.inner;
        const paramTypes = fd.params.map(p => {
          try { return tc.resolveType(p.typeAnnot, p); } catch { return p.typeAnnot; }
        });
        let returnType;
        try { returnType = tc.resolveType(fd.returnType, fd); } catch { returnType = fd.returnType; }
        const funcType = { name: '__func__', mut: false, returnType, paramTypes, _mangledName: mangledName };
        tc.scope.defineQualified(decl.segments, funcType, 'func', false, fd.line);
        fd._type = funcType;
      } catch (e) {
        ast.typeErrors.push(e);
      }
    }
    // extern! runtime import: name : fn(...) T = extern!("module.field");
    if (decl.kind === 'VarDecl' && decl.value?.kind === 'RuntimeImportExpr') {
      try {
        const rie = decl.value;
        if (!decl.typeAnnot) throw new TypeError(`extern! declaration requires an explicit function type annotation`, decl);
        const funcType = tc.resolveType(decl.typeAnnot, decl);
        if (!isFunc(funcType)) throw new TypeError(`extern! type annotation must be a function type`, decl);
        tc._runtimeImports ??= new Set();
        const importKey = `${rie.module}.${rie.field}`;
        if (tc._runtimeImports.has(importKey)) throw new TypeError(`Duplicate extern! declaration for '${importKey}'`, decl);
        tc._runtimeImports.add(importKey);
        const mangledName = tc._filePrefix ? `${tc._filePrefix}__${decl.name}` : decl.name;
        Object.assign(funcType, { _isRuntimeImport: true, _wasmModule: rie.module, _wasmField: rie.field, _mangledName: mangledName });
        tc.scope.define(decl.name, funcType, 'func', false, decl.line);
        decl._type = funcType;
        decl._isRuntimeImport = true;
      } catch (e) {
        ast.typeErrors.push(e);
      }
    }
  }

  // Pass 1b: register struct names as placeholders (resilient)
  for (const decl of ast.body) {
    if (decl.kind !== 'StructDecl') continue;
    try {
      const placeholder = { kind: 'StructType', name: decl.name, fields: [], byteSize: 0, fieldOffsets: new Map() };
      tc.scope.define(decl.name, placeholder, 'struct', false, decl.line);
      decl._type = placeholder;
    } catch (e) {
      ast.typeErrors.push(e);
    }
  }

  // Pass 2: check each declaration; per-stmt errors are collected via tc.errors
  for (const decl of ast.body) {
    try {
      tc.checkDecl(decl);
    } catch (e) {
      ast.typeErrors.push(e);
      // Reset scope/state in case pushScope/popScope got out of sync
      tc.scope = tc.globalScope;
      tc.currentReturnType = null;
      tc.loopDepth = 0;
    }
  }

  return ast;
}
