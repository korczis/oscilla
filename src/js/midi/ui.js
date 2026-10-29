// The MIDI part of the one OSCILLA Alpine component (plan issues V501, V502, K026; ADR 0058,
// ADR 0062): the support state of src/js/midi/support.js as the status line and the Connect
// MIDI control of the Settings dialog, the notes of the connected inputs sounding through the
// AudioEngine (src/js/midi/notes.js), and the computer and on-screen keyboard
// (src/js/midi/keyboard-ui.js), which plays the same note voices and lights the MIDI notes too.
// Composed by main.js; it touches nothing outside the MIDI surface but the engine's note voices
// (and, for the keyboard, the link key `kbd` and the analysis views' live flag).
//
// The controllers and the platform objects stay out of reactive state; the component holds only
// the plain values the markup reads (midiState, midiText, midiCanConnect).

import { createMidiSupport, midiSite } from './support.js';
import { createMidiNotes } from './notes.js';
import { createKeyboardUi } from './keyboard-ui.js';

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
  const part = {
    midiState: null,
    midiText: '',
    midiCanConnect: false,

    /** Called once by the component's init: the load-time read, never a request. */
    midiInit() {
      const cmp = this;
      const owns = (fn) => typeof cmp[fn] === 'function' && cmp[fn]();
      // One note layer per player (MIDI, the keyboard): the same settings and owners, each
      // saying a refusal in its own words.
      const notesFor = (refused) => createMidiNotes({
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
        refused,
      });
      notes = notesFor((by) => {
        if (typeof cmp.notify === 'function') cmp.notify('info', 'MIDI', MIDI_REFUSED[by]);
      });
      // Every note off, and nothing lit: the forced stops of ADR 0062 and V502.
      const silence = () => {
        const n = notes.silence();
        if (typeof cmp.kbdUnlightMidi === 'function') cmp.kbdUnlightMidi();
        if (typeof cmp.kbdReleaseAll === 'function') cmp.kbdReleaseAll();
        return n;
      };
      if (typeof cmp.kbdInit === 'function') cmp.kbdInit({ notesFor });
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
          const e = notes.handle(data, ids.get(port));
          // The on-screen keys light the note while it sounds (K026).
          if (typeof cmp.kbdLight !== 'function') return;
          if (e.kind === 'note-on' && e.result && e.result.ok) cmp.kbdLight(e.note, true);
          else if (e.kind === 'note-off') cmp.kbdLight(e.note, false);
          else if (e.kind === 'all-sound-off' || e.kind === 'all-notes-off') cmp.kbdUnlightMidi();
        },
        onSilence: silence,
      });
      // Nothing keeps sounding where its Note Off may never come (ADR 0062): the window loses
      // the focus, the page is hidden, Escape.
      const doc = win.document;
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => { if (doc.hidden) silence(); });
      }
      if (typeof win.addEventListener === 'function') {
        win.addEventListener('blur', silence);
        win.addEventListener('pagehide', silence);
        win.addEventListener('keydown', (e) => { if (e.key === 'Escape') silence(); });
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
      if (!notes) return 0;
      const n = notes.silence();
      if (typeof this.kbdUnlightMidi === 'function') this.kbdUnlightMidi();
      if (typeof this.kbdReleaseAll === 'function') this.kbdReleaseAll();
      return n;
    },
  };
  // The keyboard (K026) is part of the same component part: its getters stay getters.
  return Object.defineProperties(part,
    Object.getOwnPropertyDescriptors(createKeyboardUi({ win })));
}
