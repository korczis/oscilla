// Transfer function H(f) of a measured system from a known stimulus x and its capture y
// (spec §26-§27, §33, §157, §159). Algorithm IDs: 'oscilla.transfer.v2' (default) and
// 'oscilla.transfer.v1' (retained: options.algorithm reproduces it exactly for stored results,
// ADR 0024). The two differ ONLY in the SNR estimate and its fields (section "SNR" below); the
// deconvolution, magnitude, phase and coverage are identical.
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
// SNR (§31-§32), when a separate noise capture n (stimulus silent) is given. For stationary
// noise of power spectral density S (power per DFT bin per sample), the zero-padded N-point DFT
// of M noise samples has E|N[k]|² = M·S(f_k) regardless of padding, so the noise energy per bin
// expected inside the capture y is Pn(f) = len(y)·S(f). With Py(f) = band mean of |Y[k]|²
// (signal + noise) on the grid band, snrDb = 10·log10((Py − Pn)/Pn), floored at −60 dB. The
// per-bin SNR of Y equals that of the H estimate, because division by X scales signal and noise
// alike.
//   v2 (default) estimates S by WELCH averaging of the noise capture (Hann, 50 % overlap,
//     segment L = the power of two ≥ len(n)/4, at most len(n): K ≈ 4-7 segments; NOISE_WELCH),
//     S[k] = mean_seg |DFT(w·seg)[k]|² / Σw², taken onto each grid band as the mean of the Welch
//     bins inside it (linear interpolation at f when the band holds none). A narrow line in the
//     noise (mains hum) is spread over the Welch resolution (ENBW 1.5·fs/L ≤ 6/T_noise Hz), so
//     beside a line the per-point SNR is pessimistic and on it optimistic; the pooled value
//     below is unaffected where its band is wider than that, which the quality assessment's
//     observation rule guarantees (quality.js minSnrObservations). Fields:
//       snrDb            per grid point, as above
//       snrPooledDb      (ΣPy − ΣPn)/ΣPn with Py and Pn power-averaged over 1/6 octave
//                        (VALIDITY_SMOOTHING_FRACTION) around the point: the POOLED POWER RATIO.
//                        Not a mean of per-point ratios: E[1/Pn] > 1/E[Pn] (Jensen), so a mean
//                        of ratios over a pool of few noise observations is biased high (+3-4 dB
//                        below 150 Hz with a 1 s noise check, review probe p2c).
//       snrResolutionHz  sampleRate / len(n) = 1/T_noise, the frequency resolution of the noise
//                        estimate: a 1/6-octave pool at f holds ≈ 0.1155·f/snrResolutionHz
//                        independent noise observations (the time-bandwidth product).
//       resolutionHz     max(binHz, sampleRate/len(y)): the zero-padded bin spacing is finer
//                        than the capture can resolve (1/T_capture).
//     SNR NOT MEASURED (snrDb = snrPooledDb = null, snrResolutionHz kept): when Pn is zero at
//     any grid point (a digitally silent or gated noise capture) or any ratio reaches
//     SNR_CEIL_DB. A noise capture without noise power is not a noise-floor measurement, and
//     the 200 dB ceiling is never stored as a value (v1 stored it, review B1).
//   v1 (retained) used the zero-padded N-point periodogram |N[k]|² of the noise scaled by
//     len(y)/len(n), clamped snrDb to [−60, 200] dB (200 dB when Pn = 0) and stored no pooled
//     SNR, snrResolutionHz or resolutionHz. Its per-point Pn is one periodogram: with
//     N > len(n) the zero-padded bins are correlated, ≈ 1 independent observation per
//     1/T_noise Hz, so per-point SNR scatters by several dB at low frequencies.
//
// validRange (§157): the longest contiguous run of grid points that are (a) covered by the
// stimulus — the per-relative-bandwidth stimulus energy f·P_x(f), P_x the band mean of |X|²,
// is within 20 dB of its maximum on the grid (flat for a log sweep or pink noise, so this
// rejects leakage outside the swept band and a Nyquist clamp) — and (b), when an SNR is
// measured, reach 10 dB pooled SNR (the 1/6-octave power ratio above; in v2 that is
// snrPooledDb). Pooling matters: a power average over K independent observations of an
// exponentially distributed bin power scatters by ≈ 4.34/√K dB, and K is the time-bandwidth
// product B·T of the band (for the noise B·T_noise), NOT the number of zero-padded bins in it,
// which are correlated whenever N exceeds the record length. Without pooling the range would
// fragment at the first dip. null when no point qualifies. requestedRange is always [f1, f2] as requested, even past Nyquist; the grid
// itself stops at Nyquist (§205).
//
// Assumptions: x and y share sampleRate and are mono, sample-synchronous (one clock) and
// linear time-invariant apart from additive noise; harmonic distortion is not separated (use
// impulse-response.js and window its causal part for that). Inputs are never mutated.

import { createFft } from '../analysis/fft.js';
import { smoothFractionalOctave } from './smoothing.js';
import { ALGORITHMS } from './algorithms.js';
import { welch } from './spectrum.js';

/** Default method for new transfers: 'oscilla.transfer.v2'. */
export const TRANSFER_ALGORITHM = ALGORITHMS.transfer;
/** The retained first method (periodogram SNR, ceiling stored; see the header). */
export const TRANSFER_ALGORITHM_V1 = 'oscilla.transfer.v1';
/** Every transfer method this build reproduces (options.algorithm). */
export const TRANSFER_ALGORITHMS = Object.freeze([TRANSFER_ALGORITHM_V1, TRANSFER_ALGORITHM]);
/** v2 Welch estimate of the noise PSD (see the header). */
export const NOISE_WELCH = Object.freeze({ window: 'hann', overlap: 0.5, segmentFraction: 1 / 4 });

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
  const {
    phase = false, pointsPerOctave = DEFAULT_POINTS_PER_OCTAVE, algorithm = TRANSFER_ALGORITHM,
  } = options;
  if (!TRANSFER_ALGORITHMS.includes(algorithm))
    throw new RangeError(`unknown transfer method '${algorithm}' (known: `
      + `${TRANSFER_ALGORITHMS.join(', ')})`);
  if (!(pointsPerOctave > 0)) throw new RangeError('pointsPerOctave must be positive');
  if (lagSamples !== undefined && !Number.isFinite(lagSamples))
    throw new RangeError(`lagSamples must be finite, got ${lagSamples}`);
  const aligned = alignmentSummary(alignment);
  if (noise !== null) assertSignal('noise', noise);
  return { pointsPerOctave, phase, aligned, algorithm };
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
 *   options     { phase = false, pointsPerOctave = 48, algorithm = TRANSFER_ALGORITHM }
 *               (algorithm: one of TRANSFER_ALGORITHMS; the v1 method for stored results)
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
 * noiseSpectrum(noise, fftSize, fft, { algorithm }) → the noise estimate of a stimulus-free
 * capture as computeTransfer's SNR uses it:
 *   v2 (default)  { algorithm, noise, fftSize, used, segment, segments, psd }: the Welch PSD
 *                 (NOISE_WELCH; psd[k] per sample per bin, bins of sampleRate/segment Hz)
 *   v1            { algorithm, noise, fftSize, used, aRe, aIm }: the half spectrum of the first
 *                 `used` = min(len, fftSize) samples, zero padded to fftSize
 * It depends only on the noise capture, the FFT size and the method, so a caller analysing
 * several runs against one noise capture computes it once and passes it as `noiseSpectrum`; it
 * is used only when its `noise` is the very array passed as `noise` and its fftSize and
 * algorithm match, otherwise recomputed (the result is the same either way).
 */
export function noiseSpectrum(noise, fftSize, fft = null, { algorithm = TRANSFER_ALGORITHM } = {}) {
  assertSignal('noise', noise);
  if (algorithm === TRANSFER_ALGORITHM_V1)
    return computeNoiseSpectrum(noise, fftSize, fftPlan(fftSize, fft), null);
  return welchNoiseSpectrum(noise, fftSize);
}

function computeNoiseSpectrum(noise, fftSize, fft, work) {
  const used = Math.min(noise.length, fftSize);
  const { aRe, aIm } = realPairSpectra(fft, noise.length > used ? noise.subarray(0, used) : noise,
    null, work);
  return { algorithm: TRANSFER_ALGORITHM_V1, noise, fftSize, used, aRe, aIm };
}

/** Welch segment length for `len` noise samples: the power of two ≥ len·segmentFraction, at
 *  most the largest power of two ≤ len (≥ 2), so there is always one full segment. */
export function noiseWelchSegment(len) {
  let floor = 1;
  while (floor * 2 <= len) floor *= 2;
  const want = Math.ceil(len * NOISE_WELCH.segmentFraction);
  let seg = 1;
  while (seg < want) seg *= 2;
  return Math.max(2, Math.min(seg, floor));
}

/** v2: Welch PSD per sample per bin (|DFT(w·seg)|²/Σw², averaged); null when len < 2. */
function welchNoiseSpectrum(noise, fftSize) {
  const base = { algorithm: TRANSFER_ALGORITHM, noise, fftSize, used: noise.length };
  if (noise.length < 2) return { ...base, segment: null, segments: 0, psd: null };
  const segment = noiseWelchSegment(noise.length);
  const w = welch(noise, { fftSize: segment, overlap: NOISE_WELCH.overlap,
    window: NOISE_WELCH.window, scale: 'mean-square' });
  // mean-square P[k] = c·|X[k]|²/(L·Σw²), c = 2 inside, 1 at DC and Nyquist → |X|²/Σw² = P·L/c.
  const half = segment / 2;
  const psd = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++)
    psd[k] = w.power[k] * (k === 0 || k === half ? segment : segment / 2);
  return { ...base, segment, segments: w.segments, psd };
}

/** v2: noise PSD (per sample per bin) on each grid band: mean of the Welch bins in it, else
 *  linear interpolation at the band centre. */
function psdOnGrid(spec, frequencies, pointsPerOctave, sampleRate) {
  const { psd, segment } = spec;
  const half = segment / 2;
  const bw = sampleRate / segment;
  const edge = 2 ** (1 / (2 * pointsPerOctave));
  const out = new Float64Array(frequencies.length);
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    const a = Math.ceil(f / edge / bw);
    const b = Math.min(half, Math.ceil((f * edge) / bw) - 1);
    if (b >= a) {
      let s = 0;
      for (let k = a; k <= b; k++) s += psd[k];
      out[i] = s / (b - a + 1);
    } else {
      const x = Math.min(half, f / bw);
      const k = Math.min(half - 1, Math.floor(x));
      const t = x - k;
      out[i] = psd[k] + t * (psd[k + 1] - psd[k]);
    }
  }
  return out;
}

/** v2 per-point SNR: (Py − Pn)/Pn in dB floored at SNR_FLOOR_DB; null when any Pn is zero or
 *  any ratio reaches SNR_CEIL_DB (no noise power: SNR NOT MEASURED, see the header). */
function snrFromDbV2(pyDb, pnDb) {
  const out = new Float64Array(pyDb.length);
  for (let i = 0; i < out.length; i++) {
    if (!(pnDb[i] > ZERO_POWER_DB)) return null;
    const pn = 10 ** (pnDb[i] / 10);
    const py = pyDb[i] > ZERO_POWER_DB ? 10 ** (pyDb[i] / 10) : 0;
    const db = py > pn ? 10 * Math.log10((py - pn) / pn) : SNR_FLOOR_DB;
    if (!(db < SNR_CEIL_DB)) return null;
    out[i] = Math.max(SNR_FLOOR_DB, db);
  }
  return out;
}

/**
 * TransferResult from a spectralDeconvolution() result (the second half of computeTransfer).
 * `checked` is checkTransferArgs()'s output. Uses dec.work as scratch for the noise spectrum.
 */
export function transferFromDeconvolution(dec, {
  captured, sampleRate, f1, f2, lagSamples, noise = null, noiseSpectrum = null, pointsPerOctave,
  phase, aligned, algorithm = TRANSFER_ALGORITHM,
}) {
  const v1 = algorithm === TRANSFER_ALGORITHM_V1;
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
  let snrResolutionHz = null;
  const reuse = (alg) => noiseSpectrum !== null && noiseSpectrum.noise === noise
    && noiseSpectrum.fftSize === fftSize && (noiseSpectrum.algorithm ?? TRANSFER_ALGORITHM_V1)
    === alg;
  if (noise !== null && !v1) {
    snrResolutionHz = sampleRate / noise.length;
    const spec = reuse(TRANSFER_ALGORITHM) ? noiseSpectrum : welchNoiseSpectrum(noise, fftSize);
    if (spec.psd) {
      const s = psdOnGrid(spec, frequencies, pointsPerOctave, sampleRate);
      const pnDb = new Float64Array(n);
      const pyDb = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        pnDb[i] = powerToDb(captured.length * s[i]);
        let py = 0;
        for (let k = k0[i]; k <= k1[i]; k++) py += yRe[k] * yRe[k] + yIm[k] * yIm[k];
        pyDb[i] = powerToDb(py / (k1[i] - k0[i] + 1));
      }
      snrDb = snrFromDbV2(pyDb, pnDb);
      if (snrDb) {
        snrValidDb = snrFromDbV2(
          smoothFractionalOctave(frequencies, pyDb, VALIDITY_SMOOTHING_FRACTION),
          smoothFractionalOctave(frequencies, pnDb, VALIDITY_SMOOTHING_FRACTION),
        );
        if (!snrValidDb) snrDb = null;
      }
    }
  } else if (noise !== null) {
    const spec = reuse(TRANSFER_ALGORITHM_V1)
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

  if (v1) {
    return {
      algorithm: TRANSFER_ALGORITHM_V1,
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
  return {
    algorithm: TRANSFER_ALGORITHM,
    sampleRate,
    frequencies,
    magnitudeDb,
    phaseDeg,
    snrDb,
    snrPooledDb: snrValidDb,
    snrResolutionHz,
    validRange,
    requestedRange: [f1, f2],
    fftSize,
    binHz,
    resolutionHz: Math.max(binHz, sampleRate / captured.length),
    phaseReason,
    alignment: aligned,
  };
}
