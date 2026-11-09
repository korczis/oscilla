// Notes clips on a Keys node, as the Studio transport plays them (K068, ADR 0086 decision 6).
// Composed by transport.js; pure apart from the handles it is given, which are the runtime's
// own (adapters/instrument.js keys: play, holdPitch, keyRange). No audio node is created and no
// timer runs here: every call lands at an audio-clock time the timeline compiler computed.
//
//   createNotePlayer({ getModel, ready, registry, gate, clock, played, warn }) -> player
//     getModel()        the model the transport plays
//     ready(id)         the runtime handle of node `id` when it is ready, else null
//     gate(it, envId, deferred)   a gate record for item `it` on Envelope `envId` (transport
//                       addGate: its unions, edits and STOP); clock(it, id) a trigger (addTick)
//     played(it, code, reason)   the transport's unplayed bookkeeping: null code means it plays
//     warn(code, text, entity)   a transport diagnostic
//   player.play(it, deferred)    one `note` item (timeline-compiler.js): its pitch through the
//                                Keys note path, handle.play(t, note, velocity, { legato: slide,
//                                onset: gate }) (a slide glides over the node's Glide, linear in
//                                exact time, K060), and, when it opens a gate, a gate on each
//                                Envelope and a trigger on each clocked node the Keys Gate
//                                reaches (live-notes.js gateTargets), as a key does. A note
//                                outside the node's key range is not played and warned once per
//                                clip (key-range), as the live keys refuse it
//   player.cancel(key, touched)  forget a cancelled item's pitch; its node joins `touched`
//   player.touch(touched)        every node a note played on joins `touched` (STOP)
//   player.rebuild(id, horizon)  re-play node `id`'s pitches from `horizon`: hold the pitch
//                                there (handle.holdPitch), then every later record in time
//                                order, so an edit, an out-of-order onset or STOP leaves exactly
//                                the notes still due. On a node the runtime rebuilt (a record
//                                still names the old handle) the note sounding at `horizon`, the
//                                last record before it, is stepped to there first: the new node
//                                starts at pitch 0 otherwise (#474 pre-read)
//   player.stale()               the node ids whose records name a handle the runtime replaced
//                                (the transport's afterApply rebuilds them, as rebuildClock)
//   player.prune(now, keepS)     forget records older than keepS, except each node's last one
//                                (the note a rebuilt node takes up); player.clear(), player.size
//   notesSteps(model, playhead, registry) -> [{ clipId, step, position }]   the step under the
//                                playhead of each playing notes clip with a grid

import { clipTarget } from './clip-targets.js';
import { LIVE_NOTES_TEXT, gateTargets } from './live-notes.js';
import { NODE_REGISTRY } from './registry.js';
import { effectiveTarget } from './timeline.js';

export function createNotePlayer({ getModel, ready, registry = NODE_REGISTRY, gate, clock,
  played, warn }) {
  // item key -> { key, nodeId, handle, time, note, velocity, slide, gate }
  const pitches = new Map();
  const apply = (h, x) => h.play(x.time, x.note, x.velocity, { legato: x.slide, onset: x.gate });

  /** The last record of node `id` before `t`, or null. */
  const lastBefore = (id, t) => {
    let last = null;
    for (const x of pitches.values()) {
      if (x.nodeId === id && x.time < t && (!last || x.time >= last.time)) last = x;
    }
    return last;
  };

  function rebuild(id, horizon) {
    const h = ready(id);
    if (!h || typeof h.holdPitch !== 'function') return;
    const mine = [...pitches.values()].filter((x) => x.nodeId === id);
    const replaced = mine.some((x) => x.handle !== h);
    const list = mine.filter((x) => x.time >= horizon).sort((a, b) => a.time - b.time);
    h.holdPitch(horizon);
    const sounding = replaced ? lastBefore(id, horizon) : null;
    if (sounding) {
      sounding.handle = h;
      h.play(horizon, sounding.note, sounding.velocity);
    }
    for (const x of list) {
      x.handle = h;
      apply(h, x);
    }
  }

  function play(it, deferred = null) {
    const model = getModel();
    const n = model.graph.nodes.find((x) => x.id === it.target) || null;
    const v = clipTarget(n, { kind: 'notes' }, registry);
    if (!v.plays) return played(it, v.code, v.reason);
    const h = ready(it.target);
    if (!h || typeof h.play !== 'function') return played(it, 'target-unavailable', null);
    played(it, null, null);
    const [lo, hi] = typeof h.keyRange === 'function' ? h.keyRange() : [0, 127];
    if (it.note < lo || it.note > hi) {
      warn('key-range', LIVE_NOTES_TEXT.keyRange(it.note, lo, hi), { kind: 'clip', id: it.clipId });
      return null;
    }
    const id = it.target;
    const later = [...pitches.values()].some((x) => x.nodeId === id && x.time > it.startTime);
    const rec = { key: it.key, nodeId: id, handle: h, time: it.startTime, note: it.note,
      velocity: it.velocity, slide: !!it.slide, gate: !!it.gate };
    pitches.set(it.key, rec);
    if (!(deferred && deferred.has(id))) { // a deferred node is re-played by the caller
      if (later) rebuild(id, it.startTime);
      else apply(h, rec);
    }
    if (!it.gate) return null;
    const targets = gateTargets(model, id);
    for (const env of targets.envelopes) gate(it, env, deferred);
    for (const c of targets.clocks) clock(it, c);
    return null;
  }

  return {
    play,
    rebuild,
    cancel(key, touched) {
      const x = pitches.get(key);
      if (!x) return;
      pitches.delete(key);
      touched.add(x.nodeId);
    },
    touch(touched) {
      for (const x of pitches.values()) touched.add(x.nodeId);
    },
    stale() {
      return new Set([...pitches.values()].filter((x) => x.handle !== ready(x.nodeId))
        .map((x) => x.nodeId));
    },
    prune(now, keepS) {
      const keep = new Set();
      for (const x of pitches.values()) {
        const last = lastBefore(x.nodeId, now + 1e-9);
        if (last) keep.add(last.key);
      }
      for (const [key, x] of pitches) {
        if (x.time + keepS < now && !keep.has(key)) pitches.delete(key);
      }
    },
    clear: () => pitches.clear(),
    get size() { return pitches.size; },
  };
}

export function notesSteps(model, ph, registry = NODE_REGISTRY) {
  if (!model || !ph || !ph.playing) return [];
  const spb = 60 / model.transport.tempo;
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  return model.timeline.clips.filter((c) => c.kind === 'notes' && c.payload.grid
    && ph.position >= c.start && ph.position < c.start + c.duration
    && clipTarget(byId.get(effectiveTarget(model, c)) || null, { kind: 'notes' }, registry).plays)
    .map((c) => ({ clipId: c.id, position: ph.position,
      step: Math.floor((ph.position - c.start) / (c.payload.grid.stepBeats * spb) + 1e-9) }));
}
