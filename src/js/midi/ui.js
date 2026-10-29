// The MIDI part of the one OSCILLA Alpine component (plan issues V501, V502; ADR 0058): the
// support state of src/js/midi/support.js as the status line and the Connect MIDI control of
// the Settings dialog, and the notes of the connected inputs sounding through the AudioEngine
// (src/js/midi/notes.js). Composed by main.js; it touches nothing outside the MIDI surface but
// the engine's note voices.
//
// The controllers and the platform objects stay out of reactive state; the component holds only
// the plain values the markup reads (midiState, midiText, midiCanConnect).

import { createMidiSupport, midiSite } from './support.js';
import { createMidiNotes } from './notes.js';

export const MIDI_REFUSED = Object.freeze({
  measurement: 'MIDI notes do not play while the measurement owns the output: stop it (Esc) '
    + 'first.',
  reference: 'MIDI notes do not play while the level reference is being captured.',
  studio: 'MIDI notes do not play while the Studio is playing: stop it first.',
  sequencer: 'MIDI notes do not play while the sequencer is playing: stop it (Esc) first.',
});

/**
 * `engine`: the AudioEngine the notes sound through. `sequencerPlaying()`: whether the
 * sequencer is playing now (main.js reads the editor itself, not the 150 ms `seqPlaying` copy);
 * the sequencer plays into the engine's master outside its voices, so notes and a sequence are
 * kept apart here: a note is refused while it plays, and main.js stops the notes when it starts.
 */
export function createMidiUi({ win = window, engine = null, sequencerPlaying = () => false }
  = {}) {
  let support = null;
  let notes = null;
  return {
    midiState: null,
    midiText: '',
    midiCanConnect: false,

    /** Called once by the component's init: the load-time read, never a request. */
    midiInit() {
      const cmp = this;
      const owns = (fn) => typeof cmp[fn] === 'function' && cmp[fn]();
      notes = createMidiNotes({
        engine,
        // The Playground's tuning, waveform, envelope times and safety limit, read per note.
        settings: () => ({ a4: cmp.a4, waveform: cmp.waveform, attackS: cmp.attack / 1000,
          releaseS: cmp.release / 1000, limitS: cmp.safetyLimit,
          continuous: cmp.continuousAllowed }),
        ownedBy: () => {
          if (owns('measureOwnsOutput')) return 'measurement';
          const form = cmp.meas && cmp.meas.levelForm;
          if (form && form.capturing) return 'reference';
          if (owns('studioOwnsOutput')) return 'studio';
          return sequencerPlaying() ? 'sequencer' : null;
        },
        refused: (by) => {
          if (typeof cmp.notify === 'function') cmp.notify('info', 'MIDI', MIDI_REFUSED[by]);
        },
      });
      const ids = new WeakMap(); // input -> a number for the note keys, never shown or stored
      let inputs = 0;
      support = createMidiSupport({
        navigator: win.navigator,
        isSecureContext: !!win.isSecureContext,
        site: midiSite(win.location),
        onChange(s) {
          cmp.midiState = s.state;
          cmp.midiText = s.text;
          cmp.midiCanConnect = s.canConnect;
        },
        onMessage(data, port) {
          if (!ids.has(port)) { inputs += 1; ids.set(port, inputs); }
          notes.handle(data, ids.get(port));
        },
        onSilence: () => notes.silence(),
      });
      // Nothing keeps sounding where its Note Off may never come: page hidden, Escape.
      const doc = win.document;
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => { if (doc.hidden) notes.silence(); });
      }
      if (typeof win.addEventListener === 'function') {
        win.addEventListener('pagehide', () => notes.silence());
        win.addEventListener('keydown', (e) => { if (e.key === 'Escape') notes.silence(); });
      }
      return support.init();
    },

    /** Connect MIDI (the explicit user action): asks the browser for access. */
    midiConnect() {
      if (support) support.connect();
    },

    /**
     * Every MIDI note off: Measure or Studio PLAY takes the output (main.js stopPlayback), or
     * the sequencer starts (main.js, around the editor's play).
     */
    midiAllOff() {
      return notes ? notes.silence() : 0;
    },
  };
}
