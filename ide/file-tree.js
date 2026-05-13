// ide/file-tree.js — <qlang-file-tree> Web Component (Light DOM)
//
// Usage:
//   <qlang-file-tree id="file-tree"></qlang-file-tree>
//
// JS API:
//   el.setFiles(paths: string[], activePath: string, projectName?: string)
//   el.activePath = path    — update highlight without full re-render
//
// Dispatched events (bubbling, composed):
//   'ft-file-select'    — detail: { path }            user clicked a file
//   'ft-file-create'    — detail: { path }            user accepted new-file prompt
//   'ft-file-delete'    — detail: { path }            user clicked delete button
//   'ft-file-rename'    — detail: { oldPath, newPath } user confirmed inline rename
//   'ft-project-rename' — detail: { name }            user renamed the project
//   'ft-project-delete' —                             user clicked delete project
//
// Invariants enforced in DOM:
//   - 'main.qlang' always shows an "entry" badge and no delete button
//   - All other files show a delete button on hover

class QLangFileTree extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this._paths = [];
    this._active = 'main.qlang';
    this._projectName = '';
    this._render();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setFiles(paths, activePath, projectName = '') {
    this._paths = paths;
    this._active = activePath;
    this._projectName = projectName;
    this._render();
  }

  set activePath(path) {
    this._active = path;
    // Fast path: update only the active class without full re-render
    for (const li of this.querySelectorAll('.ft-item')) {
      li.classList.toggle('ft-active', li.dataset.path === path);
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render() {
    this.replaceChildren(
      this._buildHeader(),
      this._buildList(),
    );
  }

  _buildHeader() {
    const hdr = document.createElement('div');
    hdr.className = 'ft-header';

    const nameInput = document.createElement('input');
    nameInput.className = 'ft-project-name';
    nameInput.value = this._projectName || '';
    nameInput.placeholder = 'Project name';
    nameInput.title = 'Rename project';
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); nameInput.blur(); }
      if (e.key === 'Escape') { nameInput.value = this._projectName; nameInput.blur(); }
    });
    nameInput.addEventListener('change', () => {
      const newName = nameInput.value.trim();
      if (!newName) { nameInput.value = this._projectName; return; }
      if (newName === this._projectName) return;
      this._projectName = newName;
      this.dispatchEvent(new CustomEvent('ft-project-rename', {
        detail: { name: newName },
        bubbles: true,
        composed: true,
      }));
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'ft-btn-del-proj';
    btnDel.title = 'Delete project';
    btnDel.textContent = '\u{1f5d1}';
    btnDel.addEventListener('click', e => {
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent('ft-project-delete', {
        bubbles: true,
        composed: true,
      }));
    });

    const btnNew = document.createElement('button');
    btnNew.className = 'ft-btn-new';
    btnNew.title = 'New file';
    btnNew.textContent = '+';
    btnNew.addEventListener('click', e => {
      e.stopPropagation();
      const path = (prompt('New file name (e.g. utils.qlang):') ?? '').trim();
      if (!path) return;
      this.dispatchEvent(new CustomEvent('ft-file-create', {
        detail: { path },
        bubbles: true,
        composed: true,
      }));
    });

    hdr.appendChild(nameInput);
    hdr.appendChild(btnDel);
    hdr.appendChild(btnNew);
    return hdr;
  }

  _buildList() {
    const ul = document.createElement('ul');
    ul.className = 'ft-list';

    for (const path of this._paths) {
      ul.appendChild(this._buildItem(path));
    }
    return ul;
  }

  _buildItem(path) {
    const isMain   = path === 'main.qlang';
    const isActive = path === this._active;

    const li = document.createElement('li');
    li.className = 'ft-item' + (isActive ? ' ft-active' : '');
    li.dataset.path = path;

    const icon = document.createElement('span');
    icon.className = 'ft-icon';
    icon.textContent = '◇';
    icon.setAttribute('aria-hidden', 'true');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ft-name';
    nameSpan.textContent = path;

    li.appendChild(icon);
    li.appendChild(nameSpan);

    if (isMain) {
      const badge = document.createElement('span');
      badge.className = 'ft-badge';
      badge.textContent = 'entry';
      li.appendChild(badge);
    } else {
      const btnDel = document.createElement('button');
      btnDel.className = 'ft-btn-del';
      btnDel.title = 'Delete file';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', e => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('ft-file-delete', {
          detail: { path },
          bubbles: true,
          composed: true,
        }));
      });
      li.appendChild(btnDel);

      // Double-click → inline rename
      nameSpan.addEventListener('dblclick', e => {
        e.stopPropagation();
        this._startRename(li, nameSpan, path);
      });
    }

    li.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('ft-file-select', {
        detail: { path },
        bubbles: true,
        composed: true,
      }));
    });

    return li;
  }

  // ── Inline rename ──────────────────────────────────────────────────────────

  _startRename(li, nameSpan, oldPath) {
    const input = document.createElement('input');
    input.className = 'ft-rename-input';
    input.value = oldPath;
    input.style.cssText = 'font:inherit;background:var(--bg);color:var(--text);border:1px solid var(--accent);border-radius:2px;padding:0 3px;width:100%;min-width:0;';

    nameSpan.replaceWith(input);
    input.select();

    const commit = () => {
      const newPath = input.value.trim();
      input.replaceWith(nameSpan);
      if (newPath && newPath !== oldPath) {
        this.dispatchEvent(new CustomEvent('ft-file-rename', {
          detail: { oldPath, newPath },
          bubbles: true,
          composed: true,
        }));
      }
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.replaceWith(nameSpan); }
    });
    input.addEventListener('blur', commit);
  }
}

customElements.define('qlang-file-tree', QLangFileTree);
