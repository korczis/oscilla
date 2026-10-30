// The analytic signal of the audio buffer, by an FFT Hilbert transform (K024, intent
// audio-band-signal-lab). It is computed from samples generated in this page or captured from
// the microphone, so its real and imaginary parts are the buffer and its Hilbert transform:
// never device I/Q from any receiver hardware.
//
// z[n] = x[n] + j·H{x}[n] is formed in the frequency domain. The buffer is zero-padded to a
// power of two N, transformed with the radix-2 FFT of fft.js, and its spectrum is made
// one-sided: X[0] and X[N/2] are kept, X[1 … N/2−1] doubled, X[N/2+1 … N−1] set to zero. The
// inverse transform is taken by conjugation, IFFT(X) = conj(FFT(conj(X))) / N, so the one
// forward FFT serves both ways.
//
// From z: the envelope |z[n]|, the instantaneous phase arg z[n] wrapped to (−π, π], and the
// instantaneous frequency arg(z[n+1]·conj z[n])·fs / 2π, the mean frequency between samples
// n and n+1 (a phase step, so it needs no unwrapping and is exact for a steady tone).
//
// The FFT treats the padded buffer as one period of a circular signal, so the two ends see a
// discontinuity whose leakage decays only as 1 / distance into the buffer. The ends are
// therefore tapered by a raised cosine over taperFraction of the length before the transform
// (the real part is the buffer itself between the tapers) and are not trusted: ANALYTIC_BOUNDS
// states the errors that hold on the interior, and interiorRange() gives that interior. The
// taper is half the excluded edge, which on the test signals lowers the frequency error on
// the interior from about 7.5 Hz with no taper to about 3.5 mHz.

import { createFft } from './fft.js';

/**
 * The error bounds this module states. They were measured against closed-form analytic
 * signals of AM and FM tones at 44.1 kHz and 48 kHz, buffers of 0.1 s, 0.2 s and 0.5 s and
 * carriers from the low to the high end of trustedBand(), where the largest errors were
 * 4.4e-5 (envelope, relative), 4.4e-5 rad (phase) and 0.043 Hz (frequency); each bound below
 * leaves headroom over that (tests/unit/analysis-analytic.test.mjs).
 */
export const ANALYTIC_BOUNDS = Object.freeze({
  /** The fraction of the buffer at each end that is excluded from the interior. */
  edgeFraction: 0.1,
  /** The fraction of the buffer at each end tapered by a raised cosine before the transform. */
  taperFraction: 0.05,
  /** The largest envelope error on the interior, relative to the true envelope. */
  envelopeRelative: 1e-3,
  /** The largest instantaneous-phase error on the interior, in radians. */
  phaseRad: 1e-3,
  /** The largest instantaneous-frequency error on the interior, in hertz. */
  frequencyHz: 0.25,
  /** The largest difference between the real part and the buffer between the tapers. */
  realPart: 1e-9,
  /** trustedBand() keeps this many periods of its lowest frequency inside each taper. */
  taperPeriods: 5,
  conditions: 'Each bound holds on the interior of a buffer of at least 0.1 s (the samples '
    + 'outside edgeFraction of its length at each end) when every component of the signal '
    + 'lies inside trustedBand(): at least 100 / T Hz above 0 Hz and below the Nyquist '
    + 'frequency, T the buffer duration in seconds, with any modulation far slower than its '
    + 'carrier. It is the analytic signal of the audio buffer, a relative level at the '
    + 'sample rate the buffer was recorded or generated at.',
});

/**
 * The band { low, high } in hertz inside which ANALYTIC_BOUNDS holds for a buffer of `length`
 * samples at `sampleRate`: taperPeriods periods of `low` fit in the taper analyticSignal()
 * actually applies (taperLength(length) samples), and `high` is the same distance below the
 * Nyquist frequency. It is null when there is no such band: the taper is empty (fewer than
 * 1 / taperFraction samples, so no taper is applied) or the margin at each end meets or crosses
 * the other (low >= high, fewer than 420 samples at the default fractions). Null means the
 * module states no bound for that buffer, and analyse() hands it on as band: null.
 */
export function trustedBand(length, sampleRate) {
  if (!(Number.isFinite(sampleRate) && sampleRate > 0))
    throw new RangeError(`sampleRate must be a positive number of hertz, got ${sampleRate}`);
  const taper = taperLength(length);
  if (!(taper >= 1)) return null;
  const margin = (ANALYTIC_BOUNDS.taperPeriods * sampleRate) / taper;
  const low = margin;
  const high = sampleRate / 2 - margin;
  return low < high ? { low, high } : null;
}

/** The smallest power of two of at least n (and at least 2). */
export function nextPowerOfTwo(n) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/** The interior [start, end) of a buffer of `length` samples, edgeFraction excluded at each end. */
export function interiorRange(length, edgeFraction = ANALYTIC_BOUNDS.edgeFraction) {
  if (!(edgeFraction >= 0 && edgeFraction < 0.5))
    throw new RangeError(`edgeFraction must be in [0, 0.5), got ${edgeFraction}`);
  const edge = Math.floor(length * edgeFraction);
  return [edge, length - edge];
}

const fftCache = new Map();
function fftOf(size) {
  let fft = fftCache.get(size);
  if (!fft) {
    fft = createFft(size);
    fftCache.set(size, fft);
  }
  return fft;
}

/** The number of samples a taper of `fraction` covers at each end of `length` samples. */
export function taperLength(length, fraction = ANALYTIC_BOUNDS.taperFraction) {
  if (!(fraction >= 0 && fraction < 0.5))
    throw new RangeError(`taperFraction must be in [0, 0.5), got ${fraction}`);
  return Math.floor(length * fraction);
}

/**
 * The analytic signal of the audio buffer `samples` (an array of numbers). Returns
 * { re, im, length, size, taper }: re and im are Float64Arrays of the buffer's length (re is
 * the buffer, raised-cosine tapered over the first and last `taper` samples, and im its
 * Hilbert transform) and size is the transform length after zero padding. With
 * { taperFraction: 0 } nothing is tapered and re is the buffer everywhere.
 */
export function analyticSignal(samples, options = {}) {
  const { taperFraction = ANALYTIC_BOUNDS.taperFraction } = options;
  if (!samples || typeof samples.length !== 'number')
    throw new TypeError('analyticSignal needs an array of samples');
  const length = samples.length;
  if (length < 1) throw new RangeError('analyticSignal needs at least one sample');
  const taper = taperLength(length, taperFraction);
  const size = nextPowerOfTwo(length);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < length; i++) re[i] = samples[i];
  for (let i = 0; i < taper; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / taper);
    re[i] *= w;
    re[length - 1 - i] *= w;
  }
  const fft = fftOf(size);
  fft.forward(re, im);
  // One-sided spectrum, conjugated in the same pass for the inverse by conjugation.
  const half = size / 2;
  im[0] = -im[0];
  im[half] = -im[half];
  for (let k = 1; k < half; k++) {
    re[k] *= 2;
    im[k] *= -2;
  }
  for (let k = half + 1; k < size; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  fft.forward(re, im);
  const outRe = new Float64Array(length);
  const outIm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    outRe[i] = re[i] / size;
    outIm[i] = -im[i] / size;
  }
  return { re: outRe, im: outIm, length, size, taper };
}

/** The envelope |z[n]| of an analytic signal. */
export function envelope(z) {
  const out = new Float64Array(z.length);
  for (let i = 0; i < z.length; i++) out[i] = Math.hypot(z.re[i], z.im[i]);
  return out;
}

/** The instantaneous phase arg z[n], wrapped to (−π, π]. */
export function instantaneousPhase(z) {
  const out = new Float64Array(z.length);
  for (let i = 0; i < z.length; i++) out[i] = Math.atan2(z.im[i], z.re[i]);
  return out;
}

/** A wrapped phase with each step of more than π replaced by its wrapped step. */
export function unwrapPhase(phase) {
  const out = new Float64Array(phase.length);
  if (phase.length === 0) return out;
  out[0] = phase[0];
  for (let i = 1; i < phase.length; i++) {
    let step = phase[i] - phase[i - 1];
    step -= 2 * Math.PI * Math.round(step / (2 * Math.PI));
    out[i] = out[i - 1] + step;
  }
  return out;
}

/**
 * The instantaneous frequency in hertz: out[n] is the mean frequency between samples n and
 * n + 1, arg(z[n+1]·conj z[n])·sampleRate / 2π, so out has length − 1 values.
 */
export function instantaneousFrequency(z, sampleRate) {
  if (!(Number.isFinite(sampleRate) && sampleRate > 0))
    throw new RangeError(`sampleRate must be a positive number of hertz, got ${sampleRate}`);
  const n = Math.max(0, z.length - 1);
  const out = new Float64Array(n);
  const scale = sampleRate / (2 * Math.PI);
  for (let i = 0; i < n; i++) {
    const a = z.re[i];
    const b = z.im[i];
    const c = z.re[i + 1];
    const d = z.im[i + 1];
    // z[n+1]·conj z[n] = (c + jd)(a − jb)
    out[i] = Math.atan2(d * a - c * b, c * a + d * b) * scale;
  }
  return out;
}

/**
 * The analytic signal of the audio buffer and what it gives: { analytic, envelope, phase,
 * frequency, interior, band }: interior is the [start, end) range and band the trustedBand()
 * in hertz that ANALYTIC_BOUNDS holds on, or null when the buffer is too short to have one (no
 * bound is stated for it then; its envelope, phase and frequency are still computed).
 */
export function analyse(samples, sampleRate) {
  const analytic = analyticSignal(samples);
  return {
    analytic,
    envelope: envelope(analytic),
    phase: instantaneousPhase(analytic),
    frequency: instantaneousFrequency(analytic, sampleRate),
    interior: interiorRange(analytic.length),
    band: trustedBand(analytic.length, sampleRate),
  };
}
