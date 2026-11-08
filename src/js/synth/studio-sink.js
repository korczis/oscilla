// The Studio's note sink (M086; the owner's report of 2026-11-03: "the Studio keyboard does not
// work and is not the same component"): the computer keyboard, the on-screen keys and MIDI play
// the Studio document through the same path the Synth panel uses, the Studio transport. The first
// note arms it (transport.arm: the live model, everything connected to a Keys node, no timeline),
// and transport.live drives the node the keys play: the routed note target (metadata.noteTarget,
// K066), else the first node that plays notes. While the transport plays the timeline, the notes
// play the same node live. Nothing is inserted into the document: while it holds nothing that
// plays notes, active() is null and the keys play the Playground voice as before (midi/notes.js
// falls back when route() gives no sink). midi/ui.js routes the Studio workspace to it.
//
//   createStudioSink({ get, setupAudio, ensureAudio, say, registry }) -> { noteOn, noteOff,
//     allOff, leave(), active() -> this sink | null, heldNotes() -> [{ note, node }] }   get()
//     -> { handle, transport }, as the Synth's; heldNotes is a test and debug read of the held
//     map: each note still held, on the node it went to, in the order pressed (K175, S18)

import { forcedOff } from '../audio/gate.js';
import { routedNode } from './picker.js';
import { NODE_REGISTRY, playsNotes } from '../studio/registry.js';

export const STUDIO_SINK_TEXT = Object.freeze({
  none: 'Nothing in this Studio plays notes: add a Keys node or an engine to play from the keys.',
  refused: 'A measurement owns the output: the keys play after it.',
  unarmed: 'The Studio could not start for the keys: press Play or try again.',
});

export function createStudioSink({ get, setupAudio = () => {}, ensureAudio = () => {},
  say = () => {}, registry = NODE_REGISTRY }) {
  const target = (m) => routedNode(m, registry)
    || m.graph.nodes.find((n) => playsNotes(n.type, registry)) || null;
  // The node each held note went to: its off goes there, even if the target changed meanwhile
  // (a re-route, the node removed or another notes node added), so no note hangs.
  const held = new Map();
  const parts = () => {
    setupAudio();
    const { handle, transport } = get();
    return { t: transport, m: handle ? handle.getModel() : null };
  };

  function noteOn(note, velocity) {
    const { t, m } = parts();
    if (!t || !m) return { ok: false, reason: 'no-audio' };
    const n = target(m);
    if (!n) {
      say(STUDIO_SINK_TEXT.none, true);
      return { ok: false, reason: 'no-target' };
    }
    ensureAudio();
    if (!t.playing) {
      const r = t.arm();
      if (!r || !r.ok) {
        const refusedByOwner = r && r.code === 'claim-refused';
        say(refusedByOwner ? STUDIO_SINK_TEXT.refused : (r && r.reason)
          || STUDIO_SINK_TEXT.unarmed, true);
        return { ok: false, reason: refusedByOwner ? 'measurement' : (r && r.code) || 'arm' };
      }
    }
    // The same note pressed again after a re-route (98's R6): release it on the node it went
    // to first, so that node's note never hangs when the map moves on.
    const was = held.get(note);
    if (was && was !== n.id) t.live(was, { kind: 'off', note });
    held.set(note, n.id);
    const r = t.live(n.id, { kind: 'on', note, velocity });
    if (r && r.ok === false && /range$/.test(r.code || '')) say(r.reason, true); // K060
    return r;
  }

  function noteOff(note, info) {
    const { t, m } = parts();
    const id = held.has(note) ? held.get(note) : (t && m && (target(m) || {}).id);
    held.delete(note);
    return t && id ? t.live(id, { kind: 'off', note, forced: forcedOff(info) }).ok : false;
  }

  function allOff() {
    const { t, m } = parts();
    held.clear();
    if (!t || !m || !t.playing) return 0;
    let count = 0;
    for (const n of m.graph.nodes.filter((x) => playsNotes(x.type, registry))) {
      count += t.live(n.id, { kind: 'all-off' }).released || 0;
    }
    return count;
  }

  /** Leaving the Studio (21's R2): every live note off and an armed-only run disarmed, so the
   *  transport no longer owns the output; a run the user started with PLAY is left alone. */
  function leave() {
    const { t } = parts();
    // A PLAYed run keeps the held map (98's R2 on #413): a key still down is released on the node
    // it went to, even after a re-route; only an armed run is ended here (allOff clears it).
    if (!t || !t.armed) return false;
    allOff();
    t.disarm();
    return true;
  }

  /** A test and debug read (synthDebug().sinkHeld, midi.cjs keyboard-studio-held; not a
   *  contract): each note still held, on the node it went to, in the order pressed. Empty after
   *  leaving the Studio (K175, S18). */
  const heldNotes = () => [...held].map(([note, node]) => ({ note, node }));

  const sink = { noteOn, noteOff, allOff, leave, heldNotes };
  sink.active = () => {
    const { handle } = get();
    return handle && target(handle.getModel()) ? sink : null;
  };
  return sink;
}
