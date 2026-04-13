// ─────────────────────────────────────────────────────────────────────────────
// wat-serializer.js — S-expr tree → WAT text + TextSpan[]
//
// Export: watToText(module, sSpans) → { text: string, spans: TextSpan[] }
// TextSpan = { watStart: number, watEnd: number, astNode: object }
// ─────────────────────────────────────────────────────────────────────────────

// watToText(module, sSpans) → { text: string, spans: TextSpan[] }
export function watToText(module, sSpans) {
  const lines      = [];
  let   charPos    = 0;
  const spanStarts = new Map();
  const spans      = [];

  // Build O(1) lookup maps from node → SSpan[] to replace O(N) linear scans.
  const spansByNode       = new Map();  // SExprNode → SSpan[]  (for markStart/markEnd)
  const spansByParentIdx  = new Map();  // `${nodeId}:${childIdx}` → SSpan[]
  const nodeIds           = new WeakMap();
  let   nextNodeId        = 0;
  function nodeId(n) {
    if (!nodeIds.has(n)) nodeIds.set(n, nextNodeId++);
    return nodeIds.get(n);
  }
  for (const ss of sSpans) {
    if (ss.node != null) {
      if (!spansByNode.has(ss.node)) spansByNode.set(ss.node, []);
      spansByNode.get(ss.node).push(ss);
    }
    // Index under BOTH startIdx and endIdx so markChildStart/markChildEnd can find spans.
    if (ss.startIdx != null) {
      const key = `${nodeId(ss.node)}:${ss.startIdx}`;
      if (!spansByParentIdx.has(key)) spansByParentIdx.set(key, []);
      spansByParentIdx.get(key).push(ss);
    }
    if (ss.endIdx != null) {
      const key = `${nodeId(ss.node)}:${ss.endIdx}`;
      if (!spansByParentIdx.has(key)) spansByParentIdx.set(key, []);
      spansByParentIdx.get(key).push(ss);
    }
  }

  function emit(line) {
    lines.push(line);
    charPos += line.length + 1; // +1 for '\n'
  }

  function markStart(node) {
    for (const ss of (spansByNode.get(node) ?? [])) {
      if (!spanStarts.has(ss)) spanStarts.set(ss, charPos);
    }
  }
  function markEnd(node) {
    for (const ss of (spansByNode.get(node) ?? [])) {
      if (spanStarts.has(ss)) {
        spans.push({ watStart: spanStarts.get(ss), watEnd: charPos, astNode: ss.astNode });
        spanStarts.delete(ss);
      }
    }
  }
  function markChildStart(parentNode, childIndex) {
    const key = `${nodeId(parentNode)}:${childIndex}`;
    for (const ss of (spansByParentIdx.get(key) ?? [])) {
      if (ss.startIdx === childIndex && !spanStarts.has(ss)) spanStarts.set(ss, charPos);
    }
  }
  function markChildEnd(parentNode, childIndex) {
    const key = `${nodeId(parentNode)}:${childIndex}`;
    for (const ss of (spansByParentIdx.get(key) ?? [])) {
      if (ss.endIdx === childIndex && spanStarts.has(ss)) {
        spans.push({ watStart: spanStarts.get(ss), watEnd: charPos, astNode: ss.astNode });
        spanStarts.delete(ss);
      }
    }
  }

  // Emit instructions as tracked children of parentNode.
  // firstChildIdx = S-expr index of instrs[0] inside parentNode (accounts for tag + name prefix).
  function serChildren(parentNode, firstChildIdx, instrs, depth) {
    for (let j = 0; j < instrs.length; j++) {
      markChildStart(parentNode, firstChildIdx + j);
      serInstr(instrs[j], depth);
      markChildEnd(parentNode, firstChildIdx + j + 1);
    }
  }

  serNode(module, 0);
  return { text: lines.join('\n'), spans };

  // ── recursive serialiser ─────────────────────────────────────────────────

  function serNode(node, depth) {
    if (!Array.isArray(node)) { emit(ind(depth) + String(node)); return; }
    const [tag, ...rest] = node;
    if (tag !== 'func') markStart(node);
    switch (tag) {
      case 'module':          serModule(rest, depth);        break;
      case 'type':            serType(rest, depth);          break;
      case 'import':          serImport(rest, depth);        break;
      case 'memory':          serMemory(rest, depth);        break;
      case 'table':           serTable(rest, depth);         break;
      case 'elem':            serElem(rest, depth);          break;
      case 'global':          serGlobal(rest, depth);        break;
      case 'export':          serExport(rest, depth);        break;
      case 'func':            serFunc(node, depth);          break;
      case 'if':              serIf(rest, depth);            break;
      case 'block':           serBlock(rest, depth);         break;
      case 'then': case 'else':
        for (const child of rest) serInstr(child, depth);   break;
      default:                serInstr(node, depth);         break;
    }
    if (tag !== 'func') markEnd(node);
  }

  function ind(d) { return ' '.repeat(d); }

  function serModule(children, depth) {
    emit(ind(depth) + '(module');
    for (const child of children) serNode(child, depth + 2);
    emit(ind(depth) + ')');
  }

  function serType(args, depth) {
    const [name, funcNode] = args;
    const [, ...funcArgs]  = funcNode;
    const parts = funcArgs.map(a => `(${a.join(' ')})`).join(' ');
    emit(ind(depth) + `(type ${name} (func${parts ? ' ' + parts : ''}))`);
  }

  function serImport(args, depth) {
    const [mod, field, funcNode] = args;
    const [, fname, ...sig]      = funcNode;
    const parts = sig.map(a => `(${a.join(' ')})`).join(' ');
    emit(ind(depth) + `(import "${mod}" "${field}" (func ${fname}${parts ? ' ' + parts : ''}))`);
  }

  function serMemory(args, depth) {
    emit(ind(depth) + `(memory ${args.join(' ')})`);
  }

  function serTable(args, depth) {
    emit(ind(depth) + `(table ${args.join(' ')})`);
  }

  function serElem(args, depth) {
    const parts = args.map(a => Array.isArray(a) ? `(${a.join(' ')})` : a).join(' ');
    emit(ind(depth) + `(elem ${parts})`);
  }

  function serGlobal(args, depth) {
    const [name, mutNode, initNode] = args;
    const mutStr  = `(${mutNode.join(' ')})`;
    const initStr = `(${initNode.join(' ')})`;
    emit(ind(depth) + `(global ${name} ${mutStr} ${initStr})`);
  }

  function serExport(args, depth) {
    const [nameStr, ref] = args;
    emit(ind(depth) + `(export "${nameStr}" (${ref.join(' ')}))`);
  }

  function serFunc(node, depth) {
    markChildStart(node, 0); // FuncDecl-level span start — covers the full (func ...) block
    const [, fname, ...rest] = node;
    emit(ind(depth) + `(func ${fname}`);
    const paramDepth = depth + 2;
    let instrStart = 0;
    for (let i = 0; i < rest.length; i++) {
      const item = rest[i];
      if (!Array.isArray(item)) { instrStart = i; break; }
      const tag = item[0];
      if (tag === 'param' || tag === 'result' || tag === 'local') {
        emit(ind(paramDepth) + `(${item.join(' ')})`);
      } else {
        instrStart = i;
        break;
      }
    }
    // instrStart + 2: rest = node.slice(2), so rest[instrStart] = node[instrStart + 2]
    serChildren(node, instrStart + 2, rest.slice(instrStart), paramDepth);
    emit(ind(depth) + ')');
    markChildEnd(node, node.length); // FuncDecl-level span end
  }

  function serIf(args, depth) {
    // args = ['i32'?, thenNode, elseNode?]
    // (if (result T)? (then ...) (else ...)?)
    let idx = 0;
    let resultStr = '';
    if (typeof args[0] === 'string') { resultStr = ` (result ${args[0]})`; idx++; }
    const thenNode = args[idx];
    const elseNode = args[idx + 1];
    emit(ind(depth) + `(if${resultStr}`);
    if (thenNode) {
      emit(ind(depth + 2) + '(then');
      serChildren(thenNode, 1, thenNode.slice(1), depth + 4);
      emit(ind(depth + 2) + ')');
    }
    if (elseNode) {
      emit(ind(depth + 2) + '(else');
      serChildren(elseNode, 1, elseNode.slice(1), depth + 4);
      emit(ind(depth + 2) + ')');
    }
    emit(ind(depth) + ')');
  }

  function serBlock(args, depth) {
    emit(ind(depth) + '(block');
    for (const child of args) serInstr(child, depth + 2);
    emit(ind(depth) + ')');
  }

  function serInstr(node, depth) {
    if (!Array.isArray(node)) { emit(ind(depth) + String(node)); return; }
    const [tag, ...rest] = node;
    switch (tag) {
      case 'if':    { serNode(node, depth); return; }
      case 'block': { serNode(node, depth); return; }
      case 'loop':  {
        emit(ind(depth) + '(loop');
        serChildren(node, 1, rest, depth + 2);
        emit(ind(depth) + ')');
        return;
      }
      case 'then': case 'else': {
        emit(ind(depth) + `(${tag}`);
        for (const child of rest) serInstr(child, depth + 2);
        emit(ind(depth) + ')');
        return;
      }
      default: {
        const args = rest.map(a => Array.isArray(a) ? `(${a.join(' ')})` : String(a));
        emit(ind(depth) + `(${tag}${args.length ? ' ' + args.join(' ') : ''})`);
      }
    }
  }
}
