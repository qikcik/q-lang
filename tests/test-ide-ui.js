// tests/test-ide-ui.js — DOM boundary smoke tests (minimal mock, no browser)
//
// Tests the boundary between IDE logic and the DOM view.  Uses a lightweight
// mock DOM so that ide/ide-state.js, compiler/source-ref.js and navigate helper
// functions can be tested without a browser.
//
// Run: node tests/test-ide-ui.js

// ── Minimal test runner ───────────────────────────────────────────────────────

let _pass = 0, _fail = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ✔ ' + msg);
    _pass++;
  } else {
    console.error('  ✘ ' + msg);
    _fail++;
  }
}

function section(name) {
  console.log('\n── ' + name + ' ──');
}

// ── IDE state: setExpLog / getExpLog ──────────────────────────────────────────

section('ide-state');

// Import directly — no DOM needed
import('../ide/ide-state.js').then(({ setExpLog, getExpLog }) => {

  assert(getExpLog() === null, 'getExpLog initially null');

  const fakeLog = new Map([['key', { name: 'test' }]]);
  setExpLog(fakeLog);
  assert(getExpLog() === fakeLog, 'getExpLog returns the set log');

  setExpLog(null);
  assert(getExpLog() === null, 'setExpLog(null) resets to null');

  setExpLog(undefined);
  assert(getExpLog() === null, 'setExpLog(undefined) coerces to null');

// ── parseCanonicalRef: data-canonical-ref attribute simulation ─────────────────

  section('canonical-ref click simulation');

  return import('../compiler/source-ref.js');

}).then(({ parseCanonicalRef }) => {

  // Simulate what the error-click handler does:
  // 1. Read data-canonical-ref from a mock span element
  // 2. Parse it; confirm the result is correct

  const mockSpan = { dataset: { canonicalRef: 'main[5:3-5:10]/macro:foo[2:1-2:8]' } };
  const ref = mockSpan.dataset.canonicalRef;
  assert(typeof ref === 'string', 'canonical ref attribute is string');

  const segs = parseCanonicalRef(ref);
  assert(segs && segs.length === 2, 'click ref parses into 2 segments');
  assert(segs[0].sourceId === 'main', 'first segment is main');
  assert(segs[1].sourceId === 'macro:foo', 'second segment is macro:foo');
  assert(segs[segs.length - 1].sourceId === 'macro:foo', 'last segment is innermost');

// ── clearNav semantics ────────────────────────────────────────────────────────

  section('clearNav semantics');

  return import('../ide/ide-state.js');

}).then(({ setExpLog, getExpLog }) => {

  // clearNav should work after setExpLog is called — test the state contract
  // (clearNav itself requires DOM for nav-bar; we only test the state part)
  const log = new Map();
  setExpLog(log);
  assert(getExpLog() === log, 'expLog is set before clear');
  setExpLog(null);
  assert(getExpLog() === null, 'expLog is null after clear');

// ── segmentLabel: full id → short label ───────────────────────────────────────

  section('segmentLabel');
  return import('../compiler/source-ref.js');

}).then(({ segmentLabel }) => {

  assert(segmentLabel('main')                        === 'main',       'main stays main');
  assert(segmentLabel('macro:for_each:main:42')      === 'macro:for_each', 'strips :main:42 suffix');
  assert(segmentLabel('macro:with_min_max:main:200') === 'macro:with_min_max', 'strips longer suffix');

// ── Summary ───────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tests: ${_pass + _fail}  ✔ ${_pass}  ✘ ${_fail}`);
  if (_fail === 0) console.log('All tests passed.');
  else { console.error(`${_fail} test(s) failed.`); process.exit(1); }

}).catch(err => {
  console.error('Error loading module:', err);
  process.exit(1);
});
