// Phase view in p5 (instance mode): signal A (cyan) and B (magenta) on two rows with the other
// signal faintly overlaid for comparison, plus the Lissajous figure (lissajous.js). One p5
// instance per host; it draws only when the shared frame loop asks (p.noLoop + redraw), so
// rendering follows the same rAF/visibility rules as every other chart.
//
// Modes: 'phase' (waves left, Lissajous right, as in the reference) and 'lissajous' (figure
// only, larger). The data source label ("model" or "live L/R") is drawn in the top-right
// corner so an analytic plot is never mistaken for a measurement.

import p5 from 'p5';
import { drawLissajous } from './lissajous.js';
import { chartTheme, withAlpha } from './chart-theme.js';
import { onFrame } from './frame-loop.js';

/** Draw waves { a, b, start, length, scale } into rect with row labels A and B. */
export function drawPhaseWaves(p, rect, waves, theme) {
  const labelW = 26;
  const x0 = rect.x + labelW;
  const w = Math.max(4, rect.w - labelW);
  const rowH = rect.h / 2;
  const amp = rowH * 0.36;
  p.noStroke();
  p.textSize(12);
  p.textAlign(p.LEFT, p.CENTER);
  p.fill(theme.cyan);
  p.text('A', rect.x + 2, rect.y + rowH * 0.5);
  p.fill(theme.magenta);
  p.text('B', rect.x + 2, rect.y + rowH * 1.5);
  if (!waves || !waves.a || !(waves.length > 1)) return;
  const start = waves.start || 0;
  const n = waves.length;
  const k = amp * (waves.scale || 1);
  const trace = (buf, cy, color, weight) => {
    p.noFill();
    p.stroke(color);
    p.strokeWeight(weight);
    p.beginShape();
    for (let i = 0; i < n; i++) p.vertex(x0 + (i / (n - 1)) * w, cy - buf[start + i] * k);
    p.endShape();
  };
  const yA = rect.y + rowH * 0.5;
  const yB = rect.y + rowH * 1.5;
  trace(waves.b, yA, withAlpha(theme.magenta, 0.45), 1);
  trace(waves.a, yA, theme.cyan, 1.5);
  trace(waves.a, yB, withAlpha(theme.cyan, 0.45), 1);
  trace(waves.b, yB, theme.magenta, 1.5);
}

/**
 * createPhaseStereoView(host, { getData() → { label, waves, liss }, getMode() → 'phase' |
 * 'lissajous' }) → { frame(), refreshTheme(), dispose(), instance }
 */
export function createPhaseStereoView(host, options = {}) {
  let theme = chartTheme();
  let inst = null;
  let lastSize = '';
  const sketch = (p) => {
    p.setup = () => {
      p.createCanvas(Math.max(10, host.clientWidth), Math.max(10, host.clientHeight));
      p.noLoop();
      p.textFont(theme.font);
    };
    p.draw = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      const key = `${w}x${h}`;
      if (key !== lastSize) {
        lastSize = key;
        if (p.width !== w || p.height !== h) p.resizeCanvas(w, h, true);
      }
      p.clear();
      const data = options.getData ? options.getData() : null;
      const mode = options.getMode ? options.getMode() : 'phase';
      if (mode === 'lissajous') {
        drawLissajous(p, { x: 0, y: 2, w, h: h - 4 }, data && data.liss, theme);
      } else {
        const lw = Math.min(w * 0.45, h);
        drawPhaseWaves(p, { x: 4, y: 4, w: w - lw - 18, h: h - 8 }, data && data.waves, theme);
        drawLissajous(p, { x: w - lw, y: 2, w: lw, h: h - 4 }, data && data.liss, theme);
      }
      if (data && data.label) {
        p.noStroke();
        p.fill(theme.textDim);
        p.textSize(9);
        p.textAlign(p.LEFT, p.TOP);
        p.text(data.label, 2, 0);
      }
    };
  };
  inst = new p5(sketch, host);
  const stop = onFrame(() => {
    if (inst && host.offsetParent !== null) inst.redraw();
  });
  return {
    get instance() {
      return inst;
    },
    frame() {
      if (inst) inst.redraw();
    },
    refreshTheme() {
      theme = chartTheme();
    },
    dispose() {
      stop();
      if (inst) inst.remove();
      inst = null;
    },
  };
}
