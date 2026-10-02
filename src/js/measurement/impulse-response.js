// Impulse response from a log-sweep measurement (spec §37-§42, §214). Algorithm ID:
// 'oscilla.ir.log-sweep.v1'.
//
// Primary method, 'spectral' (default): h = IDFT(H), H the regularized spectral division of
// transfer.js (Müller & Massarani 2001, JAES 49(6), §5), so the IR and the transfer function
// are the same estimate seen in two domains and share one regularization (−60 dB re max|X|²
// in band, 0 dB outside, 1/3-octave raised-cosine transitions). The DFT length N ≥ len(x) +
// len(y) leaves no circular wrap: lags 0 … len(y) − 1 are the causal part, negative lags wrap to
// the end of the buffer.
//
// Alternative, 'farina-inverse' (Farina 2000, "Simultaneous measurement of impulse response
// and distortion with a swept-sine technique", AES 108th Convention, preprint 5093): h = y ∗ f,
// f the supplied inverse filter (the time-reversed sweep with its −6 dB/octave envelope, same
// length as the stimulus). Linear convolution via the same N-point DFT; the linear IR then
// starts at output index len(x) − 1, which is removed. Scale: divided by g, the median of
// |X[k]·F[k]| over bins half an octave inside [f1, f2], so a unity system reads unity in band
// whatever constant the inverse was built with.
//
// For an exponential sweep both methods place the harmonic-distortion responses at negative
// time (Farina 2000, §3); keeping only the causal part keeps the linear IR. The result is
// band-limited to [f1, f2]: a unity system gives a band-limited pulse, not a single unit sample,
// and its peak value is about (f2 − f1)/(fs/2).
//
// Time origin (§214): samples[0] is capture sample `start`, start = max(0, lagSamples − 5 ms)
// when an alignment lag is given (the guard keeps the pulse's precursor), else 0.
// captureOffsetS = start / fs is the absolute offset, peakIndex indexes samples (largest |h|),
// peakTimeS = peakIndex / fs is relative to samples[0]; absolute peak time is their sum. The
// full causal length is kept (len(y) − start samples, original scale, sign kept) for later
// ETC / Schroeder / RT60 / EDT work.
//
// noiseFloorDb: 10·log10(mean h² over the last 10 % of the samples after the peak / h_peak²) —
// the late-tail energy relative to the peak, floored at −300 dB.
//
// irWindow and normalizeIr never modify an IrResult: they return new objects (§40, §41).

import { powerToDb, realPairSpectra, spectralDeconvolution, ZERO_POWER_DB } from './transfer.js';
import { ALGORITHMS } from './algorithms.js';

export const IR_ALGORITHM = ALGORITHMS.ir;
export const IR_PRE_GUARD_S = 0.005;
export const IR_TAIL_FRACTION = 0.1;

/** Real time signal from a Hermitian half spectrum: x = Re(DFT(conj(H))) / N. */
function inverseReal(fft, hRe, hIm) {
  const n = fft.size;
  const half = n / 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= half; k++) {
    re[k] = hRe[k];
    im[k] = -hIm[k];
  }
  for (let k = 1; k < half; k++) {
    re[n - k] = hRe[k];
    im[n - k] = hIm[k];
  }
  fft.forward(re, im);
  for (let i = 0; i < n; i++) re[i] /= n;
  return re;
}

function median(values) {
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function farinaDeconvolution({ stimulus, captured, sampleRate, f1, f2, inverse }) {
  if (!(inverse instanceof Float32Array) && !(inverse instanceof Float64Array))
    throw new TypeError("method 'farina-inverse' needs inverse: Float32Array");
  // Reuse the spectral path for validation, X and the FFT plan.
  const base = spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2 });
  const { fft, fftSize, binHz, half, xRe, xIm, yRe, yIm } = base;
  if (inverse.length !== stimulus.length)
    throw new RangeError('inverse must have the stimulus length (time-reversed sweep)');
  const { aRe: fRe, aIm: fIm } = realPairSpectra(fft, inverse, null);
  const lo = Math.ceil((f1 * Math.SQRT2) / binHz);
  const hi = Math.min(half, Math.floor(Math.min(f2, sampleRate / 2) / Math.SQRT2 / binHz));
  const mags = [];
  for (let k = lo; k <= hi; k++) {
    mags.push(Math.hypot(xRe[k] * fRe[k] - xIm[k] * fIm[k], xRe[k] * fIm[k] + xIm[k] * fRe[k]));
  }
  if (mags.length === 0) throw new RangeError('band too narrow for the farina-inverse gain');
  const g = median(mags);
  const hRe = new Float64Array(half + 1);
  const hIm = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    hRe[k] = (yRe[k] * fRe[k] - yIm[k] * fIm[k]) / g;
    hIm[k] = (yRe[k] * fIm[k] + yIm[k] * fRe[k]) / g;
  }
  const full = inverseReal(fft, hRe, hIm);
  return { full, shift: stimulus.length - 1, fftSize };
}

/**
 * computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method,
 *   lagSamples }) -> IrResult (docs/v3/architecture.md) plus `method` and `fftSize`.
 *   method      'spectral' (default) | 'farina-inverse' (requires `inverse`)
 *   lagSamples  optional alignment of the stimulus start in the capture (align().lagSamples)
 */
export function computeImpulseResponse({
  stimulus,
  captured,
  sampleRate,
  f1,
  f2,
  inverse = null,
  method = 'spectral',
  lagSamples,
}) {
  if (lagSamples !== undefined && !(Number.isFinite(lagSamples) && lagSamples >= 0))
    throw new RangeError(`lagSamples must be a finite number ≥ 0, got ${lagSamples}`);
  let full;
  let shift = 0;
  let fftSize;
  if (method === 'spectral') {
    const dec = spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2 });
    full = inverseReal(dec.fft, dec.hRe, dec.hIm);
    fftSize = dec.fftSize;
  } else if (method === 'farina-inverse') {
    ({ full, shift, fftSize } = farinaDeconvolution({
      stimulus, captured, sampleRate, f1, f2, inverse,
    }));
  } else {
    throw new RangeError(`unknown IR method '${method}'`);
  }
  const guard = Math.round(IR_PRE_GUARD_S * sampleRate);
  const start = lagSamples === undefined
    ? 0
    : Math.min(captured.length - 1, Math.max(0, Math.round(lagSamples) - guard));
  const length = captured.length - start;
  const samples = new Float32Array(length);
  let peakIndex = 0;
  let peakAbs = -1;
  for (let i = 0; i < length; i++) {
    const v = full[start + i + shift];
    samples[i] = v;
    const a = Math.abs(v);
    if (a > peakAbs) {
      peakAbs = a;
      peakIndex = i;
    }
  }
  return {
    algorithm: IR_ALGORITHM,
    method,
    sampleRate,
    samples,
    peakIndex,
    peakTimeS: peakIndex / sampleRate,
    captureOffsetS: start / sampleRate,
    noiseFloorDb: tailFloorDb(samples, peakIndex),
    window: null,
    fftSize,
  };
}

function tailFloorDb(samples, peakIndex) {
  const peak = Math.abs(samples[peakIndex]);
  if (!(peak > 0)) return ZERO_POWER_DB;
  const after = samples.length - peakIndex - 1;
  const count = Math.max(1, Math.floor(after * IR_TAIL_FRACTION));
  if (after < 1) return ZERO_POWER_DB;
  let s = 0;
  for (let i = samples.length - count; i < samples.length; i++) s += samples[i] * samples[i];
  return powerToDb(s / count / (peak * peak));
}

/**
 * irWindow(ir, t0, t1): a NEW IrResult-shaped view selecting [t0, t1) seconds on the IR's own
 * time axis (the axis of peakTimeS). `samples` stays the untouched original; the selection is
 * a copy in `view.samples` with its index bounds, so the original is never cropped (§40).
 */
export function irWindow(ir, t0, t1) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0))
    throw new RangeError(`need finite t0 < t1, got ${t0}, ${t1}`);
  const n = ir.samples.length;
  const startIndex = Math.min(n, Math.max(0, Math.round(t0 * ir.sampleRate)));
  const endIndex = Math.min(n, Math.max(startIndex, Math.round(t1 * ir.sampleRate)));
  return {
    ...ir,
    window: [t0, t1],
    view: { startIndex, endIndex, samples: ir.samples.slice(startIndex, endIndex) },
  };
}

/**
 * normalizeIr(ir, mode): derived display arrays, labelled as normalized (§41); the IrResult
 * keeps its original scale.
 *   'peak-db'      20·log10(|h| / |h_peak|), floored at −300 dB (an ETC-style view)
 *   'peak-linear'  h / |h_peak| (sign kept, the peak reads ±1)
 */
export function normalizeIr(ir, mode) {
  const ref = Math.abs(ir.samples[ir.peakIndex]);
  const n = ir.samples.length;
  if (mode === 'peak-db') {
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = ref > 0 ? Math.abs(ir.samples[i]) / ref : 0;
      values[i] = powerToDb(r * r);
    }
    return {
      kind: 'normalized', mode, label: 'NORMALIZED: dB re IR peak (peak = 0 dB)',
      unit: 'dB re peak', referenceValue: ref, values,
    };
  }
  if (mode === 'peak-linear') {
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = ref > 0 ? ir.samples[i] / ref : 0;
    return {
      kind: 'normalized', mode, label: 'NORMALIZED: relative amplitude (peak = 1.0)',
      unit: 'relative', referenceValue: ref, values,
    };
  }
  throw new RangeError(`unknown IR normalization '${mode}'`);
}
