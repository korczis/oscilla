// Transfer function H(f) of a measured system from a known stimulus x and its capture y
// (spec §26-§27, §33, §157, §159). Algorithm ID: 'oscilla.transfer.v1'.
//
// Method — regularized frequency-domain deconvolution (Müller & Massarani 2001, "Transfer-
// function measurement with sweeps", JAES 49(6), §5 "spectral division"; regularization after
// Kirkeby, Nelson et al. 1998, "Fast deconvolution of multichannel systems using
// regularization", IEEE Trans. Speech Audio Process. 6(2)):
//
//   N    = next power of two ≥ len(x) + len(y)       (no circular wrap of any lag)
//   X, Y = N-point DFTs of x and y, zero padded       (one complex FFT of x + j·y)
//   H[k] = Y[k]·conj(X[k]) / (|X[k]|² + ε[k])
//
// ε[k] is frequency dependent: ε_in = 10^(−60/10)·max|X|² inside [f1, f2] (|H| is biased by
// −10·log10(1 + ε/|X|²): 0.004 dB where |X|² is 30 dB below its maximum, as at the top of a
// 20 Hz-20 kHz exponential sweep), ε_out = 10^(0/10)·max|X|² outside, joined by a
// raised-cosine (in log-frequency, interpolated in dB) over 1/3 octave beyond each band edge,
// so the in-band estimate is untouched and bins the stimulus did not excite cannot blow up.
// max|X|² is taken over the bins in [f1, min(f2, Nyquist)].
//
// Magnitude: on a log grid of 1/48-octave points from f1 to min(f2, Nyquist), each point is the
// power mean of |H[k]|² over the bins inside its band [f·2^(−1/96), f·2^(1/96)) (never a mean of
// dB values), reported as 10·log10(·): dB relative to a unity digital transfer (0 dB = the
// capture equals the stimulus), raw — no smoothing, no calibration (§159). A band holding no bin
// uses the nearest bin. A pure delay does not change the magnitude.
//
// Phase (§27: never faked, only if robust): only when options.phase is true AND an align()
// result is supplied as `alignment` AND its peakCorrelation ≥ PHASE_MIN_CORRELATION (0.5).
// The bins are rotated by e^(+j2πk·lag/N) to remove the aligned delay (lag = lagSamples when
// given, else alignment.lagSamples), complex-averaged over the band, and reported as the
// wrapped angle in (−180°, 180°]. Otherwise phaseDeg is null and phaseReason says why
// (PHASE_REASONS: NOT_REQUESTED, NO_ALIGNMENT, ALIGNMENT_NOT_ROBUST; AGGREGATED marks the
// aggregate centre of repeated runs, aggregate.js transferFromAggregate); a bare lagSamples is
// not evidence of a robust alignment and no longer yields a phase by itself. Why 0.5: ρ² is the
// fraction of the capture's energy in the stimulus window that one scaled, delayed copy of the
// stimulus explains (ρ = 1/√2 at 0 dB broadband SNR for a flat system). Below ρ = 0.5 most of
// that energy is noise, reverberation or filtering the delay model does not describe, so "the"
// delay removed from the phase is not well defined; the lag itself stays sub-sample accurate
// down to ρ ≈ 0.7 (v3-measurement-core align tests), far above the cut. The result records the
// alignment it used as `alignment` ({ algorithm, lagSamples, peakCorrelation, polarity }).
//
// SNR (§31-§32), when a separate noise capture n (stimulus silent) is given: for stationary
// noise of power spectral density S, the zero-padded DFT of M samples has E|N[k]|² = M·S(f_k)
// regardless of padding. The noise periodogram |N[k]|² (n padded to the same N, so bins
// coincide) is therefore scaled by len(y)/len(n) to the noise energy per bin expected inside
// the capture, Pn(f) = band mean of that. With Py(f) = band mean of |Y[k]|² (signal + noise),
// snrDb = 10·log10((Py − Pn)/Pn), clamped to [−60, 200] dB. The per-bin SNR of Y equals that of
// the H estimate, because division by X scales signal and noise alike.
//
// validRange (§157): the longest contiguous run of grid points that are (a) covered by the
// stimulus — the per-relative-bandwidth stimulus energy f·P_x(f), P_x the band mean of |X|²,
// is within 20 dB of its maximum on the grid (flat for a log sweep or pink noise, so this
// rejects leakage outside the swept band and a Nyquist clamp) — and (b), when noise is given,
// reach 10 dB SNR with Py and Pn first power-averaged over 1/6 octave around the point (the
// per-point estimate scatters by ≈ 4.34/√K dB for K independent bins, which would otherwise
// fragment the range at the first dip; the reported snrDb stays per point). null when no point
// qualifies. requestedRange is always [f1, f2] as requested, even past Nyquist; the grid
// itself stops at Nyquist (§205).
//
// Assumptions: x and y share sampleRate and are mono, sample-synchronous (one clock) and
// linear time-invariant apart from additive noise; harmonic distortion is not separated (use
// impulse-response.js and window its causal part for that). Inputs are never mutated.

import { createFft } from '../analysis/fft.js';
import { smoothFractionalOctave } from './smoothing.js';
import { ALGORITHMS } from './algorithms.js';

export const TRANSFER_ALGORITHM = ALGORITHMS.transfer;

/** Regularization profile, in dB relative to max|X|² over the requested band. */
export const REGULARIZATION = Object.freeze({
  inBandDb: -60,
  outOfBandDb: 0,
  transitionOctaves: 1 / 3,
});

export const DEFAULT_POINTS_PER_OCTAVE = 48;
/** Stimulus coverage: f·P_x(f) within this many dB of its maximum on the grid. */
export const COVERAGE_DB = -20;
/** Minimum SNR for a grid point to count as valid when a noise capture is given. */
export const VALID_MIN_SNR_DB = 10;
/** Bandwidth (1/N octave) over which signal and noise power are pooled for validity. */
export const VALIDITY_SMOOTHING_FRACTION = 6;
export const SNR_FLOOR_DB = -60;
export const SNR_CEIL_DB = 200;
/** dB value standing for zero power, so results stay finite (JSON-safe). The one zero-power
 *  encoding of every stored OSCILLA result (rta.js rtaResult uses it too). */
export const ZERO_POWER_DB = -300;
/** Minimum alignment peakCorrelation for a phase response (see the header). */
export const PHASE_MIN_CORRELATION = 0.5;
/** Why phaseDeg is null (TransferResult.phaseReason; null when a phase is reported). */
export const PHASE_REASONS = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  NO_ALIGNMENT: 'NO_ALIGNMENT',
  ALIGNMENT_NOT_ROBUST: 'ALIGNMENT_NOT_ROBUST',
  // The aggregate centre of repeated runs (derivedFrom 'aggregate', G20): the phases of
  // separate runs are not averaged (§27); each run's own phase is in its run transfer.
  AGGREGATED: 'AGGREGATED',
});

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function powerToDb(p) {
  return p > 0 ? Math.max(10 * Math.log10(p), ZERO_POWER_DB) : ZERO_POWER_DB;
}

function assertSignal(name, x) {
  if (!(x instanceof Float32Array) && !(x instanceof Float64Array))
    throw new TypeError(`${name} must be a Float32Array or Float64Array`);
  if (x.length === 0) throw new RangeError(`${name} is empty`);
}

function assertBand(sampleRate, f1, f2) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate))
    throw new RangeError(`sampleRate must be a positive number, got ${sampleRate}`);
  if (!(f1 > 0) || !(f2 > f1) || !Number.isFinite(f2))
    throw new RangeError(`need 0 < f1 < f2, got f1=${f1}, f2=${f2}`);
  if (f1 >= sampleRate / 2)
    throw new RangeError(`f1=${f1} Hz is at or above Nyquist (${sampleRate / 2} Hz)`);
}

/**
 * Half spectra (bins 0 … N/2) of two real signals from ONE complex FFT of a + j·b:
 * A[k] = (Z[k] + conj Z[N−k]) / 2, B[k] = (Z[k] − conj Z[N−k]) / 2j.
 * `work` ({ re, im }, two Float64Arrays of the FFT size) is optional scratch space that is
 * overwritten instead of allocating 2·N doubles; the result is the same either way.
 */
export function realPairSpectra(fft, a, b, work = null) {
  const n = fft.size;
  const { re, im } = workBuffers(n, work);
  const la = Math.min(a.length, n);
  re.set(la === a.length ? a : a.subarray(0, la));
  re.fill(0, la);
  let lb = 0;
  if (b) {
    lb = Math.min(b.length, n);
    im.set(lb === b.length ? b : b.subarray(0, lb));
  }
  im.fill(0, lb);
  fft.forward(re, im);
  const half = n / 2;
  const aRe = new Float64Array(half + 1);
  const aIm = new Float64Array(half + 1);
  const bRe = new Float64Array(half + 1);
  const bIm = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const j = k === 0 ? 0 : n - k;
    const zr = re[k];
    const zi = im[k];
    const cr = re[j];
    const ci = im[j];
    aRe[k] = (zr + cr) / 2;
    aIm[k] = (zi - ci) / 2;
    bRe[k] = (zi + ci) / 2;
    bIm[k] = (cr - zr) / 2;
  }
  return { aRe, aIm, bRe, bIm };
}

/** Scratch { re, im } of length n: the given buffers when they fit, else new ones. */
export function workBuffers(n, work) {
  if (work && work.re instanceof Float64Array && work.im instanceof Float64Array
    && work.re.length === n && work.im.length === n) return work;
  return { re: new Float64Array(n), im: new Float64Array(n) };
}

/**
 * The FFT plan for `size`: `fft` when it is a plan of that size (a caller analysing several
 * captures of one length passes one plan to all of them), else a new createFft(size). The plan
 * holds only twiddles and the bit-reversal table, so reusing it cannot change a result.
 */
export function fftPlan(size, fft = null) {
  if (fft && fft.size === size && typeof fft.forward === 'function') return fft;
  return createFft(size);
}

/** Raised-cosine weight 0 → 1 for t in [0, 1]. */
function rampWeight(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return (1 - Math.cos(Math.PI * t)) / 2;
}

/**
 * Regularization ε[k] for bins 0 … N/2 (Float64Array), given max|X|² in band. Inside [f1, f2]
 * and beyond the transitions ε is one constant each; those two values are computed once by the
 * same expression the transition bins use, so every bin equals the per-bin formula exactly.
 */
export function regularizationProfile(half, binHz, f1, f2, xPowMax, profile = REGULARIZATION) {
  const eps = new Float64Array(half + 1);
  const lo = profile.inBandDb;
  const hi = profile.outOfBandDb;
  const epsAt = (w) => xPowMax * 10 ** ((lo + (hi - lo) * w) / 10);
  const epsIn = epsAt(0);
  const epsOut = epsAt(1);
  for (let k = 0; k <= half; k++) {
    const f = k * binHz;
    let t = 0;
    if (f < f1) t = f > 0 ? Math.log2(f1 / f) / profile.transitionOctaves : 1;
    else if (f > f2) t = Math.log2(f / f2) / profile.transitionOctaves;
    eps[k] = t <= 0 ? epsIn : t >= 1 ? epsOut : epsAt(rampWeight(t));
  }
  return eps;
}

/**
 * Regularized spectral division shared by transfer.js and impulse-response.js. Returns the
 * half spectra (bins 0 … N/2) of X, Y and H plus the FFT plan used and its scratch buffers
 * (`work`, 2·N doubles), so callers can derive the transfer function, the impulse response
 * and the noise spectrum from ONE division (computeTransferAndIr) without new allocations.
 * `fft` optionally supplies a plan of the right size (fftPlan); results do not depend on it.
 */
export function spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2, fft = null }) {
  assertSignal('stimulus', stimulus);
  assertSignal('captured', captured);
  assertBand(sampleRate, f1, f2);
  const fftSize = nextPowerOfTwo(stimulus.length + captured.length);
  const plan = fftPlan(fftSize, fft);
  const binHz = sampleRate / fftSize;
  const half = fftSize / 2;
  const work = workBuffers(fftSize, null);
  const { aRe: xRe, aIm: xIm, bRe: yRe, bIm: yIm } = realPairSpectra(plan, stimulus, captured,
    work);
  const xPow = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) xPow[k] = xRe[k] * xRe[k] + xIm[k] * xIm[k];
  const fTop = Math.min(f2, sampleRate / 2);
  let xPowMax = 0;
  const kLo = Math.ceil(f1 / binHz);
  const kHi = Math.min(half, Math.floor(fTop / binHz));
  for (let k = kLo; k <= kHi; k++) if (xPow[k] > xPowMax) xPowMax = xPow[k];
  if (!(xPowMax > 0)) throw new RangeError('stimulus has no energy inside [f1, f2]');
  const eps = regularizationProfile(half, binHz, f1, f2, xPowMax);
  const hRe = new Float64Array(half + 1);
  const hIm = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    // Y·conj(X) = (yr + j·yi)(xr − j·xi)
    const d = xPow[k] + eps[k];
    hRe[k] = (yRe[k] * xRe[k] + yIm[k] * xIm[k]) / d;
    hIm[k] = (yIm[k] * xRe[k] - yRe[k] * xIm[k]) / d;
  }
  return { fft: plan, fftSize, binHz, half, xRe, xIm, xPow, yRe, yIm, hRe, hIm, eps, xPowMax,
    work };
}

/** Log-spaced grid f1·2^(i/ppo) for every point ≤ fTop. */
export function logGrid(f1, fTop, pointsPerOctave = DEFAULT_POINTS_PER_OCTAVE) {
  const count = Math.floor(Math.log2(fTop / f1) * pointsPerOctave + 1e-9) + 1;
  const out = new Float64Array(Math.max(count, 1));
  for (let i = 0; i < out.length; i++) out[i] = f1 * 2 ** (i / pointsPerOctave);
  return out;
}

/** Bin index ranges [k0, k1] (inclusive) of each grid band; nearest bin when a band is empty. */
function gridBins(frequencies, pointsPerOctave, binHz, half) {
  const k0 = new Int32Array(frequencies.length);
  const k1 = new Int32Array(frequencies.length);
  const edge = 2 ** (1 / (2 * pointsPerOctave));
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    let a = Math.ceil(f / edge / binHz);
    let b = Math.min(half, Math.ceil((f * edge) / binHz) - 1);
    if (b < a) {
      a = Math.min(half, Math.round(f / binHz));
      b = a;
    }
    k0[i] = a;
    k1[i] = b;
  }
  return { k0, k1 };
}

function bandMean(values, k0, k1) {
  let s = 0;
  for (let k = k0; k <= k1; k++) s += values[k];
  return s / (k1 - k0 + 1);
}

/** (Py − Pn)/Pn in dB, clamped to [SNR_FLOOR_DB, SNR_CEIL_DB]; inputs are powers in dB. */
function snrFromDb(pyDb, pnDb) {
  const out = new Float64Array(pyDb.length);
  for (let i = 0; i < out.length; i++) {
    const pn = pnDb[i] > ZERO_POWER_DB ? 10 ** (pnDb[i] / 10) : 0;
    const py = pyDb[i] > ZERO_POWER_DB ? 10 ** (pyDb[i] / 10) : 0;
    let db;
    if (pn > 0) db = py > pn ? 10 * Math.log10((py - pn) / pn) : SNR_FLOOR_DB;
    else db = py > 0 ? SNR_CEIL_DB : SNR_FLOOR_DB;
    out[i] = Math.min(SNR_CEIL_DB, Math.max(SNR_FLOOR_DB, db));
  }
  return out;
}

function longestRun(mask) {
  let best = null;
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    if (i < mask.length && mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (!best || i - start > best[1] - best[0] + 1) best = [start, i - 1];
      start = -1;
    }
  }
  return best;
}

/** The alignment summary a TransferResult records, from an align() result. */
function alignmentSummary(alignment) {
  if (alignment === null || alignment === undefined) return null;
  if (typeof alignment !== 'object' || typeof alignment.peakCorrelation !== 'number'
    || !(alignment.lagSamples === null || Number.isFinite(alignment.lagSamples)))
    throw new TypeError('alignment must be an align() result');
  return {
    algorithm: typeof alignment.algorithm === 'string' ? alignment.algorithm : null,
    lagSamples: alignment.lagSamples,
    peakCorrelation: alignment.peakCorrelation,
    polarity: alignment.polarity ?? null,
  };
}

/**
 * The argument checks of computeTransfer that do not need the spectra (shared with
 * impulse-response.js computeTransferAndIr so both report the same errors in the same order).
 * Returns { pointsPerOctave, phase, aligned }.
 */
export function checkTransferArgs({ lagSamples, alignment = null, noise = null, options = {} }) {
  const { phase = false, pointsPerOctave = DEFAULT_POINTS_PER_OCTAVE } = options;
  if (!(pointsPerOctave > 0)) throw new RangeError('pointsPerOctave must be positive');
  if (lagSamples !== undefined && !Number.isFinite(lagSamples))
    throw new RangeError(`lagSamples must be finite, got ${lagSamples}`);
  const aligned = alignmentSummary(alignment);
  if (noise !== null) assertSignal('noise', noise);
  return { pointsPerOctave, phase, aligned };
}

/**
 * computeTransfer({ stimulus, captured, sampleRate, f1, f2, lagSamples, alignment, noise,
 *   options, fft })
 *   stimulus    Float32Array, the emitted digital stimulus (e.g. renderStimulus().samples)
 *   captured    Float32Array, mono capture containing the response (pre/post-roll allowed)
 *   alignment   align() result for this capture; required for a phase response, which is
 *               reported only when its peakCorrelation ≥ PHASE_MIN_CORRELATION
 *   lagSamples  lag to remove from the phase; defaults to alignment.lagSamples
 *   noise       Float32Array|null, a stimulus-free capture for the SNR estimate
 *   options     { phase = false, pointsPerOctave = 48 }
 *   fft         optional FFT plan of the deconvolution size (fftPlan); never changes a result
 *   noiseSpectrum  optional noiseSpectrum(noise, fftSize) of this `noise` (reused across runs);
 *               never changes a result
 * Returns TransferResult (docs/v3/architecture.md) with phaseReason (null when phaseDeg is
 * reported, else a PHASE_REASONS code) and alignment (the summary used, or null).
 */
export function computeTransfer({
  stimulus,
  captured,
  sampleRate,
  f1,
  f2,
  lagSamples,
  alignment = null,
  noise = null,
  options = {},
  fft = null,
  noiseSpectrum = null,
}) {
  const checked = checkTransferArgs({ lagSamples, alignment, noise, options });
  const dec = spectralDeconvolution({ stimulus, captured, sampleRate, f1, f2, fft });
  return transferFromDeconvolution(dec, { captured, sampleRate, f1, f2, lagSamples, noise,
    noiseSpectrum, ...checked });
}

/**
 * noiseSpectrum(noise, fftSize, fft) → { noise, fftSize, used, aRe, aIm }: the half spectrum of
 * a stimulus-free capture (its first `used` = min(len, fftSize) samples, zero padded) as
 * computeTransfer uses it for the SNR. It depends only on the noise capture and the FFT size,
 * so a caller analysing several runs against one noise capture computes it once and passes it
 * as `noiseSpectrum`; it is used only when its `noise` is the very array passed as `noise` and
 * its fftSize matches, otherwise recomputed (the result is the same either way).
 */
export function noiseSpectrum(noise, fftSize, fft = null) {
  assertSignal('noise', noise);
  return computeNoiseSpectrum(noise, fftSize, fftPlan(fftSize, fft), null);
}

function computeNoiseSpectrum(noise, fftSize, fft, work) {
  const used = Math.min(noise.length, fftSize);
  const { aRe, aIm } = realPairSpectra(fft, noise.length > used ? noise.subarray(0, used) : noise,
    null, work);
  return { noise, fftSize, used, aRe, aIm };
}

/**
 * TransferResult from a spectralDeconvolution() result (the second half of computeTransfer).
 * `checked` is checkTransferArgs()'s output. Uses dec.work as scratch for the noise spectrum.
 */
export function transferFromDeconvolution(dec, {
  captured, sampleRate, f1, f2, lagSamples, noise = null, noiseSpectrum = null, pointsPerOctave,
  phase, aligned,
}) {
  const { fft, fftSize, binHz, half, xPow, yRe, yIm, hRe, hIm } = dec;
  const fTop = Math.min(f2, sampleRate / 2);
  const frequencies = logGrid(f1, fTop, pointsPerOctave);
  const { k0, k1 } = gridBins(frequencies, pointsPerOctave, binHz, half);
  const n = frequencies.length;

  const hPow = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) hPow[k] = hRe[k] * hRe[k] + hIm[k] * hIm[k];
  const magnitudeDb = new Float64Array(n);
  const coverage = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    magnitudeDb[i] = powerToDb(bandMean(hPow, k0[i], k1[i]));
    coverage[i] = frequencies[i] * bandMean(xPow, k0[i], k1[i]);
  }

  const lag = lagSamples !== undefined ? lagSamples : aligned && aligned.lagSamples;
  let phaseReason = null;
  if (phase !== true) phaseReason = PHASE_REASONS.NOT_REQUESTED;
  else if (!aligned) phaseReason = PHASE_REASONS.NO_ALIGNMENT;
  else if (!(aligned.peakCorrelation >= PHASE_MIN_CORRELATION) || !Number.isFinite(lag))
    phaseReason = PHASE_REASONS.ALIGNMENT_NOT_ROBUST;
  let phaseDeg = null;
  if (phaseReason === null) {
    phaseDeg = new Float64Array(n);
    const w = (2 * Math.PI * lag) / fftSize;
    for (let i = 0; i < n; i++) {
      let sr = 0;
      let si = 0;
      for (let k = k0[i]; k <= k1[i]; k++) {
        const c = Math.cos(w * k);
        const s = Math.sin(w * k);
        sr += hRe[k] * c - hIm[k] * s;
        si += hRe[k] * s + hIm[k] * c;
      }
      let deg = (Math.atan2(si, sr) * 180) / Math.PI;
      if (deg <= -180) deg += 360;
      phaseDeg[i] = deg;
    }
  }

  let snrDb = null;
  let snrValidDb = null;
  if (noise !== null) {
    const spec = noiseSpectrum !== null && noiseSpectrum.noise === noise
      && noiseSpectrum.fftSize === fftSize
      ? noiseSpectrum
      : computeNoiseSpectrum(noise, fftSize, fft, dec.work);
    const { used, aRe, aIm } = spec;
    const scale = captured.length / used;
    const nPow = new Float64Array(half + 1);
    const yPow = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      nPow[k] = (aRe[k] * aRe[k] + aIm[k] * aIm[k]) * scale;
      yPow[k] = yRe[k] * yRe[k] + yIm[k] * yIm[k];
    }
    const pnDb = new Float64Array(n);
    const pyDb = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pnDb[i] = powerToDb(bandMean(nPow, k0[i], k1[i]));
      pyDb[i] = powerToDb(bandMean(yPow, k0[i], k1[i]));
    }
    snrDb = snrFromDb(pyDb, pnDb);
    snrValidDb = snrFromDb(
      smoothFractionalOctave(frequencies, pyDb, VALIDITY_SMOOTHING_FRACTION),
      smoothFractionalOctave(frequencies, pnDb, VALIDITY_SMOOTHING_FRACTION),
    );
  }

  let covMax = 0;
  for (let i = 0; i < n; i++) if (coverage[i] > covMax) covMax = coverage[i];
  const covMin = covMax * 10 ** (COVERAGE_DB / 10);
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const snrOk = snrValidDb === null || snrValidDb[i] >= VALID_MIN_SNR_DB;
    valid[i] = coverage[i] >= covMin && snrOk ? 1 : 0;
  }
  const run = longestRun(valid);
  const validRange = run ? [frequencies[run[0]], frequencies[run[1]]] : null;

  return {
    algorithm: TRANSFER_ALGORITHM,
    sampleRate,
    frequencies,
    magnitudeDb,
    phaseDeg,
    snrDb,
    validRange,
    requestedRange: [f1, f2],
    fftSize,
    binHz,
    phaseReason,
    alignment: aligned,
  };
}
