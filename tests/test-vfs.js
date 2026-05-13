// tests/test-vfs.js — Unit tests for ide/vfs.js
//
// Runs in Node.js (no DOM).  Uses a mock localStorage for persistence tests.

import { test, suite, assert, assertEq, assertThrows } from './helpers.js';
import { VFS, Project } from '../ide/vfs.js';

// ── Mock storage ──────────────────────────────────────────────────────────────

function makeStorage() {
  const data = {};
  return {
    getItem:    k => data[k] ?? null,
    setItem:    (k, v) => { data[k] = v; },
    removeItem: k => { delete data[k]; },
  };
}

// ── Project ───────────────────────────────────────────────────────────────────

suite('VFS: Project basics');

test('new Project always has main.qlang', () => {
  const p = new Project('id', 'Test', {});
  assert(p.getFile('main.qlang') !== null, 'main.qlang exists');
  assertEq(p.getFile('main.qlang'), '', 'main.qlang is empty');
});

test('Project constructor with files includes them', () => {
  const p = new Project('id', 'T', { 'main.qlang': 'hello', 'util.qlang': 'world' });
  assertEq(p.getFile('main.qlang'), 'hello');
  assertEq(p.getFile('util.qlang'), 'world');
});

test('setFile / getFile round-trip', () => {
  const p = new Project('id', 'T', {});
  p.setFile('main.qlang', 'fn main() {}');
  assertEq(p.getFile('main.qlang'), 'fn main() {}');
});

test('getFile returns null for missing path', () => {
  const p = new Project('id', 'T', {});
  assertEq(p.getFile('missing.qlang'), null);
});

test('createFile creates empty file', () => {
  const p = new Project('id', 'T', {});
  p.createFile('utils.qlang');
  assertEq(p.getFile('utils.qlang'), '');
});

test('createFile throws if path already exists', () => {
  const p = new Project('id', 'T', {});
  assertThrows(() => p.createFile('main.qlang'), Error, 'already exists');
});

test('deleteFile removes a secondary file', () => {
  const p = new Project('id', 'T', { 'util.qlang': 'x' });
  p.deleteFile('util.qlang');
  assertEq(p.getFile('util.qlang'), null);
});

test('deleteFile throws for main.qlang', () => {
  const p = new Project('id', 'T', {});
  assertThrows(() => p.deleteFile('main.qlang'), Error, 'Cannot delete');
});

test('deleteFile throws for nonexistent file', () => {
  const p = new Project('id', 'T', {});
  assertThrows(() => p.deleteFile('ghost.qlang'), Error, 'not found');
});

test('deleteFile switches activeFile to main.qlang when active deleted', () => {
  const p = new Project('id', 'T', { 'util.qlang': '' });
  p.activeFile = 'util.qlang';
  p.deleteFile('util.qlang');
  assertEq(p.activeFile, 'main.qlang');
});

test('renameFile renames a secondary file', () => {
  const p = new Project('id', 'T', { 'old.qlang': 'content' });
  p.renameFile('old.qlang', 'new.qlang');
  assertEq(p.getFile('old.qlang'), null);
  assertEq(p.getFile('new.qlang'), 'content');
});

test('renameFile throws for main.qlang', () => {
  const p = new Project('id', 'T', {});
  assertThrows(() => p.renameFile('main.qlang', 'other.qlang'), Error, 'Cannot rename');
});

test('renameFile throws when src not found', () => {
  const p = new Project('id', 'T', {});
  assertThrows(() => p.renameFile('ghost.qlang', 'x.qlang'), Error, 'not found');
});

test('renameFile throws when dst already exists', () => {
  const p = new Project('id', 'T', { 'a.qlang': '', 'b.qlang': '' });
  assertThrows(() => p.renameFile('a.qlang', 'b.qlang'), Error, 'already exists');
});

test('renameFile updates activeFile if it was the renamed file', () => {
  const p = new Project('id', 'T', { 'old.qlang': '' });
  p.activeFile = 'old.qlang';
  p.renameFile('old.qlang', 'new.qlang');
  assertEq(p.activeFile, 'new.qlang');
});

test('getFilePaths: main.qlang first, rest sorted', () => {
  const p = new Project('id', 'T', { 'z.qlang': '', 'a.qlang': '' });
  const paths = p.getFilePaths();
  assertEq(paths[0], 'main.qlang');
  assertEq(paths[1], 'a.qlang');
  assertEq(paths[2], 'z.qlang');
});

suite('VFS: Project JSON serialization');

test('toJSON / fromJSON round-trip', () => {
  const p = new Project('id-1', 'MyProj', { 'main.qlang': 'code', 'x.qlang': 'more' }, 'x.qlang');
  const json = p.toJSON();
  const p2 = Project.fromJSON(json);
  assertEq(p2.id, 'id-1');
  assertEq(p2.name, 'MyProj');
  assertEq(p2.activeFile, 'x.qlang');
  assertEq(p2.getFile('main.qlang'), 'code');
  assertEq(p2.getFile('x.qlang'), 'more');
});

test('fromJSON with missing activeFile defaults to main.qlang', () => {
  const p = Project.fromJSON({ id: 'x', name: 'T', files: { 'main.qlang': '' } });
  assertEq(p.activeFile, 'main.qlang');
});

// ── VFS ───────────────────────────────────────────────────────────────────────

suite('VFS: createProject');

test('createProject creates a project with main.qlang', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('Test');
  assert(typeof proj.id === 'string', 'has id');
  assertEq(proj.name, 'Test');
  assert(proj.getFile('main.qlang') !== null, 'main.qlang exists');
});

test('createProject with files merges them', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('X', { 'main.qlang': 'hello', 'util.qlang': 'world' });
  assertEq(proj.getFile('main.qlang'), 'hello');
  assertEq(proj.getFile('util.qlang'), 'world');
});

test('createProject sets it as the active project', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('Active');
  assertEq(v.activeProject?.id, proj.id);
});

test('setActiveProject switches active project', () => {
  const v = new VFS(null);
  v.load();
  const p1 = v.createProject('A');
  const p2 = v.createProject('B');
  v.setActiveProject(p1.id);
  assertEq(v.activeProject?.id, p1.id);
  v.setActiveProject(p2.id);
  assertEq(v.activeProject?.id, p2.id);
});

test('setActiveProject throws for unknown id', () => {
  const v = new VFS(null);
  v.load();
  assertThrows(() => v.setActiveProject('no-such-id'), Error, 'not found');
});

test('deleteProject removes project', () => {
  const v = new VFS(null);
  v.load();
  const p1 = v.createProject('A');
  const p2 = v.createProject('B');
  v.setActiveProject(p1.id);
  v.deleteProject(p2.id);
  assertThrows(() => v.setActiveProject(p2.id), Error, 'not found');
});

test('deleteProject throws when only one project remains', () => {
  const v = new VFS(null);
  v.load();  // creates proj-default — that is the one and only project
  const defaultId = v.activeProject.id;
  assertThrows(() => v.deleteProject(defaultId), Error, 'Cannot delete the last');
});

test('deleteProject switches active to another when active is deleted', () => {
  const v = new VFS(null);
  v.load();
  const p1 = v.createProject('A');
  const p2 = v.createProject('B');
  v.setActiveProject(p2.id);
  v.deleteProject(p2.id);
  assert(v.activeProject !== null, 'still has active project after delete');
  assert(v.activeProject?.id !== p2.id, 'active is no longer the deleted project');
});

test('renameProject changes project name', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('Old');
  v.renameProject(proj.id, 'New');
  assertEq(v.activeProject?.name, 'New');
});

suite('VFS: file delegation');

test('vfs.setFile / vfs.getFile delegate to active project', () => {
  const v = new VFS(null);
  v.load();
  v.createProject('P');
  v.setFile('main.qlang', 'hello world');
  assertEq(v.getFile('main.qlang'), 'hello world');
});

test('vfs.createFile / vfs.deleteFile delegate', () => {
  const v = new VFS(null);
  v.load();
  v.createProject('P');
  v.createFile('extra.qlang');
  assertEq(v.getFile('extra.qlang'), '');
  v.deleteFile('extra.qlang');
  assertEq(v.getFile('extra.qlang'), null);
});

test('vfs.getFilePaths delegates', () => {
  const v = new VFS(null);
  v.load();
  v.createProject('P', { 'b.qlang': '' });
  const paths = v.getFilePaths();
  assertEq(paths[0], 'main.qlang');
  assert(paths.includes('b.qlang'), 'b.qlang in paths');
});

suite('VFS: persistence');

test('save() then load() round-trips a project', () => {
  const storage = makeStorage();
  const v1 = new VFS(storage);
  v1.load();
  const proj = v1.createProject('MyProj', { 'main.qlang': 'fn main() {}' });
  v1.save();

  const v2 = new VFS(storage);
  v2.load();
  assertEq(v2.activeProject?.name, 'MyProj');
  assertEq(v2.getFile('main.qlang'), 'fn main() {}');
});

test('load() from empty storage creates Untitled project', () => {
  const v = new VFS(makeStorage());
  v.load();
  assert(v.activeProject !== null, 'has active project');
  assertEq(v.activeProject?.name, 'Untitled');
  assertEq(v.getFile('main.qlang'), '');
});

test('load() from corrupt JSON falls back to Untitled', () => {
  const storage = makeStorage();
  storage.setItem('qlang-vfs-v1', '{broken json!!!');
  const v = new VFS(storage);
  v.load();   // must not throw
  assert(v.activeProject !== null, 'has active project after corrupt storage');
  assertEq(v.activeProject?.name, 'Untitled');
});

test('load() recovers if activeId is invalid', () => {
  const storage = makeStorage();
  const v1 = new VFS(storage);
  v1.load();
  v1.createProject('P');
  v1.save();
  // Corrupt activeId in storage
  const raw = JSON.parse(storage.getItem('qlang-vfs-v1'));
  raw.activeId = 'nonexistent';
  storage.setItem('qlang-vfs-v1', JSON.stringify(raw));

  const v2 = new VFS(storage);
  v2.load();
  assert(v2.activeProject !== null, 'recovers to some project');
});

test('save() is a no-op when storage is null', () => {
  const v = new VFS(null);
  v.load();
  v.createProject('X');
  v.save();   // must not throw
  assert(true, 'no throw');
});

suite('VFS: isExample — session-only projects');

test('createProject with isExample:true sets flag', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('Demo', {}, { isExample: true });
  assert(proj.isExample === true, 'isExample is true');
});

test('createProject without option has isExample false', () => {
  const v = new VFS(null);
  v.load();
  const proj = v.createProject('User');
  assert(proj.isExample === false, 'isExample is false by default');
});

test('save() excludes example projects', () => {
  const storage = makeStorage();
  const v = new VFS(storage);
  v.load();
  v.createProject('User', { 'main.qlang': 'user code' });
  v.createProject('Fib Example', { 'main.qlang': 'fib' }, { isExample: true });
  v.save();

  const persisted = JSON.parse(storage.getItem('qlang-vfs-v1'));
  const names = Object.values(persisted.projects).map(p => p.name);
  assert(names.includes('User'), 'user project persisted');
  assert(!names.includes('Fib Example'), 'example project NOT persisted');
});

test('save() uses first non-example id when active is example', () => {
  const storage = makeStorage();
  const v = new VFS(storage);
  v.load();
  v.createProject('User', { 'main.qlang': 'u' });
  v.createProject('Ex', {}, { isExample: true }); // becomes active
  v.save();

  const persisted = JSON.parse(storage.getItem('qlang-vfs-v1'));
  // activeId in persisted storage must not be the example project
  const exampleNames = Object.values(persisted.projects)
    .filter(p => persisted.projects[persisted.activeId]?.name === p.name);
  assert(persisted.activeId !== null, 'activeId is set');
  // loading fresh restores the user project as active
  const v2 = new VFS(storage);
  v2.load();
  assertEq(v2.activeProject?.name, 'User');
});

test('after load(), example projects are absent', () => {
  const storage = makeStorage();
  const v1 = new VFS(storage);
  v1.load();
  v1.createProject('User');
  v1.createProject('Ex', {}, { isExample: true });
  v1.save();

  const v2 = new VFS(storage);
  v2.load();
  const names = [...v2.projects.values()].map(p => p.name);
  assert(!names.includes('Ex'), 'example project not restored after load');
  assert(names.includes('User'), 'user project restored');
});

suite('VFS.fromExample');

test('fromExample backward-compat: old format {file}', () => {
  const result = VFS.fromExample({ name: 'Fib', file: 'fibonacci.qlang' });
  assertEq(result.name, 'Fib');
  assertEq(result.mainFile, 'fibonacci.qlang');
  assert(Array.isArray(result.allFiles), 'allFiles is array');
  assertEq(result.allFiles[0], 'fibonacci.qlang');
});

test('fromExample new format {files, main}', () => {
  const result = VFS.fromExample({
    name: 'Multi',
    file: 'main.qlang',
    main: 'main.qlang',
    files: ['main.qlang', 'utils.qlang'],
  });
  assertEq(result.mainFile, 'main.qlang');
  assertEq(result.allFiles.length, 2);
  assert(result.allFiles.includes('utils.qlang'), 'includes utils.qlang');
});
