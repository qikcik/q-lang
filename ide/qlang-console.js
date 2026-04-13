// ide/qlang-console.js — <qlang-console> Web Component (Light DOM)
//
// Output console + async stdin for program I/O.
//
// JS API:
//   write(text)           — append text verbatim (no newline added)
//   log(msg)              — append msg + '\n'
//   clear()               — clear output
//   startInput(cb)        — enable stdin field; call cb(text) on Enter / > button
//   cancelInput()         — disable stdin field (called when run finishes/aborts)

class QLangConsole extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    // ── output ──────────────────────────────────────────────────────────
    this._pre = this.querySelector('pre') || document.createElement('pre');
    if (!this._pre.parentElement) this.appendChild(this._pre);

    // ── stdin row ────────────────────────────────────────────────────────
    const row = document.createElement('div');
    row.className = 'console-stdin';

    this._input = document.createElement('input');
    this._input.type        = 'text';
    this._input.className   = 'console-stdin-input';
    this._input.disabled    = true;
    this._input.placeholder = 'ext::input…';
    this._input.spellcheck  = false;
    this._input.setAttribute('autocomplete', 'off');

    this._btn = document.createElement('button');
    this._btn.className   = 'console-stdin-btn';
    this._btn.disabled    = true;
    this._btn.textContent = '▶';
    this._btn.title       = 'Send (Enter)';

    row.appendChild(this._input);
    row.appendChild(this._btn);
    this.appendChild(row);

    this._callback = null;

    this._input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._submit(); }
    });
    this._btn.addEventListener('click', () => this._submit());
  }

  write(text) {
    this._pre.appendChild(document.createTextNode(text));
    this._pre.scrollTop = this._pre.scrollHeight;
  }

  log(msg) {
    const span = document.createElement('span');
    span.style.color = 'var(--accent, #89b4fa)';
    span.textContent = msg + '\n';
    this._pre.appendChild(span);
    this._pre.scrollTop = this._pre.scrollHeight;
  }

  clear() {
    this._pre.innerHTML = '';
  }

  startInput(callback) {
    this._callback = callback;
    this._input.disabled = false;
    this._btn.disabled   = false;
    this._input.value    = '';
    this._input.focus();
  }

  cancelInput() {
    this._callback       = null;
    this._input.disabled = true;
    this._btn.disabled   = true;
    this._input.value    = '';
  }

  _submit() {
    if (!this._callback) return;
    const val = this._input.value;
    const cb  = this._callback;   // save before cancelInput nullifies it
    this.cancelInput();
    const echo = document.createElement('span');
    echo.style.color = 'var(--muted, #6c7086)';
    echo.textContent = '\u276f ' + val + '\n';
    this._pre.appendChild(echo);
    this._pre.scrollTop = this._pre.scrollHeight;
    cb(val);
  }
}

customElements.define('qlang-console', QLangConsole);

