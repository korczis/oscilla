// AnalyserNode reader: reusable Float32Array buffers, bin/frequency helpers, a per-frame read
// throttle, exponential averaging, peak hold and freeze.
//
// The reader never creates nodes; the engine owns the AnalyserNode and passes it in. All values
// are relative analyser levels (dB relative to digital full scale amplitude 1 as defined by the
// Web Audio specification), never SPL.
//
// Averaging is done on power (10^(dB/10)), not on dB values: averaging dB is a geometric mean
// that biases noise downwards by ~2.5 dB. It is expressed as a time constant in seconds, so the
// result does not depend on how often read() is called (α = e^(−Δt/τ) per read).
// It adds to, and is independent of, the node's own smoothingTimeConstant.

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function binHz(sampleRate, fftSize) {
  return sampleRate / fftSize;
}

/** Fractional bin position of frequency f (bin k is centred on k·binHz). */
export function frequencyToBin(f, sampleRate, fftSize) {
  return (f * fftSize) / sampleRate;
}

export function binToFrequency(bin, sampleRate, fftSize) {
  return (bin * sampleRate) / fftSize;
}

/** Nearest bin index to f, clamped to [0, fftSize/2 − 1]. */
export function nearestBin(f, sampleRate, fftSize) {
  const k = Math.round(frequencyToBin(f, sampleRate, fftSize));
  return Math.min(fftSize / 2 - 1, Math.max(0, k));
}

export function dbToAmplitude(db) {
  return db > -Infinity ? 10 ** (db / 20) : 0;
}

export function amplitudeToDb(a) {
  return a > 0 ? 20 * Math.log10(a) : -Infinity;
}

/**
 * createAnalyserReader(analyser, options) → reader
 *
 * options:
 *   sampleRate       defaults to analyser.context.sampleRate
 *   minIntervalMs    read throttle; reads closer together return the cached buffer (default 0:
 *                    one read per distinct timestamp, so several consumers in one frame share it)
 *   averagingS       exponential averaging time constant in seconds (0 = off)
 *   peakHold         keep the per-bin maximum (default false)
 *   peakDecayDbPerS  peak-hold fall rate (0 = hold until resetPeak())
 *
 * reader:
 *   readFrequency(nowMs = performance.now()) → Float32Array (dB; averaged when averaging is
 *                        on); reused buffer
 *   readTime(nowMs)      → Float32Array (time-domain samples); reused buffer
 *   frequency, peak, time, raw  the buffers themselves (peak is −Infinity until data arrives)
 *   binHz, sampleRate, fftSize, binCount
 *   frequencyToBin(f), binToFrequency(k), nearestBin(f)
 *   configure({ minIntervalMs, averagingS, peakHold, peakDecayDbPerS })
 *   freeze(on), frozen          frozen readers return their last buffers unchanged
 *   resetPeak(), resetAverage()
 *   sync()                      reallocates when the analyser's fftSize changed
 *   hasData                     false until the first frequency read
 *   frame                       increments on every fresh frequency read
 */
export function createAnalyserReader(analyser, options = {}) {
  if (!analyser || typeof analyser.getFloatFrequencyData !== 'function') {
    throw new TypeError('createAnalyserReader needs an AnalyserNode');
  }
  const sampleRate = options.sampleRate || (analyser.context && analyser.context.sampleRate);
  if (!(sampleRate > 0)) throw new TypeError('createAnalyserReader needs a sample rate');

  let cfg = {
    minIntervalMs: 0,
    averagingS: 0,
    peakHold: false,
    peakDecayDbPerS: 0,
  };
  let fftSize = 0;
  let raw;
  let freq;
  let pow;
  let peak;
  let time;
  let lastFreqAt = -Infinity;
  let lastTimeAt = -Infinity;
  let averaged = false;
  let frozen = false;
  let hasData = false;
  let frame = 0;

  function alloc() {
    fftSize = analyser.fftSize;
    const bins = analyser.frequencyBinCount;
    raw = new Float32Array(bins);
    freq = new Float32Array(bins).fill(-Infinity);
    pow = new Float64Array(bins);
    peak = new Float32Array(bins).fill(-Infinity);
    time = new Float32Array(fftSize);
    averaged = false;
    hasData = false;
  }

  function configure(next = {}) {
    cfg = { ...cfg, ...next };
    cfg.minIntervalMs = Math.max(0, Number(cfg.minIntervalMs) || 0);
    cfg.averagingS = Math.max(0, Number(cfg.averagingS) || 0);
    cfg.peakDecayDbPerS = Math.max(0, Number(cfg.peakDecayDbPerS) || 0);
    cfg.peakHold = !!cfg.peakHold;
    if (cfg.averagingS === 0) averaged = false;
    if (!cfg.peakHold) peak.fill(-Infinity);
    return { ...cfg };
  }

  function sync() {
    if (analyser.fftSize !== fftSize) alloc();
  }

  function readFrequency(nowMs = defaultNow()) {
    if (frozen) return freq;
    if (nowMs === lastFreqAt || nowMs - lastFreqAt < cfg.minIntervalMs) return freq;
    sync();
    analyser.getFloatFrequencyData(raw);
    const dt = Number.isFinite(lastFreqAt) ? Math.max(0, (nowMs - lastFreqAt) / 1000) : 0;
    const n = raw.length;
    if (cfg.averagingS > 0) {
      if (!averaged) {
        for (let i = 0; i < n; i++) pow[i] = raw[i] > -Infinity ? 10 ** (raw[i] / 10) : 0;
        averaged = true;
      } else {
        const a = Math.exp(-dt / cfg.averagingS);
        const b = 1 - a;
        for (let i = 0; i < n; i++) {
          const p = raw[i] > -Infinity ? 10 ** (raw[i] / 10) : 0;
          pow[i] = a * pow[i] + b * p;
        }
      }
      for (let i = 0; i < n; i++) freq[i] = pow[i] > 0 ? 10 * Math.log10(pow[i]) : -Infinity;
    } else {
      freq.set(raw);
    }
    if (cfg.peakHold) {
      const fall = cfg.peakDecayDbPerS * dt;
      for (let i = 0; i < n; i++) {
        const held = peak[i] - fall;
        peak[i] = freq[i] > held ? freq[i] : held;
      }
    }
    lastFreqAt = nowMs;
    hasData = true;
    frame++;
    return freq;
  }

  function readTime(nowMs = defaultNow()) {
    if (frozen) return time;
    if (nowMs === lastTimeAt || nowMs - lastTimeAt < cfg.minIntervalMs) return time;
    sync();
    analyser.getFloatTimeDomainData(time);
    lastTimeAt = nowMs;
    return time;
  }

  alloc();
  configure(options);

  return {
    get sampleRate() {
      return sampleRate;
    },
    get fftSize() {
      return fftSize;
    },
    get binCount() {
      return raw.length;
    },
    get binHz() {
      return sampleRate / fftSize;
    },
    get frequency() {
      return freq;
    },
    get raw() {
      return raw;
    },
    get peak() {
      return peak;
    },
    get time() {
      return time;
    },
    get frozen() {
      return frozen;
    },
    get hasData() {
      return hasData;
    },
    get frame() {
      return frame;
    },
    get config() {
      return { ...cfg };
    },
    frequencyToBin: (f) => frequencyToBin(f, sampleRate, fftSize),
    binToFrequency: (k) => binToFrequency(k, sampleRate, fftSize),
    nearestBin: (f) => nearestBin(f, sampleRate, fftSize),
    readFrequency,
    readTime,
    configure,
    sync,
    freeze(on = true) {
      frozen = !!on;
      // Unfreezing restarts the averaging clock instead of treating the pause as one long step.
      if (!frozen) {
        lastFreqAt = -Infinity;
        lastTimeAt = -Infinity;
      }
      return frozen;
    },
    resetPeak() {
      peak.fill(-Infinity);
    },
    resetAverage() {
      averaged = false;
    },
  };
}
