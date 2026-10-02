// Measurement stimuli as plain sample arrays, deterministic for a normalized spec (and a seed
// for the noises). Levels are digital peak values in (0, 1], never sound pressure: what the
// speaker produces is unknown until a level calibration exists.
//
// Kinds:
//   sine        A·sin(2πft).
//   log-sweep   exponential sine sweep (Farina, "Simultaneous measurement of impulse response
//               and distortion with a swept-sine technique", AES 108th Convention, 2000):
//               x(t) = A·sin(2π·f1·L·(e^{t/L} − 1)), L = T / ln(f2/f1), instantaneous frequency
//               f1·e^{t/L}, so equal time per octave and a −3 dB/octave (pink) power spectrum.
//   white       uniform PRNG samples (V2 mulberry32 + fillWhite): flat expected spectrum.
//   pink        V2 fillPink (Kellet's seven-section filter over the uniform white noise). Its
//               published accuracy is ±0.05 dB of −3 dB/octave above ~10 Hz at 44.1 kHz; the
//               coefficients are fixed, so at another rate the pole frequencies scale by
//               sampleRate / 44100 (at 96 kHz the pink range starts near 22 Hz). The DC of the
//               realization is removed; the expected spectrum, not one realization, is pink.
//   band-noise  frequency-domain synthesis: random phase, flat ('white') or 1/√f ('pink')
//               magnitude between f1 and f2, zero outside, raised-cosine taper over the band's
//               outer BAND_EDGE_TAPER_OCT octave on each edge (a brick-wall edge rings for
//               ~1/Δf), inverse FFT of size nextPow2(N), first N samples kept.
//   chirp       short sweep, law 'log' (same formula as log-sweep) or 'linear'
//               x(t) = A·sin(2π(f1·t + (f2 − f1)·t² / 2T)).
//
// Every kind gets a raised-cosine fade in and out of `fade` seconds (0.5 − 0.5·cos), so the
// first and last samples are exactly 0. Deterministic kinds have amplitude `level`; the noises
// are scaled so their sample peak equals `level`.
//
// Frequencies above SAFE_NYQUIST_FRACTION × Nyquist are clamped to it (project rule
// audio-engine-discipline) and the clamp is reported as `clampedTo`; other out-of-range values
// throw a StimulusError with a machine-readable code instead of being silently changed.
//
// inverseSweep(spec) is the Farina inverse filter built from the SAME normalized spec (spec
// §206): the rendered sweep reversed in time and weighted by e^{−t/L} (+6 dB/octave across
// the reversed sweep, compensating its −3 dB/octave power), scaled so that sweep ⊛ inverse
// has unit magnitude across the band, i.e. exactly 1 (0 dB) at the band centre √(f1·f2). The
// scale comes from the stationary-phase spectrum |X(f)| ≈ sr·(A/2)·√(L/f) of the sweep.

import { mulberry32, fillWhite, fillPink } from '../audio/noise.js';
import { createFft } from '../analysis/fft.js';
import { nextPow2 } from './spectrum.js';

export const STIMULUS_KINDS = Object.freeze([
  'sine',
  'log-sweep',
  'white',
  'pink',
  'band-noise',
  'chirp',
]);

/** Highest frequency generated, as a fraction of Nyquist (project audio-engine-discipline). */
export const SAFE_NYQUIST_FRACTION = 0.95;
/** Lowest requested frequency; below it a log sweep's L and phase grow without bound. */
export const MIN_FREQUENCY_HZ = 1;
/** Sample rates accepted: the range common audio interfaces and browsers run at. */
export const SAMPLE_RATE_LIMITS = Object.freeze([8000, 384000]);
/**
 * Duration bounds in seconds. Sweep 1-30 s is the contract limit (spec §174); 30 s keeps every
 * kind inside the 40 s capture limit with room for pre- and post-roll. A chirp is a short
 * probe (5 ms - 1 s).
 */
export const DURATION_LIMITS = Object.freeze({
  sine: Object.freeze([0.05, 30]),
  'log-sweep': Object.freeze([1, 30]),
  white: Object.freeze([0.05, 30]),
  pink: Object.freeze([0.05, 30]),
  'band-noise': Object.freeze([0.05, 30]),
  chirp: Object.freeze([0.005, 1]),
});
/** Raised-cosine edge width of band-noise, octaves (capped at a quarter of the band). */
export const BAND_EDGE_TAPER_OCT = 1 / 12;

const DEFAULTS = Object.freeze({
  sine: { duration: 1, fade: 0.02, f: 1000 },
  'log-sweep': { duration: 5, fade: 0.01, f1: 20, f2: 20000 },
  white: { duration: 5, fade: 0.02 },
  pink: { duration: 5, fade: 0.02 },
  'band-noise': { duration: 5, fade: 0.02, f1: 20, f2: 20000, color: 'white' },
  chirp: { duration: 0.05, fade: null, f1: 20, f2: 20000, law: 'log' },
});
const DEFAULT_LEVEL = 0.5;
const DEFAULT_SEED = 1;

/** Validation failure of a stimulus spec; `code` is machine-readable. */
export class StimulusError extends RangeError {
  constructor(code, message) {
    super(message);
    this.name = 'StimulusError';
    this.code = code;
  }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function requireNumber(value, code, what) {
  if (!finite(value)) throw new StimulusError(code, `${what} must be a finite number`);
  return value;
}

/**
 * normalizeStimulus(spec) → { spec, clampedTo }
 * spec: frozen { kind, sampleRate, duration, level, f, f1, f2, fade, seed, color, law } with
 * every field present (null where the kind does not use it). Idempotent: normalizing a
 * normalized spec returns an equal spec (and clampedTo null). clampedTo is the frequency in Hz
 * a requested value was lowered to, or null.
 */
export function normalizeStimulus(input) {
  if (!input || typeof input !== 'object') throw new StimulusError('BAD_SPEC', 'No spec');
  const kind = input.kind;
  if (!STIMULUS_KINDS.includes(kind))
    throw new StimulusError('UNKNOWN_KIND', `Unknown stimulus kind "${kind}"`);
  const d = DEFAULTS[kind];

  const sampleRate = requireNumber(input.sampleRate, 'BAD_SAMPLE_RATE', 'sampleRate');
  if (sampleRate < SAMPLE_RATE_LIMITS[0] || sampleRate > SAMPLE_RATE_LIMITS[1])
    throw new StimulusError('BAD_SAMPLE_RATE', `sampleRate ${sampleRate} outside limits`);

  const duration = requireNumber(input.duration ?? d.duration, 'BAD_DURATION', 'duration');
  const [dMin, dMax] = DURATION_LIMITS[kind];
  if (duration < dMin || duration > dMax)
    throw new StimulusError('BAD_DURATION', `${kind} duration must be ${dMin}-${dMax} s`);

  const level = requireNumber(input.level ?? DEFAULT_LEVEL, 'BAD_LEVEL', 'level');
  if (!(level > 0 && level <= 1))
    throw new StimulusError('BAD_LEVEL', 'level is a digital peak in (0, 1]');

  const fadeDefault = d.fade == null ? duration / 10 : Math.min(d.fade, duration / 4);
  const fade = requireNumber(input.fade ?? fadeDefault, 'BAD_FADE', 'fade');
  if (fade < 0 || fade > duration / 4)
    throw new StimulusError('BAD_FADE', 'fade must be between 0 and a quarter of the duration');

  const seedIn = input.seed ?? DEFAULT_SEED;
  if (!finite(seedIn)) throw new StimulusError('BAD_SEED', 'seed must be a finite number');
  const seed = Math.round(seedIn) >>> 0;

  const safeMax = (sampleRate / 2) * SAFE_NYQUIST_FRACTION;
  let clampedTo = null;
  const clampHz = (v, what) => {
    requireNumber(v, 'BAD_FREQUENCY', what);
    if (v < MIN_FREQUENCY_HZ)
      throw new StimulusError('BAD_FREQUENCY', `${what} must be ≥ ${MIN_FREQUENCY_HZ} Hz`);
    if (v > safeMax) {
      clampedTo = safeMax;
      return safeMax;
    }
    return v;
  };

  let f = null;
  let f1 = null;
  let f2 = null;
  if (kind === 'sine') f = clampHz(input.f ?? d.f, 'f');
  if (kind === 'log-sweep' || kind === 'band-noise' || kind === 'chirp') {
    f1 = clampHz(input.f1 ?? d.f1, 'f1');
    f2 = clampHz(input.f2 ?? d.f2, 'f2');
    if (!(f1 < f2))
      throw new StimulusError('BAD_FREQUENCY', `f1 (${f1} Hz) must be below f2 (${f2} Hz)`);
  }

  let color = null;
  if (kind === 'band-noise') {
    color = input.color ?? d.color;
    if (color !== 'white' && color !== 'pink')
      throw new StimulusError('BAD_OPTION', 'band-noise color is "white" or "pink"');
  }
  let law = null;
  if (kind === 'chirp') {
    law = input.law ?? d.law;
    if (law !== 'log' && law !== 'linear')
      throw new StimulusError('BAD_OPTION', 'chirp law is "log" or "linear"');
  }
  const usesSeed = kind === 'white' || kind === 'pink' || kind === 'band-noise';

  const spec = Object.freeze({
    kind,
    sampleRate,
    duration,
    level,
    f,
    f1,
    f2,
    fade,
    seed: usesSeed ? seed : null,
    color,
    law,
  });
  return Object.freeze({ spec, clampedTo });
}

/** Sweep constant L = T / ln(f2/f1) in seconds of a normalized log-sweep (or log chirp). */
export function sweepConstant(spec) {
  return spec.duration / Math.log(spec.f2 / spec.f1);
}

/** Instantaneous frequency in Hz at time t (s) of a normalized sweep or chirp. */
export function instantaneousFrequency(spec, t) {
  if (spec.kind === 'sine') return spec.f;
  if (spec.kind === 'chirp' && spec.law === 'linear')
    return spec.f1 + ((spec.f2 - spec.f1) * t) / spec.duration;
  if (spec.kind === 'log-sweep' || spec.kind === 'chirp')
    return spec.f1 * Math.exp(t / sweepConstant(spec));
  return null;
}

function sampleCount(spec) {
  return Math.max(2, Math.round(spec.duration * spec.sampleRate));
}

/** Raised-cosine fade of `fadeSamples` at both ends, in place (first and last sample → 0). */
function applyFades(x, fadeSamples) {
  const n = x.length;
  const F = Math.min(fadeSamples, Math.floor(n / 2));
  if (F < 1) return x;
  for (let i = 0; i < F; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / F);
    x[i] *= g;
    x[n - 1 - i] *= g;
  }
  return x;
}

function scalePeak(x, level) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 0) for (let i = 0; i < x.length; i++) x[i] *= level / peak;
  return x;
}

function renderTone(spec, n) {
  const out = new Float64Array(n);
  const sr = spec.sampleRate;
  const A = spec.level;
  const TWO_PI = 2 * Math.PI;
  if (spec.kind === 'sine') {
    for (let i = 0; i < n; i++) out[i] = A * Math.sin((TWO_PI * spec.f * i) / sr);
  } else if (spec.kind === 'chirp' && spec.law === 'linear') {
    const k = (spec.f2 - spec.f1) / (2 * spec.duration);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = A * Math.sin(TWO_PI * (spec.f1 * t + k * t * t));
    }
  } else {
    const L = sweepConstant(spec);
    const k = TWO_PI * spec.f1 * L;
    for (let i = 0; i < n; i++) out[i] = A * Math.sin(k * Math.expm1(i / sr / L));
  }
  return out;
}

function renderBandNoise(spec, n) {
  const size = nextPow2(n);
  const sr = spec.sampleRate;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const rng = mulberry32(spec.seed);
  const bandOct = Math.log2(spec.f2 / spec.f1);
  const taper = Math.min(BAND_EDGE_TAPER_OCT, bandOct / 4);
  let used = 0;
  for (let k = 1; k < size / 2; k++) {
    const fk = (k * sr) / size;
    if (fk < spec.f1 || fk > spec.f2) continue;
    const u = Math.min(Math.log2(fk / spec.f1), Math.log2(spec.f2 / fk));
    const g = u < taper ? 0.5 - 0.5 * Math.cos((Math.PI * u) / taper) : 1;
    const mag = spec.color === 'pink' ? g / Math.sqrt(fk) : g;
    const phase = 2 * Math.PI * rng();
    // Conjugated spectrum: forward FFT of conj(X) is conj(size · IFFT(X)), real for Hermitian X.
    re[k] = mag * Math.cos(phase);
    im[k] = -mag * Math.sin(phase);
    re[size - k] = re[k];
    im[size - k] = -im[k];
    used++;
  }
  if (used === 0)
    throw new StimulusError('BAD_FREQUENCY', 'band-noise band contains no frequency bin');
  createFft(size).forward(re, im);
  return re.subarray(0, n);
}

function renderNoise(spec, n) {
  const rng = mulberry32(spec.seed);
  const tmp = new Float32Array(n);
  if (spec.kind === 'white') fillWhite(tmp, rng);
  else fillPink(tmp, rng);
  const out = Float64Array.from(tmp);
  if (spec.kind === 'pink') {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += out[i];
    mean /= n;
    for (let i = 0; i < n; i++) out[i] -= mean;
  }
  return out;
}

/**
 * renderStimulus(spec) → { spec, samples: Float32Array, clampedTo }
 * spec is normalized first (see normalizeStimulus); samples has round(duration · sampleRate)
 * samples.
 */
export function renderStimulus(input) {
  const { spec, clampedTo } = normalizeStimulus(input);
  const n = sampleCount(spec);
  let x;
  if (spec.kind === 'white' || spec.kind === 'pink') x = renderNoise(spec, n);
  else if (spec.kind === 'band-noise') x = renderBandNoise(spec, n);
  else x = renderTone(spec, n);
  applyFades(x, Math.round(spec.fade * spec.sampleRate));
  if (spec.kind === 'white' || spec.kind === 'pink' || spec.kind === 'band-noise')
    scalePeak(x, spec.level);
  return Object.freeze({ spec, samples: Float32Array.from(x), clampedTo });
}

/**
 * inverseSweep(spec) → Float32Array (same length as the sweep)
 * Farina inverse filter of the log-sweep described by spec (normalized here, so the raw and
 * the normalized spec give the same filter). Linear convolution sweep ⊛ inverse peaks at
 * index N − 1 and has unit gain over [f1, f2].
 */
export function inverseSweep(input) {
  const { spec } = normalizeStimulus(input);
  if (spec.kind !== 'log-sweep')
    throw new StimulusError('BAD_OPTION', 'inverseSweep needs a log-sweep spec');
  const sweep = renderStimulus(spec).samples;
  const n = sweep.length;
  const sr = spec.sampleRate;
  const L = sweepConstant(spec);
  const A = spec.level;
  // Envelope at inverse time t = i/sr is e^{−t/L}; the frequency there is f1·e^{(N−1−i)/(sr·L)},
  // so the envelope equals (f/f1)·e^{−(N−1)/(sr·L)} and |X(f)·Inv(f)| = C·sr²A²L/(4f1)·that
  // constant for every f. C makes it 1.
  const C = (4 * spec.f1 * Math.exp((n - 1) / (sr * L))) / (sr * sr * A * A * L);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sweep[n - 1 - i] * Math.exp(-i / (sr * L)) * C;
  return out;
}
