// ide/gfx-renderer.js — WebGL2Renderer for QLang game programs
//
// Runs inside a Web Worker. Creates an OffscreenCanvas and renders batched
// primitives via WebGL2 each frame. Zero per-frame allocations.
//
// Public API:
//   new WebGL2Renderer(w, h)  — create OffscreenCanvas + init GL
//   beginFrame()              — clear buffers, reset batch counters
//   endFrame()                → ImageBitmap (zero-copy; transferable)
//   drawRect(x,y,w,h,rgba)
//   drawLine(x0,y0,x1,y1,rgba)
//   drawCircle(cx,cy,r,rgba)
//   drawRectOutline(x,y,w,h,thick,rgba)
//   clearBackground(rgba)     — fill with solid color before drawing
//
// Color format: packed RGBA_8888 i32 — 0xRRGGBBAA
//   r = (c >>> 24) & 0xFF;  g = (c >>> 16) & 0xFF;
//   b = (c >>>  8) & 0xFF;  a =  c        & 0xFF;
//
// Coordinates: pixel (0,0) = top-left, consistent with HTML Canvas / SDL2.
//
// Batch limits: 1024 rects, 1024 lines, 512 circle fans (32 triangles each).
// On overflow: warning posted + excess primitives discarded (no crash).

const VERT_SRC = `
  attribute vec2 a_pos;
  attribute vec4 a_color;
  varying vec4 v_color;
  uniform vec2 u_res;
  void main() {
    gl_Position = vec4(
      (a_pos.x / u_res.x) * 2.0 - 1.0,
       1.0 - (a_pos.y / u_res.y) * 2.0,
      0.0, 1.0
    );
    v_color = a_color;
  }
`;
const FRAG_SRC = `
  precision mediump float;
  varying vec4 v_color;
  void main() { gl_FragColor = v_color; }
`;

const MAX_RECTS   = 1024;
const MAX_LINES   = 1024;
const MAX_CIRCLES = 512;
const CIRCLE_SEGS = 32;
const FLOATS_PER_VERT = 6;  // x, y, r, g, b, a

export class WebGL2Renderer {
  constructor(w, h) {
    this.canvas = new OffscreenCanvas(w, h);
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available in Worker');
    this.gl = gl;
    this.w  = w;
    this.h  = h;

    // Compile shaders once
    const prog = _buildProgram(gl, VERT_SRC, FRAG_SRC);
    this._prog     = prog;
    this._aPos     = gl.getAttribLocation(prog, 'a_pos');
    this._aColor   = gl.getAttribLocation(prog, 'a_color');
    this._uRes     = gl.getUniformLocation(prog, 'u_res');

    // VBO (single shared buffer, reused each frame)
    this._vbo = gl.createBuffer();

    // Pre-allocated batch buffers
    // Rects: 2 triangles × 3 verts × FLOATS_PER_VERT per rect
    this._rectBuf  = new Float32Array(MAX_RECTS   * 6 * FLOATS_PER_VERT);
    // Lines: 2 verts per line
    this._lineBuf  = new Float32Array(MAX_LINES   * 2 * FLOATS_PER_VERT);
    // Circles: CIRCLE_SEGS triangles × 3 verts per circle
    this._circBuf  = new Float32Array(MAX_CIRCLES * CIRCLE_SEGS * 3 * FLOATS_PER_VERT);

    this._rectN  = 0;  // count of rects pushed this frame
    this._lineN  = 0;
    this._circN  = 0;
    this._bgColor = [0, 0, 0, 1];  // default background: black

    gl.useProgram(prog);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  clearBackground(rgba) {
    const [r, g, b, a] = _unpackColor(rgba);
    this._bgColor = [r, g, b, a];
  }

  beginFrame() {
    const { gl } = this;
    const [r, g, b, a] = this._bgColor;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._rectN = 0;
    this._lineN = 0;
    this._circN = 0;
  }

  endFrame() {
    this._flush();
    return this.canvas.transferToImageBitmap();
  }

  drawRect(x, y, w, h, rgba) {
    if (w <= 0 || h <= 0) return;
    if (this._rectN >= MAX_RECTS) { _warnOverflow('rect'); return; }
    const [r, g, b, a] = _unpackColor(rgba);
    const off = this._rectN * 6 * FLOATS_PER_VERT;
    const buf = this._rectBuf;
    const x2 = x + w, y2 = y + h;
    // 2 triangles: (x,y), (x2,y), (x,y2)  and  (x2,y), (x2,y2), (x,y2)
    _pushVert(buf, off,                   x,  y, r, g, b, a);
    _pushVert(buf, off +   FLOATS_PER_VERT, x2,  y, r, g, b, a);
    _pushVert(buf, off + 2*FLOATS_PER_VERT,  x, y2, r, g, b, a);
    _pushVert(buf, off + 3*FLOATS_PER_VERT, x2,  y, r, g, b, a);
    _pushVert(buf, off + 4*FLOATS_PER_VERT, x2, y2, r, g, b, a);
    _pushVert(buf, off + 5*FLOATS_PER_VERT,  x, y2, r, g, b, a);
    this._rectN++;
  }

  drawLine(x0, y0, x1, y1, rgba) {
    if (this._lineN >= MAX_LINES) { _warnOverflow('line'); return; }
    const [r, g, b, a] = _unpackColor(rgba);
    const off = this._lineN * 2 * FLOATS_PER_VERT;
    _pushVert(this._lineBuf, off,                   x0, y0, r, g, b, a);
    _pushVert(this._lineBuf, off + FLOATS_PER_VERT, x1, y1, r, g, b, a);
    this._lineN++;
  }

  drawCircle(cx, cy, radius, rgba) {
    if (radius <= 0) return;
    if (this._circN >= MAX_CIRCLES) { _warnOverflow('circle'); return; }
    const [r, g, b, a] = _unpackColor(rgba);
    const buf = this._circBuf;
    let off = this._circN * CIRCLE_SEGS * 3 * FLOATS_PER_VERT;
    for (let i = 0; i < CIRCLE_SEGS; i++) {
      const t0 = (i      / CIRCLE_SEGS) * Math.PI * 2;
      const t1 = ((i + 1) / CIRCLE_SEGS) * Math.PI * 2;
      _pushVert(buf, off,                   cx,                       cy,                       r, g, b, a); off += FLOATS_PER_VERT;
      _pushVert(buf, off, cx + Math.cos(t0) * radius, cy + Math.sin(t0) * radius, r, g, b, a); off += FLOATS_PER_VERT;
      _pushVert(buf, off, cx + Math.cos(t1) * radius, cy + Math.sin(t1) * radius, r, g, b, a); off += FLOATS_PER_VERT;
    }
    this._circN++;
  }

  drawRectOutline(x, y, w, h, thick, rgba) {
    if (w <= 0 || h <= 0 || thick <= 0) return;
    this.drawRect(x,          y,           w,     thick, rgba);  // top
    this.drawRect(x,          y + h - thick, w,   thick, rgba);  // bottom
    this.drawRect(x,          y + thick,   thick, h - 2 * thick, rgba);  // left
    this.drawRect(x + w - thick, y + thick, thick, h - 2 * thick, rgba);  // right
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _flush() {
    const { gl } = this;
    gl.useProgram(this._prog);
    gl.uniform2f(this._uRes, this.w, this.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.enableVertexAttribArray(this._aPos);
    gl.enableVertexAttribArray(this._aColor);
    const stride = FLOATS_PER_VERT * 4;
    gl.vertexAttribPointer(this._aPos,   2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this._aColor, 4, gl.FLOAT, false, stride, 8);

    if (this._rectN > 0) {
      const data = this._rectBuf.subarray(0, this._rectN * 6 * FLOATS_PER_VERT);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, this._rectN * 6);
    }
    if (this._lineN > 0) {
      const data = this._lineBuf.subarray(0, this._lineN * 2 * FLOATS_PER_VERT);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.drawArrays(gl.LINES, 0, this._lineN * 2);
    }
    if (this._circN > 0) {
      const data = this._circBuf.subarray(0, this._circN * CIRCLE_SEGS * 3 * FLOATS_PER_VERT);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, this._circN * CIRCLE_SEGS * 3);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _unpackColor(rgba) {
  return [
    ((rgba >>> 24) & 0xFF) / 255,
    ((rgba >>> 16) & 0xFF) / 255,
    ((rgba >>>  8) & 0xFF) / 255,
    ( rgba         & 0xFF) / 255,
  ];
}

function _pushVert(buf, off, x, y, r, g, b, a) {
  buf[off]     = x;
  buf[off + 1] = y;
  buf[off + 2] = r;
  buf[off + 3] = g;
  buf[off + 4] = b;
  buf[off + 5] = a;
}

function _warnOverflow(type) {
  self.postMessage({ type: 'warn', message: `gfx: ${type} batch overflow (max 1024)` });
}

function _buildProgram(gl, vertSrc, fragSrc) {
  const vs = _compileShader(gl, gl.VERTEX_SHADER,   vertSrc);
  const fs = _compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Shader link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

function _compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}
