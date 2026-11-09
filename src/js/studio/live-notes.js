// Live notes on the Studio transport (plan K103 part, K104): what the Synth panel plays while it
// is armed. Composed by transport.js (arm, disarm, live); pure apart from the handles it is
// given, which are the runtime's own (adapters/instrument.js keys, modulation.js envelope and
// the clocked Random). No audio node is created here.
//
//   liveModel(model) -> model    the armed graph: every node connected to a Keys node (Master
//                                Output included, never crossed), with an empty timeline, so
//                                arming plays the panel and nothing else of the document
//   keysGatedEnvelopes(model) -> Set<envelope id>   reached by an unmuted Keys gate edge, also
//                                through a Step Modulator's relay: the transport closes them at
//                                arm and PLAY (no drone without a key)
//   gateTargets(model, keysId) -> { envelopes, clocks }   one hop (trigger-fanout.js triggerHop)
//   createLiveNotes({ getModel, handleOf, owner }) -> notes   owner(id) -> reason | null: the
//                                transport's one ownership rule (K103: a TRIGGER input the
//                                timeline drives while it plays is not gated live)
//     notes.event(keysId, { kind: 'on' | 'off' | 'all-off', note, velocity, at }) -> result
//       on   the top note changes: the Keys pitch moves (glide only legato), its envelopes get
//            gate(at, null) and its clocked Random and Step Modulator clock(at, k), k counted
//            from arm (0 first); a Step that takes a step relays the gate on its Trigger (K103).
//            A gate left alone on a timeline-owned input: result.owned { code, reason }; on a
//            Keys node a notes clip plays (the timeline playing) the live note is refused
//            whole: { ok: false, code: 'timeline-owned', reason, owned }, pitch and gate
//            untouched (C1-K103-1); a release only lets go of the key
//       off  the stack empties: release(at); the top note changes: legato return, no gate
//       legato  { from, note }: a held note moves to `note` without a gate (K183, the XY pad's
//            finger crossing into another scale cell): `from` leaves the stack and `note` joins
//            it; when the top changes the Keys pitch moves (its glide), no envelope is gated.
//            A `from` not held is a plain on. An engine takes it as off(from) and on(note)
//     notes.allOff(at) -> how many keys were held; notes.reset(); notes.held() -> [note];
//     notes.openGates() -> [id]: the live gates open now
//   A polyphonic engine (nodes/engines.js, capabilities.notes, a handle with noteOn) takes the
//   same events on its own id: on -> noteOn(at, note, velocity), off -> noteOff(at, note),
//   all-off -> allOff(at, fast); its voice pool allocates (adapters/voices.js), no note stack.
//   A note-on that takes no voice (it sounds nothing) is not held: { silent: true }.
//   An XY pad (nodes/instrument.js xy-pad, a handle with move) takes { kind: 'on' | 'move' |
//   'off' | 'all-off', x, y } on its id (plan K097): on and move set X, Y and the scale step
//   (legato while touched); on opens its gate's targets as a Keys gate does, off releases them
//   and, as all-off does, puts Y back at its rest, 0 (handle.rest, K183).

//   A note outside 0-127 is refused on every node that plays notes, and on a Keys node a note
//   on outside its Key low to Key high: { ok: false, code: 'note-range' | 'key-range', reason },
//   never clamped to a neighbour silently (K060).

import { MIN_GATE_S, gateCloseAt } from '../audio/gate.js';
import { createNoteStack } from '../synth/note-stack.js';
import { playsNotes } from './registry.js';
import { reachedEnvelopes, relayOf, triggerHop } from './trigger-fanout.js';
import { svsGateFraction, svsStep } from './step-voltage.js';

/** The router's refusals, as the user reads them. */
export const LIVE_NOTES_TEXT = Object.freeze({
  noteRange: (n) => `Nota ${n} je mimo rozsah not 0 až 127; nehraje se.`,
  keyRange: (n, lo, hi) => `Nota ${n} je mimo rozsah kláves tohoto uzlu Keys ${lo} až ${hi}; `
    + 'nehraje se.',
  // K103: one ownership rule, while the transport plays the timeline.
  timelineOwned: (name) => `Hradlo uzlu ${name} teď řídí přehrávaná časová osa; živá nota ho `
    + 'neotevře.',
  // K226: the step-voltage sequencer's manual step.
  notClocked: 'Krokový sekvencer CV krokuje vlastní rychlostí: ruční krok potřebuje kabel do '
    + 'vstupu Takt (nebo spouštěcí klip).',
  notRunning: 'Krokový sekvencer CV teď nehraje: zapněte Synth (Arm) nebo přehrávání.',
});
/**
 * K226: how long a manual step's Gate and step trigger hold, in seconds (no key-up closes them);
 * a gate-length row scales it (its fraction of MANUAL_STEP_S, at least MIN_GATE_S).
 */
export const MANUAL_STEP_S = 0.2;
const inNoteRange = (n) => Number.isInteger(n) && n >= 0 && n <= 127;


/**
 * Envelope and clock targets of a gate (one hop of its unmuted TRIGGER edges): the one fan-out
 * of trigger-fanout.js (K103), which the transport's scheduled gates use too.
 */
export const gateTargets = (model, keysId) => triggerHop(model, keysId);

/** Envelopes a Keys or XY pad Gate reaches, through Step Modulator relays too (K103). */
export function keysGatedEnvelopes(model) {
  const out = new Set();
  for (const n of model.graph.nodes) {
    if (n.type !== 'keys' && n.type !== 'xy-pad') continue;
    for (const id of reachedEnvelopes(model, n.id)) out.add(id);
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

export function createLiveNotes({ getModel, handleOf, owner = () => null }) {
  const stacks = new Map(); // keys id -> note stack
  const counts = new Map(); // clocked node id -> triggers since arm
  const poly = new Map(); // engine id -> Set of held notes (its pool holds the voices)
  const pads = new Map(); // XY pad id -> the note sounding while it is touched
  // When each gate opened, audio time: an ordinary off closes it no sooner than MIN_GATE_S
  // after (K184: a tap handled in one task still sounds); a forced all-off is never deferred.
  const opened = new Map(); // keys or pad id -> its gate's on; `${id}:${note}` -> a poly note's
  const closeAt = (k, at) => gateCloseAt(opened.get(k), at);

  const stackOf = (id) => {
    if (!stacks.has(id)) stacks.set(id, createNoteStack());
    return stacks.get(id);
  };
  // Relaying ids whose last live tick took a step, with the TRIGGER outputs it relayed on (K103,
  // K226: null for every output, a step-voltage sequencer's ['gate', 'trigN']).
  const relaying = new Map();
  let refusal = null; // the first timeline-owned input an event's gate left alone (K103)
  // One live trigger from `id` along its TRIGGER edges (trigger-fanout.js triggerHop, K103):
  // its Envelopes open (on) or release (off); each clocked node it reaches takes a tick (on
  // only, counted from arm), and a Step Modulator that takes a step relays it on its own
  // Trigger, whose gates close with this one. An input the timeline owns while it plays
  // (owner(id) -> its reason) is left alone, and its reason kept for the event's result.
  const fan = (id, at, on, seen, ports = null) => {
    const m = getModel();
    const { envelopes, clocks, resets } = triggerHop(m, id, ports);
    const free = (x) => {
      const why = owner(x);
      if (why) refusal = refusal || why;
      return !why;
    };
    for (const env of envelopes.filter(free)) {
      const h = handleOf(env);
      if (!h) continue;
      if (on && typeof h.gate === 'function') h.gate(at, null);
      if (!on && typeof h.release === 'function') h.release(at);
    }
    // K226: a reset sends a step-voltage sequencer's count back to 0 (before any tick of this
    // gate, so a gate on both its clock and its reset plays step 1).
    if (on) for (const c of resets) if (free(c)) counts.set(c, 0);
    for (const c of clocks) {
      if (seen.has(c) || !free(c)) continue;
      seen.add(c);
      if (!on) {
        if (relaying.has(c)) {
          const was = relaying.get(c);
          relaying.delete(c);
          fan(c, at, false, seen, was);
        }
        continue;
      }
      tick(c, at, seen);
    }
  };
  /** One live tick on clocked node `c` at `at`; a step it takes relays on its outputs. */
  const tick = (c, at, seen) => {
    const h = handleOf(c);
    if (!h || typeof h.clock !== 'function') return null;
    const k = counts.get(c) || 0;
    h.clock(at, k);
    counts.set(c, k + 1);
    relaying.delete(c);
    const relay = relayOf(getModel().graph.nodes.find((n) => n.id === c), k);
    if (relay) {
      relaying.set(c, relay.ports);
      fan(c, at, true, seen, relay.ports);
    }
    return { k, relay };
  };

  /**
   * K226: a manual step of step-voltage sequencer `id` at `at`: one live tick, its Gate and
   * step trigger held MANUAL_STEP_S (a gate-length row's fraction of it), then released.
   */
  function step(id, at) {
    refusal = null;
    const why = owner(id);
    if (why) return { ok: false, code: 'timeline-owned', reason: why };
    const h = handleOf(id);
    if (!h) return { ok: false, code: 'not-running', reason: LIVE_NOTES_TEXT.notRunning };
    if (typeof h.clock !== 'function') {
      return { ok: false, code: 'not-clocked', reason: LIVE_NOTES_TEXT.notClocked };
    }
    const n = getModel().graph.nodes.find((x) => x.id === id);
    const r = tick(id, at, new Set([id]));
    const frac = n ? svsGateFraction(n.params, svsStep(n.params, r.k)) : null;
    const off = at + Math.max(MIN_GATE_S, MANUAL_STEP_S * (frac === null ? 1 : frac));
    if (relaying.has(id)) {
      const was = relaying.get(id);
      relaying.delete(id);
      fan(id, off, false, new Set([id]), was);
    }
    const res = { ok: true, step: n ? svsStep(n.params, r.k) : null, relayed: !!r.relay };
    return refusal ? { ...res, owned: { code: 'timeline-owned', reason: refusal } } : res;
  }
  const gate = (id, at, on) => {
    if (on) opened.set(id, at); else opened.delete(id);
    const kh = handleOf(id);
    if (kh && typeof kh.gateAt === 'function') kh.gateAt(at, on);
    fan(id, at, on, new Set([id]));
  };

  function polyEvent(id, h, ev) {
    const { kind, note, velocity = 100, at, fast = false, forced = false } = ev;
    if (!poly.has(id)) poly.set(id, new Set());
    const held = poly.get(id);
    if (kind === 'all-off') {
      const n = held.size;
      h.allOff(at, fast);
      held.clear();
      return { ok: true, held: 0, released: n };
    }
    if (kind === 'on') {
      opened.set(`${id}:${note}`, at);
      const r = h.noteOn(at, note, velocity);
      // A note that sounds nothing takes no voice (adapters/voices.js: slot null, every
      // operator above the limit, a ring with no modulator): it is not held either (review of
      // #332, V5), so the held list names only notes that sound.
      const silent = !!r && r.slot == null;
      if (!silent) held.add(note);
      return { ok: true, held: held.size, top: silent ? null : note, silent,
        stolen: !!(r && r.stolen), dropped: r ? r.dropped : 0 };
    }
    if (kind === 'legato') {
      polyEvent(id, h, { kind: 'off', note: ev.from, at });
      return polyEvent(id, h, { kind: 'on', note, velocity, at });
    }
    held.delete(note);
    h.noteOff(forced ? at : closeAt(`${id}:${note}`, at), note);
    opened.delete(`${id}:${note}`);
    return { ok: true, held: held.size, top: null };
  }

  function padEvent(id, h, { kind, x, y, at, forced = false }) {
    const down = pads.has(id);
    if (kind === 'off' || kind === 'all-off') {
      pads.delete(id);
      // An ordinary off closes no sooner than the minimum gate (K184); a forced one at once.
      const off = kind === 'off' && !forced ? closeAt(id, at) : at;
      // Every release, forced ones too, puts Y back at rest: nothing of the last touch stays on
      // its cable (K183 review N2; a Hold that keeps it is Q099's, not this).
      if (h && typeof h.rest === 'function') h.rest(off);
      if (down) gate(id, off, false);
      return { ok: true, held: 0, released: down ? 1 : 0 };
    }
    const r = h.move(at, x, y, { legato: down });
    if (kind === 'on' || down) pads.set(id, r.note);
    if (kind === 'on' && !down) gate(id, at, true);
    return { ok: true, held: pads.has(id) ? 1 : 0, top: r.note, ...r };
  }

  /**
   * A live event (see the header); a gate it left alone on a timeline-owned input (K103) is
   * named on the result: owned { code: 'timeline-owned', reason }.
   */
  function event(keysId, ev) {
    refusal = null;
    const r = play(keysId, ev);
    return refusal && r && r.ok !== false
      ? { ...r, owned: { code: 'timeline-owned', reason: refusal } } : r;
  }

  function play(keysId, ev) {
    const { kind, note, velocity = 100, at } = ev;
    const ph = handleOf(keysId);
    if ((ph && typeof ph.move === 'function') || (pads.has(keysId) && /off/.test(kind))) {
      return padEvent(keysId, ph, ev);
    }
    if ((kind === 'on' || kind === 'off') && !inNoteRange(note)) {
      return { ok: false, code: 'note-range', reason: LIVE_NOTES_TEXT.noteRange(note) };
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
    const [lo, hi] = typeof h.keyRange === 'function' ? h.keyRange() : [0, 127];
    // A legato slide (K183) lands on its target note as a note-on does: outside the range it
    // is refused the same way, and the held note it slid from keeps sounding (K060).
    if ((kind === 'on' || kind === 'legato') && (note < lo || note > hi)) {
      return { ok: false, code: 'key-range', reason: LIVE_NOTES_TEXT.keyRange(note, lo, hi) };
    }
    const prio = typeof h.priority === 'function' ? h.priority() : 'last';
    // A Keys node a notes clip plays is the timeline's while it plays (K103, C1-K103-1): a live
    // note on it is refused whole (its pitch, its gate), with the owner's sentence; a release
    // only lets go of a key held from before, and moves nothing.
    const why = owner(keysId);
    if (why) {
      if (kind === 'off') st.release(note, prio);
      if (kind === 'off' || kind === 'all-off') {
        if (kind === 'all-off') st.clear();
        // the live gate a key held from before opened is let go of here too (C1-K103-2); the
        // Keys gate itself is the clip's now, so nothing is scheduled on it
        if (!st.size) opened.delete(keysId);
        return { ok: true, held: st.size, top: null, retrigger: false,
          owned: { code: 'timeline-owned', reason: why } };
      }
      return { ok: false, code: 'timeline-owned', reason: why,
        owned: { code: 'timeline-owned', reason: why } };
    }
    if (kind === 'legato') {
      const before = st.top(prio);
      if (!before || !st.notes.includes(ev.from)) return event(keysId, { ...ev, kind: 'on' });
      st.release(ev.from, prio);
      const t = st.press(note, velocity, prio).top;
      if (t.note !== before.note) h.play(at, t.note, t.velocity, { legato: true });
      return { ok: true, held: st.size, top: t.note, retrigger: false };
    }
    const c = kind === 'on' ? st.press(note, velocity, prio) : st.release(note, prio);
    if (c.empty && !c.unchanged) gate(keysId, ev.forced ? at : closeAt(keysId, at), false);
    else if (c.top && (c.retrigger || c.legato)) {
      h.play(at, c.top.note, c.top.velocity, { legato: !!c.before, onset: !!c.retrigger });
      if (c.retrigger) gate(keysId, at, true);
    }
    return { ok: true, held: st.size, top: c.top ? c.top.note : null, retrigger: !!c.retrigger };
  }

  return {
    event,
    step,
    allOff(at) {
      let n = 0;
      for (const id of [...stacks.keys(), ...poly.keys(), ...pads.keys()]) {
        n += event(id, { kind: 'all-off', at, fast: true }).released || 0;
      }
      return n;
    },
    reset() {
      opened.clear();
      relaying.clear();
      stacks.clear();
      counts.clear();
      poly.clear();
      pads.clear();
    },
    held: () => [...stacks.values()].flatMap((s) => s.notes)
      .concat([...poly.values()].flatMap((s) => [...s]), [...pads.values()]),
    /** The ids (and poly `${id}:${note}` keys) whose live gate is open now. */
    openGates: () => [...opened.keys()],
  };
}
