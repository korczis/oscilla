// Studio MODULATION node types (spec §29): LFO, Envelope, Random, Step Modulator.
// Defaults: LFO rate 5 Hz sine (DEFAULT_PATTERN_PARAMS.wobble, audio/patterns.js; buildLfo in
// audio/modulation.js), ADSR a 0.01 / d 0.1 / s 0.7 / r 0.2 s (DEFAULT_ADSR, audio/envelope.js),
// Random 5 Hz (one value per 150 ms tone + 50 ms gap of DEFAULT_PATTERN_PARAMS.random) with its
// seed 20261001, Step Modulator 4 Hz (one step per 250 ms tone of
// DEFAULT_PATTERN_PARAMS.alternating). Control outputs are normalized −1..1 (bipolar); the
// depth, polarity and mapping onto a parameter belong to the modulation edge (§35).

import { WAVEFORMS, WAVEFORM_LABELS } from '../../core/constants.js';
import { DEFAULT_ADSR, MIN_SEGMENT_S } from '../../audio/envelope.js';
import { DEFAULT_PATTERN_PARAMS } from '../../audio/patterns.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, boolParam, defineNode, enumParam, integerParam, listParam, numberParam,
  optionLabel, parts, secondsParam, secs, num,
} from './common.js';

const controlOut = definePort({ id: 'control', direction: 'out', type: 'CONTROL',
  label: 'Control' });
const rate = (def, modDepth) => numberParam('rate', 'Rate', {
  min: 0.01, max: 100, unit: 'Hz', scale: 'log', default: def, automatable: true,
  modulatable: true, modDepth,
});
const randomPeriodS = (DEFAULT_PATTERN_PARAMS.random.toneMs + DEFAULT_PATTERN_PARAMS.random.gapMs)
  / 1000;

export const lfo = defineNode({
  type: 'lfo',
  displayName: 'LFO',
  idPrefix: 'lfo',
  category: CATEGORIES.MODULATION,
  aliases: ['low frequency oscillator', 'modulator', 'wobble', 'vibrato', 'tremolo'],
  outputs: [controlOut],
  params: [
    enumParam('shape', 'Shape', WAVEFORMS.map((w) => [w, WAVEFORM_LABELS[w]]), 'sine'),
    rate(DEFAULT_PATTERN_PARAMS.wobble.rate, 1),
  ],
  summary(p) {
    return parts(optionLabel(lfo, 'shape', p.shape), `${num(p.rate)} Hz`);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/modulation.js#buildLfo',
  help: {
    what: 'A low-frequency oscillator that modulates parameters.',
    inputs: 'Rate accepts modulation from another modulator.',
    outputs: 'Control, −1 to 1; the connection sets depth and polarity.',
    constraints: 'A modulation path may not lead back to its own source.',
  },
});

export const envelope = defineNode({
  type: 'envelope',
  displayName: 'Envelope',
  idPrefix: 'env',
  category: CATEGORIES.MODULATION,
  aliases: ['adsr', 'eg', 'contour', 'vca', 'amplitude envelope'],
  inputs: [
    definePort({ id: 'audio', direction: 'in', type: 'AUDIO', label: 'Audio' }),
    definePort({ id: 'gate', direction: 'in', type: 'TRIGGER', label: 'Gate' }),
  ],
  outputs: [
    definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' }),
    controlOut,
  ],
  params: [
    secondsParam('attack', 'Attack', DEFAULT_ADSR.a, MIN_SEGMENT_S, 10),
    secondsParam('decay', 'Decay', DEFAULT_ADSR.d, MIN_SEGMENT_S, 10),
    numberParam('sustain', 'Sustain', { min: 0, max: 1, step: 0.01, default: DEFAULT_ADSR.s }),
    secondsParam('release', 'Release', DEFAULT_ADSR.r, MIN_SEGMENT_S, 10),
  ],
  summary(p) {
    return parts(`A ${secs(p.attack)}`, `D ${secs(p.decay)}`, `S ${num(p.sustain, 2)}`,
      `R ${secs(p.release)}`);
  },
  clipKinds: ['event'],
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/envelope.js#applyAdsr',
  reuses: ['audio/envelope.js#releaseAt', 'audio/voice.js#makeAdsrEnvelope'],
  help: {
    what: 'An ADSR envelope applied to the audio passing through it.',
    inputs: 'Audio, and a gate trigger (or the timeline events of its track).',
    outputs: 'The enveloped audio, and the envelope contour as control.',
    constraints: 'Segments are at least 1 ms; ramps never reach exactly zero.',
  },
});

export const random = defineNode({
  type: 'random',
  displayName: 'Random',
  idPrefix: 'rnd',
  category: CATEGORIES.MODULATION,
  aliases: ['sample and hold', 's&h', 'noise modulator', 'random modulator'],
  inputs: [definePort({ id: 'trigger', direction: 'in', type: 'TRIGGER', label: 'Clock' })],
  outputs: [controlOut],
  params: [
    rate(Number((1 / randomPeriodS).toPrecision(6)), 1),
    integerParam('seed', 'Seed', { min: 0, max: 2 ** 31 - 1,
      default: DEFAULT_PATTERN_PARAMS.random.seed }),
    boolParam('smooth', 'Smooth', false),
  ],
  summary(p) {
    return parts(`${num(p.rate)} Hz`, p.smooth ? 'smooth' : 'stepped', `seed ${p.seed}`);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/noise.js#mulberry32',
  help: {
    what: 'Seeded random values, a new one per period or per clock trigger.',
    inputs: 'An optional clock trigger; rate accepts modulation.',
    outputs: 'Control, −1 to 1.',
    constraints: 'The same seed gives the same sequence (deterministic).',
  },
});

export const stepModulator = defineNode({
  type: 'step-modulator',
  displayName: 'Step Modulator',
  idPrefix: 'steps',
  category: CATEGORIES.MODULATION,
  aliases: ['step sequencer', 'steps', 'stepped modulation', 'cv sequencer'],
  inputs: [definePort({ id: 'clock', direction: 'in', type: 'TRIGGER', label: 'Clock' })],
  outputs: [controlOut],
  params: [
    listParam('steps', 'Steps', {
      min: -1, max: 1, minLength: 1, maxLength: 32,
      default: [1, 0.5, 0, -0.5, -1, -0.5, 0, 0.5],
    }),
    rate(1000 / DEFAULT_PATTERN_PARAMS.alternating.toneMs, 1),
    enumParam('playback', 'Playback', [['loop', 'Loop'], ['once', 'Once']], 'loop'),
  ],
  summary(p) {
    return parts(`${p.steps.length} steps`, `${num(p.rate)} Hz`, p.playback);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/scheduler.js#scheduleSteps',
  help: {
    what: 'Steps through a list of values, one per period or per clock trigger.',
    inputs: 'An optional clock trigger; rate accepts modulation.',
    outputs: 'Control, −1 to 1.',
    constraints: '1-32 steps.',
  },
});

export default [lfo, envelope, random, stepModulator];
