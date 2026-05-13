// ide/vfs.js — Virtual File System for multi-file QLang projects
//
// Exports:
//   class Project  — one project = a named set of files
//   class VFS      — manages multiple projects, persists to localStorage
//   vfs            — singleton instance (use this everywhere)
//
// Invariants:
//   - Every project ALWAYS has 'main.qlang'
//   - 'main.qlang' cannot be deleted or renamed
//   - load() never throws; corrupt storage → fallback Untitled project
//   - VFS accepts an optional storage object (dependency injection for tests)

// ── Project ───────────────────────────────────────────────────────────────────

export class Project {
  constructor(id, name, files = {}, activeFile = 'main.qlang', isExample = false) {
    this.id = id;
    this.name = name;
    /** @type {Map<string,string>} */
    this.files = new Map(Object.entries(files));
    this.activeFile = activeFile;
    /** Example projects are session-only: never persisted across page loads. */
    this.isExample = isExample;

    // Ensure main.qlang always exists
    if (!this.files.has('main.qlang')) this.files.set('main.qlang', '');
  }

  // ── File operations ─────────────────────────────────────────────────────────

  getFile(path) {
    return this.files.get(path) ?? null;
  }

  setFile(path, content) {
    this.files.set(path, content);
  }

  createFile(path) {
    if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
    this.files.set(path, '');
  }

  deleteFile(path) {
    if (path === 'main.qlang') throw new Error('Cannot delete main.qlang');
    if (!this.files.has(path)) throw new Error(`File not found: ${path}`);
    this.files.delete(path);
    if (this.activeFile === path) this.activeFile = 'main.qlang';
  }

  renameFile(oldPath, newPath) {
    if (oldPath === 'main.qlang') throw new Error('Cannot rename main.qlang');
    if (!this.files.has(oldPath)) throw new Error(`File not found: ${oldPath}`);
    if (this.files.has(newPath)) throw new Error(`File already exists: ${newPath}`);
    const content = this.files.get(oldPath);
    this.files.delete(oldPath);
    this.files.set(newPath, content);
    if (this.activeFile === oldPath) this.activeFile = newPath;
  }

  /** Returns file paths sorted, with main.qlang always first. */
  getFilePaths() {
    const rest = [...this.files.keys()]
      .filter(p => p !== 'main.qlang')
      .sort();
    return ['main.qlang', ...rest];
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      activeFile: this.activeFile,
      files: Object.fromEntries(this.files),
    };
  }

  static fromJSON({ id, name, activeFile, files }) {
    return new Project(id, name, files ?? {}, activeFile ?? 'main.qlang', false);
  }
}

// ── VFS ───────────────────────────────────────────────────────────────────────

export class VFS {
  #projects = new Map();
  #activeId = null;
  #lastUserActiveId = null;  // last non-example active id — used by save()
  #storage;

  /**
   * @param {Storage|null} storage — localStorage by default; pass mock for tests.
   *   Pass null to disable persistence (tests that don't need it).
   */
  constructor(storage) {
    if (storage === undefined) {
      // Browser default: use localStorage if available
      this.#storage = (typeof localStorage !== 'undefined') ? localStorage : null;
    } else {
      this.#storage = storage;
    }
  }

  // ── Project management ──────────────────────────────────────────────────────

  get activeProject() {
    return this.#activeId ? (this.#projects.get(this.#activeId) ?? null) : null;
  }

  /** Read-only view of all projects. */
  get projects() { return this.#projects; }

  setActiveProject(id) {
    if (!this.#projects.has(id)) throw new Error(`Project not found: ${id}`);
    this.#activeId = id;
    if (!this.#projects.get(id).isExample) this.#lastUserActiveId = id;
  }

  /**
   * Create a new project, make it active, and return it.
   * @param {string} name
   * @param {Object<string,string>} files  — key=path, value=content
   * @param {{ isExample?: boolean }} opts
   */
  createProject(name, files = {}, { isExample = false } = {}) {
    const id = 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const merged = { 'main.qlang': '', ...files };
    const proj = new Project(id, name, merged, 'main.qlang', isExample);
    this.#projects.set(id, proj);
    this.#activeId = id;
    if (!isExample) this.#lastUserActiveId = id;
    return proj;
  }

  deleteProject(id) {
    if (this.#projects.size <= 1) throw new Error('Cannot delete the last project');
    this.#projects.delete(id);
    if (this.#activeId === id) {
      this.#activeId = this.#projects.keys().next().value;
    }
  }

  renameProject(id, newName) {
    const proj = this.#projects.get(id);
    if (!proj) throw new Error(`Project not found: ${id}`);
    proj.name = newName;
  }

  // ── File operations (delegated to active project) ───────────────────────────

  createFile(path) { return this.#active().createFile(path); }
  deleteFile(path) { return this.#active().deleteFile(path); }
  renameFile(oldPath, newPath) { return this.#active().renameFile(oldPath, newPath); }
  setFile(path, content) { return this.#active().setFile(path, content); }
  getFile(path) { return this.#active().getFile(path); }
  getFilePaths() { return this.#active().getFilePaths(); }

  #active() {
    const p = this.activeProject;
    if (!p) throw new Error('No active project');
    return p;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  save() {
    if (!this.#storage) return;
    // Example projects are session-only — never written to storage.
    const persistable = [...this.#projects.entries()]
      .filter(([, p]) => !p.isExample);
    const persistIds = new Set(persistable.map(([id]) => id));
    // Prefer the last user-active project; fall back to first persistable.
    const activeId = persistIds.has(this.#activeId)
      ? this.#activeId
      : persistIds.has(this.#lastUserActiveId)
        ? this.#lastUserActiveId
        : (persistable.length > 0 ? persistable[0][0] : null);
    const data = {
      activeId,
      projects: Object.fromEntries(persistable.map(([id, p]) => [id, p.toJSON()])),
    };
    this.#storage.setItem('qlang-vfs-v1', JSON.stringify(data));
  }

  load() {
    if (!this.#storage) { this.#initFallback(); return; }
    try {
      const raw = this.#storage.getItem('qlang-vfs-v1');
      if (!raw) { this.#initFallback(); return; }

      const data = JSON.parse(raw);
      this.#projects = new Map(
        Object.entries(data.projects ?? {}).map(([id, p]) => [id, Project.fromJSON(p)])
      );
      this.#activeId = data.activeId ?? null;

      // Validate active id
      if (this.#activeId && !this.#projects.has(this.#activeId)) {
        this.#activeId = this.#projects.keys().next().value ?? null;
      }
      if (!this.#activeId || this.#projects.size === 0) { this.#initFallback(); }
      this.#lastUserActiveId = this.#activeId;
    } catch {
      this.#initFallback();
    }
  }

  #initFallback() {
    const proj = new Project('proj-default', 'Untitled', { 'main.qlang': '' });
    this.#projects.set(proj.id, proj);
    this.#activeId = proj.id;
    this.#lastUserActiveId = proj.id;
  }

  // ── Factory for loading examples ────────────────────────────────────────────

  /**
   * Parse an entry from examples/index.json into { name, mainFile, allFiles }.
   * Supports both old format { file } and new format { files, main }.
   */
  static fromExample({ name, file, files, main }) {
    const mainFile = main ?? file;
    const allFiles = files ?? [file];
    return { name, mainFile, allFiles };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const vfs = new VFS();
