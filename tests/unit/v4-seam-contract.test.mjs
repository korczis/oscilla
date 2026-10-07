// Ledger W7: what a window.OSCILLA.measure hook may do. Every hook observes, drives an action a
// user already has (through the user's validation), or injects only inside TEST CONTEXT.
//   inject  setInputNow is refused outside TEST CONTEXT loopback, so a typed level reading cannot
//           be bound to an input nobody checked; showResult refuses a result without a
//           testContext, so nothing unmeasured is titled or saved as a measurement.
//   drive   setValues is the validated recipe-link action: unknown keys, out-of-range values and
//           calls while a measurement runs are refused whole; a change resets a READY check.
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

test('inject: setInputNow works in TEST CONTEXT loopback and stops when it is left', () => {
  const { cmp, seam } = makeUi({ loopback: true });
  assert.equal(seam.setInputNow(MIC_A), true);
  assert.deepEqual(seam.inputNow, MIC_A);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  // Leaving TEST CONTEXT (a drive action) ends the injection.
  assert.equal(seam.useMicrophone(), true);
  assert.equal(seam.setInputNow(null), false);
  assert.deepEqual(seam.inputNow, MIC_A, 'a refused call changes nothing');
  assert.equal(seam.useLoopback(), true);
  assert.equal(seam.setInputNow(null), true);
  assert.equal(seam.inputNow, null);
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
