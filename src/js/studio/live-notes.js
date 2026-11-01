// Live notes on the Studio transport (plan K103 part, K104): what the Synth panel plays while it
// is armed. Composed by transport.js (arm, disarm, live); pure apart from the handles it is
// given, which are the runtime's own (adapters/instrument.js keys, modulation.js envelope and
// the clocked Random). No audio node is created here.
//
//   liveModel(model) -> model    the armed graph: every node connected to a Keys node (Master
//                                Output included, never crossed), with an empty timeline, so
//                                arming plays the panel and nothing else of the document
//   keysGatedEnvelopes(model) -> Set<envelope id>   reached by an unmuted Keys gate edge: the
//                                transport closes them at arm and PLAY (no drone without a key)
//   gateTargets(model, keysId) -> { envelopes, clocks }
//   createLiveNotes({ getModel, handleOf }) -> notes
//     notes.event(keysId, { kind: 'on' | 'off' | 'all-off', note, velocity, at }) -> result
//       on   the top note changes: the Keys pitch moves (glide only legato), its envelopes get
//            gate(at, null) and its clocked Random clock(at, k), k counted from arm (0 first)
//       off  the stack empties: release(at); the top note changes: legato return, no gate
//     notes.allOff(at) -> how many keys were held; notes.reset(); notes.held() -> [note]
//   A polyphonic engine (nodes/engines.js, capabilities.notes, a handle with noteOn) takes the
//   same events on its own id: on -> noteOn(at, note, velocity), off -> noteOff(at, note),
//   all-off -> allOff(at, fast); its voice pool allocates (adapters/voices.js), no note stack.
//   A note-on that takes no voice (it sounds nothing) is not held: { silent: true }.
//   An XY pad (nodes/instrument.js xy-pad, a handle with move) takes { kind: 'on' | 'move' |
//   'off' | 'all-off', x, y } on its id (plan K097): on and move set X, Y and the scale step
//   (legato while touched); on opens its gate's targets as a Keys gate does, off releases them.

import { createNoteStack } from '../synth/note-stack.js';
import { NODE_REGISTRY } from './registry.js';

/** Whether a node type is a note source: Keys, or a type with capabilities.notes. */
const playsNotes = (type) => {
  const d = NODE_REGISTRY.get(type);
  return type === 'keys' || !!(d && d.capabilities && d.capabilities.notes);
};

const unmuted = (e) => !(e.props && e.props.muted);

/** Envelope and clock targets of a Keys node's gate (its unmuted TRIGGER edges). */
export function gateTargets(model, keysId) {
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const envelopes = [];
  const clocks = [];
  for (const e of model.graph.edges) {
    if (e.from.node !== keysId || e.from.port !== 'gate' || !unmuted(e)) continue;
    const n = byId.get(e.to.node);
    if (!n) continue;
    if (n.type === 'envelope' && e.to.port === 'gate') envelopes.push(n.id);
    else clocks.push(n.id);
  }
  return { envelopes, clocks };
}

export function keysGatedEnvelopes(model) {
  const out = new Set();
  for (const n of model.graph.nodes) {
    if (n.type !== 'keys' && n.type !== 'xy-pad') continue;
    for (const id of gateTargets(model, n.id).envelopes) out.add(id);
  }
  return out;
}

export function liveModel(model) {
  const g = model.graph;
  const keep = new Set(g.nodes.filter((n) => playsNotes(n.type)).map((n) => n.id));
  const isMaster = new Set(g.nodes.filter((n) => n.type === 'master').map((n) => n.id));
  const queue = [...keep];
  while (queue.length) {
    const id = queue.pop();
    if (isMaster.has(id)) continue;
    for (const e of g.edges) {
      const other = e.from.node === id ? e.to.node : e.to.node === id ? e.from.node : null;
      if (other && !keep.has(other)) {
        keep.add(other);
        queue.push(other);
      }
    }
  }
  for (const id of isMaster) keep.add(id);
  return {
    ...model,
    graph: { ...g, nodes: g.nodes.filter((n) => keep.has(n.id)),
      edges: g.edges.filter((e) => keep.has(e.from.node) && keep.has(e.to.node)) },
    timeline: { ...model.timeline, tracks: [], clips: [], automation: [] },
  };
}

export function createLiveNotes({ getModel, handleOf }) {
  const stacks = new Map(); // keys id -> note stack
  const counts = new Map(); // clocked node id -> triggers since arm
  const poly = new Map(); // engine id -> Set of held notes (its pool holds the voices)
  const pads = new Map(); // XY pad id -> the note sounding while it is touched

  const stackOf = (id) => {
    if (!stacks.has(id)) stacks.set(id, createNoteStack());
    return stacks.get(id);
  };
  const gate = (id, at, on) => {
    const { envelopes, clocks } = gateTargets(getModel(), id);
    for (const env of envelopes) {
      const h = handleOf(env);
      if (!h) continue;
      if (on && typeof h.gate === 'function') h.gate(at, null);
      if (!on && typeof h.release === 'function') h.release(at);
    }
    if (!on) return;
    for (const c of clocks) {
      const h = handleOf(c);
      if (!h || typeof h.clock !== 'function') continue;
      const k = counts.get(c) || 0;
      h.clock(at, k);
      counts.set(c, k + 1);
    }
  };

  function polyEvent(id, h, { kind, note, velocity = 100, at, fast = false }) {
    if (!poly.has(id)) poly.set(id, new Set());
    const held = poly.get(id);
    if (kind === 'all-off') {
      const n = held.size;
      h.allOff(at, fast);
      held.clear();
      return { ok: true, held: 0, released: n };
    }
    if (kind === 'on') {
      const r = h.noteOn(at, note, velocity);
      // A note that sounds nothing takes no voice (adapters/voices.js: slot null, every
      // operator above the limit, a ring with no modulator): it is not held either (review of
      // #332, V5), so the held list names only notes that sound.
      const silent = !!r && r.slot == null;
      if (!silent) held.add(note);
      return { ok: true, held: held.size, top: silent ? null : note, silent,
        stolen: !!(r && r.stolen), dropped: r ? r.dropped : 0 };
    }
    held.delete(note);
    h.noteOff(at, note);
    return { ok: true, held: held.size, top: null };
  }

  function padEvent(id, h, { kind, x, y, at }) {
    const down = pads.has(id);
    if (kind === 'off' || kind === 'all-off') {
      pads.delete(id);
      if (down) gate(id, at, false);
      return { ok: true, held: 0, released: down ? 1 : 0 };
    }
    const r = h.move(at, x, y, { legato: down });
    if (kind === 'on' || down) pads.set(id, r.note);
    if (kind === 'on' && !down) gate(id, at, true);
    return { ok: true, held: pads.has(id) ? 1 : 0, top: r.note, ...r };
  }

  function event(keysId, ev) {
    const { kind, note, velocity = 100, at } = ev;
    const ph = handleOf(keysId);
    if ((ph && typeof ph.move === 'function') || (pads.has(keysId) && /off/.test(kind))) {
      return padEvent(keysId, ph, ev);
    }
    if (ph && typeof ph.noteOn === 'function') return polyEvent(keysId, ph, ev);
    const st = stackOf(keysId);
    if (kind === 'all-off') {
      const n = st.clear();
      if (n) gate(keysId, at, false);
      return { ok: true, held: 0, released: n };
    }
    const h = handleOf(keysId);
    if (!h || typeof h.play !== 'function') {
      return { ok: false, reason: 'The Keys node is not running.' };
    }
    const prio = typeof h.priority === 'function' ? h.priority() : 'last';
    const c = kind === 'on' ? st.press(note, velocity, prio) : st.release(note, prio);
    if (c.empty && !c.unchanged) gate(keysId, at, false);
    else if (c.top && (c.retrigger || c.legato)) {
      h.play(at, c.top.note, c.top.velocity, { legato: !!c.before });
      if (c.retrigger) gate(keysId, at, true);
    }
    return { ok: true, held: st.size, top: c.top ? c.top.note : null, retrigger: !!c.retrigger };
  }

  return {
    event,
    allOff(at) {
      let n = 0;
      for (const id of [...stacks.keys(), ...poly.keys(), ...pads.keys()]) {
        n += event(id, { kind: 'all-off', at, fast: true }).released || 0;
      }
      return n;
    },
    reset() {
      stacks.clear();
      counts.clear();
      poly.clear();
      pads.clear();
    },
    held: () => [...stacks.values()].flatMap((s) => s.notes)
      .concat([...poly.values()].flatMap((s) => [...s]), [...pads.values()]),
  };
}
