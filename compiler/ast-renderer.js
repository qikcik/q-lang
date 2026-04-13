// ─────────────────────────────────────────────────────────────────────────────
// ast-renderer.js — Serialize typed AST to an interactive HTML <details> tree
// ─────────────────────────────────────────────────────────────────────────────

// Internal / bookkeeping fields — never shown in the tree
const SKIP = new Set(['kind', 'line', 'start', 'end', '_type', '_utf8Bytes', '_inferredElemType', 'error', 'errors', 'typeErrors', 'macroName', 'expandedSource', 'args', 'tokens']);

// Leaf kinds: rendered as a single compact <details> with no sub-children
const LEAF_KINDS = new Set(['Literal', 'Identifier', 'Type', 'PtrType', 'ArrayType', 'FuncType', 'StringLiteral', 'ErrorNode', 'TypeErrorNode', 'MacroParam', 'BreakStmt']);

// ── One-line label for a node ─────────────────────────────────────────────────

function nodeLabel(node) {
  switch (node.kind) {
    case 'Program':      return '';
    case 'ErrorNode': {
      const msg = node.error?.message ?? 'parse error';
      return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
    }
    case 'TypeErrorNode': {
      const msg = node.error?.message ?? 'type error';
      return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
    }
    case 'MacroExpansionNode': return `${node.macroName}!(…)`;
    case 'MacroDecl':     return node.name;  // body is a Block (shown as child)
    case 'MacroBody':     return `{ ${node.tokens?.length ?? 0} tokens }`;  // legacy — should not appear
    case 'VarDecl':      return `${node.name}${node._type?.mut ? ' [mut]' : ' [const]'}`;
    case 'Param':        return node.name;
    case 'Block':        return '';
    case 'ReturnStmt':   return '';
    case 'ExprStmt':     return '';
    case 'BinaryExpr':   return node.op;
    case 'UnaryExpr':    return node.op;
    case 'CallExpr': {
      const c = node.callee;
      if (!c) return '';
      if (c.kind === 'Identifier') return c.name;
      return nodeLabel(c);
    }
    case 'AsExpr':       return '';
    case 'Literal':      return String(node.value);
    case 'Identifier':   return node.name;
    case 'ArrayLiteral': return `[${node.elements?.length ?? 0}]`;
    case 'StringLiteral': {
      const s = node.value.length > 20 ? node.value.slice(0, 20) + '\u2026' : node.value;
      return `"${s}"`;
    }
    case 'Type':      return `${node.mut ? 'mut ' : ''}${node.name}`;
    case 'PtrType': {
      const inner = node.inner ? nodeLabel(node.inner) : '?';
      return `${node.mut ? 'mut ' : ''}ptr<${inner}>`;
    }
    case 'ArrayType': {
      const et = node.elemType ? nodeLabel(node.elemType) : '?';
      return `${node.mut ? 'mut ' : ''}array<${et}, ${node.size}>`;
    }
    case 'FuncType': {
      const params = (node.paramTypes || []).map(p => nodeLabel(p)).join(', ');
      const ret = node.returnType ? nodeLabel(node.returnType) : '?';
      return `fn(${params}) ${ret}`;
    }
    case 'FuncDecl':     return node.name;
    case 'MacroParam':   return `${node.name}: ${node.paramKind}`;
    case 'BreakStmt':    return 'break';
    case 'DeferStmt':    return 'defer';
    case 'ScopeBlock':   return '';
    case 'AssignStmt': {
      const t = node.target;
      return t?.kind === 'Identifier' ? `${t.name} =` : '=';
    }
    case 'IfStmt':       return 'if';
    case 'WhileStmt':    return 'while';
    case 'MacroCallStmt': return `${node.name}!(\u2026)`;
    case 'BracketAccessExpr': {
      const idx = node.index;
      return idx?.kind === 'Literal' ? `.[${idx.value}]` : '.[\u2026]';
    }
    case 'MemberExpr':   return `.${node.member}`;
    case 'QualifiedName':      return node.segments?.join('::') ?? '';
    case 'NamespaceDecl':     return `namespace ${node.name}${node.target ? ' → ' + node.target.join('::') : ''}`;
    case 'NamespacedDecl':    return node.segments?.join('::') ?? '';
    case 'PackLiteral':  return `[${node.elements?.length ?? 0}]`;
    default: return '';
  }
}

// ── Recursive node renderer ───────────────────────────────────────────────────

function renderNode(node, depth, fieldName) {
  if (!node || typeof node !== 'object' || !('kind' in node)) return null;

  const details = document.createElement('details');
  details.className = `ast-node ast-${node.kind}`;
  details._astNode = node;
  if (node.line  != null) details.dataset.line  = String(node.line);
  if (node.start != null) details.dataset.start = String(node.start);
  if (node.end   != null) details.dataset.end   = String(node.end);

  const isLeaf     = LEAF_KINDS.has(node.kind);
  const isFuncDecl = node.kind === 'FuncDecl';

  // Opening rules:
  //   FuncDecl   → collapsed by default (users expand manually)
  //   leaf nodes → open  (nothing to expand, single-line)
  //   depth ≤ 2  → open
  //   deeper     → closed
  details.open = !isFuncDecl && (isLeaf || depth <= 2);
  if (isLeaf) details.dataset.leaf = '';

  // ── summary ────────────────────────────────────────────────────────────────
  const summary = document.createElement('summary');

  if (fieldName) {
    const keyEl = document.createElement('span');
    keyEl.className   = 'ast-key';
    keyEl.textContent = fieldName + ': ';
    summary.appendChild(keyEl);
  }

  const kindEl = document.createElement('span');
  kindEl.className   = 'ast-kind';
  kindEl.textContent = node.kind;
  summary.appendChild(kindEl);

  const lbl = nodeLabel(node);
  if (lbl) {
    const lblEl = document.createElement('span');
    lblEl.className   = 'ast-label';
    lblEl.textContent = ' ' + lbl;
    summary.appendChild(lblEl);
  }

  details.appendChild(summary);

  // ── children ───────────────────────────────────────────────────────────────
  if (!isLeaf) {
    for (const [key, val] of Object.entries(node)) {
      if (SKIP.has(key)) continue;

      if (Array.isArray(val)) {
        for (const item of val) {
          const child = renderNode(item, depth + 1, key);
          if (child) details.appendChild(child);
        }
      } else if (val && typeof val === 'object' && 'kind' in val) {
        const child = renderNode(val, depth + 1, key);
        if (child) details.appendChild(child);
      }
    }
  }

  return details;
}

// ── Public API ────────────────────────────────────────────────────────────────

export { nodeLabel };

/**
 * Render the full AST tree into a DOM element.
 * @param   {object}      ast – the Program node returned by parse()
 * @returns {HTMLElement}
 */
export function renderAST(ast) {
  const container = document.createElement('div');
  container.className = 'ast-root';

  const typeErrors = ast.typeErrors ?? [];

  // Helper: does this error's source position fall within decl's span?
  function errorBelongsTo(e, decl) {
    if (e.node != null) {
      // Walk up from error's source node to see if it lives inside this decl
      // Using start/end containment as proxy (good enough for top-level decls)
      if (decl.start == null || decl.end == null) return false;
      const es = e.node.start ?? e.start;
      const ee = e.node.end   ?? e.end;
      if (es == null) return false;
      return es >= decl.start && (ee ?? es) <= decl.end;
    }
    if (e.start == null || decl.start == null || decl.end == null) return false;
    return e.start >= decl.start && e.start <= decl.end;
  }

  const usedErrors = new Set();

  // Render the Program node wrapper (open at top level)
  const root = renderNode(ast, 0, null);
  if (root) {
    root.open = true;
    // After each top-level-decl child, inject TypeErrorNode(s) that belong to it
    const declEls = Array.from(root.children).filter(el => el.tagName === 'DETAILS');
    declEls.forEach((declEl, i) => {
      const decl = declEl._astNode;
      if (!decl) return;
      for (const e of typeErrors) {
        if (usedErrors.has(e)) continue;
        if (errorBelongsTo(e, decl)) {
          usedErrors.add(e);
          const errNode = { kind: 'TypeErrorNode', error: e, line: e.line ?? null, start: e.start ?? null, end: e.end ?? null };
          const el = renderNode(errNode, 1, 'typeError');
          if (el) {
            el.open = true;
            // Insert directly after the decl element inside the Program details
            declEl.after(el);
          }
        }
      }
    });
    container.appendChild(root);
  }

  // Remaining errors with no matching decl (no position, or outside all decls)
  for (const e of typeErrors) {
    if (usedErrors.has(e)) continue;
    const errNode = { kind: 'TypeErrorNode', error: e, line: e.line ?? null, start: e.start ?? null, end: e.end ?? null };
    const el = renderNode(errNode, 0, 'typeError');
    if (el) { el.open = true; container.appendChild(el); }
  }

  return container;
}
