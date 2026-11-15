// The MIDI part of the one OSCILLA Alpine component (plan issues V501, V502, K026; ADR 0058,
// ADR 0062): the support state of src/js/midi/support.js as the status line and the Connect
// MIDI control of the Settings dialog, the notes of the connected inputs sounding through the
// AudioEngine (src/js/midi/notes.js), their Control Changes moving the Synth panel's knobs
// (V506, src/js/synth/midi-cc.js), and the computer and on-screen keyboard
// (src/js/midi/keyboard-ui.js), which plays the same note voices and lights the MIDI notes too.
// Composed by main.js; it touches nothing outside the MIDI surface but the engine's note voices
// (and, for the keyboard, the link key `kbd` and the analysis views' live flag).
//
// Each input is recognised by its port name (V507, src/js/midi/devices.js): a known device's
// DAW-control and editor ports never play notes (their Note On messages are buttons), and every
// message of every input is shown in the MIDI monitor (src/js/midi/monitor.js) with the physical
// control that sent it, which the Synth's CC status line names too.
//
// The controllers and the platform objects stay out of reactive state; the component holds only
// the plain values the markup reads (midiState, midiText, midiCanConnect, midiInputs, midiLog).

import { routeOf } from './routes.js';
import { createMidiSupport, midiSite } from './support.js';
import { createMidiNotes } from './notes.js';
import { recognise, controlOf } from './devices.js';
import { decodeMidi } from './message.js';
import { createMidiMonitor, describeMidi } from './monitor.js';
import { createKeyboardUi } from './keyboard-ui.js';
import { OWNER, notesRefusalOf, notesRefusedSentences } from '../core/output-bus.js';

/** What a refused MIDI note says, per owner: the one output-owner table's (C036). */
export const MIDI_REFUSED = notesRefusedSentences('midi');

/** The least time between two status lines of the same CC control (V506). */
export const CC_STATUS_MS = 400;

/** What a port is for, as the MIDI section says it (V507). */
export const ROLE_TEXT = Object.freeze({ play: 'hraní', daw: 'ovládání DAW',
  editor: 'editor výrobce' });

/** One row of the MIDI section's device list: an input's name and what OSCILLA knows of it. */
export function inputRow(name) {
  const w = recognise(name);
  return { name, device: w.device ? w.device.name : '', role: w.role,
    roleText: ROLE_TEXT[w.role], known: !!w.device,
    controls: w.device ? w.device.controls.length : 0 };
}

/**
 * `engine`: the AudioEngine the notes sound through. `sequencerPlaying()`: whether the
 * sequencer is playing now (main.js reads the editor itself, not the 150 ms `seqPlaying` copy);
 * the sequencer plays into the engine's master outside its voices, so notes and a sequence are
 * kept apart here: a note is refused while it plays, and main.js stops the notes when it starts.
 */
export function createMidiUi({ win = window, engine = null, sequencerPlaying = () => false,
  bus = null } = {}) {
  let ccSaid = { cid: null, at: 0, timer: 0 }; // the Synth's status line's last CC (V506)
  let support = null;
  let notes = null;
  let monitor = null;
  const part = {
    midiState: null,
    midiText: '',
    midiCanConnect: false,
    midiInputs: [],   // inputRow per connected input (V507)
    midiLog: [],      // the monitor's rows, newest first (V507)

    /** Called once by the component's init: the load-time read, never a request. */
    midiInit() {
      const cmp = this;
      // One note layer per player (MIDI, the keyboard): the same settings and owners, each
      // saying a refusal in its own words.
      const notesFor = (refused) => createMidiNotes({
        engine,
        // The Playground's tuning, waveform, envelope times and safety limit, read per note.
        settings: () => ({ a4: cmp.a4, waveform: cmp.waveform, attackS: cmp.attack / 1000,
          releaseS: cmp.release / 1000, limitS: cmp.safetyLimit,
          continuous: cmp.continuousAllowed }),
        // Who refuses a note now: the rows of the one output-owner table that refuse notes
        // (C036): the measurement, a microphone level-reference capture (the loopback's
        // reference is the output itself, as for every other claim), the Studio, the sequencer.
        ownedBy: () => notesRefusalOf(cmp, { sequencerPlaying }),
        // The playback bus (C037, main.js): each note that starts on the Playground's voices
        // claims the output as the notes, and the last released note gives it back.
        claim: bus ? (reason) => bus.claim(OWNER.notes, reason) : null,
        release: bus ? () => bus.release(OWNER.notes) : () => {},
        noted: bus ? (on, note, source) => bus.note(on, { note, input: String(source) })
          : () => {},
        refused,
        // What the workspace's keys play: its row of the one table (midi/routes.js, K178).
        route: () => {
          const sink = routeOf(cmp.workspace).plays;
          return sink && typeof cmp[sink] === 'function' ? cmp[sink]() : null;
        },
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
      const who = new WeakMap(); // input -> recognise(its name) (V507)
      monitor = createMidiMonitor({ publish: (rows) => { cmp.midiLog = rows; } });
      let inputs = 0;
      support = createMidiSupport({
        navigator: win.navigator,
        isSecureContext: !!win.isSecureContext,
        site: midiSite(win.location),
        onChange(s) {
          cmp.midiState = s.state;
          cmp.midiText = s.text;
          cmp.midiCanConnect = s.canConnect;
          cmp.midiInputs = (s.inputs || []).map(inputRow);
        },
        onMessage(data, port) {
          if (!ids.has(port)) { inputs += 1; ids.set(port, inputs); }
          if (!who.has(port)) who.set(port, recognise(port && port.name));
          const w = who.get(port);
          const m = decodeMidi(data);
          const control = controlOf(w.device, m);
          if (m.kind !== 'clock' && m.kind !== 'active-sensing') {
            monitor.add({ input: w.member || (port && port.name) || '', role: w.role,
              kind: m.kind, text: describeMidi(m, control) });
          }
          // A DAW-control or editor port's notes are buttons, never notes to sound (V507).
          if (w.role !== 'play') return;
          const e = notes.handle(data, ids.get(port));
          if (e.kind === 'control-change') { cmp.midiControl(e, control); return; }
          // The on-screen keys light the note while it sounds (K026).
          if (typeof cmp.kbdLight !== 'function') return;
          if (e.kind === 'note-on' && e.result && e.result.ok) cmp.kbdLight(e.note, true);
          else if (e.kind === 'note-off') cmp.kbdLight(e.note, false);
          else if (e.kind === 'all-sound-off' || e.kind === 'all-notes-off') cmp.kbdUnlightMidi();
        },
        onSilence: silence,
      });
      // Nothing keeps sounding where its Note Off may never come (ADR 0062): the window loses
      // the focus here; a page hide and Escape are the playback bus's stopAll (C050), which
      // releases every note through midiAllOff.
      if (typeof win.addEventListener === 'function') win.addEventListener('blur', silence);
      return support.init();
    },

    /**
     * Leaving workspace `old` runs its key route's leave on its sink (KEY_ROUTES: the Studio
     * releases its keys and disarms an armed-only run, studio-sink.js, K176). Called by the
     * playback bus's leave policy (C053, LEAVE_POLICY 'studio'), never by a watcher of its own.
     */
    midiRouteLeave(old) {
      const { plays, leave } = routeOf(old);
      const s = leave && typeof this[plays] === 'function' && this[plays]();
      if (s && typeof s[leave] === 'function') s[leave]();
    },

    /**
     * A Control Change from an input (V506): while the Synth is shown, the panel's knob of its
     * slot moves (synth/midi-cc.js) and the Synth's status line says what changed, without an
     * announcement per message; elsewhere no surface reads a CC and it changes nothing.
     */
    midiControl(e, control = null) {
      if (this.workspace !== 'synth' || typeof this.synthCc !== 'function') return null;
      const r = this.synthCc(e.controller, e.value);
      // The status line is a polite live region: a new control, or a turn's value at most every
      // CC_STATUS_MS, so a fader's stream of messages is not read out message by message.
      // The last value of a run is never lost (C3-548-2): a value held back is written once
      // CC_STATUS_MS has passed since the line last changed.
      if (!r || !this.synth) return r;
      const now = Date.now();
      clearTimeout(ccSaid.timer);
      const text = control ? `${control.label} · ${r.text}` : r.text;
      if (r.cid !== ccSaid.cid || now - ccSaid.at >= CC_STATUS_MS) {
        this.synth.status = text;
        ccSaid = { cid: r.cid, at: now, timer: 0 };
      } else {
        const synth = this.synth;
        ccSaid.timer = setTimeout(() => {
          synth.status = text;
          ccSaid = { cid: r.cid, at: Date.now(), timer: 0 };
        }, CC_STATUS_MS - (now - ccSaid.at));
      }
      return r;
    },

    /** Empty the MIDI monitor (V507). */
    midiLogClear() {
      if (monitor) monitor.clear();
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
    Object.getOwnPropertyDescriptors(createKeyboardUi({ win, bus })));
}
