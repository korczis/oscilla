// Ledger W7b (ADR 0052, note of 2026-10-07): TEST CONTEXT, the digital loopback, is a choice of
// the MEASURE Input device list, entered and left from the page as `?measure=loopback` enters it.
//   view    the list always ends with "TEST CONTEXT · digital loopback (no microphone)"; it is
//           the selected option while the loopback is on, the inputs stay listed (choosing one
//           leaves), and the choice is offered where the browser has no microphone.
//   enter   choosing it turns the loopback on: banner state, announcement, address.
//   leave   choosing an input turns it off and clears what was produced in TEST CONTEXT (its
//           result, the input check, a level calibration stored in it), says what was cleared,
//           and a typed level reading then has no input to bind to.
//   seam    useLoopback / useMicrophone are that same transition (ADR 0052 "drive").
// NOT covered here: that a result measured with a real input, and a level calibration stored
// with one, survive entering and leaving. Node has no input to check; the browser check
// `test-context-from-the-page` (tests/browser/app.cjs) covers the calibration on the fake
// microphone of chromium and firefox.
// In Node (no DOM: the adapters' Alpine state is a plain object, IndexedDB the in-process fake).
//   node --test tests/unit/v4-test-context-choice.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeasureUi, LEVEL_NEEDS_INPUT } from '../../src/js/ui/measure.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { experimentTestContext } from '../../src/js/ui/measure-experiment.js';
import * as inputs from '../../src/js/measurement/views/input-devices.js';
import { buildFixtures } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const { inputDeviceView, inputDeviceList, DEFAULT_INPUT_LABEL } = inputs;
const TC = inputs.TEST_CONTEXT_INPUT_VALUE;
const TC_LABEL = 'TEST CONTEXT · digital loopback (no microphone)';
const SR = 48000;
const MIC_A = Object.freeze({ device: { label: 'Mic A', id: 'mic-a' },
  constraints: { requested: null, applied: { echoCancellation: false, noiseSuppression: false,
    autoGainControl: false, sampleRate: SR, channelCount: 1 } }, sampleRate: SR });

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

/** The MEASURE and EXPERIMENTS adapters composed as main.js composes them (no DOM). */
function makeUi({ loopback = false } = {}) {
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
/** The polite live region's text once it matches (the page sets an announcement 30 ms later). */
const said = async (cmp, wanted) => {
  const until = Date.now() + 2000;
  while (!wanted.test(cmp.meas.live.polite) && Date.now() < until) {
    await new Promise((r) => { setTimeout(r, 10); });
  }
  return cmp.meas.live.polite;
};

// ================================================================= view

test('view: the input list ends with the TEST CONTEXT choice, labelled, and is never disabled',
  () => {
    assert.equal(typeof TC, 'string');
    assert.ok(TC.length > 0, 'the TEST CONTEXT option has a value of its own');
    assert.equal(inputs.TEST_CONTEXT_INPUT_LABEL, TC_LABEL);
    const devices = [{ kind: 'audioinput', deviceId: 'a1', label: 'USB mic' }];
    const off = inputDeviceView({ devices, enumerated: true });
    assert.deepEqual(off.options.map((o) => o.value), ['', 'a1', TC]);
    assert.deepEqual(off.options.at(-1), { value: TC, label: TC_LABEL, missing: false,
      testContext: true });
    assert.equal(off.selected, '', 'the default stays the default');
    assert.ok(!('disabled' in off) || off.disabled === false);

    const on = inputDeviceView({ devices, selectedId: 'a1', selectedLabel: 'USB mic',
      enumerated: true, loopback: true });
    assert.equal(on.selected, TC, 'TEST CONTEXT is the selected choice while it is on');
    assert.deepEqual(on.options.map((o) => o.value), ['', 'a1', TC], 'inputs stay listed');
    assert.ok(!on.disabled, 'it can be left from the page');
    assert.match(on.status, /TEST CONTEXT loopback: no input device is used/);
    assert.match(on.status, /Choose an input to leave TEST CONTEXT/);

    // No microphone in this browser: TEST CONTEXT needs none, so the choice stays usable.
    const none = inputDeviceView({ available: false });
    assert.ok(!none.disabled);
    assert.deepEqual(none.options.map((o) => o.label), [DEFAULT_INPUT_LABEL, TC_LABEL]);
    assert.match(none.status, /offers no microphone input here; TEST CONTEXT needs none/);

    // An input that vanished is not announced as missing while no input is in use.
    const gone = inputDeviceView({ devices: [], selectedId: 'a1', selectedLabel: 'USB mic',
      enumerated: true, loopback: true });
    assert.equal(gone.missing, false);
    assert.equal(gone.message, null);
    assert.equal(gone.selected, TC);
  });

test('view: no device can take the TEST CONTEXT value', () => {
  assert.deepEqual(inputDeviceList([{ kind: 'audioinput', deviceId: TC, label: 'Impostor' },
    { kind: 'audioinput', deviceId: 'a1', label: 'USB mic' }]).map((d) => d.id), ['a1']);
});

// ================================================================= enter

test('enter: choosing TEST CONTEXT in the input list turns the loopback on and says so',
  async () => {
    const { cmp, seam, notes } = makeUi();
    assert.equal(cmp.meas.loopback, false);
    assert.equal(cmp.meas.input.options.at(-1).label, TC_LABEL);
    assert.equal(seam.setInputNow(MIC_A), false, 'not in TEST CONTEXT yet');

    assert.equal(cmp.measureSelectInput(TC), true);
    assert.equal(cmp.meas.loopback, true, 'the banner and the chip follow meas.loopback');
    assert.equal(cmp.meas.input.selected, TC);
    assert.equal(cmp.meas.rtaLive.available, true, 'the live RTA needs no microphone here');
    assert.match(await said(cmp, /^TEST CONTEXT/),
      /^TEST CONTEXT: digital loopback, no microphone/);
    assert.equal(seam.setInputNow(MIC_A), true, 'the page is in TEST CONTEXT');
    assert.equal(cmp.measureSelectInput(TC), true, 'choosing it again changes nothing');
    assert.deepEqual(seam.inputNow, MIC_A);
    assert.deepEqual(notes, []);

    await cmp.measureCheck(); // creates the engine (no audio in Node: the check itself fails)
    assert.equal(seam.ioKind, 'loopback', 'the capture io is the digital loopback');
  });

test('enter and leave are refused while a measurement uses the input', () => {
  const { cmp, notes } = makeUi();
  cmp.meas.busy = true;
  assert.equal(cmp.measureSelectInput(TC), false);
  assert.equal(cmp.meas.loopback, false);
  assert.equal(cmp.meas.input.selected, '');
  assert.equal(notes.at(-1).title, 'Input not changed');
  cmp.meas.busy = false;
  assert.equal(cmp.measureSelectInput(TC), true);
  cmp.meas.busy = true;
  assert.equal(cmp.measureSelectInput(''), false);
  assert.equal(cmp.meas.loopback, true);
  assert.equal(cmp.meas.input.selected, TC);
});

// ================================================================= leave

test('leave: choosing an input clears the result, input check and level calibration of TEST '
  + 'CONTEXT', async () => {
  const { a } = await fx();
  const { cmp, seam, notes } = makeUi({ loopback: true }); // as ?measure=loopback loads
  assert.equal(cmp.meas.input.selected, TC, 'the URL flag shows as the selected choice');

  const result = { ...a.result };
  assert.equal(seam.showResult(result), true);
  assert.equal(cmp.meas.shownTitle, 'TEST CONTEXT result');
  assert.equal(seam.setInputNow(MIC_A), true);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');

  assert.equal(cmp.measureSelectInput('bogus-device'), false, 'not an option: nothing changes');
  assert.equal(cmp.meas.loopback, true);
  assert.equal(seam.result, result);

  assert.equal(cmp.measureSelectInput(''), true);
  assert.equal(cmp.meas.loopback, false);
  assert.equal(cmp.meas.input.selected, '');
  // The result.
  assert.equal(seam.result, null);
  assert.equal(cmp.meas.shownTitle, null);
  assert.equal(cmp.meas.shownKind, null);
  assert.equal(cmp.meas.testContext, null, 'no TEST CONTEXT banner is left behind');
  assert.equal(cmp.meas.response, null);
  assert.equal(await cmp.measureSave(), null, 'nothing of it can be saved as a measurement');
  // The input check.
  assert.equal(seam.inputNow, null);
  assert.equal(seam.reference, null);
  // The level calibration.
  assert.equal(seam.levelCalibration, null);
  assert.equal(cmp.meas.cal.level, null);
  assert.equal(cmp.meas.cal.useLevel, false);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  assert.equal(cmp.measureLevelsText, 'relative (dBFS-like)');
  assert.deepEqual(cmp.measureWhatWouldBeLost(), []);
  // A reading typed now has no input to bind to (ledger W7f route A, through the page).
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), false);
  assert.equal(cmp.meas.levelForm.error, LEVEL_NEEDS_INPUT);
  // It is said, in the live region and in a notification.
  const text = await said(cmp, /^Left TEST CONTEXT/);
  assert.match(text, /^Left TEST CONTEXT\. Input: default input\. Cleared: /);
  for (const what of [/the unsaved TEST CONTEXT result/, /the level calibration stored in TEST /,
    /the input check/]) {
    assert.match(text, what);
    assert.match(notes.at(-1).text, what);
  }
  assert.equal(notes.at(-1).title, 'Left TEST CONTEXT');
  assert.match(text, /Run the setup check for this input\.$/);
});

test('leave: a saved TEST CONTEXT result leaves the page and stays in Experiments, labelled',
  async () => {
    const { a } = await fx();
    const { cmp, seam, notes } = makeUi({ loopback: true });
    assert.equal(seam.showResult({ ...a.result }), true);
    const id = await cmp.measureSave();
    assert.ok(id, 'saved');
    assert.equal(cmp.meas.saved, true);
    assert.equal(cmp.measureSelectInput(''), true);
    assert.equal(seam.result, null);
    assert.equal(cmp.meas.saved, false);
    assert.equal(cmp.meas.savedId, null);
    assert.match(notes.at(-1).text, /its saved experiment is kept/);
    const stored = await cmp.experimentsGet(id);
    assert.equal(experimentTestContext(stored), a.result.testContext.label);
  });

test('leave: with nothing produced in TEST CONTEXT there is nothing to report', async () => {
  const { cmp, notes } = makeUi();
  assert.equal(cmp.measureSelectInput(TC), true);
  assert.equal(cmp.measureSelectInput(''), true);
  assert.equal(cmp.meas.loopback, false);
  assert.deepEqual(notes, []);
  assert.equal(await said(cmp, /^Left TEST CONTEXT/), 'Left TEST CONTEXT. Input: default input. '
    + 'Run the setup check for this input.');
});

// ================================================================= address

test('address: the page keeps ?measure=loopback in step with the choice', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const win = { location: { href: 'https://example.test/oscilla/?debug=1#m=measure' },
    history: { state: { stamp: 1 }, calls: [],
      replaceState(state, title, url) {
        this.calls.push(state);
        win.location.href = url;
      } } };
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  try {
    const { cmp } = makeUi();
    cmp.measureSelectInput(TC);
    assert.equal(win.location.href, 'https://example.test/oscilla/?debug=1&measure=loopback'
      + '#m=measure');
    cmp.measureSelectInput('');
    assert.equal(win.location.href, 'https://example.test/oscilla/?debug=1#m=measure');
    assert.deepEqual(win.history.calls, [{ stamp: 1 }, { stamp: 1 }], 'the history entry is kept');
  } finally {
    if (had) Object.defineProperty(globalThis, 'window', had);
    else delete globalThis.window;
  }
});

// ================================================================= seam

test('seam: useLoopback and useMicrophone are the same transition as the choice', async () => {
  const { a } = await fx();
  const { cmp, seam } = makeUi();
  assert.equal(seam.useLoopback(), true);
  assert.equal(cmp.meas.input.selected, TC);
  assert.equal(seam.showResult({ ...a.result }), true);
  assert.equal(seam.setInputNow(MIC_A), true);
  typeReading(cmp);
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  // Already in TEST CONTEXT: a new engine, and nothing made in it is touched.
  assert.equal(seam.useLoopback(), true);
  assert.deepEqual(seam.inputNow, MIC_A);
  assert.ok(seam.result);
  assert.ok(seam.levelCalibration);
  // Leaving clears it, as the choice does.
  assert.equal(seam.useMicrophone(), true);
  assert.equal(cmp.meas.input.selected, '');
  assert.equal(seam.inputNow, null);
  assert.equal(seam.result, null);
  assert.equal(seam.levelCalibration, null);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
});
