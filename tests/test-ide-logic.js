// tests/test-ide-logic.js — Node.js smoke tests for IDE logic boundaries
// (no DOM required)

import { parseCanonicalRef, buildCanonicalRef, segmentLabel } from '../compiler/source-ref.js';
import { compile } from '../compiler/pipeline.js';
import { test, suite, assert } from './helpers.js';

// ── parseCanonicalRef ─────────────────────────────────────────────────────────

suite('parseCanonicalRef');

test('2-segment ref', () => {
  const segs = parseCanonicalRef('main[8:10-8:20]/macro:for_each[3:4-3:14]');
  assert(segs !== null && segs.length === 2, '2 segments parsed');
  assert(segs[0].sourceId === 'main', 'seg[0].sourceId = main');
  assert(segs[0].startLine === 8, 'seg[0].startLine = 8');
  assert(segs[0].startCol  === 10, 'seg[0].startCol = 10');
  assert(segs[0].endLine   === 8, 'seg[0].endLine = 8');
  assert(segs[0].endCol    === 20, 'seg[0].endCol = 20');
  assert(segs[1].sourceId  === 'macro:for_each', 'seg[1].sourceId = macro:for_each');
  assert(segs[1].startLine === 3, 'seg[1].startLine = 3');
  assert(segs[1].startCol  === 4, 'seg[1].startCol = 4');
  assert(segs[1].endLine   === 3, 'seg[1].endLine = 3');
  assert(segs[1].endCol    === 14, 'seg[1].endCol = 14');
});

test('single segment', () => {
  const segs = parseCanonicalRef('main[1:0-1:5]');
  assert(segs !== null && segs.length === 1, 'single segment');
  assert(segs[0].sourceId === 'main', 'sourceId = main');
});

test('empty string', () => {
  const segs = parseCanonicalRef('');
  assert(!segs || segs.length === 0, 'empty string returns empty/null');
});

test('bare label', () => {
  const segs = parseCanonicalRef('main');
  assert(segs && segs.length === 1, 'bare label parses as 1 segment');
});

test('full sourceId in segment', () => {
  const segs = parseCanonicalRef('main[1:0-1:10]/macro:for_each:main:42[3:4-3:14]');
  assert(segs && segs.length === 2, '2 segments parsed');
  assert(segs[1].sourceId === 'macro:for_each:main:42', 'full sourceId preserved');
  assert(segs[1].label    === 'macro:for_each',         'label is short form');
  assert(segs[1].startLine === 3, 'startLine ok');
});

test('3-segment full sourceIds', () => {
  const ref = 'main[1:0-1:5]/macro:outer:main:10[2:0-2:8]/macro:inner:main:20[1:0-1:4]';
  const segs = parseCanonicalRef(ref);
  assert(segs && segs.length === 3, '3 segments');
  assert(segs[0].sourceId === 'main',                   'seg0 sourceId');
  assert(segs[1].sourceId === 'macro:outer:main:10',    'seg1 full sourceId');
  assert(segs[1].label    === 'macro:outer',             'seg1 short label');
  assert(segs[2].sourceId === 'macro:inner:main:20',    'seg2 full sourceId');
  assert(segs[2].label    === 'macro:inner',             'seg2 short label');
});

// ── segmentLabel ──────────────────────────────────────────────────────────────

suite('segmentLabel');

test('label shortcuts', () => {
  assert(segmentLabel('main')                     === 'main',           'main → main');
  assert(segmentLabel('macro:for_each:main:42')   === 'macro:for_each', 'full id → short label');
  assert(segmentLabel('macro:sum_pack:main:100')  === 'macro:sum_pack', 'another macro id');
});

// ── buildCanonicalRef (via compile) ──────────────────────────────────────────

suite('buildCanonicalRef via compile + TypeError');

test('TypeError has canonicalRef', () => {
  const src = 'x : i32 = "hello";';
  let caught = null;
  try { compile(src); } catch (e) { caught = e; }
  assert(caught !== null, 'TypeError thrown for type mismatch');
  if (caught) {
    assert(typeof caught.canonicalRef === 'string', 'caught.canonicalRef is a string');
    assert(caught.canonicalRef.startsWith('main['), 'canonicalRef starts with main[');
    assert(caught.canonicalRef.includes(':'), 'canonicalRef contains line:col');
  }
});

test('single-level canonicalRef parseable', () => {
  // Single-level: main source only
  const src = 'x := 1 + "a";';
  let caught = null;
  try { compile(src); } catch (e) { caught = e; }
  if (caught?.canonicalRef) {
    const segs = parseCanonicalRef(caught.canonicalRef);
    assert(segs && segs.length >= 1, 'failed compile yields parseable canonicalRef');
  }
});

// ── Nested macro canonical ref ────────────────────────────────────────────────

suite('nested macro canonical ref chain');

test('3-level chain for nested macro type error', () => {
  const src = `
    for_each := macro(arr : expr, elem : ident, body : block) {
      $i : mut u32 = 0;
      while ($i < (@arr).size) {
        @elem := (@arr).[$i];
        @body;
        $i = $i + 1;
      }
    };
    outer := macro(arr : expr) {
      for_each!(@arr, v, {
        $bad : i32 = "not_a_number";
      });
    };
    main := fn() i32 {
      nums : array<i32, 3> = {1, 2, 3};
      outer!(nums);
      return 0;
    };
  `;
  let caught = null;
  try { compile(src); } catch (e) { caught = e; }
  assert(caught !== null, 'nested type error is thrown');
  if (caught) {
    assert(typeof caught.canonicalRef === 'string', 'canonicalRef is a string');
    const segs = parseCanonicalRef(caught.canonicalRef ?? '');
    assert(segs && segs.length === 3, `chain has 3 segments (got ${segs?.length}): ${caught.canonicalRef}`);
    if (segs && segs.length >= 1) {
      assert(segs[0].sourceId === 'main',          'first segment is main');
      assert(segs[1].label   === 'macro:outer',    'second segment is macro:outer');
      assert(segs[2].label   === 'macro:for_each', 'third segment is macro:for_each');
      // Full sourceIds must contain fileId:offset suffix
      assert(segs[1].sourceId.startsWith('macro:outer:'),    'seg1 sourceId is full (has fileId:offset)');
      assert(segs[2].sourceId.startsWith('macro:for_each:'), 'seg2 sourceId is full (has fileId:offset)');
    }
  }
});

test('inner macro __src points to inner source', () => {
  const src = `
    inner := macro(x : ident) {
      @x = @x + 1;
    };
    outer := macro(x : ident) {
      inner!(@x);
    };
    main := fn() i32 {
      n : mut i32 = 0;
      outer!(n);
      return n;
    };
  `;
  const { expLog } = compile(src);
  let innerInfo = null;
  for (const [, info] of expLog) {
    if (info.name === 'inner') { innerInfo = info; break; }
  }
  assert(innerInfo !== null, 'inner macro log entry found');
  if (innerInfo) {
    const stmt = innerInfo.expandedBody[0];
    assert(stmt?.__src?.id?.startsWith('macro:inner'), `inner node __src is inner source (got ${stmt?.__src?.id})`);
    const innerCallSiteSource = innerInfo.source?.callSite?.source;
    assert(innerCallSiteSource?.id?.startsWith('macro:outer'), `inner callSite.source is outer source (got ${innerCallSiteSource?.id})`);
  }
});
