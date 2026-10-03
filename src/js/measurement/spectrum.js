// Offline spectral helpers for captured PCM: windows, a one-sided power spectrum and Welch
// averaging. Pure; the FFT is V2's radix-2 createFft (analysis/fft.js).
//
// Windows are the periodic (DFT-even) forms, w[n] for n = 0 … N−1 with period N, so their gain
// constants are exact for any N:
//   hann              w = 0.5 − 0.5·cos(2πn/N)                       coherent 0.5, NPG 0.375
//   blackman-harris   4-term, a = 0.35875, 0.48829, 0.14128, 0.01168 (Harris 1978, "On the use
//                     of windows for harmonic analysis with the DFT", −92 dB side lobes)
// coherentGain = Σw/N (amplitude of a bin-centred tone), noisePowerGain = Σw²/N, and
// enbwBins = noisePowerGain / coherentGain² (equivalent noise bandwidth: 1.5 bins for Hann,
// ≈ 2.0044 for Blackman-Harris).
//
// Power scales (POWER_SCALES; the ONE definition for OSCILLA, docs/v3/algorithms.md
// "Conventions"):
//   'tone' (default; AES17-style dBFS): P[k] = |2·X[k] / (N·coherentGain)|² for 0 < k < N/2 and
//     |X[k] / (N·coherentGain)|² at DC and Nyquist, so a full-scale sine (amplitude 1) centred
//     on a bin reads P = 1, i.e. 0 dB after toDb(). An off-centre tone reads lower by the
//     window's scalloping loss (up to 1.42 dB for Hann, 0.83 dB for Blackman-Harris). Use it to
//     read the amplitude of a tone; Σ P[k] over a band overstates broadband power by enbwBins.
//   'mean-square' (PSD × bin width): P[k] = c·|X[k]|² / (N·Σw²), c = 2 for 0 < k < N/2 and 1 at
//     DC and Nyquist, so Σ P[k] is the signal's mean square (Parseval) and a full-scale sine
//     summed over the bins around it reads 0.5 = −3.01 dB whatever the window or bin offset.
//     This is the scale of every band level (rta.js).
//   The conversion is explicit and named: toneToMeanSquare(P, window) multiplies by
//   1/(2·enbwBins) for 0 < k < N/2 and by 1/enbwBins at DC and Nyquist (the two definitions
//   above divided). welch() and powerSpectrum() take { scale } and welch() reports the scale it
//   used, so rta.js converts a welch() result itself instead of trusting the caller.
// Every window result names its algorithm ID (WINDOW_ALGORITHMS): oscilla.window.hann.v1,
// oscilla.window.blackman-harris.v1; welch() reports it as windowAlgorithm.
//
// welch() averages linear power over overlapping windowed segments (Welch 1967). Averaging dB
// values instead would bias noise low by 2.5 dB (the mean of the log of an exponential
// variable) and is never done here.

import { createFft, isPowerOfTwo } from '../analysis/fft.js';
import { ALGORITHMS } from './algorithms.js';

const BH = Object.freeze([0.35875, 0.48829, 0.14128, 0.01168]);

/** Gain constants of the periodic windows (exact, see the header). */
export const WINDOW_GAINS = Object.freeze({
  hann: Object.freeze({ coherentGain: 0.5, noisePowerGain: 0.375 }),
  'blackman-harris': Object.freeze({
    coherentGain: BH[0],
    noisePowerGain: BH[0] ** 2 + (BH[1] ** 2 + BH[2] ** 2 + BH[3] ** 2) / 2,
  }),
});

export const WINDOW_NAMES = Object.freeze(Object.keys(WINDOW_GAINS));

/** Algorithm ID of each window (spec §86: the window is recorded as an algorithm choice). */
export const WINDOW_ALGORITHMS = Object.freeze({
  hann: ALGORITHMS.window,
  'blackman-harris': ALGORITHMS.windowBlackmanHarris,
});

/** The power scales of this module (see the header); 'tone' is the default. */
export const POWER_SCALES = Object.freeze(['tone', 'mean-square']);

/** Algorithm ID of a window name ('hann' | 'blackman-harris'); throws for any other. */
export function windowAlgorithm(name) {
  if (!Object.hasOwn(WINDOW_ALGORITHMS, name))
    throw new RangeError(`Unknown window "${name}" (use ${WINDOW_NAMES.join(', ')})`);
  return WINDOW_ALGORITHMS[name];
}

function checkScale(scale) {
  if (!POWER_SCALES.includes(scale))
    throw new RangeError(`power scale must be ${POWER_SCALES.join(' or ')}, got ${scale}`);
  return scale;
}

/**
 * toneToMeanSquare(power, window, out?) → Float64Array
 * Converts a one-sided 'tone'-scaled spectrum (bins 0 … N/2, the last bin is Nyquist) of the
 * given window (a name or a windowFn() result) to the 'mean-square' scale: × 1/(2·enbwBins)
 * for 0 < k < N/2, × 1/enbwBins at DC and Nyquist. `power` is not modified unless passed as
 * `out`.
 */
export function toneToMeanSquare(power, window, out = new Float64Array(power.length)) {
  const name = typeof window === 'string' ? window : window && window.name;
  const gains = WINDOW_GAINS[name];
  if (!gains) throw new RangeError(`Unknown window "${name}" (use ${WINDOW_NAMES.join(', ')})`);
  const enbw = gains.noisePowerGain / gains.coherentGain ** 2;
  const last = power.length - 1;
  for (let k = 0; k <= last; k++) {
    out[k] = power[k] / (k === 0 || k === last ? enbw : 2 * enbw);
  }
  return out;
}

/** Smallest power of two ≥ n (n ≥ 1). */
export function nextPow2(n) {
  if (!(n >= 1) || !Number.isFinite(n)) throw new RangeError(`nextPow2 needs n ≥ 1, got ${n}`);
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Bin spacing in Hz. */
export function binHz(sampleRate, fftSize) {
  return sampleRate / fftSize;
}

/** 10·log10 of a linear power; 0 or less maps to −Infinity. */
export function toDb(power) {
  return power > 0 ? 10 * Math.log10(power) : -Infinity;
}

/**
 * windowFn(name, n) → { name, algorithm, samples: Float64Array, coherentGain, noisePowerGain,
 *   enbwBins }
 * name: 'hann' | 'blackman-harris'; algorithm: its WINDOW_ALGORITHMS ID.
 */
export function windowFn(name, n) {
  const gains = WINDOW_GAINS[name];
  if (!gains) throw new RangeError(`Unknown window "${name}" (use ${WINDOW_NAMES.join(', ')})`);
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Window length must be ≥ 1, got ${n}`);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    w[i] =
      name === 'hann'
        ? 0.5 - 0.5 * Math.cos(x)
        : BH[0] - BH[1] * Math.cos(x) + BH[2] * Math.cos(2 * x) - BH[3] * Math.cos(3 * x);
  }
  return Object.freeze({
    name,
    algorithm: WINDOW_ALGORITHMS[name],
    samples: w,
    coherentGain: gains.coherentGain,
    noisePowerGain: gains.noisePowerGain,
    enbwBins: gains.noisePowerGain / gains.coherentGain ** 2,
  });
}

/**
 * createPowerSpectrumAnalyzer(fftSize, window = 'hann', { scale = 'tone' })
 *   → { fftSize, window, scale, compute }
 * compute(samples, offset = 0, out?) writes fftSize/2 + 1 linear powers (bins 0 … N/2) on the
 * requested power scale into out (a new Float64Array by default). Samples outside the input
 * count as zeros. Reuse one analyzer for many frames: the FFT tables and window are built once.
 */
export function createPowerSpectrumAnalyzer(fftSize, window = 'hann', { scale = 'tone' } = {}) {
  if (!isPowerOfTwo(fftSize) || fftSize < 2)
    throw new RangeError(`fftSize must be a power of two ≥ 2, got ${fftSize}`);
  checkScale(scale);
  const fft = createFft(fftSize);
  const win = windowFn(window, fftSize);
  const w = win.samples;
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const half = fftSize / 2;
  // tone: 4|X|²/(N·cg)² inside, |X|²/(N·cg)² at the ends; mean-square: 2|X|²/(N²·npg) inside,
  // |X|²/(N²·npg) at the ends (N·Σw² = N²·npg).
  const meanSquare = scale === 'mean-square';
  const norm = meanSquare
    ? 1 / (fftSize * fftSize * win.noisePowerGain)
    : 1 / (fftSize * win.coherentGain) ** 2;
  const inner = meanSquare ? 2 : 4;

  function compute(samples, offset = 0, out = new Float64Array(half + 1)) {
    for (let i = 0; i < fftSize; i++) {
      const j = offset + i;
      re[i] = j >= 0 && j < samples.length ? samples[j] * w[i] : 0;
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let k = 0; k <= half; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) * norm;
      out[k] = k === 0 || k === half ? p : inner * p;
    }
    return out;
  }

  return { fftSize, window: win, scale, compute };
}

/**
 * powerSpectrum(samples, { fftSize, window = 'hann', offset = 0, scale = 'tone' })
 *   → Float64Array
 * One frame, fftSize/2 + 1 bins; default tone scaling (full-scale bin-centred sine = 1 = 0 dB),
 * scale 'mean-square' for Σ P = mean square. fftSize defaults to the largest power of two that
 * fits the samples from offset.
 */
export function powerSpectrum(samples, options = {}) {
  const offset = options.offset || 0;
  // the samples from offset (V382: the whole array, so an offset frame was zero padded)
  const fftSize = options.fftSize
    || 2 ** Math.floor(Math.log2(Math.max(2, samples.length - offset)));
  return createPowerSpectrumAnalyzer(fftSize, options.window || 'hann',
    { scale: options.scale || 'tone' }).compute(samples, offset);
}

/**
 * welch(samples, { fftSize, overlap = 0.5, window = 'hann', scale = 'tone' })
 *   → { power: Float64Array, segments, fftSize, hop, window, scale, windowAlgorithm }
 * Mean of the linear power spectra of every full segment (start = 0, hop, 2·hop, … while the
 * segment fits). overlap in [0, 0.95]; 50 % with Hann keeps the segment weights nearly flat.
 * `window` is the window name, `windowAlgorithm` its ID, `scale` the power scale of `power`
 * (pass the whole result to rta.js bandPowers/bandAnalysis, which converts by that scale).
 * Throws when the input is shorter than one segment instead of zero-padding silently.
 */
export function welch(samples, options = {}) {
  const fftSize = options.fftSize;
  const overlap = options.overlap != null ? options.overlap : 0.5;
  const window = options.window || 'hann';
  const scale = checkScale(options.scale || 'tone');
  if (!(overlap >= 0 && overlap <= 0.95))
    throw new RangeError(`overlap must be in [0, 0.95], got ${overlap}`);
  if (!samples || samples.length < fftSize)
    throw new RangeError(`welch needs at least fftSize (${fftSize}) samples`);
  const analyzer = createPowerSpectrumAnalyzer(fftSize, window, { scale });
  const hop = Math.max(1, Math.round(fftSize * (1 - overlap)));
  const bins = fftSize / 2 + 1;
  const acc = new Float64Array(bins);
  const frame = new Float64Array(bins);
  let segments = 0;
  for (let start = 0; start + fftSize <= samples.length; start += hop) {
    analyzer.compute(samples, start, frame);
    for (let k = 0; k < bins; k++) acc[k] += frame[k];
    segments++;
  }
  for (let k = 0; k < bins; k++) acc[k] /= segments;
  return {
    power: acc,
    segments,
    fftSize,
    hop,
    window: analyzer.window.name,
    scale,
    windowAlgorithm: analyzer.window.algorithm,
  };
}
