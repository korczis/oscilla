// One MIDI 1.0 message decoded (plan issue V507): the one decoder of src/js/midi. The note layer
// (notes.js parseMidiMessage) maps its events onto what it plays; the monitor (monitor.js)
// describes every kind of it.
//
//   decodeMidi(bytes) -> { kind, channel?, ...fields }
//     note-on / note-off { channel, note, velocity }   (Note On at velocity 0 is note-off)
//     poly-pressure { channel, note, pressure }   control-change { channel, controller, value }
//     program { channel, program }   pressure { channel, pressure }
//     pitch-bend { channel, value -8192..8191 }
//     clock, start, continue, stop, active-sensing, reset, tune-request
//     song-position { beats }   song-select { song }   time-code { value }
//     sysex { bytes, length }   unknown { bytes }

const SYSTEM = Object.freeze({ 0xf8: 'clock', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop',
  0xfe: 'active-sensing', 0xff: 'reset', 0xf6: 'tune-request' });

/**
 * One message by the MIDI 1.0 table. Channel messages carry a 0-based channel; one that is
 * short of its data bytes, or whose data byte has the top bit set, is unknown.
 */
export function decodeMidi(data) {
  const b = data ? Array.from(data) : [];
  const s = b[0];
  if (!Number.isInteger(s) || s < 0x80) return { kind: 'unknown', bytes: b };
  if (s === 0xf0) return { kind: 'sysex', bytes: b, length: b.length };
  if (SYSTEM[s]) return { kind: SYSTEM[s] };
  if (s === 0xf2) return { kind: 'song-position', beats: ((b[2] || 0) << 7) | (b[1] || 0) };
  if (s === 0xf3) return { kind: 'song-select', song: b[1] || 0 };
  if (s === 0xf1) return { kind: 'time-code', value: b[1] || 0 };
  if (s >= 0xf0) return { kind: 'unknown', bytes: b };
  const need = (s & 0xf0) === 0xc0 || (s & 0xf0) === 0xd0 ? 2 : 3;
  if (b.length < need || b.slice(1, need).some((x) => !Number.isInteger(x) || x > 0x7f)) {
    return { kind: 'unknown', bytes: b };
  }
  const channel = s & 0x0f;
  const d1 = b[1] || 0;
  const d2 = b[2] || 0;
  switch (s & 0xf0) {
    case 0x90: return d2 > 0 ? { kind: 'note-on', channel, note: d1, velocity: d2 }
      : { kind: 'note-off', channel, note: d1, velocity: 0 };
    case 0x80: return { kind: 'note-off', channel, note: d1, velocity: d2 };
    case 0xa0: return { kind: 'poly-pressure', channel, note: d1, pressure: d2 };
    case 0xb0: return { kind: 'control-change', channel, controller: d1, value: d2 };
    case 0xc0: return { kind: 'program', channel, program: d1 };
    case 0xd0: return { kind: 'pressure', channel, pressure: d1 };
    default: return { kind: 'pitch-bend', channel, value: ((d2 << 7) | d1) - 8192 };
  }
}
