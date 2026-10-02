// Studio SOURCES node types (spec §29): Oscillator, Noise, Sweep, Sequence, Microphone.
// Defaults are the existing engine defaults: instrument state (core/config.js) 440 Hz sine,
// DEFAULT_SWEEP 20 Hz → 20 kHz, 10 s, log (audio/patterns.js), createNoiseSource white, seed 1,
// level 1 (audio/noise.js), the sequencer's sine voice (sequencer/model.js). Source levels are
// relative digital levels into the graph; the Master Output's logical gain (DEFAULT_GAIN) and the
// engine's safe output chain sit after them (§186).

import { WAVEFORMS, WAVEFORM_LABELS } from '../../core/constants.js';
import { DEFAULT_SWEEP } from '../../audio/patterns.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, defineNode, enumParam, frequencyParam, hz, integerParam, levelParam, numberParam,
  optionLabel, parts, pct, secondsParam,
} from './common.js';

const WAVE_OPTIONS = WAVEFORMS.map((w) => [w, WAVEFORM_LABELS[w]]);
const audioOut = definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' });

export const oscillator = defineNode({
  type: 'oscillator',
  displayName: 'Oscillator',
  idPrefix: 'osc',
  category: CATEGORIES.SOURCES,
  aliases: ['osc', 'vco', 'tone', 'sine', 'square', 'saw', 'triangle', 'generator'],
  outputs: [audioOut],
  params: [
    enumParam('waveform', 'Waveform', WAVE_OPTIONS, 'sine'),
    frequencyParam('frequency', 'Frequency', 440, {
      automatable: true, modulatable: true, modDepth: 40,
    }),
    numberParam('detune', 'Detune', {
      min: -1200, max: 1200, step: 1, unit: 'cents', default: 0, automatable: true,
      modulatable: true, modDepth: 100,
    }),
    levelParam('level', 'Level', 1, { automatable: true, modulatable: true, modDepth: 0.5 }),
  ],
  summary(p) {
    return parts(optionLabel(oscillator, 'waveform', p.waveform), hz(p.frequency),
      p.detune ? `${p.detune > 0 ? '+' : ''}${p.detune} ct` : null);
  },
  clipKinds: ['pattern', 'event'],
  sounding: true,
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  reuses: ['audio/additive.js#createAdditiveOscillator', 'audio/patterns.js#buildPlan'],
  help: {
    what: 'A periodic tone at a requested digital frequency.',
    inputs: 'Frequency, detune and level accept modulation.',
    outputs: 'Audio.',
    constraints: 'Frequencies are limited to 0.95 × the digital Nyquist limit of the running '
      + 'audio context.',
  },
});

export const noise = defineNode({
  type: 'noise',
  displayName: 'Noise',
  idPrefix: 'noise',
  category: CATEGORIES.SOURCES,
  aliases: ['white noise', 'pink noise', 'random signal', 'hiss'],
  outputs: [audioOut],
  params: [
    enumParam('color', 'Colour', [['white', 'White'], ['pink', 'Pink']], 'white'),
    levelParam('level', 'Level', 1, { automatable: true, modulatable: true, modDepth: 0.5 }),
    integerParam('seed', 'Seed', { min: 0, max: 2 ** 32 - 1, default: 1 }),
  ],
  summary(p) {
    return parts(optionLabel(noise, 'color', p.color), pct(p.level));
  },
  clipKinds: ['event'],
  sounding: true,
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/noise.js#createNoiseSource',
  help: {
    what: 'Deterministic white or pink noise from a seeded generator.',
    inputs: 'Level accepts modulation.',
    outputs: 'Audio.',
    constraints: 'The same seed produces the same noise.',
  },
});

export const sweep = defineNode({
  type: 'sweep',
  displayName: 'Sweep',
  idPrefix: 'sweep',
  category: CATEGORIES.SOURCES,
  aliases: ['log sweep', 'chirp', 'stimulus', 'sine sweep', 'frequency sweep'],
  outputs: [
    audioOut,
    definePort({ id: 'reference', direction: 'out', type: 'ANALYSIS', role: 'REFERENCE',
      label: 'Reference' }),
  ],
  params: [
    frequencyParam('start', 'Start', DEFAULT_SWEEP.start),
    frequencyParam('end', 'End', DEFAULT_SWEEP.end),
    secondsParam('duration', 'Duration', DEFAULT_SWEEP.durationMs / 1000, 0.02, 30),
    enumParam('curve', 'Curve', [['log', 'Logarithmic'], ['linear', 'Linear']],
      DEFAULT_SWEEP.curve),
    levelParam('level', 'Level', 1),
  ],
  summary(p) {
    return parts(`${hz(p.start)} → ${hz(p.end)}`, `${p.duration} s`,
      p.curve === 'log' ? 'log' : 'linear');
  },
  clipKinds: ['event', 'measurement'],
  sounding: true,
  capabilities: { realtime: true, offline: true, measurement: true },
  compiler: 'audio/patterns.js#buildPlan',
  reuses: ['measurement/stimulus.js#renderStimulus', 'measurement/stimulus.js#inverseSweep'],
  help: {
    what: 'A frequency sweep. Its reference output is the exact digital stimulus for '
      + 'transfer measurements.',
    inputs: 'None.',
    outputs: 'Audio, and the digital reference for the Transfer Analyzer.',
    constraints: 'Duration 0.02-30 s; a measurement sweep is logarithmic and lasts 1-30 s.',
  },
});

export const sequence = defineNode({
  type: 'sequence',
  displayName: 'Sequence',
  idPrefix: 'seq',
  category: CATEGORIES.SOURCES,
  aliases: ['sequencer', 'pattern', 'blocks', 'pattern player'],
  outputs: [
    audioOut,
    definePort({ id: 'trigger', direction: 'out', type: 'TRIGGER', label: 'Trigger' }),
  ],
  params: [
    enumParam('waveform', 'Waveform', WAVE_OPTIONS, 'sine'),
    levelParam('level', 'Level', 1, { automatable: true, modulatable: true, modDepth: 0.5 }),
  ],
  summary(p) {
    return parts(optionLabel(sequence, 'waveform', p.waveform), pct(p.level));
  },
  clipKinds: ['pattern'],
  sounding: true,
  capabilities: { realtime: true, offline: true },
  compiler: 'sequencer/compiler.js#compileSequence',
  reuses: ['sequencer/model.js#normalizeBlock', 'sequencer/compiler.js#renderSequenceOffline'],
  help: {
    what: 'Plays the pattern clips of its timeline track with the existing sequencer.',
    inputs: 'Level accepts modulation.',
    outputs: 'Audio, and a trigger at every block start.',
    constraints: 'Pattern clips use the sequencer block types and limits.',
  },
});

export const microphone = defineNode({
  type: 'microphone',
  displayName: 'Microphone',
  idPrefix: 'mic',
  category: CATEGORIES.SOURCES,
  aliases: ['mic', 'input', 'line in', 'capture input'],
  outputs: [
    definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio',
      liveInput: true }),
    definePort({ id: 'capture', direction: 'out', type: 'ANALYSIS', role: 'OBSERVED',
      label: 'Capture' }),
  ],
  params: [],
  summary() {
    return 'Analysis only · relative level';
  },
  clipKinds: ['measurement'],
  capabilities: { realtime: true, measurement: true, requiresInputPermission: true },
  compiler: 'audio/microphone.js#openMicrophone',
  reuses: ['measurement/capture-checks.js#checkCapture'],
  help: {
    what: 'The browser microphone input, for analysis and measurement only. Nothing is '
      + 'uploaded; a measurement capture stays in this browser.',
    inputs: 'None.',
    outputs: 'Live audio for analyzers; the captured signal for measurement.',
    constraints: 'Needs microphone permission (HTTPS or a supporting local file). It can never '
      + 'reach Master Output. Not available in offline rendering.',
  },
});

export default [oscillator, noise, sweep, sequence, microphone];
