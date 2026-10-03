// V3 transfer function, impulse response and smoothing on synthetic known systems (spec §138,
// §139, §203, §204). Every expected value is derived mathematically in this file: the systems
// are a gain, a pure delay, RBJ-cookbook biquads (R. Bristow-Johnson, "Cookbook formulae for
// audio EQ biquad filter coefficients") whose analytic |H(e^jω)| is evaluated from the same
// coefficients, and sums of delayed copies. Noise is seeded, so every run is identical.
//
// The stimulus is generated here (Farina 2000 exponential sweep) instead of importing
// stimulus.js, so these tests check the deconvolution alone; any Float32Array stimulus works.
//
// Sweeps are 1 s to keep `npm test` fast; one realistic 10 s / 48 kHz case is marked below.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTransfer,
  spectralDeconvolution,
  logGrid,
  REGULARIZATION,
  PHASE_MIN_CORRELATION,
  PHASE_REASONS,
} from '../../src/js/measurement/transfer.js';
import { align } from '../../src/js/measurement/align.js';
import { renderStimulus as renderSweep } from '../../src/js/measurement/stimulus.js';
import {
  computeImpulseResponse,
  irWindow,
  normalizeIr,
} from '../../src/js/measurement/impulse-response.js';
import { smoothFractionalOctave, normalizeResponse } from '../../src/js/measurement/smoothing.js';

const RATES = [44100, 48000, 96000];
const F1 = 20;
const F2 = 20000;
const PRE = 0.5;
const POST = 1.5;

// ----------------------------------------------------------------------------- signals

/** Farina sweep x(t) = sin(2π f1 L (e^(t/L) − 1)), L = T / ln(f2/f1), raised-cosine fades. */
function expSweep(f1, f2, T, sr, fade = 0.005) {
  const n = Math.round(T * sr);
  const L = T / Math.log(f2 / f1);
  const nf = Math.round(fade * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = 1;
    if (i < nf) g = 0.5 - 0.5 * Math.cos((Math.PI * i) / nf);
    else if (i >= n - nf) g = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / nf);
    x[i] = g * Math.sin(2 * Math.PI * f1 * L * (Math.exp(t / L) - 1));
  }
  return x;
}

/** Farina inverse filter: time-reversed sweep with envelope e^(−t/L) (+6 dB/octave). */
function farinaInverse(x, f1, f2, sr) {
  const n = x.length;
  const L = n / sr / Math.log(f2 / f1);
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = x[n - 1 - i] * Math.exp(-i / sr / L);
  return inv;
}

/** Stimulus placed at `offset` seconds in a zero buffer of pre + stimulus + post seconds. */
function placed(x, sr, offset, pre = PRE, post = POST) {
  const len = Math.round(pre * sr) + x.length + Math.round(post * sr);
  const z = new Float64Array(len);
  const o = Math.round(offset * sr);
  for (let i = 0; i < x.length && o + i < len; i++) z[o + i] = x[i];
  return z;
}

function toF32(z) {
  return Float32Array.from(z);
}

/** Seeded uniform PRNG (mulberry32) and Box-Muller Gaussian. */
function gaussian(seed) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uni())) * Math.cos(2 * Math.PI * uni());
}

function whiteNoise(n, sigma, seed) {
  const g = gaussian(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = sigma * g();
  return out;
}

// RBJ cookbook biquads, normalized by a0.
function rbj(type, f0, q, sr, gainDb = 0) {
  const w0 = (2 * Math.PI * f0) / sr;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b;
  let a;
  if (type === 'lowpass') {
    b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    a = [1 + alpha, -2 * c, 1 - alpha];
  } else if (type === 'highpass') {
    b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    a = [1 + alpha, -2 * c, 1 - alpha];
  } else if (type === 'peaking') {
    const A = 10 ** (gainDb / 40);
    b = [1 + alpha * A, -2 * c, 1 - alpha * A];
    a = [1 + alpha / A, -2 * c, 1 - alpha / A];
  } else throw new Error(type);
  return { b: b.map((v) => v / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] };
}

function biquadFilter({ b, a }, x) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Complex H(e^jω) of a biquad at f Hz: [re, im]. */
function biquadResponse({ b, a }, f, sr) {
  const w = (2 * Math.PI * f) / sr;
  const ev = (c) => [c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w),
    -c[1] * Math.sin(w) - c[2] * Math.sin(2 * w)];
  const [nr, ni] = ev(b);
  const [dr, di] = ev(a);
  const d = dr * dr + di * di;
  return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
}

const biquadDb = (coef, f, sr) => {
  const [r, i] = biquadResponse(coef, f, sr);
  return 10 * Math.log10(r * r + i * i);
};

/** Largest |measured − expected| (dB) over grid points in [lo, hi]. */
function maxErrDb(result, expectedDb, lo = 50, hi = 15000) {
  let worst = 0;
  let at = 0;
  let count = 0;
  result.frequencies.forEach((f, i) => {
    if (f < lo || f > hi) return;
    count++;
    const e = Math.abs(result.magnitudeDb[i] - expectedDb(f));
    if (e > worst) {
      worst = e;
      at = f;
    }
  });
  assert.ok(count > 100, `only ${count} grid points in ${lo}-${hi} Hz`);
  return { worst, at };
}

function measure(sr, system, { delay = 0, T = 1, noise = null, ...rest } = {}) {
  const x = expSweep(F1, F2, T, sr);
  const y = system(placed(x, sr, PRE + delay));
  if (noise) for (let i = 0; i < y.length; i++) y[i] += noise[i];
  return { x, y: toF32(y), r: computeTransfer({ stimulus: x, captured: toF32(y), sampleRate: sr,
    f1: F1, f2: F2, ...rest }) };
}

// ----------------------------------------------------------------------- transfer: gains
// Noise-free and linear, so the only error sources are the regularization bias and float32
// rounding of x and y (≈ −144 dB). ε_in is −60 dB re max|X|²; |X|² of a 20 Hz-20 kHz sweep
// falls ~30 dB across the band (≈ 31 dB below max|X|² at 15 kHz, the maximum carrying the
// Fresnel overshoot of the sweep start), so the bias is 10·log10(1 + 10^-2.9) ≈ 0.006 dB there
// and smaller below. ±0.1 dB holds with a wide margin; 50 Hz-15 kHz keeps clear of the
// Fresnel ripple at the sweep's ends.

for (const sr of RATES) {
  for (const gainDb of [0, -6]) {
    test(`transfer: flat ${gainDb} dB at ${sr} Hz within ±0.1 dB, 50 Hz-15 kHz`, (t) => {
      const g = 10 ** (gainDb / 20);
      const { r } = measure(sr, (z) => z.map((v) => v * g));
      const { worst, at } = maxErrDb(r, () => gainDb);
      t.diagnostic(`max error ${worst.toExponential(2)} dB at ${at.toFixed(1)} Hz`);
      assert.ok(worst <= 0.1, `${worst.toFixed(4)} dB at ${at.toFixed(1)} Hz`);
      assert.equal(r.algorithm, 'oscilla.transfer.v3');
      assert.deepEqual(r.requestedRange, [F1, F2]);
      assert.equal(r.phaseDeg, null);
      assert.equal(r.snrDb, null);
    });
  }
}

test('transfer: −6 dB with a 0.3 s pure delay inside 0.5 s pre-roll / 1.5 s post-roll', () => {
  const sr = 48000;
  const g = 10 ** (-6 / 20);
  const { x, r } = measure(sr, (z) => z.map((v) => v * g), { delay: 0.3 });
  const { worst } = maxErrDb(r, () => -6);
  assert.ok(worst <= 0.1, `${worst} dB`);
  assert.ok(r.fftSize >= x.length + Math.round((PRE + POST) * sr) + x.length);
  assert.equal(r.fftSize & (r.fftSize - 1), 0);
  assert.equal(r.binHz, sr / r.fftSize);
});

// ------------------------------------------------------------------ transfer: filters
// The grid value is the power mean of |H|² over a 1/48-octave band. For a slope of s dB/octave
// that mean exceeds the centre value by ≈ (s·ln10/10)²·w²/24 in power, w = 1/48 octave: for
// s = 12 dB/octave, 6·10^-4 dB, negligible. Inside the swept band the estimate is otherwise
// exact (noise-free LTI), so ±0.5 dB is a generous bound; 50 Hz-15 kHz excludes the band edges,
// where the sweep's spectrum carries the Fresnel ripple of its finite start and end.

const FILTERS = [
  ['2nd-order low-pass 1 kHz (Q 0.7071)', (sr) => rbj('lowpass', 1000, Math.SQRT1_2, sr)],
  ['2nd-order high-pass 1 kHz (Q 0.7071)', (sr) => rbj('highpass', 1000, Math.SQRT1_2, sr)],
  ['peaking EQ +6 dB at 1 kHz (Q 2)', (sr) => rbj('peaking', 1000, 2, sr, 6)],
  ['peaking EQ −9 dB at 4 kHz (Q 1)', (sr) => rbj('peaking', 4000, 1, sr, -9)],
];

for (const sr of RATES) {
  for (const [name, make] of FILTERS) {
    test(`transfer: ${name} at ${sr} Hz matches analytic |H| within ±0.5 dB`, (t) => {
      const coef = make(sr);
      const { r } = measure(sr, (z) => biquadFilter(coef, z));
      const { worst, at } = maxErrDb(r, (f) => biquadDb(coef, f, sr));
      t.diagnostic(`max error ${worst.toExponential(2)} dB at ${at.toFixed(1)} Hz`);
      assert.ok(worst <= 0.5, `${worst.toFixed(4)} dB at ${at.toFixed(1)} Hz`);
    });
  }
}

// ----------------------------------------------------------------------- transfer: phase

test('transfer: phase only on request with a robust alignment; then matches analytic arg H',
  () => {
    const sr = 48000;
    const coef = rbj('lowpass', 1000, Math.SQRT1_2, sr);
    const delay = 0.3;
    const lag = Math.round((PRE + delay) * sr);
    const { x, y } = measure(sr, (z) => biquadFilter(coef, z), { delay });
    const alignment = align(x, y, sr);
    assert.ok(alignment.peakCorrelation >= PHASE_MIN_CORRELATION, `${alignment.peakCorrelation}`);
    const base = { stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 };
    const noAlign = computeTransfer({ ...base, options: { phase: true } });
    assert.equal(noAlign.phaseDeg, null, 'no alignment supplied: phase must not be faked');
    assert.equal(noAlign.phaseReason, PHASE_REASONS.NO_ALIGNMENT);
    assert.equal(noAlign.alignment, null);
    // A bare lag is not evidence of a robust alignment (spec §27); the old call form still
    // works and says why there is no phase.
    const bareLag = computeTransfer({ ...base, lagSamples: lag, options: { phase: true } });
    assert.equal(bareLag.phaseDeg, null);
    assert.equal(bareLag.phaseReason, PHASE_REASONS.NO_ALIGNMENT);
    const notAsked = computeTransfer({ ...base, alignment, lagSamples: lag });
    assert.equal(notAsked.phaseDeg, null);
    assert.equal(notAsked.phaseReason, PHASE_REASONS.NOT_REQUESTED);
    assert.equal(notAsked.alignment.peakCorrelation, alignment.peakCorrelation);
    const weak = computeTransfer({ ...base, options: { phase: true },
      alignment: { ...alignment, peakCorrelation: PHASE_MIN_CORRELATION - 1e-9 } });
    assert.equal(weak.phaseDeg, null);
    assert.equal(weak.phaseReason, PHASE_REASONS.ALIGNMENT_NOT_ROBUST);
    const lost = computeTransfer({ ...base, options: { phase: true },
      alignment: { ...alignment, lagSamples: null } });
    assert.equal(lost.phaseReason, PHASE_REASONS.ALIGNMENT_NOT_ROBUST);
    // Explicit lagSamples overrides alignment.lagSamples (here: the exact delay, so the
    // expected phase is arg H of the filter alone).
    const r = computeTransfer({ ...base, alignment, lagSamples: lag, options: { phase: true } });
    assert.ok(r.phaseDeg instanceof Float64Array);
    assert.equal(r.phaseReason, null);
    assert.deepEqual(r.alignment, { algorithm: 'oscilla.align.xcorr.v2',
      lagSamples: alignment.lagSamples, peakCorrelation: alignment.peakCorrelation,
      polarity: 1 });
    let worst = 0;
    r.frequencies.forEach((f, i) => {
      if (f < 50 || f > 10000) return;
      const [re, im] = biquadResponse(coef, f, sr);
      const expected = (Math.atan2(im, re) * 180) / Math.PI;
      const d = Math.abs(((r.phaseDeg[i] - expected + 540) % 360) - 180);
      worst = Math.max(worst, d);
    });
    // The phase within a 1/48-octave band varies by < 1° for this filter; complex averaging
    // returns the band's mean angle.
    assert.ok(worst < 2, `phase error ${worst.toFixed(3)}°`);
  });

// ----------------------------------------------------------------------- transfer: noise

const sweepRms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test('transfer: −6 dB, white noise at 30 dB broadband SNR: ±0.3 dB; SNR estimate', (t) => {
  // Per-bin SNR of an exponential sweep (amplitude A, rate L = T/ln(f2/f1)) against white noise
  // σ² over a capture of Nc samples: |X[k]|² ≈ fs²·A²·L/(4f) (stationary phase), E|N[k]|² =
  // Nc·σ², so SNR(f) = fs²·A²·L·g²/(4·f·Nc·σ²). Here it is ≥ 13 dB at 15 kHz. The band mean of
  // |H0 + e|² then deviates from |H0|² by the bias 1/SNR (≤ 0.2 dB) plus a cross term whose
  // standard deviation over the ≥ 300 independent bins of a 1/48-octave band above 1 kHz (band
  // width × capture duration) is ≤ 0.03 dB; below 1 kHz the SNR is higher still. ±0.3 dB is
  // therefore ≥ 4σ beyond the bias; ±0.1 dB would not be justified.
  const sr = 48000;
  const T = 1;
  const x = expSweep(F1, F2, T, sr);
  const g = 10 ** (-6 / 20);
  const sigma = sweepRms(x) * g * 10 ** (-30 / 20);
  const clean = placed(x, sr, PRE).map((v) => v * g);
  const n = whiteNoise(clean.length, sigma, 1234);
  const y = toF32(clean.map((v, i) => v + n[i]));
  const noise = toF32(whiteNoise(Math.round(2 * sr), sigma, 99));
  const r = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2, noise });
  const { worst, at } = maxErrDb(r, () => -6);
  t.diagnostic(`max error ${worst.toFixed(4)} dB at ${at.toFixed(1)} Hz`);
  assert.ok(worst <= 0.3, `${worst.toFixed(4)} dB at ${at.toFixed(1)} Hz`);
  const L = T / Math.log(F2 / F1);
  const predicted = (f) => 10 * Math.log10((sr * sr * L * g * g) / (4 * f * y.length * sigma ** 2));
  for (const fc of [1000, 3000, 10000]) {
    // Median over 1/3 octave (16 grid points) of the estimate vs the prediction.
    const errs = [];
    r.frequencies.forEach((f, i) => {
      if (f >= fc / 2 ** (1 / 6) && f <= fc * 2 ** (1 / 6)) errs.push(r.snrDb[i] - predicted(f));
    });
    errs.sort((p, q) => p - q);
    const med = errs[errs.length >> 1];
    t.diagnostic(`SNR median error at ${fc} Hz: ${med.toFixed(2)} dB`);
    assert.ok(Math.abs(med) < 1, `SNR at ${fc} Hz off by ${med.toFixed(2)} dB`);
  }
  assert.ok(r.validRange[0] <= 25 && r.validRange[1] >= 19000, `${r.validRange}`);
});

test('transfer: validRange stops where SNR falls below 10 dB (10 dB broadband SNR)', (t) => {
  const sr = 48000;
  const T = 1;
  const x = expSweep(F1, F2, T, sr);
  const sigma = sweepRms(x) * 10 ** (-10 / 20);
  const clean = placed(x, sr, PRE);
  const n = whiteNoise(clean.length, sigma, 7);
  const y = toF32(clean.map((v, i) => v + n[i]));
  const noise = toF32(whiteNoise(Math.round(2 * sr), sigma, 8));
  const r = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2, noise });
  // SNR(f) = 10 dB at fc = fs²·L / (4·Nc·σ²·10); the estimate falls 3 dB/octave through it.
  const L = T / Math.log(F2 / F1);
  const fc = (sr * sr * L) / (4 * y.length * sigma ** 2 * 10);
  t.diagnostic(`validRange ${r.validRange.map((v) => v.toFixed(0))}, predicted ${fc.toFixed(0)}`);
  assert.ok(r.validRange[1] > fc / Math.SQRT2 && r.validRange[1] < fc * Math.SQRT2,
    `validRange ${r.validRange}, predicted upper edge ${fc.toFixed(0)} Hz`);
  assert.ok(r.validRange[0] < 30);
});

// --------------------------------------------------------------- transfer: valid range

test('transfer: validRange is the part the stimulus covers; requestedRange kept', () => {
  const sr = 48000;
  const x = expSweep(100, 5000, 1, sr);
  const y = toF32(placed(x, sr, PRE));
  const r = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  assert.deepEqual(r.requestedRange, [F1, F2]);
  const [lo, hi] = r.validRange;
  assert.ok(lo > 100 / 2 ** (1 / 3) && lo < 100 * 2 ** (1 / 6), `lo ${lo}`);
  assert.ok(hi > 5000 / 2 ** (1 / 6) && hi < 5000 * 2 ** (1 / 3), `hi ${hi}`);
  // Out-of-band bins are regularized, not blown up: finite, and far below the passband.
  for (let i = 0; i < r.frequencies.length; i++) assert.ok(Number.isFinite(r.magnitudeDb[i]));
  const at15k = r.magnitudeDb[r.frequencies.findIndex((f) => f >= 15000)];
  assert.ok(at15k < -20, `15 kHz reads ${at15k} dB with no stimulus energy there`);
});

test('transfer: grid stops at Nyquist; requested range beyond it is kept, not truncated', () => {
  const sr = 44100;
  const x = expSweep(F1, 20000, 1, sr);
  const y = toF32(placed(x, sr, PRE));
  const r = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: 24000 });
  assert.deepEqual(r.requestedRange, [F1, 24000]);
  assert.ok(r.frequencies[r.frequencies.length - 1] <= sr / 2);
  assert.ok(r.validRange[1] <= sr / 2 && r.validRange[1] > 18000, `${r.validRange}`);
});

test('transfer: inputs are not mutated; regularization profile and grid are as documented', () => {
  const sr = 48000;
  const x = expSweep(F1, F2, 1, sr);
  const y = toF32(placed(x, sr, PRE));
  const n = toF32(whiteNoise(4800, 1e-3, 3));
  const copies = [x, y, n].map((a) => a.slice());
  computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2, noise: n,
    lagSamples: 24000, options: { phase: true } });
  computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  [x, y, n].forEach((a, i) => assert.deepEqual(a, copies[i]));

  assert.deepEqual({ ...REGULARIZATION }, { inBandDb: -60, outOfBandDb: 0,
    transitionOctaves: 1 / 3 });
  const d = spectralDeconvolution({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  const k1k = Math.round(1000 / d.binHz);
  const epsDb = (k) => 10 * Math.log10(d.eps[k] / d.xPowMax);
  assert.ok(Math.abs(epsDb(k1k) + 60) < 1e-9, 'in band: −60 dB');
  assert.ok(Math.abs(epsDb(0)) < 1e-9, 'DC: 0 dB');
  assert.ok(Math.abs(epsDb(Math.round(10 / d.binHz))) < 1e-9, '1 octave below f1: 0 dB');
  // 24 kHz is 0.26 octave above f2, inside the 1/3-octave raised-cosine transition.
  assert.ok(epsDb(d.half) > -60 && epsDb(d.half) < 0);

  const grid = logGrid(20, 20000, 48);
  assert.equal(grid.length, Math.floor(Math.log2(1000) * 48) + 1);
  assert.ok(Math.abs(grid[48] - 40) < 1e-9);
  assert.throws(() => computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: 0,
    f2: F2 }), RangeError);
  assert.throws(() => computeTransfer({ stimulus: [], captured: y, sampleRate: sr, f1: F1,
    f2: F2 }), TypeError);
});

// --------------------------------------------------------------------- impulse response

/** Largest |h| farther than `guardS` from the peak, in dB re |h_peak|. */
function sideLevelDb(ir, guardS = 0.001) {
  const g = Math.round(guardS * ir.sampleRate);
  const peak = Math.abs(ir.samples[ir.peakIndex]);
  let side = 0;
  for (let i = 0; i < ir.samples.length; i++) {
    if (Math.abs(i - ir.peakIndex) > g) side = Math.max(side, Math.abs(ir.samples[i]));
  }
  return 20 * Math.log10(side / peak);
}

for (const sr of RATES) {
  test(`ir: identity at ${sr} Hz → one peak at the pre-roll ± 1 sample, side ≤ −40 dB`, (t) => {
    const x = expSweep(F1, F2, 1, sr);
    const y = toF32(placed(x, sr, PRE));
    const ir = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
    const expected = Math.round(PRE * sr);
    assert.ok(Math.abs(ir.peakIndex - expected) <= 1, `peak ${ir.peakIndex} vs ${expected}`);
    assert.equal(ir.algorithm, 'oscilla.ir.log-sweep.v3');
    assert.equal(ir.window, null);
    assert.equal(ir.captureOffsetS, 0);
    assert.equal(ir.samples.length, y.length);
    assert.ok(Math.abs(ir.peakTimeS - PRE) <= 1 / sr);
    // Band-limited pulse: the peak is ≈ the passband share (f2 − f1)/(fs/2) of a unit sample.
    const share = (F2 - F1) / (sr / 2);
    assert.ok(Math.abs(ir.samples[ir.peakIndex] - share) < 0.02 * share,
      `peak ${ir.samples[ir.peakIndex]} vs ${share}`);
    const side = sideLevelDb(ir);
    t.diagnostic(`side level ${side.toFixed(1)} dB, tail floor ${ir.noiseFloorDb.toFixed(1)} dB`);
    assert.ok(side <= -40, `side level ${side.toFixed(1)} dB`);
    assert.ok(ir.noiseFloorDb < -60, `noise floor ${ir.noiseFloorDb}`);
  });
}

test('ir: delayed impulse (0.3 s) → peak at pre-roll + delay; lag keeps absolute offset', () => {
  const sr = 48000;
  const x = expSweep(F1, F2, 1, sr);
  const y = toF32(placed(x, sr, PRE + 0.3));
  const total = Math.round((PRE + 0.3) * sr);
  const ir = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  assert.ok(Math.abs(ir.peakIndex - total) <= 1);
  const lagSamples = Math.round(PRE * sr); // e.g. an alignment that found the pre-roll only
  const aligned = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1,
    f2: F2, lagSamples });
  // ir.v3 guard: max(5 ms, 5 periods of f1) (V382)
  const guard = Math.round(Math.max(0.005, 5 / F1) * sr);
  assert.equal(aligned.captureOffsetS, (lagSamples - guard) / sr);
  assert.ok(Math.abs(aligned.captureOffsetS + aligned.peakTimeS - total / sr) <= 1 / sr);
  assert.equal(aligned.samples.length, y.length - (lagSamples - guard));
});

for (const method of ['spectral', 'farina-inverse']) {
  test(`ir (${method}): echo 0.5 at 12 ms → two peaks, ratio −6.02 dB ± 0.5 dB`, (t) => {
    const sr = 48000;
    const x = expSweep(F1, F2, 1, sr);
    const z = placed(x, sr, PRE);
    const d = Math.round(0.012 * sr);
    const y = toF32(z.map((v, i) => v + (i >= d ? 0.5 * z[i - d] : 0)));
    const inverse = method === 'farina-inverse' ? farinaInverse(x, F1, F2, sr) : undefined;
    const ir = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2,
      method, inverse });
    assert.equal(ir.method, method);
    const direct = Math.round(PRE * sr);
    assert.ok(Math.abs(ir.peakIndex - direct) <= 1, `direct at ${ir.peakIndex}`);
    let second = -1;
    let best = 0;
    const from = ir.peakIndex + Math.round(0.006 * sr);
    const to = ir.peakIndex + Math.round(0.018 * sr);
    for (let i = from; i <= to; i++) {
      if (Math.abs(ir.samples[i]) > best) {
        best = Math.abs(ir.samples[i]);
        second = i;
      }
    }
    assert.ok(Math.abs(second - ir.peakIndex - d) <= 1, `echo at +${second - ir.peakIndex}`);
    const ratioDb = 20 * Math.log10(best / Math.abs(ir.samples[ir.peakIndex]));
    t.diagnostic(`echo ratio ${ratioDb.toFixed(4)} dB`);
    assert.ok(Math.abs(ratioDb - 20 * Math.log10(0.5)) <= 0.5, `ratio ${ratioDb.toFixed(3)} dB`);
  });
}

test('ir (farina-inverse): identity peak index and unity in-band scale agree with spectral', () => {
  const sr = 44100;
  const x = expSweep(F1, F2, 1, sr);
  const y = toF32(placed(x, sr, PRE));
  const base = { stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 };
  const a = computeImpulseResponse(base);
  const b = computeImpulseResponse({ ...base, method: 'farina-inverse',
    inverse: farinaInverse(x, F1, F2, sr) });
  assert.ok(Math.abs(a.peakIndex - b.peakIndex) <= 1);
  const ra = a.samples[a.peakIndex];
  const rb = b.samples[b.peakIndex];
  assert.ok(Math.abs(20 * Math.log10(rb / ra)) < 0.5, `${ra} vs ${rb}`);
  assert.throws(() => computeImpulseResponse({ ...base, method: 'farina-inverse' }), TypeError);
  assert.throws(() => computeImpulseResponse({ ...base, method: 'mls' }), RangeError);
});

test('ir: irWindow and normalizeIr return new objects and never touch the original', () => {
  const sr = 48000;
  const x = expSweep(F1, F2, 1, sr);
  const y = toF32(placed(x, sr, PRE).map((v) => v * 0.25));
  const ir = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  const before = ir.samples.slice();
  const snapshot = { ...ir };
  const w = irWindow(ir, ir.peakTimeS - 0.002, ir.peakTimeS + 0.3);
  assert.notEqual(w, ir);
  assert.deepEqual(w.window, [ir.peakTimeS - 0.002, ir.peakTimeS + 0.3]);
  assert.equal(ir.window, null);
  assert.equal(w.samples, ir.samples, 'the original stays the full-length array');
  assert.equal(w.view.endIndex - w.view.startIndex, w.view.samples.length);
  assert.equal(w.view.samples[ir.peakIndex - w.view.startIndex], ir.samples[ir.peakIndex]);
  w.view.samples.fill(0);
  const db = normalizeIr(ir, 'peak-db');
  const lin = normalizeIr(ir, 'peak-linear');
  assert.equal(db.values[ir.peakIndex], 0);
  assert.equal(Math.abs(lin.values[ir.peakIndex]), 1);
  assert.match(db.label, /NORMALIZED/);
  assert.match(lin.label, /NORMALIZED/);
  assert.ok(db.values.every((v) => v <= 0));
  assert.deepEqual(ir.samples, before);
  assert.deepEqual({ ...ir }, snapshot);
  assert.throws(() => normalizeIr(ir, 'rms'), RangeError);
  assert.throws(() => irWindow(ir, 0.1, 0.1), RangeError);
});

// --------------------------------------------------------------------------- smoothing

test('smoothing: flat response preserved exactly; ripple reduced; 0 returns a copy', () => {
  const f = logGrid(20, 20000, 48);
  const flat = new Float64Array(f.length).fill(-3.25);
  for (const frac of [24, 12, 6, 3]) {
    const s = smoothFractionalOctave(f, flat, frac);
    assert.ok(s.every((v) => v === -3.25), `1/${frac} octave changed a flat response`);
  }
  // ±3 dB ripple with a period of 1/6 octave: 1/3-octave smoothing spans two full periods.
  const ripple = f.map((hz) => 3 * Math.sin(2 * Math.PI * 6 * Math.log2(hz / 20)));
  const before = ripple.slice();
  const s3 = smoothFractionalOctave(f, ripple, 3);
  const inner = (a) => a.filter((_, i) => f[i] > 40 && f[i] < 10000);
  const span = (a) => Math.max(...inner(a)) - Math.min(...inner(a));
  assert.ok(span(s3) < 0.1 * span(ripple), `ripple ${span(ripple)} → ${span(s3)}`);
  // Power averaging of a symmetric dB ripple lands above 0 dB, never at the dB mean.
  assert.ok(inner(s3).every((v) => v > 0));
  assert.deepEqual(ripple, before);
  const copy = smoothFractionalOctave(f, ripple, 0);
  assert.notEqual(copy, ripple);
  assert.deepEqual(Array.from(copy), Array.from(ripple));
  assert.throws(() => smoothFractionalOctave(f, ripple, -1), RangeError);
});

test('normalization: at 1 kHz reads 0 dB at 1 kHz; band mean is a power mean; labelled', () => {
  const sr = 48000;
  const coef = rbj('peaking', 3000, 1, sr, 6);
  const { r } = measure(sr, (z) => biquadFilter(coef, z).map((v) => v * 0.5));
  const before = r.magnitudeDb.slice();
  const n = normalizeResponse(r.frequencies, r.magnitudeDb, { mode: 'at-frequency', hz: 1000 });
  const i1k = r.frequencies.findIndex((v) => Math.abs(v - 1000) < 1e-6);
  if (i1k >= 0) assert.ok(Math.abs(n.normalizedDb[i1k]) < 1e-12);
  // Interpolated read-back at exactly 1 kHz is 0 dB by construction.
  const back = normalizeResponse(r.frequencies, n.normalizedDb, { mode: 'at-frequency',
    hz: 1000 });
  assert.ok(Math.abs(back.referenceDb) < 1e-12);
  assert.ok(Math.abs(n.referenceDb - biquadDb(coef, 1000, sr) - 20 * Math.log10(0.5)) < 0.1);
  assert.match(n.label, /NORMALIZED.*1 kHz/);
  assert.deepEqual(r.magnitudeDb, before);
  const b = normalizeResponse([100, 200, 400], new Float64Array([0, -10, 200]),
    { mode: 'band-mean', lo: 100, hi: 200 });
  assert.ok(Math.abs(b.referenceDb - 10 * Math.log10((1 + 0.1) / 2)) < 1e-12);
  assert.match(b.label, /NORMALIZED/);
  assert.throws(() => normalizeResponse(r.frequencies, r.magnitudeDb, { mode: 'at-frequency',
    hz: 5 }), RangeError);
});

// --------------------------------------------------- realistic case (10 s sweep, 48 kHz)
// The one long case: a 20 Hz-20 kHz, 10 s sweep at 48 kHz, 0.5 s pre-roll, 1.5 s post-roll, a
// loudspeaker-like system (2nd-order high-pass 60 Hz, +4 dB peak at 2.5 kHz Q 1.5, 2nd-order
// low-pass 16 kHz), 2.9 ms propagation delay and white noise at 40 dB broadband SNR. FFT size
// 2^21. Per-bin SNR is ≥ 20 dB higher than in the 1 s / 30 dB case above, so ±0.3 dB holds
// with more margin than there.

test('realistic: 10 s 48 kHz sweep through a loudspeaker-like chain with noise', (t) => {
  const sr = 48000;
  const T = 10;
  const x = expSweep(F1, F2, T, sr);
  const hp = rbj('highpass', 60, Math.SQRT1_2, sr);
  const pk = rbj('peaking', 2500, 1.5, sr, 4);
  const lp = rbj('lowpass', 16000, Math.SQRT1_2, sr);
  const delay = 0.0029;
  const clean = biquadFilter(lp, biquadFilter(pk, biquadFilter(hp, placed(x, sr, PRE + delay))));
  const sigma = sweepRms(x) * 10 ** (-40 / 20);
  const n = whiteNoise(clean.length, sigma, 2026);
  const y = toF32(clean.map((v, i) => v + n[i]));
  const noise = toF32(whiteNoise(Math.round(2 * sr), sigma, 2027));
  const t0 = performance.now();
  const r = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2, noise });
  const ir = computeImpulseResponse({ stimulus: x, captured: y, sampleRate: sr, f1: F1, f2: F2 });
  const ms = performance.now() - t0;
  assert.equal(r.fftSize, 2 ** 21);
  const expected = (f) => biquadDb(hp, f, sr) + biquadDb(pk, f, sr) + biquadDb(lp, f, sr);
  const { worst, at } = maxErrDb(r, expected);
  t.diagnostic(`analysis ${ms.toFixed(0)} ms; max error ${worst.toFixed(4)} dB at ${at} Hz`);
  assert.ok(worst <= 0.3, `${worst.toFixed(4)} dB at ${at.toFixed(1)} Hz`);
  const arrival = Math.round((PRE + delay) * sr);
  assert.ok(ir.peakIndex >= arrival && ir.peakIndex <= arrival + Math.round(0.001 * sr),
    `IR peak ${ir.peakIndex}, arrival ${arrival}`);
  assert.ok(r.validRange[0] < 25 && r.validRange[1] > 19000, `${r.validRange}`);
  assert.ok(ms < 10000, `analysis took ${ms.toFixed(0)} ms`);
});

test('V382 transfer.v3: a unity system reads within 0.1 dB everywhere in its validRange', () => {
  const render = renderSweep;
  const worst = (t, gainDb) => {
    let w = 0;
    const [lo, hi] = t.validRange;
    t.frequencies.forEach((f, i) => {
      if (f >= lo && f <= hi && Math.abs(t.magnitudeDb[i] - gainDb) > Math.abs(w)) {
        w = t.magnitudeDb[i] - gainDb;
      }
    });
    return w;
  };
  for (const [sr, duration, f2] of [[48000, 1, 20000], [44100, 2, 22000]]) {
    const r = render({ kind: 'log-sweep', sampleRate: sr, duration, f1: 20, f2, level: 0.5 });
    const x = r.samples;
    const y = new Float32Array(x.length + 600);
    for (let i = 0; i < x.length; i++) y[i + 300] = 0.5 * x[i];
    const args = { stimulus: x, captured: y, sampleRate: sr, f1: r.spec.f1, f2: r.spec.f2 };
    const v2 = computeTransfer({ ...args, options: { algorithm: 'oscilla.transfer.v2' } });
    const v3 = computeTransfer(args);
    assert.equal(v3.algorithm, 'oscilla.transfer.v3');
    const g = 20 * Math.log10(0.5);
    assert.ok(worst(v2, g) < -0.3, `v2 kept a biased point: ${worst(v2, g)} dB`);
    assert.ok(Math.abs(worst(v3, g)) <= 0.1 + 1e-9, `v3 worst ${worst(v3, g)} dB`);
    assert.ok(v3.validRange[1] < v2.validRange[1] && v3.validRange[0] === v2.validRange[0]);
    assert.ok(v3.validRange[1] > 0.8 * r.spec.f2, `v3 still reaches ${v3.validRange[1]} Hz`);
  }
});

test('V382 ir.v3: the stored IR keeps the low-frequency precursor (0 dB at 30 Hz)', () => {
  const sr = 48000;
  const r = renderSweep({ kind: 'log-sweep', sampleRate: sr, duration: 2, f1: 20, f2: 20000,
    level: 0.5 });
  const x = r.samples;
  const pre = Math.round(0.5 * sr);
  const y = new Float32Array(x.length + pre + sr / 2);
  for (let i = 0; i < x.length; i++) y[i + pre] = x[i];
  const args = { stimulus: x, captured: y, sampleRate: sr, f1: r.spec.f1, f2: r.spec.f2,
    lagSamples: pre };
  // |DFT| of the stored samples at one frequency, in dB (a unity system: 0 dB in band)
  const gainDb = (samples, hz) => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * hz) / sr;
    for (let n = 0; n < samples.length; n++) {
      re += samples[n] * Math.cos(w * n);
      im -= samples[n] * Math.sin(w * n);
    }
    return 10 * Math.log10(re * re + im * im);
  };
  const v2 = computeImpulseResponse({ ...args, algorithm: 'oscilla.ir.log-sweep.v2' });
  const v3 = computeImpulseResponse(args);
  assert.equal(v3.algorithm, 'oscilla.ir.log-sweep.v3');
  assert.equal(pre - Math.round(v3.captureOffsetS * sr), Math.round((5 / 20) * sr), '250 ms');
  for (const hz of [30, 60]) {
    assert.ok(gainDb(v2.samples, hz) < -0.5, `v2 at ${hz} Hz: ${gainDb(v2.samples, hz)} dB`);
    assert.ok(Math.abs(gainDb(v3.samples, hz)) < 0.05, `v3 at ${hz} Hz: ${gainDb(v3.samples, hz)}`);
  }
  assert.ok(Math.abs(gainDb(v3.samples, 1000) - gainDb(v2.samples, 1000)) < 0.01, '1 kHz alike');
  // the absolute peak time is the same; only the stored window starts earlier
  assert.ok(Math.abs((v3.captureOffsetS + v3.peakTimeS) - (v2.captureOffsetS + v2.peakTimeS))
    < 1e-9);
});

test('V382 align.v2: a fractional delay is found exactly; the transfer phase stays flat', async () => {
  const { createFft } = await import('../../src/js/analysis/fft.js');
  const np2 = (n) => 2 ** Math.ceil(Math.log2(n));
  // an exact band-limited fractional delay (frequency-domain phase shift)
  const delay = (x, total, d) => {
    const N = np2(total + x.length);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    re.set(x);
    const fft = createFft(N);
    fft.forward(re, im);
    for (let k = 0; k < N; k++) {
      const w = (-2 * Math.PI * (k <= N / 2 ? k : k - N) * d) / N;
      const a = re[k] * Math.cos(w) - im[k] * Math.sin(w);
      const b = re[k] * Math.sin(w) + im[k] * Math.cos(w);
      re[k] = a;
      im[k] = -b;
    }
    fft.forward(re, im);
    return Float32Array.from({ length: total }, (_, i) => re[i] / N);
  };
  for (const sr of [44100, 48000]) {
    const r = renderSweep({ kind: 'log-sweep', sampleRate: sr, duration: 1, f1: 20, f2: 20000,
      level: 0.5 });
    const x = r.samples;
    for (const frac of [0.1, 0.25, 0.4, 0.75]) {
      const d = 4800 + frac;
      const y = delay(x, x.length + 2 * sr, d);
      const v1 = align(x, y, sr, { algorithm: 'oscilla.align.xcorr.v1' });
      const v2 = align(x, y, sr);
      assert.equal(v2.algorithm, 'oscilla.align.xcorr.v2');
      assert.ok(Math.abs(v2.lagSamples - d) < 1e-3, `${sr} ${frac}: v2 ${v2.lagSamples - d}`);
      if (frac === 0.25) {
        assert.ok(Math.abs(v1.lagSamples - d) > 0.04, `v1 biased: ${v1.lagSamples - d}`);
        // the phase of a pure delay after alignment: 0° (v1 tilted it, −9.9° at 19 kHz)
        const phaseAt = (alignment) => {
          const t = computeTransfer({ stimulus: x, captured: y, sampleRate: sr, f1: r.spec.f1,
            f2: r.spec.f2, alignment, options: { phase: true } });
          const i = t.frequencies.findIndex((f) => f >= 19000);
          return t.phaseDeg[i];
        };
        assert.ok(Math.abs(phaseAt(v2)) < 0.5, `v2 phase ${phaseAt(v2)}°`);
        assert.ok(Math.abs(phaseAt(v1)) > 5, `v1 phase ${phaseAt(v1)}°`);
      }
    }
  }
});
