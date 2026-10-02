// L/R correlation from two time-domain buffers (e.g. the two analysers behind a channel
// splitter, see audio/stereo.js).
//
// pearson() is the Pearson coefficient (means removed): +1 identical/in phase, −1 inverted,
// ≈0 unrelated. For DC-free audio it equals the usual phase-correlation-meter formula
// Σlr / √(Σl²·Σr²). Silence in either channel makes the coefficient undefined, so null is
// returned and the UI shows UNAVAILABLE rather than a number.
//
// The two analysers are read one after the other on the main thread; their windows normally
// cover the same render quanta, but nothing guarantees it, so the value is an estimate and the
// UI labels it as such.

export const DEFAULT_SILENCE_RMS = 1e-4; // −80 dBFS

/**
 * pearson(left, right, { length, silenceRms }) → number in [−1, 1] | null
 * length defaults to the shorter buffer.
 */
export function pearson(left, right, options = {}) {
  if (!left || !right) return null;
  const n = Math.min(options.length || Infinity, left.length, right.length);
  if (!(n > 1)) return null;
  const silence = options.silenceRms != null ? options.silenceRms : DEFAULT_SILENCE_RMS;
  let sl = 0;
  let sr = 0;
  for (let i = 0; i < n; i++) {
    sl += left[i];
    sr += right[i];
  }
  const ml = sl / n;
  const mr = sr / n;
  let sll = 0;
  let srr = 0;
  let slr = 0;
  let pl = 0;
  let pr = 0;
  for (let i = 0; i < n; i++) {
    const a = left[i] - ml;
    const b = right[i] - mr;
    sll += a * a;
    srr += b * b;
    slr += a * b;
    pl += left[i] * left[i];
    pr += right[i] * right[i];
  }
  if (Math.sqrt(pl / n) < silence || Math.sqrt(pr / n) < silence) return null;
  if (!(sll > 0) || !(srr > 0)) return null; // constant (DC-only) signal: undefined
  const r = slr / Math.sqrt(sll * srr);
  return r > 1 ? 1 : r < -1 ? -1 : r;
}

/**
 * createCorrelationMeter({ timeConstantS = 0.3, silenceRms }) → meter
 *   update(left, right, nowMs) → { value, instantaneous } | null
 *   value    exponentially smoothed coefficient (frame-rate independent: α = e^(−Δt/τ))
 *   reset()
 * Silence returns null and resets the smoother, so a stale value is never shown.
 */
export function createCorrelationMeter(options = {}) {
  const tau = options.timeConstantS != null ? options.timeConstantS : 0.3;
  const silenceRms = options.silenceRms;
  let value = null;
  let lastAt = null;
  return {
    get value() {
      return value;
    },
    update(left, right, nowMs) {
      const r = pearson(left, right, { silenceRms });
      if (r == null) {
        value = null;
        lastAt = null;
        return null;
      }
      if (value == null || lastAt == null || !(tau > 0)) {
        value = r;
      } else {
        const dt = Math.max(0, (nowMs - lastAt) / 1000);
        const a = Math.exp(-dt / tau);
        value = a * value + (1 - a) * r;
      }
      lastAt = nowMs;
      return { value, instantaneous: r };
    },
    reset() {
      value = null;
      lastAt = null;
    },
  };
}

/**
 * Correlation display for a state → { text, basis, title, meterPct, meterNow, valueText }.
 *   'live'   a measured value (two analysers read one after the other: "est.")
 *   'mono'   a mono output is playing: L = R by construction, +1 without a measurement
 *   'silent' the stereo router is there but carries no signal (yet)
 *   'idle'   nothing is playing
 * A non-finite live value is shown as 'silent'.
 */
export function correlationDisplay(value, state = value == null ? 'idle' : 'live') {
  if (state === 'mono') {
    return { text: '1.00', basis: 'mono', title: 'Mono output: left and right are identical',
      meterPct: 100, meterNow: 1,
      valueText: '1.00, mono output: left and right are the same signal (by construction, '
        + 'not measured)' };
  }
  if (state === 'live' && value != null && Number.isFinite(value)) {
    const v = Math.max(-1, Math.min(1, value));
    return {
      text: v.toFixed(2),
      basis: 'est.',
      title: 'Estimated from the left and right analysers',
      meterPct: ((v + 1) / 2) * 100,
      meterNow: v,
      valueText: `${v.toFixed(2)} (estimated from the L/R analysers)`,
    };
  }
  if (state === 'live' || state === 'silent') {
    return { text: '—', basis: '', title: 'Unavailable: no signal on the stereo router yet',
      meterPct: 0, meterNow: 0, valueText: 'Unavailable (no signal on the stereo router yet)' };
  }
  return { text: '—', basis: '', title: 'Unavailable: nothing is playing', meterPct: 0,
    meterNow: 0, valueText: 'Unavailable (nothing playing)' };
}
