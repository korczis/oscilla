// The Studio Inspector's step grid of a selected notes clip (plan issue W008, ADR 0086): the
// step-grid kind's first mounted consumer. The clip is shown as lanes of steps: a lane per note
// number the clip holds (highest first, named C4, D#3, ...; an empty clip shows DEFAULT_LANE),
// steps of the clip grid's stepBeats (NEW_STEP_GRID's when it has none) across the clip's
// beats. Every edit is one plain action the Inspector dispatches through the one Studio store
// (CLIP_UPDATE of the notes array, NOTES_GRID_SET for the grid); a refusal is said once in the
// grid's polite live region. The Inspector owns the selection and the page (rule 2 of W001).
// The playing step is read from the Studio transport's playhead on the frame loop, only while
// the clip's target plays notes (clip-targets.js), with no allocation of its own per frame.
// The grid fits its pages to the Inspector's width itself (four steps in the 268 px side panel,
// eight at a phone's full width), so no step is cut off.
//
//   DEFAULT_LANE, MAX_STEPS
//   clipStepsView(model, clip, plays) -> { clipId, payload, stepBeats, steps, lanes, laneNames,
//                                          start, plays }
//   playingStep(model, view, playhead) -> step | null
//   mountClipSteps(host, { store, playhead, liveTransport, announce }, view) -> { update(view),
//                                          destroy(), grid }   with liveTransport, the Record
//                                          switch above the grid (K223, ui/kinds/record-switch.js)
//   mountListSteps(host, { dispatch, say }, { nodeId, param, values })
//     -> { update(values), resize(length, now) -> values | { reason }, destroy(), grid }
//     K221: a list parameter (the Step Modulator's steps) as the kind's param-list lane, one
//     NODE_PARAM_SET per gesture; resize pads with 0 or cuts to `length` within the parameter's
//     minLength..maxLength

import { midiToName } from '../../core/music.js';
import { NEW_STEP_GRID } from '../../studio/notes-grid.js';
import { mountStepGrid } from '../kinds/step-grid.js';
import { bindRecordSwitch, recordSwitchHtml } from '../kinds/record-switch.js';
import { PRO } from '../pro-classes.js';

/** The lane an empty notes clip shows: C4. */
export const DEFAULT_LANE = 60;
/** The most steps the grid shows (the kind's steps prop). */
export const MAX_STEPS = 64;
const LABEL = 'Kroky notového klipu';

export function clipStepsView(model, clip, plays = false) {
  const payload = clip.payload;
  const stepBeats = (payload.grid && payload.grid.stepBeats) || NEW_STEP_GRID.stepBeats;
  const beats = clip.musical && Number.isFinite(clip.musical.durationBeats)
    ? clip.musical.durationBeats : (clip.duration * model.transport.tempo) / 60;
  const steps = Math.min(MAX_STEPS, Math.max(1, Math.round(beats / stepBeats)));
  const held = [...new Set(payload.notes.map((n) => n.note))].sort((a, b) => b - a);
  const lanes = held.length ? held : [DEFAULT_LANE];
  return { clipId: clip.id, payload, stepBeats, steps, lanes, laneNames: lanes.map(midiToName),
    start: clip.start, plays: !!plays };
}

export function playingStep(model, view, ph) {
  if (!view.plays || !ph || !ph.playing) return null;
  const spb = 60 / model.transport.tempo;
  const step = Math.floor((ph.position - view.start) / (view.stepBeats * spb) + 1e-9);
  return step >= 0 && step < view.steps ? step : null;
}

export function mountClipSteps(host, svc, first) {
  let view = first;
  const owner = { selection: [], page: 0 };
  let grid = null; // the first fit calls onView while mountStepGrid is still building
  let record = null;
  let gridHost = host;
  if (svc.liveTransport) { // K223: Record above the grid, the same switch as the Drums tab's
    const bar = host.ownerDocument.createElement('div');
    bar.className = 'mb-2';
    bar.innerHTML = recordSwitchHtml(PRO.btnSecondary);
    gridHost = host.ownerDocument.createElement('div');
    host.append(bar, gridHost);
    record = bindRecordSwitch(bar.firstChild, { transport: svc.liveTransport, store: svc.store,
      clipId: () => view.clipId, say: (text) => svc.announce && svc.announce(text) });
  }
  grid = mountStepGrid(gridHost, {
    mode: 'notes', label: LABEL, clipId: view.clipId, payload: view.payload, lanes: view.lanes,
    laneNames: view.laneNames, steps: view.steps, stepBeats: view.stepBeats,
    commit: (action) => {
      const r = svc.store.dispatch(action);
      return r.ok ? true : { refused: r.reason || '' };
    },
    onView: (v) => {
      if (v.selection) owner.selection = v.selection;
      if (v.page != null) owner.page = v.page;
      if (grid) grid.set({ selection: owner.selection, page: owner.page });
    },
    playStep: () => playingStep(svc.store.getModel(), view,
      svc.playhead ? svc.playhead() : null),
  });
  return {
    grid,
    update(next) {
      // The Inspector re-renders on every runtime state change: an unchanged clip changes
      // nothing here (its payload is the same object in the immutable model).
      const same = next.payload === view.payload && next.steps === view.steps
        && next.stepBeats === view.stepBeats && next.lanes.join() === view.lanes.join();
      view = next;
      if (same) return;
      grid.set({ payload: next.payload, lanes: next.lanes, laneNames: next.laneNames,
        steps: next.steps, stepBeats: next.stepBeats, selection: owner.selection,
        page: owner.page });
    },
    destroy() {
      grid.destroy();
      if (record) record.destroy();
    },
  };
}

/** K221: the step grid of a list parameter (the Step Modulator's steps), see the header. */
export function mountListSteps(host, svc, { nodeId, param, values }) {
  const owner = { selection: [], page: 0 };
  let shown = values;
  let grid = null; // set below; onView may run during the mount (the TDZ 1a68c485 fixed)
  grid = mountStepGrid(host, { mode: 'param-list', label: param.label,
    laneNames: [param.label], nodeId, param, values, steps: values.length,
    commit: (action) => {
      const r = svc.dispatch(action);
      return r.ok ? true : { refused: r.reason || '' };
    },
    onView: (v) => {
      if (v.selection) owner.selection = v.selection;
      if (v.page != null) owner.page = v.page;
      if (grid) grid.set({ selection: owner.selection, page: owner.page });
    },
    say: (text) => svc.say(text),
    playStep: () => null });
  const min = param.minLength ?? 1;
  const max = param.maxLength ?? 32;
  return {
    grid,
    update(next) {
      if (next === shown) return;
      shown = next;
      grid.set({ values: next, steps: next.length, selection: owner.selection,
        page: owner.page });
    },
    resize(length, now) {
      const n = Math.round(length);
      if (!(n >= min && n <= max)) return { reason: `Počet kroků musí být ${min} až ${max}.` };
      return Array.from({ length: n }, (_, i) => (i < now.length ? now[i] : 0));
    },
    destroy() { grid.destroy(); },
  };
}
