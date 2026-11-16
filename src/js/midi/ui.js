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
import { recognise, controlOf, DEVICES } from './devices.js';
import { createDeviceMaps } from './device-map-ui.js';
import { decodeMidi } from './message.js';
import { createMidiMonitor, describeMidi } from './monitor.js';
import { createClockMeter, transportAction, transportTarget, CLOCK_GAP_MS } from './transport.js';
import { createKeyboardUi } from './keyboard-ui.js';
import { createResponseMode } from './response-mode.js';
import { createClockOutMode, steadyStamp } from './clock-out-mode.js';
import { ANSWER_SOURCE } from './response.js';
import { clockOffsetS, transportClockOf } from '../audio/clock.js';
import { NOTE_POLYPHONY } from '../audio/audio-engine.js';
import { OWNER, notesRefusalOf, notesRefusedSentences } from '../core/output-bus.js';

/** What a refused MIDI note says, per owner: the one output-owner table's (C036). */
export const MIDI_REFUSED = notesRefusedSentences('midi');

/**
 * Why an answer of call and response does not sound (V503), said once per phrase in the MIDI
 * section: an owner of the output (the one table's sentence for MIDI), or no instrument to plan
 * it on (the keys play the page's own voice, which starts now or never).
 */
export const RESPONSE_TEXT = Object.freeze({
  title: 'Otázka a odpověď',
  refused: (why) => `Odpověď nezazní: ${why}`,
  noInstrument: 'klávesy teď hrají jen vlastní hlas stránky, který odpověď naplánovat neumí. '
    + 'Otevřete Synth, nebo přidejte do Studia uzel Keys.',
});

/** The least time between two status lines of the same CC control (V506). */
export const CC_STATUS_MS = 400;

/**
 * The one instrument the keys play now (K247): the sink the workspace's row names (the Studio
 * part's keysInstrument, or the Synth panel in the Synth), or null where the page has none and
 * the engine's own voice plays (midi/notes.js).
 */
export function centralSink(cmp, source) {
  // An answer of call and response never brings the Synth panel in (oscilla-c3 on V503, item
  // 8 (i)): a Zpět in the phrase's gap is the user removing it, and the answer may not undo that.
  if (source === ANSWER_SOURCE && typeof cmp.keysPanelMissing === 'function'
    && cmp.keysPanelMissing()) return null;
  const own = routeOf(cmp.workspace).plays;
  return own && typeof cmp[own] === 'function' ? cmp[own]() || null : null;
}

/** The least time between two shown readings of the clock's tempo (V508). */
export const CLOCK_SHOW_MS = 500;
/** What a transport action did, as the monitor says it (V508). */
export const ACTION_TEXT = Object.freeze({ start: 'přehrát od začátku', continue: 'pokračovat',
  stop: 'zastavit', rewind: 'na začátek', loop: 'smyčka' });
/** Whose transport a message moved, by name: the Sequencer's own, else the Studio's. */
/** The MIDI section's clock-out sentences (V510). */
export const CLOCK_OUT_TEXT = Object.freeze({
  title: 'Hodiny MIDI',
  sendFailed: 'Výstup MIDI přestal přijímat zprávy; hodiny a transport se na něj už neposílají.',
});

const transportName = (target) => (target === transportTarget('sequencer') ? 'Sekvencer'
  : 'Studio');
const perf = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** What a port is for, as the MIDI section says it (V507). */
export const ROLE_TEXT = Object.freeze({ play: 'hraní', daw: 'ovládání DAW',
  editor: 'editor výrobce' });

/** One row of the MIDI section's device list: an input's name and what OSCILLA knows of it. */
export function inputRow(name) {
  const w = recognise(name);
  return { name, deviceId: w.device ? w.device.id : null,
    device: w.device ? w.device.name : '', role: w.role,
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
  bus = null, sequencerTransport = null, now = perf } = {}) {
  let ccSaid = { cid: null, at: 0, timer: 0 }; // the Synth's status line's last CC (V506)
  let support = null;
  let notes = null;
  let monitor = null;
  let arming = 0; // > 0 while a note of the keys or MIDI is being taken by the instrument (K247)
  let response = null; // call and response (V503), on the one instrument
  let clockOut = null; // clock and transport out (V510), on a chosen output
  let outPorts = new Map(); // output id -> MIDIOutput of the open access (V510)
  const maps = createDeviceMaps({ devices: DEVICES.devices }); // V509
  const part = {
    midiState: null,
    midiText: '',
    midiCanConnect: false,
    midiInputs: [],   // inputRow per connected input (V507)
    midiOutputs: [],  // { id, name } per connected output (V510); the ports stay outside
    midiClockOut: '', // the output that follows the transport (V510), '' none; never stored
    midiLog: [],      // the monitor's rows, newest first (V507)
    midiClockBpm: null, // the tempo of an incoming MIDI clock, or null (V508)
    midiResponse: false, // call and response is on (V503); off on every load, never stored
    midiLit: null,     // the device map's control that sent the latest message (V509)
    midiMapBank: {},   // the bank each device's map shows, by device id (V509)

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
        noted: (on, note, source) => {
          // Any other player's note cuts an answer, the computer and on-screen keys and the pad
          // too (oscilla-c3 on V503, item 8 (iii)): they share the one instrument.
          if (on && response && source !== ANSWER_SOURCE) response.interrupt();
          if (bus) bus.note(on, { note, input: String(source) });
        },
        refused,
        starting: (on) => { arming += on ? 1 : -1; },
        // What the keys play: the one instrument (K247), named by the workspace's row of the one
        // table (midi/routes.js, K178).
        route: (source) => centralSink(cmp, source),
      });
      notes = notesFor((by, source) => {
        if (source === ANSWER_SOURCE) return; // the answer says its own refusal (V503)
        if (typeof cmp.notify === 'function') cmp.notify('info', 'MIDI', MIDI_REFUSED[by]);
      });
      // Call and response (V503): it hears the play port's notes, wakes on the engine's one
      // transport clock and plays its answer through the same note layer (A2, A5).
      if (engine) {
        response = createResponseMode({ notes, clock: transportClockOf(engine),
          offsetS: () => (engine.ctx ? clockOffsetS(engine.ctx, now()) : null),
          ctxNow: () => (engine.ctx ? engine.ctx.currentTime : 0), perfNow: now,
          safeMax: () => engine.safeMaximum, a4: () => (cmp.a4 > 0 ? cmp.a4 : 440),
          polyphony: NOTE_POLYPHONY,
          say: (reason) => {
            if (typeof cmp.notify !== 'function') return;
            cmp.notify('info', RESPONSE_TEXT.title, RESPONSE_TEXT.refused(reason === 'no-instrument'
              ? RESPONSE_TEXT.noInstrument : MIDI_REFUSED[reason] || reason));
          } });
      }
      // Clock and transport out (V510): the chosen output follows the transport in view, the
      // Sequencer's own there and the Studio's elsewhere, from its anchor on the audio clock.
      if (engine) {
        clockOut = createClockOutMode({ clock: transportClockOf(engine),
          ctxNow: () => (engine.ctx ? engine.ctx.currentTime : 0),
          stamp: steadyStamp(() => (engine.ctx ? clockOffsetS(engine.ctx, now()) : null)),
          anchor: () => {
            if (transportTarget(cmp.workspace) === 'sequencer') {
              return sequencerTransport && typeof sequencerTransport.anchor === 'function'
                ? sequencerTransport.anchor() : null;
            }
            return typeof cmp.studioClockAnchor === 'function' ? cmp.studioClockAnchor() : null;
          },
          say: () => {
            cmp.midiClockOut = '';
            if (typeof cmp.notify === 'function') {
              cmp.notify('warning', CLOCK_OUT_TEXT.title, CLOCK_OUT_TEXT.sendFailed);
            }
          } });
      }
      // Every note off, and nothing lit: the forced stops of ADR 0062 and V502.
      const silence = () => {
        if (response) response.cut();
        const n = notes.silence();
        if (typeof cmp.kbdUnlightMidi === 'function') cmp.kbdUnlightMidi();
        if (typeof cmp.kbdReleaseAll === 'function') cmp.kbdReleaseAll();
        return n;
      };
      if (typeof cmp.kbdInit === 'function') cmp.kbdInit({ notesFor });
      const ids = new WeakMap(); // input -> a number for the note keys, never shown or stored
      const who = new WeakMap(); // input -> recognise(its name) (V507)
      // The device map's lit control follows the monitor's redraw (V509): at most every
      // MONITOR_FLUSH_MS, never per message.
      let lit = null;
      monitor = createMidiMonitor({ publish: (rows) => { cmp.midiLog = rows; cmp.midiLit = lit; } });
      // The clock's tempo, published at most every CLOCK_SHOW_MS and cleared once it stops.
      const clock = createClockMeter();
      let shownAt = -Infinity;
      let gone = 0;
      const clockTick = (stamp) => {
        const at = Number.isFinite(stamp) && stamp > 0 ? stamp : now();
        clock.tick(at);
        clearTimeout(gone);
        gone = setTimeout(() => { clock.reset(); cmp.midiClockBpm = null; }, CLOCK_GAP_MS);
        if (at - shownAt < CLOCK_SHOW_MS) return;
        const bpm = clock.bpm(at);
        if (bpm === null) return;
        shownAt = at;
        cmp.midiClockBpm = bpm.toFixed(1);
      };
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
          outPorts = new Map((s.outputs || []).map((o) => [o.id, o.port]));
          cmp.midiOutputs = (s.outputs || []).map((o) => ({ id: o.id, name: o.name }));
          // An output that left is no longer followed (nothing is sent to a closed port).
          if (cmp.midiClockOut && !outPorts.has(cmp.midiClockOut)) cmp.midiClockOutSet('');
        },
        onMessage(data, port, stamp) {
          if (!ids.has(port)) { inputs += 1; ids.set(port, inputs); }
          if (!who.has(port)) who.set(port, recognise(port && port.name));
          const w = who.get(port);
          const m = decodeMidi(data);
          if (m.kind === 'clock') { clockTick(stamp); return; } // 24 a beat: measured, unlisted
          const control = controlOf(w.device, m);
          // The map lights the control of every listed message, and none for a message no
          // control sent (a key of the keybed), so a lit control is always the latest (V509).
          if (m.kind !== 'active-sensing') lit = control ? maps.litKey(w.device, m) : null;
          const act = transportAction(m, w.role); // V508: Start, Stop, the DAW buttons
          const did = act ? cmp.midiTransport(act) : null;
          if (m.kind !== 'active-sensing') {
            monitor.add({ input: w.member || (port && port.name) || '', role: w.role,
              kind: m.kind, text: describeMidi(m, control)
                + (did ? ` → ${transportName(did.target)}: ${ACTION_TEXT[act]}` : '') });
          }
          // A DAW-control or editor port's notes are buttons, never notes to sound (V507).
          if (w.role !== 'play') return;
          const e = notes.handle(data, ids.get(port));
          if (e.kind === 'control-change') { cmp.midiControl(e, control); return; }
          if (response && (e.kind === 'note-on' || e.kind === 'note-off')) {
            const at = Number.isFinite(stamp) && stamp > 0 ? stamp : now();
            response.player(e.kind === 'note-on' ? 'on' : 'off', e.note, e.velocity, at);
          }
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

    /**
     * A controller's transport action (V508, midi/transport.js) on the transport of the
     * workspace in view: the Sequencer's own there, the Studio's everywhere else. Start plays
     * from the start, Continue from where it is, Stop stops (the keys' armed run is kept),
     * Rewind returns to the start, Cycle switches the loop. -> { target } | null (nothing done)
     */
    midiTransport(act) {
      const target = transportTarget(this.workspace);
      if (target === 'sequencer') {
        const s = sequencerTransport;
        if (!s) return null;
        const ok = act === 'stop' ? s.stop() : act === 'loop' ? s.loop()
          : (act === 'start' || act === 'continue') && !s.playing() ? s.play() : false;
        return ok ? { target } : null;
      }
      if (typeof this.studioPlay !== 'function') return null;
      // The timeline plays (studio.playing; an armed run of the keys alone is not, K104).
      const playing = !!(this.studio && this.studio.playing);
      if (act === 'stop') { if (!playing) return null; this.studioStop({ keepArmed: true }); }
      else if (act === 'rewind') this.studioReturn();
      else if (act === 'loop') this.studioToggleLoop();
      else if (act === 'start' || act === 'continue') {
        if (playing) {
          if (act === 'continue') return null;
          this.studioReturn();
          return { target };
        }
        // A measurement owns the output: the Studio would refuse, so nothing moves (C3-555-1).
        const owned = typeof this.measureOwnsOutput === 'function' && this.measureOwnsOutput();
        if (owned) return null;
        if (act === 'start') this.studioReturn();
        // Said only when the Studio played (studioPlay says its own refusal).
        if (!this.studioPlay()) return null;
      }
      return { target };
    },

    /**
     * V510: the output `id` follows the transport (MIDI Start, Continue, Stop and clock at 24
     * PPQ); '' follows none, and nothing is sent.
     */
    midiClockOutSet(id) {
      const port = id ? outPorts.get(id) || null : null;
      this.midiClockOut = port ? id : '';
      if (clockOut) clockOut.setOutput(port);
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
    /** The map of known device `id` in the bank chosen for it (V509, midi/device-map-ui.js). */
    midiMap(id) {
      return maps.map(id, this.midiMapBank[id]);
    },

    /** Show bank `bank` of device `id`'s map. */
    midiMapShowBank(id, bank) {
      this.midiMapBank = { ...this.midiMapBank, [id]: bank };
    },

    /** True while an answer of call and response plays or is planned (V503). */
    midiAnswering() {
      return !!(response && response.answering());
    },

    /** Call and response on or off (V503): the MIDI section's switch; off on every load. */
    midiResponseToggle(on = !this.midiResponse) {
      this.midiResponse = response ? response.setOn(on) : false;
      return this.midiResponse;
    },

    midiAllOff() {
      if (!notes) return 0;
      // A note arming the instrument made its claim yield the notes (K247): only the engine's
      // voices give way; the keys and MIDI notes the instrument plays are its own.
      if (arming > 0) {
        return notes.silenceEngine()
          + (typeof this.kbdEngineOff === 'function' ? this.kbdEngineOff() : 0);
      }
      if (response) response.cut(); // an answer's own first note arming it is not cut
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
