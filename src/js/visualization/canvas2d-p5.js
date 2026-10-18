// SPIKE (plan issue E012, branch spike/p5-canvas2d, never merged): a Canvas2D adapter for the
// subset of the p5.js 1.11 instance-mode API the OSCILLA views call, so the build can drop the
// verbatim p5 block. It mirrors p5's Renderer2D for those calls (defaults, font string, style
// caching, resizeCanvas keeping the context state, the rAF loop with p5's 5 ms frame epsilon);
// anything else p5 offers is absent on purpose.
//
//   const inst = new P5Lite(sketch, container);   // same contract as `new p5(sketch, node)`

const LEFT = 'left';
const RIGHT = 'right';
const CENTER = 'center';
const TOP = 'top';
const BOTTOM = 'bottom';
const BASELINE = 'alphabetic';
const NORMAL = 'normal';
const BOLD = 'bold';
const ITALIC = 'italic';
const CLOSE = 'close';
const DEFAULT_FILL = '#FFFFFF';
const DEFAULT_STROKE = '#000000';
const DEFAULT_TEXT_FILL = '#000000';

/** The p5.Color subset the views use: toString() as p5 formats it, and setAlpha(). */
class Color {
  constructor(r, g, b, a = 255) {
    this.levels = [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
    this._css = '';
  }

  setAlpha(a) {
    this.levels[3] = Math.round(a);
    this._css = '';
  }

  toString() {
    if (!this._css) {
      const [r, g, b, a] = this.levels;
      this._css = `rgba(${r},${g},${b},${a / 255})`;
    }
    return this._css;
  }
}

const RGBA = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** p.color(...): (r, g, b[, a]), (gray[, a]), a p5 Color, or a CSS rgb()/rgba()/#hex string. */
function makeColor(args) {
  const a0 = args[0];
  if (a0 instanceof Color) return new Color(...a0.levels);
  if (typeof a0 === 'string') {
    const s = a0.trim();
    let m = RGBA.exec(s);
    if (m) return new Color(+m[1], +m[2], +m[3], m[4] === undefined ? 255 : +m[4] * 255);
    m = HEX.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      const n = parseInt(h.slice(0, 6), 16);
      const al = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
      return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, al);
    }
    throw new Error(`canvas2d-p5: unsupported colour ${JSON.stringify(a0)}`);
  }
  if (args.length >= 3) return new Color(args[0], args[1], args[2], args[3] ?? 255);
  return new Color(a0, a0, a0, args[1] ?? 255);
}

/** A fill or stroke argument as a CSS colour (strings pass through: the context parses them). */
function cssOf(args) {
  const a0 = args[0];
  if (args.length === 1 && (typeof a0 === 'string' || a0 instanceof Color)) return String(a0);
  return makeColor(args).toString();
}

let canvasSeq = 0;

export default class P5Lite {
  constructor(sketch, node) {
    this._node = typeof node === 'string' ? document.getElementById(node) : node;
    this._loop = true;
    this._setupDone = false;
    this._inUserDraw = false;
    this._targetFrameRate = 60;
    this._frameRate = 0;
    this._lastTargetFrameTime = 0;
    this._lastRealFrameTime = 0;
    this._millisStart = -1;
    this._raf = 0;
    this._pixelDensity = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._shape = [];
    this.frameCount = 0;
    this.width = 0;
    this.height = 0;
    this.canvas = null;
    this.drawingContext = null;
    this._draw = this._draw.bind(this);
    sketch(this);
    if (document.readyState === 'complete') this._start();
    else {
      this._startListener = () => this._start();
      window.addEventListener('load', this._startListener, false);
    }
  }

  // ------------------------------------------------------------------------- lifecycle
  _start() {
    this._startListener = null;
    this._createDefaultCanvas(100, 100);
    this._millisStart = performance.now();
    if (typeof this.setup === 'function') this.setup();
    this.canvas.style.visibility = '';
    this._lastTargetFrameTime = performance.now();
    this._lastRealFrameTime = performance.now();
    this._setupDone = true;
    this._draw();
  }

  _draw(rafTime) {
    const now = rafTime || performance.now();
    const target = 1000 / this._targetFrameRate;
    if (!this._loop || now - this._lastTargetFrameTime >= target - 5) {
      this.deltaTime = now - this._lastRealFrameTime;
      this._frameRate = 1000 / this.deltaTime;
      this.redraw();
      this._lastTargetFrameTime = Math.max(this._lastTargetFrameTime + target, now);
      this._lastRealFrameTime = now;
    }
    if (this._loop) this._raf = window.requestAnimationFrame(this._draw);
  }

  redraw() {
    if (this._inUserDraw || !this._setupDone || typeof this.draw !== 'function') return;
    this._resetMatrix();
    this.frameCount += 1;
    this._inUserDraw = true;
    try {
      this.draw();
    } finally {
      this._inUserDraw = false;
    }
  }

  loop() {
    if (!this._loop) {
      this._loop = true;
      if (this._setupDone) this._draw();
    }
  }

  noLoop() {
    this._loop = false;
  }

  remove() {
    if (this._startListener) window.removeEventListener('load', this._startListener, false);
    this._loop = false;
    if (this._raf) window.cancelAnimationFrame(this._raf);
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  millis() {
    return this._millisStart === -1 ? 0 : performance.now() - this._millisStart;
  }

  frameRate(fps) {
    if (fps === undefined) return this._frameRate;
    if (typeof fps === 'number' && fps > 0) this._targetFrameRate = fps;
    return this;
  }

  // ------------------------------------------------------------------------- canvas
  _createDefaultCanvas(w, h) {
    const c = document.createElement('canvas');
    while (document.getElementById(`defaultCanvas${canvasSeq}`)) canvasSeq++;
    c.id = `defaultCanvas${canvasSeq}`;
    c.classList.add('p5Canvas');
    c.style.visibility = 'hidden';
    (this._node || document.body).appendChild(c);
    this.canvas = c;
    this.drawingContext = c.getContext('2d');
    this._resize(w, h);
    this._applyDefaults();
  }

  _applyDefaults() {
    this._doFill = true;
    this._doStroke = true;
    this._fillSet = false;
    this._strokeSet = false;
    this._fillStyle = '';
    this._strokeStyle = '';
    this._setFill(DEFAULT_FILL);
    this._setStroke(DEFAULT_STROKE);
    this._textSize = 12;
    this._textFont = 'sans-serif';
    this._textStyle = NORMAL;
    this._textAlign = LEFT;
    this._textBaseline = BASELINE;
    this.drawingContext.lineCap = 'round';
    this.drawingContext.font = 'normal 12px sans-serif';
  }

  _resize(w, h) {
    const c = this.canvas;
    this.width = w;
    this.height = h;
    c.width = w * this._pixelDensity;
    c.height = h * this._pixelDensity;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    this.drawingContext.scale(this._pixelDensity, this._pixelDensity);
  }

  _resetMatrix() {
    const d = this._pixelDensity;
    this.drawingContext.setTransform(d, 0, 0, d, 0, 0);
  }

  createCanvas(w, h) {
    this._resize(w, h);
    this._applyDefaults();
    return { elt: this.canvas };
  }

  resizeCanvas(w, h, noRedraw) {
    const ctx = this.drawingContext;
    const props = {};
    for (const key in ctx) {
      const v = ctx[key];
      if (typeof v !== 'object' && typeof v !== 'function') props[key] = v;
    }
    this._resize(w, h);
    for (const key in props) {
      try { ctx[key] = props[key]; } catch (e) { /* read-only */ }
    }
    if (!noRedraw) this.redraw();
  }

  pixelDensity(d) {
    if (typeof d !== 'number') return this._pixelDensity;
    this._pixelDensity = d;
    this.resizeCanvas(this.width, this.height, true);
    return this;
  }

  // ------------------------------------------------------------------------- colour and style
  color(...args) {
    return makeColor(args);
  }

  _setFill(css) {
    if (css !== this._fillStyle) {
      this._fillStyle = css;
      this.drawingContext.fillStyle = css;
    }
  }

  _setStroke(css) {
    if (css !== this._strokeStyle) {
      this._strokeStyle = css;
      this.drawingContext.strokeStyle = css;
    }
  }

  fill(...args) {
    this._doFill = true;
    this._fillSet = true;
    this._setFill(cssOf(args));
  }

  noFill() {
    this._doFill = false;
  }

  stroke(...args) {
    this._doStroke = true;
    this._strokeSet = true;
    this._setStroke(cssOf(args));
  }

  noStroke() {
    this._doStroke = false;
  }

  strokeWeight(w) {
    this.drawingContext.lineWidth = w === 0 || w === undefined ? 0.0001 : w;
  }

  background(...args) {
    const ctx = this.drawingContext;
    ctx.save();
    this._resetMatrix();
    ctx.fillStyle = cssOf(args);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  clear() {
    const ctx = this.drawingContext;
    ctx.save();
    this._resetMatrix();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  // ------------------------------------------------------------------------- shapes
  _paint(close) {
    const ctx = this.drawingContext;
    if (close) ctx.closePath();
    if (this._doFill) ctx.fill();
    if (this._doStroke) ctx.stroke();
  }

  line(x1, y1, x2, y2) {
    if (!this._doStroke) return this;
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return this;
  }

  rect(x, y, w, h, r) {
    if (!this._doFill && !this._doStroke) return this;
    const ctx = this.drawingContext;
    ctx.beginPath();
    if (r === undefined) ctx.rect(x, y, w, h);
    else {
      const aw = Math.abs(w);
      const ah = Math.abs(h);
      let t = r;
      if (aw < 2 * t) t = aw / 2;
      if (ah < 2 * t) t = ah / 2;
      ctx.roundRect(x, y, w, h, [t, t, t, t]);
    }
    this._paint(false);
    return this;
  }

  circle(x, y, d) {
    if (!this._doFill && !this._doStroke) return this;
    const ctx = this.drawingContext;
    const r = Math.abs(d) / 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r, 0, 0, 2 * Math.PI);
    this._paint(true);
    return this;
  }

  beginShape() {
    this._shape.length = 0;
  }

  vertex(x, y) {
    this._shape.push(x, y);
  }

  endShape(mode) {
    const v = this._shape;
    if (v.length < 4 || (!this._doFill && !this._doStroke)) {
      v.length = 0;
      return this;
    }
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(v[0], v[1]);
    for (let i = 2; i < v.length; i += 2) ctx.lineTo(v[i], v[i + 1]);
    if (mode === CLOSE) ctx.lineTo(v[0], v[1]);
    this._paint(mode === CLOSE);
    v.length = 0;
    return this;
  }

  bezier(x1, y1, x2, y2, x3, y3, x4, y4) {
    if (!this._doFill && !this._doStroke) return this;
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x2, y2, x3, y3, x4, y4);
    this._paint(false);
    return this;
  }

  bezierPoint(a, b, c, d, t) {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  }

  // ------------------------------------------------------------------------- text
  _applyText() {
    let name = this._textFont || 'sans-serif';
    if (/\s/.test(name)) name = `"${name}"`;
    const ctx = this.drawingContext;
    ctx.font = `${this._textStyle || NORMAL} ${this._textSize || 12}px ${name}`;
    ctx.textAlign = this._textAlign;
    ctx.textBaseline = this._textBaseline === CENTER ? 'middle' : this._textBaseline;
  }

  textSize(s) {
    if (s === undefined) return this._textSize;
    this._textSize = s;
    this._applyText();
    return this;
  }

  textFont(f) {
    if (f === undefined) return this._textFont;
    this._textFont = f;
    this._applyText();
    return this;
  }

  textStyle(s) {
    if (s === undefined) return this._textStyle;
    this._textStyle = s;
    this._applyText();
    return this;
  }

  textAlign(h, v) {
    if (h === undefined) return { horizontal: this._textAlign, vertical: this._textBaseline };
    this._textAlign = h;
    if (v !== undefined) this._textBaseline = v;
    this._applyText();
    return this;
  }

  textWidth(s) {
    return this.drawingContext.measureText(String(s)).width;
  }

  text(str, x, y) {
    if (!this._doFill && !this._doStroke) return this;
    const ctx = this.drawingContext;
    const s = String(str);
    if (this._doStroke && this._strokeSet) ctx.strokeText(s, x, y);
    if (this._doFill) {
      if (!this._fillSet) {
        ctx.save();
        ctx.fillStyle = DEFAULT_TEXT_FILL;
        ctx.fillText(s, x, y);
        ctx.restore();
      } else ctx.fillText(s, x, y);
    }
    return this;
  }
}

Object.assign(P5Lite.prototype, {
  LEFT, RIGHT, CENTER, TOP, BOTTOM, BASELINE, NORMAL, BOLD, ITALIC, CLOSE,
});
P5Lite.Color = Color;
