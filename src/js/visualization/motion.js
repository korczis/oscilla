// Data preparation for the frequency-over-time chart (rendered with uPlot in V2): the planned and
// played trajectory of the requested instantaneous frequency. Extracted from V1
// createSketch.drawMotion (index.html@a7b7a23, section 9); the maths are unchanged, the p5
// drawing is not carried over.

import { formatFrequencyShort } from '../core/frequency.js';
import { planFreqAt } from '../audio/patterns.js';

// V1: motion chart ticks and notes (index.html@a7b7a23)
export const MOTION_TICKS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
export const MOTION_TICK_LABELS = MOTION_TICKS.map(formatFrequencyShort);
export const FAST_FM_NOTES = ['modulation faster than the display: deviation band shown', 'too fast to draw: deviation band', 'deviation band'];

export const MOTION_TITLE = 'REQUESTED INSTANTANEOUS FREQUENCY';

/**
 * Time window: { finite, span, tStart } — a finite plan shows its whole duration, an open one
 * the last 6 s while playing (the first 6 s when idle, elapsed = 0).
 */
export function motionWindow(plan, elapsed = 0) {
  const finite = plan.kind === 'finite';
  const span = finite ? plan.dur : 6;
  const tStart = finite ? 0 : Math.max(0, elapsed - span);
  return { finite, span, tStart };
}

/** Logarithmic frequency axis bounds { lo, hi } for a plan, capped at Nyquist. */
export function motionAxis(plan, nyquist) {
  let lo = Infinity;
  let hi = 0;
  const freqs = plan.freqs;
  for (let i = 0; i < freqs.length; i++) { const f = freqs[i]; if (f < lo) lo = f; if (f > hi) hi = f; }
  if (plan.type === 'lfo' || plan.type === 'fm') { lo = Math.max(1, (plan.center || plan.freq) - plan.depth); hi = (plan.center || plan.freq) + plan.depth; }
  if (plan.type === 'dual') { lo = Math.min(plan.a.freq, plan.b.freq); hi = Math.max(plan.a.freq, plan.b.freq); }
  const mLo = Math.max(1, lo / 1.5);
  const mHi = Math.min(nyquist, Math.max(hi * 1.5, mLo * 4));
  return { lo: mLo, hi: mHi };
}

/** FM faster than the display can resolve: show the deviation band instead of the curve. */
export function isFastFm(plan, span, columns) {
  return plan.type === 'fm' && plan.modFreq * span > columns / 4;
}

/**
 * Sample the requested frequency at cols + 1 points over [tStart, tStart + span]:
 * { t: Float64Array, f: Float64Array } with NaN in silent gaps and after `until` (the played part
 * stops at the elapsed time). Pass `out` to reuse the buffers.
 */
export function sampleTrajectory(plan, tStart, span, cols, until = Infinity, out) {
  const n = Math.max(1, Math.floor(cols)) + 1;
  const res = out && out.t.length === n ? out : { t: new Float64Array(n), f: new Float64Array(n) };
  for (let c = 0; c < n; c++) {
    const t = tStart + (c / (n - 1)) * span;
    res.t[c] = t;
    const f = t > until ? null : planFreqAt(plan, t);
    res.f[c] = f == null ? NaN : f;
  }
  return res;
}
