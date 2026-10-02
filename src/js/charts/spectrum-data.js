// Pure FFT-to-pixel resampling for the spectrum charts.
//
// The chart draws one point per plot pixel column. A column that contains one or more FFT bins
// shows the MAXIMUM of those bins (a narrow tone is never diluted and its column is the bin's
// column); a column narrower than one bin (low frequencies on a log axis) interpolates dB
// linearly between the two neighbouring bins at the column centre, which adds no peaks that
// the data does not have. The x values are the fixed column-centre frequencies, so the buffers
// are allocated once per configuration and reused every frame.

import { axisValue } from './axes.js';

const EPS = 1e-9;

/**
 * buildPixelMap({ binCount, binHz, minHz, maxHz, scale, count }) → map
 *   map.freq  Float64Array(count) column-centre frequencies (the chart's x data)
 *   map.lo/hi Int32Array: bins lo…hi (hi ≥ lo) → max;
 *             hi = -1 → interpolate bins lo and lo+1 by frac;
 *             lo = -1 → no data (column above the analyser's Nyquist frequency)
 */
export function buildPixelMap({ binCount, binHz, minHz, maxHz, scale = 'log', count }) {
  const n = Math.max(2, count | 0);
  const freq = new Float64Array(n);
  const lo = new Int32Array(n);
  const hi = new Int32Array(n);
  const frac = new Float32Array(n);
  const lastBin = binCount - 1;
  for (let i = 0; i < n; i++) {
    const fLo = axisValue(i / n, minHz, maxHz, scale);
    const fHi = axisValue((i + 1) / n, minHz, maxHz, scale);
    const fc = axisValue((i + 0.5) / n, minHz, maxHz, scale);
    freq[i] = fc;
    const k0 = Math.max(0, Math.ceil(fLo / binHz - EPS));
    const k1 = Math.min(lastBin, Math.ceil(fHi / binHz - EPS) - 1);
    if (k0 > lastBin) {
      lo[i] = -1;
      hi[i] = -1;
    } else if (k0 <= k1) {
      lo[i] = k0;
      hi[i] = k1;
    } else {
      const kf = fc / binHz;
      const k = Math.min(lastBin - 1, Math.max(0, Math.floor(kf)));
      lo[i] = k;
      hi[i] = -1;
      frac[i] = Math.min(1, Math.max(0, kf - k));
    }
  }
  return { count: n, freq, lo, hi, frac, binCount, binHz, minHz, maxHz, scale };
}

/**
 * Resample spectrumDb (Float32Array of bin dB values) into out (length map.count). Values below
 * floorDb (and -Infinity) are written as floorDb so the trace sits on the axis floor.
 */
export function sampleSpectrum(spectrum, map, out, floorDb = -100) {
  const { count, lo, hi, frac } = map;
  for (let i = 0; i < count; i++) {
    const a = lo[i];
    let v = -Infinity;
    if (a < 0) {
      v = -Infinity;
    } else if (hi[i] >= a) {
      for (let k = a; k <= hi[i]; k++) if (spectrum[k] > v) v = spectrum[k];
    } else {
      const s0 = spectrum[a];
      const s1 = spectrum[a + 1];
      const f = frac[i];
      if (Number.isFinite(s0) && Number.isFinite(s1)) v = s0 + (s1 - s0) * f;
      else v = Math.max(s0, s1);
    }
    out[i] = v > floorDb ? v : floorDb;
  }
  return out;
}

/** Highest bin dB within ±radiusBins of frequency f (marker readout), or null. */
export function levelNear(spectrum, f, binHz, radiusBins = 2) {
  if (!spectrum || !(f > 0) || !(binHz > 0)) return null;
  const k = Math.round(f / binHz);
  let v = -Infinity;
  const last = Math.min(spectrum.length - 1, k + radiusBins);
  for (let i = Math.max(0, k - radiusBins); i <= last; i++) {
    if (spectrum[i] > v) v = spectrum[i];
  }
  return Number.isFinite(v) ? v : null;
}

/** Index of the largest value in arr (first on ties), or -1 for an empty array. */
export function argMax(arr) {
  let best = -1;
  let v = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > v) {
      v = arr[i];
      best = i;
    }
  }
  return best;
}
