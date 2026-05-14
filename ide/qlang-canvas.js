// ide/qlang-canvas.js — <qlang-canvas> Web Component (Light DOM)
//
// Displays game frames rendered by the Worker via ImageBitmap transfer.
// Captures keyboard and mouse input when visible, forwarding to SharedArrayBuffer.
//
// JS API:
//   show(w, h, inputBuf)  — reveal canvas, attach input listeners, register SAB
//   blit(bitmap)          — display an ImageBitmap frame (zero-copy transfer)
//   hide()                — hide canvas, detach input listeners, clear SAB ref

class QLangCanvas extends HTMLElement {
  connectedCallback() {
    if (this._built) return;
    this._built = true;

    this._canvas = this.querySelector('canvas');
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this.appendChild(this._canvas);
    }
    this._ctx         = this._canvas.getContext('bitmaprenderer');
    this._inputArr    = null;  // Int32Array view of gameInputBuf
    this._kbdDown     = this._handleKeyDown.bind(this);
    this._kbdUp       = this._handleKeyUp.bind(this);
    this._mouseMove   = this._handleMouseMove.bind(this);
    this._mouseDown   = this._handleMouseDown.bind(this);
    this._mouseUp     = this._handleMouseUp.bind(this);
    this.style.display = 'none';
  }

  // Show canvas and wire up input capture.
  // inputBuf: SharedArrayBuffer(64) from Worker (see wasm-runner.js layout).
  show(w, h, inputBuf) {
    this._canvas.width  = w;
    this._canvas.height = h;
    this._inputArr = new Int32Array(inputBuf);
    this.style.display = '';
    this._canvas.setAttribute('tabindex', '0');
    this._canvas.focus();
    // Listen on window so controls still work when focus leaves the canvas.
    window.addEventListener('keydown', this._kbdDown, { capture: true });
    window.addEventListener('keyup',   this._kbdUp,   { capture: true });
    this._canvas.addEventListener('mousemove', this._mouseMove);
    this._canvas.addEventListener('mousedown', this._mouseDown);
    this._canvas.addEventListener('mouseup',   this._mouseUp);
  }

  // Display one frame.
  blit(bitmap) {
    this._ctx?.transferFromImageBitmap(bitmap);
    bitmap?.close?.();
  }

  // Hide canvas and detach input listeners. Clears SAB reference.
  hide() {
    window.removeEventListener('keydown', this._kbdDown, { capture: true });
    window.removeEventListener('keyup',   this._kbdUp,   { capture: true });
    this._canvas.removeEventListener('mousemove', this._mouseMove);
    this._canvas.removeEventListener('mousedown', this._mouseDown);
    this._canvas.removeEventListener('mouseup',   this._mouseUp);
    this._inputArr    = null;
    this.style.display = 'none';
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  _handleKeyDown(e) {
    e.preventDefault();
    const k = e.keyCode;
    if (!this._inputArr || k < 0 || k >= 128) return;
    Atomics.or(this._inputArr, k >> 5, 1 << (k & 31));
  }

  _handleKeyUp(e) {
    e.preventDefault();
    const k = e.keyCode;
    if (!this._inputArr || k < 0 || k >= 128) return;
    Atomics.and(this._inputArr, k >> 5, ~(1 << (k & 31)));
  }

  _handleMouseMove(e) {
    if (!this._inputArr) return;
    const rect = this._canvas.getBoundingClientRect();
    Atomics.store(this._inputArr, 4, Math.round(e.clientX - rect.left));  // word 4 = mouseX
    Atomics.store(this._inputArr, 5, Math.round(e.clientY - rect.top));   // word 5 = mouseY
  }

  _handleMouseDown(e) {
    if (!this._inputArr || e.button > 2) return;
    Atomics.or(this._inputArr, 6, 1 << e.button);  // word 6 = mouse buttons bitfield
    this._canvas.focus();
  }

  _handleMouseUp(e) {
    if (!this._inputArr || e.button > 2) return;
    Atomics.and(this._inputArr, 6, ~(1 << e.button));
  }
}

customElements.define('qlang-canvas', QLangCanvas);
