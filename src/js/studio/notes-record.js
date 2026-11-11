// Record (plan K223): live hits written into a notes clip at the audio-clock playhead, quantised
// to the clip's grid, one undoable CLIP_UPDATE per take. Pure apart from the recorder, which
// listens to the Studio transport (transport.js emits 'live' for every live note with the
// timeline's playhead at the note's own audio time, and 'state' when it stops) and dispatches the
// take through the one store. No timer and no frame: every time is the transport's.
//
//   quantise(beat, stepBeats) -> beat   the nearest step; a hit exactly between two steps goes
//                                       to the later one
//   takeNotes(model, clip, hits) -> notes   the clip's notes with the take's hits: each hit
//       { beat (from the clip start), note, velocity (0-127) } inside the clip's length (a hit
//       outside it is dropped, review C1-K223-1), quantised, one step long, the last half step
//       wrapping to the first (nothing is written at or past the clip's length); a hit on a
//       step that already holds its note replaces that note's velocity (one note kept)
//   takeAction(model, clipId, hits) -> CLIP_UPDATE | null   null for a take with no hit
//   recorderOf(transport, store) -> recorder   one per transport; store { getModel, dispatch }
//     recorder.arm(clipId), disarm() -> the take's dispatch result | null, toggle(clipId),
//     .armed, .clipId, .pending (hits of the take so far), on(fn) -> off: fn(event) on
//     { type: 'arm' | 'disarm' } and, when a take with hits is written, { type: 'take', n,
//     reason: 'stop' | 'disarm' | 'rearm' } (review R2-K223-1: the write is said where it happens)
//   A take runs from arm to disarm, or to a stop of the transport; only notes the router
//   delivered to the clip's target while the timeline plays the clip count, on any loop pass
//   (Record while stopped is armed and writes nothing until Play; a note played while the
//   playhead is before or after the clip is not the clip's, review C1-K223-1).
//
// A pad take (plan K231, the coordinator's option A): the same recorder armed with
// padTakeId(nodeId) takes an XY pad's own X and Y (the Synth's pad L) as automation lanes of
// the pad node's x and y parameters, never of what the pad feeds (studio/automation.js
// §103-104: automation authors the base, the modulation stays the edge's, so a take survives a
// re-patch). Each touch on a pass is a segment of { pos (timeline seconds, the playhead at the
// touch's own audio time), x, y } points, thinned to one per PAD_TAKE_STEP_S of the audio
// clock; a loop wrap starts a new segment. The take is written as one BATCH: each segment
// replaces its span on each lane (a re-take keeps the rest of the lane) with a ramp from the
// lane's value there to the touch over PAD_TAKE_RAMP_S, the touch's points, and a ramp back to
// the lane's value after it, as the pad glides (no step on what it feeds). A touch while the
// timeline does not play is refused ({ type: 'refused' }, said by the switch); while it plays
// outside the timeline's span nothing is taken (there is no outside: the playhead is in it).
//   padTakeId(nodeId) -> the id a Record switch arms for that pad; padOf(id) -> nodeId | null
//   padTakeSteps(model, nodeId, segments) -> [action]   the BATCH's steps (pure)
//   padTakeAction(model, nodeId, segments) -> BATCH | null   null for a take with no point

import { laneValueAt } from './automation.js';
import { NEW_STEP_GRID } from './notes-grid.js';
import { TIMELINE_MAX_S } from './schema.js';
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
    if (!(h.beat >= -EPS && h.beat < length)) continue; // outside the clip: not its note
    let at = quantise(Math.max(0, h.beat), step);
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

const PAD_TAKE_PREFIX = 'pad:';
export const padTakeId = (nodeId) => `${PAD_TAKE_PREFIX}${nodeId}`;
export const padOf = (id) => (typeof id === 'string' && id.startsWith(PAD_TAKE_PREFIX)
  ? id.slice(PAD_TAKE_PREFIX.length) : null);
/** Audio-clock seconds between two kept points of a touch (never one per pointermove). */
export const PAD_TAKE_STEP_S = 0.02;
/** The ramp at each end of a touch: about 3 τ of the pad's own glide (PARAM_TAU_S, 15 ms). */
export const PAD_TAKE_RAMP_S = 0.045;
const PAD_KEYS = ['x', 'y'];
const unit = (v) => round9(Math.min(1, Math.max(0, Number(v) || 0)));
const timeOf = (t) => round9(Math.min(TIMELINE_MAX_S, Math.max(0, t)));

export function padTakeSteps(model, nodeId, segments) {
  const node = model.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const adds = [];
  const removes = [];
  for (const key of PAD_KEYS) {
    const lane = model.timeline.automation.find((l) => l.target.node === nodeId
      && l.target.param === key);
    const base = unit(node.params[key]);
    let pts = lane ? lane.points.map((p) => ({ ...p })) : [];
    for (const seg of segments.filter((x) => x.length)) {
      const valueAt = (t) => {
        const v = laneValueAt(pts, t);
        return v === null ? base : v;
      };
      const s0 = seg[0].pos;
      // The touch: its first value after the ramp in (a later point inside the ramp replaces
      // it), every later point, then the ramp out from its last value.
      // Thinned on the audio clock: a point closer than PAD_TAKE_STEP_S to the last kept one
      // replaces the touch's latest, which the touch's end keeps.
      const inner = [];
      let latest = null;
      for (const q of seg) {
        const at = { time: Math.max(q.pos, s0 + PAD_TAKE_RAMP_S), value: unit(q[key]),
          curve: 'linear' };
        const prev = inner[inner.length - 1];
        if (!prev || at.time - prev.time >= PAD_TAKE_STEP_S - EPS) {
          inner.push(at);
          latest = null;
        } else if (at.time <= prev.time + EPS) {
          inner[inner.length - 1] = at;
        } else {
          latest = at;
        }
      }
      if (latest) inner.push(latest);
      const end = inner[inner.length - 1].time + PAD_TAKE_RAMP_S;
      const next = pts.find((p) => p.time >= s0);
      const out = [{ time: s0, value: valueAt(s0),
        curve: next && next.curve === 'step' ? 'step' : 'linear' }, ...inner,
      { time: end, value: valueAt(end), curve: 'linear' }]
        .map((q) => ({ ...q, time: timeOf(q.time), value: round9(q.value) }));
      pts = [...pts.filter((p) => p.time < s0 || p.time > end), ...out]
        .sort((a, b) => a.time - b.time);
    }
    const kept = new Set(pts.filter((p) => p.id).map((p) => p.id));
    for (const p of lane ? lane.points : []) {
      if (!kept.has(p.id)) removes.push({ type: 'AUTOMATION_POINT_REMOVE', laneId: lane.id,
        pointId: p.id });
    }
    for (const q of pts.filter((p) => !p.id)) {
      adds.push({ type: 'AUTOMATION_POINT_ADD', target: { node: nodeId, param: key },
        time: q.time, value: q.value, curve: q.curve });
    }
  }
  // Adds first: a lane whose every point the take replaces is never emptied (and removed) on
  // the way.
  return [...adds, ...removes];
}

export function padTakeAction(model, nodeId, segments) {
  const steps = padTakeSteps(model, nodeId, segments);
  return steps.length ? { type: 'BATCH', label: 'Záznam padu', steps } : null;
}

const recorders = new WeakMap();

export function recorderOf(transport, store) {
  if (!recorders.has(transport)) recorders.set(transport, createRecorder(transport, store));
  return recorders.get(transport);
}

function createRecorder(transport, store) {
  let clipId = null;
  let hits = [];
  // A pad take (K231): its closed segments and the touch being taken.
  let segments = [];
  let open = null;
  const listeners = new Set();
  const notify = (event) => listeners.forEach((fn) => {
    try { fn(event); } catch (e) { /* a listener's error is its own */ }
  });
  const close = () => {
    if (!open) return;
    const last = open.pts[open.pts.length - 1];
    if (open.latest && open.latest.pos > last.pos) open.pts.push(open.latest);
    segments.push(open.pts);
    open = null;
  };
  const points = () => segments.reduce((n, seg) => n + seg.length, 0)
    + (open ? open.pts.length : 0);
  const commit = (reason) => {
    const pad = padOf(clipId);
    if (pad) close();
    const a = !clipId ? null : pad ? padTakeAction(store.getModel(), pad, segments)
      : takeAction(store.getModel(), clipId, hits);
    // A pad take counts the lane points it writes; a notes take its hits.
    const n = pad ? (a ? a.steps.filter((x) => x.type === 'AUTOMATION_POINT_ADD').length : 0)
      : hits.length;
    hits = [];
    segments = [];
    const r = a ? store.dispatch(a) : null;
    if (r && r.ok) notify({ type: 'take', n, reason, ...(pad ? { kind: 'pad' } : {}) });
    return r;
  };
  /** A live event of the armed pad: on, move, off or all-off with its X and Y. */
  const padEvent = (d) => {
    const kind = d.ev && d.ev.kind;
    if (kind === 'off' || kind === 'all-off') {
      close();
      return;
    }
    if (kind !== 'on' && kind !== 'move') return;
    if (!d.ph || !d.ph.playing) { // armed only, or the timeline stopped: nothing to write onto
      if (kind === 'on') notify({ type: 'refused', code: 'not-playing' });
      return;
    }
    if (d.r && d.r.ok === false) return;
    const q = { pos: d.ph.position, x: d.ev.x, y: d.ev.y };
    const last = open && open.pts[open.pts.length - 1];
    if (!open || kind === 'on' || q.pos < (open.latest || last).pos - EPS) { // a loop wrap
      close();
      open = { pts: [q], latest: null };
    } else if (q.pos - last.pos >= PAD_TAKE_STEP_S - EPS) {
      open.pts.push(q);
      open.latest = null;
    } else {
      open.latest = q;
    }
  };
  transport.on((type, d) => {
    if (type === 'state' && d && d.playing === false) commit('stop');
    if (type === 'live' && d && padOf(clipId) !== null) {
      if (d.id === padOf(clipId)) padEvent(d);
      return;
    }
    if (type !== 'live' || !clipId || !d || !d.ph || !d.ph.playing) return;
    if (d.ev.kind !== 'on' || (d.r && d.r.ok === false)) return;
    const m = store.getModel();
    const clip = m.timeline.clips.find((c) => c.id === clipId);
    if (!clip || effectiveTarget(m, clip) !== d.id) return;
    const pos = d.ph.position;
    if (pos < clip.start - EPS || pos >= clip.start + clip.duration) return; // C1-K223-1
    hits.push({ beat: ((d.ph.position - clip.start) * m.transport.tempo) / 60, note: d.ev.note,
      velocity: Number.isFinite(d.ev.velocity) ? d.ev.velocity : 100 });
  });
  const rec = {
    get armed() { return !!clipId; },
    get clipId() { return clipId; },
    get pending() { return padOf(clipId) !== null ? points() : hits.length; },
    arm(id) {
      if (clipId && clipId !== id) commit('rearm');
      clipId = id;
      notify({ type: 'arm' });
    },
    disarm() {
      const r = commit('disarm');
      clipId = null;
      notify({ type: 'disarm' });
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
