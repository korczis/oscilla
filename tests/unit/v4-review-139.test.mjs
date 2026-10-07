// Independent review of #139 (ledger C1, D3), each test failing before its fix:
//   F1  a level calibration bound to input A was applied to a run on input B: the engine never
//       compared the binding with the input it captured from, so a stale workspace check (the
//       system default input changed, or the measurement's own preflight opened another
//       device) produced dB SPL for the wrong microphone, and the record carried it with no
//       finding. The engine now applies a level calibration only to the input it is bound to,
//       and a record whose bound calibration names another input than its own is a finding.
//   F2  a Studio id with a dot ("sweep.a") was cut at the first dot, so a change on the measured
//       path read as 'unmeasured'.
//   F3  after an input switch, the indicator read CALIBRATED while no display used the
//       calibration: it now reads PENDING INPUT CHECK.
//   F4  every record was written as schema 4; one without a measured Studio path is schema 3.
//   F5  a binding without a device id is described "as far as the browser reports it".
//   node --test tests/unit/v4-review-139.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// Namespace imports: an export added by the fix is undefined before it (per-test fail-before).
import * as engine from '../../src/js/measurement/engine.js';
import * as level from '../../src/js/calibration/level.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import * as validate from '../../src/js/experiments/validate.js';
import { runChanges } from '../../src/js/experiments/semantic-diff.js';
import { evidenceLineage } from '../../src/js/experiments/evidence.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { mulberry32 } from '../../src/js/audio/noise.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { studioChanges } from '../../src/js/studio/diff.js';
import { normalizeStudio } from '../../src/js/studio/schema.js';
import { studioProvenance, withStudioProvenance } from '../../src/js/studio/provenance.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const SR = 8000;
const NOW = '2026-10-06T10:00:00.000Z';
const BUILD = { version: '9.9.9-test', commit: 'abcdef1234567', channel: 'test' };
const RECIPE = Object.freeze({
  stimulus: { kind: 'log-sweep', duration: 1, level: 'low', f1: 50, f2: 3000 },
  repeats: 1, analysis: { noiseCheckS: 0.5, preRollS: 0.25, postRollS: 0.5, gapS: 0 },
});
const APPLIED = Object.freeze({ echoCancellation: false, noiseSuppression: false,
  autoGainControl: false, sampleRate: SR, channelCount: 1 });
const facts = (id, label = id) => ({ device: { label, id },
  constraints: { requested: null, applied: { ...APPLIED } }, sampleRate: SR });
const MIC_A = facts('mic-a', 'Mic A');
const MIC_B = facts('mic-b', 'Mic B');

/**
 * A microphone-like io: a gain of 0.5 plus a little noise. `preflightInput` is what its
 * preflight reports (null: nothing, as the loopback io does), `capture` the device its captures
 * report (the input actually opened).
 */
function micIo({ preflightInput = MIC_B, capture = MIC_B } = {}) {
  let t = 1;
  let run = 0;
  const noise = (seed, n) => {
    const r = mulberry32(seed);
    return Float32Array.from({ length: n }, () => (r() - 0.5) * 2e-3);
  };
  const cap = () => ({ constraints: capture.constraints, device: capture.device });
  return {
    sampleRate: SR,
    now: () => t,
    async preflight() {
      return { audioContext: { available: true, state: 'running' }, sampleRate: SR,
        permission: 'granted', input: preflightInput ? { ok: true, device: preflightInput.device,
          constraints: preflightInput.constraints } : null, inputLevel: null,
        output: { gain: 0.08, maxGain: 0.25, audibleVoices: 0 },
        worklet: { supported: true, mode: 'audioworklet' }, testContext: null };
    },
    async captureNoise(seconds) {
      const startedAt = t + 0.01;
      t = startedAt + seconds;
      return { sampleRate: SR, samples: noise(5, Math.round(seconds * SR)), startedAt,
        preRoll: 0, postRoll: 0, ...cap() };
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
        preRoll: preRollS, postRoll: postRollS, ...cap() };
    },
    cancel() {},
    dispose() {},
  };
}

const cal = (input) => level.createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30, conditions: 'unit: calibrator', createdAt: NOW, method: 'manual',
  input });

async function measure(levelCal, io = micIo()) {
  const r = await engine.createMeasurementEngine({ io, assess: engine.assessMeasurement,
    clock: { wall: () => Date.parse(NOW), mono: () => 0 } })
    .measure(JSON.parse(JSON.stringify(RECIPE)), { calibration: { frequency: null,
      level: levelCal } });
  assert.equal(r.state, 'COMPLETE');
  return r;
}
const record = (r, id = 'run-b') => experimentFromResult(r, { now: NOW, id, build: BUILD,
  name: 'Desk microphone', notes: 'Desk' });
const levelReason = (r) => r.quality.reasons.find((x) => x.code === 'LEVEL_CALIBRATION');

// ================================================================= F1

test('F1: the engine never applies a level calibration bound to another input', async () => {
  // Control: bound to the input measured, it applies.
  const same = await measure(cal(MIC_B));
  assert.equal(same.calibrated.level.unit, 'dB SPL');
  assert.ok(same.calibrated.level.calibration);
  // Bound to Mic A, measured on Mic B (the workspace's check was stale): not applied.
  const r = await measure(cal(MIC_A));
  assert.equal(r.calibrated.level.calibration, null);
  assert.equal(r.calibrated.level.unit, 'dB relative (dBFS-like)');
  assert.match(r.calibrated.level.voided, /^UNCALIBRATED: .*a different input device/);
  assert.equal(r.noise.level.unit, 'dB relative (dBFS-like)', 'noise levels too');
  assert.ok(r.preflight.warnings.some((w) => w.code === 'LEVEL_CALIBRATION_VOID'));
  assert.equal(levelReason(r).severity, 'warn');
  assert.match(levelReason(r).text, /^level calibration not applied \(the level calibration /);
  assert.equal(r.quality.metrics.levelCalibrated, false);
  // The record says uncalibrated, consistently: no SPL, no finding.
  const e = record(r);
  assert.equal(e.calibration.level, null);
  assert.deepEqual(validate.recordFindings(e), []);
  assert.doesNotMatch(schema.summarizeExperiment(e).join(' '), /SPL/);
  // An unbound calibration is not applied to a known input either (C1).
  assert.equal((await measure(cal(null))).calibrated.level.calibration, null);
});

test('F1: the input the run captured from decides, even when the preflight reported none',
  async () => {
    // The preflight reports no input (as the loopback io does), the captures report Mic B.
    const r = await measure(cal(MIC_A), micIo({ preflightInput: null, capture: MIC_B }));
    assert.equal(r.input.device.id, 'mic-b');
    assert.equal(r.calibrated.level.calibration, null);
    assert.match(r.calibrated.level.voided, /a different input device/);
    assert.equal(r.noise.level.unit, 'dB relative (dBFS-like)', 'summarized again, relative');
    assert.equal(r.quality.metrics.levelCalibrated, false);
    // And when the captures are the bound input, it applies.
    const ok = await measure(cal(MIC_B), micIo({ preflightInput: null, capture: MIC_B }));
    assert.ok(ok.calibrated.level.calibration);
    assert.equal(ok.noise.level.unit, 'dB SPL');
  });

test('F1: a record naming a calibration bound to another input than its own is a finding',
  async () => {
    const e = record(await measure(cal(MIC_B)));
    assert.deepEqual(validate.recordFindings(e), [], 'consistent');
    // As an earlier build could save it: the calibration of Mic A on the run of Mic B.
    let forged = { ...e, calibration: { ...e.calibration, level: schema.normalizeCalibration({
      level: cal(MIC_A) }).level } };
    forged = hash.withResultHash(hash.withConfigHash(forged, hash.configHash(forged)),
      hash.resultHash(forged));
    const v = validate.validateExperiment(schema.experimentToJson(forged), OPTS);
    assert.equal(v.ok, true, 'kept, never lost');
    const f = v.findings.find((x) => x.path === 'calibration.level.input');
    assert.ok(f, JSON.stringify(v.findings));
    assert.equal(f.code, validate.CALIBRATION_CLAIM_CONTRADICTED);
    assert.match(f.text, /bound to another input than the one this run recorded/);
    assert.equal(validate.validateExperiment(schema.experimentToJson(forged),
      { ...OPTS, findings: 'strict' }).ok, false, 'never written by the application');
    // Presented uncalibrated, and the evidence never says "bound to its input".
    assert.equal(validate.withoutContradictedCalibration(v.experiment).calibration.level, null);
    assert.doesNotMatch(schema.summarizeExperiment(
      validate.withoutContradictedCalibration(v.experiment)).join(' '), /SPL/);
    const lin = evidenceLineage(v.experiment).find((l) => l.id === 'calibration').text;
    assert.match(lin, /contradicted/);
    assert.doesNotMatch(lin, /bound to (its|the) input/);
  });

// ================================================================= F2

test('F2: a Studio id with a dot is matched whole, never cut at the first dot', () => {
  const rename = (m, from, to) => JSON.parse(JSON.stringify(m).split(`"${from}"`)
    .join(`"${to}"`));
  const a = rename(templateModel(MEASUREMENT_TEMPLATE_ID), 'sweep-1', 'sweep.a');
  const b = JSON.parse(JSON.stringify(a));
  b.graph.nodes.find((n) => n.id === 'sweep.a').params.level = 0.25;
  const pa = studioProvenance(a);
  assert.ok(pa.measured.nodes.includes('sweep.a'));
  const c = runChanges({ studio: pa }, { studio: studioProvenance(b) }, { studioChanges })
    .filter((x) => x.domain === 'studio' && x.kind !== 'unchanged');
  assert.deepEqual(c.map((x) => [x.path, x.class]),
    [['studio.nodes.sweep.a.params.level', 'execution']]);
  // A node "sweep" beside "sweep.a": the longer id is the one named.
  const twoDoc = JSON.parse(JSON.stringify(a));
  twoDoc.graph.nodes.push({ id: 'sweep', type: 'oscillator', position: { x: 0, y: 0 },
    params: { frequency: 440 }, metadata: { name: 'Oscillator' } });
  const two = normalizeStudio(twoDoc);
  const three = JSON.parse(JSON.stringify(two));
  three.graph.nodes.find((n) => n.id === 'sweep').params.frequency = 880;
  const d = runChanges({ studio: studioProvenance(two) }, { studio: studioProvenance(three) },
    { studioChanges }).filter((x) => x.domain === 'studio' && x.kind !== 'unchanged');
  assert.deepEqual(d.map((x) => [x.path, x.class]),
    [['studio.nodes.sweep.params.frequency', 'unmeasured']]);
});

// ================================================================= F3, F5

function ui() {
  const cmp = {};
  Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(createMeasureUi({
    engine: { init() {}, activeNodeCount: 0 }, stopPlayback() {}, loopback: true,
    build: null })));
  Object.assign(cmp, { notify() {}, $nextTick: (f) => f && f(), openModal() {},
    closeModal() {} });
  cmp.measureInit();
  return cmp;
}

test('F3: between an input change and the next check the indicator is PENDING INPUT CHECK',
  () => {
    const cmp = ui();
    const seam = cmp.measureTestSeam();
    seam.setInputNow(MIC_A);
    cmp.measureSetLevelManual(true);
    Object.assign(cmp.meas.levelForm, { observedDb: '-30' });
    assert.equal(cmp.measureSaveLevelCalibration(), true);
    assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
    assert.equal(cmp.measureLevelsText, 'CALIBRATED (reference offset applied)');
    // The input is no longer known (another input chosen, the default input changed).
    seam.setInputNow(null);
    assert.equal(cmp.measureCalIndicator, 'PENDING INPUT CHECK');
    assert.match(cmp.meas.cal.levelPending, /^Pending input check: the level calibration is /);
    assert.equal(cmp.measureLevelsText, 'relative until the input is checked');
    // Checked again: CALIBRATED on the same input, UNCALIBRATED on another.
    seam.setInputNow(MIC_A);
    assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
    assert.equal(cmp.meas.cal.levelPending, null);
    seam.setInputNow(MIC_B);
    assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  });

test('F1/F3: a device change under "default input" makes the checked input unknown again',
  async () => {
    const md = new EventTarget();
    md.enumerateDevices = async () => [];
    const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { mediaDevices: md } });
    try {
      const cmp = ui();
      const seam = cmp.measureTestSeam();
      seam.setInputNow(MIC_A);
      cmp.measureSetLevelManual(true);
      Object.assign(cmp.meas.levelForm, { observedDb: '-30' });
      assert.equal(cmp.measureSaveLevelCalibration(), true);
      assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
      md.dispatchEvent(new Event('devicechange')); // a USB microphone plugged in
      assert.equal(seam.inputNow, null);
      assert.equal(cmp.measureCalIndicator, 'PENDING INPUT CHECK');
    } finally {
      Object.defineProperty(globalThis, 'navigator', was);
    }
  });

test('F5: a binding without a device id is only "as far as the browser reports it"', () => {
  const cmp = ui();
  const seam = cmp.measureTestSeam();
  seam.setInputNow({ device: null, constraints: { applied: { ...APPLIED } }, sampleRate: SR });
  cmp.measureSetLevelManual(true);
  Object.assign(cmp.meas.levelForm, { observedDb: '-30' });
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.match(cmp.measureLevelStateText, /bound to the input checked when it was stored as far /);
  assert.match(cmp.measureLevelStateText, /no device id: sample rate and processing only/);
  const withId = ui();
  withId.measureTestSeam().setInputNow(MIC_A);
  withId.measureSetLevelManual(true);
  Object.assign(withId.meas.levelForm, { observedDb: '-30' });
  withId.measureSaveLevelCalibration();
  assert.doesNotMatch(withId.measureLevelStateText, /as far as the browser/);
});

test('F5: the evidence of a run bound without a device id says so', async () => {
  const anon = facts(null);
  const e = record(await measure(cal({ ...anon, device: null }),
    micIo({ preflightInput: { ...anon, device: { label: null, id: null } },
      capture: { ...anon, device: { label: null, id: null } } })));
  assert.ok(e.calibration.level, 'applied: the same input as far as the browser reports it');
  const lin = evidenceLineage(e).find((l) => l.id === 'calibration').text;
  assert.match(lin,
    /bound to the input this experiment recorded \(8 kHz\), as far as the browser /);
});

// ================================================================= F4

test('F4: a record is written in the lowest schema that describes it', async () => {
  const e = record(await measure(null));
  assert.equal(e.schemaVersion, 3, 'a plain MEASURE run opens in a build that reads schema 3');
  const v = validate.validateExperiment(schema.experimentToJson(e), OPTS);
  assert.equal(v.ok, true);
  assert.equal(v.experiment.schemaVersion, 3);
  assert.equal(v.migratedFrom, null);
  // A Studio run with a measured path needs schema 4, and says so.
  const s = withStudioProvenance(e, templateModel(MEASUREMENT_TEMPLATE_ID));
  assert.equal(s.schemaVersion, 4);
  assert.equal(validate.validateExperiment(schema.experimentToJson(s), OPTS).ok, true);
  // Without a measured path the Studio block keeps schema 3.
  assert.equal(withStudioProvenance(e, templateModel('basic-tone')).schemaVersion, 3);
  // Schema 3 that claims a measured path is refused; schema 5 is newer than this build.
  const bad = JSON.parse(schema.experimentToJson(s));
  bad.schemaVersion = 3;
  assert.equal(validate.validateExperiment(JSON.stringify(bad), OPTS).ok, false);
  const newer = validate.validateExperiment(JSON.stringify({ ...bad, schemaVersion: 5 }), OPTS);
  assert.match(newer.errors[0].text, /newer than this OSCILLA supports \(4\)/);
});
