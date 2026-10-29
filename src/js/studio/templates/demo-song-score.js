// The score of the demo song "Lantern in the Slag Yard" (plan issue K058): an original slow
// riff-rock piece in A minor, 96 BPM, 4/4, 44 bars, written for OSCILLA on 2026-10-29. Every
// part below was composed for this file; nothing is transcribed or quoted from another song.
// Pure data and pure functions; no DOM, no Web Audio. demo-song.js expands it into a Studio
// document.
//
// Grid: 16 sixteenth steps per bar. A melodic note is [step, pitch, lengthSteps, velocity]; a
// drum hit is [step, drumNote, velocity] (General MIDI numbers: kick 36, snare 38, closed hat
// 42, open hat 46). Velocities are part of the composition; the Studio has no clip level, so
// demo-song.js does not play them (the Learn text says so).

export const TITLE = 'Lantern in the Slag Yard';
export const TEMPO_BPM = 96;
export const BAR_STEPS = 16;
export const BARS = 44;
export const KICK = 36;
export const SNARE = 38;
export const HAT = 42;
export const OPEN_HAT = 46;

// ---------------------------------------------------------------- bass riffs (2 bars each)
// Riff A, the verse riff: a pedal with a sixteenth pickup, a leap to the fifth and the octave,
// then a fourth up from the root and a chromatic climb D-D#-E, ending on the minor seventh.
export const RIFF_A = Object.freeze([
  [[0, 'A1', 3, 110], [3, 'A1', 1, 78], [4, 'E2', 2, 100], [6, 'A2', 2, 104],
    [8, 'G2', 4, 100], [12, 'E2', 2, 88]],
  [[0, 'A1', 3, 110], [3, 'A1', 1, 78], [4, 'D2', 2, 100], [6, 'D#2', 2, 98],
    [8, 'E2', 4, 110], [12, 'G2', 2, 96]],
]);
// Riff C, the chorus riff over F | G | F | E: the same gesture moved onto each root.
export const RIFF_C = Object.freeze([
  [[0, 'F1', 3, 112], [3, 'F1', 1, 80], [4, 'C2', 2, 100], [6, 'F2', 2, 106],
    [8, 'E2', 4, 100], [12, 'C2', 2, 90]],
  [[0, 'G1', 3, 112], [3, 'G1', 1, 80], [4, 'D2', 2, 100], [6, 'G2', 2, 106],
    [8, 'F2', 2, 96], [10, 'D2', 4, 104]],
  [[0, 'F1', 3, 112], [3, 'F1', 1, 80], [4, 'C2', 2, 100], [6, 'F2', 2, 106],
    [8, 'E2', 4, 100], [12, 'C2', 2, 90]],
  [[0, 'E1', 3, 114], [3, 'E1', 1, 82], [4, 'B1', 2, 102], [6, 'E2', 2, 108],
    [8, 'G#2', 4, 110], [12, 'B1', 2, 96]],
]);
const eighths = (pitch, v0, from = 0, to = 16) => {
  const out = [];
  for (let s = from; s < to; s += 2) out.push([s, pitch, 2, v0 + (s % 4 === 0 ? 8 : 0)]);
  return out;
};
const sixteenths = (pitch, v0, from, to) => {
  const out = [];
  for (let s = from; s < to; s += 1) out.push([s, pitch, 1, v0 + (s - from) * 2]);
  return out;
};
// The build: eighth-note pedals that climb a step per bar; the last bar breaks into sixteenths.
export const BASS_BUILD = Object.freeze([
  eighths('A1', 92),
  eighths('A1', 96),
  eighths('C2', 100),
  [...eighths('D2', 104, 0, 8), ...sixteenths('E2', 100, 8, 16)],
]);
export const BASS_OUTRO_END = Object.freeze([[[0, 'A1', 16, 112]], [[0, 'A1', 16, 96]]]);

// ---------------------------------------------------------------- lead (the synth voice)
export const LEAD_VERSE = Object.freeze([
  [[8, 'E4', 4, 90], [12, 'D4', 4, 84]],
  [[0, 'C4', 6, 90], [6, 'A3', 10, 80]],
  [[8, 'G4', 2, 92], [10, 'E4', 2, 88], [12, 'D4', 4, 86]],
  [[0, 'E4', 16, 96]],
]);
export const LEAD_CHORUS = Object.freeze([
  [[0, 'A4', 4, 100], [4, 'C5', 4, 106], [8, 'A4', 2, 96], [10, 'F4', 6, 92]],
  [[0, 'G4', 4, 98], [4, 'B4', 2, 100], [6, 'D5', 6, 110], [12, 'B4', 4, 96]],
  [[0, 'C5', 6, 106], [6, 'A4', 2, 94], [8, 'C5', 4, 100], [12, 'D5', 4, 104]],
  [[0, 'B4', 8, 100], [8, 'G#4', 8, 94]],
]);
// The second chorus answers its fourth bar with a wider line over the E chord.
export const LEAD_CHORUS_VAR_BAR4 = Object.freeze([[0, 'E5', 6, 116], [6, 'B4', 2, 98],
  [8, 'D5', 4, 106], [12, 'G#4', 4, 100]]);

// ---------------------------------------------------------------- drums
const hats8 = (accent = 92, soft = 64) => [0, 2, 4, 6, 8, 10, 12, 14]
  .map((s) => [s, HAT, s % 4 === 0 ? accent : soft]);
export const DRUM_VERSE = Object.freeze([[0, KICK, 112], [4, SNARE, 104], [7, KICK, 86],
  [8, KICK, 104], [12, SNARE, 108]]);
export const DRUM_VERSE2 = Object.freeze([...DRUM_VERSE, [0, HAT, 70], [4, HAT, 60],
  [8, HAT, 70], [12, HAT, 60]]);
export const DRUM_CHORUS = Object.freeze([[0, KICK, 116], [3, KICK, 88], [4, SNARE, 110],
  [8, KICK, 108], [10, KICK, 92], [12, SNARE, 112], ...hats8()]);
export const DRUM_CHORUS_TURN = Object.freeze([...DRUM_CHORUS.filter(([s, n]) => !(n === HAT
  && s === 14)), [14, OPEN_HAT, 96]]);
export const DRUM_INTRO_PICKUP = Object.freeze([[12, SNARE, 70], [13, SNARE, 80],
  [14, SNARE, 90], [15, SNARE, 102]]);
const kick4 = [0, 4, 8, 12].map((s) => [s, KICK, 108]);
const snare8 = (v0, dv) => [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, SNARE, v0 + s * dv]);
export const DRUM_BUILD = Object.freeze([
  [...kick4, [4, SNARE, 90], [12, SNARE, 94]],
  [...kick4, ...snare8(70, 2)],
  [...kick4, ...snare8(86, 1)],
  [...kick4, ...Array.from({ length: 16 }, (_, s) => [s, SNARE, 80 + s * 2])],
]);
export const DRUM_OUTRO_HIT = Object.freeze([[0, KICK, 120], [0, SNARE, 110]]);

// ---------------------------------------------------------------- form: [name, startBar, bars]
export const FORM = Object.freeze([
  ['intro', 1, 4],
  ['verse 1', 5, 8],
  ['chorus 1', 13, 8],
  ['verse 2', 21, 8],
  ['build', 29, 4],
  ['chorus 2', 33, 8],
  ['outro', 41, 4],
]);

/** The bass notes of bar `bar` (1-based). */
export function bassBar(bar) {
  if (bar >= 13 && bar <= 20) return RIFF_C[(bar - 13) % 4];
  if (bar <= 28) return RIFF_A[(bar - 1) % 2];
  if (bar <= 32) return BASS_BUILD[bar - 29];
  if (bar <= 40) return RIFF_C[(bar - 33) % 4];
  if (bar <= 42) return RIFF_A[bar - 41];
  return BASS_OUTRO_END[bar - 43];
}

/** The lead notes of bar `bar` (1-based): silent in the intro, verse 1, the build and outro. */
export function leadBar(bar) {
  if (bar >= 13 && bar <= 20) return LEAD_CHORUS[(bar - 13) % 4];
  if (bar >= 21 && bar <= 28) return LEAD_VERSE[(bar - 21) % 4];
  if (bar >= 33 && bar <= 40) {
    const i = (bar - 33) % 4;
    return i === 3 ? LEAD_CHORUS_VAR_BAR4 : LEAD_CHORUS[i];
  }
  return [];
}

/** The drum hits of bar `bar` (1-based). */
export function drumBar(bar) {
  if (bar <= 3) return [];
  if (bar === 4) return DRUM_INTRO_PICKUP;
  if (bar <= 12) return DRUM_VERSE;
  if (bar <= 20) return (bar - 13) % 4 === 3 ? DRUM_CHORUS_TURN : DRUM_CHORUS;
  if (bar <= 28) return DRUM_VERSE2;
  if (bar <= 32) return DRUM_BUILD[bar - 29];
  if (bar <= 40) return (bar - 33) % 4 === 3 ? DRUM_CHORUS_TURN : DRUM_CHORUS;
  if (bar <= 42) return DRUM_VERSE;
  if (bar === 43) return DRUM_OUTRO_HIT;
  return [];
}

// ---------------------------------------------------------------- automation, in beats
// [beat, value, curve]: the build (beats 112-128) opens the bass filter and speeds up the lead
// LFO; the outro fades the three mix inputs. The score also raises the bass filter's Q and a
// drive amount in the build; the Studio cannot play either yet (a Q lane is refused at PLAY and
// there is no Drive node), so demo-song.js leaves them out rather than ship a lane that does
// nothing.
export const AUTOMATION = Object.freeze({
  bassCutoff: [[0, 300, 'linear'], [16, 900, 'linear'], [48, 900, 'step'], [48, 1600, 'step'],
    [80, 1600, 'step'], [80, 900, 'step'], [112, 500, 'step'], [128, 6000, 'exponential'],
    [128, 2200, 'step'], [160, 2200, 'linear'], [176, 300, 'exponential']],
  leadLfoRate: [[0, 0.5, 'linear'], [112, 0.5, 'step'], [128, 6, 'exponential'],
    [128, 0.5, 'step'], [176, 0.5, 'linear']],
  bassQ: [[0, 1.2, 'linear'], [112, 1.2, 'step'], [128, 7, 'linear'], [128, 2, 'step'],
    [176, 2, 'linear']],
  drive: [[0, 0.25, 'linear'], [112, 0.25, 'step'], [128, 0.85, 'linear'], [128, 0.45, 'step'],
    [176, 0.2, 'linear']],
  fade: [[0, 1, 'linear'], [168, 1, 'linear'], [176, 0, 'linear']],
});

const PITCH = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9,
  'A#': 10, B: 11 };

/** The MIDI note number of a pitch name such as 'A1' or 'G#4' (C4 = 60). */
export function midiOf(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new RangeError(`Unknown pitch "${name}".`);
  return 12 * (Number(m[2]) + 1) + PITCH[m[1]];
}

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz), rounded to 1e-6 Hz. */
export function noteHz(note) {
  return Math.round(440 * 2 ** ((note - 69) / 12) * 1e6) / 1e6;
}

/**
 * Every note of a part as [startStep, midiNote, lengthSteps, velocity], in song order. `part` is
 * 'bass', 'lead' or 'drums' (drum hits are one step long).
 */
export function partNotes(part) {
  const out = [];
  for (let bar = 1; bar <= BARS; bar++) {
    const at = (bar - 1) * BAR_STEPS;
    if (part === 'drums') {
      for (const [s, n, v] of drumBar(bar)) out.push([at + s, n, 1, v]);
    } else {
      const notes = part === 'bass' ? bassBar(bar) : leadBar(bar);
      for (const [s, p, len, v] of notes) out.push([at + s, midiOf(p), len, v]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
