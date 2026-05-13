// tests/test-ide-smoke.js — Static IDE structure + pipeline shape smoke tests
//
// Runs in Node.js as part of the test suite.
// Validates:
//   1. index.html contains all DOM element IDs that IDE modules reference
//   2. All IDE source files exist
//   3. Compiler pipeline output has the exact shape IDE views expect
//   4. Key data contracts (AST offsets, error fields, expLog entries)
//   5. Canonical ref roundtrip
//   6. CSS class presence
//   7. Hover data contracts
//   8. Example files — JSON manifest shape + each file compiles + showcase result
//
// These tests form a safety net before any IDE refactoring (e.g. Web Component
// migration).  If an ID disappears from index.html or a pipeline output shape
// changes, these tests catch it immediately.

import { readFileSync, existsSync } from 'fs';
import { test, suite, assert, assertEq } from './helpers.js';
import { compile, liveCompile } from '../compiler/pipeline.js';
import { generate } from '../compiler/codegen.js';
import { parseCanonicalRef, buildCanonicalRef } from '../compiler/source-ref.js';

// ── Load index.html once ──────────────────────────────────────────────────────

const htmlPath = new URL('../index.html', import.meta.url);
const html = readFileSync(htmlPath, 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. HTML structure — every getElementById target must exist in index.html
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: required DOM element IDs');

// Exhaustive list from grepping all getElementById calls in ide/*.js
// Note: 'editor' is created dynamically by <qlang-source-view> in _build(),
// not present in static HTML — tested in browser smoke tests instead.
const REQUIRED_IDS = [
  // main.js
  'main-sv', 'btn-compile', 'btn-run', 'btn-stop', 'btn-clear',
  'out-console', 'out-errors', 'out-ast', 'out-bytecode', 'wat-root',
  'error-panel', 'console-panel',
  'macro-lens-layer', 'macro-panels-row',
  // debugger.js
  'btn-debug', 'debugger-panel', 'dbg-instr', 'dbg-step',
  'dbg-continue', 'dbg-canonical',
  // nav-bar.js
  'nav-bar', 'nav-prev', 'nav-next', 'nav-label', 'nav-close',
  // lsp.js
  'ast-status',
  // source-view.js
  'type-tooltip',
  // lang-docs.js
  'lang-docs',
  // examples.js
  'btn-open-project', 'project-list',
  // project-ui.js / vfs integration
  'file-tree', 'tab-bar', 'files-pane', 'btn-new-project',
];

for (const id of REQUIRED_IDS) {
  test(`index.html has id="${id}"`, () => {
    assert(html.includes(`id="${id}"`), `missing id="${id}" in index.html`);
  });
}

// ── Web Component tag and module entry point ──────────────────────────────────

suite('IDE smoke: HTML structure');

test('<qlang-source-view> tag present', () => {
  assert(html.includes('<qlang-source-view'), 'missing <qlang-source-view>');
});

test('<qlang-source-view> has editable attr', () => {
  assert(html.includes('<qlang-source-view') && html.includes('editable'), 'main-sv missing editable');
});

test('main.js loaded as ES module', () => {
  assert(
    html.includes('type="module"') && html.includes('main.js'),
    'missing <script type="module" src="...main.js">'
  );
});

test('<qlang-toolbar> wraps toolbar buttons', () => {
  assert(html.includes('<qlang-toolbar'), 'missing <qlang-toolbar>');
});

test('<qlang-error-panel> wraps error output', () => {
  assert(html.includes('<qlang-error-panel'), 'missing <qlang-error-panel>');
});

test('<qlang-console> wraps console output', () => {
  assert(html.includes('<qlang-console'), 'missing <qlang-console>');
});

test('three-column layout (3 .pane elements)', () => {
  const paneCount = (html.match(/class="pane[\s"]/g) || []).length;
  assert(paneCount >= 3, `expected ≥3 .pane elements, got ${paneCount}`);
});

test('resize handles present (col-handle)', () => {
  assert(html.includes('col-handle'), 'missing col-handle class');
});

test('resize handles present (row-handle)', () => {
  assert(html.includes('row-handle'), 'missing row-handle class');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. IDE source files exist
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: source files exist');

const IDE_FILES = [
  'ide/main.js', 'ide/views.js', 'ide/source-view.js', 'ide/highlight.js',
  'ide/crossSelection.js', 'ide/lsp.js', 'ide/editor.js', 'ide/debugger.js',
  'ide/macro-panel.js', 'ide/nav-bar.js', 'ide/navigate.js', 'ide/ide-state.js',
  'ide/source-registry.js', 'ide/hover.js', 'ide/lang-docs.js',
  'ide/qlang-pane.js', 'ide/layout.js',
  'ide/qlang-error-panel.js', 'ide/qlang-console.js', 'ide/qlang-toolbar.js',
  'ide/examples.js',
  'ide/vfs.js', 'ide/file-tree.js', 'ide/project-ui.js',
  'examples/index.json', 'examples/showcase.qlang', 'examples/fibonacci.qlang',
];

for (const file of IDE_FILES) {
  test(`${file} exists`, () => {
    const abs = new URL('../' + file, import.meta.url);
    assert(existsSync(abs), `missing: ${file}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Compile pipeline output shape (what IDE views consume)
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: compile() output shape');

test('compile() → {tokens, ast, expLog, parseErrors}', () => {
  const r = compile('x : i32 = 42;');
  assert(Array.isArray(r.tokens), 'tokens is array');
  assert(r.ast && r.ast.kind === 'Program', 'ast.kind = Program');
  assert(r.expLog instanceof Map, 'expLog is Map');
  assert(Array.isArray(r.parseErrors), 'parseErrors is array');
});

test('AST nodes carry start/end offsets for editor highlighting', () => {
  const { ast } = compile('x : i32 = 42;');
  const decl = ast.body[0];
  assert(typeof decl.start === 'number' && typeof decl.end === 'number', 'decl has start/end');
  assert(decl.end > decl.start, 'end > start');
});

test('AST nodes carry line number for AST sync', () => {
  const { ast } = compile('x : i32 = 42;');
  const decl = ast.body[0];
  assert(typeof decl.line === 'number', 'decl has .line');
});

suite('IDE smoke: liveCompile() output shape');

test('liveCompile() → {tokens, ast, expLog, parseErrors, typeErrors}', () => {
  const r = liveCompile('x : i32 = 42;');
  assert(Array.isArray(r.tokens), 'tokens');
  assert(r.ast?.kind === 'Program', 'ast');
  assert(Array.isArray(r.parseErrors), 'parseErrors');
  assert(Array.isArray(r.typeErrors), 'typeErrors');
});

test('liveCompile type error has start/end for error highlighting', () => {
  const r = liveCompile('x : i32 = "hello";');
  assert(r.typeErrors.length > 0, 'type error detected');
  const err = r.typeErrors[0];
  assert(typeof err.start === 'number', 'err.start');
  assert(typeof err.end === 'number', 'err.end');
});

test('liveCompile parse error has start/end', () => {
  const r = liveCompile('x : i32 = ;');
  assert(r.parseErrors.length > 0, 'parse error detected');
  const err = r.parseErrors[0];
  assert(typeof err.start === 'number', 'err.start');
});

test('liveCompile never throws (broken input)', () => {
  // Deliberately malformed inputs — liveCompile must not throw
  const badInputs = ['', '!!!', '{{{{', 'fn(', 'x := ;', '#@$'];
  for (const bad of badInputs) {
    let threw = false;
    try { liveCompile(bad); } catch { threw = true; }
    assert(!threw, `liveCompile("${bad}") should not throw`);
  }
});

suite('IDE smoke: generate() output shape');

test('generate() → {bytes, byteSpans, watText, watSpans, module, sSpans, stmtMap}', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const g = generate(ast);
  assert(g.bytes instanceof Uint8Array, 'bytes is Uint8Array');
  assert(Array.isArray(g.byteSpans), 'byteSpans is array');
  assert(typeof g.watText === 'string', 'watText is string');
  assert(Array.isArray(g.watSpans), 'watSpans is array');
  assert(g.module !== null && Array.isArray(g.module), 'module is S-expr array');
  assert(Array.isArray(g.sSpans), 'sSpans is array');
  assert(g.stmtMap instanceof Map, 'stmtMap is Map');
});

test('WASM bytes start with magic header', () => {
  const { ast } = compile('main := fn() i32 { return 0; };');
  const { bytes } = generate(ast);
  // \0asm magic: 00 61 73 6D
  assert(bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6D,
    'WASM magic header');
});

test('watText contains (module ...)', () => {
  const { ast } = compile('main := fn() i32 { return 0; };');
  const { watText } = generate(ast);
  assert(watText.startsWith('(module'), 'watText starts with (module');
});

test('byteSpans entries have byteStart/byteEnd/astNode', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const { byteSpans } = generate(ast);
  assert(byteSpans.length > 0, 'has byteSpans');
  const span = byteSpans[0];
  assert(typeof span.byteStart === 'number', 'byteStart');
  assert(typeof span.byteEnd === 'number', 'byteEnd');
  assert(span.astNode !== undefined, 'astNode');
});

test('watSpans entries have watStart/watEnd/astNode', () => {
  const { ast } = compile('main := fn() i32 { return 42; };');
  const { watSpans } = generate(ast);
  assert(watSpans.length > 0, 'has watSpans');
  const span = watSpans[0];
  assert(typeof span.watStart === 'number', 'span.watStart');
  assert(typeof span.watEnd === 'number', 'span.watEnd');
  assert(span.astNode !== undefined, 'span.astNode');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Macro expansion log shape (consumed by macro-panel.js)
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: macro expLog shape');

test('expLog entry has {name, source, callLine, expandedBody}', () => {
  const src = [
    'dbl := macro(x : ident) { @x = @x + @x; };',
    'main := fn() i32 {',
    '  result : mut i32 = 5;',
    '  dbl!(result);',
    '  return result;',
    '};',
  ].join('\n');
  const { expLog } = compile(src);
  assert(expLog.size > 0, 'expLog has entries');
  for (const [, info] of expLog) {
    assert(typeof info.name === 'string', 'info.name');
    assert(info.source && typeof info.source.id === 'string', 'info.source.id');
    assert(typeof info.callLine === 'number', 'info.callLine');
    assert(Array.isArray(info.expandedBody), 'info.expandedBody is array');
  }
});

test('expLog source has callSite for panel navigation', () => {
  const src = [
    'dbl := macro(x : ident) { @x = @x + @x; };',
    'main := fn() i32 {',
    '  result : mut i32 = 5;',
    '  dbl!(result);',
    '  return result;',
    '};',
  ].join('\n');
  const { expLog } = compile(src);
  for (const [, info] of expLog) {
    assert(info.source.callSite, 'source.callSite exists');
    assert(typeof info.source.callSite.sourceId === 'string', 'callSite.sourceId');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Canonical ref roundtrip (IDE error navigation depends on this)
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: canonical ref contracts');

test('TypeError carries canonicalRef string', () => {
  const src = 'x : i32 = "hello";';
  let caught = null;
  try { compile(src); } catch (e) { caught = e; }
  assert(caught !== null, 'TypeError thrown');
  assert(typeof caught.canonicalRef === 'string', 'has canonicalRef');
});

test('canonicalRef roundtrips through parse', () => {
  const src = 'x : i32 = "hello";';
  let caught = null;
  try { compile(src); } catch (e) { caught = e; }
  if (caught?.canonicalRef) {
    const segs = parseCanonicalRef(caught.canonicalRef);
    assert(segs && segs.length >= 1, 'parseable into segments');
    assert(segs[0].sourceId === 'main', 'first segment is main');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CSS contract — index.html has styles for all view-critical classes
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: CSS class presence');

const CRITICAL_CSS_CLASSES = [
  'sv-gutter', 'sv-body', 'sv-hl-rect', 'sv-hl-active', 'sv-hl-dimmed',
  'macro-lens-btn', 'macro-panel', 'macro-panel-header',
  'hl-keyword', 'hl-type', 'hl-number', 'hl-string', 'hl-comment', 'hl-error',
  'ast-highlight', 'ast-kind', 'ast-label',
  'wat-highlight', 'wat-root', 'wat-line',
  'bc-row', 'bc-byte', 'bc-highlight',
  'err-line',
  'ac-item', 'ac-sel',
  'dbg-current-line', 'dbg-toolbar',
  // VFS / file-tree
  'ft-header', 'ft-list', 'ft-item', 'ft-active', 'ft-badge', 'ft-btn-del',
  // tab bar
  'tab-bar', 'tab-item', 'tab-active',
];

for (const cls of CRITICAL_CSS_CLASSES) {
  test(`CSS defines .${cls}`, () => {
    assert(html.includes(cls), `missing CSS class "${cls}" in index.html`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Hover data — struct type annotations get hover entries
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: hover data for struct type annotations');

import { buildHoverData } from '../ide/hover.js';

test('hover at struct param type annotation', () => {
  const src = 'Point := struct { x: i32, y: i32 };\nmove := fn(p: Point) i32 { return p.x; };';
  const r = compile(src);
  const hd = buildHoverData(r.tokens, r.ast);
  const typePos = src.indexOf('Point', src.indexOf('fn'));
  const hits = hd.filter(e => e.start <= typePos && e.end >= typePos + 5);
  assert(hits.length > 0, 'hover entry exists at struct param type position');
  assert(hits.some(h => h.detail.includes('struct')), 'hover detail mentions struct');
});

test('hover at VarDecl struct type annotation', () => {
  const src = 'Point := struct { x: i32, y: i32 };\np : Point = Point::of(1, 2);';
  const r = compile(src);
  const hd = buildHoverData(r.tokens, r.ast);
  const typePos = src.indexOf('Point', src.indexOf('p :'));
  const hits = hd.filter(e => e.start <= typePos && e.end >= typePos + 5);
  assert(hits.length > 0, 'hover entry exists at VarDecl struct type position');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Example files — manifest shape, every file present + compiles, showcase result
// ═══════════════════════════════════════════════════════════════════════════════

suite('IDE smoke: examples/');

const examplesIndexPath = new URL('../examples/index.json', import.meta.url);
const examplesIndex = JSON.parse(readFileSync(examplesIndexPath, 'utf-8'));

test('index.json is a non-empty array', () => {
  assert(Array.isArray(examplesIndex) && examplesIndex.length > 0,
    'index.json must be non-empty array');
});

test('every entry has name and file reference', () => {
  for (const entry of examplesIndex) {
    assert(typeof entry.name === 'string' && entry.name.length > 0,
      `entry.name must be non-empty string (got ${JSON.stringify(entry.name)})`);
    assert(
      typeof entry.file === 'string' && entry.file.endsWith('.qlang'),
      `entry.file must be a .qlang filename (got ${JSON.stringify(entry.file)})`);
    // New format fields (both must be present together)
    if (entry.files !== undefined || entry.main !== undefined) {
      assert(Array.isArray(entry.files) && entry.files.length > 0,
        `entry.files must be non-empty array: ${entry.name}`);
      assert(typeof entry.main === 'string' && entry.main.endsWith('.qlang'),
        `entry.main must be a .qlang filename: ${entry.name}`);
      assert(entry.files.includes(entry.main),
        `entry.main must be in entry.files: ${entry.name}`);
    }
  }
});

test('every listed file exists in examples/', () => {
  for (const { file } of examplesIndex) {
    const abs = new URL('../examples/' + file, import.meta.url);
    assert(existsSync(abs), `examples/${file} missing`);
  }
});

test('every example file has non-empty content', () => {
  for (const { file } of examplesIndex) {
    const abs = new URL('../examples/' + file, import.meta.url);
    const text = readFileSync(abs, 'utf-8').trim();
    assert(text.length > 0, `examples/${file} is empty`);
  }
});

test('every example compiles without parse errors', () => {
  for (const { name, file } of examplesIndex) {
    const abs = new URL('../examples/' + file, import.meta.url);
    const src = readFileSync(abs, 'utf-8');
    const { parseErrors } = liveCompile(src);
    assert(parseErrors.length === 0,
      `${name} (${file}): ${parseErrors.length} parse error(s): ${parseErrors[0]?.message ?? ''}`);
  }
});

for (const { name, file } of examplesIndex) {
  test(`${name} (${file}) compiles and generates valid WASM`, () => {
    const abs = new URL('../examples/' + file, import.meta.url);
    const src = readFileSync(abs, 'utf-8');
    let ast = null;
    try { ({ ast } = compile(src)); } catch (e) {
      assert(false, `${file} compile threw: ` + e.message); return;
    }
    assert(ast?.kind === 'Program', 'ast is Program');
    const { bytes } = generate(ast);
    assert(bytes instanceof Uint8Array && bytes.length > 8, 'WASM bytes generated');
    assert(bytes[0] === 0x00 && bytes[1] === 0x61, 'WASM magic header present');
  });
}

test('index.html example-picker button is positioned left of toolbar', () => {
  // btn-open-project must appear before btn-compile in source order
  const pickerPos  = html.indexOf('btn-open-project');
  const compilePos = html.indexOf('btn-compile');
  assert(pickerPos > 0 && compilePos > 0, 'both elements present');
  assert(pickerPos < compilePos, 'example picker appears before toolbar in HTML');
});
