// The Synth panel's note path (moved out of synth/ui.js, which sits at its source-size cap):
// a note arms the transport and plays the node the keys play, a note-off releases it, all-off
// releases every note source of the panel, and disarm ends the armed run (an armed flag left by
// a stop made elsewhere is cleared, review S1). Move-only: the bodies are synth/ui.js's.
//
//   createSynthNotes(deps) -> { noteOn(note, velocity), noteOff(note), allOff(), disarm(reason) }

import { SYNTH_TEXT } from './insert.js';
import { droppedText } from './view/engines.js';

export function createSynthNotes({ get, transport, ensurePanel, cmp, say, played, playedModule,
  present, nodes, panel, ENGINE_IDS, syncArmed }) {

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
    const r = t.live(target.id, { kind: 'on', note, velocity });
    if (r && r.dropped) say(droppedText(target, r.dropped));
    return r;
  }

  function noteOff(note) {
    const t = get().transport;
    const k = present() ? played() : null;
    return t && k ? t.live(k.id, { kind: 'off', note }).ok : false;
  }

  /** Every note of every note source of the panel off (Escape, a tab change, MIDI all-off). */
  function allOff() {
    const t = get().transport;
    if (!t || !present() || !t.playing) return 0;
    let n = 0;
    const all = ['keys', ...ENGINE_IDS, 'xy'].map((id) => nodes().get(id));
    for (const x of new Set([...all, played()])) {
      if (x) n += t.live(x.id, { kind: 'all-off' }).released || 0;
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
