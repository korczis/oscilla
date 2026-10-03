// V3 integration contract between the pure measurement modules: one test group per gap of
// docs/v3/algorithms.md ("Gaps", G1-G13) that was closed. Each test feeds one module's real
// output into the next one and pins the behaviour the gap was about; v3-pipeline.test.mjs runs
// the whole chain end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { ALGORITHMS, isKnownAlgorithm } from '../../src/js/measurement/algorithms.js';
import {
  DURATION_LIMITS, SAMPLE_RATE_LIMITS, STIMULUS_KINDS, normalizeStimulus, renderStimulus,
  safeMaxFrequency, inverseSweep,
} from '../../src/js/measurement/stimulus.js';
import {
  WINDOW_ALGORITHMS, WINDOW_GAINS, toneToMeanSquare, welch, windowAlgorithm, windowFn,
  powerSpectrum,
} from '../../src/js/measurement/spectrum.js';
import {
  bandAnalysis, bandCenters, bandPowers, meanSquarePower, rtaResult,
} from '../../src/js/measurement/rta.js';
import {
  CAPTURE_CHECK_ALGORITHMS, DISCONTINUITY_RATIO, checkCapture,
} from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';
import { ZERO_POWER_DB, computeTransfer } from '../../src/js/measurement/transfer.js';
import {
  IR_ALGORITHMS, computeImpulseResponse, normalizeIr,
} from '../../src/js/measurement/impulse-response.js';
import {
  normalizeResponse, smoothFractionalOctave, smoothResponse,
} from '../../src/js/measurement/smoothing.js';
import { assessQuality } from '../../src/js/measurement/quality.js';
import { DB_KIND_LABELS, formatDb } from '../../src/js/measurement/format.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  BAND_CORRECTION_STEPS, applyFrequencyCorrectionToBands, correctionAt,
} from '../../src/js/calibration/interpolate.js';
import {
  RELATIVE_SCALE_LABEL, RELATIVE_UNIT, createLevelCalibration, levelLabel,
} from '../../src/js/calibration/level.js';
import {
  LIMITS, STIMULUS_KINDS as SCHEMA_KINDS, createExperiment, createRecipe, describeCalibration,
  experimentToJson, serializeExperiment, summarizeExperiment, withResults,
} from '../../src/js/experiments/schema.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import { resultHash, withResultHash } from '../../src/js/experiments/hash.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { csvMeta, irCsv, rtaCsv, transferCsv } from '../../src/js/experiments/csv.js';
import { encodeArray } from '../../src/js/experiments/encode.js';
import { mulberry32 } from '../../src/js/audio/noise.js';

const RATES = [44100, 48000, 96000];
const OPTS = { knownAlgorithms: ALGORITHMS };
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function sine(f, sr, seconds, amp = 1, phase = 0) {
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr + phase);
  return x;
}

function gaussian(seed, n, sigma) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const m = sigma * Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12)));
    const v = 2 * Math.PI * rng();
    out[i] = m * Math.cos(v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(v);
  }
  return out;
}

/** Small real measurement: 1 s sweep at 8 kHz through a gain and a delay. */
const SR8 = 8000;
const SWEEP8 = renderStimulus({ kind: 'log-sweep', sampleRate: SR8, duration: 1, f1: 20,
  f2: 3000 });
const CAP8 = (() => {
  const y = new Float32Array(SWEEP8.samples.length + SR8);
  for (let i = 0; i < SWEEP8.samples.length; i++) y[400 + i] = 0.5 * SWEEP8.samples[i];
  return y;
})();
const BASE8 = { stimulus: SWEEP8.samples, captured: CAP8, sampleRate: SR8, f1: 20, f2: 3000 };
const ALIGN8 = align(SWEEP8.samples, CAP8, SR8);
const TRANSFER8 = computeTransfer({ ...BASE8, alignment: ALIGN8, options: { phase: true },
  noise: gaussian(3, CAP8.length, 1e-4) });
const IR8 = computeImpulseResponse({ ...BASE8, lagSamples: ALIGN8.lagSamples });
const IR8_FARINA = computeImpulseResponse({ ...BASE8, method: 'farina-inverse',
  inverse: inverseSweep(SWEEP8.spec) });
const CHECK8 = checkCapture({ sampleRate: SR8, samples: CAP8 });
const QUALITY8 = assessQuality({ capture: CHECK8, transfer: TRANSFER8 });

function experiment8(results, over = {}) {
  const e = createExperiment({ recipe: createRecipe({ stimulus: SWEEP8.spec }), now: 0,
    id: 'gaps-1', sampleRate: SR8, ...over });
  return withResults(e, { quality: QUALITY8, results });
}

const reject = (doc, path, re) => {
  const v = validateExperiment(doc, OPTS);
  assert.equal(v.ok, false, `expected ${path} to be rejected`);
  assert.ok(v.errors.some((e) => e.path === path && (!re || re.test(e.text))),
    JSON.stringify(v.errors));
  return v.errors;
};

// ----------------------------------------------------------------------------- G1

test('G1: a full-scale sine reads −3.01 dB in its band from welch(), Hann and Blackman-Harris',
  () => {
    // The tone sits at the band's exact centre, ≥ 12 bins from both edges for these bands at
    // 16384 points. Error sources: window leakage beyond 12 bins (Hann sidelobes ≈ −72 dB there
    // and falling 18 dB/octave, Blackman-Harris −92 dB: < 1e-6 of the power, 4e-6 dB), the 2f
    // cross term of a non-bin-centred tone (< 1e-6) and float32 rounding of the input
    // (≈ −150 dB). Measured ≤ 2.3e-7 dB; 1e-3 dB bounds it with a wide margin.
    const truth = 10 * Math.log10(0.5);
    const fftSize = 16384;
    for (const sr of RATES) {
      const binHz = sr / fftSize;
      for (const kind of ['octave', 'third']) {
        const [band] = bandCenters(kind, 1000, 1000, sr);
        const x = sine(band.exact, sr, 2, 1, 0.3);
        for (const window of ['hann', 'blackman-harris']) {
          const at = `${sr} Hz ${kind} ${window}`;
          const spec = welch(x, { fftSize, window });
          assert.equal(spec.scale, 'tone');
          const fromResult = bandPowers(spec, binHz, [band])[0];
          const fromMeanSquare = bandPowers(welch(x, { fftSize, window, scale: 'mean-square' }),
            binHz, [band])[0];
          const converted = bandPowers(toneToMeanSquare(spec.power, window), binHz, [band])[0];
          for (const v of [fromResult, fromMeanSquare, converted])
            assert.ok(Math.abs(v - truth) <= 1e-3, `${at}: ${v} dB`);
          // The old pitfall: a bare tone-scale array taken as mean-square reads
          // 10·log10(2·ENBW) high (+4.77 dB Hann, +6.03 dB Blackman-Harris).
          const g = WINDOW_GAINS[window];
          const enbw = g.noisePowerGain / g.coherentGain ** 2;
          const raw = bandPowers(spec.power, binHz, [band])[0];
          assert.ok(Math.abs(raw - truth - 10 * Math.log10(2 * enbw)) <= 1e-3, `${at}: ${raw}`);
        }
      }
    }
  });

test('G1: toneToMeanSquare is the named conversion; mean-square spectra sum to the mean square',
  () => {
    const enbw = 1.5;
    assert.deepEqual([...toneToMeanSquare(Float64Array.from([3, 3, 3, 3]), 'hann')],
      [3 / enbw, 3 / (2 * enbw), 3 / (2 * enbw), 3 / enbw]);
    const w = windowFn('blackman-harris', 8);
    const src = Float64Array.from([1, 2, 3]);
    const out = toneToMeanSquare(src, w);
    assert.deepEqual([...src], [1, 2, 3], 'input not modified');
    assert.ok(Math.abs(out[1] - 2 / (2 * w.enbwBins)) < 1e-15);
    assert.throws(() => toneToMeanSquare(src, 'kaiser'), RangeError);
    // One frame of a full-scale sine: Σ P (mean-square) = 0.5 within the 2f cross term.
    const fftSize = 4096;
    const x = sine(1234.5, 48000, fftSize / 48000);
    const ms = powerSpectrum(x, { fftSize, scale: 'mean-square' });
    const tone = powerSpectrum(x, { fftSize });
    let sum = 0;
    for (let k = 0; k < ms.length; k++) {
      sum += ms[k];
      assert.ok(Math.abs(ms[k] - toneToMeanSquare(tone, 'hann')[k]) <= 1e-12 * (tone[k] + 1e-30));
    }
    assert.ok(Math.abs(10 * Math.log10(sum) - 10 * Math.log10(0.5)) < 1e-3, `${sum}`);
    assert.throws(() => welch(x, { fftSize: 1024, scale: 'dBFS' }), RangeError);
    // An object without a stated scale is rejected, never guessed.
    assert.throws(() => meanSquarePower({ power: ms }), TypeError);
    assert.throws(() => bandPowers({ power: ms, scale: 'psd' }, 1, [{ lo: 1, hi: 2 }]), TypeError);
    assert.equal(meanSquarePower(ms), ms);
  });

// ----------------------------------------------------------------------------- G2

test('G2: recipe limits are stimulus.js constants; every normalized spec is a valid recipe', () => {
  assert.equal(LIMITS.sampleRate, SAMPLE_RATE_LIMITS);
  assert.equal(LIMITS.sweepDurationS, DURATION_LIMITS['log-sweep']);
  assert.deepEqual([...LIMITS.stimulusDurationS], [0.005, 30]);
  assert.equal(SCHEMA_KINDS, STIMULUS_KINDS);
  for (const sr of RATES) {
    for (const kind of STIMULUS_KINDS) {
      for (const extra of [{}, { f: 1e6, f1: 50, f2: 1e6 }]) {
        const raw = { kind, sampleRate: sr, duration: kind === 'chirp' ? 0.05 : 1, ...extra };
        if (kind !== 'sine') delete raw.f;
        if (kind === 'sine') delete raw.f1, delete raw.f2;
        if (['white', 'pink'].includes(kind)) delete raw.f1, delete raw.f2;
        const { spec, clampedTo } = normalizeStimulus(raw);
        if (extra.f) assert.equal(clampedTo === null, ['white', 'pink'].includes(kind));
        const recipe = createRecipe({ stimulus: spec });
        assert.deepStrictEqual(recipe.stimulus, { ...spec }, `${kind} at ${sr} Hz`);
        if (clampedTo !== null) assert.equal(clampedTo, safeMaxFrequency(sr));
      }
    }
  }
});

// ----------------------------------------------------------------------------- G3 / G4

test('G3: real IrResults (method, fftSize) validate and round-trip; method must match the ID',
  () => {
    for (const ir of [IR8, IR8_FARINA]) {
      const e = experiment8({ ir });
      const v = validateExperiment(experimentToJson(e), OPTS);
      assert.ok(v.ok, JSON.stringify(v.errors));
      assert.deepStrictEqual(v.experiment.results.ir, ir);
    }
    const doc = clone(serializeExperiment(experiment8({ ir: IR8 })));
    doc.results.ir.method = 'farina-inverse';
    reject(doc, 'results.ir.method', /does not match/);
    doc.results.ir.method = 'mls';
    reject(doc, 'results.ir.method');
    doc.results.ir.method = 'spectral';
    doc.results.ir.fftSize = 3.5;
    reject(doc, 'results.ir.fftSize');
    // An IR without the optional fields (older writer) stays without them.
    const old = clone(serializeExperiment(experiment8({ ir: IR8 })));
    delete old.results.ir.method;
    delete old.results.ir.fftSize;
    const v = validateExperiment(old, OPTS);
    assert.ok(v.ok);
    assert.equal('method' in v.experiment.results.ir, false);
  });

test('G4: validRange null, phaseReason and alignment of a real TransferResult validate', () => {
  // Capture without the stimulus: every grid point fails the SNR test, validRange is null.
  const noiseOnly = computeTransfer({ ...BASE8, captured: gaussian(5, CAP8.length, 0.1),
    noise: gaussian(6, CAP8.length, 0.1) });
  assert.equal(noiseOnly.validRange, null);
  for (const transfer of [TRANSFER8, noiseOnly]) {
    const v = validateExperiment(experimentToJson(experiment8({ transfer })), OPTS);
    assert.ok(v.ok, JSON.stringify(v.errors));
    assert.deepStrictEqual(v.experiment.results.transfer, transfer);
  }
  assert.equal(TRANSFER8.phaseReason, null);
  assert.equal(noiseOnly.phaseReason, 'NOT_REQUESTED');
  const doc = clone(serializeExperiment(experiment8({ transfer: TRANSFER8 })));
  const cases = [
    ['results.transfer.phaseReason', (d) => { d.results.transfer.phaseReason = 'GUESSED'; }],
    ['results.transfer.alignment.polarity', (d) => { d.results.transfer.alignment.polarity = 2; }],
    ['results.transfer.alignment.peakCorrelation',
      (d) => { d.results.transfer.alignment.peakCorrelation = 1.5; }],
    ['results.transfer.alignment.algorithm',
      (d) => { d.results.transfer.alignment.algorithm = 'oscilla.align.v9'; }],
    ['results.transfer.alignment.extra', (d) => { d.results.transfer.alignment.extra = 1; }],
  ];
  for (const [path, mutate] of cases) {
    const d = clone(doc);
    mutate(d);
    reject(d, path);
  }
});

test('G4: rtaResult encodes zero power as −300 dB; non-finite stored levels are rejected', () => {
  const sr = 48000;
  const bands = bandCenters('octave', 31.5, 16000, sr);
  const silent = bandPowers(new Float64Array(4097), sr / 8192, bands);
  const levels = Float64Array.from(silent, (v, i) => (i === 3 ? -12.5 : i === 4 ? -350 : v));
  const r = rtaResult({ sampleRate: sr, resolution: 'octave', bands, levelsDb: levels,
    fftSize: 8192, window: 'blackman-harris' });
  assert.equal(r.algorithm, 'oscilla.rta.v1');
  assert.equal(r.windowAlgorithm, 'oscilla.window.blackman-harris.v1');
  assert.equal(r.levelsDb[0], ZERO_POWER_DB);
  assert.equal(r.levelsDb[3], -12.5);
  assert.equal(r.levelsDb[4], ZERO_POWER_DB, 'below the zero-power floor is zero power');
  assert.notEqual(r.bands[0], bands[0], 'bands copied');
  assert.deepEqual(Object.keys(r.bands[0]), ['nominal', 'exact', 'lo', 'hi']);
  assert.equal(rtaResult({ sampleRate: sr, resolution: 'octave', bands, levelsDb: levels })
    .windowAlgorithm, null);
  const e = experiment8({ rta: r });
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.deepStrictEqual(v.experiment.results.rta, r);
  const doc = clone(serializeExperiment(e));
  doc.results.rta.levelsDb = encodeArray(Float64Array.from(levels, (x, i) => (i ? x : -Infinity)));
  reject(doc, 'results.rta.levelsDb[0]', /finite/);
  const unknown = clone(serializeExperiment(e));
  unknown.results.rta.windowAlgorithm = 'oscilla.window.kaiser.v1';
  reject(unknown, 'results.rta.windowAlgorithm', /unknown algorithm/);
  assert.throws(() => rtaResult({ sampleRate: sr, resolution: 'octave', bands,
    levelsDb: levels.subarray(1) }), RangeError);
  assert.throws(() => rtaResult({ sampleRate: sr, resolution: 'sixth', bands,
    levelsDb: levels }), TypeError);
  assert.throws(() => rtaResult({ sampleRate: sr, resolution: 'octave', bands,
    levelsDb: Float64Array.from(levels, () => NaN) }), RangeError);
});

test('G4: a real QualityAssessment (scope, mask) validates; malformed masks are rejected', () => {
  assert.ok(QUALITY8.mask && QUALITY8.reasons.every((r) => typeof r.scope === 'string'));
  const e = experiment8({ transfer: TRANSFER8 });
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.deepStrictEqual(v.experiment.quality, QUALITY8);
  const doc = clone(serializeExperiment(e));
  const n = QUALITY8.mask.frequencies.length;
  const bad = [
    ['quality.mask.reliable', (d) => { d.quality.mask.reliable = encodeArray(new Uint8Array(1)); }],
    ['quality.mask.calibrated[0]',
      (d) => { d.quality.mask.calibrated = encodeArray(new Uint8Array(n).fill(2)); }],
    ['quality.mask.extra', (d) => { d.quality.mask.extra = null; }],
    ['quality.reasons[0].scope', (d) => { d.quality.reasons[0].scope = 'vibes'; }],
  ];
  for (const [path, mutate] of bad) {
    const d = clone(doc);
    mutate(d);
    reject(d, path);
  }
});

// ----------------------------------------------------------------------------- G5

test('G5: a spliced tone and a level step are discontinuities with a reason code', () => {
  const sr = 48000;
  const f = 440;
  const s = Math.round((100 + 0.25) * (sr / f)); // a positive peak of the tone
  const x = sine(f, sr, 1, 0.5);
  for (let i = s; i < x.length; i++) x[i] = -x[i]; // phase-reversed splice: +0.5 → −0.5
  const r = checkCapture({ sampleRate: sr, samples: x });
  assert.equal(r.discontinuities.length, 1, JSON.stringify(r.discontinuities));
  const [d] = r.discontinuities;
  assert.deepEqual([d.start, d.end], [s - 1, s + 1]);
  assert.ok(Math.abs(d.jump - Math.abs(x[s] - x[s - 1])) < 1e-12);
  // Local rms(d) of a 0.5 tone at 440 Hz is 0.5·2·sin(π·440/48000)/√2 = 0.0204; the step is ≈ 1.
  assert.ok(d.ratio > 40 && d.ratio >= DISCONTINUITY_RATIO, `${d.ratio}`);
  assert.equal(r.invalid, true);
  assert.deepEqual(r.reasons.map((e) => e.code), ['DISCONTINUITY']);
  // A DC step of 0.05 under a 100 Hz tone: 18× its local rms(d) of 0.0028.
  const y = sine(100, sr, 1, 0.3);
  for (let i = 30000; i < y.length; i++) y[i] += 0.05;
  const step = checkCapture({ sampleRate: sr, samples: y });
  assert.deepEqual(step.discontinuities.map((e) => [e.start, e.end]), [[29999, 30001]]);
  // A short zero gap (10 ms, below the dropout length) is reported through its edges.
  const gap = sine(f, sr, 1, 0.5);
  gap.fill(0, s, s + 480);
  const g = checkCapture({ sampleRate: sr, samples: gap });
  assert.equal(g.dropouts.length, 0);
  assert.ok(g.discontinuities.length >= 1 && g.discontinuities[0].start === s - 1);
  assert.equal(checkCapture({ sampleRate: sr, samples: x },
    { discontinuityRatio: 1e9 }).discontinuities.length, 0, 'threshold overridable');
});

test('G5: full-scale tones near Nyquist, noise, transients and explained steps are not flagged',
  () => {
    for (const sr of RATES) {
      // 0.97 stays below the 0.98 rail, so no clipping exclusion helps: max|d| = √2·rms(d).
      const hf = sine(safeMaxFrequency(sr), sr, 1, 0.97, 0.1);
      const r = checkCapture({ sampleRate: sr, samples: hf });
      assert.deepEqual(r.discontinuities, [], `${sr} Hz`);
      assert.equal(r.invalid, false);
    }
    const sr = 48000;
    const noise = gaussian(7, 2 * sr, 0.1);
    assert.deepEqual(checkCapture({ sampleRate: sr, samples: noise }).discontinuities, []);
    const pink = renderStimulus({ kind: 'pink', sampleRate: sr, duration: 2, seed: 9 }).samples;
    assert.deepEqual(checkCapture({ sampleRate: sr, samples: pink }).discontinuities, []);
    const sweep = renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: 2 }).samples;
    assert.deepEqual(checkCapture({ sampleRate: sr, samples: sweep }).discontinuities, []);
    // One- and two-sample spikes are transients (they return to the old level), not steps.
    const spikes = sine(440, sr, 1, 0.3);
    spikes[5000] += 0.6;
    spikes[9000] -= 0.6;
    spikes[9001] -= 0.6;
    assert.deepEqual(checkCapture({ sampleRate: sr, samples: spikes }).discontinuities, []);
    // Abrupt onset after edge silence and the edges of a reported dropout are not reported
    // again as discontinuities.
    const s = Math.round(100.25 * (sr / 440));
    const onset = sine(440, sr, 1, 0.5);
    onset.fill(0, 0, s);
    const o = checkCapture({ sampleRate: sr, samples: onset });
    assert.deepEqual(o.discontinuities, []);
    assert.equal(o.invalid, false);
    const drop = sine(440, sr, 1, 0.5);
    drop.fill(0, s, s + 2400);
    const dr = checkCapture({ sampleRate: sr, samples: drop });
    assert.deepEqual(dr.reasons.map((e) => e.code), ['DROPOUT']);
    const none = checkCapture({ sampleRate: sr, samples: new Float32Array(0) });
    assert.deepEqual(none.discontinuities, []);
    assert.deepEqual(none.algorithms, CAPTURE_CHECK_ALGORITHMS);
  });

// ----------------------------------------------------------------------------- G6 / G7 / G9

test('G6/G7/G9: every result carries the algorithm IDs it used (pinned)', () => {
  const ids = {
    transfer: 'oscilla.transfer.v3', ir: 'oscilla.ir.log-sweep.v3',
    irFarina: 'oscilla.ir.farina-inverse.v3', rta: 'oscilla.rta.v1',
    smoothing: 'oscilla.smoothing.fractional-octave.v1', normalization: 'oscilla.normalization.v1',
    align: 'oscilla.align.xcorr.v1', clip: 'oscilla.clip.v1',
    discontinuity: 'oscilla.discontinuity.v1', quality: 'oscilla.confidence.v4',
    calibration: 'oscilla.calibration.log-interp.v1', window: 'oscilla.window.hann.v1',
    windowBlackmanHarris: 'oscilla.window.blackman-harris.v1',
    aggregate: 'oscilla.aggregate.v1',
  };
  assert.deepEqual({ ...ALGORITHMS }, ids);
  for (const id of Object.values(ids)) assert.ok(isKnownAlgorithm(id), id);
  // G15: confidence.v1 is superseded but retained (stored assessments carry it); so are
  // confidence.v2, transfer.v1 and the v1 IR methods (V3 pre-release review).
  for (const id of ['oscilla.confidence.v1', 'oscilla.confidence.v2', 'oscilla.transfer.v1',
    'oscilla.ir.log-sweep.v1', 'oscilla.ir.farina-inverse.v1']) assert.ok(isKnownAlgorithm(id));
  // Windows (G6).
  assert.deepEqual({ ...WINDOW_ALGORITHMS }, { hann: ids.window,
    'blackman-harris': ids.windowBlackmanHarris });
  assert.equal(windowFn('hann', 16).algorithm, ids.window);
  assert.equal(windowFn('blackman-harris', 16).algorithm, ids.windowBlackmanHarris);
  const x = sine(1000, 48000, 0.1);
  assert.equal(welch(x, { fftSize: 1024 }).windowAlgorithm, ids.window);
  assert.equal(welch(x, { fftSize: 1024, window: 'blackman-harris' }).windowAlgorithm,
    ids.windowBlackmanHarris);
  assert.equal(windowAlgorithm('blackman-harris'), ids.windowBlackmanHarris);
  assert.throws(() => windowAlgorithm('kaiser'), RangeError);
  // Alignment, capture checks, transfer, IR methods (G7, G9: Farina has its own ID).
  assert.equal(ALIGN8.algorithm, ids.align);
  assert.equal(align(x, new Float32Array(x.length), 48000).algorithm, ids.align);
  assert.deepEqual(CHECK8.algorithms, { clip: ids.clip, discontinuity: ids.discontinuity });
  assert.equal(TRANSFER8.algorithm, ids.transfer);
  assert.equal(TRANSFER8.alignment.algorithm, ids.align);
  assert.equal(IR8.algorithm, ids.ir);
  assert.equal(IR8_FARINA.algorithm, ids.irFarina);
  assert.deepEqual({ ...IR_ALGORITHMS }, { spectral: ids.ir, 'farina-inverse': ids.irFarina });
  // Derived views: smoothing and normalization.
  const { frequencies, magnitudeDb } = TRANSFER8;
  const sm = smoothResponse(frequencies, magnitudeDb, 6);
  assert.equal(sm.algorithm, ids.smoothing);
  assert.equal(sm.kind, 'smoothed');
  assert.equal(sm.label, 'SMOOTHED: 1/6 octave (power mean)');
  assert.deepEqual(sm.smoothedDb, smoothFractionalOctave(frequencies, magnitudeDb, 6));
  assert.equal(smoothResponse(frequencies, magnitudeDb, 0).label, 'RAW: unsmoothed');
  assert.equal(normalizeResponse(frequencies, magnitudeDb, { mode: 'at-frequency', hz: 1000 })
    .algorithm, ids.normalization);
  assert.equal(normalizeIr(IR8, 'peak-db').algorithm, ids.normalization);
  assert.equal(normalizeIr(IR8, 'peak-linear').algorithm, ids.normalization);
  // RTA, quality, calibration.
  const bands = bandCenters('octave', 125, 4000, 48000);
  assert.equal(bandAnalysis(welch(x, { fftSize: 1024 }), 48000 / 1024, bands).algorithm, ids.rta);
  assert.equal(QUALITY8.algorithm, ids.quality);
  const profile = createFrequencyProfile({ points: [[20, 0], [20000, 0]] });
  const r = rtaResult({ sampleRate: 48000, resolution: 'octave', bands,
    levelsDb: new Float64Array(bands.length) });
  assert.equal(applyFrequencyCorrectionToBands(r, profile).algorithm, ids.calibration);
});

// ----------------------------------------------------------------------------- G10

test('G10: one uncalibrated label; no "SPL" anywhere without a valid level calibration', () => {
  assert.equal(RELATIVE_UNIT, 'dB relative (dBFS-like)');
  assert.equal(RELATIVE_SCALE_LABEL, 'Relative level · dBFS-like / analyser-relative scale');
  assert.equal(DB_KIND_LABELS.relative, RELATIVE_UNIT);
  assert.equal(levelLabel(null).unit, RELATIVE_UNIT);
  assert.equal(formatDb(-20), `−20.0 ${RELATIVE_UNIT}`);
  const valid = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30, createdAt: '2026-10-02T09:00:00.000Z' });
  const tampered = { ...valid, offsetDb: valid.offsetDb + 1 };
  const bands = bandCenters('octave', 125, 4000, 48000);
  const rta = rtaResult({ sampleRate: 48000, resolution: 'octave', bands,
    levelsDb: new Float64Array(bands.length).fill(-40) });
  const outputs = (level) => {
    const e = experiment8({ transfer: TRANSFER8, ir: IR8, rta },
      { calibration: { frequency: null, level } });
    const meta = csvMeta(e);
    const q = assessQuality({ capture: CHECK8, transfer: TRANSFER8,
      calibration: { frequency: null, level } });
    return [
      describeCalibration(e.calibration), ...summarizeExperiment(e), transferCsv(TRANSFER8, meta),
      irCsv(IR8, meta), rtaCsv(rta, meta), ...q.reasons.map((r) => `${r.text} ${r.unit}`),
      formatDb(-40), levelLabel(level).unit,
    ].join('\n');
  };
  for (const level of [null, tampered, { ...valid, createdAt: null }]) {
    const text = outputs(level);
    assert.doesNotMatch(text, /SPL/, JSON.stringify(level));
    assert.ok(text.includes(RELATIVE_UNIT) && text.includes(RELATIVE_SCALE_LABEL));
  }
  assert.match(outputs(valid), /dB SPL/);
  // csv: calibrated values need a valid calibration to be labelled.
  const tamperedMeta = csvMeta(experiment8({}, { calibration: { frequency: null,
    level: tampered } }));
  assert.throws(() => transferCsv(TRANSFER8, tamperedMeta,
    { correctedDb: TRANSFER8.magnitudeDb }), /no frequency calibration/);
});

// ----------------------------------------------------------------------------- G11

test('G11: a frequency profile applied to RTA bands, power-weighted, never extrapolated', () => {
  const sr = 48000;
  const fftSize = 8192;
  const binHz = sr / fftSize;
  const bands = bandCenters('third', 25, 16000, sr);
  const levels = new Float64Array(bands.length).fill(-20);
  levels[0] = ZERO_POWER_DB;
  const rta = rtaResult({ sampleRate: sr, resolution: 'third', bands, levelsDb: levels });
  const before = Float64Array.from(rta.levelsDb);
  // A constant +2 dB deviation reads 2 dB high everywhere: corrected = observed − 2 dB.
  const flat2 = createFrequencyProfile({ points: [[10, 2], [20000, 2]] });
  const spectrum = welch(gaussian(11, sr, 0.1), { fftSize });
  for (const opts of [{}, { power: spectrum, binHz }]) {
    const c = applyFrequencyCorrectionToBands(rta, flat2, opts);
    assert.equal(c.weighting, opts.power ? 'spectrum' : 'flat');
    for (let i = 1; i < bands.length; i++) {
      assert.ok(Math.abs(c.correctedDb[i] + 22) < 1e-9, `${bands[i].nominal}: ${c.correctedDb[i]}`);
    }
    assert.equal(c.correctedDb[0], ZERO_POWER_DB, 'zero power stays zero power');
  }
  assert.deepEqual(rta.levelsDb, before, 'input not modified');
  // Power-weighted: all the band's power in one bin → exactly that bin's correction.
  const slope = createFrequencyProfile({ points: [[100, 0], [10000, 6]] });
  const i1k = bands.findIndex((b) => b.nominal === 1000);
  const k0 = Math.round(1000 / binHz);
  const power = new Float64Array(fftSize / 2 + 1);
  power[k0] = 1e-3;
  const one = applyFrequencyCorrectionToBands(rta, slope, { power, binHz });
  const expected = -correctionAt(slope, k0 * binHz).correctionDb;
  assert.ok(Math.abs(one.correctionDb[i1k] - expected) < 1e-12, `${one.correctionDb[i1k]}`);
  // Flat weighting: midpoint rule with BAND_CORRECTION_STEPS sub-bands against a dense
  // integral, for 12 dB/octave across an octave band (the documented < 1e-4 dB bound).
  const steep = createFrequencyProfile({ points: [[1000, 0], [8000, 36]] });
  const octaves = bandCenters('octave', 2000, 4000, sr);
  const oct = rtaResult({ sampleRate: sr, resolution: 'octave', bands: octaves,
    levelsDb: new Float64Array(octaves.length) });
  const fc = applyFrequencyCorrectionToBands(oct, steep);
  octaves.forEach((b, i) => {
    const m = 200000;
    let s = 0;
    for (let j = 0; j < m; j++) {
      const f = b.lo + ((j + 0.5) * (b.hi - b.lo)) / m;
      s += 10 ** (-correctionAt(steep, f).correctionDb / 10);
    }
    const dense = 10 * Math.log10(s / m);
    assert.ok(Math.abs(fc.correctionDb[i] - dense) < 1e-4, `${b.nominal}: ${fc.correctionDb[i]}`);
  });
  assert.equal(BAND_CORRECTION_STEPS, 256);
  // Coverage: only bands entirely inside [100 Hz, 10 kHz] are corrected; others flagged.
  const c = applyFrequencyCorrectionToBands(rta, slope);
  bands.forEach((b, i) => {
    const inside = b.lo >= 100 && b.hi <= 10000;
    assert.equal(c.covered[i], inside ? 1 : 0, `${b.nominal}`);
    if (!inside) {
      assert.equal(c.correctedDb[i], rta.levelsDb[i]);
      assert.ok(Number.isNaN(c.correctionDb[i]));
    }
  });
  assert.deepEqual(c.coverage, [100, 10000]);
  assert.equal(c.profileId, slope.id);
  assert.throws(() => applyFrequencyCorrectionToBands(rta, slope, { power }), RangeError);
  assert.throws(() => applyFrequencyCorrectionToBands({ bands, levelsDb: [1] }, slope),
    RangeError);
});

// ----------------------------------------------------------------------------- G13

test('G13: resultHash v1 covers exactly the encoded results block (old files)', () => {
  const e = experiment8({ transfer: TRANSFER8, ir: IR8 });
  const v1 = { version: 1 };
  const h = resultHash(e, v1);
  assert.equal(h, sha256(canonicalJson({ v: 1, results: serializeExperiment(e.results) })));
  assert.equal(resultHash(e, { sha256Hex: sha256, version: 1 }), h);
  // Name, notes, quality, provenance and key order do not enter it.
  const renamed = { ...e, name: 'other', quality: null, provenance: { ...e.provenance,
    configHash: 'f'.repeat(64) } };
  assert.equal(resultHash(renamed, v1), h);
  const reordered = { ...e,
    results: { rta: null, ir: e.results.ir, transfer: e.results.transfer } };
  assert.equal(resultHash(reordered, v1), h);
  // One flipped low bit of one IR sample, or the same values in another dtype, change it.
  const samples = IR8.samples.slice();
  new Uint8Array(samples.buffer)[0] ^= 1;
  assert.notEqual(resultHash(withResults(e, { results: { ir: { ...IR8, samples } } }), v1), h);
  const f64 = { ...IR8, samples: Float64Array.from(IR8.samples) };
  assert.notEqual(resultHash(withResults(e, { results: { ir: f64 } }), v1), h);
  // Stamping and clearing; a v1 stamp has no resultHashVersion (the form of a v1 file).
  const stamped = withResultHash(e, h, 1);
  assert.equal(stamped.provenance.resultHash, h);
  assert.equal('resultHashVersion' in stamped.provenance, false);
  assert.equal(e.provenance.resultHash, null, 'input not modified');
  assert.equal(withResults(stamped, { results: { rta: null } }).provenance.resultHash, null);
  // Quality is covered by v2, so a new verdict clears the stamp too.
  assert.equal(withResults(stamped, { quality: null }).provenance.resultHash, null);
  assert.throws(() => withResultHash(e, 'ABC'), TypeError);
  assert.throws(() => withResultHash(e, h, 3), RangeError);
});

test('G13 / M11: resultHash v2 covers results, quality, calibration, input and output', () => {
  const e = experiment8({ transfer: TRANSFER8, ir: IR8 });
  const h = resultHash(e);
  const part = (k) => (e[k] === undefined ? null : serializeExperiment(e[k]));
  assert.equal(h, sha256(canonicalJson({ v: 2, results: serializeExperiment(e.results),
    quality: part('quality'), calibration: part('calibration'), input: part('input'),
    output: part('output') })));
  assert.notEqual(h, resultHash(e, { version: 1 }));
  // Name, notes, provenance and key order still do not enter it ...
  assert.equal(resultHash({ ...e, name: 'other', environment: { notes: 'x' },
    provenance: { ...e.provenance, configHash: 'f'.repeat(64) } }), h);
  // ... but every editable verdict / calibration / input / output field does.
  const q = { algorithm: 'oscilla.confidence.v2', status: 'GOOD', reasons: [], metrics: {} };
  assert.notEqual(resultHash({ ...e, quality: q }), h);
  assert.notEqual(resultHash({ ...e, calibration: { frequency: null, level: { schemaVersion: 1,
    kind: 'level', referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -30,
    offsetDb: 124, conditions: null, createdAt: null } } }), h);
  assert.notEqual(resultHash({ ...e, input: { ...e.input, device: { label: 'other', id: null } } }),
    h);
  assert.notEqual(resultHash({ ...e, output: { level: e.output.level, masterGain: 0.1 } }), h);
  const stamped = withResultHash(e, h);
  assert.equal(stamped.provenance.resultHashVersion, 2);
});

test('G13: import verifies the result hash; a mismatch is the error "corrupt"', () => {
  const e = experiment8({ transfer: TRANSFER8, ir: IR8 });
  // A version-1 file (no resultHashVersion) still verifies as version 1.
  const old = withResultHash(e, resultHash(e, { version: 1 }), 1);
  const vOld = validateExperiment(experimentToJson(old), OPTS);
  assert.ok(vOld.ok, JSON.stringify(vOld.errors));
  assert.deepStrictEqual(vOld.experiment, old);
  const oldDoc = clone(serializeExperiment(old));
  oldDoc.name = 'renamed';
  assert.ok(validateExperiment(oldDoc, OPTS).ok, 'v1 does not cover the name');
  const stamped = withResultHash(e, resultHash(e));
  const v = validateExperiment(experimentToJson(stamped), OPTS);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.deepStrictEqual(v.experiment, stamped);
  assert.ok(validateExperiment(experimentToJson(stamped), { ...OPTS, sha256Hex: sha256 }).ok);
  const doc = clone(serializeExperiment(stamped));
  doc.results.ir.peakTimeS += 1 / SR8;
  doc.results.ir.peakIndex += 1;
  const errors = reject(doc, 'provenance.resultHash', /^corrupt/);
  assert.ok(errors.some((x) => x.code === 'corrupt'));
  const wrong = clone(serializeExperiment(stamped));
  wrong.provenance.resultHash = '0'.repeat(64);
  reject(wrong, 'provenance.resultHash', /corrupt/);
  const malformed = clone(serializeExperiment(stamped));
  malformed.provenance.resultHash = 'xyz';
  reject(malformed, 'provenance.resultHash', /format/);
  // M11: the stored verdict, calibration and input are covered by version 2.
  const verdict = clone(serializeExperiment(stamped));
  verdict.input.device.label = 'edited';
  reject(verdict, 'provenance.resultHash', /corrupt/);
  const version = clone(serializeExperiment(stamped));
  version.provenance.resultHashVersion = 3;
  reject(version, 'provenance.resultHashVersion', /one of/);
  // null: not stamped, nothing to verify (an experiment still being measured).
  assert.ok(validateExperiment(experimentToJson(e), OPTS).ok);
});
