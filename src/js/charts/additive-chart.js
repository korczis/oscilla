// Additive synthesis harmonic bars (Canvas 2D). The bars are exactly the coefficients handed to
// createPeriodicWave: pass visualCoefficients(partials, { scale, … }) from audio/additive.js.
// Height = gain in dB on a 0 … -80 dB axis; a harmonic at or above the running context's
// Nyquist frequency (audible === false) is drawn hatched because the browser drops it.
// Click a bar (or use the arrow keys on the focused host) to select a harmonic.

import { formatDbTick, linearTicks } from './axes.js';
import { chartTheme, withAlpha, canvasFont, fitCanvas, observeSize } from './chart-theme.js';

const GUTTER = { left: 31, right: 6, top: 8, bottom: 25 }; // reference geometry
const LABEL_DY = 14; // harmonic numbers, px under the plot
const DEFAULTS = { minDb: -80, maxDb: 0, count: 10 };

/** Index of the bar slot under x for `count` slots across [x0, x0 + w], or -1. */
export function barSlotAt(x, x0, w, count) {
  if (!(w > 0) || x < x0 || x >= x0 + w) return -1;
  return Math.min(count - 1, Math.floor(((x - x0) / w) * count));
}

/**
 * createAdditiveChart(host, { onSelect(n), onAdjust(n, deltaDb), minDb, maxDb, count })
 *   chart.setBars(bars, selectedN)   bars: visualCoefficients() output
 *   chart.getBars() → [{ n, gainDb, audible }] as drawn (tests)
 *   chart.refreshTheme(), dispose()
 */
export function createAdditiveChart(host, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  let theme = chartTheme();
  let bars = [];
  let selected = 1;
  let size = { w: 0, h: 0 };

  function plot() {
    return {
      x: GUTTER.left,
      y: GUTTER.top,
      w: Math.max(10, size.w - GUTTER.left - GUTTER.right),
      h: Math.max(10, size.h - GUTTER.top - GUTTER.bottom),
    };
  }

  function yOf(db, p) {
    const f = (Math.min(o.maxDb, Math.max(o.minDb, db)) - o.maxDb) / (o.minDb - o.maxDb);
    return p.y + f * p.h;
  }

  function draw() {
    size = fitCanvas(canvas, host.clientWidth, host.clientHeight);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.w, size.h);
    const p = plot();
    ctx.font = canvasFont(theme, 9.5);
    ctx.textBaseline = 'middle';
    // Grid + y labels.
    for (const v of linearTicks(o.minDb, o.maxDb, { step: 20 })) {
      const y = Math.round(yOf(v, p)) + 0.5;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'right';
      ctx.fillText(formatDbTick(v, 'plain'), p.x - 8, y);
    }
    const slot = p.w / o.count;
    const bw = Math.max(2, Math.min(8, slot * 0.36));
    ctx.textAlign = 'center';
    for (let i = 0; i < o.count; i++) {
      const n = i + 1;
      const cx = p.x + slot * (i + 0.5);
      const bar = bars.find((b) => b.n === n);
      const isSel = n === selected;
      if (bar && Number.isFinite(bar.gainDb) && bar.gainDb > o.minDb) {
        const top = yOf(bar.gainDb, p);
        const x = Math.round(cx - bw / 2);
        const h = p.y + p.h - top;
        if (bar.audible === false) {
          ctx.fillStyle = withAlpha(theme.textDim, 0.35);
          ctx.fillRect(x, top, bw, h);
          ctx.strokeStyle = theme.textDim;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 0.5, top + 0.5, bw - 1, h - 1);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = isSel ? theme.blue : withAlpha(theme.blue, 0.82);
          ctx.fillRect(x, top, bw, h);
          if (isSel) {
            ctx.strokeStyle = withAlpha(theme.text, 0.75);
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 1.5, top - 1.5, bw + 3, h + 1.5);
          }
        }
      } else if (isSel) {
        ctx.fillStyle = withAlpha(theme.text, 0.5);
        ctx.fillRect(Math.round(cx - bw / 2), p.y + p.h - 2, bw, 2);
      }
      ctx.fillStyle = isSel ? theme.text : theme.textMuted;
      ctx.fillText(String(n), cx, p.y + p.h + LABEL_DY);
    }
  }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const p = plot();
    const i = barSlotAt(e.clientX - r.left, p.x, p.w, o.count);
    if (i >= 0 && o.onSelect) o.onSelect(i + 1);
  });
  host.addEventListener('keydown', (e) => {
    let handled = true;
    if (e.key === 'ArrowLeft') o.onSelect && o.onSelect(Math.max(1, selected - 1));
    else if (e.key === 'ArrowRight') o.onSelect && o.onSelect(Math.min(o.count, selected + 1));
    else if (e.key === 'Home') o.onSelect && o.onSelect(1);
    else if (e.key === 'End') o.onSelect && o.onSelect(o.count);
    else if (e.key === 'ArrowUp' && o.onAdjust) o.onAdjust(selected, 1);
    else if (e.key === 'ArrowDown' && o.onAdjust) o.onAdjust(selected, -1);
    else handled = false;
    if (handled) e.preventDefault();
  });

  const stopObserve = observeSize(host, draw);
  draw();

  return {
    setBars(next, selectedN = selected) {
      bars = next.map((b) => ({ n: b.n, gainDb: b.gainDb, audible: b.audible }));
      selected = selectedN;
      draw();
    },
    getBars() {
      return bars.map((b) => ({ ...b }));
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
