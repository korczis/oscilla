// Musical-note helpers (equal temperament, adjustable A4), extracted from V1
// (index.html@a7b7a23, sections 1 and 4). Bodies are unchanged.

import { isNum } from './math.js';

/** Cents in one octave: f · 2^(cents / CENTS_PER_OCTAVE) (V2+, the Studio's detune maths). */
export const CENTS_PER_OCTAVE = 1200;

// V1: NOTE_NAMES, NOTE_BUTTONS (index.html@a7b7a23)
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_BUTTONS = ['C2', 'A2', 'C3', 'A3', 'C4', 'A4', 'C5', 'A5', 'C6', 'A6', 'C7'];

// V1: frequencyToMidi, midiToFrequency, midiToName, nearestNote, noteToFrequency, formatCents
// (index.html@a7b7a23)
export function frequencyToMidi(f, a4 = 440) {
  return 69 + 12 * Math.log2(f / a4);
}
export function midiToFrequency(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}
export function midiToName(midi) {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
export function nearestNote(f, a4 = 440) {
  if (!(f > 0) || !(a4 > 0)) return null;
  const m = frequencyToMidi(f, a4);
  const n = Math.round(m);
  return { name: midiToName(n), midi: n, cents: Math.round((m - n) * 100), exact: midiToFrequency(n, a4) };
}
export function noteToFrequency(name, a4 = 440) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(String(name).trim());
  if (!m) return null;
  let idx = NOTE_NAMES.indexOf(m[1]);
  if (m[2] === '#') idx += 1;
  if (m[2] === 'b') idx -= 1;
  const midi = (parseInt(m[3], 10) + 1) * 12 + idx;
  return midiToFrequency(midi, a4);
}
export function formatCents(c) {
  if (!isNum(c)) return '';
  if (c === 0) return '0 cents';
  return `${c > 0 ? '+' : '−'}${Math.abs(c)} cents`;
}

// Scales (plan K097): the semitones of each degree above the key, one octave. The ONE scale
// table: the XY pad's pitch axis reads it, and any later step grid or quantiser shares it.
export const SCALE_MODES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
});
export const SCALE_LABELS = Object.freeze({ major: 'Major', minor: 'Natural minor',
  dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian',
  locrian: 'Locrian', 'major-pentatonic': 'Major pentatonic',
  'minor-pentatonic': 'Minor pentatonic', chromatic: 'Chromatic' });

/**
 * The MIDI note of scale step `i` (0 = the key in `octave`, counting degrees upwards across
 * octaves) -> { note, degree (1-based within the octave), octave offset }.
 */
export function scaleNote(i, { mode = 'major', key = 'C', octave = 4 } = {}) {
  const m = SCALE_MODES[mode] || SCALE_MODES.major;
  const up = Math.floor(i / m.length);
  const d = i - up * m.length;
  return { note: 12 * (octave + 1 + up) + NOTE_NAMES.indexOf(key) + m[d], degree: d + 1, up };
}
