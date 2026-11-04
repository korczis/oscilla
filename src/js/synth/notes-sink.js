// The Synth panel's note path (moved out of synth/ui.js, which sits at its source-size cap):
// a note arms the transport and plays the node the keys play, a note-off releases it, all-off
// releases every note source of the panel, and disarm ends the armed run (an armed flag left by
// a stop made elsewhere is cleared, review S1). A note-off releases the node its note-on played
// (review S3), not the node the keys play at release: a route, an engine chip, an undo or a link
// applied while a key is held leaves no voice behind. The note -> node map is performance state
// of this page (what sounds now), never the model's. A note on the panel's Keys whose gate
// reaches no envelope says why (xy.js keysSilence, review S8).
//
//   createSynthNotes(deps) -> { noteOn(note, velocity), noteOff(note), allOff(), disarm(reason) }

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
      say(SYNTH_TEXT.armed);
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
    const quiet = target === nodes().get('keys') && keysSilence(get().handle.getModel(), panel);
    if (quiet) say(quiet.reason); // the pad's cables took the gate (review S8)
    return r;
  }

  function noteOff(note) {
    const t = get().transport;
    const k = present() ? played() : null;
    const id = held.has(note) ? held.get(note) : k && k.id;
    held.delete(note);
    return t && id ? t.live(id, { kind: 'off', note }).ok : false;
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

  return { noteOn, noteOff, allOff, disarm };
}
