// ide/qlang-toolbar.js — <qlang-toolbar> Web Component (Light DOM)
//
// Wraps the IDE toolbar buttons and dispatches semantic events.
// Adopts pre-existing <button> children by their data-action attribute.
//
// HTML:
//   <qlang-toolbar>
//     <button data-action="compile">Compile</button>
//     <button data-action="run">▶ Run</button>
//     <button data-action="debug">⬤ Debug</button>
//     <button data-action="clear">Clear</button>
//   </qlang-toolbar>
//
// Events dispatched (bubbling):
//   'ql-compile', 'ql-run', 'ql-debug', 'ql-clear'

class QLangToolbar extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    this.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      this.dispatchEvent(new CustomEvent('ql-' + action, { bubbles: true }));
    });
  }
}

customElements.define('qlang-toolbar', QLangToolbar);
