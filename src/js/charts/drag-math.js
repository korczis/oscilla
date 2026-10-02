// Pure pointer maths for the editable charts (filter handle, ADSR handles). No DOM.

import { axisValue, axisFraction, clamp } from './axes.js';

// ------------------------------------------------------------------ filter handle

export const FILTER_DRAG = Object.freeze({
  minHz: 20,
  maxHz: 20000,
  qMin: 0.1,
  qMax: 30,
  pxPerQDoubling: 40, // dragging up by 40 px doubles Q
  wheelPerQDoubling: 400, // 400 units of wheel deltaY halve/double Q
});

/** Cutoff (Hz) under plot x (CSS px from the plot's left edge) on a log axis. */
export function cutoffFromX(x, plotWidth, minHz = FILTER_DRAG.minHz, maxHz = FILTER_DRAG.maxHz) {
  if (!(plotWidth > 0)) return minHz;
  return axisValue(clamp(x / plotWidth, 0, 1), minHz, maxHz, 'log');
}

/** Plot x of a cutoff frequency (inverse of cutoffFromX). */
export function xFromCutoff(f, plotWidth, minHz = FILTER_DRAG.minHz, maxHz = FILTER_DRAG.maxHz) {
  return axisFraction(clamp(f, minHz, maxHz), minHz, maxHz, 'log') * plotWidth;
}

/** Q after a vertical drag of dy px (screen y grows downwards; dragging up raises Q). */
export function qFromDrag(q0, dy, opts = {}) {
  const o = { ...FILTER_DRAG, ...opts };
  return clamp(q0 * 2 ** (-dy / o.pxPerQDoubling), o.qMin, o.qMax);
}

/** Q after a wheel event (deltaY > 0, scrolling down, lowers Q). */
export function qFromWheel(q0, deltaY, opts = {}) {
  const o = { ...FILTER_DRAG, ...opts };
  return clamp(q0 * 2 ** (-deltaY / o.wheelPerQDoubling), o.qMin, o.qMax);
}

// ------------------------------------------------------------------ ADSR handles

export const ADSR_LIMITS = Object.freeze({
  a: [0.001, 2],
  d: [0.001, 5],
  s: [0, 1],
  r: [0.001, 5],
});

/** Clamp an ADSR (seconds, sustain 0…1) to ADSR_LIMITS. */
export function clampAdsr(adsr) {
  return {
    a: clamp(adsr.a, ...ADSR_LIMITS.a),
    d: clamp(adsr.d, ...ADSR_LIMITS.d),
    s: clamp(adsr.s, ...ADSR_LIMITS.s),
    r: clamp(adsr.r, ...ADSR_LIMITS.r),
  };
}

/** Hold time the graph uses between decay end and release (as envelope.js envelopePoints). */
export function defaultHoldS(adsr) {
  return Math.max(adsr.a + adsr.d, adsr.r) / 2;
}

/**
 * Pixel layout of an ADSR graph. rect: { x, y, w, h } plot area (CSS px), level 1 at the top,
 * 0 at the bottom; time 0 at the left, spanS at the right edge.
 * Returns { pxPerS, spanS, holdS, toX(t), toY(v), handles: { attack, decay, sustain, release } }
 * where each handle is { x, y, t, v }.
 */
export function adsrLayout(adsr, rect, { spanS, holdS } = {}) {
  const hold = holdS != null ? holdS : defaultHoldS(adsr);
  const total = adsr.a + adsr.d + hold + adsr.r;
  const span = spanS > 0 ? spanS : total;
  const pxPerS = rect.w / span;
  const toX = (t) => rect.x + t * pxPerS;
  const toY = (v) => rect.y + (1 - v) * rect.h;
  const tA = adsr.a;
  const tD = adsr.a + adsr.d;
  const tS = tD + hold;
  const tR = tS + adsr.r;
  const h = (t, v) => ({ t, v, x: toX(t), y: toY(v) });
  return {
    pxPerS,
    spanS: span,
    holdS: hold,
    totalS: total,
    toX,
    toY,
    handles: {
      attack: h(tA, 1),
      decay: h(tD, adsr.s),
      sustain: h(tS, adsr.s),
      release: h(tR, 0),
    },
  };
}

/** Name of the handle within radius px of (x, y), nearest first, or null. */
export function hitAdsrHandle(layout, x, y, radius = 9) {
  let best = null;
  let bestD = radius * radius;
  // Later handles win ties so a collapsed attack (a≈0) can still be separated by dragging decay.
  for (const name of ['attack', 'decay', 'sustain', 'release']) {
    const p = layout.handles[name];
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * New ADSR after dragging `handle` by (dx, dy) px from the drag start. start: the ADSR when the
 * drag began; layout: adsrLayout(start, …) frozen at drag start (so the scale does not move
 * under the pointer). attack: x → a; decay: x → d, y → s; sustain: y → s; release: x → r.
 */
export function dragAdsr(handle, start, dx, dy, layout, plotHeight) {
  const dt = dx / layout.pxPerS;
  const dv = plotHeight > 0 ? -dy / plotHeight : 0;
  const next = { ...start };
  if (handle === 'attack') next.a = start.a + dt;
  else if (handle === 'decay') {
    next.d = start.d + dt;
    next.s = start.s + dv;
  } else if (handle === 'sustain') next.s = start.s + dv;
  else if (handle === 'release') next.r = start.r + dt;
  return clampAdsr(next);
}
