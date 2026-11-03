// A blocked MEASURE step says why (C021, PACK 03 journey 6: invalid input is refused with an
// explicit, honest message). The setup check refuses a sweep the recipe validator rejects (a
// start frequency below 1 Hz, a start above the end) and files the validator's own reason under
// the Stimulus step. The input and calibration steps show their blocker's text; the stimulus
// step showed the description of the refused sweep instead ("-1 Hz → 20 kHz log sweep"), so
// the page said that the check failed and never why.
//   node --test tests/unit/measure-flow-blocked-reason.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateRecipe } from '../../src/js/measurement/engine.js';
import { measureFlow } from '../../src/js/measurement/views/measure-flow.js';
import { MEASUREMENT_STATES as S } from '../../src/js/measurement/state-machine.js';

const recipe = (stimulus) => ({ stimulus: { kind: 'log-sweep', duration: 10, level: 'low',
  f1: 20, f2: 20000, ...stimulus }, repeats: 3 });

/** The report the engine's preflight files for a recipe the validator refuses. */
function refusedReport(r) {
  try {
    validateRecipe(r, { sampleRate: 48000 });
  } catch (e) {
    return { ready: false, sampleRate: 48000,
      blockers: [{ code: e.code, text: e.message, detail: e.detail }], warnings: [] };
  }
  throw new Error('the validator accepted the recipe');
}

for (const [what, stimulus, reason] of [
  ['a start frequency below 1 Hz', { f1: -1 }, /f1 must be ≥ 1 Hz/],
  ['a start above the end', { f1: 20, f2: 10 }, /f1 \(20 Hz\) must be below f2 \(10 Hz\)/],
]) {
  test(`the Stimulus step names the reason the setup check refused ${what}`, () => {
    const r = recipe(stimulus);
    const flow = measureFlow({ state: S.INVALID, preflight: refusedReport(r), recipe: r });
    const st = flow.steps.find((s) => s.id === 'stimulus');
    assert.equal(st.status, 'blocked');
    assert.equal(st.reasons[0].code, 'INVALID_RECIPE');
    assert.match(st.detail, reason, 'the step shows the validator\'s reason');
    assert.doesNotMatch(st.detail, /log sweep/, 'not the description of the refused sweep');
  });
}

test('an accepted sweep still reads as its description', () => {
  const r = recipe({});
  const flow = measureFlow({ state: S.READY, recipe: r,
    preflight: { ready: true, sampleRate: 48000, blockers: [], warnings: [] } });
  const st = flow.steps.find((s) => s.id === 'stimulus');
  assert.notEqual(st.status, 'blocked');
  assert.match(st.detail, /^20 Hz → 20 kHz log sweep, 10 s, LOW output, 3 runs$/);
});

// Review of #331, R6: the report is about the recipe it checked. Once the user corrects the
// refused sweep, the Stimulus step stops repeating the old refusal before the next check.
test('a corrected recipe no longer shows the refusal of the sweep it replaced', () => {
  const refused = recipe({ f1: -1 });
  const report = { ...refusedReport(refused), recipe: refused };
  const fixed = recipe({ f1: 30 });
  const flow = measureFlow({ state: S.INVALID, preflight: report, recipe: fixed });
  const st = flow.steps.find((s) => s.id === 'stimulus');
  assert.notEqual(st.status, 'blocked', 'the corrected sweep is not the refused one');
  assert.notEqual(st.status, 'done', 'nor was it checked');
  assert.doesNotMatch(st.detail, /f1 must be/, 'the old reason is gone');
  assert.match(st.detail, /^30 Hz → 20 kHz log sweep.*\(changed since the setup check\)$/);
  assert.equal(flow.primaryAction.label, 'Check setup again');
  assert.equal(flow.primaryAction.reason, null, 'the action names no stale reason either');
  // the same report, still for the setup as it is, keeps its refusal
  const same = measureFlow({ state: S.INVALID, preflight: report, recipe: recipe({ f1: -1 }) });
  assert.match(same.steps.find((s) => s.id === 'stimulus').detail, /f1 must be ≥ 1 Hz/);
});
