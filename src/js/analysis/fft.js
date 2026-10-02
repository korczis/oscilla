// Radix-2 FFT and an AnalyserNode-compatible magnitude spectrum, for analysing samples that
// do not pass through a live AnalyserNode (rendered exports, decoded WAV files, tests).
//
// spectrumDb() reproduces the Web Audio AnalyserNode frequency analysis (Web Audio API §1.8.6,
// "FFT windowing and smoothing over time") with smoothing off: a Blackman window with a = 0.16,
// X[k] = (1/N) Σ x[n]·w[n]·e^(−j2πkn/N), and 20·log10|X[k]| for k < N/2. The output of this
// module and of getFloatFrequencyData() therefore share one scale and feed the same peak
// detector.

const BLACKMAN_ALPHA = 0.16;

/** Coherent gain of the Web Audio Blackman window: Σw[n]/N = a0 = (1 − α)/2 = 0.42. */
export const BLACKMAN_COHERENT_GAIN = (1 - BLACKMAN_ALPHA) / 2;

export function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** Web Audio Blackman window of length n (periodic form, as in the specification). */
export function blackmanWindow(n, out = new Float32Array(n)) {
  const a0 = (1 - BLACKMAN_ALPHA) / 2;
  const a1 = 0.5;
  const a2 = BLACKMAN_ALPHA / 2;
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    out[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x);
  }
  return out;
}

/**
 * In-place complex FFT of a fixed power-of-two size, with precomputed twiddles and bit
 * reversal. forward(re, im) transforms Float64Array (or Float32Array) buffers of length size.
 */
export function createFft(size) {
  if (!isPowerOfTwo(size) || size < 2)
    throw new RangeError(`FFT size must be a power of two ≥ 2, got ${size}`);
  const levels = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }
  function forward(re, im) {
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
  return { size, forward };
}

/**
 * Reusable AnalyserNode-equivalent spectrum of `size` samples. compute(samples, offset, out)
 * windows samples[offset … offset + size) and writes size/2 dB values into out (a reused
 * Float32Array by default). Samples past the end of the input count as zeros.
 */
export function createSpectrumAnalyzer(size) {
  const fft = createFft(size);
  const win = blackmanWindow(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const binCount = size / 2;
  const own = new Float32Array(binCount);
  function compute(samples, offset = 0, out = own) {
    for (let i = 0; i < size; i++) {
      const j = offset + i;
      re[i] = j < samples.length ? samples[j] * win[i] : 0;
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let k = 0; k < binCount; k++) {
      const mag = Math.hypot(re[k], im[k]) / size;
      out[k] = mag > 0 ? 20 * Math.log10(mag) : -Infinity;
    }
    return out;
  }
  return { size, binCount, compute };
}

/** One-shot convenience wrapper around createSpectrumAnalyzer. */
export function spectrumDb(samples, size, offset = 0) {
  return createSpectrumAnalyzer(size).compute(samples, offset, new Float32Array(size / 2));
}
