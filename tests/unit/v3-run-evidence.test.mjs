// ADR 0044: evidence on a run. experiments/evidence.js answers two questions about a stored
// run, only from the fields the record stores, as a list and a checklist and never a score:
//   - "What produced this value?": the lineage of one stored result point (analysis, capture,
//     calibration as applied, run, definition version, build, Studio provenance);
//   - "Can I repeat this?": a reproducibility checklist, each item recorded / partial / not
//     recorded with a one-line reason.
// The records are the deterministic TEST CONTEXT fixtures of the V3 UI suite, plus runs of the
// real MeasurementEngine on a synthetic microphone-like io (a device label and processing
// flags, a frequency profile and a level calibration bound to that input).
//   node --test tests/unit/v3-run-evidence.test.mjs
//
// evidence.js is imported dynamically, so on a build without it each test fails on its own.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import * as definition from '../../src/js/experiments/definition.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { createMeasurementEngine, assessMeasurement } from '../../src/js/measurement/engine.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { withStudioProvenance } from '../../src/js/studio/provenance.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import {
  buildFixtures, NOW, FIXTURE_BUILD, FIXTURE_RECIPE,
} from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const ev = () => import('../../src/js/experiments/evidence.js');
const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const clone = (v) => structuredClone(v);
const restamp = (e, version = hash.RESULT_HASH_VERSION) => hash.withResultHash(
  hash.withConfigHash(e, hash.configHash(e)), hash.resultHash(e, { version }), version);
const valid = (e) => {
  const v = validateExperiment(schema.experimentToJson(e), OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  return v.experiment;
};

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

// ---------------------------------------------------------------- a microphone-like run

const SR = 8000;
const RECIPE = Object.freeze({
  stimulus: { kind: 'log-sweep', duration: 1, level: 'low', f1: 50, f2: 3000 },
  repeats: 1, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});
const APPLIED = Object.freeze({ echoCancellation: false, noiseSuppression: false,
  autoGainControl: false, sampleRate: SR, channelCount: 1 });

/** A synthetic microphone-like io: a gain of 0.5 plus a little noise, no TEST CONTEXT. */
function micIo(label = 'Synthetic mic') {
  let t = 1;
  let run = 0;
  const constraints = { requested: null, applied: { ...APPLIED } };
  const device = { label, id: 'synthetic-mic' };
  const noise = (seed, n) => {
    const r = mulberry32(seed);
    return Float32Array.from({ length: n }, () => (r() - 0.5) * 2e-3);
  };
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: { ok: true, device, constraints }, inputLevel: null,
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' }, testContext: null };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: noise(5, Math.round(seconds * SR)), startedAt,
        preRoll: 0, postRoll: 0, constraints, device };
    },
    async runStimulus(stimulus, { preRollS, postRollS, notBefore }) {
      const pre = Math.round(preRollS * SR);
      const x = stimulus.samples;
      const samples = noise(10 + run, pre + x.length + Math.round(postRollS * SR));
      for (let i = 0; i < x.length; i++) samples[pre + i] += 0.5 * x[i];
      run += 1;
      const startedAt = Math.max(t + 0.01, notBefore ?? -Infinity);
      t = startedAt + samples.length / SR;
      return { sampleRate: SR, samples, startedAt, stimulusStartAt: startedAt + preRollS,
        preRoll: preRollS, postRoll: postRollS, constraints, device };
    },
    cancel() {},
    dispose() {},
  };
}

const PROFILE = createFrequencyProfile({ name: 'Mic A', points: [[20, 1], [1000, 0],
  [4000, -1]] });
const BINDING = { device: { id: 'synthetic-mic' }, constraints: { applied: { ...APPLIED } },
  sampleRate: SR };
const level = (input) => createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30, conditions: 'unit: calibrator', createdAt: NOW, method: 'manual',
  input });
const BUILD = { version: '9.9.9-test', commit: 'abcdef1234567', channel: 'test',
  sourceDigest: 'd'.repeat(64), artifactSha256: 'a'.repeat(64), dirty: false };

const mic = async (calibration, label) => {
  const result = await createMeasurementEngine({ io: micIo(label), assess: assessMeasurement,
    clock: { wall: () => Date.parse(NOW), mono: () => 0 } })
    .measure(JSON.parse(JSON.stringify(RECIPE)), { calibration });
  assert.equal(result.state, 'COMPLETE');
  return valid(experimentFromResult(result, { now: NOW, id: 'mic-run', build: BUILD,
    name: 'Desk microphone', notes: 'Desk, 1 m from the speaker' }));
};

const byId = (list, id) => list.find((x) => x.id === id);
const ids = (list) => list.map((x) => x.id);
const allText = (r) => [r.point ? r.point.text : '', ...r.lineage.map((l) => `${l.label} ${l
  .text}`), ...r.checklist.map((c) => `${c.label} ${c.stateText} ${c.reason}`)].join(' | ');

// ---------------------------------------------------------------- the result point

test('the result point is a stored grid value with its unit, frequency and reliability',
  async () => {
    const { resultPoint, defaultEvidenceHz } = await ev();
    const { a } = await fx();
    const e = a.experiment;
    assert.equal(defaultEvidenceHz(e), 1000, '1 kHz lies inside the stored grid');
    const p = resultPoint(e, 1000);
    const f = e.results.transfer.frequencies;
    assert.equal(p.hz, f[p.index]);
    assert.ok(Math.abs(Math.log2(p.hz / 1000)) < 1 / 48, 'the nearest grid point');
    assert.equal(p.value, e.results.transfer.magnitudeDb[p.index], 'the stored value, unchanged');
    assert.equal(p.source, 'aggregate', 'three repeats: the aggregate centre');
    assert.equal(p.repeats, 3);
    assert.equal(p.reliable, e.quality.mask.reliable[p.index] === 1);
    assert.match(p.text, /dB re unity digital transfer \(capture\/stimulus ratio\)/);
    assert.match(p.text, /mean of 3 repeats/);
    assert.match(p.text, /reliable \(stored quality mask\)/);
    // Another frequency, and one outside the grid: clamped to the stored ends, said so.
    const low = resultPoint(e, 5);
    assert.equal(low.index, 0);
    assert.match(low.text,
      /the stored grid point nearest 5 Hz, which lies outside the stored range/);
    // A sweep that does not reach 1 kHz takes its geometric centre.
    const narrow = clone(e);
    narrow.results = { ...narrow.results, transfer: { ...e.results.transfer,
      frequencies: Float64Array.from([2000, 4000, 8000]),
      magnitudeDb: Float64Array.from([-1, -2, -3]) }, aggregate: undefined };
    assert.equal(defaultEvidenceHz(narrow), 4000);
    // No stored response: no point, and nothing is invented.
    const none = { ...e, results: { transfer: null, ir: null, rta: null } };
    assert.equal(resultPoint(none, 1000), null);
    assert.equal(defaultEvidenceHz(none), null);
  });

// ---------------------------------------------------------------- the lineage

test('lineage of a derived, uncalibrated TEST CONTEXT run: every link from a stored field',
  async () => {
    const { runEvidence } = await ev();
    const { a } = await fx();
    const r = runEvidence(a.experiment, { hz: 1000 });
    assert.deepEqual(ids(r.lineage), ['result', 'analysis', 'capture', 'calibration', 'run',
      'definition', 'build'], 'no Studio link: the run has no Studio block');
    const t = (id) => byId(r.lineage, id).text;
    assert.match(t('result'), /dB re unity digital transfer/);
    assert.match(t('analysis'), /oscilla\.transfer\.v3 \(transfer, version 3\)/);
    assert.match(t('analysis'), /oscilla\.aggregate\.v1/);
    assert.match(t('analysis'), /oscilla\.confidence\.v4/);
    assert.match(t('capture'), /TEST CONTEXT/);
    assert.match(t('capture'), /input device not exposed/);
    assert.match(t('capture'), /48 kHz/);
    assert.match(t('capture'), /processing flags not recorded/);
    assert.match(t('capture'), /master output gain 0\.08/);
    assert.equal(t('calibration'), 'uncalibrated: no frequency profile and no level '
      + 'calibration applied');
    assert.match(t('run'), /^fixture-a/);
    assert.match(t('run'), /3 of 3 repeats recorded \(run-1 … run-3/);
    assert.match(t('run'), /each 2\.75 s of capture on the audio clock/);
    assert.match(t('run'), /created 2026-10-02 10:00 UTC \(wall clock\)/);
    assert.match(t('run'), /original \(not a repeat\)/);
    assert.match(t('definition'), /^derived from the run's own recipe, not authored/);
    assert.match(t('definition'), new RegExp(a.experiment.definition.hash.slice(0, 12)));
    assert.match(t('build'), /^OSCILLA 0\.0\.0-fixture/);
    assert.match(t('build'), /source digest not recorded/);
    assert.match(t('build'), /artifact SHA-256 not recorded/);
    assert.ok(!/SPL/.test(allText(r)), 'no SPL for an uncalibrated run');
  });

test('lineage: a link is absent when its block is absent; a missing field is "not recorded"',
  async () => {
    const { evidenceLineage } = await ev();
    const { a } = await fx();
    const base = a.experiment;
    const without = (mut) => {
      const e = clone(base);
      mut(e);
      return ids(evidenceLineage(e, { hz: 1000 }));
    };
    assert.ok(!without((e) => { e.algorithms = {}; }).includes('analysis'));
    assert.ok(!without((e) => { e.provenance.build = null; }).includes('build'));
    assert.ok(!without((e) => { delete e.definition; }).includes('definition'));
    assert.ok(!without((e) => { delete e.calibration; }).includes('calibration'));
    assert.ok(!without((e) => { delete e.input; delete e.measurement.sampleRate; })
      .includes('capture'));
    assert.ok(!without((e) => { e.results = { transfer: null, ir: null, rta: null }; })
      .includes('result'));
    const e = clone(base);
    e.measurement.sampleRate = null;
    e.provenance.build = { ...e.provenance.build, version: null };
    const l = evidenceLineage(e, { hz: 1000 });
    assert.match(byId(l, 'capture').text, /sample rate not recorded/);
    assert.match(byId(l, 'build').text, /^OSCILLA version not recorded/);
  });

test('lineage of a calibrated microphone run: device, flags, profile and bound level', async () => {
  const { runEvidence } = await ev();
  const e = await mic({ frequency: PROFILE, level: level(BINDING) });
  assert.ok(e.calibration.level && e.calibration.frequency, 'the engine applied both');
  const r = runEvidence(e, { hz: 1000 });
  const t = (id) => byId(r.lineage, id).text;
  assert.match(t('capture'), /^input "Synthetic mic" \(device id recorded, hashed\)/);
  assert.match(t('capture'), /echo cancellation off, noise suppression off, auto gain control off/);
  assert.match(t('calibration'), new RegExp(`frequency profile "Mic A" \\(id ${PROFILE.id
    .slice(0, 12)}…\\)`));
  assert.match(t('calibration'), /oscilla\.calibration\.log-interp\.v1/);
  assert.match(t('calibration'), /level calibration offset \+124\.00 dB/);
  assert.match(t('calibration'), /bound to its input/);
  assert.match(t('calibration'), /applies to levels, not to this ratio/);
  assert.match(t('build'), /source digest dddddddddddd…/);
  assert.match(t('build'), /artifact SHA-256 aaaaaaaaaaaa…/);
  assert.match(t('build'), /commit abcdef1/);
  const c = (id) => byId(r.checklist, id);
  assert.equal(c('calibration').state, 'recorded');
  assert.equal(c('device').state, 'recorded');
  assert.equal(c('build').state, 'recorded');
  assert.equal(c('environment').state, 'recorded');
  assert.match(c('environment').reason, /Desk, 1 m/);
  // A level calibration bound to no input applies to every input: partial (ledger C1).
  const unbound = runEvidence(await mic({ frequency: null, level: level(null) }), { hz: 1000 });
  assert.match(byId(unbound.lineage, 'calibration').text, /not bound to an input/);
  assert.equal(byId(unbound.checklist, 'calibration').state, 'partial');
});

test('a contradicted calibration claim reads "uncalibrated (the stored claim is contradicted)"',
  async () => {
    const { runEvidence, CONTRADICTED_TEXT } = await ev();
    const { older } = await fx();
    const e = valid(older.experiment);
    assert.ok(e.calibration.level, 'the record still names the level calibration');
    const r = runEvidence(e, { hz: 1000 });
    const cal = byId(r.lineage, 'calibration').text;
    assert.equal(CONTRADICTED_TEXT, 'uncalibrated (the stored claim is contradicted)');
    assert.ok(cal.startsWith(CONTRADICTED_TEXT), cal);
    assert.match(cal, /calibration\.level/);
    assert.ok(!/offset/.test(cal), 'the contradicted offset is not presented as applied');
    const item = byId(r.checklist, 'calibration');
    assert.equal(item.state, 'partial');
    assert.match(item.reason, /contradicted/);
    assert.ok(!/SPL/.test(allText(r)), 'never SPL for a contradicted claim');
    assert.equal(byId(r.checklist, 'hash').state, 'recorded', 'its hash still verifies');
  });

test('Studio provenance: the graph the recipe was derived from, not a claim that all of it ran',
  async () => {
    const { runEvidence, evidenceLineage } = await ev();
    const { a } = await fx();
    const model = JSON.parse(JSON.stringify(templateModel('filter-automation')));
    const e = withStudioProvenance(clone(a.experiment), model);
    const studio = byId(evidenceLineage(e, { hz: 1000 }), 'studio');
    assert.ok(studio, 'present for a Studio record');
    assert.match(studio.text, /^the Studio graph the recipe was derived from/);
    assert.match(studio.text, new RegExp(`studioHash ${e.studio.studioHash.slice(0, 12)}…`));
    assert.match(studio.text, new RegExp(`${e.studio.execution.nodes.length} nodes, ${
      e.studio.execution.edges.length} edges`));
    assert.match(studio.text, /including nodes the measurement did not use/);
    assert.ok(!/\ball (?:of it|nodes) ran\b/.test(studio.text));
    assert.equal(byId(runEvidence(a.experiment).lineage, 'studio'), undefined);
  });

// ---------------------------------------------------------------- the checklist

test('checklist of the derived TEST CONTEXT fixture: states and reasons, no score', async () => {
  const { runEvidence, EVIDENCE_STATES } = await ev();
  const { a } = await fx();
  const r = runEvidence(a.experiment, { hz: 1000 });
  assert.deepEqual(ids(r.checklist), ['definition', 'recipe', 'algorithms', 'calibration',
    'device', 'build', 'hash', 'raw', 'environment']);
  const states = Object.fromEntries(r.checklist.map((c) => [c.id, c.state]));
  assert.deepEqual(states, { definition: 'partial', recipe: 'recorded', algorithms: 'recorded',
    calibration: 'recorded', device: 'missing', build: 'partial', hash: 'recorded',
    raw: 'missing', environment: 'recorded' });
  for (const c of r.checklist) {
    assert.ok(EVIDENCE_STATES.includes(c.state));
    assert.ok(c.reason && !/\n/.test(c.reason), `${c.id}: a one-line reason`);
    assert.ok(c.stateText && c.label, `${c.id}: its state in words`);
  }
  assert.match(byId(r.checklist, 'definition').reason, /derived from the run's own recipe/);
  assert.match(byId(r.checklist, 'calibration').reason, /uncalibrated, stated/);
  assert.match(byId(r.checklist, 'device').reason, /TEST CONTEXT/);
  assert.match(byId(r.checklist, 'build').reason, /no source digest, artifact SHA-256 or commit/);
  assert.equal(byId(r.checklist, 'hash').stateText, 'verified');
  assert.match(byId(r.checklist, 'hash').reason, /version 4/);
  // No score: nothing in the result is a number of items or a percentage.
  assert.ok(!('score' in r) && !('percent' in r));
  assert.ok(!/%|\bscore\b|\d+ of 9\b/.test(allText(r)));
});

test('checklist: authored definition stored, not stored, not matching; derived', async () => {
  const { reproducibilityChecklist } = await ev();
  const { a } = await fx();
  const def = definition.createDefinition({ id: 'def-loopback', name: 'Loopback', now: NOW,
    execution: definition.buildExecution({ recipe: definition.setupRecipe(FIXTURE_RECIPE) }) });
  const run = valid(experimentFromResult(a.result, { now: NOW, id: 'from-def',
    build: FIXTURE_BUILD, name: 'run', definition: definition.definitionRef(def) }));
  assert.equal(run.definition.derived, false);
  const item = (opts) => byId(reproducibilityChecklist(run, opts), 'definition');
  const stored = item({ match: 'match', name: 'Loopback' });
  assert.equal(stored.state, 'recorded');
  assert.match(stored.reason, /^authored definition "Loopback" version 1, stored in this browser/);
  for (const [match, words] of [['absent', /not stored in this browser/],
    ['mismatch', /does not match the stored definition/],
    ['unreadable', /could not be read/]]) {
    const x = item({ match });
    assert.equal(x.state, 'partial', match);
    assert.match(x.reason, words);
    assert.match(x.reason, /the run carries version 1's execution/);
  }
  assert.equal(byId(reproducibilityChecklist(a.experiment, { match: 'derived' }), 'definition')
    .state, 'partial');
});

test('checklist: device label, hashed id and flags; a missing label is never recorded',
  async () => {
    const { reproducibilityChecklist } = await ev();
    const e = await mic({ frequency: null, level: null });
    const item = (x) => byId(reproducibilityChecklist(x), 'device');
    assert.equal(item(e).state, 'recorded');
    const noLabel = clone(e);
    noLabel.input.device.label = null;
    assert.equal(item(noLabel).state, 'partial');
    assert.match(item(noLabel).reason, /did not expose a label/);
    const noFlags = clone(e);
    noFlags.input.constraints.applied = null;
    assert.equal(item(noFlags).state, 'partial');
    assert.match(item(noFlags).reason, /processing flags not recorded/);
    const nothing = clone(e);
    nothing.input = { device: { label: null, id: null }, constraints: { requested: null,
      applied: null } };
    assert.equal(item(nothing).state, 'missing');
    assert.match(item(nothing).reason, /browser did not expose/);
  });

test('checklist: the result hash is verified by recomputing it over the stored record',
  async () => {
    const { reproducibilityChecklist } = await ev();
    const { a } = await fx();
    const item = (x) => byId(reproducibilityChecklist(x), 'hash');
    assert.equal(item(a.experiment).state, 'recorded');
    const unstamped = clone(a.experiment);
    unstamped.provenance.resultHash = null;
    assert.equal(item(unstamped).state, 'missing');
    assert.equal(item(unstamped).stateText, 'not recorded');
    const tampered = clone(a.experiment);
    tampered.environment.notes = 'edited after the hash';
    tampered.measurement.startedAt = '2026-10-03T00:00:00.000Z';
    assert.equal(item(tampered).state, 'missing');
    assert.equal(item(tampered).stateText, 'does not verify');
    const v1 = restamp(clone(a.experiment), 1);
    assert.equal(item(v1).state, 'partial');
    assert.match(item(v1).reason, /version 1 covers the results only/);
    // An injected SHA-256 is used (the check is the recomputation, not the stored field).
    let calls = 0;
    const counted = () => { calls += 1; return '0'.repeat(64); };
    assert.equal(byId(reproducibilityChecklist(a.experiment, { sha256Hex: counted }), 'hash')
      .state, 'missing');
    assert.ok(calls > 0);
  });

test('raw capture is never retained, for every record', async () => {
  const { reproducibilityChecklist, RAW_CAPTURE_TEXT, itemText } = await ev();
  const { a, b, c, older } = await fx();
  assert.equal(RAW_CAPTURE_TEXT, 'not retained (OSCILLA stores the derived result, not the raw '
    + 'capture)');
  const model = JSON.parse(JSON.stringify(templateModel('filter-automation')));
  const records = [a.experiment, b.experiment, c.experiment, older.experiment,
    withStudioProvenance(clone(a.experiment), model), await mic({ frequency: PROFILE,
      level: level(BINDING) })];
  for (const e of records) {
    const raw = byId(reproducibilityChecklist(e), 'raw');
    assert.equal(raw.state, 'missing');
    assert.equal(raw.stateText, 'not retained');
    assert.equal(itemText(raw), RAW_CAPTURE_TEXT);
  }
});

test('no item is ever recorded without its field', async () => {
  const { reproducibilityChecklist } = await ev();
  const full = await mic({ frequency: PROFILE, level: level(BINDING) });
  const before = Object.fromEntries(reproducibilityChecklist(full, { match: 'match',
    name: 'x' }).map((c) => [c.id, c.state]));
  // Of the items the run can record, the full microphone run records them all.
  for (const id of ['recipe', 'algorithms', 'calibration', 'device', 'build', 'hash',
    'environment']) assert.equal(before[id], 'recorded', id);
  const strip = {
    definition: (e) => { delete e.definition; },
    recipe: (e) => { delete e.recipe; },
    algorithms: (e) => { e.algorithms = {}; },
    calibration: (e) => { delete e.calibration; },
    device: (e) => { e.input.device.label = null; },
    build: (e) => { e.provenance.build = null; },
    hash: (e) => { e.provenance.resultHash = null; },
    environment: (e) => { e.environment.notes = null; },
  };
  for (const [id, mut] of Object.entries(strip)) {
    const e = clone(full);
    mut(e);
    const state = byId(reproducibilityChecklist(e, { match: 'match', name: 'x' }), id).state;
    assert.notEqual(state, 'recorded', `${id} without its field`);
  }
  // A record with nothing at all records nothing, and nothing throws.
  const bare = { kind: 'oscilla-experiment' };
  for (const x of reproducibilityChecklist(bare)) {
    assert.notEqual(x.state, 'recorded', x.id);
  }
});

test('recipe: recorded, and partial when this build cannot run its stimulus kind', async () => {
  const { reproducibilityChecklist } = await ev();
  const { a } = await fx();
  assert.equal(byId(reproducibilityChecklist(a.experiment), 'recipe').state, 'recorded');
  const noise = clone(a.experiment);
  noise.recipe = { ...noise.recipe, stimulus: { ...noise.recipe.stimulus, kind: 'pink',
    f1: null, f2: null } };
  const item = byId(reproducibilityChecklist(noise), 'recipe');
  assert.equal(item.state, 'partial');
  assert.match(item.reason, /runs only log sweeps/);
});

test('algorithms: partial when a recorded version is not implemented by this build', async () => {
  const { reproducibilityChecklist } = await ev();
  const { a } = await fx();
  const e = clone(a.experiment);
  e.algorithms = { ...e.algorithms, transfer: 'oscilla.transfer.v99' };
  const item = byId(reproducibilityChecklist(e), 'algorithms');
  assert.equal(item.state, 'partial');
  assert.match(item.reason, /oscilla\.transfer\.v99 is not implemented by this build/);
});

// ---------------------------------------------------------------- compare

test('evidence differences between runs list only the items whose state differs', async () => {
  const { reproducibilityChecklist, evidenceDifferences, evidenceDifferencesText } = await ev();
  const { a, b, older } = await fx();
  const ab = evidenceDifferences([reproducibilityChecklist(a.experiment),
    reproducibilityChecklist(b.experiment)]);
  assert.deepEqual(ab, []);
  assert.equal(evidenceDifferencesText(ab, ['A', 'B']), 'Evidence differences: none (every '
    + 'checklist item has the same state in each run).');
  const ao = evidenceDifferences([reproducibilityChecklist(a.experiment),
    reproducibilityChecklist(older.experiment)]);
  assert.deepEqual(ao.map((d) => d.id), ['calibration']);
  assert.deepEqual(ao[0].states, ['recorded', 'partial']);
  assert.equal(evidenceDifferencesText(ao, ['A', 'B']), 'Evidence differences: Calibration '
    + 'identity recorded (A recorded, B partial).');
});

// ---------------------------------------------------------------- the copy

// The literals are scanned by tests/unit/no-fake-science.test.mjs; this checks the composed text.
test('the composed evidence text claims no SPL, certification or accuracy', async () => {
  const { runEvidence } = await ev();
  const { a, older } = await fx();
  const model = JSON.parse(JSON.stringify(templateModel('filter-automation')));
  const texts = [runEvidence(a.experiment), runEvidence(older.experiment),
    runEvidence(withStudioProvenance(clone(a.experiment), model)),
    runEvidence(await mic({ frequency: PROFILE, level: level(BINDING) }))].map(allText)
    .join(' ');
  for (const re of [/\bSPL\b/, /\bcertified\b/i, /\baccurate to\b/i, /\bguarantee/i]) {
    assert.ok(!re.test(texts), String(re));
  }
});

// ---------------------------------------------------------------- the workspace adapter

test('the Experiments detail carries the evidence; compare carries its differences', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake.indexedDB;
  const cmp = {};
  for (const part of [createMeasureUi({ engine: { init() {}, activeNodeCount: 0 },
    stopPlayback() {}, loopback: true, build: null }), createExperimentsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  Object.assign(cmp, { notify() {}, $nextTick: (f) => f && f(), openModal() {}, closeModal() {},
    setWorkspace() {} });
  cmp.measureInit();
  cmp.experimentsInit();
  const { a, older } = await fx();
  await cmp.experimentsImportText(a.json);
  await cmp.experimentsImportText(older.json);
  await cmp.experimentsOpen('fixture-a');
  const d = cmp.exps.detail.evidence;
  assert.ok(d, 'the detail has an evidence block');
  assert.equal(d.hz, 1000);
  assert.ok(d.lineage.length >= 7 && d.checklist.length === 9);
  assert.equal(JSON.stringify(d), JSON.stringify(JSON.parse(JSON.stringify(d))),
    'plain data for Alpine');
  cmp.experimentsEvidenceAt(5000);
  assert.ok(Math.abs(Math.log2(cmp.exps.detail.evidence.point.hz / 5000)) < 1 / 48);
  cmp.experimentsEvidenceAt('not a number');
  assert.ok(Math.abs(Math.log2(cmp.exps.detail.evidence.point.hz / 5000)) < 1 / 48,
    'an invalid entry keeps the last point');
  cmp.exps.renameName = 'Renamed A';
  cmp.exps.renameId = 'fixture-a';
  assert.equal(await cmp.experimentsRename(), true);
  assert.equal(cmp.exps.detail.evidence.hz, 5000, 'a rename keeps the frequency entered');
  await cmp.experimentsOpen('fixture-older');
  assert.ok(cmp.exps.detail.evidence.lineage.find((l) => l.id === 'calibration').text
    .startsWith('uncalibrated (the stored claim is contradicted)'));
  await cmp.experimentsCompare(['fixture-a', 'fixture-older']);
  assert.equal(cmp.exps.compare.evidenceDiff, 'Evidence differences: Calibration identity '
    + 'recorded (A recorded, B partial).');
});
