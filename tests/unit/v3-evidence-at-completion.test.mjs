// ADR 0040, resolution 2026-10-05: an experiment records the calibration and the conditions
// AS MEASURED, never as the workspace holds them when Save is pressed.
//   - the frequency profile is the one the engine applied (result.calibrated.frequency), even
//     when another profile, or none, is loaded at Save (P0-1);
//   - a level calibration created after an uncalibrated run is never recorded as used, and the
//     record shows no dB SPL (P0-2);
//   - environment.notes are the notes at the start of the run; later text is an annotation;
//   - a record whose named calibration its own results contradict (as earlier builds saved one)
//     is a non-fatal finding 'calibration-claim-contradicted': it stays readable from the store,
//     imports, keeps its verified hash, and is presented without the claim (never dB SPL,
//     compared as uncalibrated); strict validation, what the app now writes, refuses it.
// The results come from the real MeasurementEngine on a synthetic microphone-like io.
//   node --test tests/unit/v3-evidence-at-completion.test.mjs
//
// Namespace imports on purpose: a function missing in an older build fails its own test only.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as me from '../../src/js/ui/measure-experiment.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { createMeasurementEngine, assessMeasurement } from '../../src/js/measurement/engine.js';
import { createFrequencyProfile } from '../../src/js/calibration/profile.js';
import { createLevelCalibration } from '../../src/js/calibration/level.js';
import { KNOWN_ALGORITHM_IDS, ALGORITHMS } from '../../src/js/measurement/algorithms.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import * as summary from '../../src/js/measurement/views/experiment-summary.js';
import * as validate from '../../src/js/experiments/validate.js';
import * as store from '../../src/js/experiments/store.js';
import * as ui from '../../src/js/ui/experiments.js';
import { compareExperiments } from '../../src/js/experiments/compare.js';
import { csvMeta, transferCsv } from '../../src/js/experiments/csv.js';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const STRICT = { ...OPTS, calibrationClaims: 'strict' };
const CODE = 'calibration-claim-contradicted';
const SR = 8000;
const NOW = '2026-10-05T10:00:00.000Z';
const BUILD = { version: '9.9.9-test', commit: 'abcdef1234567', channel: 'test' };
const RECIPE = Object.freeze({
  stimulus: { kind: 'log-sweep', duration: 1, level: 'low', f1: 50, f2: 3000 },
  repeats: 1, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});

/** A microphone-like synthetic io: a gain of 0.5 plus a little noise, no TEST CONTEXT. */
function micIo() {
  let t = 1;
  let run = 0;
  const constraints = { requested: null, applied: { echoCancellation: false,
    noiseSuppression: false, autoGainControl: false, sampleRate: SR, channelCount: 1 } };
  const device = { label: 'Synthetic mic', id: 'synthetic-mic' };
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

const measure = (calibration) => createMeasurementEngine({ io: micIo(), assess: assessMeasurement,
  clock: { wall: () => 0, mono: () => 0 } }).measure(JSON.parse(JSON.stringify(RECIPE)),
  { calibration });

const PROFILE_A = createFrequencyProfile({ name: 'Mic A', points: [[20, 1], [1000, 0],
  [4000, -1]] });
const PROFILE_B = createFrequencyProfile({ name: 'Mic B', points: [[20, -3], [1000, 2],
  [4000, 4]] });
const LEVEL = createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30, conditions: 'unit: calibrator', createdAt: NOW, method: 'manual',
  input: null });

const UNCAL = await measure(null);
const WITH_A = await measure({ frequency: PROFILE_A, level: null });
const WITH_LEVEL = await measure({ frequency: null, level: LEVEL });

const build = (result, over = {}) => me.experimentFromResult(result, { now: NOW, id: 'evidence-1',
  build: BUILD, ...over });
const valid = (e) => {
  const v = validateExperiment(schema.experimentToJson(e), OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  return v.experiment;
};
/** Re-stamp both hashes over an edit, as any writer can: the check is on facts, not hashes. */
const restamp = (e) => hash.withResultHash(hash.withConfigHash(e, hash.configHash(e)),
  hash.resultHash(e), hash.RESULT_HASH_VERSION);
/**
 * A contradicted claim: readable by default (finding at `path`, hash verified), refused by
 * strict validation with the same code, path and reason; never the bare word "corrupt".
 */
const contradictedAt = (e, path) => {
  const json = schema.experimentToJson(e);
  const v = validateExperiment(json, OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  assert.ok(v.findings.some((x) => x.path === path && x.code === CODE
    && /^calibration claim contradicted by the record's own results: /.test(x.text)),
  JSON.stringify(v.findings));
  const strict = validateExperiment(json, STRICT);
  assert.equal(strict.ok, false, `strict validation refuses ${path}`);
  assert.ok(strict.errors.some((x) => x.path === path && x.code === CODE),
    JSON.stringify(strict.errors));
  return v.experiment;
};

test('the runs complete; the engine reports what it applied, frozen at completion', () => {
  for (const r of [UNCAL, WITH_A, WITH_LEVEL]) assert.equal(r.state, 'COMPLETE');
  assert.equal(WITH_A.calibrated.frequency.profileId, PROFILE_A.id);
  assert.equal(UNCAL.calibrated.level.calibration, null);
  assert.equal(WITH_A.calibrated.level.calibration, null);
  const applied = WITH_LEVEL.calibrated.level.calibration;
  assert.deepEqual(applied, LEVEL);
  assert.notEqual(applied, LEVEL, 'a copy: the workspace object can be replaced later');
  assert.ok(Object.isFrozen(applied));
});

test('P0-1: measured with profile A, profile B loaded at Save: the record names A', () => {
  // `profile` is what the workspace held at Save before the fix; it must not matter.
  for (const atSave of [PROFILE_B, null, PROFILE_A]) {
    const e = build(WITH_A, { profile: atSave });
    assert.deepEqual(e.calibration.frequency, { id: PROFILE_A.id, name: 'Mic A' },
      `profile at Save: ${atSave ? atSave.name : 'none'}`);
    assert.equal(e.algorithms.calibration, ALGORITHMS.calibration);
    valid(e);
  }
  // A run measured without a profile records none, whatever is loaded at Save.
  assert.equal(build(UNCAL, { profile: PROFILE_A }).calibration.frequency, null);
  assert.deepEqual(me.appliedCalibration(WITH_A).frequency, { id: PROFILE_A.id,
    name: 'Mic A' });
});

test('P0-2: a level calibration created after an uncalibrated run is not recorded as used', () => {
  const e = build(UNCAL, { levelCalibration: LEVEL });
  assert.equal(e.calibration.level, null, 'the record says uncalibrated');
  assert.equal(e.quality.metrics.levelCalibrated, false);
  const text = schema.summarizeExperiment(e).join('\n');
  assert.doesNotMatch(text, /SPL/, 'no dB SPL for a run measured uncalibrated');
  valid(e);
  assert.equal(me.appliedCalibration(UNCAL).level, null);
});

test('a level calibration the engine applied is recorded, and validates', () => {
  const e = build(WITH_LEVEL, { levelCalibration: null });
  assert.equal(e.calibration.level.offsetDb, LEVEL.offsetDb);
  assert.equal(e.calibration.level.createdAt, NOW);
  assert.equal(e.quality.metrics.levelCalibrated, true);
  assert.match(schema.summarizeExperiment(e).join('\n'), /SPL/);
  valid(e);
});

test('notes are recorded as at the start; text edited later is an annotation', () => {
  const ev = me.measuredEvidence(WITH_A, { notes: '  1 m, desk  ' });
  assert.ok(Object.isFrozen(ev));
  assert.equal(ev.notes, '1 m, desk');
  assert.deepEqual(ev.calibration.frequency, { id: PROFILE_A.id, name: 'Mic A' });
  const plain = build(WITH_A, { notes: ev.notes });
  const later = build(WITH_A, { notes: ev.notes, laterNotes: '2 m, floor (moved after)' });
  assert.equal(later.environment.notes, '1 m, desk');
  assert.deepEqual(later.annotations, { notes: '2 m, floor (moved after)' });
  assert.equal(later.provenance.resultHash, plain.provenance.resultHash,
    'the annotation is metadata: the result hash is that of the run');
  valid(later);
  const shown = summary.experimentSummary(later);
  assert.equal(shown.environment, '1 m, desk');
  assert.equal(shown.annotation, '2 m, floor (moved after)', 'shown apart, not lost');
  // Unchanged or cleared notes add nothing.
  assert.equal(build(WITH_A, { notes: 'x', laterNotes: ' x ' }).annotations, undefined);
  assert.equal(build(WITH_A, { notes: 'x', laterNotes: '' }).annotations, undefined);
});

test('the workspace states what differs from the evidence, and what a save keeps', () => {
  const ev = me.measuredEvidence(WITH_A, { notes: 'desk' });
  const same = me.appliedCalibration(WITH_A);
  assert.deepEqual(me.evidenceChanges(ev, { calibration: same, notes: 'desk' }), []);
  const toB = me.evidenceChanges(ev, { calibration: { frequency: { id: PROFILE_B.id,
    name: 'Mic B' }, level: null }, notes: 'desk' });
  assert.equal(toB.length, 1);
  assert.match(toB[0], /^Calibration changed after this measurement; the saved record keeps /);
  assert.match(toB[0], /"Mic A"/);
  const lvl = me.evidenceChanges(me.measuredEvidence(UNCAL, { notes: '' }),
    { calibration: { frequency: null, level: LEVEL }, notes: '' });
  assert.match(lvl[0], /no frequency profile, levels relative/);
  assert.doesNotMatch(lvl.join(' '), /SPL/);
  const notes = me.evidenceChanges(ev, { calibration: same, notes: 'floor' });
  assert.match(notes[0], /saved as an annotation/);
  // After the Save the text never claims an unsaved edit is saved (review F1).
  const pending = me.evidenceChanges(ev, { calibration: same, notes: 'floor',
    saved: { annotation: null } });
  assert.match(pending[0], /^These notes are not stored yet/);
  assert.doesNotMatch(pending[0], /are saved as an annotation/);
  const stored = me.evidenceChanges(ev, { calibration: same, notes: 'floor',
    saved: { annotation: 'floor' } });
  assert.match(stored[0], /are stored as its annotation/);
});

test('validate: a contradicted calibration claim is a finding; strict validation refuses it',
  () => {
    const uncal = build(UNCAL);
    const withA = build(WITH_A);
    const withLevel = build(WITH_LEVEL);
    for (const e of [uncal, withA, withLevel]) {
      // What the app writes passes strict validation and has no finding.
      const v = validateExperiment(schema.experimentToJson(e), STRICT);
      assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
      assert.deepEqual(v.findings, []);
    }
    const level = schema.normalizeCalibration({ level: LEVEL }).level;
    // A level calibration attached after an uncalibrated run, both hashes re-stamped.
    contradictedAt(restamp({ ...uncal, calibration: { ...uncal.calibration, level } }),
      'calibration.level');
    // A frequency profile named for a run no profile corrected.
    contradictedAt(restamp({ ...uncal, calibration: { ...uncal.calibration,
      frequency: { id: PROFILE_A.id, name: 'Mic A' } } }), 'calibration.frequency');
    // The profile cleared before Save on a run that profile A corrected.
    contradictedAt(restamp({ ...withA, calibration: { ...withA.calibration, frequency: null } }),
      'calibration.frequency');
    // The level calibration dropped from a run it calibrated.
    contradictedAt(restamp({ ...withLevel, calibration: { ...withLevel.calibration,
      level: null } }), 'calibration.level');
    // Another level calibration than the one applied (offset differs).
    const other = schema.normalizeCalibration({ level: createLevelCalibration({
      referenceHz: 1000, referenceDbSpl: 94, observedDbRelative: -20, conditions: null,
      createdAt: NOW, method: 'manual', input: null }) }).level;
    contradictedAt(restamp({ ...withLevel, calibration: { ...withLevel.calibration,
      level: other } }), 'calibration.level.offsetDb');
  });

/** A record as the build before the fix saved it: a level calibration made after the run. */
function olderBuildRecord() {
  const uncal = build(UNCAL, { id: 'older-build' });
  const level = schema.normalizeCalibration({ level: LEVEL }).level;
  return restamp({ ...uncal, calibration: { ...uncal.calibration, level } });
}

test('a stored contradicted record (older build) stays readable, unchanged and verified',
  async () => {
    const old = olderBuildRecord();
    const fake = fakeIndexedDB();
    const opens = [['memory', async () => store.createMemoryStore(OPTS)],
      ['indexeddb', () => store.openExperimentStore({ indexedDB: fake.indexedDB,
        name: `evidence-${Math.random()}`, ...OPTS })]];
    for (const [kind, open] of opens) {
      const s = await open();
      await s.put(old);
      const back = await s.get('older-build');
      assert.ok(back, `${kind}: readable`);
      assert.equal(schema.experimentToJson(back), schema.experimentToJson(old),
        `${kind}: never rewritten`);
      assert.equal(hash.resultHash(back), back.provenance.resultHash, `${kind}: hash verifies`);
      const f = validate.calibrationClaimFindings(back);
      assert.deepEqual(f.map((x) => [x.path, x.code]), [['calibration.level', CODE]]);
      // Presented without the claim: no dB SPL anywhere, the statement says why.
      const shown = ui.presented(back);
      assert.equal(shown.calibration.level, null);
      assert.notEqual(back.calibration.level, null, 'the stored record keeps what it says');
      const text = [...schema.summarizeExperiment(shown),
        ...summary.experimentSummary(shown).lines,
        transferCsv(shown.results.transfer, csvMeta(shown))].join('\n');
      assert.doesNotMatch(text, /SPL/, `${kind}: never presented as dB SPL`);
      assert.match(schema.summarizeExperiment(back).join(' '), /SPL/,
        'the raw record would have shown SPL');
      assert.match(ui.CALIBRATION_CLAIM_TEXT, /not trustworthy/);
      // Compared as uncalibrated: no level-calibration difference against an uncalibrated run.
      const other = build(UNCAL, { id: 'uncal-peer' });
      const levelDiff = (list) => compareExperiments(list).differences
        .some((d) => d.field === 'calibration.level');
      assert.ok(levelDiff([back, other]), 'the raw claim would differ as a level calibration');
      assert.ok(!levelDiff([shown, ui.presented(other)]), `${kind}: compared as uncalibrated`);
    }
  });

test('importing a contradicted file: accepted with the finding, never as SPL', () => {
  const json = schema.experimentToJson(olderBuildRecord());
  const v = validateExperiment(json, OPTS);
  assert.ok(v.ok, 'an exported file from an earlier version opens');
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].code, CODE);
  assert.match(v.findings[0].text, /levelCalibrated false/, 'the reason names the evidence');
  assert.equal(ui.presented(v.experiment).calibration.level, null);
  assert.equal(v.experiment.provenance.resultHash, olderBuildRecord().provenance.resultHash);
});
