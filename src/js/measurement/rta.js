// Real-time-analyser (RTA) band analysis: octave and one-third-octave band layout, band levels
// integrated from an FFT power spectrum, and exponential time averaging with peak hold.
// Algorithm id: ALGORITHMS.rta = 'oscilla.rta.v1' (docs/v3/architecture.md).
//
// Band-edge mathematics (IEC 61260-1:2014 §5.2-§5.4; ANSI S1.11-2004, same definitions):
//   base-10 octave ratio  G = 10^(3/10) ≈ 1.99526
//   reference frequency   f_r = 1000 Hz
//   exact mid-band        f_m = f_r · G^(x/b), x integer, b = 1 (octave) or 3 (one-third octave)
//                         (b odd, so the standard's odd-b formula applies)
//   band edges            f_1 = f_m · G^(−1/(2b)),  f_2 = f_m · G^(+1/(2b))
// Edges are computed as f_r · 10^(3·(2x ± 1)/(20b)), which is the same expression rearranged;
// the upper edge of band x and the lower edge of band x + 1 are then the same floating-point
// computation, so adjacent bands share their edge bit-for-bit.
// Nominal mid-band labels are the standard's preferred numbers (IEC 61260-1 Annex E, ISO 266,
// R10 series): 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8 per decade. Base-10 G makes exactly ten
// one-third-octave bands per decade, so x maps onto that series without approximation; an octave
// band is the one-third-octave band with index 3x. The table matches the V2
// THIRD_OCTAVE_FREQUENCIES constant (src/js/core/constants.js), checked by the unit tests.
//
// What this is NOT: OSCILLA does not implement IEC 61260-1 filter classes. The standard
// specifies the relative attenuation of a band filter at every frequency (class 1 / class 2
// tolerance masks); summing FFT-bin power over the band is a rectangular "brick-wall" band
// estimate whose skirts are set by the analysis window and the bin resolution, not by those
// masks. Band levels here are ESTIMATED, relative (dBFS-like) unless a level calibration is
// applied downstream, and narrow bands with few bins are flagged as under-resolved.
//
// Band integration: power[k] is the one-sided linear power of bin k, normalised by the caller so
// that Σ power[k] is the signal's mean square (power spectral density × bin width; for a
// window w of length N: P[k] = c·|X[k]|² / (N·Σw²) with c = 2 except c = 1 at DC and Nyquist).
// Bin k is taken to cover [(k − ½)·binHz, (k + ½)·binHz]; a bin partially inside a band
// contributes power[k] times the fraction of its width that the band overlaps (uniform power
// within a bin). Band power is a sum of linear power and only the result is converted to dB;
// dB values are never averaged.
//
// Time averaging: exponential averaging of POWER per band, y ← y + α·(p − y) with
// α = 1 − e^(−Δt/τ). FAST (τ = 125 ms) and SLOW (τ = 1 s) follow the conventional sound-level
// meter time weightings (IEC 61672-1 §5.8) in name and time constant only: they are applied per
// analysis frame of a block FFT, not as a continuous detector on the squared signal, and are not
// verified against IEC 61672-1.

/** Base-10 octave frequency ratio G = 10^(3/10) (IEC 61260-1 §5.2). */
export const OCTAVE_RATIO_G = 10 ** (3 / 10);
/** Reference frequency f_r of the band series (IEC 61260-1 §5.3). */
export const REFERENCE_FREQUENCY_HZ = 1000;
/** Bands per octave by kind. */
export const BANDS_PER_OCTAVE = Object.freeze({ octave: 1, third: 3 });
/** Bands whose upper edge exceeds this fraction of Nyquist are excluded (engine discipline). */
export const NYQUIST_FRACTION = 0.95;
/** A band covering fewer FFT bins than this is flagged underResolved. */
export const UNDER_RESOLVED_BINS = 2;
/** FAST time constant (s), the conventional sound-level-meter value; not IEC-verified here. */
export const RTA_TAU_FAST_S = 0.125;
/** SLOW time constant (s), the conventional sound-level-meter value; not IEC-verified here. */
export const RTA_TAU_SLOW_S = 1;
/** Averaging modes and their time constants (null: no averaging). */
export const RTA_MODES = Object.freeze({
  instant: null,
  fast: RTA_TAU_FAST_S,
  slow: RTA_TAU_SLOW_S,
});

// R10 preferred numbers × 100 (ISO 266 / IEC 61260-1 Annex E), index = x mod 10.
const R10_X100 = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800];

/** Nominal (preferred-number) label of the one-third-octave band with index x (x = 0: 1 kHz). */
function nominalThird(x) {
  const m = ((x % 10) + 10) % 10;
  const decade = Math.floor(x / 10);
  // value = R10[m] / 100 · 10^(3 + decade); integer arithmetic keeps decimals exact.
  const e = 1 + decade;
  return e >= 0 ? R10_X100[m] * 10 ** e : R10_X100[m] / 10 ** -e;
}

function bandsPerOctave(kind) {
  const b = BANDS_PER_OCTAVE[kind];
  if (!b) throw new TypeError(`band kind must be 'octave' or 'third', got ${kind}`);
  return b;
}

/**
 * bandCenters(kind, fMin, fMax, sampleRate) → [{ nominal, exact, lo, hi }]
 *
 * Bands of the base-10 series whose NOMINAL mid-band frequency lies in [fMin, fMax] (so callers
 * can pass the labels printed in the standard's tables, e.g. 20 … 20000), excluding every band
 * whose upper edge exceeds 0.95 × Nyquist. Sorted by frequency. exact, lo, hi in Hz.
 */
export function bandCenters(kind, fMin, fMax, sampleRate) {
  const b = bandsPerOctave(kind);
  if (!(fMin > 0) || !(fMax >= fMin) || !Number.isFinite(fMax))
    throw new RangeError(`band range must satisfy 0 < fMin ≤ fMax, got ${fMin} … ${fMax}`);
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate))
    throw new RangeError(`sample rate must be positive, got ${sampleRate}`);
  const limit = (NYQUIST_FRACTION * sampleRate) / 2;
  const toIndex = (f) => (b * Math.log10(f / REFERENCE_FREQUENCY_HZ)) / 0.3;
  // Nominal and exact values differ by < 3 %, far less than one band: ±1 index of slack.
  const x0 = Math.floor(toIndex(fMin)) - 1;
  const x1 = Math.ceil(toIndex(fMax)) + 1;
  const out = [];
  for (let x = x0; x <= x1; x++) {
    const nominal = nominalThird((3 / b) * x);
    if (nominal < fMin || nominal > fMax) continue;
    const exact = REFERENCE_FREQUENCY_HZ * 10 ** ((3 * x) / (10 * b));
    const lo = REFERENCE_FREQUENCY_HZ * 10 ** ((3 * (2 * x - 1)) / (20 * b));
    const hi = REFERENCE_FREQUENCY_HZ * 10 ** ((3 * (2 * x + 1)) / (20 * b));
    if (hi > limit) continue;
    out.push({ nominal, exact, lo, hi });
  }
  return out;
}

/**
 * bandBinCounts(binHz, bands, binCount = Infinity) → { binCounts: Float64Array,
 *   underResolved: boolean[] }
 *
 * Effective number of FFT bins each band integrates (the sum of the fractional weights: the
 * band width in bins where the spectrum covers it). A band under UNDER_RESOLVED_BINS bins is
 * underResolved: its level is dominated by the window's main lobe and bin placement, not by the
 * band shape.
 */
export function bandBinCounts(binHz, bands, binCount = Infinity) {
  checkBinHz(binHz);
  const binCounts = new Float64Array(bands.length);
  const underResolved = new Array(bands.length);
  const top = (binCount - 0.5) * binHz;
  for (let i = 0; i < bands.length; i++) {
    const lo = Math.max(bands[i].lo, -0.5 * binHz);
    const hi = Math.min(bands[i].hi, top);
    binCounts[i] = hi > lo ? (hi - lo) / binHz : 0;
    underResolved[i] = binCounts[i] < UNDER_RESOLVED_BINS;
  }
  return { binCounts, underResolved };
}

function checkBinHz(binHz) {
  if (!(binHz > 0) || !Number.isFinite(binHz))
    throw new RangeError(`bin width must be positive, got ${binHz}`);
}

/**
 * integrateBands(power, binHz, bands, out = new Float64Array(bands.length)) → out
 *
 * LINEAR band power: Σ power[k]·w[k] with w[k] the fraction of bin k inside the band. Writes
 * into `out` (pass a reused Float64Array for allocation-free per-frame use); power is read only.
 */
export function integrateBands(power, binHz, bands, out = new Float64Array(bands.length)) {
  checkBinHz(binHz);
  const n = power.length;
  for (let i = 0; i < bands.length; i++) {
    const lo = bands[i].lo / binHz + 0.5; // band edges in "bin-cell" units: cell k = [k, k + 1)
    const hi = bands[i].hi / binHz + 0.5;
    const k0 = Math.max(0, Math.floor(lo));
    const k1 = Math.min(n - 1, Math.ceil(hi) - 1);
    let sum = 0;
    for (let k = k0; k <= k1; k++) {
      const w = Math.min(hi, k + 1) - Math.max(lo, k);
      if (w > 0) sum += power[k] * w;
    }
    out[i] = sum;
  }
  return out;
}

/** 10·log10(p) element-wise into out; zero power is −Infinity. */
export function powerToDb(power, out = new Float64Array(power.length)) {
  for (let i = 0; i < power.length; i++) {
    out[i] = power[i] > 0 ? 10 * Math.log10(power[i]) : -Infinity;
  }
  return out;
}

/**
 * bandPowers(power, binHz, bands) → Float64Array of band levels in dB (relative, ESTIMATED).
 * The contract signature of docs/v3/architecture.md; bandAnalysis() adds the bin counts.
 */
export function bandPowers(power, binHz, bands) {
  const p = integrateBands(power, binHz, bands);
  return powerToDb(p, p);
}

/**
 * bandAnalysis(power, binHz, bands) → { levelsDb: Float64Array, power: Float64Array,
 *   binCounts: Float64Array, underResolved: boolean[] }
 */
export function bandAnalysis(power, binHz, bands) {
  const p = integrateBands(power, binHz, bands);
  const { binCounts, underResolved } = bandBinCounts(binHz, bands, power.length);
  return { levelsDb: powerToDb(p), power: p, binCounts, underResolved };
}

/**
 * createRtaAverager({ mode = 'fast', peakHold = false, size }) → averager
 *
 * push(power, dtSeconds) → { levelsDb, peakDb }   (the SAME object and arrays on every call)
 *   power      linear band (or bin) powers, length fixed by `size` or by the first push
 *   dtSeconds  time since the previous frame (α = 1 − e^(−Δt/τ)); ignored in 'instant'
 *   levelsDb   averaged level in dB (10·log10 of the averaged power)
 *   peakDb     running maximum of levelsDb per band when peakHold, else null
 * The first frame after construction or reset() seeds the average with its own power (no ramp
 * up from silence). freeze() keeps the returned values unchanged while frames are still pushed
 * (they are discarded); unfreeze() resumes from the frozen state. reset() clears the average and
 * the peaks. Buffers are allocated once (at construction when size is given, else on the first
 * push); a push of a different length is an error.
 */
export function createRtaAverager({ mode = 'fast', peakHold = false, size } = {}) {
  if (!Object.hasOwn(RTA_MODES, mode))
    throw new TypeError(`averaging mode must be instant, fast or slow, got ${mode}`);
  const tau = RTA_MODES[mode];
  let avg = null;
  let seeded = false;
  let frozen = false;
  let frames = 0;
  const result = { levelsDb: null, peakDb: null };

  function allocate(n) {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`averager size must be ≥ 1, got ${n}`);
    avg = new Float64Array(n);
    result.levelsDb = new Float64Array(n).fill(-Infinity);
    result.peakDb = peakHold ? new Float64Array(n).fill(-Infinity) : null;
  }
  if (size != null) allocate(size);

  function push(power, dtSeconds) {
    if (!power || typeof power.length !== 'number') throw new TypeError('power must be an array');
    if (avg === null) allocate(power.length);
    if (power.length !== avg.length)
      throw new RangeError(`power has ${power.length} values, averager expects ${avg.length}`);
    if (frozen) return result;
    if (tau !== null && !(dtSeconds >= 0 && Number.isFinite(dtSeconds)))
      throw new RangeError(`dtSeconds must be finite and ≥ 0, got ${dtSeconds}`);
    const alpha = tau === null || !seeded ? 1 : 1 - Math.exp(-dtSeconds / tau);
    const levels = result.levelsDb;
    const peaks = result.peakDb;
    for (let i = 0; i < avg.length; i++) {
      const p = power[i];
      if (!(p >= 0)) throw new RangeError(`power[${i}] must be ≥ 0, got ${p}`);
      avg[i] += alpha * (p - avg[i]);
      const db = avg[i] > 0 ? 10 * Math.log10(avg[i]) : -Infinity;
      levels[i] = db;
      if (peaks && db > peaks[i]) peaks[i] = db;
    }
    seeded = true;
    frames++;
    return result;
  }

  function reset() {
    seeded = false;
    frames = 0;
    if (avg === null) return;
    avg.fill(0);
    result.levelsDb.fill(-Infinity);
    if (result.peakDb) result.peakDb.fill(-Infinity);
  }

  return {
    mode,
    tau,
    peakHold: Boolean(peakHold),
    push,
    reset,
    freeze() {
      frozen = true;
    },
    unfreeze() {
      frozen = false;
    },
    get frozen() {
      return frozen;
    },
    get frames() {
      return frames;
    },
  };
}
