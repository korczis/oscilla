// Impulse response from a log-sweep measurement (spec §37-§42, §214). Algorithm IDs, one per
// method because their outputs differ (ADR 0024; IR_ALGORITHMS): 'spectral' →
// 'oscilla.ir.log-sweep.v3', 'farina-inverse' → 'oscilla.ir.farina-inverse.v3'. The result's
// `algorithm` is the ID of the method that produced it; `method` repeats it in words. The v1
// IDs ('oscilla.ir.log-sweep.v1', 'oscilla.ir.farina-inverse.v1') are retained: `algorithm`
// selects them and reproduces a v1 result exactly. v1 and v2 differ ONLY in noiseFloorDb (see
// below); the samples, peak and time origin are identical.
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
// |X[k]·F[k]| over bins half an octave inside [f1, f2], so a unity system reads unity at the
// median whatever constant the inverse was built with; the inverse's truncation ripple
// remains (about ±1.5-2.5 dB half an octave inside the band, several dB at the edges; V382),
// so the spectral method is the default.
//
// For an exponential sweep both methods place the harmonic-distortion responses at negative
// time (Farina 2000, §3): harmonic k at capture index lag − L·ln k. With lagSamples the stored
// window starts after them; without it (start 0) harmonic k lies inside `samples` whenever
// the pre-roll exceeds L·ln k. The result is
// band-limited to [f1, f2]: a unity system gives a band-limited pulse, not a single unit sample,
// and its peak value is about (f2 − f1)/(fs/2).
//
// Time origin (§214): samples[0] is capture sample `start`, start = max(0, lagSamples − guard)
// when an alignment lag is given (the guard keeps the pulse's precursor), else 0. v3 (V382):
// guard = max(5 ms, IR_PRE_GUARD_CYCLES / f1) — 250 ms at f1 = 20 Hz. The band limit at f1
// (the 1/3-octave regularization ramp) is zero-phase, so its ringing reaches ~1/Δf before the
// peak; cutting it at 5 ms the stored IR read −1.22 dB at 30 Hz and −0.75 dB at 60 Hz against
// its own transfer function (2 s sweep, 48 kHz). The error of a cut ripples with its position
// (3, 4, 5, 8 periods: −0.066, +0.041, +0.001, −0.004 dB at 30 Hz); 5 periods read within
// 0.01 dB of the uncut IR from 30 Hz up.
// v1 and v2 use 5 ms and are retained (`algorithm`); v2 and v3 differ only in `start`.
// captureOffsetS = start / fs is the absolute offset, peakIndex indexes samples (largest |h|),
// peakTimeS = peakIndex / fs is relative to samples[0]; absolute peak time is their sum. The
// full causal length is kept (len(y) − start samples, original scale, sign kept) for later
// ETC / Schroeder / RT60 / EDT work.
//
// noiseFloorDb (dB re the peak, h² / h_peak²), with noiseFloorMethod naming how (v2 only):
//   v2 'full-overlap-tail': 10·log10(mean h² / h_peak²) over the last 10 % (IR_TAIL_FRACTION)
//     of the lags after the peak at which the stimulus lies WHOLLY inside the capture, i.e.
//     capture lag τ = start + i ≤ len(y) − len(x). Only there does every sample of y — and so
//     all of its noise — enter the estimate; beyond that lag the stimulus runs past the end of
//     the capture, ever less of y is correlated and the deconvolved noise falls away (−159 dB
//     at the end of a 2 s sweep's causal window against a true −100 dB floor, review probe p4).
//     The full-overlap span after the peak is ≈ the post-roll minus the latency, so with a
//     decay longer than the post-roll the figure is an upper bound (decay, not noise). null
//     with noiseFloorMethod 'none' when fewer than IR_NOISE_MIN_SAMPLES full-overlap lags
//     follow the peak (no place to read the noise).
//   v1: the last 10 % of the whole causal window after the peak (no noiseFloorMethod field),
//     which lies beyond the full-overlap lags whenever the post-roll is shorter than the sweep.
//   Both are floored at −300 dB (ZERO_POWER_DB).
//
// irWindow and normalizeIr never modify an IrResult: they return new objects (§40, §41).
// normalizeIr's view carries algorithm 'oscilla.normalization.v1' (smoothing.js
// NORMALIZATION_ALGORITHM) and its mode.

import {
  checkTransferArgs, powerToDb, realPairSpectra, spectralDeconvolution, transferFromDeconvolution,
  workBuffers, ZERO_POWER_DB,
} from './transfer.js';
import { ALGORITHMS } from './algorithms.js';
import { NORMALIZATION_ALGORITHM } from './smoothing.js';

/** ID of the default ('spectral') method; kept for callers that import it. */
export const IR_ALGORITHM = ALGORITHMS.ir;
/** ID of the 'farina-inverse' method. */
export const IR_FARINA_ALGORITHM = ALGORITHMS.irFarina;
/** Algorithm ID by IR method (the current version of each). */
export const IR_ALGORITHMS = Object.freeze({
  spectral: IR_ALGORITHM,
  'farina-inverse': IR_FARINA_ALGORITHM,
});
/** Retained v1 IDs by method (tail noise floor over the whole causal window). */
export const IR_ALGORITHMS_V1 = Object.freeze({
  spectral: 'oscilla.ir.log-sweep.v1',
  'farina-inverse': 'oscilla.ir.farina-inverse.v1',
});
/** Retained v2 IDs by method (v3 without the f1-dependent pre-guard; see the header). */
export const IR_ALGORITHMS_V2 = Object.freeze({
  spectral: 'oscilla.ir.log-sweep.v2',
  'farina-inverse': 'oscilla.ir.farina-inverse.v2',
});
/** IrResult.noiseFloorMethod values (v2). */
export const IR_NOISE_FLOOR_METHODS = Object.freeze(['full-overlap-tail', 'none']);
export const IR_PRE_GUARD_S = 0.005;
/** v3: the pre-guard also spans this many periods of f1 (the band edge's ringing; header). */
export const IR_PRE_GUARD_CYCLES = 5;
export const IR_TAIL_FRACTION = 0.1;
/** Fewest full-overlap lags after the peak from which a v2 noise floor is read. */
export const IR_NOISE_MIN_SAMPLES = 16;

/**
 * N·x for the real time signal x of a Hermitian half spectrum: Re(DFT(conj(H))), NOT yet
 * divided by N (the caller divides only the samples it keeps, which gives the same doubles as
 * dividing the whole buffer). Overwrites and returns `work.re` when scratch buffers are given.
 */
function inverseRealScaled(fft, hRe, hIm, work = null) {
  const n = fft.size;
  const half = n / 2;
  const { re, im } = workBuffers(n, work);
  for (let k = 0; k <= half; k++) {
    re[k] = hRe[k];
    im[k] = -hIm[k];
  }
  for (let k = 1; k < half; k++) {
    re[n - k] = hRe[k];
    im[n - k] = hIm[k];
  }
  fft.forward(re, im);
  return re;
}

function median(values) {
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function farinaDeconvolution(base, { stimulus, sampleRate, f1, f2, inverse }) {
  const { fft, binHz, half, xRe, xIm, yRe, yIm } = base;
  const { aRe: fRe, aIm: fIm } = realPairSpectra(fft, inverse, null, base.work);
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
  return { scaled: inverseRealScaled(fft, hRe, hIm, base.work), shift: stimulus.length - 1 };
}

/** Argument checks of computeImpulseResponse that need no spectra (same order as before). */
function checkIrArgs({ stimulus, inverse, method, lagSamples, algorithm }) {
  if (lagSamples !== undefined && !(Number.isFinite(lagSamples) && lagSamples >= 0))
    throw new RangeError(`lagSamples must be a finite number ≥ 0, got ${lagSamples}`);
  if (method !== 'spectral' && method !== 'farina-inverse')
    throw new RangeError(`unknown IR method '${method}'`);
  if (method === 'farina-inverse'
    && !(inverse instanceof Float32Array) && !(inverse instanceof Float64Array))
    throw new TypeError("method 'farina-inverse' needs inverse: Float32Array");
  if (algorithm !== undefined && algorithm !== IR_ALGORITHMS[method]
    && algorithm !== IR_ALGORITHMS_V1[method] && algorithm !== IR_ALGORITHMS_V2[method])
    throw new RangeError(`IR algorithm '${algorithm}' is not a version of method '${method}' `
      + `(${IR_ALGORITHMS_V1[method]}, ${IR_ALGORITHMS_V2[method]}, ${IR_ALGORITHMS[method]})`);
  return { stimulus };
}

/**
 * IrResult from a spectralDeconvolution() result (the second half of computeImpulseResponse).
 * Uses dec.work as scratch for the inverse transform.
 */
export function irFromDeconvolution(dec, {
  stimulus, captured, sampleRate, f1, f2, inverse = null, method = 'spectral', lagSamples,
  algorithm = IR_ALGORITHMS[method],
}) {
  const v1 = algorithm === IR_ALGORITHMS_V1[method];
  let scaled;
  let shift = 0;
  if (method === 'spectral') {
    scaled = inverseRealScaled(dec.fft, dec.hRe, dec.hIm, dec.work);
  } else {
    if (inverse.length !== stimulus.length)
      throw new RangeError('inverse must have the stimulus length (time-reversed sweep)');
    ({ scaled, shift } = farinaDeconvolution(dec, { stimulus, sampleRate, f1, f2, inverse }));
  }
  const n = dec.fftSize;
  // v3 (V382): the band limit at f1 rings ~1/Δf before the peak; 5 ms cut that precursor and
  // the stored IR read up to 1.2 dB low below 60 Hz. v1/v2 keep 5 ms.
  const guardS = algorithm === IR_ALGORITHMS_V1[method] || algorithm === IR_ALGORITHMS_V2[method]
    ? IR_PRE_GUARD_S : Math.max(IR_PRE_GUARD_S, IR_PRE_GUARD_CYCLES / f1);
  const guard = Math.round(guardS * sampleRate);
  const start = lagSamples === undefined
    ? 0
    : Math.min(captured.length - 1, Math.max(0, Math.round(lagSamples) - guard));
  const length = captured.length - start;
  const samples = new Float32Array(length);
  let peakIndex = 0;
  let peakAbs = -1;
  for (let i = 0; i < length; i++) {
    const v = scaled[start + i + shift] / n;
    samples[i] = v;
    const a = Math.abs(v);
    if (a > peakAbs) {
      peakAbs = a;
      peakIndex = i;
    }
  }
  if (v1) {
    return {
      algorithm,
      method,
      sampleRate,
      samples,
      peakIndex,
      peakTimeS: peakIndex / sampleRate,
      captureOffsetS: start / sampleRate,
      noiseFloorDb: tailFloorDb(samples, peakIndex),
      window: null,
      fftSize: dec.fftSize,
    };
  }
  // Last sample index whose lag start + i still has the whole stimulus inside the capture.
  const fullEnd = Math.min(length - 1, captured.length - stimulus.length - start);
  const floor = fullOverlapFloorDb(samples, peakIndex, fullEnd);
  return {
    algorithm,
    method,
    sampleRate,
    samples,
    peakIndex,
    peakTimeS: peakIndex / sampleRate,
    captureOffsetS: start / sampleRate,
    noiseFloorDb: floor,
    noiseFloorMethod: floor === null ? 'none' : 'full-overlap-tail',
    window: null,
    fftSize: dec.fftSize,
  };
}

/**
 * computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method,
 *   lagSamples, fft }) -> IrResult (docs/v3/architecture.md, with `method` and `fftSize`);
 *   algorithm is IR_ALGORITHMS[method].
 *   method      'spectral' (default) | 'farina-inverse' (requires `inverse`)
 *   lagSamples  optional alignment of the stimulus start in the capture (align().lagSamples)
 *   fft         optional FFT plan of the deconvolution size (transfer.js fftPlan)
 *   algorithm   optional version of the method: IR_ALGORITHMS[method] (default) or
 *               IR_ALGORITHMS_V1[method] (reproduces a stored v1 result)
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
  fft = null,
  algorithm,
}) {
  checkIrArgs({ stimulus, inverse, method, lagSamples, algorithm });
  const dec = spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2, fft });
  return irFromDeconvolution(dec, { stimulus, captured, sampleRate, f1, f2, inverse, method,
    lagSamples, algorithm: algorithm ?? IR_ALGORITHMS[method] });
}

/**
 * computeTransferAndIr({ stimulus, captured, sampleRate, f1, f2, lagSamples, alignment, noise,
 *   options, irLagSamples, method, inverse, fft, noiseSpectrum, irAlgorithm }) →
 *   { transfer, ir }  (options.algorithm selects the transfer version, irAlgorithm the IR's)
 * ONE regularized spectral division (spectralDeconvolution) for both results instead of one
 * each: `transfer` is exactly computeTransfer({ stimulus, captured, sampleRate, f1, f2,
 * lagSamples, alignment, noise, options }) and `ir` exactly computeImpulseResponse({ stimulus,
 * captured, sampleRate, f1, f2, inverse, method, lagSamples: irLagSamples }), bit for bit
 * (v3-transfer-ir.test.mjs "computeTransferAndIr"). irLagSamples defaults to max(0, lag) with
 * lag = lagSamples ?? alignment.lagSamples (the IR needs a non-negative start), else none.
 * Saves one FFT plan, two N-point FFTs, one regularization profile and 2·N doubles of scratch
 * per run (docs/v3/algorithms.md, "Impulse response").
 */
export function computeTransferAndIr({
  stimulus,
  captured,
  sampleRate,
  f1,
  f2,
  lagSamples,
  alignment = null,
  noise = null,
  options = {},
  irLagSamples,
  method = 'spectral',
  inverse = null,
  fft = null,
  noiseSpectrum = null,
  irAlgorithm,
}) {
  const checked = checkTransferArgs({ lagSamples, alignment, noise, options });
  let irLag = irLagSamples;
  if (irLag === undefined) {
    const lag = lagSamples !== undefined ? lagSamples
      : checked.aligned && checked.aligned.lagSamples;
    irLag = Number.isFinite(lag) ? Math.max(0, lag) : undefined;
  }
  checkIrArgs({ stimulus, inverse, method, lagSamples: irLag, algorithm: irAlgorithm });
  const dec = spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2, fft });
  const transfer = transferFromDeconvolution(dec, { captured, sampleRate, f1, f2, lagSamples,
    noise, noiseSpectrum, ...checked });
  const ir = irFromDeconvolution(dec, { stimulus, captured, sampleRate, f1, f2, inverse, method,
    lagSamples: irLag, algorithm: irAlgorithm ?? IR_ALGORITHMS[method] });
  return { transfer, ir };
}

/** v2: mean h²/h_peak² over the last IR_TAIL_FRACTION of (peakIndex, fullEnd]; null when that
 *  span has fewer than IR_NOISE_MIN_SAMPLES samples. */
function fullOverlapFloorDb(samples, peakIndex, fullEnd) {
  const span = fullEnd - peakIndex;
  if (!(span >= IR_NOISE_MIN_SAMPLES)) return null;
  const peak = Math.abs(samples[peakIndex]);
  if (!(peak > 0)) return ZERO_POWER_DB;
  const count = Math.max(IR_NOISE_MIN_SAMPLES, Math.floor(span * IR_TAIL_FRACTION));
  let s = 0;
  for (let i = fullEnd - count + 1; i <= fullEnd; i++) s += samples[i] * samples[i];
  return powerToDb(s / count / (peak * peak));
}

/** v1: mean h²/h_peak² over the last IR_TAIL_FRACTION of the samples after the peak. */
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
      kind: 'normalized', algorithm: NORMALIZATION_ALGORITHM, mode,
      label: 'NORMALIZED: dB re IR peak (peak = 0 dB)',
      unit: 'dB re peak', referenceValue: ref, values,
    };
  }
  if (mode === 'peak-linear') {
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = ref > 0 ? ir.samples[i] / ref : 0;
    return {
      kind: 'normalized', algorithm: NORMALIZATION_ALGORITHM, mode,
      label: 'NORMALIZED: relative amplitude (peak = 1.0)',
      unit: 'relative', referenceValue: ref, values,
    };
  }
  throw new RangeError(`unknown IR normalization '${mode}'`);
}
