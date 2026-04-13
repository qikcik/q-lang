// ─────────────────────────────────────────────────────────────────────────────
// ide/hover.js — Hover tooltip data, static keyword hints, macro details
//
// Exports:
//   HINTS                               — { [key]: { label, detail } }
//   buildHoverData(tokens, ast, expansionLog?, posOf?) → HoverEntry[]
//
// HoverEntry: { start: number, end: number, label: string, detail: string, _astNode?: node }
// ─────────────────────────────────────────────────────────────────────────────

import { typeStr } from '../compiler/staticTypeChecker.js';

// ── Static hover hints ────────────────────────────────────────────────────────

export const HINTS = {

  // ── Language keywords ───────────────────────────────────────────────────────

  as:     { label: 'as<T>(expr)',      detail: 'scalar type converter: produces a temporary value; works only on numeric and bool types' },
  fn:     { label: 'fn(params) Ret',   detail: 'function definition' },
  if:     { label: 'if (cond)',        detail: 'execute block when condition is true' },
  else:   { label: 'else',            detail: 'alternative branch of if' },
  while:  { label: 'while (cond)',     detail: 'repeat block while condition is true' },
  break:  { label: 'break',           detail: 'exit the innermost loop immediately' },
  return: { label: 'return expr',     detail: 'return a value from the current function' },
  void:   { label: 'void',            detail: 'function return type indicating no value is returned' },
  mut:    { label: 'mut T',           detail: 'marks a variable or type as mutable' },
  ptr:    { label: 'ptr<T>',          detail: 'raw pointer to a value of type T in linear memory (i32 address)' },
  array:  { label: 'array<T, N>',     detail: 'native raw sequential array with constant compile-time size N' },

  // ── Scalar types ────────────────────────────────────────────────────────────

  i8:   { label: 'i8',   detail: '8-bit signed integer  [-128 .. 127]' },
  u8:   { label: 'u8',   detail: '8-bit unsigned integer  [0 .. 255]' },
  i16:  { label: 'i16',  detail: '16-bit signed integer  [-32768 .. 32767]' },
  u16:  { label: 'u16',  detail: '16-bit unsigned integer  [0 .. 65535]' },
  i32:  { label: 'i32',  detail: '32-bit signed integer' },
  u32:  { label: 'u32',  detail: '32-bit unsigned integer' },
  i64:  { label: 'i64',  detail: '64-bit signed integer' },
  u64:  { label: 'u64',  detail: '64-bit unsigned integer' },
  f32:  { label: 'f32',  detail: '32-bit IEEE 754 float — == and != are forbidden; use ordered comparisons or an epsilon check' },
  f64:  { label: 'f64',  detail: '64-bit IEEE 754 float' },
  bool: { label: 'bool', detail: 'boolean: true or false' },

  // ── Macro system ────────────────────────────────────────────────────────────

  macro:  { label: 'macro(params) { body }', detail: 'hygienic macro definition; body is a token template expanded at each call site' },
  defer:  { label: 'defer expr;',             detail: 'registers expr to be evaluated at the end of the enclosing function scope (reverse order)' },
  struct: { label: 'struct { fields }',       detail: 'declares a named product type; fields are const by default, mark with mut to allow writes; passed as i32 base address' },
  namespace: { label: 'namespace',             detail: 'declares or aliases a namespace scope for organizing declarations' },

  // ── Macro parameter kinds ───────────────────────────────────────────────────

  expr:  { label: 'expr',  detail: 'macro param kind // accepts any value expression (not block, not type); substituted as (@param) with safe precedence' },
  ident: { label: 'ident', detail: 'macro param kind // requires a bare identifier; substituted raw — valid as declaration target or l-value' },
  block: { label: 'block', detail: 'macro param kind // accepts a { ... } block; substituted as a statement' },
  type:  { label: 'type',  detail: 'macro param kind // accepts a type expression (i32, array<u8,N>, ...); substituted in type position' },
  any:   { label: 'any',   detail: 'macro param kind // accepts everything — expr, block, type, or ident; substituted raw' },
  pack:  { label: 'pack',  detail: 'macro param kind // accepts a [...] pack literal of homogeneous values; iterate with unpack!(vals, elem, { body })' },

  // ── Macro markers ───────────────────────────────────────────────────────────

  $:   { label: '$name',  detail: 'macro gensym - private variable renamed to a unique name per expansion to avoid scope collisions' },
  '@': { label: '@param', detail: 'macro parameter reference - substituted with the argument provided at the call site' },
  '#': { label: '#param', detail: 'macro stringify - produces the source text of the argument as an array<u8, N> literal' },

  // ── Type constructors (::-syntax) ───────────────────────────────────────────

  'T::of':      { label: 'T::of(value)',  detail: 'create a value of type T from the given value; performs conversion if needed' },
  'T::default': { label: 'T::default',   detail: 'zero/default value of type T (0 for integers, 0.0 for floats, false for bool)' },
};

// ── Macro param expand detail ─────────────────────────────────────────────────

function macroParamExpandDetail(kind, name) {
  switch (kind) {
    case 'expr':  return `expr param — tokens substituted with ( arg ) for safe operator precedence (parens at token level, not visible in expanded AST view)`;
    case 'ident': return `expands to ${name}  —  raw substitution, valid as declaration target or l-value`;
    case 'block': return `spliced raw as a statement block { ... }`;
    case 'type':  return `expands to ${name}  —  raw substitution in type annotation position`;
    case 'any':   return `expands to ${name}  —  raw, unconstrained (expr, block, type, or ident)`;
    default:
      if (kind === 'pack' || kind.startsWith('pack<'))
        return `iterate elements with:  unpack!(@${name}, elem, { body })`;
      return `macro parameter reference (kind: ${kind})`;
  }
}

// ── Hover data builder ────────────────────────────────────────────────────────

/**
 * Build hover tooltip data from token + AST information.
 *
 * posOf(node) → {start, end}  — maps AST nodes to character offsets.
 *   Default: uses node.start/node.end (main editor source offsets).
 *   For virtual files (macro panels): pass  n => ({start: n.start_gen ?? n.start, end: n.end_gen ?? n.end})
 *
 * For token-based hints the tokens array should already be in the same
 * coordinate space as posOf() (main tokens  or  virtualFile.tokens).
 */
export function buildHoverData(tokens, ast, expansionLog = null, posOf = null) {
  const getPos = posOf ?? (n => ({ start: n.start, end: n.end }));
  const isMainSource = posOf == null;
  const entries = [];
  const macroBodies = [];

  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    // For main-source hover: template-derived macro nodes must NOT produce entries
    // (their coordinates live in the virtual file, not main), but we still recurse
    // into them to reach call-site block-arg nodes that are nested inside.
    // A node is "from the call site" when its original start offset falls within
    // the macro call-statement range recorded in the SourceBuffer's callSite.
    if (isMainSource && node.__src && node.__src.kind === 'macro') {
      const cs = node.__src.callSite;
      const isFromCallSite =
        cs != null && node.start != null &&
        node.start >= cs.start && node.start <= cs.end;
      if (!isFromCallSite) {
        // Template-derived: keep recursing to find block-arg descendants.
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object' && v !== node) walk(v);
        }
        return;
      }
      // Block-arg (call-site origin): fall through to normal handling below.
    }

    // MacroDecl handled outside _type check (MacroDecl has no _type)
    if (node.kind === 'MacroDecl') {
      const sig = (node.params ?? []).map(p => `${p.name}: ${p.paramKind}`).join(', ');
      entries.push({
        start:    node.start,
        end:      node.start + node.name.length,
        label:    `${node.name} : macro(${sig})`,
        detail:   'macro declaration',
        _astNode: node,
      });
      // Hover on the `kind` keyword inside each macro parameter declaration
      for (const mp of node.params ?? []) {
        if (mp.kindStart != null && mp.kindEnd != null) {
          const baseKind = mp.paramKind.startsWith('pack<') ? 'pack' : mp.paramKind;
          const hint = HINTS[baseKind];
          if (hint) {
            entries.push({
              start:    mp.kindStart,
              end:      mp.kindEnd,
              label:    mp.paramKind,
              detail:   hint.detail,
              _astNode: node,
            });
          }
        }
      }
      // Register body range so @param tokens inside the body get rich hover
      if (node.body) {
        macroBodies.push({
          start:    node.body.start,
          end:      node.body.end,
          paramMap: new Map((node.params ?? []).map(p => [p.name, p])),
          macroName: node.name,
        });
      }
    }

    // NamespaceDecl: std := namespace; | gfx := namespace Engine::Graphics;
    if (node.kind === 'NamespaceDecl') {
      const p = getPos(node);
      const targetStr = node.target ? ` → ${node.target.join('::')}` : '';
      entries.push({
        start:    p.start,
        end:      p.start + node.name.length,
        label:    `${node.name} : namespace`,
        detail:   node.target ? `alias for ${node.target.join('::')}` : 'namespace declaration',
        _astNode: node,
      });
    }

    // NamespacedDecl: std::foo := fn() i32 { ... };
    if (node.kind === 'NamespacedDecl') {
      const p = getPos(node);
      const qualName = node.segments.join('::');
      const innerType = node.inner?._type ? typeStr(node.inner._type) : '';
      entries.push({
        start:    p.start,
        end:      p.start + qualName.length + (node.segments.length - 1) * 2, // approx: include ::
        label:    qualName,
        detail:   innerType || node.inner?.kind || 'namespaced declaration',
        _astNode: node,
      });
    }

    // QualifiedName: std::foo(), i32::of(42), Player::default
    if (node.kind === 'QualifiedName' && node._type) {
      const p = getPos(node);
      const qualName = node.segments.join('::');
      entries.push({
        start:    p.start,
        end:      p.end,
        label:    qualName,
        detail:   typeStr(node._type),
        _astNode: node,
      });
    }

    if (node._type) {
      switch (node.kind) {
        case 'Identifier':
        case 'VarDecl':
        case 'FuncDecl':
        case 'Param': {
          const p = getPos(node);
          entries.push({
            start: p.start,
            end:   p.start + node.name.length,
            label: node.name,
            detail: typeStr(node._type),
            _astNode: node,
          });
          // Type annotation hover (e.g. "Point" in `p: Point` or `x : Point = ...`)
          if (node._typeAnnotStart != null && node._type) {
            const ty = node._type;
            let detail;
            if (ty.kind === 'StructType') {
              const fields = (ty.fields ?? []).map(
                f => `${f.mut ? 'mut ' : ''}${f.name}: ${typeStr(f.type)}`
              ).join(', ');
              detail = fields ? `struct { ${fields} }  (${ty.byteSize} bytes)` : 'struct { }';
            } else {
              detail = typeStr(ty);
            }
            entries.push({
              start: node._typeAnnotStart,
              end:   node._typeAnnotEnd,
              label: typeStr(ty),
              detail,
              _astNode: node,
            });
          }
          break;
        }
        case 'StructDecl': {
          const p = getPos(node);
          const fields = (node._type.fields ?? []).map(
            f => `${f.mut ? 'mut ' : ''}${f.name}: ${typeStr(f.type)}`
          ).join(', ');
          entries.push({
            start: p.start,
            end:   p.start + node.name.length,
            label: `${node.name} : struct`,
            detail: fields ? `{ ${fields} }  (${node._type.byteSize} bytes)` : '{ }',
            _astNode: node,
          });
          break;
        }
        case 'StructField': {
          const p = getPos(node);
          entries.push({
            start: p.start,
            end:   p.start + node.name.length,
            label: node.name,
            detail: (node.mut ? 'mut ' : '') + typeStr(node._type)
              + (node.defaultValue != null ? '  (has default)' : ''),
            _astNode: node,
          });
          // Type annotation hover for struct-typed fields
          if (node._typeAnnotStart != null && node._type?.kind === 'StructType') {
            const ty = node._type;
            const fields = (ty.fields ?? []).map(
              f => `${f.mut ? 'mut ' : ''}${f.name}: ${typeStr(f.type)}`
            ).join(', ');
            entries.push({
              start: node._typeAnnotStart,
              end:   node._typeAnnotEnd,
              label: typeStr(ty),
              detail: fields ? `struct { ${fields} }  (${ty.byteSize} bytes)` : 'struct { }',
              _astNode: node,
            });
          }
          break;
        }
        case 'UnaryExpr':
          if (node.op === '*' && node.opStart != null) {
            const p = posOf ? getPos(node) : { start: node.opStart, end: node.end };
            entries.push({ start: p.start, end: p.end, label: '.*', detail: typeStr(node._type), _astNode: node });
          }
          break;
        case 'MemberExpr':
          if (node.dotStart != null) {
            const detail = node.member === 'size' && node._arraySize != null
              ? `u32  =  ${node._arraySize}`
              : typeStr(node._type);
            const p = posOf ? getPos(node) : { start: node.dotStart, end: node.end };
            entries.push({ start: p.start, end: p.end, label: '.' + node.member, detail, _astNode: node });
          }
          break;
      }
    }
    // In macro panel: add MacroExpansionNode hover entries and stop recursion.
    // Inner nodes live in a different coordinate space (their own virtual file)
    // so they must not contribute hover entries to the outer panel.
    if (!isMainSource && node.kind === 'MacroExpansionNode') {
      const p = getPos(node);
      if (p.start != null && p.end != null && p.start < p.end) {
        entries.push({
          start:    p.start,
          end:      p.end,
          label:    node.macroName + '!(…)',
          detail:   'nested macro expansion — click to inspect',
          _astNode: node,
        });
      }
      return;  // do not recurse — inner nodes belong to the sub-panel
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v !== node) walk(v);
    }
  })(ast);

  for (const tok of tokens) {
    if (tok.type === 'KEYWORD' || (tok.type === 'IDENT' && HINTS[tok.value])) {
      const hint = HINTS[tok.value];
      if (hint) entries.push({ start: tok.start, end: tok.end, label: hint.label, detail: hint.detail });
    }
    if (tok.type === 'MACRO_PARAM') {
      const bare    = tok.value.slice(1);  // strip leading '@'
      const bodyCtx = macroBodies.find(b => tok.start >= b.start && tok.end <= b.end);
      const param   = bodyCtx?.paramMap.get(bare);
      if (param) {
        entries.push({
          start: tok.start, end: tok.end,
          label:  `@${bare}: ${param.paramKind}`,
          detail: macroParamExpandDetail(param.paramKind, bare),
        });
      } else {
        const hint = HINTS['@'];
        entries.push({ start: tok.start, end: tok.end, label: tok.value, detail: hint?.detail ?? 'macro parameter reference' });
      }
    }
    if (tok.type === 'MACRO_VAR') {
      const hint = HINTS['$'];
      entries.push({ start: tok.start, end: tok.end, label: tok.value, detail: hint?.detail ?? 'macro gensym' });
    }
    if (tok.type === 'MACRO_STRINGIFY') {
      const label = tok.value;
      if (label !== '#expand') {
        const hint = HINTS['#'];
        entries.push({ start: tok.start, end: tok.end, label, detail: hint?.detail ?? 'macro stringify' });
      }
    }
  }

  if (expansionLog) {
    for (const [, info] of expansionLog) {
      entries.push({
        start:  info.callStart,
        end:    info.callStart + info.name.length,
        label:  `${info.name} : macro(${info.macroSig})`,
        detail: 'macro call',
      });
      entries.push({
        start:  info.callStart,
        end:    info.end,
        label:  info.name + '!',
        detail: `macro(${info.macroSig})`,
      });
      for (const arg of (info.args ?? [])) {
        const kindHint = HINTS[arg.paramKind];
        entries.push({
          start:  arg.start,
          end:    arg.end,
          label:  `@${arg.paramName}: ${arg.paramKind}`,
          detail: kindHint?.detail ?? `macro parameter kind: ${arg.paramKind}`,
        });
      }
    }
  }

  return entries;
}
