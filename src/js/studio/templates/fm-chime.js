// Template: FM Chime (plan issue K014, the pack's FM template). An inharmonic FM tone: an LFO at
// audio rate (K010), 616 Hz, 1.4 times the 440 Hz carrier, drives the Oscillator frequency on a
// linear edge (depth in Hz), so the spectrum holds lines at 440 ± n × 616 Hz, which are not
// harmonics of one fundamental. An Envelope with no sustain lets each strike decay.
import { clip, edge, node, studioDoc, track } from './data.js';

/** Strikes: [start s, gate s]. The gate holds the decay; its end starts the release. */
const STRIKES = [[0, 0.7], [0.75, 0.7], [1.5, 1.4], [3, 1.5]];

export default {
  id: 'fm-chime',
  version: 1,
  title: 'FM Chime',
  category: 'synthesis',
  learn: {
    summary: 'An inharmonic FM tone: a 440 Hz sine whose frequency an LFO at 616 Hz (ratio '
      + '1.4) modulates by ±616 Hz, struck by an Envelope that decays.',
    points: [
      'A linear edge on frequency is in Hz: depth divided by the modulator rate is the '
        + 'modulation index, here 1.',
      'The sidebands sit at 440 Hz ± n × 616 Hz (mirrored at 0 Hz); with a non-integer ratio '
        + 'they are not harmonics of one fundamental.',
      'The index is fixed here; only the level decays, over the Envelope decay of 1.6 s.',
    ],
  },
  studioHash: '769f2b8653d020e4ce0376848a097aa0216ea1c30ec18e856563b88e7aeae237',
  model: studioDoc({
    title: 'FM Chime',
    nodes: [
      node('osc-1', 'oscillator', 260, 160, { waveform: 'sine', frequency: 440, level: 1 },
        'Carrier'),
      node('lfo-1', 'lfo', 40, 300, { shape: 'sine', rate: 616 }, 'Modulator'),
      node('env-1', 'envelope', 480, 160, { attack: 0.002, decay: 1.6, sustain: 0,
        release: 0.8 }),
      node('master-1', 'master', 700, 160, {}, 'Master'),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'env-1', 'audio'),
      edge('edge-2', 'env-1', 'audio', 'master-1', 'audio'),
      edge('edge-3', 'lfo-1', 'control', 'osc-1', 'frequency',
        { depth: 616, mapping: 'linear', polarity: 'bipolar' }),
    ],
    tracks: [track('track-1', 'event', 'Strikes', 'env-1')],
    clips: STRIKES.map(([start, gate], i) => clip(`clip-${i + 1}`, 'track-1', 'event', start,
      gate, { action: 'gate' })),
  }),
};
