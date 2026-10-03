// Golden outputs per algorithm ID (ADR 0024 confirmation criterion; docs/v3/algorithms.md G18).
//
// Every ID this build implements (algorithms.js KNOWN_ALGORITHM_IDS, current and retained) has
// one fixture, tests/unit/fixtures/v3/<id>.json: a small deterministic input run through the
// module, its output reduced to plain numbers (long arrays to a window plus order-sensitive
// sums) and rounded to 10 significant digits. The test recomputes each output and compares it
// with the fixture, so a numeric change that the analytic tolerances of the other test files
// would let through fails here unless the ID changes too.
//
// Tolerance: |actual − stored| ≤ 1e-8·max(1, |stored|) per number. That absorbs the rounding
// to 10 digits and last-ulp differences between JavaScript engines' Math.sin/exp/log, and is
// orders of magnitude below any material change (the smallest documented effect, the 0.004 dB
// regularization bias, is 4e-3). Strings (reason texts, codes, labels) and non-finite markers
// compare exactly. Inputs are seeded (mulberry32) or closed-form; no clock, no randomness.
//
// Regenerate after an ANNOUNCED change (a new ID, or a bit-identical refactor that moved a
// value by rounding only):  OSCILLA_UPDATE_GOLDEN=1 node --test tests/unit/v3-golden.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { mulberry32 } from '../../src/js/audio/noise.js';
import { ALGORITHMS, KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { inverseSweep, renderStimulus } from '../../src/js/measurement/stimulus.js';
import { align } from '../../src/js/measurement/align.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import {
  TRANSFER_ALGORITHM, TRANSFER_ALGORITHM_V1, TRANSFER_ALGORITHM_V2, computeTransfer,
} from '../../src/js/measurement/transfer.js';
import {
  IR_ALGORITHMS_V1, IR_ALGORITHMS_V2, computeImpulseResponse, normalizeIr,
} from '../../src/js/measurement/impulse-response.js';
import { normalizeResponse, smoothResponse } from '../../src/js/measurement/smoothing.js';
import { welch, windowFn } from '../../src/js/measurement/spectrum.js';
import { bandAnalysis, bandCenters, rtaResult } from '../../src/js/measurement/rta.js';
import { aggregateResult, aggregateRuns } from '../../src/js/measurement/aggregate.js';
import {
  QUALITY_ALGORITHM_V1, QUALITY_ALGORITHM_V2, assessQuality,
} from '../../src/js/measurement/quality.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  applyFrequencyCorrection, applyFrequencyCorrectionToBands,
} from '../../src/js/calibration/interpolate.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';

const DIR = new URL('./fixtures/v3/', import.meta.url);
const UPDATE = process.env.OSCILLA_UPDATE_GOLDEN === '1';
const DIGITS = 10;
const REL_TOL = 1e-8;

// ----------------------------------------------------------------------------- inputs

const SR = 8000;
const SPEC = { kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 50, f2: 3000, level: 0.5,
  fade: 0.01 };
const STIM = renderStimulus(SPEC);
const PRE = 800;
const DELAY = 37;
const POST = 3200;

/** Seeded uniform noise in [−amp/2, amp/2). */
function noise(seed, n, amp) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() - 0.5) * amp;
  return out;
}

/** The stimulus at PRE + DELAY through a one-pole low-pass (a = 0.3) plus seeded noise. */
function capture(seed) {
  const n = PRE + STIM.samples.length + POST;
  const y = noise(seed, n, 2e-3);
  let z = 0;
  for (let i = 0; i < n; i++) {
    const j = i - PRE - DELAY;
    z += 0.3 * ((j >= 0 && j < STIM.samples.length ? STIM.samples[j] : 0) - z);
    y[i] += z;
  }
  return y;
}

const CAP = [capture(1), capture(2)];
const NOISE = noise(9, CAP[0].length, 2e-3);
// align.v1 inputs: the transfer, IR and quality fixtures predate align.v2 (V382), whose
// unbiased sub-sample lag changes their phase input, not their method.
const ALIGN_V1 = { algorithm: 'oscilla.align.xcorr.v1' };
const ALIGN = align(STIM.samples, CAP[0], SR, ALIGN_V1);
const ALIGN_V2 = align(STIM.samples, CAP[0], SR);
const BASE = { stimulus: STIM.samples, sampleRate: SR, f1: SPEC.f1, f2: SPEC.f2 };
/** Transfers of both captures under one transfer method (v1 inputs for the retained quality
 *  rule sets, which were assessed on transfer.v1 results). */
const transfersOf = (algorithm) => CAP.map((captured) => computeTransfer({ ...BASE, captured,
  noise: NOISE, alignment: align(STIM.samples, captured, SR, ALIGN_V1),
  options: { phase: true, pointsPerOctave: 6, algorithm } }));
// transfer.v2 inputs: the quality and aggregate fixtures predate transfer.v3 (V382), whose
// stricter validRange would change their input, not their method.
const TRANSFERS = transfersOf(TRANSFER_ALGORITHM_V2);
const TRANSFERS_V1 = transfersOf(TRANSFER_ALGORITHM_V1);
// ir.v2 input for the normalization case, which predates ir.v3 (V382: a longer pre-guard)
const IR = computeImpulseResponse({ ...BASE, captured: CAP[0],
  lagSamples: Math.max(0, ALIGN.lagSamples), algorithm: IR_ALGORITHMS_V2.spectral });
const IR_V3 = computeImpulseResponse({ ...BASE, captured: CAP[0],
  lagSamples: Math.max(0, ALIGN.lagSamples) });
const IR_V1 = computeImpulseResponse({ ...BASE, captured: CAP[0],
  lagSamples: Math.max(0, ALIGN.lagSamples), algorithm: IR_ALGORITHMS_V1.spectral });
const SWEEP_WINDOW = [PRE + DELAY, PRE + DELAY + STIM.samples.length];

/** A capture-check input: a clipped burst, a dropout and a step in the post-roll. */
const CHECK_SIGNAL = (() => {
  const n = 4000;
  const x = noise(5, n, 1e-3);
  for (let i = 0; i < n; i++) {
    const a = i >= 1000 && i < 1100 ? 1.2 : 0.3;
    x[i] += Math.max(-1, Math.min(1, a * Math.sin((2 * Math.PI * 200 * i) / SR)));
  }
  for (let i = 1500; i < 1700; i++) x[i] = 0;
  for (let i = 3000; i < 3100; i++) x[i] += 0.5;
  return x;
})();
const CHECK = checkCapture({ sampleRate: SR, samples: CHECK_SIGNAL });

/** Checks of the two sweep captures, the second with a step after the sweep (post-roll). */
const SWEEP_CHECKS = (() => {
  const spliced = CAP[1].slice();
  const at = SWEEP_WINDOW[1] + 1600;
  for (let i = at; i < at + 200; i++) spliced[i] += 0.05;
  return [checkCapture({ sampleRate: SR, samples: CAP[0] }),
    checkCapture({ sampleRate: SR, samples: spliced })];
})();

const GRID = Float64Array.from({ length: 49 }, (_, i) => 50 * 2 ** (i / 8));
const RESPONSE = Float64Array.from(GRID, (f, i) => 3 * Math.sin(i * 0.9) - 0.002 * i * i);
const PROFILE = createFrequencyProfile({ name: 'golden mic',
  points: [[60, 1.5], [200, 0.5], [1000, 0], [2500, -1], [3000, 2]] });
const SPECTRUM = welch(Float32Array.from(noise(21, 16384, 0.5), (v, i) => v
  + 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR)), { fftSize: 1024 });
const BANDS = bandCenters('third', 50, 3000, SR);
const RTA = bandAnalysis(SPECTRUM, SR / 1024, BANDS);

// ----------------------------------------------------------------------------- reduction

/** Order-sensitive summary of a long array plus a window of raw values. */
function summary(arr, from = 0, count = 16) {
  let sum = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let moment = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    sumAbs += Math.abs(arr[i]);
    sumSq += arr[i] * arr[i];
    moment += (i / arr.length) * arr[i];
  }
  const start = Math.max(0, Math.min(arr.length - count, from));
  return { length: arr.length, sum, sumAbs, sumSq, moment, windowStart: start,
    window: Array.from(arr.slice(start, start + count)) };
}

function irOutput(ir) {
  const out = { method: ir.method, peakIndex: ir.peakIndex, peakTimeS: ir.peakTimeS,
    captureOffsetS: ir.captureOffsetS, noiseFloorDb: ir.noiseFloorDb, fftSize: ir.fftSize,
    samples: summary(ir.samples, ir.peakIndex - 8, 32) };
  if ('noiseFloorMethod' in ir) out.noiseFloorMethod = ir.noiseFloorMethod;
  return out;
}

function transferOutput(t) {
  const out = { frequencies: t.frequencies, magnitudeDb: t.magnitudeDb, phaseDeg: t.phaseDeg,
    snrDb: t.snrDb, validRange: t.validRange, fftSize: t.fftSize, binHz: t.binHz,
    phaseReason: t.phaseReason };
  for (const k of ['snrPooledDb', 'snrResolutionHz', 'resolutionHz']) if (k in t) out[k] = t[k];
  return out;
}

function qualityOutput(q) {
  return { status: q.status, reasons: q.reasons, metrics: q.metrics,
    mask: { frequencies: Array.from(q.mask.frequencies), reliable: Array.from(q.mask.reliable),
      calibrated: Array.from(q.mask.calibrated) } };
}

function qualityInput(transfers = TRANSFERS) {
  const aggregate = aggregateRuns(transfers.map((t) => t.magnitudeDb));
  const corrected = applyFrequencyCorrection(transfers[0].magnitudeDb, transfers[0].frequencies,
    PROFILE);
  const level = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -31.25, createdAt: '2026-10-02T00:00:00.000Z' });
  return { capture: SWEEP_CHECKS, transfer: transfers[0], aggregate,
    calibration: { frequency: corrected, level }, sweepWindow: SWEEP_WINDOW };
}

const NOISE_CHECK = checkCapture({ sampleRate: SR, samples: NOISE });

// ----------------------------------------------------------------------------- cases

/** One case per algorithm ID: () → { id: the ID the output carries, output }. */
const CASES = {
  [ALGORITHMS.transfer]: () => {
    const t = computeTransfer({ ...BASE, captured: CAP[0], noise: NOISE, alignment: ALIGN,
      options: { phase: true, pointsPerOctave: 3 } });
    return { id: t.algorithm, output: transferOutput(t) };
  },
  [TRANSFER_ALGORITHM_V2]: () => {
    const t = computeTransfer({ ...BASE, captured: CAP[0], noise: NOISE, alignment: ALIGN,
      options: { phase: true, pointsPerOctave: 3, algorithm: TRANSFER_ALGORITHM_V2 } });
    return { id: t.algorithm, output: transferOutput(t) };
  },
  [TRANSFER_ALGORITHM_V1]: () => {
    const t = computeTransfer({ ...BASE, captured: CAP[0], noise: NOISE, alignment: ALIGN,
      options: { phase: true, pointsPerOctave: 3, algorithm: TRANSFER_ALGORITHM_V1 } });
    return { id: t.algorithm, output: transferOutput(t) };
  },
  [ALGORITHMS.ir]: () => ({ id: IR_V3.algorithm, output: irOutput(IR_V3) }),
  [IR_ALGORITHMS_V2.spectral]: () => ({ id: IR.algorithm, output: irOutput(IR) }),
  [IR_ALGORITHMS_V1.spectral]: () => ({ id: IR_V1.algorithm, output: irOutput(IR_V1) }),
  [ALGORITHMS.irFarina]: () => {
    const ir = computeImpulseResponse({ ...BASE, captured: CAP[0], method: 'farina-inverse',
      inverse: inverseSweep(SPEC), lagSamples: Math.max(0, ALIGN.lagSamples) });
    return { id: ir.algorithm, output: irOutput(ir) };
  },
  [IR_ALGORITHMS_V2['farina-inverse']]: () => {
    const ir = computeImpulseResponse({ ...BASE, captured: CAP[0], method: 'farina-inverse',
      inverse: inverseSweep(SPEC), lagSamples: Math.max(0, ALIGN.lagSamples),
      algorithm: IR_ALGORITHMS_V2['farina-inverse'] });
    return { id: ir.algorithm, output: irOutput(ir) };
  },
  [IR_ALGORITHMS_V1['farina-inverse']]: () => {
    const ir = computeImpulseResponse({ ...BASE, captured: CAP[0], method: 'farina-inverse',
      inverse: inverseSweep(SPEC), lagSamples: Math.max(0, ALIGN.lagSamples),
      algorithm: IR_ALGORITHMS_V1['farina-inverse'] });
    return { id: ir.algorithm, output: irOutput(ir) };
  },
  [ALGORITHMS.align]: () => ({ id: ALIGN_V2.algorithm, output: { lagSamples: ALIGN_V2.lagSamples,
    lagSeconds: ALIGN_V2.lagSeconds, peakCorrelation: ALIGN_V2.peakCorrelation,
    polarity: ALIGN_V2.polarity } }),
  'oscilla.align.xcorr.v1': () => ({ id: ALIGN.algorithm, output: { lagSamples: ALIGN.lagSamples,
    lagSeconds: ALIGN.lagSeconds, peakCorrelation: ALIGN.peakCorrelation,
    polarity: ALIGN.polarity } }),
  [ALGORITHMS.clip]: () => ({ id: CHECK.algorithms.clip, output: { clipping: CHECK.clipping,
    dropouts: CHECK.dropouts, rms: CHECK.rms, peak: CHECK.peak, empty: CHECK.empty,
    reasons: CHECK.reasons.map((r) => r.code) } }),
  [ALGORITHMS.discontinuity]: () => ({ id: CHECK.algorithms.discontinuity,
    output: { discontinuities: CHECK.discontinuities,
      sweepChecks: SWEEP_CHECKS.map((c) => c.discontinuities) } }),
  [ALGORITHMS.window]: () => {
    const w = windowFn('hann', 16);
    return { id: w.algorithm, output: { samples: w.samples, coherentGain: w.coherentGain,
      noisePowerGain: w.noisePowerGain, enbwBins: w.enbwBins,
      welch: summary(SPECTRUM.power, 50, 12) } };
  },
  [ALGORITHMS.windowBlackmanHarris]: () => {
    const w = windowFn('blackman-harris', 16);
    const p = welch(CHECK_SIGNAL, { fftSize: 512, window: 'blackman-harris' });
    return { id: w.algorithm, output: { samples: w.samples, coherentGain: w.coherentGain,
      noisePowerGain: w.noisePowerGain, enbwBins: w.enbwBins, welch: summary(p.power, 6, 12) } };
  },
  [ALGORITHMS.rta]: () => {
    const r = rtaResult({ sampleRate: SR, resolution: 'third', bands: BANDS,
      levelsDb: RTA.levelsDb, fftSize: 1024, window: 'hann' });
    return { id: r.algorithm, output: { analysis: RTA.algorithm, nominal: BANDS.map((b) =>
      b.nominal), levelsDb: r.levelsDb, binCounts: RTA.binCounts,
    underResolved: RTA.underResolved, windowAlgorithm: r.windowAlgorithm } };
  },
  [ALGORITHMS.smoothing]: () => {
    const s = smoothResponse(GRID, RESPONSE, 3);
    return { id: s.algorithm, output: { label: s.label, smoothedDb: s.smoothedDb,
      sixth: smoothResponse(GRID, RESPONSE, 6).smoothedDb } };
  },
  [ALGORITHMS.normalization]: () => {
    const at = normalizeResponse(GRID, RESPONSE, { mode: 'at-frequency', hz: 1000 });
    const band = normalizeResponse(GRID, RESPONSE, { mode: 'band-mean', lo: 200, hi: 2000 });
    const ir = normalizeIr(IR, 'peak-db');
    return { id: at.algorithm, output: { at: { referenceDb: at.referenceDb, label: at.label,
      normalizedDb: at.normalizedDb }, band: { referenceDb: band.referenceDb, label: band.label },
    ir: { algorithm: ir.algorithm, referenceValue: ir.referenceValue,
      values: summary(ir.values, IR.peakIndex - 4, 12) } } };
  },
  [ALGORITHMS.calibration]: () => {
    const c = applyFrequencyCorrection(RESPONSE, GRID, PROFILE);
    const b = applyFrequencyCorrectionToBands({ bands: BANDS, levelsDb: RTA.levelsDb }, PROFILE,
      { power: SPECTRUM, binHz: SR / 1024 });
    return { id: c.algorithm, output: { profileId: c.profileId, correctedDb: c.correctedDb,
      covered: c.covered, coverage: c.coverage, bands: { algorithm: b.algorithm,
        correctedDb: b.correctedDb, correctionDb: b.correctionDb, covered: b.covered,
        weighting: b.weighting } } };
  },
  [ALGORITHMS.aggregate]: () => {
    const runs = [0, 1, 2].map((r) => Float64Array.from(GRID, (_, i) => RESPONSE[i]
      + 0.7 * Math.sin(r * 2.1 + i * 0.37)));
    const mean = aggregateRuns(runs);
    const median = aggregateRuns(runs, { method: 'median' });
    return { id: mean.algorithm, output: { mean: aggregateResult(mean, GRID),
      median: aggregateResult(median, GRID) } };
  },
  [ALGORITHMS.quality]: () => {
    const q = assessQuality({ ...qualityInput(), chainNotes: { limiterDeviationAboveHz: 2500 },
      noiseCheck: NOISE_CHECK, stimulus: STIM.spec,
      inputProcessing: { echoCancellation: false, noiseSuppression: null,
        autoGainControl: false } });
    return { id: q.algorithm, output: qualityOutput(q) };
  },
  [QUALITY_ALGORITHM_V2]: () => {
    const q = assessQuality({ ...qualityInput(TRANSFERS_V1), algorithm: QUALITY_ALGORITHM_V2,
      chainNotes: { limiterDeviationAboveHz: 2500 } });
    return { id: q.algorithm, output: qualityOutput(q) };
  },
  [QUALITY_ALGORITHM_V1]: () => {
    const q = assessQuality({ ...qualityInput(TRANSFERS_V1), algorithm: QUALITY_ALGORITHM_V1,
      chainNotes: { limiterDeviationAboveHz: 2500 } });
    return { id: q.algorithm, output: qualityOutput(q) };
  },
};

// ----------------------------------------------------------------------------- compare

/** Plain JSON: typed arrays to arrays, numbers to 10 significant digits, non-finite marked. */
function plain(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nonFinite: String(v) };
    const r = Number(v.toPrecision(DIGITS));
    return Object.is(r, -0) ? 0 : r;
  }
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v, plain);
  const out = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = plain(v[k]);
  return out;
}

function compare(actual, expected, path, errors) {
  if (errors.length >= 10) return;
  if (typeof expected === 'number') {
    const ok = typeof actual === 'number'
      && Math.abs(actual - expected) <= REL_TOL * Math.max(1, Math.abs(expected));
    if (!ok) errors.push(`${path}: ${actual} ≠ ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    if (actual !== expected) errors.push(`${path}: ${JSON.stringify(actual)} ≠ `
      + `${JSON.stringify(expected)}`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      errors.push(`${path}: length ${actual && actual.length} ≠ ${expected.length}`);
      return;
    }
    expected.forEach((e, i) => compare(actual[i], e, `${path}[${i}]`, errors));
    return;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    errors.push(`${path}: not an object`);
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) {
    if (!(k in expected) || !(k in actual)) errors.push(`${path}.${k}: present on one side only`);
    else compare(actual[k], expected[k], `${path}.${k}`, errors);
  }
}

const fixtureUrl = (id) => new URL(`${id}.json`, DIR);

/** Indented JSON with every array of scalars on one line (small, diffable fixtures). */
function compactJson(v) {
  return JSON.stringify(v, null, 1)
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (m, inner) => `[${inner.split(/,\s+/).join(', ')}]`);
}

test('golden: every known algorithm ID has a case and a fixture', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...KNOWN_ALGORITHM_IDS].sort());
  if (UPDATE) return;
  for (const id of KNOWN_ALGORITHM_IDS) {
    assert.ok(existsSync(fixtureUrl(id)), `missing fixture ${id}.json (generate it with `
      + 'OSCILLA_UPDATE_GOLDEN=1 after announcing the ID)');
  }
});

for (const id of KNOWN_ALGORITHM_IDS) {
  test(`golden: ${id} reproduces its stored output`, () => {
    const { id: stamped, output } = CASES[id]();
    assert.equal(stamped, id, 'the output carries the ID it is filed under');
    const actual = plain(output);
    if (UPDATE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(fixtureUrl(id), `${compactJson({ id, digits: DIGITS, output: actual })}\n`);
      return;
    }
    const stored = JSON.parse(readFileSync(fixtureUrl(id), 'utf8'));
    assert.equal(stored.id, id);
    const errors = [];
    compare(actual, stored.output, 'output', errors);
    assert.deepEqual(errors, [], `${id} changed without a new ID:\n${errors.join('\n')}`);
  });
}

test('golden: the comparison catches a change inside the analytic tolerances', () => {
  // A 0.001 dB shift — far inside the ±0.1 dB transfer tolerance of v3-transfer-ir — fails.
  const { output } = CASES[ALGORITHMS.transfer]();
  const stored = plain(output);
  const shifted = plain({ ...output,
    magnitudeDb: Float64Array.from(output.magnitudeDb, (v) => v + 0.001) });
  const errors = [];
  compare(shifted, stored, 'output', errors);
  assert.ok(errors.length > 0);
  const same = [];
  compare(plain(output), stored, 'output', same);
  assert.deepEqual(same, []);
});
