// STUDIO workspace (src/js/ui/studio/workspace.js), measurement bridge: the hand-off of the
// measurement clips to MEASURE and the Studio task strip (a measurement or a WAV render).
//
// Measurement clips (§106-§110; plan V424, V425): the transport's onMeasurement hook is
// src/js/studio/measurement-run.js. One pass of measurement clips is ONE measurement: its recipe
// is derived from the topology (provenance.js recipeFromStudio), the Studio releases the output
// at the first clip, and the MEASURE workspace's MeasurementEngine runs it (measure.js
// measureRunRecipe: the same state machine, io, calibration, abort paths and exclusivity); the
// experiment is saved with the Studio provenance block (withStudioProvenance). STOP, Escape,
// page hide and leaving the workspace abort it as they abort any measurement.

import { withStudioProvenance } from '../../../studio/provenance.js';

/** The idle Studio task view (render or measurement in progress). */
export const IDLE_TASK = Object.freeze({ active: false, kind: '', label: '', pct: null, text: '',
  abortable: false });

/** The name of an experiment a Studio measurement saves (the MEASURE name when one is typed). */
export function studioExperimentName(experiment, model) {
  const typed = experiment && experiment.name && !/^TEST CONTEXT/.test(experiment.name)
    && experiment.name !== 'Playback / capture chain' ? experiment.name : '';
  return typed || `${model.metadata.title} (Studio)`;
}

/**
 * The measurement bridge functions over `ctx` (`ops` holds those of the other parts), and
 * their members of the component. -> { ops, part }
 */
export function createWorkspaceMeasurement(ctx, svc, ops) {
  function setTask(view) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    const cur = cmp.studio.task;
    if (Object.keys(view).every((k) => cur[k] === view[k])) return;
    cmp.studio.task = { ...view };
  }

  /** The task strip while a Studio measurement runs: MEASURE's own state and progress. */
  function measureTaskView() {
    const cmp = ctx.cmp;
    const run = ctx.measureRun ? ctx.measureRun.view : null;
    if (!cmp || !run || (run.state !== 'pending' && run.state !== 'running')) return IDLE_TASK;
    const m = cmp.meas || {};
    const pct = run.state === 'running' && Number.isFinite(m.progressPct) ? m.progressPct : null;
    const state = run.state === 'pending' ? 'armed' : String(m.state || 'starting')
      .toLowerCase().replace(/_/g, ' ');
    return { active: true, kind: 'measure', label: 'Measuring from Studio', pct,
      text: pct === null ? state : `${state} · ${pct} %`, abortable: true };
  }

  function onMeasureRun(view) {
    if (view.state === 'pending' || view.state === 'running') setTask(measureTaskView());
    else if (ctx.cmp && ctx.cmp.studio.task.kind === 'measure') setTask(IDLE_TASK);
    if (view.text) {
      const bad = view.state === 'failed';
      ops.announce(view.text, { assertive: bad });
      if (ctx.cmp && (view.state === 'done' || bad)) ctx.cmp.studio.measureNote = view.text;
    }
  }

  function runMeasurement(recipe, model, { startAt = null } = {}) {
    const cmp = ctx.cmp;
    if (!cmp || typeof cmp.measureRunRecipe !== 'function') {
      return Promise.resolve({ ok: false, state: 'IDLE',
        reason: 'The measurement workspace is not available.' });
    }
    return cmp.measureRunRecipe(recipe, { startAt, decorate: (e) => withStudioProvenance({
      ...e, name: studioExperimentName(e, model) }, model) });
  }

  const part = {
    /** Abort the running Studio task: a WAV render, or a measurement started from Studio. */
    studioAbortTask() {
      if (ctx.render) {
        ctx.render.controller.abort();
        return true;
      }
      const run = ctx.measureRun;
      if (run && run.view.state === 'pending') {
        run.abort('user');
        ops.stopStudio({ fast: true });
        return true;
      }
      if (run && run.view.state === 'running' && typeof this.measureAbort === 'function') {
        return this.measureAbort('user');
      }
      return false;
    },
  };
  return { ops: { setTask, measureTaskView, onMeasureRun, runMeasurement }, part };
}
