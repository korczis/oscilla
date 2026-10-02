// V3 RTA band analysis, repeat aggregation and resolution-aware formatting
// (src/js/measurement/rta.js, aggregate.js, format.js).
//
// Spectra here are Hann-windowed power spectra normalised so that Σ P[k] is the mean square
// (one-sided: P[k] = c·|X[k]|² / (N·Σw²), c = 2 except DC and Nyquist), the input contract of
// bandPowers(). Hann is used because its main lobe is ±2 bins wide and its sidelobes start at
// −31.5 dB and fall at 18 dB/octave: a tone at a band centre keeps essentially all its power
// inside a band that is several bins wide. A rectangular window (−13 dB sidelobes, 6 dB/octave)
// would leak enough into the neighbouring bands to blur the "≥ 20 dB dominance" requirement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFft } from '../../src/js/analysis/fft.js';
import { mulberry32, fillWhite, fillPink } from '../../src/js/audio/noise.js';
import { THIRD_OCTAVE_FREQUENCIES } from '../../src/js/core/constants.js';
import {
  bandCenters,
  bandPowers,
  bandAnalysis,
  bandBinCounts,
  integrateBands,
  createRtaAverager,
  OCTAVE_RATIO_G,
  NYQUIST_FRACTION,
  RTA_TAU_FAST_S,
  RTA_TAU_SLOW_S,
  UNDER_RESOLVED_BINS,
} from '../../src/js/measurement/rta.js';
import { aggregateRuns, quantileSorted } from '../../src/js/measurement/aggregate.js';
import {
  binResolutionHz,
  formatFrequencyWithResolution,
  formatDb,
  formatEstimate,
} from '../../src/js/measurement/format.js';

const RATES = [44100, 48000, 96000];
const OCTAVE_NOMINAL = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const THIRD_25_20K = THIRD_OCTAVE_FREQUENCIES.filter((f) => f >= 25);

const ffts = new Map();
const hanns = new Map();
function hann(n) {
  if (!hanns.has(n)) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hanns.set(n, w);
  }
  return hanns.get(n);
}

/** Welch power spectrum (Hann, 50 % overlap), normalised so that Σ P = mean square. */
function welchPower(x, n) {
  if (!ffts.has(n)) ffts.set(n, createFft(n));
  const fft = ffts.get(n);
  const w = hann(n);
  let sw2 = 0;
  for (let i = 0; i < n; i++) sw2 += w[i] * w[i];
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const p = new Float64Array(n / 2 + 1);
  let frames = 0;
  for (let start = 0; start + n <= x.length; start += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = x[start + i] * w[i];
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let k = 0; k <= n / 2; k++) {
      const c = k === 0 || k === n / 2 ? 1 : 2;
      p[k] += (c * (re[k] * re[k] + im[k] * im[k])) / (n * sw2);
    }
    frames++;
  }
  for (let k = 0; k <= n / 2; k++) p[k] /= frames;
  return p;
}

function sines(tones, sr, len) {
  const x = new Float64Array(len);
  for (const { f, a, ph = 0.4 } of tones) {
    for (let i = 0; i < len; i++) x[i] += a * Math.sin((2 * Math.PI * f * i) / sr + ph);
  }
  return x;
}

function nextPow2(v) {
  return 2 ** Math.ceil(Math.log2(v));
}

// ---------------------------------------------------------------------------------------------
// Band centres

test('rta: octave bands at 48 kHz are 31.5 … 16000 nominal with the exact base-10 formula', () => {
  const bands = bandCenters('octave', 20, 20000, 48000);
  assert.deepEqual(
    bands.map((b) => b.nominal),
    OCTAVE_NOMINAL,
  );
  for (const b of bands) {
    const x = Math.round(Math.log(b.exact / 1000) / Math.log(OCTAVE_RATIO_G));
    assert.ok(Math.abs(b.exact - 1000 * OCTAVE_RATIO_G ** x) < 1e-9 * b.exact);
    assert.ok(Math.abs(b.lo - b.exact * OCTAVE_RATIO_G ** -0.5) < 1e-9 * b.exact);
    assert.ok(Math.abs(b.hi - b.exact * OCTAVE_RATIO_G ** 0.5) < 1e-9 * b.exact);
    // Nominal and exact agree to the preferred-number rounding (≤ 3 %, IEC 61260-1 Annex E).
    assert.ok(Math.abs(b.exact / b.nominal - 1) < 0.03, `${b.nominal} vs ${b.exact}`);
  }
  assert.equal(bands.find((b) => b.nominal === 1000).exact, 1000);
});

test('rta: third-octave bands at 48 kHz match the V2 nominal table and the exact formula', () => {
  const bands = bandCenters('third', 25, 20000, 48000);
  assert.deepEqual(
    bands.map((b) => b.nominal),
    THIRD_25_20K,
  );
  // With fMin = 20 the 20 Hz band is included: selection is by nominal label.
  assert.deepEqual(
    bandCenters('third', 20, 20000, 48000).map((b) => b.nominal),
    THIRD_OCTAVE_FREQUENCIES,
  );
  for (const b of bands) {
    const x = Math.round((3 * Math.log(b.exact / 1000)) / Math.log(OCTAVE_RATIO_G));
    const exact = 1000 * OCTAVE_RATIO_G ** (x / 3);
    assert.ok(Math.abs(b.exact - exact) < 1e-9 * exact);
    assert.ok(Math.abs(b.lo - exact * OCTAVE_RATIO_G ** (-1 / 6)) < 1e-9 * exact);
    assert.ok(Math.abs(b.hi - exact * OCTAVE_RATIO_G ** (1 / 6)) < 1e-9 * exact);
    assert.ok(Math.abs(b.exact / b.nominal - 1) < 0.03, `${b.nominal} vs ${b.exact}`);
  }
  // Spot values from IEC 61260-1 Table E.1 (exact mid-band, 5 significant digits).
  const at = (n) => bands.find((b) => b.nominal === n).exact;
  assert.equal(at(31.5).toPrecision(5), '31.623');
  assert.equal(at(63).toPrecision(5), '63.096');
  assert.equal(at(20000).toPrecision(5), '19953');
});

test('rta: band edges are contiguous and respect 0.95 × Nyquist at 44.1, 48, 96 kHz', () => {
  for (const sr of RATES) {
    for (const kind of ['octave', 'third']) {
      const bands = bandCenters(kind, 10, 40000, sr);
      assert.ok(bands.length > 0);
      for (let i = 0; i + 1 < bands.length; i++) {
        const gap = Math.abs(bands[i].hi - bands[i + 1].lo);
        assert.ok(gap <= Number.EPSILON * bands[i].hi, `${kind} ${sr}: gap ${gap} at ${i}`);
        assert.ok(bands[i].lo < bands[i].exact && bands[i].exact < bands[i].hi);
      }
      const limit = (NYQUIST_FRACTION * sr) / 2;
      for (const b of bands) assert.ok(b.hi <= limit);
      // The next band up would cross the limit: nothing usable is dropped.
      const last = bands[bands.length - 1];
      const b = kind === 'octave' ? 1 : 3;
      assert.ok(last.hi * OCTAVE_RATIO_G ** (1 / b) > limit, `${kind} ${sr}: ${last.nominal}`);
    }
  }
  // 44.1 kHz: the 20 kHz third-octave band (upper edge 22.39 kHz) exceeds 0.95 × 22.05 kHz.
  const t441 = bandCenters('third', 20, 20000, 44100);
  assert.equal(t441[t441.length - 1].nominal, 16000);
  const o441 = bandCenters('octave', 20, 20000, 44100);
  assert.equal(o441[o441.length - 1].nominal, 8000);
  // 96 kHz extends above 20 kHz when asked.
  const t96 = bandCenters('third', 20, 40000, 96000);
  assert.equal(t96[t96.length - 1].nominal, 40000);
});

test('rta: invalid band requests throw', () => {
  assert.throws(() => bandCenters('sixth', 20, 20000, 48000), TypeError);
  assert.throws(() => bandCenters('third', 0, 20000, 48000), RangeError);
  assert.throws(() => bandCenters('third', 2000, 200, 48000), RangeError);
  assert.throws(() => bandCenters('third', 20, 20000, 0), RangeError);
});

// ---------------------------------------------------------------------------------------------
// Band integration

test('rta: flat spectrum → band power equals band width in bins (fractional edge bins)', () => {
  const sr = 48000;
  const n = 8192;
  const binHz = sr / n;
  const power = new Float64Array(n / 2 + 1).fill(1);
  const frozenCopy = Float64Array.from(power);
  const bands = bandCenters('third', 20, 20000, sr);
  const p = integrateBands(power, binHz, bands);
  for (let i = 0; i < bands.length; i++) {
    const expected = (bands[i].hi - bands[i].lo) / binHz;
    assert.ok(Math.abs(p[i] - expected) < 1e-9 * expected, `${bands[i].nominal}: ${p[i]}`);
  }
  assert.deepEqual(power, frozenCopy, 'input not mutated');
  const { binCounts, underResolved } = bandBinCounts(binHz, bands, power.length);
  for (let i = 0; i < bands.length; i++) {
    assert.ok(Math.abs(binCounts[i] - p[i]) < 1e-9 * p[i]);
    assert.equal(underResolved[i], binCounts[i] < UNDER_RESOLVED_BINS);
  }
  // 25 Hz third-octave band is 5.8 Hz wide: under one 5.86 Hz bin at 8192 points.
  assert.equal(underResolved[bands.findIndex((b) => b.nominal === 25)], true);
  assert.equal(underResolved[bands.findIndex((b) => b.nominal === 1000)], false);
  // A band whose bins lie past the end of the spectrum integrates nothing.
  const off = [{ nominal: 1, exact: 1, lo: sr, hi: 2 * sr }];
  assert.equal(bandPowers(power, binHz, off)[0], -Infinity);
  assert.equal(bandBinCounts(binHz, off, power.length).binCounts[0], 0);
});

test('rta: a sine at each band centre dominates every other band by ≥ 20 dB', () => {
  for (const sr of RATES) {
    for (const kind of ['octave', 'third']) {
      const bands = bandCenters(kind, 20, 20000, sr);
      // ≥ 8 bins in the narrowest band, so the ±2-bin Hann main lobe fits well inside it.
      const narrowest = bands[0].hi - bands[0].lo;
      const n = nextPow2((8 * sr) / narrowest);
      const binHz = sr / n;
      for (let j = 0; j < bands.length; j++) {
        const x = sines([{ f: bands[j].exact, a: 0.5 }], sr, n);
        const { levelsDb, underResolved } = bandAnalysis(welchPower(x, n), binHz, bands);
        assert.equal(underResolved[j], false);
        // All the tone's power lands in its band: 10·log10(A²/2), within 0.05 dB.
        assert.ok(Math.abs(levelsDb[j] - 10 * Math.log10(0.125)) < 0.05, `${levelsDb[j]}`);
        for (let i = 0; i < bands.length; i++) {
          if (i === j) continue;
          assert.ok(
            levelsDb[j] - levelsDb[i] >= 20,
            `${sr} ${kind} ${bands[j].nominal}: band ${bands[i].nominal} only ` +
              `${(levelsDb[j] - levelsDb[i]).toFixed(1)} dB below`,
          );
        }
      }
    }
  }
});

test('rta: two equal tones in one band read +3.01 dB over one tone', () => {
  for (const sr of RATES) {
    const n = 16384;
    const binHz = sr / n;
    const bands = bandCenters('octave', 20, 20000, sr);
    const k = bands.findIndex((b) => b.nominal === 1000); // 707 … 1413 Hz
    const one = bandPowers(welchPower(sines([{ f: 900, a: 0.3 }], sr, 4 * n), n), binHz, bands);
    const two = bandPowers(
      welchPower(sines([{ f: 900, a: 0.3 }, { f: 1150, a: 0.3, ph: 1.7 }], sr, 4 * n), n),
      binHz,
      bands,
    );
    // Power adds: 10·log10(2) = 3.0103 dB. ±0.1 dB covers the residual cross term of two
    // tones ~85 bins apart (Hann sidelobes there are below −100 dB) and frame-edge effects.
    assert.ok(Math.abs(two[k] - one[k] - 10 * Math.log10(2)) < 0.1, `${two[k] - one[k]}`);
  }
});

test('rta: two tones in different bands → each band reads its own tone', () => {
  for (const sr of RATES) {
    const n = 16384;
    const binHz = sr / n;
    const bands = bandCenters('third', 20, 20000, sr);
    const i250 = bands.findIndex((b) => b.nominal === 250);
    const i4k = bands.findIndex((b) => b.nominal === 4000);
    const len = 4 * n;
    const lowOnly = bandPowers(welchPower(sines([{ f: 251, a: 0.5 }], sr, len), n), binHz, bands);
    const highOnly = bandPowers(welchPower(sines([{ f: 3990, a: 0.05 }], sr, len), n), binHz,
      bands);
    const both = bandPowers(
      welchPower(sines([{ f: 251, a: 0.5 }, { f: 3990, a: 0.05 }], sr, len), n),
      binHz,
      bands,
    );
    assert.ok(Math.abs(both[i250] - lowOnly[i250]) < 0.1);
    assert.ok(Math.abs(both[i4k] - highOnly[i4k]) < 0.1);
    assert.ok(Math.abs(both[i250] - 10 * Math.log10(0.125)) < 0.1);
    assert.ok(Math.abs(both[i4k] - 10 * Math.log10(0.00125)) < 0.1);
  }
});

// Noise tests: 2^20 samples, Welch with 16384-point Hann frames, 50 % overlap (127 frames).
// The relative standard deviation of a band-power estimate is ≈ 1/sqrt(B·T) (B band width,
// T record length), i.e. σ ≈ 4.34/sqrt(B·T) dB: 0.19 dB at 100 Hz (B = 23 Hz, T = 21.8 s) and
// smaller above. Tolerances are 4σ per band (never under 0.25 dB) and 1 dB for pink flatness,
// the specified ±1 dB. The seeds are fixed, so the runs are deterministic; the tolerances say
// how much margin a different seed would have.
const NOISE_LEN = 2 ** 20;
const NOISE_FFT = 16384;

function bandSigmaDb(band, sr) {
  return 4.34 / Math.sqrt((band.hi - band.lo) * (NOISE_LEN / sr));
}

test('rta: white noise → third-octave levels rise ≈ 1 dB per band (3 dB/octave)', () => {
  for (const sr of [44100, 48000]) {
    const x = fillWhite(new Float32Array(NOISE_LEN), mulberry32(7));
    const bands = bandCenters('third', 100, 10000, sr);
    const levels = bandPowers(welchPower(x, NOISE_FFT), sr / NOISE_FFT, bands);
    // Uniform [−1, 1): variance 1/3 spread flat over 0 … sr/2.
    for (let i = 0; i < bands.length; i++) {
      const expected = 10 * Math.log10(((1 / 3) * (bands[i].hi - bands[i].lo)) / (sr / 2));
      const tol = Math.max(0.25, 4 * bandSigmaDb(bands[i], sr));
      assert.ok(Math.abs(levels[i] - expected) < tol, `${sr} ${bands[i].nominal}: ` +
        `${levels[i].toFixed(2)} vs ${expected.toFixed(2)}`);
    }
    // Least-squares slope per band: 10·log10(G^(1/3)) = 1.000 dB exactly in theory.
    const m = bands.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < m; i++) {
      sx += i;
      sy += levels[i];
      sxx += i * i;
      sxy += i * levels[i];
    }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    assert.ok(Math.abs(slope - 1) < 0.05, `slope ${slope}`);
  }
});

test('rta: seeded pink noise → flat third-octave bands within ±1 dB over 100 Hz-10 kHz', () => {
  for (const sr of [44100, 48000]) {
    const x = fillPink(new Float32Array(NOISE_LEN), mulberry32(11));
    const bands = bandCenters('third', 100, 10000, sr);
    const levels = bandPowers(welchPower(x, NOISE_FFT), sr / NOISE_FFT, bands);
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    for (let i = 0; i < bands.length; i++) {
      assert.ok(Math.abs(levels[i] - mean) <= 1, `${sr} ${bands[i].nominal}: ` +
        `${(levels[i] - mean).toFixed(2)} dB`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Averaging

function stepResponse(mode, tau, framesPerTau) {
  const dt = tau / framesPerTau;
  const avg = createRtaAverager({ mode, size: 1 });
  avg.push(Float64Array.of(1), dt); // seeds the average at power 1
  const input = Float64Array.of(10);
  const fractions = [0];
  for (let k = 1; k <= 3 * framesPerTau; k++) {
    const r = avg.push(input, dt);
    fractions.push((10 ** (r.levelsDb[0] / 10) - 1) / 9);
  }
  return fractions;
}

test('rta averager: step response reaches 63.2 % after one time constant (fast, slow)', () => {
  const target = 1 - Math.exp(-1);
  for (const [mode, tau, fpt] of [
    ['fast', RTA_TAU_FAST_S, 6],
    ['slow', RTA_TAU_SLOW_S, 47],
  ]) {
    const f = stepResponse(mode, tau, fpt);
    // Exponential averaging with α = 1 − e^(−Δt/τ) is exact at frame boundaries.
    assert.ok(Math.abs(f[fpt] - target) < 1e-9, `${mode}: ${f[fpt]}`);
    assert.ok(f[fpt - 1] < target && f[fpt + 1] > target, `${mode}: crossing within one frame`);
  }
  assert.equal(RTA_TAU_FAST_S, 0.125);
  assert.equal(RTA_TAU_SLOW_S, 1);
});

test('rta averager: result independent of frame rate (two Δt/2 frames = one Δt frame)', () => {
  const a = createRtaAverager({ mode: 'fast', size: 2 });
  const b = createRtaAverager({ mode: 'fast', size: 2 });
  const p0 = Float64Array.of(1, 4);
  const p1 = Float64Array.of(8, 0.5);
  a.push(p0, 0.02);
  b.push(p0, 0.02);
  a.push(p1, 0.04);
  b.push(p1, 0.02);
  b.push(p1, 0.02);
  const ra = a.push(p1, 0);
  const rb = b.push(p1, 0);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(ra.levelsDb[i] - rb.levelsDb[i]) < 1e-9);
});

test('rta averager: instant mode, averaging in power, peak hold, freeze, reset', () => {
  const inst = createRtaAverager({ mode: 'instant' });
  const r = inst.push(Float64Array.of(1, 0.01, 0), 0.05);
  assert.deepEqual(Array.from(r.levelsDb), [0, -20, -Infinity]);
  assert.equal(r.peakDb, null);

  // Power (not dB) averaging: half-way between 1 and 100 in power is 50.5, i.e. 17.03 dB,
  // not the 10 dB a dB average would give.
  const slow = createRtaAverager({ mode: 'slow', size: 1 });
  slow.push(Float64Array.of(1), 0.1);
  const half = -RTA_TAU_SLOW_S * Math.log(0.5);
  assert.ok(Math.abs(slow.push(Float64Array.of(100), half).levelsDb[0] - 10 * Math.log10(50.5))
    < 1e-9);

  const avg = createRtaAverager({ mode: 'fast', peakHold: true, size: 2 });
  const input = Float64Array.of(100, 1);
  const copy = Float64Array.from(input);
  const first = avg.push(input, 0.05);
  assert.deepEqual(input, copy, 'input not mutated');
  const levels = first.levelsDb;
  const peaks = first.peakDb;
  assert.deepEqual(Array.from(peaks), [20, 0]);
  for (let i = 0; i < 20; i++) avg.push(Float64Array.of(1, 1), 0.05);
  const later = avg.push(Float64Array.of(1, 1), 0.05);
  assert.equal(later, first, 'same result object');
  assert.equal(later.levelsDb, levels, 'levels buffer reused');
  assert.equal(later.peakDb, peaks, 'peak buffer reused');
  assert.ok(later.levelsDb[0] < 1, 'average decays');
  assert.deepEqual(Array.from(later.peakDb), [20, 0], 'peak hold keeps the maximum');

  avg.freeze();
  const frozen = Array.from(later.levelsDb);
  avg.push(Float64Array.of(1e6, 1e6), 0.05);
  assert.deepEqual(Array.from(avg.push(Float64Array.of(1e6, 1e6), 0.05).levelsDb), frozen);
  assert.equal(avg.frozen, true);
  avg.unfreeze();
  assert.ok(avg.push(Float64Array.of(1e6, 1e6), 0.05).levelsDb[0] > frozen[0]);

  avg.reset();
  assert.equal(avg.frames, 0);
  assert.ok(peaks.every((v) => v === -Infinity));
  const seeded = avg.push(Float64Array.of(10, 10), 0.05);
  assert.equal(seeded.levelsDb, levels);
  assert.ok(Math.abs(seeded.levelsDb[0] - 10) < 1e-12, 'first frame after reset seeds');
});

test('rta averager: no allocation after construction (lazy size fixed by first push)', () => {
  const avg = createRtaAverager({ mode: 'slow', peakHold: true });
  const r1 = avg.push(new Float64Array(31).fill(1), 0.02);
  const refs = [r1, r1.levelsDb, r1.peakDb];
  for (let i = 0; i < 100; i++) {
    const r = avg.push(new Float64Array(31).fill(i), 0.02);
    assert.equal(r, refs[0]);
    assert.equal(r.levelsDb, refs[1]);
    assert.equal(r.peakDb, refs[2]);
  }
  assert.throws(() => avg.push(new Float64Array(30), 0.02), RangeError);
  assert.throws(() => avg.push(Float64Array.of(...new Array(31).fill(-1)), 0.02), RangeError);
  assert.throws(() => avg.push(new Float64Array(31), -1), RangeError);
  assert.throws(() => createRtaAverager({ mode: 'impulse' }), TypeError);
});

// ---------------------------------------------------------------------------------------------
// Aggregation

test('aggregate: identical runs → zero dispersion for mean and median', () => {
  const run = Float64Array.of(-10, -3, 0, 2.5);
  for (const method of ['mean', 'median']) {
    const a = aggregateRuns([run, Float64Array.from(run), Float64Array.from(run)], { method });
    for (let i = 0; i < run.length; i++) {
      assert.ok(Math.abs(a.centreDb[i] - run[i]) < 1e-12);
      assert.ok(Math.abs(a.lowerDb[i] - run[i]) < 1e-12);
      assert.ok(Math.abs(a.upperDb[i] - run[i]) < 1e-12);
      assert.ok(Math.abs(a.spreadDb[i]) < 1e-12);
    }
    assert.ok(Math.abs(a.repeatabilityDb) < 1e-12);
    assert.equal(a.dispersion, method === 'mean' ? 'std' : 'p10-p90');
  }
});

test('aggregate mean: power-domain centre, dB std envelope, ≠ mean of dB', () => {
  const runs = [Float64Array.of(0, 10), Float64Array.of(2, 10), Float64Array.of(4, 16)];
  const copies = runs.map((r) => Float64Array.from(r));
  const a = aggregateRuns(runs, { method: 'mean' });
  assert.deepEqual(runs, copies, 'inputs not mutated');
  const centre0 = 10 * Math.log10((1 + 10 ** 0.2 + 10 ** 0.4) / 3);
  assert.ok(Math.abs(a.centreDb[0] - centre0) < 1e-12);
  assert.ok(Math.abs(a.centreDb[0] - 2) > 0.1, 'power mean differs from the dB mean (2 dB)');
  assert.ok(a.centreDb[0] > 2, 'power mean ≥ dB mean');
  // Sample std (n − 1) of [0, 2, 4] dB is 2 dB; of [10, 10, 16] it is sqrt(12) dB.
  assert.ok(Math.abs(a.spreadDb[0] - 2) < 1e-12);
  assert.ok(Math.abs(a.spreadDb[1] - Math.sqrt(12)) < 1e-12);
  assert.ok(Math.abs(a.lowerDb[0] - (centre0 - 2)) < 1e-12);
  assert.ok(Math.abs(a.upperDb[0] - (centre0 + 2)) < 1e-12);
  // Median over 2 points of the spread = their mean (type-7 interpolation).
  assert.ok(Math.abs(a.repeatabilityDb - (2 + Math.sqrt(12)) / 2) < 1e-12);
});

test('aggregate median: p10-p90 band and median absolute deviation', () => {
  const values = [0, 1, 2, 3, 10];
  const runs = values.map((v) => Float64Array.of(v, -v));
  const a = aggregateRuns(runs, { method: 'median' });
  assert.equal(a.centreDb[0], 2);
  assert.ok(Math.abs(a.lowerDb[0] - 0.4) < 1e-12); // h = 0.4 between 0 and 1
  assert.ok(Math.abs(a.upperDb[0] - 7.2) < 1e-12); // h = 3.6 between 3 and 10
  assert.equal(a.spreadDb[0], 1); // |dev| = 2, 1, 0, 1, 8 → median 1
  assert.equal(a.centreDb[1], -2);
  assert.ok(Math.abs(a.lowerDb[1] + 7.2) < 1e-12);
  assert.equal(a.spreadDb[1], 1);
  assert.equal(a.repeatabilityDb, 1);
  // The outlier moves the mean envelope far more than the robust band.
  const m = aggregateRuns(runs, { method: 'mean' });
  assert.ok(m.spreadDb[0] > 3);
  assert.equal(quantileSorted(Float64Array.of(1, 2), 2, 0.5), 1.5);
});

test('aggregate: one run → no envelope; zero power; validation', () => {
  const run = Float64Array.of(1, 2, 3);
  const one = aggregateRuns([run]);
  assert.deepEqual(Array.from(one.centreDb), [1, 2, 3]);
  assert.notEqual(one.centreDb, run, 'copied, not aliased');
  assert.equal(one.lowerDb, null);
  assert.equal(one.upperDb, null);
  assert.equal(one.dispersion, null);
  assert.equal(one.repeatabilityDb, null);

  const z = aggregateRuns([Float64Array.of(-Infinity, 0), Float64Array.of(0, 0)]);
  assert.ok(Math.abs(z.centreDb[0] - 10 * Math.log10(0.5)) < 1e-12, 'zero power averages in');
  assert.ok(Number.isNaN(z.spreadDb[0]), 'dB spread undefined with a −∞ run');
  assert.equal(z.repeatabilityDb, 0, 'undefined points left out of the summary');

  assert.throws(() => aggregateRuns([]), RangeError);
  assert.throws(() => aggregateRuns([run, Float64Array.of(1, 2)]), RangeError);
  assert.throws(() => aggregateRuns([run, Float64Array.of(1, NaN, 3)]), RangeError);
  assert.throws(() => aggregateRuns([run, run], { method: 'mode' }), TypeError);
});

// ---------------------------------------------------------------------------------------------
// Formatting

test('format: bin resolution and resolution-limited frequency digits', () => {
  assert.equal(binResolutionHz(48000, 8192), 5.859375);
  assert.equal(binResolutionHz(44100, 4096), 44100 / 4096);
  assert.throws(() => binResolutionHz(48000, 0), RangeError);
  const r48 = binResolutionHz(48000, 8192);
  // Spec §97: never 18437.238194 Hz at 5.86 Hz resolution.
  assert.equal(formatFrequencyWithResolution(18437.238194, r48), '18.437 kHz');
  assert.equal(formatFrequencyWithResolution(18437.238194, binResolutionHz(48000, 1024)),
    '18.44 kHz');
  assert.equal(formatFrequencyWithResolution(440.1234, binResolutionHz(48000, 65536)),
    '440.1 Hz');
  assert.equal(formatFrequencyWithResolution(437.2, binResolutionHz(96000, 2048)), '440 Hz');
  assert.equal(formatFrequencyWithResolution(440.1234, binResolutionHz(44100, 8192)), '440 Hz');
  assert.equal(formatFrequencyWithResolution(999.96, 0.1), '1.0000 kHz');
  assert.equal(formatFrequencyWithResolution(NaN, 1), '—');
  for (const sr of RATES) {
    for (const n of [1024, 4096, 8192, 32768]) {
      const res = binResolutionHz(sr, n);
      const text = formatFrequencyWithResolution(12345.6789, res);
      const digits = (text.split(' ')[0].split('.')[1] || '').length;
      // kHz decimals d mean a 10^(3−d) Hz digit, which must not be finer than the resolution.
      assert.ok(10 ** (3 - digits) <= res, `${sr}/${n}: ${text}`);
      assert.ok(10 ** (3 - digits) > res / 10, `${sr}/${n}: ${text} drops a usable digit`);
    }
  }
});

test('format: dB labels — relative never becomes SPL', () => {
  assert.equal(formatDb(-12.34), '−12.3 dB relative');
  assert.equal(formatDb(-12.34, { decimals: 2, kind: 'relative' }), '−12.34 dB relative');
  assert.equal(formatDb(94, { kind: 'spl' }), '94.0 dB SPL');
  assert.equal(formatDb(-0.01), '0.0 dB relative');
  assert.equal(formatDb(-Infinity), '−∞ dB relative');
  assert.equal(formatDb(NaN), '— dB relative');
  for (const v of [-200, -60, 0, 94, 120, -Infinity, NaN]) {
    assert.ok(!formatDb(v, { kind: 'relative' }).includes('SPL'));
    assert.ok(!formatDb(v).includes('SPL'));
  }
  assert.throws(() => formatDb(94, { kind: 'calibrated' }), TypeError);
});

test('format: estimates with two significant digits of uncertainty (spec §70)', () => {
  assert.equal(formatEstimate(440.04, 2.93, 'Hz'), '≈ 440.0 ± 2.9 Hz (estimate)');
  assert.equal(formatEstimate(440.04, binResolutionHz(48000, 8192) / 2, 'Hz'),
    '≈ 440.0 ± 2.9 Hz (estimate)');
  assert.equal(formatEstimate(1234.5, 37, 'Hz'), '≈ 1235 ± 37 Hz (estimate)');
  assert.equal(formatEstimate(12345, 290, 'Hz'), '≈ 12350 ± 290 Hz (estimate)');
  assert.equal(formatEstimate(-3.14159, 0.0123, 'dB'), '≈ −3.142 ± 0.012 dB (estimate)');
  assert.equal(formatEstimate(5, 9.96, 'ms'), '≈ 5 ± 10 ms (estimate)');
  assert.equal(formatEstimate(440.04, 0, 'Hz'), '≈ 440 Hz (estimate, uncertainty unknown)');
  assert.equal(formatEstimate(NaN, 1, 'Hz'), '— Hz');
});
