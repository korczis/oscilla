// Studio MODULATION node types (spec §29): LFO, Envelope, Random, Step Modulator, Macro.
// Defaults: LFO rate 5 Hz sine (DEFAULT_PATTERN_PARAMS.wobble, audio/patterns.js; buildLfo in
// audio/modulation.js), ADSR a 0.01 / d 0.1 / s 0.7 / r 0.2 s (DEFAULT_ADSR, audio/envelope.js),
// Random 5 Hz (one value per 150 ms tone + 50 ms gap of DEFAULT_PATTERN_PARAMS.random) with its
// seed 20261001, Step Modulator 4 Hz (one step per 250 ms tone of
// DEFAULT_PATTERN_PARAMS.alternating). Control outputs are normalized −1..1 (bipolar); the
// depth, polarity and mapping onto a parameter belong to the modulation edge (§35).
// K010: the LFO rate reaches audio rate (FM, AM and ring modulation): the model accepts up to
// FREQUENCY_MAX_HZ, as a frequency parameter does, and the compiler and the adapter clamp it to
// 0.95 × Nyquist of the running context (reported in the runtime's limitedParams). A wider
// range changes no saved studioHash. Random and Step Modulator keep their 100 Hz.
// K013: the Macro is one control value 0..1 (unipolar), automatable and modulatable, for driving
// several parameters from one place; each edge sets its own depth and polarity. Its output is
// clipped to 0..1 (adapters/modulation.js), so a modulated value never leaves the range its
// edges are sized from.

import { SAFE_NYQUIST_FACTOR_TEXT, WAVEFORMS, WAVEFORM_LABELS } from '../../core/constants.js';
import { DEFAULT_ADSR, MIN_SEGMENT_S } from '../../audio/envelope.js';
import { DEFAULT_PATTERN_PARAMS } from '../../audio/patterns.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, FREQUENCY_MAX_HZ, TEMPO_DIVISIONS, boolParam, defineNode, enumParam,
  integerParam, listParam, numberParam, optionLabel, parts, pct, secondsParam, secs, num,
  syncParam,
} from './common.js';

const controlOut = definePort({ id: 'control', direction: 'out', type: 'CONTROL',
  label: 'Control' });
/**
 * A TRIGGER output (K023: the Clock's, the Step Modulator's): logical, one event per trigger
 * that the transport schedules on the audio clock; no audio node carries it.
 */
const triggerOut = () => definePort({ id: 'trigger', direction: 'out', type: 'TRIGGER',
  label: 'Trigger', channels: 1, rate: 'event', monitor: false, compact: false, version: 1 });
const rate = (def, modDepth, opts = {}) => numberParam('rate', 'Rate', {
  min: 0.01, max: 100, unit: 'Hz', scale: 'log', default: def, automatable: true,
  modulatable: true, modDepth, ...opts,
});
/**
 * The Inspector slider's range for the LFO rate: the four decades of slow modulation it had
 * before K010, so the slider keeps its resolution there; an audio rate (FM, AM) is typed. An
 * automation lane spans the whole range instead (laneRange; automation.js caps it at 0.95 ×
 * Nyquist of the running context), so an audio rate can be drawn there (review of #267, R-5).
 */
export const LFO_SLIDER_RANGE = Object.freeze([0.01, 100]);
const randomPeriodS = (DEFAULT_PATTERN_PARAMS.random.toneMs + DEFAULT_PATTERN_PARAMS.random.gapMs)
  / 1000;

export const lfo = defineNode({
  type: 'lfo',
  displayName: 'LFO',
  idPrefix: 'lfo',
  category: CATEGORIES.MODULATION,
  aliases: ['low frequency oscillator', 'modulator', 'wobble', 'vibrato', 'tremolo', 'fm',
    'am', 'ring modulator'],
  outputs: [controlOut],
  params: [
    enumParam('shape', 'Shape', WAVEFORMS.map((w) => [w, WAVEFORM_LABELS[w]]), 'sine'),
    rate(DEFAULT_PATTERN_PARAMS.wobble.rate, 1, { max: FREQUENCY_MAX_HZ,
      softRange: LFO_SLIDER_RANGE, laneRange: [0.01, FREQUENCY_MAX_HZ] }),
    // K022 (hash epoch 2): the output's depth, and tempo sync.
    numberParam('depth', 'Depth', { min: 0, max: 1, step: 0.01, default: 1, automatable: true,
      modulatable: true, modDepth: 0.5, live: 'glide',
      // Its CONTROL input: one AudioParam (a gain), a-rate; uncabled, the depth itself holds.
      port: { channels: 1, rate: 'a-rate', unconnected: 'parameter value', monitor: false,
        compact: false, version: 1 } }),
    syncParam(),
  ],
  summary(p) {
    return parts(optionLabel(lfo, 'shape', p.shape),
      p.sync && p.sync !== 'off' ? p.sync : `${num(p.rate)} Hz`, p.depth < 1 ? pct(p.depth) : null);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/modulation.js#buildLfo',
  help: {
    what: 'A modulation oscillator, from slow sweeps to audio rate (FM, AM). The rate slider '
      + `spans ${LFO_SLIDER_RANGE[0]}-${LFO_SLIDER_RANGE[1]} Hz; an audio rate is typed.`,
    inputs: 'Rate accepts modulation from another modulator.',
    outputs: 'Control, −1 to 1; the connection sets depth and polarity.',
    constraints: 'A modulation path may not lead back to its own source. Rate is limited to '
      + `${SAFE_NYQUIST_FACTOR_TEXT} × the digital Nyquist limit of the running audio context.`,
  },
});

export const envelope = defineNode({
  type: 'envelope',
  displayName: 'Envelope',
  idPrefix: 'env',
  category: CATEGORIES.MODULATION,
  aliases: ['adsr', 'eg', 'contour', 'vca envelope', 'amplitude envelope'],
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
    // K230 (hash epoch 3): a delay before the attack and a hold at the peak; 0 is today's ADSR.
    secondsParam('delay', 'Zpoždění', 0, 0, 10, { live: 'next-gate' }),
    secondsParam('hold', 'Výdrž', 0, 0, 10, { live: 'next-gate' }),
  ],
  summary(p) {
    return parts(p.delay > 0 ? `Zp ${secs(p.delay)}` : null, `A ${secs(p.attack)}`,
      p.hold > 0 ? `V ${secs(p.hold)}` : null, `D ${secs(p.decay)}`, `S ${num(p.sustain, 2)}`,
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
  clipKinds: ['event'], // K023: a trigger event clip clocks it, as a trigger edge does
  params: [
    rate(Number((1 / randomPeriodS).toPrecision(6)), 1),
    integerParam('seed', 'Seed', { min: 0, max: 2 ** 31 - 1,
      default: DEFAULT_PATTERN_PARAMS.random.seed }),
    boolParam('smooth', 'Smooth', false),
    syncParam(), // K022
  ],
  summary(p) {
    return parts(p.sync && p.sync !== 'off' ? p.sync : `${num(p.rate)} Hz`,
      p.smooth ? 'smooth' : 'stepped', `seed ${p.seed}`);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/noise.js#mulberry32',
  help: {
    what: 'Seeded random values, a new one per period or per clock trigger.',
    inputs: 'An optional clock trigger, counted from PLAY: the first value holds from PLAY, '
      + 'the first trigger plays it (no change when that trigger comes later) and each '
      + 'further trigger the next value; rate has no effect. Without it, rate accepts '
      + 'modulation.',
    outputs: 'Control, −1 to 1.',
    constraints: 'The same seed gives the same sequence (deterministic); Smooth applies '
      + 'without a clock.',
  },
});

export const stepModulator = defineNode({
  type: 'step-modulator',
  displayName: 'Step Modulator',
  idPrefix: 'steps',
  category: CATEGORIES.MODULATION,
  aliases: ['step sequencer', 'steps', 'stepped modulation', 'cv sequencer'],
  inputs: [definePort({ id: 'clock', direction: 'in', type: 'TRIGGER', label: 'Clock' })],
  // K023: Trigger fires on each step the clocked Step Modulator takes (none after the last step
  // of a 'once' run), so a step can gate an Envelope or clock another node.
  outputs: [controlOut, triggerOut()],
  clipKinds: ['event'], // K023: a trigger event clip clocks it, as a trigger edge does
  params: [
    listParam('steps', 'Steps', {
      min: -1, max: 1, minLength: 1, maxLength: 32,
      default: [1, 0.5, 0, -0.5, -1, -0.5, 0, 0.5],
    }),
    rate(1000 / DEFAULT_PATTERN_PARAMS.alternating.toneMs, 1),
    enumParam('playback', 'Playback', [['loop', 'Loop'], ['once', 'Once']], 'loop'),
    // K022: tempo sync, and each step rounded to a twelfth (a semitone under a pitch edge that
    // maps 1 to one octave, as the Keys pitch cable does).
    syncParam(),
    enumParam('quantize', 'Quantize', [['off', 'Off'], ['semitone', 'Semitone']], 'off',
      { live: 'crossfade' }),
  ],
  summary(p) {
    return parts(`${p.steps.length} steps`,
      p.sync && p.sync !== 'off' ? p.sync : `${num(p.rate)} Hz`, p.playback,
      p.quantize === 'semitone' ? 'semitones' : null);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/scheduler.js#scheduleSteps',
  help: {
    what: 'Steps through a list of values, one per period or per clock trigger.',
    inputs: 'An optional clock trigger, counted from PLAY: the first step holds from PLAY, '
      + 'the first trigger plays it (no change when that trigger comes later) and each '
      + 'further trigger the next step; rate has no effect. Without it, rate accepts '
      + 'modulation.',
    outputs: 'Control, −1 to 1.',
    constraints: '1-32 steps.',
  },
});

/** The Clock's default division: quarter notes, one trigger per beat of a 4/4 bar. */
export const CLOCK_DEFAULT_DIVISION = '1/4';
/** The gate a Clock trigger holds on an Envelope: this fraction of its period (a square). */
export const CLOCK_GATE_FRACTION = 0.5;

export const clock = defineNode({
  type: 'clock',
  displayName: 'Clock',
  idPrefix: 'clock',
  category: CATEGORIES.MODULATION,
  aliases: ['clock', 'metronome', 'pulse', 'tempo clock', 'trigger', 'hodiny', 'takt'],
  outputs: [triggerOut()],
  params: [
    // A change re-plans the ticks after the edit horizon: it applies from the next tick.
    enumParam('division', 'Dělení', TEMPO_DIVISIONS.map((d) => [d, d]), CLOCK_DEFAULT_DIVISION,
      { live: 'next-gate' }),
  ],
  summary(p) {
    return p.division;
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'studio/timeline-compiler.js#compilePass',
  help: {
    what: 'Spouští TRIGGER v dělení tempa transportu (1/1 až 1/32), na zvukových hodinách, '
      + 'dokud transport hraje časovou osu.',
    inputs: 'Žádné; tempo bere z transportu.',
    outputs: 'Trigger: hradlo obálky na polovinu periody, takt pro Random a Step Modulator.',
    constraints: 'Takty leží na mřížce dělení od začátku časové osy a ve smyčce se '
      + 'opakují.',
  },
});

export const macro = defineNode({
  type: 'macro',
  displayName: 'Macro',
  idPrefix: 'macro',
  category: CATEGORIES.MODULATION,
  aliases: ['macro control', 'knob', 'performance control', 'constant', 'offset', 'cv',
    'control voltage'],
  outputs: [controlOut],
  params: [
    numberParam('value', 'Value', { min: 0, max: 1, step: 0.01, default: 0.5,
      automatable: true, modulatable: true, modDepth: 0.25 }),
  ],
  summary(p) {
    return pct(p.value);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'One control value, 0 to 1, that drives several parameters from one place.',
    inputs: 'Value accepts modulation and an automation lane.',
    outputs: 'Control, 0 to 1, held there when modulation moves the value beyond it; each '
      + 'connection sets its own depth and polarity (unipolar: 0 to depth; bipolar: −depth to '
      + '+depth).',
    constraints: 'Needs ConstantSourceNode. A modulation path may not lead back to its own '
      + 'source.',
  },
});

export default [lfo, envelope, random, stepModulator, macro, clock];
