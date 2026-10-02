// Frequency estimation from analyser data: FFT peak search with parabolic interpolation, and a
// normalised-autocorrelation pitch estimate for low frequencies.
//
// Interpolation domain: the parabola is fitted to dB (log magnitude) values by default.
// AnalyserNode applies a Blackman window, whose main lobe is close to a Gaussian, and the log of
// a Gaussian is exactly a parabola; a parabola through linear magnitudes is a poor fit to that
// lobe. Measured on synthetic Web Audio spectra (tests/unit/analysis-peak.test.mjs, 8192-point
// FFT, offsets 0…0.5 bin) the dB fit's worst frequency error is 0.0066 bin against 0.044 bin for
// the linear fit, and its worst level error 0.09 dB against 0.41 dB. 'linear' remains available
// for comparison.
//
// Uncertainty: every FFT estimate reports ±binHz/2. Interpolation is far more precise than that
// for one clean stationary sinusoid, but microphone signals carry noise, reflections and other
// components, and the specification forbids claiming precision beyond the bin resolution.
//
// Level: levelDb is the analyser reading at the interpolated peak (relative, dBFS-like).
// levelDbfs adds the Blackman coherent-gain and one-sided-spectrum correction
// (−20·log10(0.42 / 2) = +13.56 dB) so a full-scale sine (amplitude 1) reads 0 dBFS. It is only
// meaningful for a single stationary sinusoid and is never a sound pressure level.

import { BLACKMAN_COHERENT_GAIN } from './fft.js';

/** dB added to an analyser peak reading to express a sinusoid's amplitude relative to 1.0. */
export const SINE_DBFS_CORRECTION_DB = -20 * Math.log10(BLACKMAN_COHERENT_GAIN / 2);

const DEFAULT_MIN_SNR_DB = 12;
const DEFAULT_ABSOLUTE_FLOOR_DB = -120;

/**
 * Parabolic (quadratic) interpolation through three equally spaced samples a, b, c with b the
 * local maximum. Returns { offset, value }: offset in samples from b, clamped to [−0.5, 0.5].
 */
export function parabolicPeak(a, b, c) {
  const den = a - 2 * b + c;
  if (!(den < 0) || !Number.isFinite(a) || !Number.isFinite(c)) return { offset: 0, value: b };
  let p = (0.5 * (a - c)) / den;
  if (p > 0.5) p = 0.5;
  else if (p < -0.5) p = -0.5;
  return { offset: p, value: b - 0.25 * (a - c) * p };
}

/** In-place quickselect: the k-th smallest of arr[0 … n). */
function quickselect(arr, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) {
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return arr[k];
}

/**
 * Median dB value of spectrum[b0 … b1] (non-finite values count as the lowest), a robust
 * noise-floor estimate when one tone occupies only a few bins of the band.
 */
export function bandMedianDb(spectrum, b0, b1, scratch) {
  const n = b1 - b0 + 1;
  if (n <= 0) return -Infinity;
  const buf = scratch && scratch.length >= n ? scratch : new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = spectrum[b0 + i];
    buf[i] = v > -Infinity ? v : -1e9;
  }
  const m = quickselect(buf, n, n >> 1);
  return m <= -1e9 ? -Infinity : m;
}

/**
 * findPeak(spectrumDb, options) → peak | null
 *
 * spectrumDb   Float32Array of analyser dB values (bin k centred on k·sampleRate/fftSize)
 * options:
 *   sampleRate        required
 *   fftSize           default 2 · spectrumDb.length
 *   minHz, maxHz      search band (default 20 Hz … 0.5·sampleRate)
 *   minSnrDb          required peak height above the band median (default 12 dB)
 *   absoluteFloorDb   required analyser level (default −120 dB)
 *   noiseFloorDb      override the band-median noise estimate
 *   interpolation     'db' (default) or 'linear'
 *   scratch           optional Float32Array reused for the median
 *
 * peak: { frequencyHz, bin, offsetBins, binHz, uncertaintyHz, levelDb, levelDbfs, noiseFloorDb,
 *         snrDb, method }
 * Returns null when the band is empty or nothing rises above the noise floor.
 */
export function findPeak(spectrumDb, options = {}) {
  const sampleRate = options.sampleRate;
  if (!spectrumDb || !(sampleRate > 0)) return null;
  const fftSize = options.fftSize || spectrumDb.length * 2;
  const bw = sampleRate / fftSize;
  const minHz = options.minHz != null ? options.minHz : 20;
  const maxHz = options.maxHz != null ? options.maxHz : sampleRate / 2;
  const b0 = Math.max(1, Math.ceil(minHz / bw));
  const b1 = Math.min(spectrumDb.length - 2, Math.floor(maxHz / bw));
  if (b1 < b0) return null;

  let k = -1;
  let best = -Infinity;
  for (let i = b0; i <= b1; i++) {
    const v = spectrumDb[i];
    // A DC or low-frequency skirt falls monotonically into the band edge; without this test its
    // edge bin would be reported as a confident peak at minHz.
    if (!(v > spectrumDb[i - 1] && v >= spectrumDb[i + 1])) continue;
    if (v > best) {
      best = v;
      k = i;
    }
  }
  if (k < 0 || !(best > -Infinity)) return null;

  const floor =
    options.noiseFloorDb != null
      ? options.noiseFloorDb
      : bandMedianDb(spectrumDb, b0, b1, options.scratch);
  const minSnr = options.minSnrDb != null ? options.minSnrDb : DEFAULT_MIN_SNR_DB;
  const absFloor =
    options.absoluteFloorDb != null ? options.absoluteFloorDb : DEFAULT_ABSOLUTE_FLOOR_DB;
  if (best < absFloor || best - floor < minSnr) return null;

  const a = spectrumDb[k - 1];
  const c = spectrumDb[k + 1];
  let offset;
  let levelDb;
  if (options.interpolation === 'linear') {
    const r = parabolicPeak(10 ** (a / 20), 10 ** (best / 20), 10 ** (c / 20));
    offset = r.offset;
    levelDb = 20 * Math.log10(r.value);
  } else {
    const r = parabolicPeak(a, best, c);
    offset = r.offset;
    levelDb = r.value;
  }
  return {
    frequencyHz: (k + offset) * bw,
    bin: k,
    offsetBins: offset,
    binHz: bw,
    uncertaintyHz: bw / 2,
    levelDb,
    levelDbfs: levelDb + SINE_DBFS_CORRECTION_DB,
    noiseFloorDb: floor,
    snrDb: best - floor,
    method: options.interpolation === 'linear' ? 'fft-parabolic-linear' : 'fft-parabolic-db',
  };
}

/**
 * createPitchDetector(options) → { detect(timeData) → pitch | null, windowSize, maxLag }
 *
 * Normalised square difference function (McLeod & Wyvill, "A smarter way to find pitch", 2005):
 * n(τ) = 2·Σ x[j]x[j+τ] / Σ (x[j]² + x[j+τ]²), in [−1, 1], with the first maximum above
 * clarity · (global maximum) taken as the period and refined by parabolic interpolation.
 * Cost is windowSize × lags per call: run it at readout rate (≈10 Hz), not per frame.
 *
 * options: sampleRate (required), minHz (40), maxHz (1000), windowSize (2048),
 *          clarity (0.9), minConfidence (0.5), rmsFloor (1e-3)
 * pitch: { frequencyHz, confidence (NSDF peak, 0…1), uncertaintyHz, lag, method }
 * uncertaintyHz is the frequency span of ±0.5 sample of lag — the resolution of the lag grid.
 */
export function createPitchDetector(options = {}) {
  const sampleRate = options.sampleRate;
  if (!(sampleRate > 0)) throw new TypeError('createPitchDetector needs a sample rate');
  const minHz = options.minHz || 40;
  const maxHz = Math.min(options.maxHz || 1000, sampleRate / 4);
  const windowSize = options.windowSize || 2048;
  const clarity = options.clarity || 0.9;
  const minConfidence = options.minConfidence != null ? options.minConfidence : 0.5;
  const rmsFloor = options.rmsFloor != null ? options.rmsFloor : 1e-3;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.ceil(sampleRate / minHz);
  const nsdf = new Float64Array(maxLag + 2);
  const sq = new Float64Array(windowSize + maxLag + 2);

  function detect(x) {
    if (!x || x.length < windowSize + maxLag + 1) return null;
    const total = windowSize + maxLag + 1;
    sq[0] = 0;
    let energy = 0;
    for (let i = 0; i < total; i++) {
      const v = x[i];
      sq[i + 1] = sq[i] + v * v;
      if (i < windowSize) energy += v * v;
    }
    if (Math.sqrt(energy / windowSize) < rmsFloor) return null;
    let globalMax = -Infinity;
    const lo = Math.max(1, minLag - 1);
    for (let tau = lo; tau <= maxLag + 1; tau++) {
      let acf = 0;
      for (let j = 0; j < windowSize; j++) acf += x[j] * x[j + tau];
      const m = energy + (sq[tau + windowSize] - sq[tau]);
      nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
      if (tau >= minLag && tau <= maxLag && nsdf[tau] > globalMax) globalMax = nsdf[tau];
    }
    if (!(globalMax > 0)) return null;
    const threshold = clarity * globalMax;
    let best = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (nsdf[tau] >= threshold && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
        best = tau;
        break;
      }
    }
    if (best < 0) return null;
    const r = parabolicPeak(nsdf[best - 1], nsdf[best], nsdf[best + 1]);
    const lag = best + r.offset;
    const confidence = Math.min(1, r.value);
    if (confidence < minConfidence) return null;
    const f = sampleRate / lag;
    const uncertaintyHz = (sampleRate / (lag - 0.5) - sampleRate / (lag + 0.5)) / 2;
    return { frequencyHz: f, confidence, uncertaintyHz, lag, method: 'autocorrelation' };
  }

  return { detect, windowSize, maxLag, minLag };
}

/**
 * estimateFrequency({ spectrumDb, timeData, sampleRate, fftSize, minHz, maxHz, pitchDetector,
 *                     lowFrequencyLimitHz = 1000, minConfidence = 0.8, ...findPeakOptions })
 *
 * FFT peak first. When that peak is below lowFrequencyLimitHz and a pitch detector is given,
 * the autocorrelation estimate replaces it only if it is confident, agrees with the FFT peak
 * within one bin, and has the smaller uncertainty. Returns the chosen estimate (with `fft` and
 * `autocorrelation` attached for display) or null when the FFT finds no peak.
 */
export function estimateFrequency(input) {
  const fft = findPeak(input.spectrumDb, input);
  if (!fft) return null;
  const limit = input.lowFrequencyLimitHz || 1000;
  const minConf = input.minConfidence != null ? input.minConfidence : 0.8;
  let ac = null;
  if (input.pitchDetector && input.timeData && fft.frequencyHz < limit) {
    ac = input.pitchDetector.detect(input.timeData);
  }
  const useAc =
    ac &&
    ac.confidence >= minConf &&
    Math.abs(ac.frequencyHz - fft.frequencyHz) <= fft.binHz &&
    ac.uncertaintyHz < fft.uncertaintyHz;
  if (!useAc) return { ...fft, fft, autocorrelation: ac };
  return {
    ...fft,
    frequencyHz: ac.frequencyHz,
    uncertaintyHz: ac.uncertaintyHz,
    confidence: ac.confidence,
    method: 'autocorrelation',
    fft,
    autocorrelation: ac,
  };
}

/** Rounding step that shows no more precision than the uncertainty (power of ten ≤ u). */
export function displayStepHz(uncertaintyHz) {
  if (!(uncertaintyHz > 0)) return 1;
  return 10 ** Math.floor(Math.log10(uncertaintyHz));
}
