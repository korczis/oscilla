// MIDI notes sound through the AudioEngine (plan issue V502; ADR 0058 and its V502 note).
//
// A message from an input becomes a note event, and a note event becomes a note voice of the
// one engine (engine.noteOn / noteOff / notesOff): no second graph, no synth of its own. What
// the engine guarantees (level cap, NOTE_POLYPHONY, click-free envelopes, the 0.95 x Nyquist
// bound, the safety limit) it guarantees for MIDI notes too; this module only decides which
// note, how loud and when everything stops.
//
// What a message does (any channel: omni; the key is input, channel and note):
//   Note On (0x9n), velocity 1-127   a note at midiToFrequency(note, A4), level velocityLevel
//   Note On, velocity 0; Note Off    releases that key where its Note On sounded (the
//     (0x8n)                         Playground's voices or the Synth panel), with that
//                                    player's release; a key not sounding changes nothing
//   CC 120 All Sound Off             every note fades within ESCAPE_RELEASE_S
//   CC 123 All Notes Off             every note releases with its release time
//   anything else (CC 64 sustain     ignored: not part of the first version (ADR 0058, V502 note)
//     included), or a message
//     without a status byte
// A note is held (ADR 0062, amending ADR 0005): it sounds until its Note Off, past the safety
// limit, under the same output ceiling. Everything stops (within ESCAPE_RELEASE_S) when any
// listened-to input is lost (every note, not only that input's), the access is withdrawn or
// replaced, the window loses the focus, the page is hidden, Escape is pressed, Measure or
// Studio PLAY takes the output, or the sequencer starts. A note is refused
// while a measurement, a level reference capture, the Studio transport or the sequencer owns
// the output (ownedBy, src/js/midi/ui.js MIDI_REFUSED).
// The Labs stages that play() adds (filter, ADSR, additive) do not apply to notes.

import { forcedOff } from '../audio/gate.js';
import { clamp } from '../core/math.js';
import { midiToFrequency } from '../core/music.js';
import { WAVEFORMS } from '../core/constants.js';
import { createHeldNotes, sameSink } from './held-notes.js';

/**
 * The velocity law: amplitude (velocity / 127)^2, that is 40 log10(velocity / 127) dB. The
 * engine raises a note's peak (this / NOTE_POLYPHONY) to GAIN_FLOOR (-80 dB), so velocities 1
 * to 3 all sound at that floor, above the law; from velocity 4 the law holds exactly.
 */
export function velocityLevel(velocity) {
  const v = clamp(Math.round(Number(velocity) || 0), 0, 127) / 127;
  return v * v;
}

/**
 * One MIDI message (a Uint8Array or array of bytes) as an event:
 *   { kind: 'note-on' | 'note-off', channel, note, velocity }
 *   { kind: 'all-sound-off' | 'all-notes-off', channel }
 *   { kind: 'ignored' }
 */
export function parseMidiMessage(data) {
  const ignored = { kind: 'ignored' };
  if (!data || data.length < 3) return ignored;
  const [status, d1, d2] = data;
  if (status < 0x80 || d1 > 0x7f || d2 > 0x7f) return ignored;
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0x90 && d2 > 0) return { kind: 'note-on', channel, note: d1, velocity: d2 };
  if (type === 0x90 || type === 0x80) return { kind: 'note-off', channel, note: d1, velocity: d2 };
  if (type === 0xb0 && d1 === 120) return { kind: 'all-sound-off', channel };
  if (type === 0xb0 && d1 === 123) return { kind: 'all-notes-off', channel };
  return ignored;
}

/**
 * The note layer of one page. `engine` is the AudioEngine; `settings()` returns the
 * Playground's { a4, waveform, attackS, releaseS, limitS, continuous } at the time of a note;
 * `claim(reason)` is the playback bus's claim for the notes (C037, core/output-bus.js): asked
 * once for each note that starts on the Playground's voices, it answers { ok } or
 * { ok: false, by } with the owner that refuses it; `release()` tells the bus the last held
 * note is gone; `noted(on, note, source)` tells it each note that starts or ends (its trace,
 * C050). Without a claim, `ownedBy()` names who owns the output ('measurement',
 * 'reference', 'studio', 'sequencer') or returns null, as before the bus. `refused(by)`
 * is told once per run of refused notes (the caller says so to the user).
 * The MIDI inputs and the on-screen and computer keyboard (K026, src/js/midi/keyboard.js) play
 * through the same layer, each with its own `source` in the note key.
 */
export function createMidiNotes({ engine, settings = () => ({}), ownedBy = () => null,
  refused = () => {}, route = () => null, claim = null, release = () => {},
  noted = () => {} } = {}) {
  let refusing = null;
  const keyOf = (source, channel, note) => `${source}:${channel}:${note}`;
  // Where each held key sounds, fixed at its note-on (src/js/midi/held-notes.js, K178): the
  // routed sink, or ENGINE (the Playground's note voices). Its note-off goes there, whatever
  // route() answers by then, so a key held across a workspace switch is released where it
  // sounds and never left sounding.
  const ENGINE = Object.freeze({ noteOff: (note, info) => (engine
    ? engine.noteOff(info.key, { forced: forcedOff(info) }) : false) });
  const held = createHeldNotes();
  // The input a source belongs to: the keyboard's `kbd-<source>`, else a MIDI input's number.
  const inputOf = (source) => (typeof source === 'string' && source.startsWith('kbd-')
    ? source.slice(4) : typeof source === 'string' && source.startsWith('xy') ? 'xy' : 'midi');

  /** Who refuses a note that would start on the engine now: the bus's claim, else ownedBy(). */
  function refusedBy() {
    if (typeof claim !== 'function') return ownedBy();
    const c = claim('note-on');
    return c && c.ok === false ? (c.by || 'refused') : null;
  }

  /** The bus learns that no note is held any more (C037: the notes release the output). */
  function releaseIfIdle() {
    if (!held.held().length) release();
  }

  /** Note `note` (0-127) at `velocity` (1-127) from `source`: { ok, reason? | id, ... }. */
  function noteOn(note, velocity, source = 0, channel = 0) {
    const key = keyOf(source, channel, note);
    const sink = route(); // the Synth panel plays the note instead (K065), one path for all
    const to = sink || ENGINE;
    // A re-press on the same player retriggers there (the engine fades the old note under the
    // new one); on another player hold() first releases it where it sounded.
    if (sameSink(held.sinkOf(key), to)) held.releaseKey(key, 're-press');
    held.hold(key, { sink: to, note, velocity, input: inputOf(source) });
    if (sink) return played(sink.noteOn(note, velocity), note, source);
    if (!engine) return { ok: false, reason: 'no-audio' };
    const by = refusedBy();
    if (by) {
      if (refusing !== by) refused(by);
      refusing = by;
      return { ok: false, reason: by };
    }
    refusing = null;
    return played(startOnEngine(key, note, velocity), note, source);
  }

  /** A started note is told to the bus (noted); the result passes through. */
  function played(result, note, source) {
    if (result && result.ok !== false) noted(true, note, source);
    return result;
  }

  /** The Playground voice of `key` at `note` (the engine's own held note). */
  function startOnEngine(key, note, velocity) {
    const s = settings() || {};
    const result = engine.noteOn(key, {
      freq: midiToFrequency(note, s.a4 > 0 ? s.a4 : 440),
      level: velocityLevel(velocity),
      wave: WAVEFORMS.includes(s.waveform) ? s.waveform : 'sine',
      attackS: s.attackS, releaseS: s.releaseS, limitS: s.limitS, continuous: !!s.continuous,
      held: true,
    });
    if (result && result.ok && typeof engine.resume === 'function') engine.resume();
    return result;
  }

  /**
   * Move a held note of `source` from `from` to `to` without a new gate (K183: the XY pad's
   * finger crossing into another scale cell): the sink's legato(to, info) when it has one (a mono
   * voice glides by its Keys node's glide), else its off and on; the Playground voice restarts at
   * the new pitch. A `from` not held here is a plain press of `to`.
   */
  function legato(from, to, source = 0, channel = 0) {
    const oldKey = keyOf(source, channel, from);
    const newKey = keyOf(source, channel, to);
    const was = held.held().find((h) => h.key === oldKey);
    if (!was) return noteOn(to, 100, source, channel);
    const { velocity } = was;
    const sink = held.legato(oldKey, newKey, { note: to, velocity });
    if (sink === ENGINE) {
      if (engine) engine.noteOff(oldKey);
      return engine ? startOnEngine(newKey, to, velocity) : { ok: false, reason: 'no-audio' };
    }
    if (typeof sink.legato === 'function') return sink.legato(to, { from, velocity, key: newKey });
    sink.noteOff(from);
    return sink.noteOn(to, velocity);
  }

  /** Release note `note` from `source` with its release time; false when it is not sounding. */
  /** `forced` (blur, hide, Escape): a stop never deferred by the minimum gate (K184). */
  function noteOff(note, source = 0, channel = 0, { forced = false } = {}) {
    const key = keyOf(source, channel, note);
    // A key not held here: where it would sound now.
    const sink = held.releaseKey(key) || route() || ENGINE;
    const off = sink === ENGINE ? ENGINE.noteOff(note, { key, forced })
      : sink.noteOff(note, { key, forced });
    noted(false, note, source);
    releaseIfIdle();
    return off;
  }

  return {
    noteOn,
    noteOff,
    legato,

    /** A message from input `source` (any stable id of the input). Returns the event. */
    handle(data, source = 0) {
      const e = parseMidiMessage(data);
      if (!engine) return e;
      if (e.kind === 'note-on') {
        e.result = noteOn(e.note, e.velocity, source, e.channel);
      } else if (e.kind === 'note-off') {
        noteOff(e.note, source, e.channel);
      } else if (e.kind === 'all-sound-off' || e.kind === 'all-notes-off') {
        const sink = route();
        if (sink) sink.allOff();
        engine.notesOff(e.kind === 'all-sound-off');
        // A key still held on another player (routed before a switch) is released there. A key
        // on the route's own sink gets a second, redundant off here after its allOff (21's K2):
        // harmless, an off for a note already released.
        held.releaseAll('all-off');
        releaseIfIdle();
      }
      return e;
    },

    /**
     * Every held key of one input released where it sounds (held-notes.js releaseAll with the
     * input filter): 'xy' for the XY pad's 'kbd-xy' notes (K183), 'midi', 'key', ... -> count.
     */
    releaseInput(input, reason = 'all-off') {
      const n = held.releaseAll(reason, { input });
      releaseIfIdle();
      return n;
    },

    /** Every note off within ESCAPE_RELEASE_S; returns how many were sounding. */
    silence() {
      const sink = route();
      const n = sink ? sink.allOff() : 0;
      const sounding = engine ? engine.notesOff(true) : 0;
      held.releaseAll('silence');
      releaseIfIdle();
      return sounding + n;
    },
  };
}
