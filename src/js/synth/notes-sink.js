// The Synth panel's note path (moved out of synth/ui.js, which sits at its source-size cap):
// a note arms the transport and plays the node the keys play, a note-off releases it, all-off
// releases every note source of the panel, and disarm ends the armed run (an armed flag left by
// a stop made elsewhere is cleared, review S1). A note-off releases the node its note-on played
// (review S3), not the node the keys play at release: a route, an engine chip, an undo or a link
// applied while a key is held leaves no voice behind. The note -> node map is performance state
// of this page (what sounds now), never the model's. A note on the panel's Keys whose gate
// reaches no envelope says why (xy.js keysSilence, review S8).
// K183: legato moves a held note to another without a new gate (the XY pad's finger crossing a
// scale cell, midi/notes.js legato; the note stays on the node its note-on played), and
// armedText() says what the keys and the pad play, named from the node the route plays (the
// panel's Keys: the panel's title; an engine or a routed node: its name), never a fixed sentence.
//
//   createSynthNotes(deps) -> { noteOn(note, velocity), noteOff(note), legato(note, { from,
//     velocity }), allOff(), disarm(reason), armedText() }

import { forcedOff } from '../audio/gate.js';
import { SYNTH_TEXT } from './insert.js';
import { droppedText } from './view/engines.js';
import { keysSilence } from './xy.js';

export function createSynthNotes({ get, transport, ensurePanel, cmp, say, played, playedModule,
  present, nodes, panel, ENGINE_IDS, syncArmed }) {
  const held = new Map(); // note -> the id of the node its note-on played


  function noteOn(note, velocity) {
    const t = transport();
    if (!t || !ensurePanel()) return { ok: false, reason: 'no-audio' };
    if (cmp() && typeof cmp().ensureAudio === 'function') cmp().ensureAudio();
    if (!t.playing) {
      const r = t.arm();
      if (!r.ok) {
        say(r.code === 'claim-refused' ? SYNTH_TEXT.refused : r.reason, true);
        return { ok: false, reason: 'measurement' };
      }
      say(armedText());
      if (cmp()) cmp().synth.armed = !!t.armed;
    }
    const target = played();
    if (!target) {
      say(`${panel.module(playedModule()).label} was removed in Studio: Restore module first.`,
        true);
      return { ok: false, reason: 'removed' };
    }
    const was = held.get(note);
    if (was && was !== target.id) t.live(was, { kind: 'off', note });
    held.set(note, target.id);
    const r = t.live(target.id, { kind: 'on', note, velocity });
    if (r && r.dropped) say(droppedText(target, r.dropped));
    if (r && r.ok === false && /range$/.test(r.code || '')) say(r.reason, true); // K060
    if (r && r.owned) say(r.owned.reason); // K103: the timeline owns that gate while it plays
    const quiet = target === nodes().get('keys') && keysSilence(get().handle.getModel(), panel);
    if (quiet) say(quiet.reason); // the pad's cables took the gate (review S8)
    return r;
  }

  /** What the keys and the pad play now: the played node, by name. */
  function armedText() {
    const n = played();
    if (!n) return SYNTH_TEXT.armed;
    return SYNTH_TEXT.plays(n === nodes().get('keys') ? panel.title
      : n.metadata && n.metadata.name ? n.metadata.name : n.type);
  }

  /** A held note moved to `note` with no new gate (live-notes.js 'legato'). */
  function legato(note, { from, velocity = 100 } = {}) {
    const t = get().transport;
    const k = present() ? played() : null;
    if (!t || !k || !t.playing) return noteOn(note, velocity);
    const id = held.has(from) ? held.get(from) : k.id; // the node `from` sounds on (review S3)
    held.delete(from);
    held.set(note, id);
    return t.live(id, { kind: 'legato', from, note, velocity });
  }

  function noteOff(note, info) {
    const t = get().transport;
    const k = present() ? played() : null;
    const id = held.has(note) ? held.get(note) : k && k.id;
    held.delete(note);
    return t && id ? t.live(id, { kind: 'off', note, forced: forcedOff(info) }).ok : false;
  }

  /** Every note of every note source of the panel off (Escape, a tab change, MIDI all-off). */
  function allOff() {
    const t = get().transport;
    const ids = [...held.values()];
    held.clear();
    if (!t || !t.playing) return 0;
    let n = 0;
    const all = present() ? ['keys', ...ENGINE_IDS, 'xy'].map((id) => nodes().get(id)) : [];
    const on = present() ? played() : null;
    for (const id of new Set([...all, on].filter(Boolean).map((x) => x.id).concat(ids))) {
      n += t.live(id, { kind: 'all-off' }).released || 0;
    }
    return n;
  }

  function disarm(reason) {
    const t = get().transport;
    if (!t || !t.armed) {
      syncArmed(); // a copy left armed by a stop made elsewhere is cleared, never kept
      return Promise.resolve(null);
    }
    const p = t.disarm();
    if (cmp()) cmp().synth.armed = false;
    if (reason) say(SYNTH_TEXT.disarmed);
    return p;
  }

  return { noteOn, noteOff, legato, allOff, disarm, armedText };
}
