// The Studio workspace's measurement bridge (src/js/ui/studio/workspace/measurement.js, plan
// V424/V425): the task strip shows MEASURE's own state and progress while a Studio measurement is
// armed or running and goes idle after it; the run's sentence is announced (assertive when it
// failed) and kept as the Studio's measure note when it ends; a recipe runs through MEASURE's
// measureRunRecipe with the Studio provenance and the experiment name; Abort ends a render, an
// armed run (and stops the Studio fast) or a running measurement, and nothing else.
//   node --test tests/unit/studio-workspace-measurement.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IDLE_TASK, createWorkspaceMeasurement, studioExperimentName,
} from '../../src/js/ui/studio/workspace/measurement.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

function harness({ cmp = undefined, measureRun = null, render = null } = {}) {
  const said = [];
  const stops = [];
  const c = cmp === undefined ? { studio: { task: { ...IDLE_TASK }, measureNote: '' }, meas: {} }
    : cmp;
  const ctx = { cmp: c, measureRun, render };
  const ops = {
    announce: (text, opts) => said.push({ text, assertive: !!(opts && opts.assertive) }),
    stopStudio: (o) => stops.push(o) };
  const { ops: mops, part } = createWorkspaceMeasurement(ctx, {}, ops);
  return { ctx, cmp: c, said, stops, mops, part };
}

test('studioExperimentName keeps a typed name and names the Studio otherwise', () => {
  const model = { metadata: { title: 'Bass patch' } };
  assert.equal(studioExperimentName({ name: 'Room sweep' }, model), 'Room sweep');
  assert.equal(studioExperimentName({ name: 'TEST CONTEXT loopback' }, model),
    'Bass patch (Studio)');
  assert.equal(studioExperimentName({ name: 'Playback / capture chain' }, model),
    'Bass patch (Studio)');
  assert.equal(studioExperimentName({ name: '' }, model), 'Bass patch (Studio)');
  assert.equal(studioExperimentName(null, model), 'Bass patch (Studio)');
});

test('the task view is idle without a component, a run, or a run that is not armed or running',
  () => {
    assert.equal(harness({ cmp: null }).mops.measureTaskView(), IDLE_TASK);
    assert.equal(harness().mops.measureTaskView(), IDLE_TASK);
    const done = harness({ measureRun: { view: { state: 'done' } } });
    assert.equal(done.mops.measureTaskView(), IDLE_TASK);
  });

test('an armed run shows "armed" with no percentage; a running one MEASURE\'s state and progress',
  () => {
    const armed = harness({ measureRun: { view: { state: 'pending' } } });
    assert.deepEqual(armed.mops.measureTaskView(), { active: true, kind: 'measure',
      label: 'Measuring from Studio', pct: null, text: 'armed', abortable: true });

    const run = harness({ measureRun: { view: { state: 'running' } } });
    run.cmp.meas = { state: 'CAPTURING_SWEEP', progressPct: 42 };
    const v = run.mops.measureTaskView();
    assert.equal(v.pct, 42);
    assert.equal(v.text, 'capturing sweep · 42 %');

    run.cmp.meas = { state: undefined, progressPct: Number.NaN };
    const s = run.mops.measureTaskView();
    assert.equal(s.pct, null);
    assert.equal(s.text, 'starting');
    // A pending run never shows a percentage, even when MEASURE has one.
    armed.cmp.meas = { progressPct: 10 };
    assert.equal(armed.mops.measureTaskView().pct, null);
  });

test('onMeasureRun sets the task while active, idles a measure task after it, and keeps the note',
  () => {
    const run = { view: { state: 'running' } };
    const h = harness({ measureRun: run });
    h.cmp.meas = { state: 'RUNNING', progressPct: 5 };
    h.mops.onMeasureRun({ state: 'running', text: '' });
    assert.equal(h.cmp.studio.task.kind, 'measure');
    assert.equal(h.cmp.studio.task.text, 'running · 5 %');
    assert.deepEqual(h.said, []);
    // The same view again replaces nothing (no new object for an unchanged strip).
    const kept = h.cmp.studio.task;
    h.mops.onMeasureRun({ state: 'running' });
    assert.equal(h.cmp.studio.task, kept);

    run.view.state = 'done';
    h.mops.onMeasureRun({ state: 'done', text: 'Measurement saved.' });
    assert.deepEqual(h.cmp.studio.task, IDLE_TASK);
    assert.deepEqual(h.said, [{ text: 'Measurement saved.', assertive: false }]);
    assert.equal(h.cmp.studio.measureNote, 'Measurement saved.');

    h.mops.onMeasureRun({ state: 'failed', text: 'Input clipped.' });
    assert.deepEqual(h.said.at(-1), { text: 'Input clipped.', assertive: true });
    assert.equal(h.cmp.studio.measureNote, 'Input clipped.');
    // An aborted run is announced but is not the note.
    h.mops.onMeasureRun({ state: 'aborted', text: 'Aborted.' });
    assert.equal(h.cmp.studio.measureNote, 'Input clipped.');
  });

test('a render task is not idled by a measurement that ends', () => {
  const h = harness();
  h.cmp.studio.task = { active: true, kind: 'render', label: 'Rendering', pct: 3, text: '3 %',
    abortable: true };
  h.mops.onMeasureRun({ state: 'done' });
  assert.equal(h.cmp.studio.task.kind, 'render');
});

test('runMeasurement refuses without MEASURE and otherwise decorates with provenance and name',
  async () => {
    const model = templateModel(REFERENCE_TEMPLATE_ID);
    const none = harness({ cmp: null });
    assert.deepEqual(await none.mops.runMeasurement({}, model), { ok: false, state: 'IDLE',
      reason: 'The measurement workspace is not available.' });
    const bare = harness();
    assert.equal((await bare.mops.runMeasurement({}, model)).ok, false);

    const h = harness();
    const calls = [];
    h.cmp.measureRunRecipe = (recipe, opts) => {
      calls.push({ recipe, opts });
      return Promise.resolve({ ok: true });
    };
    const recipe = { sweep: 'log' };
    assert.deepEqual(await h.mops.runMeasurement(recipe, model, { startAt: 1.5 }), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].recipe, recipe);
    assert.equal(calls[0].opts.startAt, 1.5);
    const e = calls[0].opts.decorate({ name: 'TEST CONTEXT', schemaVersion: 1 });
    assert.equal(e.name, `${model.metadata.title} (Studio)`);
    assert.equal(typeof e.studio, 'object');
    assert.ok(e.schemaVersion >= 1);
  });

test('studioAbortTask aborts a render, an armed run, a running measurement, else nothing', () => {
  let aborted = 0;
  const r = harness({ render: { controller: { abort: () => { aborted += 1; } } } });
  assert.equal(r.part.studioAbortTask(), true);
  assert.equal(aborted, 1);

  const why = [];
  const pending = harness({ measureRun: { view: { state: 'pending' },
    abort: (w) => why.push(w) } });
  assert.equal(pending.part.studioAbortTask(), true);
  assert.deepEqual(why, ['user']);
  assert.deepEqual(pending.stops, [{ fast: true }]);

  const running = harness({ measureRun: { view: { state: 'running' } } });
  const comp = { ...running.part, measureAbort: (w) => `aborted:${w}` };
  assert.equal(comp.studioAbortTask(), 'aborted:user');
  // Running without MEASURE's abort, or nothing to abort: false.
  assert.equal(running.part.studioAbortTask(), false);
  assert.equal(harness().part.studioAbortTask(), false);
});
