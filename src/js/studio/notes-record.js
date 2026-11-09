// Record (plan K223): live hits written into a notes clip at the audio-clock playhead, quantised
// to the clip's grid, one undoable CLIP_UPDATE per take. Pure apart from the recorder, which
// listens to the Studio transport (transport.js emits 'live' for every live note with the
// timeline's playhead at the note's own audio time, and 'state' when it stops) and dispatches the
// take through the one store. No timer and no frame: every time is the transport's.
//
//   quantise(beat, stepBeats) -> beat   the nearest step; a hit exactly between two steps goes
//                                       to the later one
//   takeNotes(model, clip, hits) -> notes   the clip's notes with the take's hits: each hit
//       { beat (from the clip start), note, velocity (0-127) } wrapped into the clip's length (a
//       loop pass past its end never writes beyond it), quantised, one step long; a hit on a
//       step that already holds its note replaces that note's velocity (one note kept)
//   takeAction(model, clipId, hits) -> CLIP_UPDATE | null   null for a take with no hit
//   recorderOf(transport, store) -> recorder   one per transport; store { getModel, dispatch }
//     recorder.arm(clipId), disarm() -> the take's dispatch result | null, toggle(clipId),
//     .armed, .clipId, .pending (hits of the take so far), on(fn) -> off (fn() on arm/disarm)
//   A take runs from arm to disarm, or to a stop of the transport; only notes the router
//   delivered to the clip's target while the timeline plays count (Record while stopped is armed
//   and writes nothing until Play).

import { NEW_STEP_GRID } from './notes-grid.js';
import { effectiveTarget } from './timeline.js';

const EPS = 1e-9;
const round9 = (x) => Number(x.toFixed(9));

export function quantise(beat, stepBeats) {
  return round9(Math.floor(beat / stepBeats + 0.5 + EPS) * stepBeats);
}

const lengthOf = (model, clip) => (clip.musical && Number.isFinite(clip.musical.durationBeats)
  ? clip.musical.durationBeats : (clip.duration * model.transport.tempo) / 60);

export function takeNotes(model, clip, hits) {
  const step = (clip.payload.grid && clip.payload.grid.stepBeats) || NEW_STEP_GRID.stepBeats;
  const length = lengthOf(model, clip);
  const notes = clip.payload.notes.map((n) => ({ ...n }));
  for (const h of hits) {
    let at = quantise((((h.beat % length) + length) % length), step);
    if (at >= length - EPS) at = 0; // the last half step wraps to the clip's first step
    const vel = round9(Math.min(1, Math.max(1, h.velocity) / 127));
    const same = notes.find((n) => n.note === h.note && Math.abs(n.at - at) < 1e-6);
    if (same) same.vel = vel;
    else notes.push({ at, note: h.note, len: step, vel });
  }
  return notes.sort((a, b) => a.at - b.at || a.note - b.note);
}

export function takeAction(model, clipId, hits) {
  const clip = model.timeline.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== 'notes' || !hits.length) return null;
  return { type: 'CLIP_UPDATE', clipId,
    payload: { ...clip.payload, notes: takeNotes(model, clip, hits) } };
}

const recorders = new WeakMap();

export function recorderOf(transport, store) {
  if (!recorders.has(transport)) recorders.set(transport, createRecorder(transport, store));
  return recorders.get(transport);
}

function createRecorder(transport, store) {
  let clipId = null;
  let hits = [];
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* its own */ } });
  const commit = () => {
    const a = clipId ? takeAction(store.getModel(), clipId, hits) : null;
    hits = [];
    return a ? store.dispatch(a) : null;
  };
  transport.on((type, d) => {
    if (type === 'state' && d && d.playing === false) commit();
    if (type !== 'live' || !clipId || !d || !d.ph || !d.ph.playing) return;
    if (d.ev.kind !== 'on' || (d.r && d.r.ok === false)) return;
    const m = store.getModel();
    const clip = m.timeline.clips.find((c) => c.id === clipId);
    if (!clip || effectiveTarget(m, clip) !== d.id) return;
    hits.push({ beat: ((d.ph.position - clip.start) * m.transport.tempo) / 60, note: d.ev.note,
      velocity: Number.isFinite(d.ev.velocity) ? d.ev.velocity : 100 });
  });
  const rec = {
    get armed() { return !!clipId; },
    get clipId() { return clipId; },
    get pending() { return hits.length; },
    arm(id) {
      if (clipId && clipId !== id) commit();
      clipId = id;
      notify();
    },
    disarm() {
      const r = commit();
      clipId = null;
      notify();
      return r;
    },
    toggle(id) { return clipId === id ? rec.disarm() : rec.arm(id); },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return rec;
}
