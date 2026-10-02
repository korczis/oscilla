// ADSR envelope graph (Canvas 2D). The curve is envelopePoints(adsr) from audio/envelope.js —
// the same closed-form automation the voice schedules — on a linear time axis. Handles: A
// (orange, peak), D (green, decay end: time and sustain level), S (green, sustain level) and R
// (magenta, release end). Dragging a handle emits onChange(adsr); the time scale is frozen for
// the duration of a drag so the axis does not move under the pointer. The shell's sliders and
// fields are the keyboard alternative.

import { envelopePoints } from '../audio/envelope.js';
import { adsrLayout, hitAdsrHandle, dragAdsr, clampAdsr } from './drag-math.js';
import { chartTheme, withAlpha, canvasFont, fitCanvas, observeSize } from './chart-theme.js';

const PAD = { left: 7, right: 9, top: 14, bottom: 9 };
const LABEL_H = 22;

/**
 * createEnvelopeGraph(host, { adsr, onChange(adsr) }) → graph
 *   graph.setAdsr(adsr), setEnabled(on), getLayout() (handle pixel positions; tests),
 *   refreshTheme(), dispose()
 */
export function createEnvelopeGraph(host, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.touchAction = 'none';
  host.appendChild(canvas);
  let theme = chartTheme();
  let adsr = clampAdsr(options.adsr || { a: 0.01, d: 0.1, s: 0.6, r: 0.3 });
  let enabled = true;
  let size = { w: 0, h: 0 };
  let frozen = null; // { spanS, holdS } during a drag
  let drag = null;
  let layout = null;

  function plotRect() {
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(10, size.w - PAD.left - PAD.right),
      h: Math.max(10, size.h - LABEL_H - PAD.top - PAD.bottom),
    };
  }

  function draw() {
    size = fitCanvas(canvas, host.clientWidth, host.clientHeight);
    const ctx = canvas.getContext('2d');
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    const inset = { x: 0.5, y: 0.5, w: w - 1, h: h - LABEL_H - 1 };
    // Inset background and grid.
    ctx.fillStyle = theme.surface0;
    ctx.strokeStyle = theme.borderSoft;
    ctx.lineWidth = 1;
    roundRect(ctx, inset.x, inset.y, inset.w, inset.h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = theme.grid;
    for (let i = 1; i < 4; i++) {
      const x = Math.round(inset.x + (inset.w * i) / 4) + 0.5;
      line(ctx, x, inset.y + 1, x, inset.y + inset.h - 1);
    }
    for (let i = 1; i < 3; i++) {
      const y = Math.round(inset.y + (inset.h * i) / 3) + 0.5;
      line(ctx, inset.x + 1, y, inset.x + inset.w - 1, y);
    }

    const rect = plotRect();
    layout = adsrLayout(adsr, rect, frozen || {});
    const pts = envelopePoints(adsr, { holdS: layout.holdS, samples: 200 });
    const { toX, toY, handles } = layout;
    const tA = handles.attack.t;
    const tS = handles.sustain.t;

    ctx.save();
    roundRect(ctx, inset.x, inset.y, inset.w, inset.h, 4);
    ctx.clip();
    // Faint fill under the whole curve.
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    for (let i = 0; i < pts.t.length; i++) ctx.lineTo(toX(pts.t[i]), toY(pts.v[i]));
    ctx.lineTo(toX(pts.totalS), toY(0));
    ctx.closePath();
    ctx.fillStyle = withAlpha(theme.green, enabled ? 0.07 : 0.03);
    ctx.fill();

    // Segment strokes.
    const seg = (t0, t1, style) => {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.t.length; i++) {
        const t = pts.t[i];
        if (t < t0 - 1e-9 || t > t1 + 1e-9) continue;
        const x = toX(t);
        const y = toY(pts.v[i]);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = style;
      ctx.stroke();
    };
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    const dim = (c) => (enabled ? c : theme.textDim);
    seg(0, tA, dim(vGradient(ctx, toY(0), toY(1), theme.magenta, theme.orange)));
    seg(tA, tS, dim(theme.green));
    seg(tS, pts.totalS, dim(vGradient(ctx, toY(adsr.s), toY(0), theme.trace, theme.magenta)));

    // Handles.
    const dot = (p, c) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.25, 0, Math.PI * 2);
      ctx.fillStyle = dim(c);
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = theme.surface0;
      ctx.stroke();
    };
    dot({ x: toX(0), y: toY(0) }, theme.magenta); // start (not draggable)
    dot(handles.attack, theme.orange);
    dot(handles.decay, theme.green);
    dot(handles.sustain, theme.green);
    dot(handles.release, theme.magenta);
    ctx.restore();

    // Segment labels under the inset: A at the attack start, D at the decay start, S at the
    // sustain mid-point, R at the release start (reference shows A, D, R).
    ctx.font = canvasFont(theme, theme.fs2xs);
    ctx.fillStyle = theme.text2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const ly = inset.y + inset.h + LABEL_H / 2 + 6;
    const labels = [
      ['A', toX(0) + 4],
      ['D', toX(tA) + 6],
      ['R', toX(tS) + 4],
    ];
    let lastRight = -Infinity;
    for (const [text, x] of labels) {
      const lx = Math.max(x, lastRight + 9);
      ctx.fillText(text, lx, ly);
      lastRight = lx;
    }
  }

  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!layout || e.button > 0) return;
    const p = pointer(e);
    const handle = hitAdsrHandle(layout, p.x, p.y, 10);
    if (!handle) return;
    frozen = { spanS: layout.spanS, holdS: layout.holdS };
    drag = { id: e.pointerId, handle, x0: p.x, y0: p.y, start: { ...adsr }, layout };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* optional */
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointer(e);
    if (!drag) {
      canvas.style.cursor = layout && hitAdsrHandle(layout, p.x, p.y, 10) ? 'grab' : '';
      return;
    }
    if (e.pointerId !== drag.id) return;
    const next = dragAdsr(drag.handle, drag.start, p.x - drag.x0, p.y - drag.y0, drag.layout,
      plotRect().h);
    adsr = next;
    draw();
    if (options.onChange) options.onChange({ ...next });
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    frozen = null;
    draw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const stopObserve = observeSize(host, draw);
  draw();

  return {
    get adsr() {
      return { ...adsr };
    },
    setAdsr(next) {
      adsr = clampAdsr({ ...adsr, ...next });
      if (!drag) draw();
    },
    setEnabled(on) {
      enabled = !!on;
      draw();
    },
    getLayout() {
      return layout ? { ...layout, rect: plotRect() } : null;
    },
    refreshTheme() {
      theme = chartTheme();
      draw();
    },
    dispose() {
      stopObserve();
      canvas.remove();
    },
  };
}

function line(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function vGradient(ctx, yBottom, yTop, cBottom, cTop) {
  const g = ctx.createLinearGradient(0, yBottom, 0, yTop - 0.01);
  g.addColorStop(0, cBottom);
  g.addColorStop(1, cTop);
  return g;
}

export function roundRect(ctx, x, y, w, h, r) {
  // A hidden panel measures 0 or negative; arcTo throws IndexSizeError on a negative radius.
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
