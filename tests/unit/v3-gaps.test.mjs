// V3 pure-module gaps closed after the integration fixes (docs/v3/algorithms.md "Gaps"):
//   G15  quality rule set oscilla.confidence.v2 reads DISCONTINUITY (v1 retained, reproducible)
//   G12  output-chain notes ({ limiterDeviationAboveHz }) mark the bins above them unreliable
//   G16  the stored form of a repeated-run aggregate (results.aggregate)
//   G17  the 0.5 phase threshold against alignment correlation and SNR (documented relation)
//   G19  transfer CSV columns are ratios; absolute level only in level/RTA outputs
//   perf computeTransferAndIr: one deconvolution for transfer and IR, bit-identical outputs
// All inputs are seeded (mulberry32) or closed-form; every assertion is exact unless a
// tolerance is derived next to it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../../src/js/audio/noise.js';
import {
  ALGORITHMS, KNOWN_ALGORITHM_IDS, RETAINED_ALGORITHMS, isKnownAlgorithm,
} from '../../src/js/measurement/algorithms.js';
import { inverseSweep, renderStimulus } from '../../src/js/measurement/stimulus.js';
import { checkCapture } from '../../src/js/measurement/capture-checks.js';
import { align } from '../../src/js/measurement/align.js';
import {
  PHASE_REASONS, ZERO_POWER_DB, computeTransfer, fftPlan, nextPowerOfTwo, noiseSpectrum,
} from '../../src/js/measurement/transfer.js';
import {
  computeImpulseResponse, computeTransferAndIr,
} from '../../src/js/measurement/impulse-response.js';
import {
  AGGREGATE_ALGORITHM, aggregateResult, aggregateRuns,
} from '../../src/js/measurement/aggregate.js';
import {
  INVALIDATING_CODES, QUALITY_ALGORITHM, QUALITY_ALGORITHM_V1, QUALITY_ALGORITHM_V2,
  QUALITY_RULESETS,
  QUALITY_THRESHOLDS, REASON_CODES, assessQuality, normalizeChainNotes, summarizeQuality,
} from '../../src/js/measurement/quality.js';
import { bandCenters, rtaResult } from '../../src/js/measurement/rta.js';
import { createMeasurementEngine, assessMeasurement } from '../../src/js/measurement/engine.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import {
  createExperiment, createRecipe, experimentToJson, formatErrors, withResults,
} from '../../src/js/experiments/schema.js';
import { resultCanonical, resultHash, withResultHash } from '../../src/js/experiments/hash.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import {
  AGGREGATE_COLUMNS, aggregateCsv, csvMeta, rtaCsv, transferCsv,
} from '../../src/js/experiments/csv.js';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const NOW = '2026-10-02T10:00:00.000Z';

// ----------------------------------------------------------------------------- fixtures

const SR = 8000;
const SPEC = { kind: 'log-sweep', sampleRate: SR, duration: 1, f1: 50, f2: 3000, level: 0.5,
  fade: 0.01 };
const STIM = renderStimulus(SPEC);
const N = STIM.samples.length;
const PRE = 2000;
const POST = 4000;
const LEN = PRE + N + POST;
const WINDOW = [PRE, PRE + N];

function uniform(seed, n, amp) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() - 0.5) * amp;
  return out;
}

/** Gain 0.5 at PRE (no delay) plus seeded noise; `steps` add +height over [at, at + len). */
function sweepCapture(seed, steps = []) {
  const y = uniform(seed, LEN, 2e-3);
  for (let i = 0; i < N; i++) y[PRE + i] += 0.5 * STIM.samples[i];
  for (const { at, len, height } of steps) for (let i = at; i < at + len; i++) y[i] += height;
  return y;
}

const NOISE = uniform(99, LEN, 2e-3);
const transferOf = (captured) => computeTransfer({ stimulus: STIM.samples, captured,
  sampleRate: SR, f1: SPEC.f1, f2: SPEC.f2, noise: NOISE, options: { pointsPerOctave: 12 } });
const CLEAN = [sweepCapture(1), sweepCapture(2)];
const CLEAN_T = CLEAN.map(transferOf);
const AGG = aggregateRuns(CLEAN_T.map((t) => t.magnitudeDb));
const check = (samples) => checkCapture({ sampleRate: SR, samples });
// At 0.1 s the sweep is at ≈ 75 Hz: its own step per sample is ≈ 0.012, so a 0.2 step is
// ≈ 19× the local slope (DISCONTINUITY_RATIO is 8) and is found at both edges.
const INSIDE = [{ at: PRE + 800, len: 200, height: 0.2 }];
const OUTSIDE = [{ at: PRE + N + 2000, len: 200, height: 0.05 }];
const codes = (q) => q.reasons.map((r) => r.code);
const reason = (q, code) => q.reasons.find((r) => r.code === code);
const assess = (captures, extra = {}) => assessQuality({ capture: captures.map(check),
  transfer: CLEAN_T[0], aggregate: AGG, sweepWindow: WINDOW, ...extra });

// ----------------------------------------------------------------------------- G15

test('G15: confidence.v3 is the default; v1 and v2 are retained and still selectable', () => {
  assert.equal(QUALITY_ALGORITHM, 'oscilla.confidence.v3');
  assert.equal(ALGORITHMS.quality, QUALITY_ALGORITHM);
  assert.deepEqual(RETAINED_ALGORITHMS.quality, [QUALITY_ALGORITHM_V1, QUALITY_ALGORITHM_V2]);
  assert.ok(isKnownAlgorithm(QUALITY_ALGORITHM_V1) && isKnownAlgorithm(QUALITY_ALGORITHM_V2));
  assert.deepEqual(Object.keys(QUALITY_RULESETS).sort(),
    [QUALITY_ALGORITHM_V1, QUALITY_ALGORITHM_V2, QUALITY_ALGORITHM].sort());
  const v1 = QUALITY_RULESETS[QUALITY_ALGORITHM_V1];
  const v2 = QUALITY_RULESETS[QUALITY_ALGORITHM_V2];
  const v3 = QUALITY_RULESETS[QUALITY_ALGORITHM];
  assert.ok(Object.isFrozen(v1) && Object.isFrozen(v2) && Object.isFrozen(v2.reasonCodes));
  assert.ok(Object.isFrozen(v3) && Object.isFrozen(v3.reasonCodes));
  assert.equal(v1.thresholds, QUALITY_THRESHOLDS, 'thresholds unchanged by v2');
  assert.equal(v2.thresholds, QUALITY_THRESHOLDS);
  assert.equal(v3.thresholds, QUALITY_THRESHOLDS);
  // v2 = v1 + four codes, nothing else changed.
  const added = Object.keys(v2.reasonCodes).filter((c) => !(c in v1.reasonCodes));
  assert.deepEqual(added.sort(), ['DISCONTINUITY', 'DISCONTINUITY_IN_SWEEP',
    'DISCONTINUITY_NOT_MEASURED', 'OUTPUT_CHAIN_DEVIATION']);
  for (const c of Object.keys(v1.reasonCodes)) {
    assert.deepEqual(v2.reasonCodes[c], v1.reasonCodes[c]);
  }
  // v3 = v2 + four codes (review B1/M1/M2/NIT), none invalidating.
  const added3 = Object.keys(v3.reasonCodes).filter((c) => !(c in v2.reasonCodes));
  assert.deepEqual(added3.sort(), ['CLIPPING_NOT_EXCLUDED', 'INPUT_PROCESSING',
    'INPUT_PROCESSING_NOT_CONFIRMED', 'SNR_NOT_ASSESSED']);
  for (const c of Object.keys(v2.reasonCodes)) {
    assert.deepEqual(v3.reasonCodes[c], v2.reasonCodes[c]);
  }
  assert.equal(REASON_CODES, v3.reasonCodes);
  assert.deepEqual([...INVALIDATING_CODES], [...v1.invalidatingCodes, 'DISCONTINUITY_IN_SWEEP']);
  assert.deepEqual([...v3.invalidatingCodes], [...v2.invalidatingCodes]);
  assert.equal(v2.reasonCodes.DISCONTINUITY_NOT_MEASURED.notMeasured, true);
  assert.equal(v2.reasonCodes.OUTPUT_CHAIN_DEVIATION.dimension, 'range');
  for (const bad of ['oscilla.confidence.v4', '__proto__', 'toString', null]) {
    assert.throws(() => assess(CLEAN, { algorithm: bad }), RangeError, String(bad));
  }
});

test('G15: a discontinuity inside the sweep window invalidates under v2, not under v1', () => {
  const spliced = sweepCapture(1, INSIDE);
  const c = check(spliced);
  assert.deepEqual(c.discontinuities.map((d) => [d.start, d.end]),
    [[PRE + 799, PRE + 801], [PRE + 999, PRE + 1001]], 'both edges found by checkCapture');
  const q2 = assess([spliced, CLEAN[1]], { algorithm: QUALITY_ALGORITHM_V2 });
  assert.equal(q2.algorithm, 'oscilla.confidence.v2');
  assert.equal(q2.status, 'INVALID');
  const q3 = assess([spliced, CLEAN[1]]);
  assert.equal(q3.algorithm, 'oscilla.confidence.v3');
  assert.equal(q3.status, 'INVALID', 'v3 keeps the v2 discontinuity rule');
  const r = reason(q2, 'DISCONTINUITY_IN_SWEEP');
  assert.equal(r.severity, 'fail');
  assert.equal(r.value, 2);
  assert.equal(r.unit, 'discontinuities');
  assert.equal(r.text, 'sample discontinuity: 2 discontinuities inside the sweep window in run 1 '
    + "of 2 (largest step 0.21 of full scale): the samples there are not the system's response");
  assert.ok(q2.mask.reliable.every((v) => v === 0), 'INVALID: nothing drawn as reliable');
  assert.equal(q2.metrics.discontinuities, 2);
  const q1 = assess([spliced, CLEAN[1]], { algorithm: QUALITY_ALGORITHM_V1 });
  assert.equal(q1.algorithm, QUALITY_ALGORITHM_V1);
  assert.notEqual(q1.status, 'INVALID', 'v1 does not read discontinuities');
  assert.ok(codes(q1).every((x) => !x.startsWith('DISCONTINUITY')));
  assert.ok(!('discontinuities' in q1.metrics) && !('outputChainLimitHz' in q1.metrics));
});

test('G15: outside the window warns; without a window it counts as inside; none is ok', () => {
  const late = sweepCapture(1, OUTSIDE);
  const out = assess([late, CLEAN[1]]);
  assert.notEqual(out.status, 'INVALID');
  const w = reason(out, 'DISCONTINUITY');
  assert.deepEqual([w.severity, w.value, w.text], ['warn', 2,
    '2 discontinuities outside the sweep window']);
  assert.equal(out.metrics.discontinuities, 2);
  const noWindow = assess([late, CLEAN[1]], { sweepWindow: null });
  assert.equal(noWindow.status, 'INVALID');
  assert.match(reason(noWindow, 'DISCONTINUITY_IN_SWEEP').text, /no sweep window given/);
  // Per-run windows: the window of run 1 decides for run 1.
  const perRun = assess([late, CLEAN[1]], { sweepWindow: [[PRE, LEN], WINDOW] });
  assert.equal(perRun.status, 'INVALID');
  const clean = assess(CLEAN, { algorithm: QUALITY_ALGORITHM_V2 });
  const ok = reason(clean, 'DISCONTINUITY');
  assert.deepEqual([ok.severity, ok.value, ok.text], ['ok', 0, 'no discontinuities']);
  assert.equal(clean.metrics.discontinuities, 0);
  assert.equal(clean.status, 'GOOD', summarizeQuality(clean));
  assert.deepEqual(reason(assess(CLEAN), 'DISCONTINUITY'), ok, 'v3: the same rule');
  // v1 on the clean input reaches the same status with the same non-discontinuity reasons.
  const v1 = assess(CLEAN, { algorithm: QUALITY_ALGORITHM_V1 });
  assert.equal(v1.status, clean.status);
  assert.deepEqual(v1.reasons, clean.reasons.filter((x) => x.code !== 'DISCONTINUITY'));
});

test('G15: a capture check without a discontinuity list is NOT MEASURED (caps at USABLE)', () => {
  const [a, b] = CLEAN.map(check);
  const { discontinuities, ...old } = a; // a check result from before oscilla.discontinuity.v1
  assert.ok(Array.isArray(discontinuities));
  const q = assessQuality({ capture: [old, b], transfer: CLEAN_T[0], aggregate: AGG,
    sweepWindow: WINDOW });
  const r = reason(q, 'DISCONTINUITY_NOT_MEASURED');
  assert.deepEqual([r.severity, r.value, r.unit], ['warn', 1, 'runs']);
  assert.match(r.text, /^discontinuities not checked in run 1 of 2/);
  assert.equal(q.status, 'USABLE');
  assert.equal(q.metrics.discontinuities, 0, 'run 2 was measured');
  const none = assessQuality({ capture: old, transfer: CLEAN_T[0], aggregate: AGG });
  assert.equal(none.metrics.discontinuities, null);
});

// ----------------------------------------------------------------------------- G12 chain notes

test('chain notes: bins above the limiter deviation are unreliable, with a reason', () => {
  const base = assess(CLEAN);
  assert.equal(base.metrics.outputChainLimitHz, null);
  assert.ok(!codes(base).includes('OUTPUT_CHAIN_DEVIATION'), 'no note, no reason');
  const q = assess(CLEAN, { chainNotes: { limiterDeviationAboveHz: 2000 } });
  const f = q.mask.frequencies;
  const first = f.findIndex((x) => x > 2000);
  assert.ok(first > 0);
  for (let i = 0; i < f.length; i++) {
    assert.equal(q.mask.reliable[i], f[i] > 2000 ? 0 : base.mask.reliable[i], `${f[i]} Hz`);
  }
  const r = reason(q, 'OUTPUT_CHAIN_DEVIATION');
  assert.deepEqual([r.severity, r.value, r.unit, r.scope], ['warn', 2000, 'Hz', 'quality']);
  assert.deepEqual(r.range, [f[first], f[f.length - 1]]);
  assert.match(r.text,
    /^output chain deviates above 2\.0 kHz in this browser: 2\.0 kHz-2\.9 kHz marked unreliable$/);
  assert.equal(q.metrics.outputChainLimitHz, 2000);
  assert.equal(q.metrics.reliableRanges.at(-1)[1], f[first - 1]);
  assert.equal(q.status, 'USABLE', 'one measured warn in one dimension');
  // The exact wording for the Firefox case of the spike (18 kHz).
  assert.equal(normalizeChainNotes({ limiterDeviationAboveHz: 18000 }).limiterDeviationAboveHz,
    18000);
  // Above the measured range: an 'ok' reason with the number.
  const above = assess(CLEAN, { chainNotes: { limiterDeviationAboveHz: 18000 } });
  const ok = reason(above, 'OUTPUT_CHAIN_DEVIATION');
  assert.deepEqual([ok.severity, ok.value, ok.text], ['ok', 18000,
    'output chain deviates above 18 kHz in this browser, outside the measured range']);
  assert.deepEqual(above.mask.reliable, base.mask.reliable);
  // RTA-only: judged against the requested range.
  const rta = assessQuality({ capture: check(CLEAN[0]), requestedRange: [25, 20000],
    resolutionHz: 5.86, chainNotes: { limiterDeviationAboveHz: 18000 } });
  const rr = reason(rta, 'OUTPUT_CHAIN_DEVIATION');
  assert.equal(rr.severity, 'warn');
  assert.deepEqual(rr.range, [18000, 20000]);
  assert.match(rr.text, /^output chain deviates above 18 kHz in this browser: the requested /);
  // v1 ignores notes (its rule set has no such input).
  const v1 = assess(CLEAN, { algorithm: QUALITY_ALGORITHM_V1,
    chainNotes: { limiterDeviationAboveHz: 2000 } });
  assert.deepEqual(v1, assess(CLEAN, { algorithm: QUALITY_ALGORITHM_V1 }));
});

test('chain notes: strictly validated pure data', () => {
  assert.equal(normalizeChainNotes(null), null);
  assert.equal(normalizeChainNotes(undefined), null);
  assert.equal(normalizeChainNotes({}), null);
  assert.equal(normalizeChainNotes({ limiterDeviationAboveHz: null }), null);
  const n = normalizeChainNotes({ limiterDeviationAboveHz: 18000 });
  assert.ok(Object.isFrozen(n));
  for (const bad of [{ limiterDeviationAboveHz: -1 }, { limiterDeviationAboveHz: '18000' },
    { limiterDeviationAboveHz: Infinity }, { limiterDeviationAboveHz: 0 },
    { limiterDeviationAbove: 18000 }]) {
    assert.throws(() => normalizeChainNotes(bad), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => normalizeChainNotes('firefox'), TypeError);
  assert.throws(() => normalizeChainNotes([18000]), TypeError);
  assert.throws(() => assess(CLEAN, { chainNotes: { browser: 'firefox' } }), RangeError);
});

// ----------------------------------------------------------------------------- G16 aggregate

const GRID = CLEAN_T[0].frequencies;
const THREE = [1, 2, 3].map((s) => transferOf(sweepCapture(s)));
const AGG3 = aggregateRuns(THREE.map((t) => t.magnitudeDb));
const STORED = aggregateResult(AGG3, GRID);

function aggregateExperiment(aggregate = STORED, transfer = null) {
  const created = createExperiment({
    recipe: createRecipe({ stimulus: STIM.spec, repeats: 3 }), now: NOW, id: 'agg-1',
    sampleRate: SR, algorithms: { aggregate: AGGREGATE_ALGORITHM, transfer: ALGORITHMS.transfer },
  });
  const e = withResults(created, { results: { transfer, aggregate } });
  return withResultHash(e, resultHash(e));
}

test('G16: aggregateResult is the stored form of aggregateRuns, on its grid', () => {
  assert.equal(AGGREGATE_ALGORITHM, 'oscilla.aggregate.v1');
  assert.equal(AGG3.algorithm, AGGREGATE_ALGORITHM);
  assert.deepEqual(Object.keys(STORED), ['algorithm', 'method', 'dispersion', 'runs',
    'frequencies', 'centreDb', 'lowerDb', 'upperDb', 'spreadDb', 'repeatabilityDb']);
  assert.deepEqual([STORED.method, STORED.dispersion, STORED.runs], ['mean', 'std', 3]);
  assert.deepEqual(STORED.frequencies, Float64Array.from(GRID));
  assert.notEqual(STORED.frequencies, GRID, 'copied');
  for (const k of ['centreDb', 'lowerDb', 'upperDb', 'spreadDb']) {
    assert.deepEqual(STORED[k], AGG3[k], k);
    assert.notEqual(STORED[k], AGG3[k]);
  }
  assert.equal(STORED.repeatabilityDb, AGG3.repeatabilityDb);
  // Zero power is stored as ZERO_POWER_DB; an undefined spread cannot be stored.
  const z = aggregateResult(aggregateRuns([Float64Array.of(-Infinity, 0)],
    { method: 'median' }), [100, 200]);
  assert.deepEqual([...z.centreDb], [ZERO_POWER_DB, 0]);
  assert.deepEqual([z.lowerDb, z.upperDb, z.spreadDb, z.dispersion, z.repeatabilityDb],
    [null, null, null, null, null], 'one run: no envelope');
  const med = aggregateResult(aggregateRuns([Float64Array.of(-Infinity, 1),
    Float64Array.of(1, 2), Float64Array.of(2, 4)], { method: 'median' }), [100, 200]);
  assert.deepEqual([med.centreDb[0], med.lowerDb[0], med.spreadDb[0]], [1, ZERO_POWER_DB, 1],
    'a −Infinity percentile is stored as ZERO_POWER_DB');
  assert.throws(() => aggregateResult(aggregateRuns([Float64Array.of(-Infinity),
    Float64Array.of(0)]), [100]), /spreadDb\[0\] is NaN/);
  assert.throws(() => aggregateResult(AGG3, GRID.slice(1)), RangeError);
  assert.throws(() => aggregateResult(AGG3, Float64Array.from(GRID).reverse()), RangeError);
  assert.throws(() => aggregateResult({ runs: 2 }, GRID), TypeError);
  // quality.js reads the stored form like the in-memory one.
  const a = assessQuality({ capture: THREE.map(() => check(CLEAN[0])), transfer: THREE[0],
    aggregate: AGG3 });
  const b = assessQuality({ capture: THREE.map(() => check(CLEAN[0])), transfer: THREE[0],
    aggregate: STORED });
  assert.deepEqual(b, a);
});

test('G16: results.aggregate validates, hashes, round-trips and exports as CSV', () => {
  const e = aggregateExperiment();
  const json = experimentToJson(e);
  const v = validateExperiment(json, OPTS);
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.deepStrictEqual(v.experiment, e);
  assert.equal(experimentToJson(v.experiment), json, 'byte-identical re-export');
  assert.match(resultCanonical(e), /"aggregate":\{"algorithm":"oscilla\.aggregate\.v1"/);
  // The hash covers the aggregate: one flipped digit is corrupt.
  const doc = JSON.parse(json);
  const data = doc.results.aggregate.spreadDb.data;
  doc.results.aggregate.spreadDb.data = data.slice(0, 3) + (data[3] === 'A' ? 'B' : 'A')
    + data.slice(4);
  const bad = validateExperiment(JSON.stringify(doc), OPTS);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((x) => x.code === 'corrupt'), JSON.stringify(bad.errors));
  // Absent aggregate: the results block and its hash are exactly as before G16.
  const plain = createExperiment({ recipe: createRecipe({ stimulus: STIM.spec }), now: NOW,
    id: 'plain-1' });
  assert.deepEqual(Object.keys(plain.results), ['transfer', 'ir', 'rta']);
  assert.equal(resultCanonical(plain, { version: 1 }),
    '{"results":{"ir":null,"rta":null,"transfer":null},"v":1}');
  const nul = withResults(plain, { results: { aggregate: null } });
  assert.ok(validateExperiment(experimentToJson(nul), OPTS).ok);
  // CSV.
  const csv = aggregateCsv(STORED, csvMeta(e)).split('\n');
  assert.equal(csv[0], '# OSCILLA aggregate of 3 runs (mean)');
  assert.equal(csv[4], '# algorithm: oscilla.aggregate.v1');
  assert.ok(csv.includes(`# repeatability_db: ${STORED.repeatabilityDb}`));
  assert.ok(csv.includes(AGGREGATE_COLUMNS.join(',')));
  assert.ok(csv.includes('# column lower_db_relative: dB re unity digital transfer '
    + '(capture/stimulus ratio), lower bound: centre ∓ standard deviation of the runs (dB)'));
  const row = csv[csv.indexOf(AGGREGATE_COLUMNS.join(',')) + 1].split(',').map(Number);
  assert.deepEqual(row, [STORED.frequencies[0], STORED.centreDb[0], STORED.lowerDb[0],
    STORED.upperDb[0], STORED.spreadDb[0]]);
  assert.doesNotMatch(csv.join('\n'), /SPL/);
  const one = aggregateCsv(aggregateResult(aggregateRuns([THREE[0].magnitudeDb]), GRID), {});
  assert.match(one, /# column lower_db_relative: empty \(one run, no envelope\)/);
  assert.match(one, /\n50,[^,]+,,,\n/);
});

test('G16: malformed aggregates are rejected with paths', () => {
  const doc = () => JSON.parse(experimentToJson(aggregateExperiment()));
  const cases = [
    ['results.aggregate.dispersion', (d) => { d.results.aggregate.dispersion = 'p10-p90'; }],
    ['results.aggregate.method', (d) => { d.results.aggregate.method = 'trimmed'; }],
    ['results.aggregate.runs', (d) => { d.results.aggregate.runs = 0; }],
    ['results.aggregate.extra', (d) => { d.results.aggregate.extra = 1; }],
    ['results.aggregate.lowerDb', (d) => { d.results.aggregate.lowerDb = [1, 2]; }],
    ['results.aggregate.repeatabilityDb', (d) => { d.results.aggregate.repeatabilityDb = -1; }],
    ['results.aggregate.lowerDb', (d) => { d.results.aggregate.runs = 1;
      d.results.aggregate.dispersion = null; }],
  ];
  for (const [path, mutate] of cases) {
    const d = doc();
    mutate(d);
    d.provenance.resultHash = null;
    const v = validateExperiment(d, OPTS);
    assert.equal(v.ok, false, path);
    assert.ok(v.errors.some((x) => x.path === path), `${path}: ${JSON.stringify(v.errors)}`);
  }
  // Envelope order: centre outside [lower, upper].
  const swapped = { ...STORED, lowerDb: STORED.upperDb, upperDb: STORED.lowerDb };
  const e = withResults(aggregateExperiment(), { results: { aggregate: swapped } });
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => /^results\.aggregate\.centreDb\[\d+\]$/.test(x.path)));
});

// ----------------------------------------------------------------------------- G19 CSV

test('G19: absolute level only in level/RTA outputs under a valid level calibration', () => {
  const bands = bandCenters('octave', 125, 2000, 48000);
  const rta = rtaResult({ sampleRate: 48000, resolution: 'octave', bands,
    levelsDb: Float64Array.from(bands, (_, i) => (i === 0 ? -Infinity : -40 + i)) });
  const level = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30.5, createdAt: '2026-10-02T09:00:00.000Z' });
  const meta = (cal) => ({ oscillaVersion: '9.8.7', experimentId: 'x', sampleRate: 48000,
    calibration: cal });
  const uncal = rtaCsv(rta, meta({ frequency: null, level: null }));
  assert.doesNotMatch(uncal, /SPL|level_db_spl/);
  const cal = rtaCsv(rta, meta({ frequency: null, level })).split('\n');
  assert.ok(cal.includes('# column level_db_spl: dB SPL (CALIBRATED: level_db_relative + 124.5 '
    + 'dB level calibration offset)'));
  assert.ok(cal.includes('band_nominal_hz,band_lo_hz,band_hi_hz,level_db_relative,level_db_spl'));
  const rows = cal.slice(cal.indexOf('band_nominal_hz,band_lo_hz,band_hi_hz,level_db_relative,'
    + 'level_db_spl') + 1, -1).map((r) => r.split(','));
  assert.deepEqual(rows[0].slice(3), ['-300', ''], 'zero power has no SPL');
  assert.deepEqual(rows[1].slice(3), ['-39', String(-39 + 124.5)]);
  // Frequency-corrected band levels: their own column. V382: the level offset already holds the
  // input's deviation at the reference frequency (X is read uncorrected), so the SPL column
  // follows the corrected levels only with the profile itself, whose correction at 1 kHz is
  // taken out of the offset; with only { id, name } it follows the uncorrected levels.
  const profileRef = { id: 'b'.repeat(64), name: 'mic' };
  const corrected = Float64Array.from(rta.levelsDb, (v) => v - 1);
  const both = rtaCsv(rta, meta({ frequency: profileRef, level }), { correctedDb: corrected })
    .split('\n');
  assert.ok(both.includes('band_nominal_hz,band_lo_hz,band_hi_hz,level_db_relative,'
    + 'level_db_corrected,level_db_spl'));
  assert.ok(both.some((l) => l.startsWith('# column level_db_spl: dB SPL (CALIBRATED: '
    + 'level_db_relative + 124.5')));
  const b1 = bands[1];
  assert.ok(both.includes(`${b1.nominal},${b1.lo},${b1.hi},-39,-40,${-39 + 124.5}`));
  // a flat +1 dB deviation profile: corrected = relative − 1, SPL = corrected + (124.5 + 1)
  const profile = createFrequencyProfile({ name: 'mic', points: [[20, 1], [20000, 1]],
    convention: 'deviation' });
  const full = rtaCsv(rta, meta({ frequency: profile, level }), { correctedDb: corrected })
    .split('\n');
  assert.ok(full.some((l) => l.startsWith('# column level_db_spl: dB SPL (CALIBRATED: '
    + 'level_db_corrected + 125.5')));
  assert.ok(full.includes(`${b1.nominal},${b1.lo},${b1.hi},-39,-40,${-40 + 125.5}`));
  assert.throws(() => rtaCsv(rta, meta({ frequency: null, level }), { correctedDb: corrected }),
    /no frequency calibration/);
  // Tampered level calibration: no SPL column, no "SPL" anywhere.
  const tampered = rtaCsv(rta, meta({ frequency: null, level: { ...level, offsetDb: 1 } }));
  assert.doesNotMatch(tampered, /SPL/);
  // The transfer CSV never says SPL, with or without a level calibration.
  const t = transferCsv(CLEAN_T[0], meta({ frequency: profileRef, level }),
    { correctedDb: CLEAN_T[0].magnitudeDb });
  const columns = t.split('\n')
    .filter((l) => l.startsWith('# column ') || /^frequency_hz,/.test(l));
  assert.ok(columns.every((l) => !/SPL/.test(l)), columns.join('\n'));
  assert.ok(columns.includes('frequency_hz,magnitude_db_relative,magnitude_db_corrected,snr_db,'
    + 'reliable,phase_deg'));
});

// ----------------------------------------------------------------------------- G17

test('G17: ρ = 1/√(1 + 1/SNR) for a flat system; ρ < 0.5 also flags heavy band-limiting', () => {
  // 1 s, 48 kHz, 20 Hz-20 kHz sweep; white Gaussian noise at a broadband SNR s over the sweep
  // window. Then Σcap² = (1 + 1/s)·Σsig² and the correlation peak is Σsig², so
  // ρ = 1/√(1 + 1/s): ρ = 0.5 ⇔ s = 1/3 (−4.77 dB). Tolerance ±0.01 covers the noise
  // realization (the noise-energy estimate over 48 000 samples scatters by √(2/48000) ≈ 0.6 %).
  const sr = 48000;
  const st = renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: 1, f1: 20, f2: 20000,
    level: 0.5 });
  const x = st.samples;
  let ms = 0;
  for (const v of x) ms += v * v;
  ms /= x.length;
  const pre = 4800;
  const y0 = new Float64Array(pre + x.length + 4800);
  for (let i = 0; i < x.length; i++) y0[pre + i] = x[i];
  const rng = mulberry32(17);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12)))
    * Math.cos(2 * Math.PI * rng());
  for (const snrDb of [0, -4.77, -10]) {
    const sigma = Math.sqrt(ms / 10 ** (snrDb / 10));
    const y = Float32Array.from(y0, (v) => v + sigma * gauss());
    const a = align(x, y, sr, { maxLagS: 0.2 });
    const predicted = 1 / Math.sqrt(1 + 10 ** (-snrDb / 10));
    assert.ok(Math.abs(a.peakCorrelation - predicted) < 0.01,
      `${snrDb} dB: ρ ${a.peakCorrelation} vs ${predicted}`);
    assert.ok(Math.abs(a.lagSamples - pre) < 0.05, `${snrDb} dB: lag still accurate`);
  }
  // Noise-free 2nd-order low-pass at 50 Hz: ρ < 0.5 from spectral mismatch alone, so the
  // phase is withheld (ALIGNMENT_NOT_ROBUST) although nothing is noisy.
  const w = (2 * Math.PI * 50) / sr;
  const al = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const b = [(1 - c) / 2 / (1 + al), (1 - c) / (1 + al), (1 - c) / 2 / (1 + al)];
  const a1 = (-2 * c) / (1 + al);
  const a2 = (1 - al) / (1 + al);
  const lp = new Float32Array(y0.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < y0.length; i++) {
    const v = b[0] * y0[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = y0[i]; y2 = y1; y1 = v; lp[i] = v;
  }
  const aLp = align(x, lp, sr, { maxLagS: 0.2 });
  assert.ok(aLp.peakCorrelation < 0.5, `ρ ${aLp.peakCorrelation}`);
  const t = computeTransfer({ stimulus: x, captured: lp, sampleRate: sr, f1: 20, f2: 20000,
    alignment: aLp, options: { phase: true, pointsPerOctave: 6 } });
  assert.equal(t.phaseDeg, null);
  assert.equal(t.phaseReason, PHASE_REASONS.ALIGNMENT_NOT_ROBUST);
});

// ----------------------------------------------------------------------------- performance

const fields = (o, skip) => Object.fromEntries(Object.entries(o)
  .filter(([k]) => !skip.includes(k)));
function assertSameArrays(a, b, keys, label) {
  for (const k of keys) {
    if (a[k] === null || b[k] === null) {
      assert.equal(a[k], b[k], `${label}.${k}`);
      continue;
    }
    assert.equal(a[k].constructor, b[k].constructor, `${label}.${k} type`);
    assert.equal(a[k].length, b[k].length, `${label}.${k} length`);
    for (let i = 0; i < a[k].length; i++) {
      if (!Object.is(a[k][i], b[k][i])) assert.fail(`${label}.${k}[${i}]: ${a[k][i]} ≠ ${b[k][i]}`);
    }
  }
}
const TARR = ['frequencies', 'magnitudeDb', 'phaseDeg', 'snrDb'];

test('computeTransferAndIr: one deconvolution, bit-identical to the separate functions', () => {
  const captured = sweepCapture(4);
  const alignment = align(STIM.samples, captured, SR);
  const base = { stimulus: STIM.samples, captured, sampleRate: SR, f1: SPEC.f1, f2: SPEC.f2 };
  const irLag = Math.max(0, alignment.lagSamples);
  const variants = [
    { transfer: { alignment, noise: NOISE, options: { phase: true } }, ir: { lagSamples: irLag } },
    { transfer: {}, ir: {} },
    { transfer: { lagSamples: 100, alignment, options: { pointsPerOctave: 24, phase: true } },
      ir: { lagSamples: 100 } },
    { transfer: { noise: NOISE.subarray(0, 3000) }, ir: { method: 'farina-inverse',
      inverse: inverseSweep(SPEC), lagSamples: irLag } },
  ];
  for (const [k, v] of variants.entries()) {
    const t = computeTransfer({ ...base, ...v.transfer });
    const ir = computeImpulseResponse({ ...base, ...v.ir });
    const both = computeTransferAndIr({ ...base, ...v.transfer, irLagSamples: v.ir.lagSamples,
      method: v.ir.method, inverse: v.ir.inverse });
    assertSameArrays(both.transfer, t, TARR, `variant ${k} transfer`);
    assert.deepStrictEqual(fields(both.transfer, TARR), fields(t, TARR), `variant ${k}`);
    assertSameArrays(both.ir, ir, ['samples'], `variant ${k} ir`);
    assert.deepStrictEqual(fields(both.ir, ['samples']), fields(ir, ['samples']));
  }
  // Default IR lag: max(0, lagSamples ?? alignment.lagSamples).
  const d = computeTransferAndIr({ ...base, alignment });
  assert.equal(d.ir.captureOffsetS,
    computeImpulseResponse({ ...base, lagSamples: irLag }).captureOffsetS);
  assert.equal(computeTransferAndIr({ ...base, lagSamples: -5 }).ir.captureOffsetS, 0);
  assert.equal(computeTransferAndIr(base).ir.captureOffsetS, 0);
  // Shared FFT plan and noise spectrum: same bits; a mismatched plan or another noise array is
  // ignored (recomputed), never misused.
  const size = nextPowerOfTwo(N + LEN);
  const plan = fftPlan(size);
  assert.equal(fftPlan(size, plan), plan);
  assert.notEqual(fftPlan(size * 2, plan), plan);
  const ns = noiseSpectrum(NOISE, size, plan);
  const ref = computeTransfer({ ...base, noise: NOISE });
  for (const extra of [{ fft: plan, noiseSpectrum: ns }, { fft: fftPlan(1024) },
    { noiseSpectrum: noiseSpectrum(NOISE.slice(), size) },
    { noiseSpectrum: noiseSpectrum(NOISE, size * 2) }]) {
    const r = computeTransfer({ ...base, noise: NOISE, ...extra });
    assertSameArrays(r, ref, TARR, 'shared');
    const c = computeTransferAndIr({ ...base, noise: NOISE, ...extra }).transfer;
    assertSameArrays(c, ref, TARR, 'shared combined');
  }
  // Errors are those of the separate functions, before any spectrum is computed.
  assert.throws(() => computeTransferAndIr({ ...base, lagSamples: NaN }),
    /lagSamples must be finite/);
  assert.throws(() => computeTransferAndIr({ ...base, irLagSamples: -1 }), /≥ 0/);
  assert.throws(() => computeTransferAndIr({ ...base, method: 'cepstral' }), /unknown IR method/);
  assert.throws(() => computeTransferAndIr({ ...base, method: 'farina-inverse' }), TypeError);
  assert.throws(() => computeTransferAndIr({ ...base, method: 'farina-inverse',
    inverse: new Float32Array(10) }), /stimulus length/);
  assert.throws(() => computeTransferAndIr({ ...base, options: { pointsPerOctave: 0 } }),
    /pointsPerOctave/);
  // Inputs are not modified.
  const copy = captured.slice();
  computeTransferAndIr({ ...base, noise: NOISE, alignment, options: { phase: true } });
  assert.deepEqual(captured, copy);
});

// ----------------------------------------------------------------------------- engine

/** A minimal io: clock jumps, captures are the stimulus at PRE through gain 0.5 + noise. */
function simpleIo({ facts = {}, steps = [] } = {}) {
  let t = 1;
  let run = 0;
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device: { label: null, id: null },
          constraints: { requested: null, applied: { echoCancellation: false,
            noiseSuppression: false, autoGainControl: false } } },
        inputLevel: { peak: 0.001, rmsDb: -80 }, output: { gain: 0.08, maxGain: 0.25,
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' }, ...facts };
    },
    async captureNoise(seconds) {
      const frames = Math.round(seconds * SR);
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: uniform(77, frames, 2e-3), preRoll: 0, postRoll: 0,
        startedAt, constraints: { requested: null, applied: null },
        device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const frames = pre + stimulus.samples.length + Math.round(postRollS * SR);
      const samples = uniform(10 + run, frames, 2e-3);
      const x = stimulus.samples;
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      for (const s of run === 0 ? steps : []) {
        for (let i = s.at; i < s.at + s.len; i++) samples[i] += s.height;
      }
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + frames / SR;
      return { sampleRate: SR, samples, preRoll: preRollS, postRoll: postRollS, startedAt,
        stimulusStartAt: startedAt + preRollS, constraints: { requested: null, applied: {
          echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
        device: { label: null, id: null } };
    },
    cancel() {},
    dispose() {},
  };
}

const RECIPE = (repeats = 1) => ({
  stimulus: { kind: 'log-sweep', duration: 1, level: 0.5, f1: 50, f2: 3000, fade: 0.01 },
  repeats, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});

test('engine: io chain notes reach preflight, result, assess and the quality mask', async () => {
  const seen = [];
  const engine = createMeasurementEngine({
    io: simpleIo({ facts: { chainNotes: { limiterDeviationAboveHz: 2000 } } }),
    assess: (result, ctx) => {
      seen.push(ctx.chainNotes);
      return assessMeasurement(result, ctx);
    },
  });
  const report = await engine.preflight(RECIPE(2));
  const w = report.warnings.find((x) => x.code === 'OUTPUT_CHAIN_DEVIATION');
  assert.ok(w, JSON.stringify(report.warnings));
  assert.equal(w.value, 2000);
  const r = await engine.measure(RECIPE(2));
  assert.equal(r.state, 'COMPLETE', JSON.stringify(r.reasons));
  assert.deepEqual(r.chainNotes, { limiterDeviationAboveHz: 2000 });
  assert.deepEqual(seen, [{ limiterDeviationAboveHz: 2000 }]);
  const q = r.quality;
  assert.equal(q.algorithm, 'oscilla.confidence.v3');
  assert.equal(q.metrics.outputChainLimitHz, 2000);
  assert.ok(q.reasons.some((x) => x.code === 'OUTPUT_CHAIN_DEVIATION' && x.severity === 'warn'));
  q.mask.frequencies.forEach((f, i) => { if (f > 2000) assert.equal(q.mask.reliable[i], 0); });
  assert.ok(q.reasons.some((x) => x.code === 'REPEATABILITY'), 'aggregate used');
  assert.ok(q.reasons.some((x) => x.code === 'DISCONTINUITY' && x.severity === 'ok'));
  // The transfer + IR step is one block; steps: 2 align, 1 transfer, 1 transfer+IR, aggregate.
  assert.deepEqual(r.timeline.analysis.steps.map((s) => s.name).sort(),
    ['aggregate', 'align', 'align', 'transfer', 'transfer+impulse-response']);
  // An invalid note is ignored with a warning, never guessed.
  const bad = createMeasurementEngine({ io: simpleIo({ facts: { chainNotes: { hz: 1 } } }),
    assess: assessMeasurement });
  const r2 = await bad.measure(RECIPE());
  assert.equal(r2.chainNotes, null);
  assert.ok(r2.preflight.warnings.some((x) => x.code === 'CHAIN_NOTES_IGNORED'));
  assert.equal(r2.quality.metrics.outputChainLimitHz, null);
  // No note: no reason and no warning.
  const none = await createMeasurementEngine({ io: simpleIo(), assess: assessMeasurement })
    .measure(RECIPE());
  assert.equal(none.chainNotes, null);
  assert.ok(!none.quality.reasons.some((x) => x.code === 'OUTPUT_CHAIN_DEVIATION'));
  assert.ok(!none.preflight.warnings.some((x) => x.code === 'OUTPUT_CHAIN_DEVIATION'));
});

test('engine: representative run = computeTransfer + computeImpulseResponse', async () => {
  const engine = createMeasurementEngine({ io: simpleIo() });
  const r = await engine.measure(RECIPE(1), { keepRaw: true });
  const raw = r.runs[0].raw;
  const stim = renderStimulus(r.stimulus.spec).samples;
  const spec = r.stimulus.spec;
  const args = { stimulus: stim, captured: raw, sampleRate: SR, f1: spec.f1, f2: spec.f2 };
  const t = computeTransfer({ ...args, lagSamples: r.runs[0].alignment.lagSamples,
    alignment: r.runs[0].alignment, noise: r.noise.raw, options: { phase: false } });
  const ir = computeImpulseResponse({ ...args,
    lagSamples: Math.max(0, r.runs[0].alignment.lagSamples) });
  assertSameArrays(r.transfer, t, TARR, 'engine transfer');
  assertSameArrays(r.ir, ir, ['samples'], 'engine ir');
  assert.equal(r.ir.peakIndex, ir.peakIndex);
});

test('engine: assessMeasurement turns an in-sweep discontinuity into INVALID (v2)', async () => {
  // Under the engine the capture checks already stop a run with DISCONTINUITY; assessMeasurement
  // applied to such checks (as a UI would for a stored run) invalidates by the v2 rule.
  const engine = createMeasurementEngine({ io: simpleIo() });
  const r = await engine.measure(RECIPE(1));
  const spliced = sweepCapture(1, INSIDE);
  const q = assessMeasurement({ ...r, captureChecks: [check(spliced)],
    runs: [{ ...r.runs[0], alignment: { ...r.runs[0].alignment, lagSamples: PRE } }] });
  assert.equal(q.status, 'INVALID');
  assert.ok(q.reasons.some((x) => x.code === 'DISCONTINUITY_IN_SWEEP'));
  const v1 = assessMeasurement({ ...r, captureChecks: [check(spliced)] },
    { algorithm: QUALITY_ALGORITHM_V1 });
  assert.equal(v1.algorithm, QUALITY_ALGORITHM_V1);
  assert.notEqual(v1.status, 'INVALID');
});
