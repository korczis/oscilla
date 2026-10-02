// Studio OUTPUT node types (spec §29, §186-§187, §240): Master Output, Recorder/Export.
//
// INVARIANTS: exactly one Master Output per Studio (maxInstances 1); it maps into the engine's
// existing safe output chain (master → limiter → trim → ceiling → analyser → destination) and
// its level is the engine's logical master gain: DEFAULT_GAIN 0.08, at most MAX_OUTPUT_GAIN 0.25
// (core/constants.js), neither automatable nor modulatable, so no graph can bypass or overdrive
// the output safety. The Recorder renders offline (DEFAULT_RENDER 48 kHz, 2 channels,
// audio/offline-renderer.js).

import { DEFAULT_GAIN, MAX_OUTPUT_GAIN } from '../../core/constants.js';
import { gainPctFor } from '../../core/config.js';
import { DEFAULT_RENDER } from '../../audio/offline-renderer.js';
import { definePort } from '../ports.js';
import { CATEGORIES, defineNode, enumParam, numberParam, parts } from './common.js';

export const master = defineNode({
  type: 'master',
  displayName: 'Master Output',
  idPrefix: 'master',
  category: CATEGORIES.OUTPUT,
  aliases: ['output', 'out', 'speakers', 'destination', 'main out'],
  inputs: [definePort({ id: 'audio', direction: 'in', type: 'AUDIO', label: 'Audio',
    required: true })],
  params: [
    numberParam('level', 'Level', {
      min: 0, max: MAX_OUTPUT_GAIN, step: 0.001, default: DEFAULT_GAIN, unit: 'logical gain',
    }),
  ],
  summary(p) {
    return parts(`${gainPctFor(p.level)} %`, 'limiter · ceiling');
  },
  maxInstances: 1,
  capabilities: { realtime: true, offline: true },
  compiler: 'audio/audio-engine.js#AudioEngine',
  reuses: ['audio/audio-engine.js#ceilingCurve'],
  help: {
    what: 'The single output of the Studio, through the OSCILLA limiter and output ceiling.',
    inputs: 'Audio (use a Mixer to combine several signals).',
    outputs: 'The device output; speaker output is unknown.',
    constraints: 'One per Studio. The level is the conservative master gain and cannot be '
      + 'automated or modulated.',
  },
});

export const recorder = defineNode({
  type: 'recorder',
  displayName: 'Recorder/Export',
  idPrefix: 'rec',
  category: CATEGORIES.OUTPUT,
  aliases: ['recorder', 'export', 'wav', 'render', 'bounce', 'offline'],
  inputs: [definePort({ id: 'audio', direction: 'in', type: 'AUDIO', role: 'TAP',
    label: 'Audio', required: true })],
  params: [
    enumParam('sampleRate', 'Sample rate', [[44100, '44.1 kHz'], [48000, '48 kHz'],
      [96000, '96 kHz']], DEFAULT_RENDER.sampleRate, { unit: 'Hz' }),
    enumParam('channels', 'Channels', [[1, 'Mono'], [2, 'Stereo']], DEFAULT_RENDER.channels),
  ],
  summary(p) {
    return parts('WAV', `${p.sampleRate / 1000} kHz`, p.channels === 1 ? 'mono' : 'stereo');
  },
  capabilities: { offline: true },
  compiler: 'audio/offline-renderer.js#renderToWav',
  reuses: ['audio/wav.js#encodeWav'],
  help: {
    what: 'Exports the tapped signal as a WAV file rendered offline.',
    inputs: 'Audio tap.',
    outputs: 'A WAV file, saved only when you export it.',
    constraints: 'Live-only sources (Microphone) cannot be rendered offline.',
  },
});

export default [master, recorder];
