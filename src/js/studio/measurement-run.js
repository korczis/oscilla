// Studio measurement clips → the MeasurementEngine (spec §106-§110, §180; ADR 0019, ADR 0038;
// plan V424, V425). The transport (transport.js) plays measurement clips as data: it calls
// onMeasurement({ type: 'schedule' | 'cancel' | 'release' | 'retime' | 'stop', ... }). This
// module is that hook. It orchestrates and never duplicates the V3 measurement layer:
//
//   createStudioMeasurementRun({ getModel, sampleRate, now, run, stopStudio, onChange, timers,
//     profileId })
//     getModel()      the store's current model (frozen plain data)
//     sampleRate()    the running AudioContext's rate (recipeFromStudio renders the stimulus at it)
//     now()           AudioContext.currentTime (the clips' startTime is on the audio clock)
//     run(recipe, model) -> Promise<{ ok, state, experimentId?, experiment?, reason? }>
//                     runs ONE measurement through the MeasurementEngine of the MEASURE workspace
//                     (its state machine, io, calibration, abort paths and output exclusivity)
//                     and saves the experiment with the Studio provenance block; the workspace
//                     supplies it (measure.js measureRunRecipe)
//     stopStudio()    -> Promise: release the Studio output (the measurement then owns it)
//     onChange(view)  the run's plain view after every change
//     profileId()     the frequency profile id MEASURE will apply, or null: a graph that shows
//                     another calibration is refused (recipeFromStudio, V431 review A1)
//   run.hook(event)   the transport's onMeasurement
//   run.abort(reason) cancel a pending hand-off; a running measurement is aborted by the caller
//                     through the MEASURE engine (Escape, STOP, page hide, leaving the workspace)
//   run.view          { state: 'idle' | 'pending' | 'running' | 'done' | 'failed', pass, recipe?,
//                       text, experimentId, result? }
//
// One pass of the timeline is ONE measurement (§108): its measurement clips (noise check,
// pre-roll, stimulus, capture, tail, analysis) are the recipe (provenance.js recipeFromStudio:
// stimulus from the Sweep wired to a Transfer Analyzer REFERENCE, timing from the clips), and
// the MeasurementEngine's own state machine runs those phases with that timing. The first
// 'schedule' of a pass arms the hand-off at that clip's start on the audio clock; at the
// hand-off the Studio output is released (the transport's STOP path, 0 nodes), then the
// measurement starts. A hand-off due within HANDOFF_NOW_S runs in a microtask: the Studio
// releases its output before its first scheduled sound (one scheduling lead ahead) reaches the
// speaker. The timer is bookkeeping (when to hand off), never audio timing: the measurement
// engine schedules its own stimulus on the audio clock. A transport 'stop' or 'cancel' before
// the hand-off disarms it. Nothing is measured twice in one pass; a refused derivation (no
// Transfer Analyzer, no logarithmic Sweep reference, ...) is reported with its reason and the
// pass plays on.

import { recipeFromStudio } from './provenance.js';

/** A hand-off due within this many seconds of now runs at once (microtask). */
export const HANDOFF_NOW_S = 0.05;

export const MEASUREMENT_RUN_TEXT = Object.freeze({
  pending: 'Measurement armed: it starts at the first measurement clip.',
  running: 'Measuring: the measurement engine owns the output.',
  refused: (reason) => `Measurement not run: ${reason}`,
  failed: (reason) => `Measurement did not complete: ${reason}`,
  saved: (name) => `Measurement saved as experiment “${name}” with the Studio provenance.`,
  aborted: 'Measurement aborted.',
});

const messageOf = (e) => (e && e.message) || String(e);

export function createStudioMeasurementRun({
  getModel, sampleRate, now, run, stopStudio, onChange = null, profileId = () => null,
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
  if (typeof getModel !== 'function' || typeof run !== 'function') {
    throw new TypeError('createStudioMeasurementRun: getModel and run are required');
  }
  let view = { state: 'idle', pass: null, text: '', experimentId: null, recipe: null };
  let timer = null;
  let pendingKeys = new Set();
  let token = 0;
  const handledPasses = new Set();

  const set = (patch) => {
    view = { ...view, ...patch };
    if (onChange) {
      try { onChange(view); } catch (e) { /* the listener's own */ }
    }
  };
  const disarm = () => {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
    pendingKeys = new Set();
  };

  async function handOff(my, recipe, model) {
    if (my !== token || view.state !== 'pending') return;
    timer = null;
    set({ state: 'running', text: MEASUREMENT_RUN_TEXT.running });
    try {
      if (typeof stopStudio === 'function') await stopStudio();
      const r = await run(recipe, model);
      if (my !== token) return;
      if (r && r.ok) {
        set({ state: 'done', experimentId: r.experimentId || null, result: r,
          text: MEASUREMENT_RUN_TEXT.saved(r.name || 'Studio measurement') });
      } else if (r && r.state === 'ABORTED') {
        set({ state: 'failed', result: r, text: MEASUREMENT_RUN_TEXT.aborted });
      } else {
        set({ state: 'failed', result: r || null,
          text: MEASUREMENT_RUN_TEXT.failed((r && r.reason) || (r && r.state) || 'unknown') });
      }
    } catch (e) {
      if (my === token) set({ state: 'failed', text: MEASUREMENT_RUN_TEXT.failed(messageOf(e)) });
    }
  }

  function schedule(ev) {
    if (view.state === 'pending') {
      if (ev.pass === view.pass) pendingKeys.add(ev.key);
      return;
    }
    if (view.state === 'running' || handledPasses.has(ev.pass)) return;
    handledPasses.add(ev.pass);
    const model = getModel();
    const r = recipeFromStudio(model, { sampleRate: sampleRate(),
      profileId: typeof profileId === 'function' ? profileId() : null });
    if (!r.ok) {
      set({ state: 'failed', pass: ev.pass, recipe: null,
        text: MEASUREMENT_RUN_TEXT.refused(r.reason) });
      return;
    }
    token += 1;
    const my = token;
    pendingKeys = new Set([ev.key]);
    set({ state: 'pending', pass: ev.pass, recipe: r.recipe, experimentId: null, result: null,
      text: MEASUREMENT_RUN_TEXT.pending });
    const lead = Number.isFinite(ev.startTime) ? ev.startTime - now() : 0;
    if (!(lead > HANDOFF_NOW_S)) {
      queueMicrotask(() => handOff(my, r.recipe, model));
    } else {
      timer = timers.setTimeout(() => handOff(my, r.recipe, model), Math.round(lead * 1000));
    }
  }

  function hook(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    switch (ev.type) {
      case 'schedule':
        schedule(ev);
        break;
      case 'cancel':
        if (view.state === 'pending' && pendingKeys.has(ev.key)) {
          pendingKeys.delete(ev.key);
          if (!pendingKeys.size) abort('cancel');
        }
        break;
      case 'stop':
        // The hand-off's own STOP arrives while running and is ignored.
        if (view.state === 'pending') abort('stop');
        handledPasses.clear();
        break;
      default:
        break; // 'release', 'retime': the measurement engine keeps its own timing
    }
  }

  function abort(reason = 'user') {
    if (view.state !== 'pending') return false;
    token += 1;
    disarm();
    set({ state: 'idle', text: reason === 'user' ? MEASUREMENT_RUN_TEXT.aborted : '',
      recipe: null });
    return true;
  }

  return {
    hook,
    abort,
    /** The run finished or failed: back to idle (the next PLAY may measure again). */
    reset() {
      if (view.state === 'running') return false;
      token += 1;
      disarm();
      handledPasses.clear();
      set({ state: 'idle', pass: null, text: '', recipe: null, experimentId: null,
        result: null });
      return true;
    },
    get view() { return view; },
    get busy() { return view.state === 'pending' || view.state === 'running'; },
  };
}
