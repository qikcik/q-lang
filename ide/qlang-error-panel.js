// ide/qlang-error-panel.js — <qlang-error-panel> Web Component (Light DOM)
//
// Displays a list of compiler errors as clickable spans.
// Moved from main.js renderErrorList + error click handlers.
//
// HTML:
//   <qlang-error-panel id="error-panel"></qlang-error-panel>
//
// JS API:
//   setErrors(errors[])  — render error list (.err-line spans)
//   log(msg)             — append a single error message
//   clear()              — remove all error content
//
// Events dispatched (bubbling):
//   'ql-error-click'  detail: { start, end, line, canonicalRef }
//
// Each error object: { message, start?, end?, line?, canonicalRef? }

class QLangErrorPanel extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    // Use existing <pre> child or create one
    this._pre = this.querySelector('pre') || document.createElement('pre');
    if (!this._pre.parentElement) this.appendChild(this._pre);
    this._pre.style.cursor = 'pointer';

    this._pre.addEventListener('click', e => {
      const span = e.target.closest('.err-line');
      if (!span) return;
      this.dispatchEvent(new CustomEvent('ql-error-click', {
        bubbles: true,
        detail: {
          canonicalRef: span.dataset.canonicalRef || null,
          start:        span.dataset.start != null ? +span.dataset.start : null,
          end:          span.dataset.end   != null ? +span.dataset.end   : null,
          line:         span.dataset.line  != null ? +span.dataset.line  : null,
        },
      }));
    });
  }

  setErrors(errors) {
    this._pre.replaceChildren();
    for (const e of errors) {
      const span = document.createElement('span');
      span.className = 'err-line';
      span.textContent = e.message || String(e);
      if (e.canonicalRef)  span.dataset.canonicalRef = e.canonicalRef;
      if (e.start != null) span.dataset.start = String(e.start);
      if (e.end   != null) span.dataset.end   = String(e.end);
      if (e.line  != null) span.dataset.line  = String(e.line);
      this._pre.appendChild(span);
    }
  }

  log(msg) {
    const span = document.createElement('span');
    span.className = 'err-line';
    span.textContent = msg;
    this._pre.appendChild(span);
    this._pre.appendChild(document.createTextNode('\n'));
  }

  clear() {
    this._pre.replaceChildren();
  }
}

customElements.define('qlang-error-panel', QLangErrorPanel);
