// Studio PROCESSING node types (spec §29, §188): Gain, Filter, Pan, Stereo Split, Mixer.
// Defaults: DEFAULT_FILTER low-pass 1 kHz, Q 0.7071 (linear), 0 dB, enabled (audio/filters.js,
// whose normalizeFilter range is 10 Hz-0.95 × Nyquist, Q 1e-4-1000, gain ±40 dB);
// createStereoRouter mode 'split', panA −1, panB 1, levels 1 (audio/stereo.js); Mixer channel
// levels 0.5, as the dual-oscillator mono mix (o.gain · level · 0.5, audio/modulation.js).
//
// INVARIANT (§188): Mixer is the only node whose audio inputs are meant to be summed; every
// other audio input accepts one connection, so accidental summing cannot happen.

import { DEFAULT_FILTER, FILTER_TYPES } from '../../audio/filters.js';
import { definePort } from '../ports.js';
import {
  CATEGORIES, FREQUENCY_MAX_HZ, boolParam, defineNode, enumParam, frequencyParam, hz,
  levelParam, num, numberParam, optionLabel, parts,
} from './common.js';

const audioIn = definePort({ id: 'audio', direction: 'in', type: 'AUDIO', label: 'Audio' });
const audioOut = definePort({ id: 'audio', direction: 'out', type: 'AUDIO', label: 'Audio' });

/** Filter type labels as the Filter Lab shows them (src/index.html). */
export const FILTER_TYPE_LABELS = Object.freeze({
  lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch',
  peaking: 'Peaking',
});
export const MIXER_CHANNELS = 4;

const signedDb = (g) => `${g > 0 ? '+' : ''}${num(g, 3)} dB`;

export const gain = defineNode({
  type: 'gain',
  displayName: 'Gain',
  idPrefix: 'gain',
  category: CATEGORIES.PROCESSING,
  aliases: ['amplifier', 'volume', 'vca', 'level', 'attenuator'],
  inputs: [audioIn],
  outputs: [audioOut],
  params: [
    numberParam('gain', 'Gain', {
      min: 0, max: 2, step: 0.01, default: 1, automatable: true, modulatable: true,
      modDepth: 0.5,
    }),
  ],
  summary(p) {
    return p.gain > 0 ? signedDb(20 * Math.log10(p.gain)) : 'Muted';
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  help: {
    what: 'Scales the audio level (linear gain; 1 = unchanged).',
    inputs: 'Audio; gain accepts modulation (tremolo, AM).',
    outputs: 'Audio.',
    constraints: 'Gain above 1 raises the level; the output ceiling still applies at Master.',
  },
});

export const filter = defineNode({
  type: 'filter',
  displayName: 'Filter',
  idPrefix: 'filter',
  category: CATEGORIES.PROCESSING,
  aliases: ['biquad', 'lowpass', 'low-pass', 'highpass', 'high-pass', 'bandpass', 'notch',
    'peaking', 'eq', 'cutoff', 'resonance', 'vcf'],
  inputs: [audioIn],
  outputs: [audioOut],
  params: [
    enumParam('type', 'Type', FILTER_TYPES.map((t) => [t, FILTER_TYPE_LABELS[t]]),
      DEFAULT_FILTER.type),
    frequencyParam('frequency', 'Cutoff', DEFAULT_FILTER.frequency, {
      min: 10, max: FREQUENCY_MAX_HZ, automatable: true, modulatable: true, modDepth: 1200,
    }),
    numberParam('Q', 'Q', {
      min: 1e-4, max: 1000, scale: 'log', default: DEFAULT_FILTER.Q, automatable: true,
      modulatable: true, modDepth: 0.5, softRange: [0.1, 30],
    }),
    numberParam('gain', 'Gain', {
      min: -40, max: 40, step: 0.1, unit: 'dB', default: DEFAULT_FILTER.gain,
      automatable: true, modulatable: true, modDepth: 6,
    }),
    boolParam('enabled', 'Enabled', DEFAULT_FILTER.enabled),
  ],
  summary(p) {
    return parts(optionLabel(filter, 'type', p.type), hz(p.frequency),
      p.type === 'peaking' ? signedDb(p.gain) : `Q ${num(p.Q)}`,
      p.enabled ? null : 'bypassed');
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/filters.js#createFilterStage',
  reuses: ['audio/filters.js#normalizeFilter'],
  help: {
    what: 'A biquad filter (low-pass, high-pass, band-pass, notch, peaking) with click-free '
      + 'bypass.',
    inputs: 'Audio; cutoff, Q and gain accept modulation.',
    outputs: 'Audio.',
    constraints: 'Q is linear for every type; gain applies to peaking only. Cutoff is limited '
      + 'to 0.95 × the digital Nyquist limit.',
  },
});

export const pan = defineNode({
  type: 'pan',
  displayName: 'Pan',
  idPrefix: 'pan',
  category: CATEGORIES.PROCESSING,
  aliases: ['panner', 'stereo', 'balance', 'left right'],
  inputs: [audioIn],
  outputs: [audioOut],
  params: [
    numberParam('pan', 'Pan', {
      min: -1, max: 1, step: 0.01, default: 0, automatable: true, modulatable: true,
      modDepth: 0.5,
    }),
  ],
  summary(p) {
    if (p.pan === 0) return 'Centre';
    return `${Math.round(Math.abs(p.pan) * 100)} % ${p.pan < 0 ? 'L' : 'R'}`;
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/stereo.js#createStereoRouter',
  reuses: ['audio/stereo.js#panGains'],
  help: {
    what: 'Places a mono signal in the stereo field (equal-power law).',
    inputs: 'Audio (mono); pan accepts modulation.',
    outputs: 'Stereo audio.',
    constraints: '−1 is full left, 1 full right.',
  },
});

export const stereoSplit = defineNode({
  type: 'stereo-split',
  displayName: 'Stereo Split',
  idPrefix: 'stereo',
  category: CATEGORIES.PROCESSING,
  aliases: ['stereo router', 'split', 'dual', 'left right', 'channel'],
  inputs: [
    definePort({ id: 'a', direction: 'in', type: 'AUDIO', label: 'A' }),
    definePort({ id: 'b', direction: 'in', type: 'AUDIO', label: 'B' }),
  ],
  outputs: [audioOut],
  params: [
    enumParam('mode', 'Mode', [['split', 'A left · B right'], ['pan', 'Panned'],
      ['mono', 'Mono']], 'split'),
    numberParam('panA', 'Pan A', { min: -1, max: 1, step: 0.01, default: -1,
      automatable: true }),
    numberParam('panB', 'Pan B', { min: -1, max: 1, step: 0.01, default: 1,
      automatable: true }),
    levelParam('levelA', 'Level A', 1, { automatable: true }),
    levelParam('levelB', 'Level B', 1, { automatable: true }),
  ],
  summary(p) {
    return optionLabel(stereoSplit, 'mode', p.mode);
  },
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/stereo.js#createStereoRouter',
  reuses: ['audio/stereo.js#routingGains'],
  help: {
    what: 'Routes two mono sources to the stereo channels: split, panned or mono.',
    inputs: 'Audio A and audio B.',
    outputs: 'Stereo audio.',
    constraints: 'In split mode the pan values are ignored.',
  },
});

const mixerInputs = [];
const mixerParams = [];
for (let i = 1; i <= MIXER_CHANNELS; i++) {
  mixerInputs.push(definePort({ id: `in${i}`, direction: 'in', type: 'AUDIO',
    label: `Input ${i}` }));
  mixerParams.push(levelParam(`level${i}`, `Level ${i}`, 0.5, {
    automatable: true, modulatable: true, modDepth: 0.25,
  }));
}

export const mixer = defineNode({
  type: 'mixer',
  displayName: 'Mixer',
  idPrefix: 'mix',
  category: CATEGORIES.PROCESSING,
  aliases: ['sum', 'summing', 'combine', 'merge', 'bus'],
  inputs: mixerInputs,
  outputs: [audioOut],
  params: mixerParams,
  summary(p) {
    return `${MIXER_CHANNELS} ch · ${mixerParams.map((d) => num(p[d.key], 2)).join(' / ')}`;
  },
  summing: true,
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  reuses: ['audio/modulation.js#buildDual'],
  help: {
    what: 'Sums up to four audio signals, each with its own level.',
    inputs: 'Four audio inputs; levels accept modulation.',
    outputs: 'Audio.',
    constraints: 'The only node that sums audio on purpose. Summing raises the level; the '
      + 'output ceiling is a last resort, not a guarantee.',
  },
});

export default [gain, filter, pan, stereoSplit, mixer];
