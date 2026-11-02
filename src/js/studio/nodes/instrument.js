// Studio node types of the Synth panel (plan K059, K060; design synth-design.md §1, §4): Keys
// (the note source the keyboard, MIDI and the panel's gate fan-out drive), VCO (an oscillator
// whose pitch is a linear octave input, so a keyboard tracks it exactly) and Ring (ring and
// amplitude modulation of two audio signals). New types only: no existing definition changes,
// so every pinned template hash and saved studioHash stays as it is (design D2).
//
// Pitch is "requested digital frequency" (project.no-fake-science): a VCO's pitch and FM inputs
// add in octaves (1.00 oct per unit, exact in the digital domain) and the sum is clipped so the
// frequency never exceeds 0.95 × Nyquist of the running context (adapters/instrument.js).

import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, defineNode, enumParam, integerParam, numberParam, optionLabel, parts, secondsParam,
  secs,
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
  ],
  summary(p) {
    return parts(optionLabel(keys, 'priority', p.priority),
      p.glide > 0 ? `glide ${secs(p.glide)}` : null,
      p.transpose ? `${p.transpose > 0 ? '+' : ''}${p.transpose} st` : null);
  },
  capabilities: { realtime: true, offline: true, notes: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'The note source of a monophonic voice: the on-screen and computer keyboard and MIDI '
      + 'notes play it while the Synth is armed.',
    inputs: 'None: notes arrive from the keyboard, MIDI or the Synth workspace.',
    outputs: 'Pitch, in octaves from A4 (−6 to 6, 1.00 oct per octave of the note, exact in '
      + 'the digital domain); Gate, a trigger at every new top note and a release when the '
      + 'last key lifts; Velocity, 0 to 1.',
    constraints: 'One note at a time (last, lowest or highest held key). Glide moves the pitch '
      + 'with a time constant of Glide / 3, so after Glide less than a twentieth of the step '
      + 'remains. A released top note returns to the note still held without a new gate.',
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

export default [keys, vco, ring];
