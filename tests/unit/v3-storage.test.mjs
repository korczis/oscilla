// G20: the storage rule for repeated measurements (aggregate.js "Storage rule"), end to end:
//   engine.js measure() → schema.js resultsFromMeasurement → experiment → hash → JSON →
//   validate.js → identical; csv.js says what a derived transfer is; compare.js compares the
//   aggregate, flags single run vs aggregate and compares envelopes.
// The rule: with ≥ 2 runs results.aggregate is the primary response, results.transfer is its
// centre marked derivedFrom 'aggregate' (bit-identical magnitudes) or null — never one run's
// transfer — and individual runs are stored only on request in results.runTransfers.
// All inputs are seeded (mulberry32); every assertion is exact.
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../../src/js/audio/noise.js';
import { KNOWN_ALGORITHM_IDS, ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import {
  DERIVED_FROM_AGGREGATE, aggregateResult, aggregateRuns, transferFromAggregate,
} from '../../src/js/measurement/aggregate.js';
import { PHASE_REASONS } from '../../src/js/measurement/transfer.js';
import { createMeasurementEngine } from '../../src/js/measurement/engine.js';
import {
  LIMITS, createExperiment, createRecipe, experimentToJson, formatErrors, resultsFromMeasurement,
  withResults,
} from '../../src/js/experiments/schema.js';
import { resultCanonical, resultHash, withResultHash } from '../../src/js/experiments/hash.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { encodeArray } from '../../src/js/experiments/encode.js';
import { aggregateCsv, csvMeta, transferCsv } from '../../src/js/experiments/csv.js';
import {
  compareExperiments, responseDelta, responseOf,
} from '../../src/js/experiments/compare.js';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const NOW = '2026-10-02T10:00:00.000Z';
const SR = 8000;

function uniform(seed, n, amp) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng() - 0.5) * amp;
  return out;
}

/** Minimal io: stimulus at the pre-roll through `gain(run)` + seeded noise per run. */
function simpleIo({ gain = () => 0.5, seed = 10 } = {}) {
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
          audibleVoices: 0 }, worklet: { supported: true, mode: 'audioworklet' } };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: uniform(77, Math.round(seconds * SR), 2e-3), preRoll: 0,
        postRoll: 0, startedAt, constraints: { requested: null, applied: null },
        device: { label: null, id: null } };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const frames = pre + x.length + Math.round(postRollS * SR);
      const samples = uniform(seed + run, frames, 2e-3);
      const g = gain(run);
      for (let i = 0; i < x.length; i++) samples[pre + i] += g * x[i];
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

const RECIPE = (repeats, aggregation = 'mean') => ({
  stimulus: { kind: 'log-sweep', duration: 1, level: 0.5, f1: 50, f2: 3000, fade: 0.01 },
  repeats, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0, phase: true,
    aggregation },
});

const measure = (repeats, o = {}) => createMeasurementEngine({ io: simpleIo(o) })
  .measure(RECIPE(repeats, o.aggregation));

// Runs differ by ±0.5 dB in gain so the envelope is not degenerate.
const GAINS = [0.5, 0.5 * 10 ** (0.5 / 20), 0.5 * 10 ** (-0.5 / 20)];
const THREE = await measure(3, { gain: (r) => GAINS[r] });
const ONE = await measure(1);

function experimentOf(result, { runTransfers = false, id = 'g20-1' } = {}) {
  const created = createExperiment({
    recipe: createRecipe({ stimulus: result.recipe.stimulus, repeats: result.recipe.repeats,
      analysis: result.recipe.analysis }),
    now: NOW, id, sampleRate: SR,
    algorithms: { transfer: ALGORITHMS.transfer, ir: ALGORITHMS.ir,
      aggregate: ALGORITHMS.aggregate },
  });
  const e = withResults(created, { results: resultsFromMeasurement(result, { runTransfers }) });
  return withResultHash(e, resultHash(e));
}

function roundTrip(e) {
  const json = experimentToJson(e);
  const v = validateExperiment(json, OPTS);
  assert.ok(v.ok, v.ok ? '' : formatErrors(v.errors));
  assert.deepStrictEqual(v.experiment, e);
  assert.equal(experimentToJson(v.experiment), json, 'byte-identical re-export');
  return v.experiment;
}

const reject = (doc, path) => {
  const d = typeof doc === 'string' ? JSON.parse(doc) : doc;
  d.provenance.resultHash = null;
  const v = validateExperiment(d, OPTS);
  assert.equal(v.ok, false, `${path} accepted`);
  assert.ok(v.errors.some((x) => x.path === path), `${path}: ${JSON.stringify(v.errors)}`);
  return v.errors;
};

// ----------------------------------------------------------------------------- engine

test('G20 engine: repeated runs → the aggregate centre as a marked, storable transfer', () => {
  assert.equal(THREE.state, 'COMPLETE', JSON.stringify(THREE.reasons));
  const t = THREE.transfer;
  const stored = aggregateResult(THREE.aggregate, THREE.runs[0].transfer.frequencies);
  assert.equal(t.derivedFrom, DERIVED_FROM_AGGREGATE);
  assert.deepStrictEqual(t.magnitudeDb, stored.centreDb, 'the same bits as the stored centre');
  assert.deepStrictEqual(t.frequencies, stored.frequencies);
  assert.deepStrictEqual([t.phaseDeg, t.phaseReason, t.alignment],
    [null, PHASE_REASONS.AGGREGATED, null]);
  // SNR: lowest run per point; valid range: where every run is valid.
  const runs = THREE.runs.map((r) => r.transfer);
  t.snrDb.forEach((v, i) => assert.equal(v, Math.min(...runs.map((x) => x.snrDb[i]))));
  assert.deepStrictEqual(t.validRange, [Math.max(...runs.map((x) => x.validRange[0])),
    Math.min(...runs.map((x) => x.validRange[1]))]);
  assert.deepStrictEqual(transferFromAggregate(stored, runs), t);
  // Each run keeps its own transfer with its phase; one run is stored as itself.
  assert.ok(runs.every((x) => x.phaseDeg instanceof Float64Array && !('derivedFrom' in x)));
  assert.equal(ONE.transfer, ONE.runs[0].transfer);
  assert.ok(!('derivedFrom' in ONE.transfer));
  assert.throws(() => transferFromAggregate(aggregateResult(aggregateRuns([runs[0]
    .magnitudeDb]), runs[0].frequencies), [runs[0]]), TypeError, 'one run is not derived');
  assert.throws(() => transferFromAggregate(stored, runs.slice(1)), RangeError);
});

// ----------------------------------------------------------------------------- schema

test('G20 resultsFromMeasurement: aggregate primary, derived transfer, runs on request', () => {
  const r = resultsFromMeasurement(THREE);
  assert.deepStrictEqual(Object.keys(r), ['transfer', 'ir', 'rta', 'aggregate']);
  assert.deepStrictEqual(r.aggregate, aggregateResult(THREE.aggregate,
    THREE.runs[0].transfer.frequencies));
  assert.deepStrictEqual(r.transfer, THREE.transfer);
  assert.ok(!('run' in r.ir), 'the engine bookkeeping index is not an IrResult field');
  assert.equal(r.ir.samples, THREE.ir.samples, 'referenced, not copied');
  const all = resultsFromMeasurement(THREE, { runTransfers: true });
  assert.deepStrictEqual(all.runTransfers.map((x) => x.run), [0, 1, 2]);
  assert.equal(all.runTransfers[1].transfer, THREE.runs[1].transfer);
  const some = resultsFromMeasurement(THREE, { runTransfers: [0, 2] });
  assert.deepStrictEqual(some.runTransfers.map((x) => x.run), [0, 2]);
  assert.ok(!('runTransfers' in resultsFromMeasurement(THREE, { runTransfers: [] })));
  for (const bad of [[2, 0], [0, 0], [3], [1.5], 'all']) {
    assert.throws(() => resultsFromMeasurement(THREE, { runTransfers: bad }),
      /run indices|runTransfers must be/, JSON.stringify(bad));
  }
  // One run: its own transfer, no aggregate, a run request changes nothing.
  const one = resultsFromMeasurement(ONE, { runTransfers: true });
  assert.deepStrictEqual(Object.keys(one), ['transfer', 'ir', 'rta']);
  assert.equal(one.transfer, ONE.transfer);
  assert.deepStrictEqual(resultsFromMeasurement({ state: 'INVALID', transfer: null, ir: null,
    runs: [] }), { transfer: null, ir: null, rta: null });
  assert.equal(LIMITS.runTransfers, LIMITS.repeats[1]);
});

test('G20 experiment: hashes, round-trips byte for byte, with and without run transfers', () => {
  const plain = experimentOf(THREE);
  const withRuns = experimentOf(THREE, { runTransfers: true, id: 'g20-2' });
  const single = experimentOf(ONE, { id: 'g20-3' });
  for (const e of [plain, withRuns, single]) roundTrip(e);
  assert.match(resultCanonical(plain), /"derivedFrom":"aggregate"/);
  assert.doesNotMatch(resultCanonical(plain), /runTransfers/);
  assert.match(resultCanonical(withRuns), /"runTransfers":\[\{"run":0,"transfer":/);
  assert.notEqual(resultHash(withRuns), resultHash({ ...withRuns, results: plain.results }));
  // A single run hashes exactly as before G20: no marker, no aggregate, no run list.
  assert.doesNotMatch(resultCanonical(single), /derivedFrom|aggregate|runTransfers/);
  // The hash covers the run transfers: one flipped digit is corrupt.
  const doc = JSON.parse(experimentToJson(withRuns));
  const data = doc.results.runTransfers[1].transfer.magnitudeDb.data;
  doc.results.runTransfers[1].transfer.magnitudeDb.data = data.slice(0, 5)
    + (data[5] === 'A' ? 'B' : 'A') + data.slice(6);
  const v = validateExperiment(JSON.stringify(doc), OPTS);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.code === 'corrupt'), JSON.stringify(v.errors));
  // transfer: null is the other allowed form for a repeated measurement.
  const nul = withResults(plain, { results: { transfer: null } });
  roundTrip(withResultHash(nul, resultHash(nul)));
});

test('G20 validate: the rule is enforced with paths', () => {
  const json = experimentToJson(experimentOf(THREE, { runTransfers: [0, 1] }));
  const doc = () => JSON.parse(json);
  const runJson = JSON.parse(experimentToJson(experimentOf(THREE, { runTransfers: true })));
  // One run's transfer in results.transfer of a repeated measurement.
  let d = doc();
  d.results.transfer = runJson.results.runTransfers[0].transfer;
  reject(d, 'results.transfer');
  // derivedFrom without an aggregate of ≥ 2 runs; unknown marker.
  d = doc();
  delete d.results.aggregate;
  delete d.results.runTransfers;
  reject(d, 'results.transfer.derivedFrom');
  d = doc();
  d.results.transfer.derivedFrom = 'median';
  reject(d, 'results.transfer.derivedFrom');
  // Centre bits must match; the derived transfer has no phase and no alignment.
  d = doc();
  d.results.transfer.magnitudeDb = d.results.runTransfers[0].transfer.magnitudeDb;
  reject(d, 'results.transfer.magnitudeDb[0]');
  d = doc();
  d.results.transfer.phaseDeg = d.results.runTransfers[0].transfer.phaseDeg;
  reject(d, 'results.transfer.phaseDeg');
  d = doc();
  d.results.transfer.alignment = d.results.runTransfers[0].transfer.alignment;
  reject(d, 'results.transfer.alignment');
  d = doc();
  d.results.transfer.frequencies = d.results.ir.samples; // wrong dtype
  reject(d, 'results.transfer.frequencies');
  const shifted = encodeArray(Float64Array.from(THREE.transfer.frequencies, (f) => f * 1.0001));
  d = doc();
  d.results.transfer.frequencies = shifted; // valid array, not the aggregate grid
  reject(d, 'results.transfer.frequencies');
  d = doc();
  d.results.runTransfers[1].transfer.frequencies = shifted;
  reject(d, 'results.runTransfers[1].transfer.frequencies');
  // runTransfers: order, range, shape, count, no derived entries, needs the aggregate.
  d = doc();
  d.results.runTransfers.reverse();
  reject(d, 'results.runTransfers[1].run');
  d = doc();
  d.results.runTransfers[1].run = 3;
  reject(d, 'results.runTransfers[1].run');
  d = doc();
  d.results.runTransfers[0].extra = 1;
  reject(d, 'results.runTransfers[0].extra');
  d = doc();
  d.results.runTransfers = [];
  reject(d, 'results.runTransfers');
  d = doc();
  d.results.runTransfers = Array.from({ length: LIMITS.runTransfers + 1 },
    (_, i) => ({ run: i, transfer: runJson.results.runTransfers[0].transfer }));
  reject(d, 'results.runTransfers');
  d = doc();
  d.results.runTransfers[0].transfer = d.results.transfer;
  reject(d, 'results.runTransfers[0].transfer.derivedFrom');
  d = doc();
  d.results.transfer = null;
  delete d.results.aggregate;
  reject(d, 'results.runTransfers');
  // A single-run experiment cannot carry the marker or a run list either.
  const s = JSON.parse(experimentToJson(experimentOf(ONE, { id: 'g20-3' })));
  s.results.transfer.derivedFrom = 'aggregate';
  reject(s, 'results.transfer.derivedFrom');
});

// ----------------------------------------------------------------------------- CSV

test('G20 CSV: a derived transfer names the aggregate centre; a run names its run', () => {
  const e = experimentOf(THREE, { runTransfers: true });
  const meta = csvMeta(e);
  const centre = transferCsv(e.results.transfer, meta).split('\n');
  assert.equal(centre[0], '# OSCILLA transfer function (frequency response), aggregate centre '
    + 'of repeated runs');
  assert.ok(centre.includes('# derived_from: aggregate (magnitude = results.aggregate centre of '
    + 'the repeated runs; no phase: the runs\' phases are not averaged)'));
  assert.ok(centre.some((l) => /^# column magnitude_db_relative: .*centre of the repeated runs/
    .test(l)));
  assert.ok(centre.some((l) => /^# column snr_db: .*lowest of the runs$/.test(l)));
  const run = transferCsv(e.results.runTransfers[2].transfer, meta, { run: 2 }).split('\n');
  assert.ok(run.includes('# run: 2 (one run of a repeated measurement, not the aggregate)'));
  assert.ok(!run.some((l) => l.startsWith('# derived_from')));
  // The centre column of both CSVs carries the same numbers.
  const head = centre.indexOf('frequency_hz,magnitude_db_relative,magnitude_db_corrected,'
    + 'snr_db,reliable,phase_deg');
  // m3: the aggregate centre has no phase column values and says why.
  assert.ok(centre.includes('# column phase_deg: empty (phase not measured: aggregate of '
    + 'repeated runs: phases are not averaged)'));
  const agg = aggregateCsv(e.results.aggregate, meta).split('\n');
  const aHead = agg.findIndex((l) => l.startsWith('frequency_hz,'));
  for (let i = 1; i <= 5; i++) {
    assert.equal(centre[head + i].split(',')[1], agg[aHead + i].split(',')[1]);
  }
  assert.throws(() => transferCsv(e.results.transfer, meta, { run: 0 }), RangeError);
  assert.throws(() => transferCsv({ ...e.results.transfer, derivedFrom: 'x' }, meta), RangeError);
  // A plain single-run CSV is unchanged by G20.
  const single = transferCsv(ONE.transfer, {}).split('\n');
  assert.equal(single[0], '# OSCILLA transfer function (frequency response)');
  assert.ok(!single.some((l) => /derived_from|# run:/.test(l)));
});

// ----------------------------------------------------------------------------- compare

test('G20 compare: aggregate used when present; single run vs aggregate is not equivalent',
  async () => {
    const a = experimentOf(THREE);
    const b = experimentOf(await measure(3, { gain: (r) => GAINS[r] * 2, seed: 40 }),
      { id: 'g20-b' });
    const s = experimentOf(ONE, { id: 'g20-s' });
    // responseOf: the aggregate (with the derived transfer's valid range), not results.transfer.
    const ra = responseOf(a);
    assert.equal(ra.kind, 'aggregate');
    assert.equal(ra.magnitudeDb, a.results.aggregate.centreDb);
    assert.equal(ra.lowerDb, a.results.aggregate.lowerDb);
    assert.deepStrictEqual(ra.validRange, a.results.transfer.validRange);
    const nulT = withResults(a, { results: { transfer: null } });
    assert.equal(responseOf(nulT).kind, 'aggregate', 'transfer null: the aggregate still counts');
    assert.equal(responseOf(nulT).validRange, null);
    assert.equal(responseOf(a.results.transfer).kind, 'aggregate-centre');
    assert.equal(responseOf(s).kind, 'transfer');
    // Two aggregates: equivalent, ≈ +6.02 dB apart, envelopes compared point by point.
    const d = responseDelta(b, a);
    assert.ok(d.ok);
    assert.deepStrictEqual(d.sources, ['aggregate', 'aggregate']);
    assert.equal(d.equivalent, true);
    assert.deepStrictEqual(d.warnings, []);
    const sixDb = 20 * Math.log10(2);
    const mid = d.deltaDb[d.deltaDb.length >> 1];
    assert.ok(Math.abs(mid - sixDb) < 0.1, `${mid}`);
    assert.ok(d.envelope && d.envelope.comparable);
    assert.deepStrictEqual(d.envelope.dispersion, ['std', 'std']);
    // ±0.5 dB scatter (sd ≈ 0.5 dB) around centres 6 dB apart: the envelopes never touch.
    assert.equal(d.envelope.overlapFraction, 0);
    const self = responseDelta(a, a);
    assert.equal(self.envelope.overlapFraction, 1);
    assert.ok(self.deltaDb.every((x) => x === 0));
    // Single run vs aggregate: computed, flagged, no envelope.
    const m = responseDelta(s, a);
    assert.ok(m.ok);
    assert.deepStrictEqual(m.sources, ['transfer', 'aggregate']);
    assert.equal(m.equivalent, false);
    assert.equal(m.envelope, null);
    assert.match(m.warnings[0], /^Not equivalent: a single run \(A\) compared with the mean of 3 /);
    const centreOnly = responseDelta(s.results.transfer, a.results.transfer);
    assert.equal(centreOnly.equivalent, false, 'the bare derived centre is not a single run');
    // Different dispersion measures: overlap computed but marked not comparable.
    const med = experimentOf(await measure(3, { gain: (r) => GAINS[r], aggregation: 'median' }),
      { id: 'g20-m' });
    const dm = responseDelta(med, a);
    assert.equal(dm.equivalent, false);
    assert.equal(dm.envelope.comparable, false);
    assert.equal(dm.warnings.length, 2, JSON.stringify(dm.warnings));
    // compareExperiments: the response kind is a 'warn' difference, the run count 'info'.
    const c = compareExperiments([s, a]);
    const resp = c.differences.find((x) => x.field === 'results.response');
    assert.deepStrictEqual(resp, { field: 'results.response',
      values: ['single run', 'aggregate (mean)'], severity: 'warn' });
    assert.equal(c.compatible, false);
    assert.ok(c.warnings.some((w) => /single run compared with the aggregate/.test(w)));
    const same = compareExperiments([a, b]);
    assert.equal(same.common['results.response'], 'aggregate (mean)');
    assert.equal(same.common['results.aggregate.runs'], 3);
    assert.ok(!same.differences.some((x) => x.field.startsWith('results.')));
  });
