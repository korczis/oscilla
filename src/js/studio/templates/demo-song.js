// Template: Demo song, "Lantern in the Slag Yard" (plan issue K144). An original slow riff-rock
// song (demo-song-score.js) expanded into one Studio document: a bass voice through a low-pass
// filter, a square lead through a resonant filter with an LFO on its cutoff, drums built from
// an Oscillator sweep (kick) and Noise through filters and envelopes (snare, hats), a mixer, the
// Master Output and the four analysis taps. Every note is a tempo-linked pattern clip, every
// drum hit a pattern or gate clip, the form is seven markers, and three lanes automate the
// build and the outro. Pure; the model is built once, at module load, from the score alone.
//
// What the song asks for and the Studio cannot play yet is left out, never shipped inert:
// velocity (a clip has no level), the bass filter Q lane (refused at PLAY) and the drive amount
// (no Drive node). DEMO_SONG_OMITTED names them for the tests and the README.
import { edge, lane, marker, node, track } from './data.js';
import * as S from './demo-song-score.js';

const SPB = 60 / S.TEMPO_BPM;
const STEP_BEATS = 0.25;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
/** Mixer input levels: bass, lead, drums. The outro fade scales each to 0. */
const MIX = Object.freeze({ level1: 0.8, level2: 0.45, level3: 0.8 });
/**
 * Gate lengths in beats: snare 0.1, closed hat 0.048 (30 ms at 96 BPM), open hat 0.25 (156 ms).
 * The open hat has its own envelope, which holds a sustain (0.25) so its longer gate rings on;
 * the closed hat's envelope has none and ends at 31 ms. One shared envelope cannot do both: a
 * sustain there would lengthen every closed hat too.
 */
const GATE_BEATS = Object.freeze({ [S.SNARE]: 0.1, [S.HAT]: 0.048, [S.OPEN_HAT]: 0.25 });

/** What the score holds that the template does not play, and why (Learn text, README). */
export const DEMO_SONG_OMITTED = Object.freeze([
  'velocity: a Studio clip has no level, so every note plays at its track\'s level',
  'bass filter Q lane: a low-pass Q lane is refused at PLAY',
  'drive amount lane: the Studio has no Drive node yet (K012)',
]);

const nodes = [
  node('bass-osc', 'oscillator', 40, 60, { waveform: 'sawtooth', frequency: 55, level: 0.9 },
    'Bass voice'),
  node('bass-filter', 'filter', 260, 60, { type: 'lowpass', frequency: 300, Q: 1.2 },
    'Bass filter'),
  node('lead-osc', 'oscillator', 40, 220, { waveform: 'square', frequency: 440, level: 0.5 },
    'Lead voice'),
  node('lead-filter', 'filter', 260, 220, { type: 'lowpass', frequency: 1800, Q: 4 },
    'Lead filter'),
  node('lead-lfo', 'lfo', 260, 380, { shape: 'sine', rate: 0.5 }, 'Lead LFO'),
  node('kick-osc', 'oscillator', 40, 540, { waveform: 'sine', frequency: 50, level: 1 }, 'Kick'),
  node('noise-1', 'noise', 40, 700, { color: 'white', level: 0.6 }, 'Drum noise'),
  node('snare-filter', 'filter', 260, 640, { type: 'bandpass', frequency: 1800, Q: 0.8 },
    'Snare tone'),
  node('snare-env', 'envelope', 480, 640, { attack: 0.001, decay: 0.12, sustain: 0,
    release: 0.08 }, 'Snare envelope'),
  node('hat-filter', 'filter', 260, 780, { type: 'highpass', frequency: 7000, Q: 0.7 },
    'Hat tone'),
  node('hat-env', 'envelope', 480, 780, { attack: 0.001, decay: 0.03, sustain: 0,
    release: 0.02 }, 'Hat envelope'),
  node('open-hat-env', 'envelope', 480, 900, { attack: 0.001, decay: 0.03, sustain: 0.25,
    release: 0.02 }, 'Open hat envelope'),
  node('drum-mix', 'mixer', 700, 640, { level1: 0.9, level2: 0.6, level3: 0.35, level4: 0.35 },
    'Drum mix'),
  node('main-mix', 'mixer', 920, 220, { ...MIX, level4: 0 }, 'Main mix'),
  node('master-1', 'master', 1140, 220, {}, 'Master'),
  node('scope-1', 'scope', 1140, 60, {}, 'Scope'),
  node('spectrum-1', 'spectrum', 1140, 380, {}, 'Spectrum'),
  node('spectrogram-1', 'spectrogram', 1140, 540, {}, 'Spectrogram'),
  node('meter-1', 'meter', 1140, 700, {}, 'Meter'),
];

const wires = [
  ['bass-osc', 'audio', 'bass-filter', 'audio'],
  ['bass-filter', 'audio', 'main-mix', 'in1'],
  ['lead-osc', 'audio', 'lead-filter', 'audio'],
  ['lead-filter', 'audio', 'main-mix', 'in2'],
  ['lead-lfo', 'control', 'lead-filter', 'frequency',
    { depth: 0.5, mapping: 'log', polarity: 'bipolar' }],
  ['kick-osc', 'audio', 'drum-mix', 'in1'],
  ['noise-1', 'audio', 'snare-filter', 'audio'],
  ['snare-filter', 'audio', 'snare-env', 'audio'],
  ['snare-env', 'audio', 'drum-mix', 'in2'],
  ['noise-1', 'audio', 'hat-filter', 'audio'],
  ['hat-filter', 'audio', 'hat-env', 'audio'],
  ['hat-env', 'audio', 'drum-mix', 'in3'],
  ['hat-filter', 'audio', 'open-hat-env', 'audio'],
  ['open-hat-env', 'audio', 'drum-mix', 'in4'],
  ['drum-mix', 'audio', 'main-mix', 'in3'],
  ['main-mix', 'audio', 'master-1', 'audio'],
  ...['scope-1', 'spectrum-1', 'spectrogram-1', 'meter-1']
    .map((v) => ['main-mix', 'audio', v, 'audio']),
];
const edges = wires.map(([f, fp, t, tp, props], i) => edge(`edge-${i + 1}`, f, fp, t, tp,
  props || null));

const tracks = [
  track('track-bass', 'event', 'Bass', 'bass-osc'),
  track('track-lead', 'event', 'Lead', 'lead-osc'),
  track('track-kick', 'event', 'Kick', 'kick-osc'),
  track('track-snare', 'event', 'Snare', 'snare-env'),
  track('track-hat', 'event', 'Hats', 'hat-env'),
  track('track-open-hat', 'event', 'Open hat', 'open-hat-env'),
];

const clips = [];
/** A tempo-linked clip at `startBeats` lasting `durationBeats`; its seconds follow the tempo. */
function clipAt(trackId, kind, startBeats, durationBeats, payload) {
  clips.push({ id: `clip-${clips.length + 1}`, trackId, kind, start: round6(startBeats * SPB),
    duration: round6(durationBeats * SPB), target: null,
    musical: { startBeats, durationBeats }, payload });
}
const tone = (note) => ({ blockType: 'tone', params: { freq: S.noteHz(note) } });
for (const [step, note, len] of S.partNotes('bass')) {
  clipAt('track-bass', 'pattern', step * STEP_BEATS, len * STEP_BEATS, tone(note));
}
for (const [step, note, len] of S.partNotes('lead')) {
  clipAt('track-lead', 'pattern', step * STEP_BEATS, len * STEP_BEATS, tone(note));
}
for (const [step, note] of S.partNotes('drums')) {
  const at = step * STEP_BEATS;
  if (note === S.KICK) {
    clipAt('track-kick', 'pattern', at, STEP_BEATS, { blockType: 'sweep',
      params: { start: 140, end: 45, curve: 'log' } });
  } else if (note === S.SNARE) {
    clipAt('track-snare', 'event', at, GATE_BEATS[note], { action: 'gate' });
  } else {
    clipAt(note === S.OPEN_HAT ? 'track-open-hat' : 'track-hat', 'event', at, GATE_BEATS[note],
      { action: 'gate' });
  }
}

/** A lane from score points [beat, value, curve], its times in seconds at the song's tempo. */
const laneOf = (id, nodeId, param, points, scale = 1) => lane(id, nodeId, param,
  points.map(([beat, value, curve], i) => [`${id}-pt-${i + 1}`, round6(beat * SPB),
    round6(value * scale), curve]));
const automation = [
  laneOf('lane-cutoff', 'bass-filter', 'frequency', S.AUTOMATION.bassCutoff),
  laneOf('lane-lfo-rate', 'lead-lfo', 'rate', S.AUTOMATION.leadLfoRate),
  ...Object.entries(MIX).map(([param, level], i) => laneOf(`lane-fade-${i + 1}`, 'main-mix',
    param, S.AUTOMATION.fade, level)),
];
const markers = S.FORM.map(([name, startBar], i) => marker(`marker-${i + 1}`,
  round6((startBar - 1) * 4 * SPB), 'custom', name));

export const DEMO_SONG_TITLE = `Demo song: ${S.TITLE}`;
/** Length of the song in seconds: 44 bars of 4 beats at 96 BPM. */
export const DEMO_SONG_SECONDS = S.BARS * 4 * SPB;

export default {
  id: 'demo-song',
  version: 1,
  title: DEMO_SONG_TITLE,
  category: 'synthesis',
  learn: {
    summary: 'An original slow riff-rock song in A minor at 96 BPM: 44 bars of bass riff, lead '
      + 'line and drums, played by Studio nodes from tempo-linked clips (110 s).',
    points: [
      'Every note is a pattern clip on an event track; the markers name the sections, and a '
        + 'tempo change moves every clip with it.',
      'The drums are built from parts: the kick is a sine sweep, snare and hats are filtered '
        + 'noise through envelopes. There is no drum kit node.',
      'Velocity is not represented: every note plays at its track\'s level, so the drums have '
        + 'no accents.',
      'Automation opens the bass filter and speeds up the lead LFO in the build, and fades the '
        + 'mix in the outro.',
    ],
  },
  studioHash: '6af3c386ab88fe2c98d1a11a65d2f537fafbb3cd49b4aed7ca0a234e733405b6',
  model: {
    kind: 'oscilla-studio',
    schemaVersion: 1,
    graph: { nodes, edges },
    timeline: { tracks, clips, automation, markers },
    transport: { timeMode: 'musical', tempo: S.TEMPO_BPM, timeSignature: [4, 4] },
    metadata: { title: DEMO_SONG_TITLE, notes: 'An original song written for OSCILLA. The score '
      + 'is src/js/studio/templates/demo-song-score.js.' },
  },
};
