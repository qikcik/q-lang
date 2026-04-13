// ─────────────────────────────────────────────────────────────────────────────
// ast-to-source.js  — QLang AST → formatted source text (+ position mapping)
//
// Architecture: cursor-based emit — all functions write to a Cursor that
// tracks character positions and records a span per AST node.  This allows
// building hover data and highlight ranges over virtual (macro-expanded) files
// without any second-pass string search.
//
// Public API:
//   stmtsToSourceMapped(stmts, indent?) → { text, nodeSpans: Map<ASTNode,{start,end}> }
//   stmtsToSource(stmts, indent?)       → string   (convenience — discards spans)
//   nodeToSource(node,  indent?)        → string
// ─────────────────────────────────────────────────────────────────────────────

const IND = '    ';  // 4-space indent unit

// ── Cursor ────────────────────────────────────────────────────────────────────
//
// Accumulates text and records per-node character spans.
// span.start is always the first code character of the node (AFTER leading
// whitespace/indentation, which is emitted before calling cursor.span).
// This keeps hover math simple: for `x: i32 = 5;` at indent 1, the VarDecl
// node's start_gen points to 'x', not to the leading spaces.

class Cursor {
  constructor() {
    this._parts = [];
    this._pos   = 0;
    this.spans  = new Map();   // ASTNode → { start, end }
  }
  write(str) {
    if (str) { this._parts.push(str); this._pos += str.length; }
    return this;
  }
  get pos() { return this._pos; }
  text()    { return this._parts.join(''); }

  /** Wrap the text emitted by `fn` in a span attributed to `node`. */
  span(node, fn) {
    const s = this._pos;
    fn();
    if (node && typeof node === 'object') {
      this.spans.set(node, { start: s, end: this._pos });
    }
  }
}

// ── Types (pure — type nodes have no hover entries, no spans needed) ──────────

function typeToSource(t) {
  if (!t) return '?';
  const m = t.mut ? 'mut ' : '';
  switch (t.kind) {
    case 'Type':      return m + t.name;
    case 'PtrType':   return m + `ptr<${typeToSource(t.inner)}>`;
    case 'ArrayType': return m + `array<${typeToSource(t.elemType)}, ${t.size}>`;
    case 'FuncType': {
      const ps = (t.paramTypes ?? []).map(typeToSource).join(', ');
      return m + `fn(${ps}) ${typeToSource(t.returnType)}`;
    }
    default: return t.name ?? '?';
  }
}

// ── Binary operator precedence ────────────────────────────────────────────────

const PREC = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4,  '-': 4,
  '*': 5,  '/': 5,  '%': 5,
};
function needsParens(child, parentOp) {
  if (child.kind !== 'BinaryExpr') return false;
  return (PREC[child.op] ?? 9) < (PREC[parentOp] ?? 9);
}

// ── Cursor-based emitters ─────────────────────────────────────────────────────

function emitExpr(e, cursor) {
  if (!e) { cursor.write('?'); return; }
  cursor.span(e, () => {
    switch (e.kind) {
      case 'Literal': {
        if (e.isChar) {
          const cv = e.value;
          const ch = cv === 39  ? "\\'"
                   : cv === 92  ? '\\\\'
                   : cv === 10  ? '\\n'
                   : cv === 13  ? '\\r'
                   : cv === 9   ? '\\t'
                   : cv === 0   ? '\\0'
                   : cv >= 32 && cv < 127 ? String.fromCharCode(cv)
                   : `\\x${cv.toString(16).padStart(2, '0')}`;
          cursor.write(`'${ch}'`);
        } else {
          cursor.write(String(e.value));
        }
        break;
      }
      case 'Identifier':
      case 'TypeRef':
        cursor.write(e.name); break;
      case 'StringLiteral':
        cursor.write('"' + e.value
          .replace(/\\/g, '\\\\').replace(/"/g,  '\\"')
          .replace(/\n/g, '\\n') .replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"');
        break;
      case 'ArrayLiteral':
        cursor.write('{');
        e.elements.forEach((el, i) => { if (i) cursor.write(', '); emitExpr(el, cursor); });
        cursor.write('}'); break;
      case 'BinaryExpr': {
        const lp = needsParens(e.left,  e.op);
        const rp = needsParens(e.right, e.op);
        if (lp) cursor.write('('); emitExpr(e.left,  cursor); if (lp) cursor.write(')');
        cursor.write(` ${e.op} `);
        if (rp) cursor.write('('); emitExpr(e.right, cursor); if (rp) cursor.write(')');
        break;
      }
      case 'UnaryExpr':
        if (e.op === '*') { emitExpr(e.operand, cursor); cursor.write('.*'); }
        else              { cursor.write(e.op); emitExpr(e.operand, cursor); }
        break;
      case 'CallExpr':
        emitExpr(e.callee, cursor); cursor.write('(');
        (e.args ?? []).forEach((a, i) => { if (i) cursor.write(', '); emitExpr(a, cursor); });
        cursor.write(')'); break;
      case 'BracketAccessExpr':
        emitExpr(e.base, cursor); cursor.write('.['); emitExpr(e.index, cursor); cursor.write(']'); break;
      case 'PackLiteral':
        cursor.write('[');
        (e.elements ?? []).forEach((el, i) => { if (i) cursor.write(', '); emitExpr(el, cursor); });
        cursor.write(']'); break;
      case 'MemberExpr':
        emitExpr(e.obj, cursor); cursor.write('.' + e.member); break;
      case 'AsExpr':
        emitExpr(e.expr, cursor); cursor.write(` as<${typeToSource(e.asType)}>`); break;
      case 'QualifiedName':
        cursor.write(e.segments.join('::'));
        if (e.args !== null && e.args !== undefined) {
          cursor.write('(');
          e.args.forEach((a, i) => { if (i) cursor.write(', '); emitExpr(a, cursor); });
          cursor.write(')');
        }
        break;
      case 'MacroVarExpr':
      case 'MacroParamExpr':
      case 'MacroStringifyExpr':
        cursor.write(e.name); break;
      default:
        cursor.write(`/* expr:${e.kind} */`);
    }
  });
}

function emitBlock(block, indent, cursor) {
  if (!block?.body?.length) { cursor.write('{}'); return; }
  const pad = IND.repeat(indent);
  cursor.write('{\n');
  emitStmtList(block.body, indent + 1, cursor);
  cursor.write(`\n${pad}}`);
}

// Indentation is emitted BEFORE cursor.span() so that node.start_gen points
// to the first code character (not whitespace).  This keeps hover ranges clean.
function emitStmt(s, indent, cursor) {
  const pad = IND.repeat(indent);
  switch (s.kind) {
    case 'VarDecl':
      cursor.write(pad);
      cursor.span(s, () => {
        if (s.typeAnnot) {
          cursor.write(`${s.name}: ${typeToSource(s.typeAnnot)}`);
          if (s.value) { cursor.write(' = '); emitExpr(s.value, cursor); }
        } else {
          cursor.write(s.name);
          if (s.value) { cursor.write(' := '); emitExpr(s.value, cursor); }
        }
        cursor.write(';');
      }); break;

    case 'FuncDecl': {
      const params = (s.params ?? []).map(p => `${p.name}: ${typeToSource(p.typeAnnot)}`).join(', ');
      const retT   = s.returnType ? typeToSource(s.returnType) : 'void';
      cursor.write(pad);
      cursor.span(s, () => {
        cursor.write(`${s.name} := fn(${params}) ${retT} `);
        emitBlock(s.body, indent, cursor);
      }); break;
    }

    case 'ReturnStmt':
      cursor.write(pad);
      cursor.span(s, () => {
        if (s.value !== null && s.value !== undefined) {
          cursor.write('return '); emitExpr(s.value, cursor); cursor.write(';');
        } else {
          cursor.write('return;');
        }
      });
      break;

    case 'ExprStmt':
      cursor.write(pad);
      cursor.span(s, () => { emitExpr(s.expr, cursor); cursor.write(';'); });
      break;

    case 'AssignStmt':
      cursor.write(pad);
      cursor.span(s, () => {
        emitExpr(s.target, cursor); cursor.write(' = '); emitExpr(s.value, cursor); cursor.write(';');
      }); break;

    case 'IfStmt':
      cursor.write(pad);
      cursor.span(s, () => {
        cursor.write('if (');
        cursor.span(s.condition, () => emitExpr(s.condition, cursor));
        cursor.write(') ');
        emitBlock(s.then, indent, cursor);
        if (s.elseBranch) { cursor.write(' else '); emitBlock(s.elseBranch, indent, cursor); }
      }); break;

    case 'WhileStmt':
      cursor.write(pad);
      cursor.span(s, () => {
        cursor.write('while (');
        cursor.span(s.condition, () => emitExpr(s.condition, cursor));
        cursor.write(') ');
        emitBlock(s.body, indent, cursor);
      }); break;

    case 'BreakStmt':
      cursor.write(pad);
      cursor.span(s, () => cursor.write('break;'));
      break;

    case 'DeferStmt':
      cursor.write(pad);
      cursor.span(s, () => {
        if (s.stmt) {
          if (s.stmt.kind === 'ScopeBlock') {
            cursor.write('defer ');
            emitBlock({ body: s.stmt.body }, indent, cursor);
            cursor.write(';');
          } else {
            cursor.write('defer ');
            emitExpr(s.stmt.target, cursor);
            cursor.write(' = ');
            emitExpr(s.stmt.value, cursor);
            cursor.write(';');
          }
        } else {
          cursor.write('defer ');
          emitExpr(s.expr, cursor);
          cursor.write(';');
        }
      });
      break;

    case 'ScopeBlock':
      cursor.write(pad);
      cursor.span(s, () => emitBlock({ body: s.body }, indent, cursor));
      break;

    case 'MacroExpansionNode':
      // Transparent: inline the body, but still record the node's total span.
      cursor.span(s, () => emitStmtList(s.body, indent, cursor));
      break;

    case 'MacroCallStmt':
      // Pre-expansion call site — emit name!(arg1, arg2, ...);
      cursor.write(pad);
      cursor.span(s, () => {
        cursor.write(`${s.name}!(`);
        for (let i = 0; i < s.args.length; i++) {
          if (i > 0) cursor.write(', ');
          const arg = s.args[i];
          if (arg.kind === 'block' && arg.block) {
            emitBlock(arg.block, indent, cursor);
          } else if (arg.expr) {
            emitExpr(arg.expr, cursor);
          } else {
            // Fallback: join tokens (type args etc.)
            const toks = arg.tokens ?? [];
            cursor.write(toks.filter(t => t.type !== 'EOF').map(t => t.value).join(' '));
          }
        }
        cursor.write(');');
      }); break;

    case 'ErrorNode':
      cursor.write(pad + '/* parse error */'); break;

    case 'MacroDecl':
      cursor.write(`${pad}// macro ${s.name}`); break;

    case 'NamespaceDecl':
      cursor.write(pad);
      cursor.span(s, () => {
        cursor.write(`${s.name} := namespace`);
        if (s.target) cursor.write(` ${s.target.join('::')}`);
        cursor.write(';');
      }); break;

    case 'NamespacedDecl':
      cursor.write(pad);
      cursor.span(s, () => {
        const prefix = s.segments.slice(0, -1).join('::');
        if (s.inner.kind === 'FuncDecl') {
          const fd = s.inner;
          const params = (fd.params ?? []).map(p => `${p.name}: ${typeToSource(p.typeAnnot)}`).join(', ');
          const retT   = fd.returnType ? typeToSource(fd.returnType) : 'void';
          cursor.write(`${prefix}::${s.segments[s.segments.length - 1]} := fn(${params}) ${retT} `);
          emitBlock(fd.body, indent, cursor);
        } else {
          // VarDecl
          cursor.write(`${prefix}::${s.segments[s.segments.length - 1]} := `);
          emitExpr(s.inner.value, cursor);
          cursor.write(';');
        }
      }); break;

    default:
      cursor.write(`${pad}/* ${s.kind} */`);
  }
}

function emitStmtList(stmts, indent, cursor) {
  if (!stmts?.length) return;
  stmts.forEach((s, i) => {
    if (i) cursor.write('\n');
    emitStmt(s, indent, cursor);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a list of statements to source text AND a per-node span map.
 * nodeSpans: Map<ASTNode, {start, end}> — char offsets into the returned text.
 * Used by SourceView to build hover data and highlight ranges for virtual files.
 */
export function stmtsToSourceMapped(stmts, indent = 0) {
  const cursor = new Cursor();
  emitStmtList(stmts, indent, cursor);
  return { text: cursor.text(), nodeSpans: cursor.spans };
}

/** Convert a list of statements to formatted QLang source (spans discarded). */
export function stmtsToSource(stmts, indent = 0) {
  if (!stmts?.length) return '';
  const { text } = stmtsToSourceMapped(stmts, indent);
  return text;
}

/**
 * Convert any single AST node to formatted QLang source.
 * For expression nodes, returns expression text (no trailing semicolon).
 * For statement/declaration nodes, returns the full statement.
 */
export function nodeToSource(node, indent = 0) {
  if (!node) return '';
  const cursor = new Cursor();
  const EXPR_KINDS = new Set([
    'Literal','Identifier','TypeRef','StringLiteral','ArrayLiteral',
    'BinaryExpr','UnaryExpr','CallExpr','BracketAccessExpr','PackLiteral',
    'MemberExpr','AsExpr','QualifiedName',
    'MacroVarExpr','MacroParamExpr','MacroStringifyExpr',
  ]);
  if (EXPR_KINDS.has(node.kind)) emitExpr(node, cursor);
  else emitStmt(node, indent, cursor);
  return cursor.text();
}
