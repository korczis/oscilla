// Ledger W7: what a window.OSCILLA.measure hook may do. Every hook observes, drives an action a
// user already has (through the user's validation), or injects only inside TEST CONTEXT.
//   inject  a direct setInputNow call is refused outside TEST CONTEXT loopback; showResult
//           refuses a result without a testContext, so no injected result is titled or saved as
//           a measurement.
//           An input belongs to the context it was named in (ledger W7f): one named in TEST
//           CONTEXT (by the loopback, by setInputNow, or by a TEST CONTEXT result) is not a
//           checked input outside it, so a typed level reading cannot bind to it; and a level
//           calibration made in one context does not apply in the other. A level calibration
//           typed by hand in TEST CONTEXT says so (W7c).
//   drive   setValues is the validated recipe-link action: unknown keys, out-of-range values and
//           calls while a measurement runs are refused whole; a change resets a READY check.
//           A toggle takes true or false only (W7h).
// In Node (no DOM: the adapters' Alpine state is a plain object, IndexedDB the in-process fake).
//   node --test tests/unit/v4-seam-contract.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeasureUi, LEVEL_NEEDS_INPUT } from '../../src/js/ui/measure.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { experimentTestContext } from '../../src/js/ui/measure-experiment.js';
import { RECIPE_WIRE_KEYS } from '../../src/js/core/url-state-measure.js';
import { buildFixtures } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const SR = 48000;
const MIC_A = Object.freeze({ device: { label: 'Mic A', id: 'mic-a' },
  constraints: { requested: null, applied: { echoCancellation: false, noiseSuppression: false,
    autoGainControl: false, sampleRate: SR, channelCount: 1 } }, sampleRate: SR });
/** The short TEST CONTEXT recipe of the browser suites (tests/browser/v3-ui.cjs SHORT). */
const SHORT = Object.freeze({ duration: 1, repeats: 2, noiseCheckS: 0.5, preRollS: 0.25,
  postRollS: 0.5, gapS: 0.2 });
/** The recipe of the v3-ui `recipe-link` check. */
const RECIPE = Object.freeze({ f1: 50, f2: 12000, duration: 3, level: 'medium', repeats: 2,
  aggregation: 'median', noiseCheckS: 1, phase: true });

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

/** The MEASURE and EXPERIMENTS adapters composed as main.js composes them (no DOM). */
function makeUi({ loopback = true } = {}) {
  globalThis.indexedDB = fakeIndexedDB().indexedDB; // read by experiments.js pageIndexedDb()
  const notes = [];
  const cmp = {};
  for (const part of [createMeasureUi({ engine: { init() {}, activeNodeCount: 0 },
    stopPlayback() {}, loopback, build: null }), createExperimentsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  Object.assign(cmp, { notify: (type, title, text) => notes.push({ type, title, text }),
    $nextTick: (f) => f && f(), openModal() {}, closeModal() {}, setWorkspace() {} });
  cmp.measureInit();
  cmp.experimentsInit();
  return { cmp, notes, seam: cmp.measureTestSeam() };
}
const typeReading = (cmp) => {
  cmp.measureSetLevelManual(true);
  Object.assign(cmp.meas.levelForm, { referenceHz: '1000', referenceDb: '94',
    observedDb: '-30' });
};

// ================================================================= inject: setInputNow

test('inject: setInputNow is refused outside TEST CONTEXT, so nothing binds to a fake input',
  () => {
    const { cmp, seam } = makeUi({ loopback: false });
    assert.equal(seam.setInputNow(MIC_A), false);
    assert.equal(seam.inputNow, null, 'no input was checked');
    typeReading(cmp);
    assert.equal(cmp.measureSaveLevelCalibration(), false);
    assert.equal(cmp.meas.levelForm.error, LEVEL_NEEDS_INPUT);
    assert.equal(seam.levelCalibration, null, 'nothing stored');
    assert.notEqual(cmp.measureCalIndicator, 'CALIBRATED');
  });

test('inject: setInputNow works in TEST CONTEXT loopback; a direct call is refused outside it',
  () => {
    const { cmp, seam } = makeUi({ loopback: true });
    assert.equal(seam.setInputNow(MIC_A), true);
    assert.deepEqual(seam.inputNow, MIC_A);
    typeReading(cmp);
    assert.equal(cmp.measureSaveLevelCalibration(), true);
    assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
    // After TEST CONTEXT is left (a drive action) a direct call is refused.
    assert.equal(seam.useMicrophone(), true);
    assert.equal(seam.setInputNow(null), false);
    assert.equal(seam.useLoopback(), true);
    assert.equal(seam.setInputNow(null), true);
    assert.equal(seam.inputNow, null);
  });

// ================================================================= W7f: the input's context

/** No input is known, a typed reading is refused, and the indicator is not CALIBRATED. */
function assertNothingToBindTo(cmp, seam, where) {
  assert.equal(seam.inputNow, null, `${where}: no input is known`);
  typeReading(cmp);
  assert.equal(cmp.measureLevelManualNote, LEVEL_NEEDS_INPUT, `${where}: the dialog says why`);
  assert.equal(cmp.measureSaveLevelCalibration(), false, `${where}: the typed reading is refused`);
  assert.equal(cmp.meas.levelForm.error, LEVEL_NEEDS_INPUT);
  assert.equal(seam.levelCalibration, null, `${where}: nothing stored`);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED', where);
  assert.equal(cmp.measureLevelsText, 'relative (dBFS-like)', where);
}

test('W7f route A: an input named in TEST CONTEXT is not a checked input after useMicrophone()',
  () => {
    const { cmp, seam } = makeUi({ loopback: false });
    assert.equal(seam.useLoopback(), true);
    assert.equal(seam.setInputNow(MIC_A), true);
    assert.deepEqual(seam.inputNow, MIC_A);
    assert.equal(seam.useMicrophone(), true);
    assertNothingToBindTo(cmp, seam, 'after useMicrophone()');
    // Entering TEST CONTEXT again does not bring the earlier input back either.
    assert.equal(seam.useLoopback(), true);
    assert.equal(seam.inputNow, null);
  });

test('W7f route B: the input of a TEST CONTEXT result shown outside loopback is not adopted',
  async () => {
    const { a } = await fx();
    for (const input of [a.result.input, { device: MIC_A.device,
      constraints: MIC_A.constraints }]) {
      const { cmp, seam } = makeUi({ loopback: false });
      assert.equal(seam.showResult({ ...a.result, input }), true);
      assert.equal(cmp.meas.shownTitle, 'TEST CONTEXT result', 'shown, and labelled');
      assertNothingToBindTo(cmp, seam, 'after showResult() outside loopback');
    }
  });

test('W7f: in TEST CONTEXT the input of a shown TEST CONTEXT result is the current input',
  async () => {
    const { a } = await fx();
    const { cmp, seam } = makeUi({ loopback: true });
    assert.equal(seam.showResult({ ...a.result, input: { device: MIC_A.device,
      constraints: MIC_A.constraints } }), true);
    assert.deepEqual(seam.inputNow, MIC_A);
    typeReading(cmp);
    assert.equal(cmp.measureSaveLevelCalibration(), true);
    assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  });

test('W7f: a level calibration made in TEST CONTEXT does not apply outside it', () => {
  const { cmp, seam } = makeUi({ loopback: true });
  seam.setInputNow(MIC_A);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  assert.equal(seam.useMicrophone(), true);
  assert.equal(seam.inputNow, null);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  assert.match(cmp.meas.cal.levelVoid, /^UNCALIBRATED: the level calibration was made in TEST /);
  assert.equal(cmp.meas.cal.levelPending, null, 'not "pending": no check can make it apply');
  assert.equal(cmp.measureLevelsText,
    'UNCALIBRATED (the calibration is not valid for this input)');
  // It was not destroyed: back in TEST CONTEXT, with its input named again, it applies.
  assert.equal(seam.useLoopback(), true);
  assert.equal(cmp.measureCalIndicator, 'PENDING INPUT CHECK');
  seam.setInputNow(MIC_A);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
});

// ================================================================= W7c: the manual label

test('W7c: a level calibration typed by hand in TEST CONTEXT is labelled as one', () => {
  const { cmp, seam } = makeUi({ loopback: true });
  seam.setInputNow(MIC_A);
  typeReading(cmp);
  cmp.meas.levelForm.conditions = 'calibrator on the capsule';
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  const cal = seam.levelCalibration;
  assert.equal(cal.method, 'manual');
  assert.match(cal.conditions, /^TEST CONTEXT: /);
  assert.match(cal.conditions, / calibrator on the capsule$/);
  assert.equal(cmp.meas.cal.level.conditions, cal.conditions);
  assert.equal(cmp.meas.cal.level.testContext, true);
  assert.match(cmp.measureLevelStateText, /^TEST CONTEXT reference reading stored \(entered by /);
  // Without conditions of the user's own the label stands alone.
  cmp.measureClearLevelCalibration();
  cmp.meas.levelForm.conditions = '';
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.match(seam.levelCalibration.conditions, /^TEST CONTEXT: [^ ].*[^ ]$/);
});

// ================================================================= review of #169, round 1

const calStep = (cmp) => cmp.meas.flow.steps.find((s) => s.id === 'calibration').detail;
/** No display of `view` (meas.rta, meas.response) claims an absolute level. */
function assertRelative(view, where) {
  assert.ok(view, `${where}: the view exists`);
  assert.ok(!view.badges.includes('CALIBRATED'), `${where}: no CALIBRATED badge`);
  assert.doesNotMatch(view.yLabel, /dB SPL/, `${where}: the axis is not dB SPL`);
}

test('P1 of #169: a level calibration whose input is not checked is in no display', async () => {
  // The reviewer's sequence: a calibration stored for a checked input, the input no longer
  // known, then a result shown. The indicator says PENDING INPUT CHECK and "until then levels
  // are relative"; the RTA of the result's noise check said CALIBRATED / dB SPL.
  const { a } = await fx();
  const { cmp, seam } = makeUi({ loopback: true });
  seam.setInputNow(MIC_A);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  seam.setInputNow(null);
  assert.equal(seam.showResult({ ...a.result, input: null }), true);
  assert.equal(seam.inputNow, null);
  assert.equal(cmp.measureCalIndicator, 'PENDING INPUT CHECK');
  assert.equal(cmp.measureLevelsText, 'relative until the input is checked');
  assertRelative(cmp.meas.rta, 'noise-check RTA, input not checked');
  assertRelative(cmp.meas.response, 'response, input not checked');
  // Checked again, the same calibration is displayed.
  seam.setInputNow(MIC_A);
  seam.showResult({ ...a.result, input: null });
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  assert.ok(cmp.meas.rta.badges.includes('CALIBRATED'));
  assert.match(cmp.meas.rta.yLabel, /dB SPL/);
});

test('P2 of #169: the Calibration step says CALIBRATED only for a checked input', () => {
  const { cmp, seam } = makeUi({ loopback: true });
  assert.match(calStep(cmp), /level relative \(dBFS-like\)$/);
  seam.setInputNow(MIC_A);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  assert.match(calStep(cmp), /level CALIBRATED$/);
  seam.setInputNow(null);
  assert.equal(cmp.measureCalIndicator, 'PENDING INPUT CHECK');
  assert.match(calStep(cmp), /level pending input check$/);
  assert.doesNotMatch(calStep(cmp), /CALIBRATED$/);
  // Made in the other context: never "level CALIBRATED" either.
  seam.useMicrophone();
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  assert.match(calStep(cmp), /level relative \(dBFS-like\)$/);
});

test('P2 of #169: leaving a context drops the result and the noise-check snapshot shown in it',
  async () => {
    const { a } = await fx();
    const { cmp, seam } = makeUi({ loopback: true });
    assert.equal(seam.showResult({ ...a.result }), true);
    assert.equal(cmp.meas.shownTitle, 'TEST CONTEXT result');
    assert.ok(cmp.meas.rta, 'the noise-check snapshot is in the RTA panel');
    // The same context again keeps it.
    assert.equal(seam.useLoopback(), true);
    assert.equal(cmp.meas.shownTitle, 'TEST CONTEXT result');
    assert.ok(cmp.meas.rta);
    // On the microphone nothing of TEST CONTEXT is left to read as a measurement.
    assert.equal(seam.useMicrophone(), true);
    assert.equal(seam.result, null);
    assert.equal(cmp.meas.shownTitle, null);
    assert.equal(cmp.meas.testContext, null);
    assert.equal(cmp.meas.rta, null, 'no TEST CONTEXT snapshot without its label');
    assert.equal(cmp.meas.response, null);
    assert.equal(await cmp.measureSave(), null);
  });

test('P2 of #169: the conditions field takes what Store accepts, with the TEST CONTEXT label',
  () => {
    const outside = makeUi({ loopback: false });
    assert.equal(outside.cmp.measureLevelConditionsMax, 2000, 'no label on the microphone');
    const { cmp, seam } = makeUi({ loopback: true });
    seam.setInputNow(MIC_A);
    typeReading(cmp);
    const max = cmp.measureLevelConditionsMax;
    assert.ok(Number.isInteger(max) && max > 1500 && max < 2000, `max ${max}`);
    // The longest text the field takes is stored whole, behind the label.
    cmp.meas.levelForm.conditions = 'x'.repeat(max);
    assert.equal(cmp.measureSaveLevelCalibration(), true, cmp.meas.levelForm.error);
    const stored = seam.levelCalibration.conditions;
    assert.equal(stored.length, 2000);
    assert.match(stored, /^TEST CONTEXT: /);
    assert.ok(stored.endsWith(` ${'x'.repeat(max)}`), 'the conditions as typed');
    // One more is refused with the limit that applies, never cut short silently.
    cmp.measureClearLevelCalibration();
    cmp.meas.levelForm.conditions = 'x'.repeat(max + 1);
    assert.equal(cmp.measureSaveLevelCalibration(), false);
    assert.match(cmp.meas.levelForm.error, new RegExp(`at most ${max} characters in TEST CONTEXT`));
    assert.equal(seam.levelCalibration, null);
  });

// ================================================================= inject: showResult

test('inject: a result without a testContext is refused, never shown or saved as a measurement',
  async () => {
    const { a } = await fx();
    assert.equal(a.result.testContext.kind, 'synthetic', 'the fixture is a TEST CONTEXT result');
    const { cmp, seam, notes } = makeUi();
    const before = cmp.meas.shownTitle;
    for (const bad of [{ ...a.result, testContext: undefined }, { ...a.result, testContext: null },
      null, undefined]) {
      assert.equal(seam.showResult(bad), false);
      assert.equal(cmp.meas.shownTitle, before);
      assert.notEqual(cmp.meas.shownTitle, 'Latest measurement');
      assert.equal(seam.result, null);
      assert.equal(seam.inputNow, null);
      assert.equal(await cmp.measureSave(), null);
    }
    assert.deepEqual(notes, []);
    assert.equal(cmp.experimentsTestSeam().store(), null, 'the store was never opened');
  });

test('inject: a TEST CONTEXT result is shown and saved as one', async () => {
  const { a } = await fx();
  const { cmp, seam } = makeUi();
  const result = { ...a.result };
  assert.equal(seam.showResult(result), true);
  assert.equal(seam.result, result);
  assert.equal(cmp.meas.shownTitle, 'TEST CONTEXT result');
  assert.equal(cmp.meas.testContext, a.result.testContext.label);
  const id = await cmp.measureSave();
  assert.ok(id, 'saved');
  const stored = await cmp.experimentsGet(id);
  assert.equal(experimentTestContext(stored), a.result.testContext.label);
  assert.ok(stored.measurement.runs.every((r) => r.testContext.kind === 'synthetic'));
});

// ================================================================= drive: setValues

test('drive: setValues refuses keys outside the recipe and out-of-range values, whole', () => {
  const { cmp, seam, notes } = makeUi();
  const before = JSON.parse(JSON.stringify(cmp.meas.values));
  const refused = (values, why) => {
    const r = seam.setValues(values);
    assert.equal(r && r.ok, false, JSON.stringify(values));
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
    assert.match(r.errors.join('; '), why);
    assert.deepEqual(cmp.meas.values, before, 'nothing applied');
  };
  refused({ bogus: 1 }, /bogus/);
  refused({ rtaMode: 'octave' }, /rtaMode/); // a setup value, but not a recipe field
  refused({ duration: 0.5 }, /Sweep duration|duration/i);
  refused({ repeats: 2, duration: 0.5 }, /must be/); // never partly applied
  refused({ repeats: 2.5 }, /whole number/);
  refused({ level: 'loud' }, /must be one of/);
  refused({ f1: 5000, f2: 100 }, /below the end frequency/);
  refused(null, /./);
  assert.deepEqual(notes, [], 'no toast');
  assert.deepEqual(cmp.meas.recipeLinkErrors || [], [], 'not a recipe link');
});

test('drive: setValues applies an in-range recipe, every key, without a toast', () => {
  const { cmp, seam, notes } = makeUi();
  const other = { rtaMode: cmp.meas.values.rtaMode, fftSize: cmp.meas.values.fftSize };
  assert.equal(seam.setValues(SHORT), true);
  for (const [k, v] of Object.entries(SHORT)) assert.equal(cmp.meas.values[k], v, k);
  assert.equal(seam.setValues(RECIPE), true);
  for (const [k, v] of Object.entries(RECIPE)) assert.equal(cmp.meas.values[k], v, k);
  assert.equal(cmp.meas.values.preRollS, SHORT.preRollS, 'keys not named are kept');
  assert.equal(seam.setValues({ f1: 20 }), true);
  assert.equal(seam.setValues({ repeats: 1, f1: 2000 }), true);
  assert.deepEqual([cmp.meas.values.repeats, cmp.meas.values.f1], [1, 2000]);
  assert.deepEqual({ rtaMode: cmp.meas.values.rtaMode, fftSize: cmp.meas.values.fftSize }, other);
  assert.deepEqual(Object.keys(cmp.meas.values).filter((k) => !Object.values(RECIPE_WIRE_KEYS)
    .includes(k)).sort(), ['averaging', 'fftSize', 'rtaMode', 'window']);
  assert.deepEqual(notes, [], 'no toast');
  // The setup the page derives from the values followed (refresh ran).
  assert.match(cmp.meas.stimulusText, /2000|2 kHz|2\.00 kHz/);
});

test('drive: setValues is refused while a measurement runs', () => {
  const { cmp, seam, notes } = makeUi();
  const before = JSON.parse(JSON.stringify(cmp.meas.values));
  cmp.meas.busy = true;
  const r = seam.setValues({ repeats: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['a measurement is running']);
  assert.deepEqual(cmp.meas.values, before);
  assert.deepEqual(notes, []);
});

test('drive: setValues resets a READY setup check, as an edit in the page does', async () => {
  const { cmp, seam } = makeUi();
  await cmp.measureCheck(); // creates the engine (no audio in Node: the check itself fails)
  const engine = seam.engine;
  assert.ok(engine, 'the measurement engine exists');
  let resets = 0;
  Object.defineProperty(engine, 'state', { configurable: true, get: () => 'READY' });
  engine.reset = () => { resets += 1; };
  cmp.measureSetValue('repeats', '2', 'number'); // the page's own edit
  assert.equal(resets, 1);
  assert.equal(seam.setValues({ repeats: 1 }), true);
  assert.equal(resets, 2, 'the seam does what the page does');
  assert.equal(seam.setValues({ duration: 0.5 }).ok, false);
  assert.equal(resets, 2, 'a refused call leaves the checked setup alone');
});

test('drive (W7h): setValues refuses a toggle value that is not true or false', () => {
  const { cmp, seam, notes } = makeUi();
  assert.equal(seam.setValues({ phase: false }), true);
  const before = JSON.parse(JSON.stringify(cmp.meas.values));
  for (const bad of ['no', 'false', 0, 1, null, undefined, {}]) {
    const r = seam.setValues({ repeats: 1, phase: bad });
    assert.equal(r && r.ok, false, `phase: ${JSON.stringify(bad)}`);
    assert.match(r.errors.join('; '), /must be true or false/);
    assert.deepEqual(cmp.meas.values, before, 'nothing applied, not even the valid key');
  }
  assert.equal(seam.setValues({ phase: true }), true);
  assert.equal(cmp.meas.values.phase, true);
  assert.deepEqual(notes, [], 'no toast');
});
