// V3 experiment model: schema, encoding, validation, migration, configuration hash, CSV,
// comparison and storage (src/js/experiments/*). Spec §50-§60, §99-§105, §131-§132,
// §144-§145, §160-§164, §172-§177, §223-§227.
//   node --test tests/unit/v3-experiments.test.mjs
//
// SHA-256: hash.js takes `sha256Hex` as a parameter (calibration/sha256.js is written
// separately). These tests inject node:crypto; when src/js/calibration/sha256.js exists, one
// extra test checks that it agrees with node:crypto on the canonical configuration.

import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CALIBRATION_SCHEMA_VERSION, CONFIG_SCHEMA_VERSION, EXPERIMENT_SCHEMA_VERSION, SCHEMA_VERSIONS,
  UNKNOWN_DEVICE, createExperiment, createRecipe, experimentToJson, formatErrors,
  newExperimentId, repeatExperiment, serializeExperiment, summarizeExperiment, withResults,
} from '../../src/js/experiments/schema.js';
import {
  decodeArray, decodeBase64, encodeArray, encodeBase64,
} from '../../src/js/experiments/encode.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { migrateExperiment, migrations } from '../../src/js/experiments/migrate.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import {
  configCanonical, configHash, configSelection, withConfigHash,
} from '../../src/js/experiments/hash.js';
import { csvMeta, irCsv, rtaCsv, transferCsv } from '../../src/js/experiments/csv.js';
import { compareExperiments, responseDelta } from '../../src/js/experiments/compare.js';
import {
  DB_VERSION, ExperimentStoreError, createMemoryStore, openExperimentStore,
  openExperimentStoreOrMemory,
} from '../../src/js/experiments/store.js';
import { CONFIG_FILE_VERSION } from '../../src/js/ui/config-file.js';

// ---------------------------------------------------------------- fixtures

// docs/v3/architecture.md, algorithms.js (the allowed list is a parameter of validation).
const ALGORITHMS = Object.freeze({
  transfer: 'oscilla.transfer.v1', ir: 'oscilla.ir.log-sweep.v1', rta: 'oscilla.rta.v1',
  smoothing: 'oscilla.smoothing.fractional-octave.v1', align: 'oscilla.align.xcorr.v1',
  clip: 'oscilla.clip.v1', quality: 'oscilla.confidence.v1',
  calibration: 'oscilla.calibration.log-interp.v1', window: 'oscilla.window.hann.v1',
});
const OPTS = { knownAlgorithms: ALGORITHMS };
const COMMIT = 'abc1234def5678abc1234def5678abc1234def56';
const BUILD = Object.freeze({
  version: '9.8.7', commit: COMMIT, shortCommit: 'abc1234', sourceDate: '2026-10-01T00:00:00Z',
  channel: 'release', dirty: false, repository: 'https://github.com/korczis/oscilla',
});
const SWEEP = Object.freeze({
  kind: 'log-sweep', sampleRate: 48000, duration: 10, level: 0.5, f1: 20, f2: 20000, fade: 0.05,
  seed: null,
});
const LEVEL = Object.freeze({
  schemaVersion: 1, kind: 'level', referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -30,
  offsetDb: 124, conditions: 'calibrator on mic', createdAt: '2026-10-01T09:00:00.000Z',
});
const PROFILE_ID = 'a'.repeat(64);
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const bytes = (seed) => Uint8Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 7) & 255);
const clone = (v) => JSON.parse(JSON.stringify(v));

function transferResult(n = 512, { lo = 10, hi = 24000, fn = (f) => Math.sin(Math.log(f)) } = {}) {
  const frequencies = new Float64Array(n);
  const magnitudeDb = new Float64Array(n);
  const phaseDeg = new Float64Array(n);
  const snrDb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = lo * (hi / lo) ** (i / (n - 1));
    frequencies[i] = f;
    magnitudeDb[i] = fn(f);
    phaseDeg[i] = -i * 0.731;
    snrDb[i] = 40 - i / 50;
  }
  return {
    algorithm: ALGORITHMS.transfer, sampleRate: 48000, frequencies, magnitudeDb, phaseDeg, snrDb,
    validRange: [20, 20000], requestedRange: [20, 20000], fftSize: 65536, binHz: 48000 / 65536,
  };
}

function irResult() {
  const samples = new Float32Array(4096);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.exp(-i / 300) * Math.sin(i * 0.37);
  samples[10] = 1e-40; // a float32 subnormal: must survive bit for bit
  samples[11] = -0;
  return {
    algorithm: ALGORITHMS.ir, sampleRate: 48000, samples, peakIndex: 4, peakTimeS: 4 / 48000,
    captureOffsetS: 0.0123, noiseFloorDb: -72.5, window: [0, 0.08],
  };
}

function rtaResult() {
  const bands = [[31.5, 31.25, 22.1, 44.2], [63, 62.5, 44.2, 88.4], [125, 125, 88.4, 176.8]]
    .map(([nominal, exact, lo, hi]) => ({ nominal, exact, lo, hi }));
  return {
    algorithm: ALGORITHMS.rta, sampleRate: 48000, resolution: 'octave', bands,
    levelsDb: Float64Array.from([-42.5, -38.25, -40]), fftSize: 8192,
  };
}

const QUALITY = Object.freeze({
  algorithm: ALGORITHMS.quality, status: 'USABLE',
  reasons: [
    { code: 'snr.low', severity: 'warn', text: 'SNR below 20 dB under 60 Hz', value: 14.2,
      unit: 'dB', range: [20, 20000] },
    { code: 'clip.none', severity: 'ok', text: 'No clipping', value: 0, unit: null },
  ],
  metrics: { snrMedianDb: 31.5, clippingRatio: 0, repeatabilityDb: 0.8, coverage: [20, 20000] },
});

function baseExperiment(over = {}) {
  return createExperiment({
    recipe: createRecipe({ stimulus: SWEEP, repeats: 5,
      analysis: { fftSize: 65536, smoothing: '1/6', window: ALGORITHMS.window } }),
    build: BUILD,
    now: '2026-10-02T10:00:00.000Z',
    id: newExperimentId(bytes(1)),
    name: 'MacBook speakers — desk',
    sampleRate: 48000,
    input: {
      device: { label: 'MacBook Pro Microphone', id: 'dev-1' },
      constraints: { requested: { echoCancellation: false, noiseSuppression: false },
        applied: { echoCancellation: false, sampleRate: 48000 } },
    },
    calibration: { frequency: { id: PROFILE_ID, name: 'UMIK-1 #7001', points: [[20, 1]] },
      level: LEVEL },
    environment: { notes: 'Mic 1 m from the speakers, desk, 22 °C.\nDoor closed.' },
    algorithms: { transfer: ALGORITHMS.transfer, ir: ALGORITHMS.ir, rta: ALGORITHMS.rta,
      quality: ALGORITHMS.quality },
    ...over,
  });
}

function fullExperiment(over = {}) {
  return withResults(baseExperiment(over), {
    startedAt: '2026-10-02T10:00:05.000Z',
    runs: [1, 2, 3, 4, 5].map((index) => ({ index, lagSamples: 120 + index, clippingRatio: 0,
      peak: 0.42, rms: 0.11 })),
    quality: clone(QUALITY),
    results: { transfer: transferResult(), ir: irResult(), rta: rtaResult() },
  });
}

const byteView = (ta) => new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
const docOf = (e) => clone(serializeExperiment(e));
const reject = (input, opts = OPTS) => {
  const v = validateExperiment(input, opts);
  assert.strictEqual(v.ok, false, 'expected the import to be rejected');
  assert.ok(Array.isArray(v.errors) && v.errors.length > 0);
  for (const e of v.errors) assert.ok(typeof e.path === 'string' && typeof e.text === 'string');
  return v.errors;
};
const hasError = (errors, path, re) => errors.some((e) => e.path === path
  && (!re || re.test(e.text)));

// ---------------------------------------------------------------- schema

test('schema versions are four independent axes (§131)', () => {
  assert.strictEqual(EXPERIMENT_SCHEMA_VERSION, 1);
  // 2: frequency profiles carry their sign convention (M4); schema 1 migrates to it.
  assert.strictEqual(CALIBRATION_SCHEMA_VERSION, 2);
  assert.strictEqual(CONFIG_SCHEMA_VERSION, CONFIG_FILE_VERSION);
  assert.ok(Object.isFrozen(SCHEMA_VERSIONS));
  assert.deepStrictEqual(Object.keys(SCHEMA_VERSIONS), ['experiment', 'calibration', 'config',
    'preset']);
  const e = baseExperiment();
  assert.strictEqual(e.oscillaVersion, '9.8.7');
  assert.notStrictEqual(e.oscillaVersion, String(e.schemaVersion));
});

test('createExperiment: contract shape, unknowns null, inputs not mutated', () => {
  const input = { device: { label: '', id: null }, constraints: { requested: { a: 1 } } };
  const snapshot = clone(input);
  const e = createExperiment({ recipe: { stimulus: SWEEP }, now: 1767000000000, id: 'local-1',
    input });
  assert.deepStrictEqual(input, snapshot);
  assert.deepStrictEqual(Object.keys(e), ['kind', 'schemaVersion', 'oscillaVersion',
    'oscillaCommit', 'experimentId', 'name', 'recipe', 'output', 'input', 'calibration',
    'environment', 'measurement', 'quality', 'algorithms', 'results', 'provenance']);
  assert.strictEqual(e.oscillaVersion, null);
  assert.strictEqual(e.oscillaCommit, null);
  assert.strictEqual(e.input.device.label, null);
  assert.deepStrictEqual(e.calibration, { frequency: null, level: null });
  assert.deepStrictEqual(e.results, { transfer: null, ir: null, rta: null });
  assert.deepStrictEqual(e.recipe, { stimulus: { ...SWEEP, f: null, color: null, law: null },
    repeats: 1, analysis: {} });
  assert.strictEqual(e.output.level, 0.5);
  assert.strictEqual(e.provenance.createdAt, new Date(1767000000000).toISOString());
  assert.strictEqual(e.provenance.configHash, null);
  assert.ok(validateExperiment(experimentToJson(e), OPTS).ok);
  assert.throws(() => createExperiment({ recipe: { stimulus: SWEEP }, id: 'x' }), TypeError);
  assert.throws(() => createExperiment({ recipe: { stimulus: SWEEP }, now: 0, id: '../x' }),
    TypeError);
  assert.throws(() => createExperiment({ recipe: { stimulus: SWEEP }, now: 0, id: 'x',
    sampleRate: 1000 }), RangeError);
});

test('createRecipe: limits enforced, unused fields normalized to null (§103, §174)', () => {
  const sine = createRecipe({ stimulus: { kind: 'sine', duration: 2, level: 0.25, f: 1000,
    fade: 0.01, f1: 20, sampleRate: null } });
  assert.deepStrictEqual(sine.stimulus, { kind: 'sine', sampleRate: null, duration: 2,
    level: 0.25, f: 1000, f1: null, f2: null, fade: 0.01, seed: null, color: null, law: null });
  // Limits are stimulus.js's own (G2): fade ≤ duration/4 (10 s → 2.5 s), f ≤ 0.95 × Nyquist
  // (22 800 Hz at 48 kHz), f ≥ 1 Hz, level in (0, 1], per-kind durations (chirp 5 ms-1 s),
  // and colour / law only where the kind uses them.
  const bad = [
    { ...SWEEP, duration: 31 }, { ...SWEEP, duration: 0.5 }, { ...SWEEP, level: 1.5 },
    { ...SWEEP, f1: 2000, f2: 20 }, { ...SWEEP, f2: 30000 }, { ...SWEEP, kind: 'square' },
    { ...SWEEP, fade: 6 }, { ...SWEEP, extra: 1 }, { ...SWEEP, duration: NaN },
    { ...SWEEP, fade: 2.6 }, { ...SWEEP, f2: 22801 }, { ...SWEEP, f1: 0.5 },
    { ...SWEEP, level: 0 }, { ...SWEEP, color: 'pink' }, { ...SWEEP, law: 'log' },
    { kind: 'chirp', sampleRate: 48000, duration: 2, level: 0.5, f1: 20, f2: 20000, fade: 0.1 },
    { kind: 'chirp', sampleRate: 48000, duration: 0.05, level: 0.5, f1: 20, f2: 20000,
      fade: 0.005, law: 'cubic' },
    { kind: 'band-noise', sampleRate: 48000, duration: 1, level: 0.5, f1: 20, f2: 20000,
      fade: 0.02, color: 'brown' },
    { kind: 'sine', sampleRate: 48000, duration: 0.04, level: 0.5, f: 1000, fade: 0.01 },
  ];
  assert.deepStrictEqual(createRecipe({ stimulus: { ...SWEEP, fade: 2.5, f2: 22800 } })
    .stimulus.f2, 22800, 'the clamp limit itself is accepted');
  const chirp = createRecipe({ stimulus: { kind: 'chirp', sampleRate: 48000, duration: 0.005,
    level: 0.5, f1: 20, f2: 20000, fade: 0.0005, law: 'linear' } }).stimulus;
  assert.strictEqual(chirp.law, 'linear');
  assert.strictEqual(chirp.color, null);
  const band = createRecipe({ stimulus: { kind: 'band-noise', sampleRate: 48000, duration: 1,
    level: 0.5, f1: 100, f2: 1000, fade: 0.02, seed: 3, color: 'pink' } }).stimulus;
  assert.strictEqual(band.color, 'pink');
  assert.strictEqual(band.law, null);
  for (const stimulus of bad) assert.throws(() => createRecipe({ stimulus }), RangeError);
  assert.throws(() => createRecipe({ stimulus: SWEEP, repeats: 11 }), RangeError);
  assert.throws(() => createRecipe({ stimulus: SWEEP, repeats: 1.5 }), RangeError);
  assert.throws(() => createRecipe({ stimulus: SWEEP, analysis: [] }), RangeError);
  const stim = { ...SWEEP };
  createRecipe({ stimulus: stim });
  assert.deepStrictEqual(stim, SWEEP);
});

test('newExperimentId: UUIDv4 from injected bytes, input untouched (§176)', () => {
  assert.strictEqual(newExperimentId(new Uint8Array(16)), '00000000-0000-4000-8000-000000000000');
  const b = Uint8Array.from({ length: 16 }, () => 255);
  assert.strictEqual(newExperimentId(b), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.ok(b.every((x) => x === 255));
  assert.match(newExperimentId(bytes(7)),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notStrictEqual(newExperimentId(bytes(1)), newExperimentId(bytes(2)));
  assert.throws(() => newExperimentId(new Uint8Array(8)), TypeError);
  assert.throws(() => newExperimentId([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 256]),
    TypeError);
});

test('repeatExperiment: a NEW experiment with the same recipe and empty results (§104)', () => {
  const src = fullExperiment();
  const before = experimentToJson(src);
  const rep = repeatExperiment(src, { now: '2026-10-03T08:00:00.000Z',
    id: newExperimentId(bytes(9)), build: BUILD });
  assert.strictEqual(experimentToJson(src), before, 'source not modified');
  assert.notStrictEqual(rep.experimentId, src.experimentId);
  assert.deepStrictEqual(rep.recipe, src.recipe);
  assert.notStrictEqual(rep.recipe, src.recipe);
  assert.deepStrictEqual(rep.calibration, src.calibration);
  assert.deepStrictEqual(rep.results, { transfer: null, ir: null, rta: null });
  assert.deepStrictEqual(rep.measurement, { startedAt: null, sampleRate: null, runs: [] });
  assert.strictEqual(rep.quality, null);
  assert.strictEqual(rep.provenance.repeatOf, src.experimentId);
  assert.strictEqual(rep.provenance.createdAt, '2026-10-03T08:00:00.000Z');
  assert.strictEqual(rep.input.device.label, null, 'the device of the repeat is not assumed');
  assert.ok(validateExperiment(experimentToJson(rep), OPTS).ok);
  assert.throws(() => repeatExperiment(src, { now: 0, id: src.experimentId }), RangeError);
  const noBuild = repeatExperiment(src, { now: 0, id: 'r2' });
  assert.strictEqual(noBuild.oscillaVersion, null,
    'an unknown build is not copied from the source');
});

test('summarizeExperiment: compact lines; never invents data (§52, §161)', () => {
  assert.deepStrictEqual(summarizeExperiment(fullExperiment()), [
    'Name: MacBook speakers — desk',
    'Stimulus: 20 Hz → 20 kHz log sweep, 10 s',
    'Output level: digital peak 0.5, -6.0 dB relative (dBFS-like)',
    'Master output gain: Unknown (not recorded)',
    'Input: MacBook Pro Microphone',
    'Calibration: frequency profile "UMIK-1 #7001", SPL CALIBRATED (94 dB SPL at 1 kHz)',
    'Sample rate: 48000 Hz',
    'Runs: 5 of 5 requested',
    // M11: a stored verdict says which build and rule set gave it.
    'Quality: USABLE (as assessed by OSCILLA 9.8.7, commit abc1234, oscilla.confidence.v1)',
    'OSCILLA 9.8.7, commit abc1234',
  ]);
  const bare = createExperiment({ recipe: { stimulus: { kind: 'pink', duration: 5, level: 0.1,
    fade: 0.1 } }, now: 0, id: 'bare', input: { device: { label: '' } } });
  assert.deepStrictEqual(summarizeExperiment(bare), [
    'Name: (unnamed)',
    'Stimulus: pink noise, 5 s',
    'Output level: digital peak 0.1, -20.0 dB relative (dBFS-like)',
    'Master output gain: Unknown (not recorded)',
    `Input: ${UNKNOWN_DEVICE}`,
    'Calibration: frequency profile none, level UNCALIBRATED (Relative level · dBFS-like / '
      + 'analyser-relative scale)',
    'Sample rate: Unknown',
    'Runs: 0 of 1 requested',
    'Quality: Unknown (not assessed)',
    'OSCILLA Unknown, commit Unknown',
  ]);
  assert.strictEqual(UNKNOWN_DEVICE, 'Unknown / browser did not expose device label');
});

// ---------------------------------------------------------------- encoding

test('encodeArray: explicit little-endian base64, bitwise round trip (§56-§57)', () => {
  assert.deepStrictEqual(encodeArray(new Float32Array([1])),
    { dtype: 'f32', length: 1, encoding: 'base64-le', data: 'AACAPw==' });
  assert.deepStrictEqual(encodeArray(new Float64Array([1])),
    { dtype: 'f64', length: 1, encoding: 'base64-le', data: 'AAAAAAAA8D8=' });
  assert.deepStrictEqual(encodeArray([1, 2, 255], 'u8'),
    { dtype: 'u8', length: 3, encoding: 'base64-le', data: 'AQL/' });
  const f32 = Float32Array.from([0, -0, 1e-40, 3.4e38, -1.5, NaN, Math.PI]);
  const back = decodeArray(JSON.parse(JSON.stringify(encodeArray(f32))));
  assert.ok(back instanceof Float32Array);
  assert.deepStrictEqual(byteView(back), byteView(f32));
  const f64 = Float64Array.from([Number.MIN_VALUE, -Number.MAX_VALUE, 1 / 3]);
  assert.deepStrictEqual(byteView(decodeArray(encodeArray(f64))), byteView(f64));
  assert.ok(decodeArray(encodeArray([0.1], 'f64')) instanceof Float64Array);
  assert.throws(() => encodeArray([1, 2]), TypeError);
  assert.throws(() => encodeArray([256], 'u8'), TypeError);
});

test('base64: matches Buffer, strict on decode', () => {
  for (let n = 0; n < 40; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 13) & 255);
    const s = encodeBase64(b);
    assert.strictEqual(s, Buffer.from(b).toString('base64'));
    assert.deepStrictEqual(decodeBase64(s), b);
  }
  for (const bad of ['A', 'AAA', 'AA=A', 'AB==', 'AAB=', 'AA-_', 'A A=', '====', 'Zg=é']) {
    assert.throws(() => decodeBase64(bad), TypeError, bad);
  }
});

test('decodeArray: declared length, limits and dtype checked before use', () => {
  const enc = encodeArray(new Float32Array(10));
  assert.throws(() => decodeArray({ ...enc, length: 11 }), /does not match/);
  assert.throws(() => decodeArray({ ...enc, length: 9 }), /does not match/);
  assert.throws(() => decodeArray({ ...enc, length: 4e9, data: '' }), /does not match/);
  assert.throws(() => decodeArray(enc, { maxLength: 5 }), /exceeds the limit/);
  assert.throws(() => decodeArray(enc, { dtype: 'f64' }), /not allowed/);
  assert.throws(() => decodeArray({ ...enc, encoding: 'base64' }), /encoding/);
  assert.throws(() => decodeArray({ ...enc, dtype: 'i32' }), /dtype/);
  assert.throws(() => decodeArray({ ...enc, dtype: '__proto__' }), /dtype/);
  assert.throws(() => decodeArray({ ...enc, extra: 1 }), /no other keys/);
  assert.throws(() => decodeArray({ ...enc, length: -1 }), /non-negative/);
});

// ---------------------------------------------------------------- round trip

test('round trip: create -> encode -> JSON -> validate is identical (§144)', () => {
  const e = fullExperiment();
  const json = experimentToJson(e);
  const v = validateExperiment(json, OPTS);
  assert.ok(v.ok, v.errors && formatErrors(v.errors));
  assert.strictEqual(v.migratedFrom, null);
  assert.deepStrictEqual(v.experiment, e);
  const x = v.experiment;
  assert.deepStrictEqual(x.recipe, e.recipe, 'configuration');
  assert.deepStrictEqual(x.calibration, { frequency: { id: PROFILE_ID, name: 'UMIK-1 #7001' },
    level: { ...LEVEL } }, 'calibration metadata');
  assert.deepStrictEqual(x.algorithms, e.algorithms, 'algorithm IDs');
  assert.deepStrictEqual(x.quality, e.quality, 'quality');
  assert.deepStrictEqual(x.provenance, e.provenance, 'provenance');
  assert.ok(x.results.ir.samples instanceof Float32Array);
  assert.deepStrictEqual(byteView(x.results.ir.samples), byteView(e.results.ir.samples),
    'f32 bitwise');
  assert.ok(x.results.transfer.frequencies instanceof Float64Array);
  assert.deepStrictEqual(byteView(x.results.transfer.magnitudeDb),
    byteView(e.results.transfer.magnitudeDb));
  assert.notStrictEqual(x.results.ir.samples, e.results.ir.samples);
  assert.strictEqual(experimentToJson(x), json, 'export -> import -> export is stable');
});

test('validate returns a deep copy and never mutates its input', () => {
  const doc = docOf(fullExperiment());
  const snapshot = JSON.stringify(doc);
  const v = validateExperiment(doc, OPTS);
  assert.ok(v.ok, v.errors && formatErrors(v.errors));
  assert.strictEqual(JSON.stringify(doc), snapshot);
  doc.recipe.stimulus.duration = 3;
  doc.recipe.analysis.fftSize = 1;
  doc.calibration.level.offsetDb = 0;
  doc.input.constraints.requested.echoCancellation = true;
  doc.measurement.runs[0].peak = 9;
  doc.quality.reasons[0].range[0] = 1;
  assert.strictEqual(v.experiment.recipe.stimulus.duration, 10);
  assert.strictEqual(v.experiment.recipe.analysis.fftSize, 65536);
  assert.strictEqual(v.experiment.calibration.level.offsetDb, 124);
  assert.strictEqual(v.experiment.input.constraints.requested.echoCancellation, false);
  assert.strictEqual(v.experiment.measurement.runs[0].peak, 0.42);
  assert.strictEqual(v.experiment.quality.reasons[0].range[0], 20);
});

test('validate accepts plain number arrays for small vectors', () => {
  const doc = docOf(fullExperiment());
  doc.results.rta.levelsDb = [-42.5, -38.25, -40];
  const v = validateExperiment(doc, OPTS);
  assert.ok(v.ok, v.errors && formatErrors(v.errors));
  assert.ok(v.experiment.results.rta.levelsDb instanceof Float64Array);
  assert.deepStrictEqual([...v.experiment.results.rta.levelsDb], [-42.5, -38.25, -40]);
});

// ---------------------------------------------------------------- corrupt input (§145)

test('corrupt: invalid schema', () => {
  const doc = docOf(fullExperiment());
  assert.ok(hasError(reject({ ...doc, schemaVersion: 'one' }), 'schemaVersion'));
  assert.ok(hasError(reject({ ...doc, schemaVersion: undefined }), 'schemaVersion'));
  assert.ok(hasError(reject({ ...doc, kind: 'other' }), 'kind'));
  assert.ok(hasError(reject({ kind: 'oscilla-config', version: 1 }), 'kind', /configuration/));
  assert.ok(hasError(reject({ ...doc, extra: 1 }), 'extra', /unknown field/));
  const { results, ...noResults } = doc;
  assert.ok(results);
  assert.ok(hasError(reject(noResults), 'results', /missing/));
  assert.ok(hasError(reject({ ...doc, recipe: { ...doc.recipe, extra: true } }), 'recipe.extra'));
  assert.ok(hasError(reject({ ...doc, results: { ...doc.results, raw: null } }), 'results.raw'));
  reject('[]');
  reject('null');
  assert.ok(hasError(reject('{"kind": "oscilla-experiment",'), '', /not valid JSON/));
  reject(42);
});

test('corrupt: oversized arrays and declared/actual length mismatch', () => {
  const doc = docOf(fullExperiment());
  assert.ok(hasError(reject(doc, { ...OPTS, maxArray: 100 }), 'results.transfer.frequencies',
    /exceeds the limit/));
  const mismatch = clone(doc);
  mismatch.results.transfer.magnitudeDb.length = 511;
  assert.ok(hasError(reject(mismatch), 'results.transfer.magnitudeDb', /does not match/));
  const short = clone(doc);
  short.results.transfer.snrDb = encodeArray(new Float64Array(511));
  assert.ok(hasError(reject(short), 'results.transfer.snrDb', /expected 512/));
  const bands = clone(doc);
  bands.results.rta.levelsDb = [-1, -2];
  assert.ok(hasError(reject(bands), 'results.rta.levelsDb', /expected 3/));
  const big = clone(doc);
  big.results.rta.levelsDb = new Array(70000).fill(0);
  assert.ok(hasError(reject(big), 'results.rta.levelsDb', /plain array longer/));
  const bomb = clone(doc);
  bomb.results.ir.samples = { dtype: 'f32', length: 1e9, encoding: 'base64-le', data: 'AAAA' };
  assert.ok(hasError(reject(bomb), 'results.ir.samples', /exceeds/));
  const dtype = clone(doc);
  dtype.results.transfer.frequencies = encodeArray(Float32Array.from(
    transferResult().frequencies));
  assert.ok(hasError(reject(dtype), 'results.transfer.frequencies', /not allowed/));
  const b64 = clone(doc);
  b64.results.ir.samples.data = `!${b64.results.ir.samples.data.slice(1)}`;
  assert.ok(hasError(reject(b64), 'results.ir.samples', /invalid base64/));
  const order = clone(doc);
  const f = transferResult().frequencies;
  [f[3], f[4]] = [f[4], f[3]];
  order.results.transfer.frequencies = encodeArray(f);
  assert.ok(hasError(reject(order), 'results.transfer.frequencies[4]', /increasing/));
  const runs = clone(doc);
  runs.measurement.runs = new Array(65).fill({});
  assert.ok(hasError(reject(runs), 'measurement.runs'));
});

test('corrupt: wrong types and out-of-range numbers', () => {
  const doc = docOf(fullExperiment());
  const cases = [
    ['name', (d) => { d.name = 42; }],
    ['name', (d) => { d.name = 'x'.repeat(201); }],
    ['name', (d) => { d.name = 'a\u0000b'; }],
    ['recipe.repeats', (d) => { d.recipe.repeats = '5'; }],
    ['recipe.stimulus.duration', (d) => { d.recipe.stimulus.duration = 600; }],
    ['recipe.stimulus.level', (d) => { d.recipe.stimulus.level = 2; }],
    ['measurement.sampleRate', (d) => { d.measurement.sampleRate = 1000; }],
    ['measurement.sampleRate', (d) => { d.measurement.sampleRate = 500000; }],
    ['measurement.startedAt', (d) => { d.measurement.startedAt = 'yesterday'; }],
    ['provenance.createdAt', (d) => { d.provenance.createdAt = null; }],
    ['provenance.configHash', (d) => { d.provenance.configHash = 'abc'; }],
    ['experimentId', (d) => { d.experimentId = '<script>'; }],
    ['oscillaCommit', (d) => { d.oscillaCommit = 'not-a-commit'; }],
    ['quality.status', (d) => { d.quality.status = 'PERFECT'; }],
    ['quality.reasons[0].severity', (d) => { d.quality.reasons[0].severity = 'fatal'; }],
    ['quality.reasons[0].value', (d) => { d.quality.reasons[0].value = { a: 1 }; }],
    ['results.ir.peakIndex', (d) => { d.results.ir.peakIndex = 5000; }],
    ['results.transfer.validRange', (d) => { d.results.transfer.validRange = [100, 50]; }],
    ['results.transfer.validRange[1]', (d) => { d.results.transfer.validRange = [20, 30000]; }],
    ['results.rta.bands[0]', (d) => { d.results.rta.bands[0].lo = 50; }],
    ['input.device.label', (d) => { d.input.device.label = 7; }],
    ['environment.notes', (d) => { d.environment.notes = 'n'.repeat(10001); }],
    ['algorithms.Transfer', (d) => { d.algorithms.Transfer = ALGORITHMS.transfer; }],
    ['provenance.build.dirty', (d) => { d.provenance.build.dirty = 'no'; }],
  ];
  for (const [path, mutate] of cases) {
    const d = clone(doc);
    mutate(d);
    const errors = reject(d);
    assert.ok(hasError(errors, path), `${path}: ${formatErrors(errors)}`);
  }
});

test('corrupt: NaN and Infinity are rejected wherever they appear', () => {
  const doc = docOf(fullExperiment());
  for (const value of [NaN, Infinity, -Infinity]) {
    const d = clone(doc);
    d.recipe.stimulus.duration = value;
    assert.ok(hasError(reject(d), 'recipe.stimulus.duration', /finite/));
    const q = clone(doc);
    q.quality.metrics.snrMedianDb = value;
    assert.ok(hasError(reject(q), 'quality.metrics.snrMedianDb', /finite/));
  }
  const text = experimentToJson(fullExperiment()).replace('"duration":10', '"duration":1e999');
  assert.ok(hasError(reject(text), 'recipe.stimulus.duration', /finite/));
  const inArray = clone(doc);
  const m = transferResult().magnitudeDb;
  m[100] = NaN;
  inArray.results.transfer.magnitudeDb = encodeArray(m);
  assert.ok(hasError(reject(inArray), 'results.transfer.magnitudeDb[100]', /finite/));
  const inF32 = clone(doc);
  const s = irResult().samples;
  s[7] = Infinity;
  inF32.results.ir.samples = encodeArray(s);
  assert.ok(hasError(reject(inF32), 'results.ir.samples[7]', /finite/));
  const overflow = clone(doc);
  overflow.results.ir.samples = [1, 1e39];
  assert.ok(hasError(reject(overflow), 'results.ir.samples[1]', /finite/), 'f32 overflow');
});

test('corrupt: unknown algorithm IDs', () => {
  const doc = docOf(fullExperiment());
  const a = clone(doc);
  a.algorithms.transfer = 'oscilla.transfer.v9';
  assert.ok(hasError(reject(a), 'algorithms.transfer', /unknown algorithm/));
  const r = clone(doc);
  r.results.ir.algorithm = 'oscilla.ir.mls.v1';
  assert.ok(hasError(reject(r), 'results.ir.algorithm', /unknown algorithm/));
  const q = clone(doc);
  q.quality.algorithm = 'oscilla.confidence.v2';
  assert.ok(hasError(reject(q), 'quality.algorithm', /unknown algorithm/));
  const f = clone(doc);
  f.algorithms.transfer = 'eval(alert(1))';
  assert.ok(hasError(reject(f, {}), 'algorithms.transfer', /format/), 'format checked always');
  assert.ok(validateExperiment(doc, {}).ok, 'without a list only the format is checked');
  assert.ok(validateExperiment(doc, { knownAlgorithms: Object.values(ALGORITHMS) }).ok);
  assert.ok(validateExperiment(doc, { knownAlgorithms: new Set(Object.values(ALGORITHMS)) }).ok);
});

test('corrupt: malformed calibration', () => {
  const doc = docOf(fullExperiment());
  const cases = [
    ['calibration.frequency.id', (c) => { c.frequency.id = 'xyz'; }],
    ['calibration.frequency.name', (c) => { delete c.frequency.name; }],
    ['calibration.frequency.points', (c) => { c.frequency.points = [[1, 2]]; }],
    ['calibration.level.offsetDb', (c) => { delete c.level.offsetDb; }],
    ['calibration.level.offsetDb', (c) => { c.level.offsetDb = '124'; }],
    ['calibration.level.kind', (c) => { c.level.kind = 'frequency'; }],
    ['calibration.level.schemaVersion', (c) => { c.level.schemaVersion = 3; }],
    ['calibration.level.scale', (c) => { c.level.schemaVersion = 2; }],
    ['calibration.level.referenceDbSpl', (c) => { c.level.referenceDbSpl = 900; }],
    ['calibration.level.createdAt', (c) => { c.level.createdAt = 12; }],
    ['calibration.level', (c) => { c.level = [1, 2]; }],
    ['calibration.spl', (c) => { c.spl = 94; }],
  ];
  for (const [path, mutate] of cases) {
    const d = clone(doc);
    mutate(d.calibration);
    const errors = reject(d);
    assert.ok(hasError(errors, path), `${path}: ${formatErrors(errors)}`);
  }
});

test('corrupt: __proto__ / constructor / prototype keys and non-plain objects', () => {
  const json = experimentToJson(fullExperiment());
  const proto = json.replace('"analysis":{', '"analysis":{"__proto__":{"polluted":true},');
  assert.ok(hasError(reject(proto), 'recipe.analysis.__proto__', /forbidden/));
  assert.strictEqual({}.polluted, undefined);
  const ctor = json.replace('"metrics":{', '"metrics":{"constructor":{"prototype":{}},');
  assert.ok(hasError(reject(ctor), 'quality.metrics.constructor', /forbidden/));
  const top = json.replace('{"kind"', '{"prototype":1,"kind"');
  assert.ok(hasError(reject(top), 'prototype', /forbidden/));
  const doc = docOf(fullExperiment());
  doc.environment = Object.create({ notes: 'inherited' });
  assert.ok(hasError(reject(doc), 'environment', /plain JSON object/));
  const fn = docOf(fullExperiment());
  fn.recipe.analysis.run = () => 1;
  assert.ok(hasError(reject(fn), 'recipe.analysis.run', /not JSON/));
  let deep = {};
  const root = deep;
  for (let i = 0; i < 40; i++) deep = deep.x = {};
  const nested = docOf(fullExperiment());
  nested.recipe.analysis = root;
  assert.ok(reject(nested).some((e) => /nested deeper/.test(e.text)));
});

test('corrupt: input larger than maxBytes is rejected before parsing', () => {
  const json = experimentToJson(fullExperiment());
  assert.ok(hasError(reject(json, { ...OPTS, maxBytes: 1000 }), '', /import limit/));
  assert.ok(hasError(reject(JSON.parse(json), { ...OPTS, maxBytes: 1000 }), '', /import limit/));
  assert.ok(hasError(reject(`"${'é'.repeat(600)}"`, { maxBytes: 1000 }), '', /import limit/),
    'counted in UTF-8 bytes');
  assert.ok(validateExperiment(json, { ...OPTS, maxBytes: Buffer.byteLength(json) }).ok);
  assert.ok(!validateExperiment(json, { ...OPTS, maxBytes: Buffer.byteLength(json) - 1 }).ok);
});

// ---------------------------------------------------------------- migration (§132, §226)

test('future schema version is rejected clearly', () => {
  const doc = docOf(fullExperiment());
  const errors = reject({ ...doc, schemaVersion: 2 });
  assert.ok(hasError(errors, 'schemaVersion', /newer than this OSCILLA supports \(1\)/));
  const m = migrateExperiment({ ...doc, schemaVersion: 99 });
  assert.strictEqual(m.ok, false);
  assert.match(m.errors[0].text, /schema 99 is newer/);
  assert.strictEqual(migrateExperiment({ ...doc, schemaVersion: -1 }).ok, false);
  assert.strictEqual(migrateExperiment({ ...doc, schemaVersion: 1.5 }).ok, false);
});

test('migration registry: identity for schema 1, steps applied in order, input untouched', () => {
  assert.ok(Object.isFrozen(migrations));
  assert.strictEqual(typeof migrations[1], 'function');
  const doc = docOf(fullExperiment());
  const same = migrateExperiment(doc);
  assert.ok(same.ok);
  assert.deepStrictEqual(same.applied, []);
  assert.deepStrictEqual(same.experiment, doc);
  assert.notStrictEqual(same.experiment, doc);
  const order = [];
  const chain = {
    1: (e) => { order.push(1); return { ...e, one: true }; },
    2: (e) => { order.push(2); return { ...e, two: e.one === true }; },
  };
  const before = JSON.stringify(doc);
  const r = migrateExperiment({ ...doc, schemaVersion: 0 },
    { migrations: chain, targetVersion: 2 });
  assert.ok(r.ok);
  assert.deepStrictEqual(order, [1, 2]);
  assert.deepStrictEqual(r.applied, [1, 2]);
  assert.strictEqual(r.experiment.schemaVersion, 2);
  assert.strictEqual(r.experiment.two, true);
  assert.strictEqual(JSON.stringify(doc), before);
  const gap = migrateExperiment({ ...doc, schemaVersion: 0 }, { migrations: { 2: (e) => e },
    targetVersion: 2 });
  assert.match(gap.errors[0].text, /no migration from schema 0 to 1/);
  const bad = migrateExperiment({ ...doc, schemaVersion: 0 }, { migrations: { 1: () => null } });
  assert.match(bad.errors[0].text, /did not return an object/);
  const boom = migrateExperiment({ ...doc, schemaVersion: 0 }, { migrations: { 1: () => {
    throw new Error('bad'); } } });
  assert.match(boom.errors[0].text, /failed: bad/);
});

test('migration fixture: a synthetic schema 0 document imports as schema 1', () => {
  // Synthetic "schema 0": the stimulus at top level, `title` instead of `name`, no analysis.
  const target = fullExperiment();
  const v1 = docOf(target);
  const { name, recipe, ...rest } = v1;
  const v0 = { ...rest, schemaVersion: 0, title: name, stimulus: recipe.stimulus,
    repeats: recipe.repeats };
  const fixture = {
    1: ({ title, stimulus, repeats, ...others }) => ({ ...others, name: title,
      recipe: { stimulus, repeats, analysis: { fftSize: 65536, smoothing: '1/6',
        window: ALGORITHMS.window } } }),
  };
  const v0Text = JSON.stringify(v0);
  const v = validateExperiment(v0Text, { ...OPTS, migrations: fixture });
  assert.ok(v.ok, v.errors && formatErrors(v.errors));
  assert.strictEqual(v.migratedFrom, 0);
  assert.deepStrictEqual(v.experiment, target);
  assert.strictEqual(validateExperiment(v0Text, { ...OPTS, migrations: {} }).ok, false);
});

// ---------------------------------------------------------------- hash (§100)

function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  const out = {};
  for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k]);
  return out;
}

test('canonicalJson: sorted keys, no whitespace, strict', () => {
  assert.strictEqual(canonicalJson({ b: [1, { d: 2, c: -0 }], a: 'x', u: undefined, n: null }),
    '{"a":"x","b":[1,{"c":0,"d":2}],"n":null}');
  assert.strictEqual(canonicalJson(Float32Array.from([0.5, 2])), '[0.5,2]');
  assert.strictEqual(canonicalJson({ 'é': 1, z: 2, A: 3 }), '{"A":3,"z":2,"é":1}');
  for (const bad of [NaN, Infinity, () => 1, 10n, [undefined], Symbol('s')]) {
    assert.throws(() => canonicalJson(bad), TypeError);
  }
  const cyc = {};
  cyc.self = cyc;
  assert.throws(() => canonicalJson(cyc), /cycle/);
});

test('configHash: stable across key order; ignores names, notes, timestamps, results', () => {
  const e = fullExperiment();
  const h = configHash(e, { sha256Hex });
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.strictEqual(configHash(reverseKeys(e), { sha256Hex }), h);
  assert.strictEqual(configHash(baseExperiment(), { sha256Hex }), h, 'results do not count');
  const ignored = [
    (x) => { x.name = 'Other'; },
    (x) => { x.environment.notes = 'other notes'; },
    (x) => { x.provenance.createdAt = '2030-01-01T00:00:00.000Z'; },
    (x) => { x.measurement.startedAt = null; },
    (x) => { x.experimentId = 'another'; },
    (x) => { x.quality = null; },
    (x) => { x.results = { transfer: null, ir: null, rta: null }; },
    (x) => { x.measurement.runs = []; },
    (x) => { x.input.device.label = 'Other mic'; },
    (x) => { x.calibration.frequency.name = 'renamed profile'; },
    (x) => { x.calibration.level.createdAt = null; },
    (x) => { x.provenance.build.dirty = true; },
  ];
  for (const mutate of ignored) {
    const x = validateExperiment(experimentToJson(e), OPTS).experiment;
    mutate(x);
    assert.strictEqual(configHash(x, { sha256Hex }), h, mutate.toString());
  }
  const counted = [
    (x) => { x.recipe.stimulus.duration = 5; },
    (x) => { x.recipe.repeats = 3; },
    (x) => { x.recipe.analysis.smoothing = '1/3'; },
    (x) => { x.calibration.frequency.id = 'b'.repeat(64); },
    (x) => { x.calibration.frequency = null; },
    (x) => { x.calibration.level.offsetDb = 120; },
    (x) => { x.measurement.sampleRate = 44100; },
    (x) => { x.algorithms.transfer = 'oscilla.transfer.v2'; },
    (x) => { x.oscillaVersion = '3.0.1'; },
    (x) => { x.oscillaCommit = 'f'.repeat(40); },
  ];
  for (const mutate of counted) {
    const x = validateExperiment(experimentToJson(e), OPTS).experiment;
    mutate(x);
    assert.notStrictEqual(configHash(x, { sha256Hex }), h, mutate.toString());
  }
  assert.deepStrictEqual(Object.keys(configSelection(e)).sort(), ['algorithms', 'build',
    'calibration', 'recipe', 'sampleRate', 'v']);
  // The default is the bundled calibration/sha256.js, identical to node:crypto.
  assert.strictEqual(configHash(e), configHash(e, { sha256Hex }));
  assert.throws(() => configHash(e, { sha256Hex: 'nope' }), TypeError);
});

test('withConfigHash stamps provenance and survives the round trip', () => {
  const e = fullExperiment();
  const stamped = withConfigHash(e, configHash(e, { sha256Hex }));
  assert.strictEqual(e.provenance.configHash, null, 'input not modified');
  const v = validateExperiment(experimentToJson(stamped), OPTS);
  assert.ok(v.ok);
  assert.strictEqual(v.experiment.provenance.configHash, sha256Hex(configCanonical(e)));
  assert.throws(() => withConfigHash(e, 'ABC'), TypeError);
  const changed = withResults(stamped, { algorithms: { transfer: ALGORITHMS.transfer } });
  assert.strictEqual(changed.provenance.configHash, null, 'a configuration change clears it');
});

const SHA_PATH = fileURLToPath(new URL('../../src/js/calibration/sha256.js', import.meta.url));
test('calibration/sha256.js agrees with node:crypto when present', {
  skip: existsSync(SHA_PATH) ? false : 'src/js/calibration/sha256.js not in this tree yet',
}, async () => {
  const mod = await import('../../src/js/calibration/sha256.js');
  const e = fullExperiment();
  const hex = await configHash(e, { sha256Hex: mod.sha256Hex });
  assert.strictEqual(hex, configHash(e, { sha256Hex }));
});

// ---------------------------------------------------------------- compare (§59-§60)

test('compareExperiments: equivalent experiments are compatible', () => {
  const a = fullExperiment();
  const b = fullExperiment({ name: 'Second take', id: 'take-2' });
  const r = compareExperiments([a, b]);
  assert.strictEqual(r.compatible, true);
  assert.strictEqual(r.sameConfiguration, true);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.common['measurement.sampleRate'], 48000);
  assert.strictEqual(r.common['algorithms.transfer'], ALGORITHMS.transfer);
  assert.deepStrictEqual(r.differences, []);
});

test('compareExperiments flags calibration, sample rate and algorithm differences', () => {
  const a = fullExperiment();
  const b = withResults(fullExperiment({
    id: 'other', sampleRate: 44100,
    calibration: { frequency: { id: 'b'.repeat(64), name: 'Other mic' }, level: null },
    input: { device: { label: 'USB mic', id: null } },
  }), { algorithms: { ...a.algorithms, transfer: 'oscilla.transfer.v2' } });
  const before = experimentToJson(a);
  const r = compareExperiments([a, b]);
  assert.strictEqual(experimentToJson(a), before);
  assert.strictEqual(r.compatible, false);
  assert.strictEqual(r.sameConfiguration, false);
  const sev = Object.fromEntries(r.differences.map((d) => [d.field, d.severity]));
  assert.strictEqual(sev['calibration.frequency'], 'warn');
  assert.strictEqual(sev['calibration.level'], 'warn');
  assert.strictEqual(sev['measurement.sampleRate'], 'warn');
  assert.strictEqual(sev['algorithms.transfer'], 'warn');
  assert.strictEqual(sev['input.device.label'], 'info');
  assert.deepStrictEqual(r.differences.find((d) => d.field === 'measurement.sampleRate').values,
    [48000, 44100]);
  assert.ok(r.warnings.some((w) => /sample rates/.test(w)));
  assert.ok(r.warnings.some((w) => /frequency calibration/.test(w)));
  assert.ok(r.warnings.some((w) => /algorithms\.transfer/.test(w)));
  const c = fullExperiment({ id: 'stim' });
  c.recipe = createRecipe({ stimulus: { ...SWEEP, duration: 5 }, repeats: 5,
    analysis: a.recipe.analysis });
  const rs = compareExperiments([a, c]);
  assert.strictEqual(rs.compatible, false);
  assert.ok(rs.differences.some((d) => d.field === 'recipe.stimulus' && d.severity === 'warn'));
  assert.throws(() => compareExperiments([a]), RangeError);
});

test('responseDelta: A − B over the overlapping valid range only, never normalized', () => {
  const a = transferResult(400, { lo: 10, hi: 24000, fn: () => 3 });
  a.validRange = [20, 10000];
  const b = transferResult(300, { lo: 5, hi: 22000, fn: () => 1 });
  b.validRange = [100, 20000];
  const before = Array.from(a.magnitudeDb);
  const r = responseDelta(a, b, { pointsPerOctave: 24 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.range, [100, 10000]);
  assert.strictEqual(r.frequencies[0], 100);
  assert.strictEqual(r.frequencies[r.frequencies.length - 1], 10000);
  assert.strictEqual(r.frequencies.length, Math.ceil(Math.log2(100) * 24) + 1);
  for (let i = 1; i < r.frequencies.length; i++) {
    assert.ok(r.frequencies[i] > r.frequencies[i - 1]);
  }
  for (const d of r.deltaDb) assert.ok(Math.abs(d - 2) < 1e-12, 'offset kept, not normalized');
  assert.deepStrictEqual(Array.from(a.magnitudeDb), before);
  // A function linear in log-frequency is reproduced exactly by log-frequency interpolation.
  const slope = transferResult(97, { lo: 20, hi: 20000, fn: (f) => 6 * Math.log2(f / 100) });
  const flat = transferResult(50, { lo: 20, hi: 20000, fn: () => 0 });
  const s = responseDelta({ results: { transfer: slope } }, { results: { transfer: flat } });
  assert.ok(s.ok);
  assert.strictEqual(s.pointsPerOctave, 48);
  s.frequencies.forEach((f, i) => {
    assert.ok(Math.abs(s.deltaDb[i] - 6 * Math.log2(f / 100)) < 1e-9, `at ${f} Hz`);
  });
  const lo = transferResult(50, { lo: 20, hi: 200 });
  lo.validRange = [20, 200];
  const hi = transferResult(50, { lo: 1000, hi: 20000 });
  hi.validRange = [1000, 20000];
  assert.deepStrictEqual(responseDelta(lo, hi),
    { ok: false, reason: 'the valid frequency ranges do not overlap' });
  assert.strictEqual(responseDelta(a, { results: { transfer: null } }).ok, false);
});

// ---------------------------------------------------------------- CSV (§163-§164, §223)

const SHORT = () => {
  const t = transferResult(3, { lo: 20, hi: 20000, fn: () => 1.5 });
  t.frequencies = Float64Array.from([10, 1000, 20000]);
  t.magnitudeDb = Float64Array.from([-3, 1.5, -0.25]);
  t.snrDb = Float64Array.from([5, 30, 12.5]);
  t.phaseDeg = null;
  return t;
};
const META = Object.freeze({
  oscillaVersion: '9.8.7', oscillaCommit: COMMIT, experimentId: 'exp-1', algorithm: null,
  sampleRate: 48000, calibration: { frequency: null, level: null },
});

test('transferCsv: metadata header, explicit unit columns, raw by default', () => {
  const csv = transferCsv(SHORT(), META);
  assert.strictEqual(csv, [
    '# OSCILLA transfer function (frequency response)',
    '# oscilla_version: 9.8.7',
    `# oscilla_commit: ${COMMIT}`,
    '# experiment_id: exp-1',
    '# algorithm: oscilla.transfer.v1',
    '# sample_rate_hz: 48000',
    '# calibration: UNCALIBRATED (frequency profile none; levels: Relative level · dBFS-like '
      + '/ analyser-relative scale)',
    '# view: RAW (each point the power mean of its analysis-grid band; no smoothing beyond that, '
      + 'not normalized)',
    '# column frequency_hz: Hz',
    '# column magnitude_db_relative: dB re unity digital transfer (capture/stimulus ratio), '
      + 'uncorrected',
    '# column magnitude_db_corrected: empty (no frequency calibration applied)',
    '# column snr_db: dB, ESTIMATED signal-to-noise ratio',
    '# column reliable: 1 = inside the valid range 20-20000 Hz, 0 = outside (quality mask not '
      + 'available)',
    '# column phase_deg: empty (phase not measured: no reason recorded)',
    'frequency_hz,magnitude_db_relative,magnitude_db_corrected,snr_db,reliable,phase_deg',
    '10,-3,,5,0,',
    '1000,1.5,,30,1,',
    '20000,-0.25,,12.5,1,',
    '',
  ].join('\n'));
  assert.ok(!/(^|\n)x,y/.test(csv));
  assert.throws(() => transferCsv(SHORT(), META, { correctedDb: [1, 2, 3] }),
    /no frequency calibration/);
  assert.throws(() => transferCsv(SHORT(), META, { view: 'pretty' }), RangeError);
});

test('transferCsv: corrected column and labelled derived view', () => {
  const meta = csvMeta(fullExperiment());
  const csv = transferCsv(SHORT(), meta, {
    view: 'derived', derivation: { smoothing: '1/6 octave (oscilla.smoothing.fractional-octave.v1)',
      normalization: null },
    correctedDb: Float64Array.from([-2, 1, 0.5]), reliable: [1, 1, 0],
  });
  const lines = csv.split('\n');
  assert.strictEqual(lines[6], '# calibration: frequency profile "UMIK-1 #7001", '
    + 'SPL CALIBRATED (94 dB SPL at 1 kHz)');
  assert.strictEqual(lines[7], '# view: DERIVED, not raw data (smoothing: 1/6 octave '
    + '(oscilla.smoothing.fractional-octave.v1); normalization: none)');
  // G19: under a valid level calibration the transfer columns stay ratios, never dB SPL.
  assert.strictEqual(lines[10], '# column magnitude_db_corrected: dB re unity digital transfer '
    + '(capture/stimulus ratio), frequency-profile corrected (microphone deviation removed)');
  assert.strictEqual(lines[12],
    '# column reliable: 1 = reliable, 0 = not (quality assessment mask)');
  assert.strictEqual(lines[14],
    'frequency_hz,magnitude_db_relative,magnitude_db_corrected,snr_db,reliable,phase_deg');
  assert.deepStrictEqual(lines.slice(15, 18), ['10,-3,-2,5,1,', '1000,1.5,1,30,1,',
    '20000,-0.25,0.5,12.5,0,']);
  // m3: a measured phase is exported in degrees.
  const withPhase = transferCsv({ ...SHORT(), phaseDeg: Float64Array.from([10, -170.5, 0]) },
    META).split('\n');
  assert.ok(withPhase.includes('# column phase_deg: degrees, wrapped to (−180, 180], alignment '
    + 'delay removed'));
  assert.ok(withPhase.includes('1000,1.5,,30,1,-170.5'));
  const notRequested = transferCsv({ ...SHORT(), phaseReason: 'NOT_REQUESTED' }, META);
  assert.match(notRequested, /# column phase_deg: empty \(phase not measured: phase not requested\)/);
  assert.ok(lines.slice(8).every((l) => !/SPL/.test(l)), 'no SPL in transfer columns or rows');
  assert.throws(() => transferCsv(SHORT(), meta, { view: 'derived' }), /derived view needs/);
  assert.throws(() => transferCsv(SHORT(), meta, { correctedDb: [1] }), /expected 3/);
  assert.throws(() => transferCsv(SHORT(), meta, { calibratedDb: [1, 2, 3] }),
    /replaced by correctedDb/);
  // A level calibration alone (no frequency profile) does not allow a corrected column.
  const levelOnly = { ...meta, calibration: { ...meta.calibration, frequency: null } };
  assert.throws(() => transferCsv(SHORT(), levelOnly, { correctedDb: [1, 2, 3] }),
    /no frequency calibration/);
  const unknown = transferCsv(SHORT(), {});
  assert.match(unknown, /# oscilla_version: Unknown\n# oscilla_commit: Unknown\n/);
  assert.match(unknown, /# sample_rate_hz: 48000\n/);
  const injected = transferCsv(SHORT(), { ...META, experimentId: 'a\nfrequency_hz,1' });
  assert.match(injected, /# experiment_id: a frequency_hz,1\n/);
});

test('irCsv and rtaCsv: exact columns and units', () => {
  const ir = { ...irResult(), samples: Float32Array.from([0, 0.5, -0.25]), peakIndex: 1,
    peakTimeS: 1 / 48000 };
  const csv = irCsv(ir, META).split('\n');
  assert.deepStrictEqual(csv.slice(7, 16), [
    '# view: RAW (each point the power mean of its analysis-grid band; no smoothing beyond that, '
      + 'not normalized)',
    `# peak: sample 1, ${1 / 48000} s`,
    '# capture_offset_s: 0.0123',
    '# window_s: 0-0.08',
    '# column time_s: s from the first IR sample',
    // m4: an IR sample of the capture/stimulus transfer is a ratio, not a level re full scale.
    '# column amplitude: dimensionless transfer ratio (impulse response of capture / stimulus; '
      + 'a unity digital system peaks near 1), original scale, not normalized',
    'time_s,amplitude',
    '0,0',
    `${1 / 48000},0.5`,
  ]);
  assert.strictEqual(csv[16], `${2 / 48000},-0.25`);
  assert.strictEqual(csv[4], '# algorithm: oscilla.ir.log-sweep.v1');
  const rta = rtaCsv(rtaResult(), META).split('\n');
  assert.strictEqual(rta[0], '# OSCILLA real-time analyzer bands (octave)');
  assert.deepStrictEqual(rta.slice(-6), [
    '# column level_db_relative: dB relative (dBFS-like)',
    'band_nominal_hz,band_lo_hz,band_hi_hz,level_db_relative',
    '31.5,22.1,44.2,-42.5',
    '63,44.2,88.4,-38.25',
    '125,88.4,176.8,-40',
    '',
  ]);
  const plain = rtaCsv([{ nominal: 1000, lo: 891, hi: 1122, levelDb: -20 }], META);
  assert.match(plain, /\n1000,891,1122,-20\n$/);
  assert.match(plain, /# algorithm: Unknown\n/);
});

// ---------------------------------------------------------------- storage (§54-§55, §225-§227)

test('memory store: CRUD with validation and explicit delete', async () => {
  const store = createMemoryStore(OPTS);
  assert.deepStrictEqual(await store.list(), []);
  const e = fullExperiment();
  assert.strictEqual(await store.put(e), e.experimentId);
  const back = await store.get(e.experimentId);
  assert.deepStrictEqual(back, e);
  assert.notStrictEqual(back, e);
  const list = await store.list();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(Object.keys(list[0]), ['experimentId', 'name', 'createdAt',
    'schemaVersion', 'oscillaVersion', 'status', 'sizeBytes']);
  assert.strictEqual(list[0].status, 'USABLE');
  const later = fullExperiment({ id: 'later', now: '2026-10-05T00:00:00.000Z' });
  await store.put(later);
  assert.deepStrictEqual((await store.list()).map((s) => s.experimentId),
    ['later', e.experimentId]);
  await assert.rejects(store.put({ ...e, name: 42 }), (err) => err instanceof ExperimentStoreError
    && err.code === 'invalid');
  assert.strictEqual(await store.get('missing'), null);
  assert.ok((await store.estimate()).usage > 0);
  assert.strictEqual(await store.delete(e.experimentId), true);
  assert.strictEqual(await store.delete(e.experimentId), false);
  assert.strictEqual(await store.get(e.experimentId), null);
  assert.strictEqual((await store.list()).length, 1);
});

// A minimal in-memory IndexedDB: open/upgrade, object stores with keyPath, readonly/readwrite
// transactions with put/get/getAll/delete, async events, rollback on abort, and switches for
// quota errors (on a request, or when the transaction commits) and open failures.
function fakeIndexedDB() {
  const dbs = new Map();
  const state = { upgrades: [], quota: null, openError: null, throwOnOpen: null };
  const later = (fn) => setImmediate(fn);
  const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  class Tx {
    constructor(rec, names, mode) {
      this.rec = rec;
      this.names = names;
      this.mode = mode;
      this.pending = 0;
      this.finished = false;
      this.error = null;
      this.oncomplete = this.onerror = this.onabort = null;
      this.snapshot = new Map([...rec.stores].map(([n, s]) => [n, new Map(s.data)]));
      later(() => this.settle());
    }
    objectStore(name) {
      if (!this.names.includes(name)) throw new DOMException('not in scope', 'NotFoundError');
      const s = this.rec.stores.get(name);
      return {
        put: (value) => this.op(() => {
          if (this.mode !== 'readwrite') throw new DOMException('readonly', 'ReadOnlyError');
          if (state.quota === 'request') throw quotaError();
          s.data.set(value[s.keyPath], structuredClone(value));
          return value[s.keyPath];
        }),
        get: (key) => this.op(() => (s.data.has(key) ? structuredClone(s.data.get(key))
          : undefined)),
        getAll: () => this.op(() => [...s.data.values()].map((v) => structuredClone(v))),
        delete: (key) => this.op(() => {
          if (this.mode !== 'readwrite') throw new DOMException('readonly', 'ReadOnlyError');
          s.data.delete(key);
          return undefined;
        }),
      };
    }
    op(fn) {
      if (this.finished) throw new DOMException('inactive', 'TransactionInactiveError');
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      this.pending++;
      later(() => {
        this.pending--;
        if (this.finished) return;
        try {
          req.result = fn();
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (err) {
          req.error = err;
          const ev = { target: req, prevented: false, preventDefault() { this.prevented = true; } };
          if (req.onerror) req.onerror(ev);
          if (this.onerror) this.onerror(ev);
          if (!ev.prevented) this.abort(err);
        }
        this.settle();
      });
      return req;
    }
    settle() {
      later(() => {
        if (this.finished || this.pending) return;
        if (state.quota === 'commit' && this.mode === 'readwrite') {
          this.abort(quotaError());
          return;
        }
        this.finished = true;
        if (this.oncomplete) this.oncomplete({});
      });
    }
    abort(err = new DOMException('aborted', 'AbortError')) {
      if (this.finished) throw new DOMException('finished', 'InvalidStateError');
      this.finished = true;
      this.error = err;
      for (const [n, data] of this.snapshot) this.rec.stores.get(n).data = data;
      later(() => this.onabort && this.onabort({}));
    }
  }
  const indexedDB = {
    open(name, version) {
      if (state.throwOnOpen) throw state.throwOnOpen;
      const req = { result: null, error: null, transaction: null, onsuccess: null, onerror: null,
        onupgradeneeded: null, onblocked: null };
      later(() => {
        if (state.openError) {
          req.error = state.openError;
          if (req.onerror) req.onerror({ target: req, preventDefault() {} });
          return;
        }
        if (!dbs.has(name)) dbs.set(name, { version: 0, stores: new Map() });
        const rec = dbs.get(name);
        const db = {
          closed: false,
          objectStoreNames: { contains: (n) => rec.stores.has(n) },
          createObjectStore: (n, { keyPath }) => rec.stores.set(n, { keyPath, data: new Map() }),
          transaction: (names, mode = 'readonly') => {
            if (db.closed) throw new DOMException('closed', 'InvalidStateError');
            return new Tx(rec, [].concat(names), mode);
          },
          close: () => { db.closed = true; },
        };
        req.result = db;
        if (version > rec.version) {
          state.upgrades.push([rec.version, version]);
          const oldVersion = rec.version;
          rec.version = version;
          req.transaction = { abort() {} };
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, dbs, state };
}

test('IndexedDB store: open, upgrade from empty, CRUD, reopen keeps data', async () => {
  const fake = fakeIndexedDB();
  const store = await openExperimentStore({ indexedDB: fake.indexedDB, name: 't1', ...OPTS });
  assert.strictEqual(store.kind, 'indexeddb');
  assert.deepStrictEqual(fake.state.upgrades, [[0, DB_VERSION]]);
  // DB version 2 (V3.1, V426) adds the Studio partition next to the experiment stores.
  assert.deepStrictEqual([...fake.dbs.get('t1').stores.keys()], ['experiments', 'summaries',
    'studio', 'studioSummaries']);
  const e = fullExperiment();
  assert.strictEqual(await store.put(e), e.experimentId);
  assert.deepStrictEqual(await store.get(e.experimentId), e);
  const stored = fake.dbs.get('t1').stores.get('experiments').data.get(e.experimentId);
  assert.strictEqual(stored.results.ir.samples.encoding, 'base64-le', 'stored in file form');
  const list = await store.list();
  assert.deepStrictEqual(list.map((s) => s.experimentId), [e.experimentId]);
  assert.strictEqual(list[0].name, 'MacBook speakers — desk');
  assert.strictEqual(await store.get('nope'), null);
  await store.put(fullExperiment({ id: 'second' }));
  store.close();

  const again = await openExperimentStore({ indexedDB: fake.indexedDB, name: 't1', ...OPTS });
  assert.deepStrictEqual(fake.state.upgrades, [[0, DB_VERSION]],
    'no upgrade at the current DB version');
  assert.strictEqual((await again.list()).length, 2, 'reopening never deletes data');
  assert.strictEqual(await again.delete(e.experimentId), true);
  assert.strictEqual(await again.delete(e.experimentId), false);
  assert.strictEqual(await again.get(e.experimentId), null);
  assert.deepStrictEqual((await again.list()).map((s) => s.experimentId), ['second']);
  assert.deepStrictEqual(await again.estimate(), { usage: null, quota: null, persistent: null });
  const withStorage = await openExperimentStore({ indexedDB: fake.indexedDB, name: 't1',
    storage: { estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => false },
  });
  assert.deepStrictEqual(await withStorage.estimate(), { usage: 10, quota: 100,
    persistent: false });
});

test('IndexedDB store: quota errors map to code "quota" and roll back', async () => {
  const fake = fakeIndexedDB();
  const store = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'q', ...OPTS });
  const e = fullExperiment();
  for (const mode of ['request', 'commit']) {
    fake.state.quota = mode;
    await assert.rejects(store.put(e), (err) => err instanceof ExperimentStoreError
      && err.code === 'quota' && /export or delete/.test(err.message), mode);
    fake.state.quota = null;
    assert.deepStrictEqual(await store.list(), [], `${mode}: nothing half-written`);
    assert.strictEqual(await store.get(e.experimentId), null);
  }
  await store.put(e);
  assert.strictEqual((await store.list()).length, 1);
  await assert.rejects(store.put({ ...e, recipe: null }), (err) => err.code === 'invalid');
});

test('IndexedDB store: open failures are "unavailable"; corrupt records are reported', async () => {
  await assert.rejects(openExperimentStore({}), (err) => err.code === 'unavailable');
  const thrower = fakeIndexedDB();
  thrower.state.throwOnOpen = new DOMException('file:// denied', 'SecurityError');
  await assert.rejects(openExperimentStore({ indexedDB: thrower.indexedDB }),
    (err) => err instanceof ExperimentStoreError && err.code === 'unavailable');
  const failing = fakeIndexedDB();
  failing.state.openError = new DOMException('broken', 'UnknownError');
  await assert.rejects(openExperimentStore({ indexedDB: failing.indexedDB }),
    (err) => err.code === 'unavailable' && /broken/.test(err.message));
  const fb = await openExperimentStoreOrMemory({ indexedDB: failing.indexedDB, ...OPTS });
  assert.strictEqual(fb.persistent, false);
  assert.strictEqual(fb.store.kind, 'memory');
  assert.strictEqual(fb.error.code, 'unavailable');
  const e = fullExperiment();
  await fb.store.put(e);
  assert.deepStrictEqual(await fb.store.get(e.experimentId), e, 'the app keeps working');

  const fake = fakeIndexedDB();
  const store = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'c', ...OPTS });
  await store.put(e);
  fake.dbs.get('c').stores.get('experiments').data.get(e.experimentId).name = 42;
  await assert.rejects(store.get(e.experimentId), (err) => err.code === 'corrupt');
  const ok = await openExperimentStoreOrMemory({ indexedDB: fake.indexedDB, name: 'c' });
  assert.strictEqual(ok.persistent, true);
  assert.strictEqual(ok.error, null);
});
