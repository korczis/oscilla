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
//   Note On, velocity 0; Note Off    releases that key with the Playground's release time;
//     (0x8n)                         a key that is not sounding changes nothing
//   CC 120 All Sound Off             every note fades within ESCAPE_RELEASE_S
//   CC 123 All Notes Off             every note releases with its release time
//   anything else (CC 64 sustain     ignored: not part of the first version (ADR 0058, V502 note)
//     included), or a message
//     without a status byte
// Everything stops (within ESCAPE_RELEASE_S) when any listened-to input is lost (every note,
// not only that input's), the access is withdrawn or replaced, the page is hidden, Escape is
// pressed, Measure or Studio PLAY takes the output, or the sequencer starts. A note is refused
// while a measurement, a level reference capture, the Studio transport or the sequencer owns
// the output (ownedBy, src/js/midi/ui.js MIDI_REFUSED).
// The Labs stages that play() adds (filter, ADSR, additive) do not apply to notes.

import { clamp } from '../core/math.js';
import { midiToFrequency } from '../core/music.js';
import { WAVEFORMS } from '../core/constants.js';

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
 * `ownedBy()` names who owns the output ('measurement', 'reference', 'studio',
 * 'sequencer') or returns null; `refused(by)`
 * is told once per run of refused notes (the caller says so to the user).
 */
export function createMidiNotes({ engine, settings = () => ({}), ownedBy = () => null,
  refused = () => {} } = {}) {
  let refusing = null;
  const keyOf = (source, e) => `${source}:${e.channel}:${e.note}`;

  return {
    /** A message from input `source` (any stable id of the input). Returns the event. */
    handle(data, source = 0) {
      const e = parseMidiMessage(data);
      if (!engine) return e;
      if (e.kind === 'note-on') {
        const by = ownedBy();
        if (by) {
          if (refusing !== by) refused(by);
          refusing = by;
          e.result = { ok: false, reason: by };
          return e;
        }
        refusing = null;
        const s = settings() || {};
        e.result = engine.noteOn(keyOf(source, e), {
          freq: midiToFrequency(e.note, s.a4 > 0 ? s.a4 : 440),
          level: velocityLevel(e.velocity),
          wave: WAVEFORMS.includes(s.waveform) ? s.waveform : 'sine',
          attackS: s.attackS, releaseS: s.releaseS, limitS: s.limitS, continuous: !!s.continuous,
        });
        if (e.result && e.result.ok && typeof engine.resume === 'function') engine.resume();
      } else if (e.kind === 'note-off') {
        engine.noteOff(keyOf(source, e));
      } else if (e.kind === 'all-sound-off' || e.kind === 'all-notes-off') {
        engine.notesOff(e.kind === 'all-sound-off');
      }
      return e;
    },

    /** Every note off within ESCAPE_RELEASE_S; returns how many were sounding. */
    silence() {
      return engine ? engine.notesOff(true) : 0;
    },
  };
}
