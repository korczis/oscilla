// Pure signal maths for the Phase and Lissajous views.
//
// Model (idle): A(t) = sin(2π·fA·t), B(t) = sin(2π·fB·t + φ). The waves are shown as a
// display triggered on A's rising zero crossing, so after running for T seconds the relative
// phase seen is φ + 2π·(fB − fA)·T: exactly what a scope triggered on A would show. Live
// (stereo playing): the stereo router's L/R analyser buffers, triggered on L.

const TAU = Math.PI * 2;

/** Relative phase (radians, wrapped to [0, 2π)) of B against A after elapsed seconds. */
export function relativePhase(fA, fB, phaseDeg, elapsedS) {
  const p = (phaseDeg * Math.PI) / 180 + TAU * (fB - fA) * elapsedS;
  return ((p % TAU) + TAU) % TAU;
}

/**
 * Model waves over `cycles` periods of A: { a, b, windowS } (Float32Array, `points` samples).
 * out = { a, b } reuses buffers of the same length.
 */
export function modelWaves({ fA, fB, phaseDeg = 0, elapsedS = 0, points = 256, cycles = 2.5 },
  out = null) {
  const n = Math.max(2, points | 0);
  const a = out && out.a && out.a.length === n ? out.a : new Float32Array(n);
  const b = out && out.b && out.b.length === n ? out.b : new Float32Array(n);
  if (!(fA > 0) || !(fB > 0)) {
    a.fill(0);
    b.fill(0);
    return { a, b, windowS: 0 };
  }
  const windowS = cycles / fA;
  const phi = relativePhase(fA, fB, phaseDeg, elapsedS);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * windowS;
    a[i] = Math.sin(TAU * fA * t);
    b[i] = Math.sin(TAU * fB * t + phi);
  }
  return { a, b, windowS };
}

/**
 * Model Lissajous figure x = A(t), y = B(t) over `cycles` periods of the lower frequency:
 * { x, y } (Float32Array, `points` samples).
 */
export function modelLissajous({ fA, fB, phaseDeg = 0, elapsedS = 0, points = 512, cycles = 4 },
  out = null) {
  const n = Math.max(2, points | 0);
  const x = out && out.x && out.x.length === n ? out.x : new Float32Array(n);
  const y = out && out.y && out.y.length === n ? out.y : new Float32Array(n);
  if (!(fA > 0) || !(fB > 0)) {
    x.fill(0);
    y.fill(0);
    return { x, y };
  }
  const span = cycles / Math.min(fA, fB);
  const phi = relativePhase(fA, fB, phaseDeg, elapsedS);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * span;
    x[i] = Math.sin(TAU * fA * t);
    y[i] = Math.sin(TAU * fB * t + phi);
  }
  return { x, y };
}

/**
 * Periods of the lower frequency after which the figure x = A(t), y = B(t) closes: the
 * smallest n <= maxN for which the higher frequency also completes (within `tol` of) a whole
 * number of periods; `fallback` when the ratio is not close to a small rational. A near-unison
 * pair (440 / 442 Hz) closes after 1 period, so the trace shows the current phase relation
 * instead of several drifting loops drawn on top of each other.
 */
export function lissajousCycles(fA, fB, { maxN = 8, tol = 0.02, fallback = 4 } = {}) {
  if (!(fA > 0) || !(fB > 0)) return fallback;
  const r = Math.max(fA, fB) / Math.min(fA, fB);
  for (let n = 1; n <= maxN; n++) {
    const m = r * n;
    if (Math.abs(m - Math.round(m)) <= tol) return n;
  }
  return fallback;
}

/** Index of the first rising zero crossing in buf[0 … limit), or 0 when there is none. */
export function risingZeroCrossing(buf, limit = buf.length) {
  const end = Math.min(limit, buf.length) - 1;
  for (let i = 0; i < end; i++) if (buf[i] <= 0 && buf[i + 1] > 0) return i + 1;
  return 0;
}

/** Peak |value| over both buffers (for a common Lissajous scale); 0 for silence. */
export function commonPeak(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > m) m = v;
  }
  for (let i = 0; i < b.length; i++) {
    const v = Math.abs(b[i]);
    if (v > m) m = v;
  }
  return m;
}
