// ide/project-ui.js — VFS + file-tree UI integration
//
// Extracted from main.js to keep file sizes manageable.
// Registers <qlang-file-tree>, wires up file-tree/project events, and
// provides the central _activateProject function.
//
// Exports:
//   initProjectUI(deps) → activateProject function

import './file-tree.js';  // register <qlang-file-tree> custom element

/**
 * Wire up all VFS/file-tree UI logic.
 *
 * @param {{
 *   vfs, mainSv, fileTreeEl, tabBar, filesPane, projectNameInput,
 *   getEditorText, getCompileSource, triggerLiveCompile, setCompiled, clearOutputs
 * }} deps
 * @returns {(proj: import('./vfs.js').Project) => void}  activateProject
 */
export function initProjectUI({
  vfs,
  mainSv,
  fileTreeEl,
  tabBar,
  filesPane,
  projectNameInput,
  getEditorText,
  getCompileSource,
  triggerLiveCompile,
  setCompiled,
  clearOutputs,
}) {
  // ── Internal helpers ──────────────────────────────────────────────────────

  function _loadFileIntoEditor(path, proj) {
    const content = proj.getFile(path) ?? '';
    mainSv.setText(content);
    const noticeEl = tabBar?.querySelector('.tab-bar-notice');
    if (noticeEl) {
      const isNonMain = path !== 'main.qlang';
      noticeEl.hidden = !isNonMain;
      if (isNonMain) noticeEl.textContent = `Editing ${path} — only main.qlang is compiled`;
    }
  }

  function _switchToFile(path, proj = vfs.activeProject) {
    if (!proj || path === proj.activeFile) return;
    vfs.setFile(proj.activeFile, getEditorText());
    proj.activeFile = path;
    vfs.save();
    _renderTabs(proj);
    if (fileTreeEl) fileTreeEl.activePath = path;
    _loadFileIntoEditor(path, proj);
  }

  function _renderTabs(proj) {
    if (!tabBar) return;
    const paths = proj.getFilePaths();
    tabBar.replaceChildren();
    for (const path of paths) {
      const tab = document.createElement('div');
      tab.className = 'tab-item' +
        (path === proj.activeFile ? ' tab-active' : '') +
        (path === 'main.qlang'   ? ' tab-entry'  : '');
      tab.dataset.path = path;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'tab-name';
      nameSpan.textContent = path;
      tab.appendChild(nameSpan);
      tab.addEventListener('click', () => _switchToFile(path));
      tabBar.appendChild(tab);
    }
    const notice = document.createElement('span');
    notice.className = 'tab-bar-notice';
    notice.hidden = proj.activeFile === 'main.qlang';
    notice.textContent = `Editing ${proj.activeFile} — only main.qlang is compiled`;
    tabBar.appendChild(notice);
  }

  function activateProject(proj) {
    if (!proj) return;
    if (projectNameInput) projectNameInput.value = proj.name;
    if (fileTreeEl) fileTreeEl.setFiles(proj.getFilePaths(), proj.activeFile, proj.name);
    if (proj.getFilePaths().length > 1 && filesPane?.isCollapsed) {
      filesPane.toggleCollapse();
    }
    _renderTabs(proj);
    _loadFileIntoEditor(proj.activeFile, proj);
    triggerLiveCompile(getCompileSource());
  }

  // ── File tree events ──────────────────────────────────────────────────────

  fileTreeEl?.addEventListener('ft-file-select', e => {
    _switchToFile(e.detail.path);
  });

  fileTreeEl?.addEventListener('ft-file-create', e => {
    const { path } = e.detail;
    try {
      vfs.createFile(path);
      vfs.save();
    } catch (err) {
      console.warn('ft-file-create:', err.message);
      return;
    }
    const proj = vfs.activeProject;
    fileTreeEl.setFiles(proj.getFilePaths(), proj.activeFile, proj.name);
    _renderTabs(proj);
    if (filesPane?.isCollapsed) filesPane.toggleCollapse();
    _switchToFile(path);
  });

  fileTreeEl?.addEventListener('ft-file-delete', e => {
    const { path } = e.detail;
    try {
      vfs.deleteFile(path);
      vfs.save();
    } catch (err) {
      console.warn('ft-file-delete:', err.message);
      return;
    }
    const proj = vfs.activeProject;
    fileTreeEl.setFiles(proj.getFilePaths(), proj.activeFile, proj.name);
    _renderTabs(proj);
    if (proj.getFilePaths().length === 1 && !filesPane?.isCollapsed) {
      filesPane.toggleCollapse();
    }
    _loadFileIntoEditor(proj.activeFile, proj);
  });

  fileTreeEl?.addEventListener('ft-file-rename', e => {
    const { oldPath, newPath } = e.detail;
    try {
      vfs.renameFile(oldPath, newPath);
      vfs.save();
    } catch (err) {
      console.warn('ft-file-rename:', err.message);
      return;
    }
    const proj = vfs.activeProject;
    fileTreeEl.setFiles(proj.getFilePaths(), proj.activeFile, proj.name);
    _renderTabs(proj);
  });

  // ── Project-level events from file-tree ──────────────────────────────────

  fileTreeEl?.addEventListener('ft-project-rename', e => {
    const proj = vfs.activeProject;
    if (!proj) return;
    proj.name = e.detail.name;
    vfs.save();
  });

  fileTreeEl?.addEventListener('ft-project-delete', () => {
    const proj = vfs.activeProject;
    if (!proj) return;
    if (!confirm(`Delete project "${proj.name}"?\nThis cannot be undone.`)) return;
    try {
      vfs.deleteProject(proj.id);
    } catch (err) {
      alert(err.message);
      return;
    }
    vfs.save();
    setCompiled(false);
    clearOutputs();
    activateProject(vfs.activeProject);
  });

  // ── New project (header button) ───────────────────────────────────────────

  document.getElementById('btn-new-project')?.addEventListener('click', () => {
    const name = (prompt('Project name:') ?? '').trim();
    if (!name) return;
    const proj = vfs.createProject(name);
    vfs.save();
    setCompiled(false);
    clearOutputs();
    activateProject(proj);
  });

  return activateProject;
}
