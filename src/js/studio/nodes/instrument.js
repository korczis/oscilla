// Studio node types of the Synth panel (plan K059, K060; design synth-design.md §1, §4): Keys
// (the note source the keyboard, MIDI and the panel's gate fan-out drive), VCO (an oscillator
// whose pitch is a linear octave input, so a keyboard tracks it exactly) and Ring (ring and
// amplitude modulation of two audio signals), the XY Pad (plan K097: X, Y and a pitch
// quantised to a scale of core/music.js, gated while touched) and Contour (plan K207: a
// gate-driven attack, hold and release control, 0 to 1, with invert; adapters/instrument.js
// schedules it with audio/envelope.js). K060 added Key low and Key high
// to Keys: a saved document holding a Keys node takes their defaults on load, so its
// studioHash changes once (a hash epoch for documents with Keys; no pinned template holds one).
//
// Pitch is "requested digital frequency" (project.no-fake-science): a VCO's pitch and FM inputs
// add in octaves (1.00 oct per unit, exact in the digital domain) and the sum is clipped so the
// frequency never exceeds 0.95 × Nyquist of the running context (adapters/instrument.js).

import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';
import { NOTE_NAMES, SCALE_LABELS, SCALE_MODES, midiToName, scaleNote } from '../../core/music.js';
import { definePort } from '../ports.js';
import { MIN_SEGMENT_S } from '../../audio/envelope.js';
import {
  CATEGORIES, boolParam, defineNode, enumParam, integerParam, numberParam, optionLabel, parts,
  secondsParam, secs,
} from './common.js';

/** The Keys pitch output: octaves from A4, the range its edges are sized from. */
export const KEYS_PITCH_RANGE = Object.freeze([-6, 6]);
/** VCO scale options: footage → octaves against A4 at 8'. */
export const VCO_SCALES = Object.freeze({ 32: -2, 16: -1, 8: 0, 4: 1 });
export const VCO_WAVES = Object.freeze(['triangle', 'sawtooth', 'square', 'pulse', 'sine']);
const WAVE_LABELS = { triangle: 'Triangle', sawtooth: 'Saw', square: 'Square', pulse: 'Pulse',
  sine: 'Sine' };

const audioOut = definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' });
const octaves = (key, label, opts = {}) => numberParam(key, label, { min: -10, max: 10,
  step: 0.01, unit: 'oct', default: 0, modulatable: true, modDepth: 1, softRange: [-2, 2],
  ...opts });

export const keys = defineNode({
  type: 'keys',
  displayName: 'Keys',
  idPrefix: 'keys',
  category: CATEGORIES.MODULATION,
  aliases: ['keyboard', 'notes', 'note source', 'pitch cv', 'gate', 'midi keys', 'piano'],
  outputs: [
    definePort({ id: 'pitch', direction: 'out', type: 'CONTROL', label: 'Pitch' }),
    definePort({ id: 'gate', direction: 'out', type: 'TRIGGER', label: 'Gate' }),
    definePort({ id: 'velocity', direction: 'out', type: 'CONTROL', label: 'Velocity' }),
  ],
  params: [
    secondsParam('glide', 'Glide', 0, 0, 2, { step: 0.01 }),
    integerParam('transpose', 'Transpose', { min: -24, max: 24, unit: 'st', default: 0 }),
    enumParam('priority', 'Priority', [['last', 'Last'], ['low', 'Low'], ['high', 'High']],
      'last'),
    // live: an edit applies from the next note (the adapter's update reports 'next-note').
    integerParam('keyLow', 'Key low', { min: 0, max: 127, default: 0, live: 'next-note' }),
    integerParam('keyHigh', 'Key high', { min: 0, max: 127, default: 127, live: 'next-note' }),
  ],
  clipKinds: ['event'],
  summary(p) {
    const lo = Math.min(p.keyLow, p.keyHigh);
    const hi = Math.max(p.keyLow, p.keyHigh);
    const full = lo === 0 && hi === 127;
    return parts(optionLabel(keys, 'priority', p.priority),
      p.glide > 0 ? `glide ${secs(p.glide)}` : null,
      p.transpose ? `${p.transpose > 0 ? '+' : ''}${p.transpose} st` : null,
      full ? null : `keys ${midiToName(lo)}-${midiToName(hi)}`,
      `clamp ${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist`);
  },
  capabilities: { realtime: true, offline: true, notes: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'Zdroj not monofonního hlasu: hraje ho klávesnice na obrazovce, klávesnice počítače '
      + 'a noty MIDI, když je Synth připravený ke hře, a klip událostí na něm spouští obálky, '
      + 'kam vede jeho Gate.',
    inputs: 'Žádné: noty přicházejí z klávesnice, z MIDI nebo z pracovní plochy Synth.',
    outputs: 'Pitch v oktávách od A4 (−6 až 6, 1,00 okt. na oktávu noty, v digitální doméně '
      + 'přesně); Gate, spouštěč při každé nové nejvyšší notě a uvolnění, když se zvedne '
      + 'poslední klávesa; Velocity, 0 až 1.',
    constraints: 'Jedna nota najednou (poslední, nejnižší nebo nejvyšší držená klávesa). Glide '
      + 'je lineární v přesném čase: výška dorazí k nové notě přesně za dobu Glide. Uvolněná '
      + 'nejvyšší nota se vrátí k notě stále držené bez nové brány. Noty mimo 0 až 127 nebo '
      + 'mimo Key low až Key high se odmítnou s důvodem. Výška hraná z něj se omezí na '
      + `${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist běžícího zvukového kontextu a každá nota pod `
      + 'hranicí ladí přesně.',
  },
});

export const vco = defineNode({
  type: 'vco',
  displayName: 'VCO',
  idPrefix: 'vco',
  category: CATEGORIES.SOURCES,
  aliases: ['voltage controlled oscillator', 'oscillator', 'pulse', 'saw', 'keyboard tracking',
    'pitch input'],
  outputs: [audioOut],
  params: [
    enumParam('waveform', 'Wave', VCO_WAVES.map((w) => [w, WAVE_LABELS[w]]), 'sawtooth'),
    numberParam('width', 'Pulse width', { min: 5, max: 95, step: 1, unit: '%', default: 50 }),
    enumParam('scale', 'Scale', Object.keys(VCO_SCALES).sort((a, b) => b - a)
      .map((f) => [f, `${f}'`]), '8'),
    numberParam('tune', 'Tune', { min: -1200, max: 1200, step: 1, unit: 'cents', default: 0,
      modulatable: true, modDepth: 100 }),
    octaves('pitch', 'Pitch'),
    octaves('fm', 'FM'),
  ],
  summary(p) {
    return parts(optionLabel(vco, 'waveform', p.waveform), `${p.scale}'`,
      p.waveform === 'pulse' ? `${p.width} %` : null,
      p.tune ? `${p.tune > 0 ? '+' : ''}${p.tune} ct` : null);
  },
  sounding: true,
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  reuses: ['audio/additive.js#pulseSeries', 'audio/additive.js#buildPeriodicWave'],
  help: {
    what: "An oscillator at A4 × 2^octave of its scale (8' = 440 Hz), driven by a pitch input "
      + 'in octaves, so a Keys pitch tracks it exactly.',
    inputs: 'Pitch and FM add in octaves (linear, 1.00 oct per unit); Tune adds cents.',
    outputs: 'Audio.',
    constraints: 'Pulse width is set, not modulated, in this oscillator. The sum of pitch, FM '
      + `and tune is clipped so the frequency stays at or below ${SAFE_NYQUIST_FACTOR_TEXT} × `
      + 'the digital Nyquist limit of the running audio context.',
  },
});

export const ring = defineNode({
  type: 'ring',
  displayName: 'Ring',
  idPrefix: 'ring',
  category: CATEGORIES.PROCESSING,
  aliases: ['ring modulator', 'ring mod', 'am', 'amplitude modulation', 'multiplier'],
  inputs: [
    definePort({ id: 'carrier', direction: 'in', type: 'AUDIO', label: 'Carrier' }),
    definePort({ id: 'modulator', direction: 'in', type: 'AUDIO', label: 'Modulator' }),
  ],
  outputs: [audioOut],
  params: [
    enumParam('mode', 'Mode', [['ring', 'Ring'], ['am', 'AM']], 'ring'),
    numberParam('depth', 'Depth', { min: 0, max: 1, step: 0.01, default: 1 }),
  ],
  summary(p) {
    return parts(optionLabel(ring, 'mode', p.mode), p.mode === 'am' ? `depth ${p.depth}` : null);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'Multiplies two audio signals: ring c·m (sum and difference frequencies, the carrier '
      + 'suppressed), or AM c·(1 − d/2 + d/2·m) (the carrier kept, sidebands at d/2).',
    inputs: 'Carrier and modulator audio.',
    outputs: 'Audio.',
    constraints: 'Digital multiplication: the levels are relative. Depth applies to AM only.',
  },
});

/**
 * The XY pad's pitch under x (0..1, plan K097): the span's scale steps (and the top key) in
 * equal cells, low to high -> { index, steps, degree, note, name, pitch (octaves from A4) }.
 */
export function xyDegree(x, p) {
  const steps = p.span * (SCALE_MODES[p.mode] || SCALE_MODES.major).length + 1;
  const index = Math.min(steps - 1, Math.max(0, Math.floor((Number(x) || 0) * steps)));
  const s = scaleNote(index, p);
  const [lo, hi] = KEYS_PITCH_RANGE;
  return { index, steps, degree: s.degree, note: s.note, name: midiToName(s.note),
    pitch: Math.min(hi, Math.max(lo, (s.note - 69) / 12)) };
}

export const xyPad = defineNode({
  type: 'xy-pad',
  displayName: 'XY Pad',
  idPrefix: 'xypad',
  category: CATEGORIES.MODULATION,
  aliases: ['xy', 'performance pad', 'touch pad', 'scale', 'quantiser', 'quantizer', 'x y'],
  outputs: [
    definePort({ id: 'x', direction: 'out', type: 'CONTROL', label: 'X' }),
    definePort({ id: 'y', direction: 'out', type: 'CONTROL', label: 'Y' }),
    definePort({ id: 'pitch', direction: 'out', type: 'CONTROL', label: 'Pitch' }),
    definePort({ id: 'gate', direction: 'out', type: 'TRIGGER', label: 'Gate' }),
  ],
  params: [
    enumParam('mode', 'Scale', Object.keys(SCALE_MODES).map((m) => [m, SCALE_LABELS[m]]),
      'minor-pentatonic'),
    enumParam('key', 'Key', NOTE_NAMES.map((n) => [n, n]), 'C'),
    integerParam('octave', 'Octave', { min: 1, max: 5, default: 3 }),
    integerParam('span', 'Span', { min: 1, max: 4, unit: 'oct', default: 2 }),
    secondsParam('glide', 'Glide', 0, 0, 2, { step: 0.01 }),
    // The outputs' value at rest (K231): a lane on them replays a recorded take of the pad, a
    // touch overrides it while held. Elided at 0, so documents without a take are unchanged.
    numberParam('x', 'X', { min: 0, max: 1, step: 0.01, default: 0, automatable: true,
      live: 'glide', elide: true }),
    numberParam('y', 'Y', { min: 0, max: 1, step: 0.01, default: 0, automatable: true,
      live: 'glide', elide: true }),
  ],
  summary(p) {
    return parts(`${p.key} ${optionLabel(xyPad, 'mode', p.mode)}`, `${p.span} oct from ${p.key}`
      + `${p.octave}`, p.glide > 0 ? `glide ${secs(p.glide)}` : null);
  },
  capabilities: { realtime: true, offline: true, notes: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'A two-axis performance surface: X picks a step of the scale, Y is a free control, '
      + 'and the gate is open while the pad is touched.',
    inputs: 'None: the Synth workspace XY tab plays it while the Synth is armed.',
    outputs: 'X and Y, 0 to 1; Pitch, in octaves from A4, the scale step under X (equal-'
      + 'tempered, 1.00 oct per octave); Gate, opened at a touch and released when it ends.',
    constraints: 'X is quantised to the steps of the scale over Span octaves from the key in '
      + 'Octave; the top key closes the span. Glide moves the pitch between steps of one touch '
      + 'with a time constant of Glide / 3.',
  },
});

export const contour = defineNode({
  type: 'contour',
  displayName: 'Contour',
  idPrefix: 'contour',
  category: CATEGORIES.MODULATION,
  aliases: ['ahr', 'ar', 'gate contour', 'obrys', 'řídicí obálka', 'náběh držení doznění'],
  inputs: [definePort({ id: 'gate', direction: 'in', type: 'TRIGGER', label: 'Brána',
    channels: 1, rate: 'event', unconnected: 'brána otevřená od startu grafu', monitor: false,
    compact: false, version: 1 })],
  outputs: [definePort({ id: 'control', direction: 'out', type: 'CONTROL', label: 'Řízení',
    channels: 1, rate: 'a-rate', monitor: false, compact: false, version: 1 })],
  params: [
    secondsParam('attack', 'Náběh', 0.01, MIN_SEGMENT_S, 10, { live: 'next-gate' }),
    secondsParam('hold', 'Držení', 0, 0, 10, { live: 'next-gate' }),
    secondsParam('release', 'Doznění', 0.3, MIN_SEGMENT_S, 10, { live: 'next-gate' }),
    // structural: the adapter rebuilds the node (crossfaded), never a step on a running output
    boolParam('invert', 'Obrátit', false, { live: 'crossfade' }),
  ],
  summary(p) {
    return parts(`A ${secs(p.attack)}`, p.hold > 0 ? `H ${secs(p.hold)}` : null,
      `R ${secs(p.release)}`, p.invert ? 'obráceně' : null);
  },
  clipKinds: ['event'],
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/envelope.js#applyAdsr',
  reuses: ['audio/envelope.js#releaseAt'],
  help: {
    what: 'Řídicí obrys spouštěný bránou: po otevření brány stoupne lineárně za dobu Náběh '
      + 'k 1, drží se, a po zavření brány klesne za dobu Doznění k dolní mezi obálky.',
    inputs: 'Brána, spouštěč (brána uzlu Keys nebo XY Pad, klip událostí jeho stopy).',
    outputs: 'Řízení, 0 až 1; s volbou Obrátit 1 minus obrys.',
    constraints: 'Doznění začne se zavřením brány, nejdřív ale po uplynutí Náběhu a Držení, '
      + 'takže i krátký ťuk dojde k 1 a vydrží Držení. Náběh a Doznění trvají aspoň 1 ms; '
      + 'uvolnění končí na dolní mezi obálky (−80 dB), ne přesně v nule. Hodnoty se počítají '
      + 'v digitální doméně a jsou relativní.',
  },
});

export default [keys, vco, ring, xyPad, contour];
