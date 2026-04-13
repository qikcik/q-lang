// compiler/macro-unpack.js — Built-in unpack! macro
//
// Extracted from macro-expander.js.  Implements the unpack! built-in that
// iterates a pack argument, substituting the loop variable into the body
// once per element.  Each iteration body is re-parsed and recursively
// expanded via the expandStmtList callback.
//
// Exports:
//   expandUnpack(stmt, macros, ctx, expandStmtList) → MacroExpansionNode

import { Parser, ParseError }  from './parser.js';
import { TT }                  from './lexer.js';
import { MacroError }          from './macro-error.js';
import { kindCheck, splitPackElements, mkPunct } from './macro-substitute.js';
import { stmtsToSourceMapped } from './ast-to-source.js';
import { SourceBuffer }        from './source-buffer.js';
import { PACK_KIND }           from './staticAnalysis.js';

// ── unpack! parameter spec ────────────────────────────────────────────────────

const UNPACK_PARAMS = [
  { name: 'vals', paramKind: PACK_KIND },
  { name: 'iter', paramKind: 'ident'   },
  { name: 'body', paramKind: 'block'   },
];

/**
 * Expand an `unpack!(vals, iter, { body })` call.
 *
 * @param {object}   stmt           — MacroCallStmt node for unpack!
 * @param {Map}      macros         — available macro definitions
 * @param {object}   ctx            — expansion context { counter, log, fileId, source }
 * @param {function} expandStmtList — recursive expander from macro-expander.js
 * @returns {object} MacroExpansionNode
 */
export function expandUnpack(stmt, macros, ctx, expandStmtList) {
  if (stmt.args.length !== UNPACK_PARAMS.length) {
    throw new MacroError(
      `'unpack': expects 3 arg(s) (vals: pack, iter: ident, body: block), got ${stmt.args.length}`,
      stmt.line, ctx.fileId, stmt.start, stmt.end,
    );
  }
  for (let i = 0; i < stmt.args.length; i++) {
    kindCheck(stmt.args[i], UNPACK_PARAMS[i], 'unpack', stmt.line, stmt.start, stmt.end);
  }

  const [valsArg, iterArg, bodyArg] = stmt.args;

  // Diagnostic: if vals looks like a bare IDENT (not @-prefixed), the user
  // almost certainly wrote unpack!(vals, v, {...}) instead of unpack!(@vals, v, {...}).
  // Bare IDENT would silently iterate once over the token itself — wrong, not an error.
  const valsRawToks = valsArg.tokens.filter(t => t.type !== TT.EOF);
  if (
    valsArg.kind !== 'block' &&
    valsRawToks.length === 1 &&
    valsRawToks[0].type === TT.IDENT
  ) {
    const name = valsRawToks[0].value;
    throw new MacroError(
      `'unpack': pack argument '${name}' looks like a bare identifier. ` +
      `Did you mean '@${name}' (splice the macro parameter) rather than '${name}' (the literal token)?`,
      stmt.line, ctx.fileId, stmt.start, stmt.end,
    );
  }

  const packElements = splitPackElements(valsArg.tokens);
  const iterToks     = iterArg.tokens.filter(t => t.type !== TT.EOF);
  const iterName     = iterToks[0].value;
  const bodyToks     = bodyArg.tokens;
  const innerBodyToks = bodyToks.slice(1, bodyToks.length - 1);

  const eofTok = { type: TT.EOF, value: '', line: 0, col: 0, start: 0, end: 0 };

  // ── Pass 1: parse each iteration body (pre-expansion) ────────────────────
  const iterBlocks = [];
  for (const elemTokens of packElements) {
    const withIter = [];
    for (const bt of innerBodyToks) {
      if (bt.type === TT.IDENT && bt.value === iterName) {
        withIter.push(mkPunct('('));
        withIter.push(...elemTokens);
        withIter.push(mkPunct(')'));
      } else {
        withIter.push(bt);
      }
    }

    const parser = new Parser([mkPunct('{'), ...withIter, mkPunct('}'), eofTok]);
    let block;
    try {
      block = parser.parseBlock();
    } catch (e) {
      if (e instanceof ParseError) {
        throw new MacroError(
          `in expanded body of 'unpack': ${e.message}`,
          stmt.line, ctx.fileId, stmt.start, stmt.end,
        );
      }
      throw e;
    }
    iterBlocks.push(block.body);
  }

  // ── Pass 2: build a single SourceBuffer from concatenated pre-expansion stmts
  const sourceId             = `macro:unpack:${ctx.fileId}:${stmt.start}`;
  const allSubstitutedStmts  = iterBlocks.flat();
  const { text: bodyText, nodeSpans } = stmtsToSourceMapped(allSubstitutedStmts);

  const expSource = SourceBuffer.forMacro(
    sourceId, bodyText,
    { source: ctx.source, sourceId: ctx.fileId, start: stmt.start, end: stmt.end },
  );

  for (const [astNode, span] of nodeSpans) {
    astNode.__src     = expSource;
    astNode.src_start = span.start;
    astNode.src_end   = span.end;
  }

  // ── Pass 3: expand nested macro calls, sharing a single innerCtx ─────────
  // Using one shared context avoids gensym collisions across iterations.
  const innerCtx         = { ...ctx, source: expSource, fileId: sourceId };
  const expandedStatements = [];
  for (const stmts of iterBlocks) {
    expandedStatements.push(...expandStmtList(stmts, macros, innerCtx));
  }

  const macroSig = UNPACK_PARAMS.map(p => `${p.name}: ${p.paramKind}`).join(', ');
  const expansionNode = {
    kind:      'MacroExpansionNode',
    macroName: 'unpack',
    body:      expandedStatements,
    line:      stmt.line,
    start:     stmt.start,
    end:       stmt.end,
    src_start: stmt.src_start,
    src_end:   stmt.src_end,
  };

  ctx.log.set(sourceId, {
    name:         'unpack',
    end:          stmt.end,
    callLine:     stmt.line,
    callStart:    stmt.start,
    macroSig,
    bodySource:   bodyText,
    expandedBody: expandedStatements,
    expansionNode,
    source:       expSource,
    args: stmt.args.map((arg, i) => {
      const toks = arg.tokens.filter(t => t.type !== TT.EOF);
      return {
        paramName: UNPACK_PARAMS[i].name,
        paramKind: UNPACK_PARAMS[i].paramKind,
        start: toks[0]?.start ?? stmt.start,
        end:   toks[toks.length - 1]?.end ?? stmt.end,
      };
    }),
  });

  return expansionNode;
}
