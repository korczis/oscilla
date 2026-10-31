// Whether the output ceiling acts (T001, ADR 0002). The engine's WaveShaper ceiling flattens
// every sample beyond ±MAX_OUTPUT_GAIN; a filter boost, an envelope overshoot or a sum of
// voices can push the signal before it past the cap, and the gain readout (a setpoint) cannot
// show that. The engine taps the signal just before the ceiling (an AnalyserNode on `trim`,
// read-only) and the visualization bridge judges each window it reads here.
//
// A sample counts as clipped only when its magnitude is above the cap by more than
// CEILING_TOLERANCE_ABS (2^-20, about 1e-6): float32 rounding through the gain chain puts the
// peak of a full-scale tone a few ulps from the cap, and the ceiling passes such a sample
// unchanged. A tone at or below the cap is never reported, however many of its samples sit
// near the peak (a 20 Hz sine).

/** Absolute tolerance above the cap before a sample counts as clipped (2^-20). */
export const CEILING_TOLERANCE_ABS = 2 ** -20;

/**
 * The window of the pre-ceiling tap: the smallest power of two that covers `seconds` at the
 * context's rate (Web Audio fftSize bounds, 32 to 32768). The bridge reads the tap at least
 * every 100 ms while a voice plays (its label timer), so 0.12 s leaves no gap at any rate.
 */
export function ceilingTapSize(sampleRate, seconds = 0.12) {
  const want = Math.max(32, Math.ceil((Number(sampleRate) || 0) * seconds));
  let n = 32;
  while (n < want && n < 32768) n *= 2;
  return n;
}

/**
 * Judge one window of the signal before the ceiling.
 *   pre  Float32Array (or array) of samples read from the tap; null/empty = no signal read
 *   cap  the ceiling (MAX_OUTPUT_GAIN), linear full scale
 *   out  optional object to fill (allocation-free per frame)
 * Returns { acting, peak, over, total, fraction }: `acting` when any sample is above the cap
 * (beyond the tolerance), `peak` the largest |x| of the window (linear, before the ceiling),
 * `over` the count of samples the ceiling flattens and `fraction` over / total.
 */
export function ceilingState({ pre, cap } = {}, out) {
  const o = out || {};
  const n = pre && pre.length ? pre.length : 0;
  const limit = Number(cap) + CEILING_TOLERANCE_ABS;
  let peak = 0;
  let over = 0;
  if (n && Number.isFinite(limit)) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(pre[i]);
      if (a > peak) peak = a;
      if (a > limit) over++;
    }
  }
  o.acting = over > 0;
  o.peak = peak;
  o.over = over;
  o.total = n;
  o.fraction = n ? over / n : 0;
  return o;
}
