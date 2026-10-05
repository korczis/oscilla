// ADR 0040, resolution 2026-10-05: an experiment records the calibration and the conditions
// AS MEASURED, never as the workspace holds them when Save is pressed.
//   - the frequency profile is the one the engine applied (result.calibrated.frequency), even
//     when another profile, or none, is loaded at Save (P0-1);
//   - a level calibration created after an uncalibrated run is never recorded as used, and the
//     record shows no dB SPL (P0-2);
//   - environment.notes are the notes at the start of the run; later text is an annotation;
//   - the validator rejects (code 'corrupt') a record whose named calibration its own results
//     contradict, even when both hashes were re-stamped over the claim.
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

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
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
const corruptAt = (e, path) => {
  const v = validateExperiment(schema.experimentToJson(e), OPTS);
  assert.equal(v.ok, false, `expected ${path} to be refused`);
  assert.ok(v.errors.some((x) => x.path === path && x.code === 'corrupt'
    && /^corrupt: /.test(x.text)), JSON.stringify(v.errors));
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
});

test('validate: a record naming a calibration its results contradict is corrupt', () => {
  const uncal = build(UNCAL);
  const withA = build(WITH_A);
  const withLevel = build(WITH_LEVEL);
  for (const e of [uncal, withA, withLevel]) valid(e); // what the app writes stays valid
  const level = schema.normalizeCalibration({ level: LEVEL }).level;
  // A level calibration attached after an uncalibrated run, both hashes re-stamped.
  corruptAt(restamp({ ...uncal, calibration: { ...uncal.calibration, level } }),
    'calibration.level');
  // A frequency profile named for a run no profile corrected.
  corruptAt(restamp({ ...uncal, calibration: { ...uncal.calibration,
    frequency: { id: PROFILE_A.id, name: 'Mic A' } } }), 'calibration.frequency');
  // The profile cleared before Save on a run that profile A corrected.
  corruptAt(restamp({ ...withA, calibration: { ...withA.calibration, frequency: null } }),
    'calibration.frequency');
  // The level calibration dropped from a run it calibrated.
  corruptAt(restamp({ ...withLevel, calibration: { ...withLevel.calibration, level: null } }),
    'calibration.level');
  // Another level calibration than the one applied (offset differs).
  const other = schema.normalizeCalibration({ level: createLevelCalibration({ referenceHz: 1000,
    referenceDbSpl: 94, observedDbRelative: -20, conditions: null, createdAt: NOW,
    method: 'manual', input: null }) }).level;
  corruptAt(restamp({ ...withLevel, calibration: { ...withLevel.calibration, level: other } }),
    'calibration.level.offsetDb');
});
