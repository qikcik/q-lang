// ide/qlang-pane.js — <qlang-pane> Web Component (Light DOM)
//
// Collapsible panel used as the building block for every sub-pane in the IDE.
// Replaces `<div class="sub-pane">` + inline collapse script.
//
// HTML usage (keep existing .pane-label child for full control):
//
//   <qlang-pane data-view="ast">
//     <div class="pane-label" draggable="true">AST <span id="ast-status"></span></div>
//     <div id="out-ast" class="ast-scroll"></div>
//   </qlang-pane>
//
// Or with auto-generated label:
//
//   <qlang-pane label="Console" data-view="console">
//     <pre id="out-console"></pre>
//   </qlang-pane>
//
// Attributes:
//   label       — text for auto-generated label (ignored if .pane-label child exists)
//   collapsed   — boolean; start collapsed
//   pane-drag   — boolean; make the label draggable="true"
//
// JS API:
//   toggleCollapse()
//   isCollapsed → boolean
//
// No Shadow DOM.  Adds `.sub-pane` class to host so all existing CSS applies.
// Collapse toggles `.pane-collapsed` on host, `.collapsed` on label,
// and `.pane-body-hidden` on every non-label child.

class QLangPane extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    this.classList.add('sub-pane');

    // ── Find or create label ────────────────────────────────────────────
    this._labelEl = this.querySelector(':scope > .pane-label');
    if (!this._labelEl) {
      this._labelEl = document.createElement('div');
      this._labelEl.className = 'pane-label';
      this._labelEl.textContent = this.getAttribute('label') || '';
      if (this.hasAttribute('pane-drag')) {
        this._labelEl.setAttribute('draggable', 'true');
      }
      this.prepend(this._labelEl);
    }

    // ── Initialize collapsed state ──────────────────────────────────────
    if (this.hasAttribute('collapsed')) {
      this._applyCollapsed(true);
    }

    // Interactive controls in the label (e.g., telemetry toggle) should not
    // trigger pane collapse or drag-and-drop behavior.
    this.querySelectorAll('[data-pane-control]').forEach(ctrl => {
      ctrl.addEventListener('mousedown', e => e.stopPropagation());
      ctrl.addEventListener('click', e => e.stopPropagation());
      ctrl.addEventListener('dragstart', e => {
        e.stopPropagation();
        e.preventDefault();
      });
    });

    // ── Collapse click handler ──────────────────────────────────────────
    this._labelEl.addEventListener('click', (e) => {
      if (e.target?.closest?.('[data-pane-control]')) return;
      this.toggleCollapse();
    });
  }

  toggleCollapse() {
    this._applyCollapsed(!this.classList.contains('pane-collapsed'));
  }

  _applyCollapsed(collapsed) {
    this.classList.toggle('pane-collapsed', collapsed);
    this._labelEl.classList.toggle('collapsed', collapsed);
    for (const child of this.children) {
      if (child === this._labelEl) continue;
      child.classList.toggle('pane-body-hidden', collapsed);
    }
  }

  get isCollapsed() {
    return this.classList.contains('pane-collapsed');
  }
}

customElements.define('qlang-pane', QLangPane);
