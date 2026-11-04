// Template: Macro Pad (plan issue K014). Three sawtooth Oscillators hold an A minor chord through
// a Mixer, a low-pass filter and a slow Envelope. One Macro (K013: a 0..1 value on a CONTROL
// output) drives two parameters at once: the filter cutoff (log edge, 3.5 octaves) and the
// Mixer level of the fifth (linear edge, 0 to 0.3). An automation lane moves the Macro value.
import { clip, edge, lane, node, studioDoc, track } from './data.js';

export default {
  id: 'macro-pad',
  version: 1,
  title: 'Macro Pad',
  category: 'synthesis',
  learn: {
    summary: 'An A minor chord of three sawtooth Oscillators; one Macro opens the filter and '
      + 'brings in the fifth, and an automation lane moves the Macro from 0 to 1 and back.',
    points: [
      'A Macro is one value from 0 to 1 on a control output; each edge from it sets its own '
        + 'depth, mapping and target.',
      'Macro 0: cutoff 300 Hz, the fifth silent. Macro 1: cutoff 3.4 kHz (3.5 octaves up), '
        + 'the fifth at Mixer level 0.3.',
      'The lane owns the Macro value while it plays; move the Macro in the Inspector after '
        + 'deleting the lane.',
    ],
  },
  studioHash: '915a0e756f4a78226d903c349b6bc5e522812168f0a6d97cc8713702fcd4dbaf',
  model: studioDoc({
    title: 'Macro Pad',
    nodes: [
      node('osc-1', 'oscillator', 40, 60, { waveform: 'sawtooth', frequency: 220, level: 1 },
        'Root'),
      node('osc-2', 'oscillator', 40, 200, { waveform: 'sawtooth', frequency: 261.626,
        level: 1 }, 'Third'),
      node('osc-3', 'oscillator', 40, 340, { waveform: 'sawtooth', frequency: 329.628,
        level: 1 }, 'Fifth'),
      node('mixer-1', 'mixer', 260, 200, { level1: 0.3, level2: 0.3, level3: 0, level4: 0 }),
      node('filter-1', 'filter', 480, 200, { type: 'lowpass', frequency: 300, Q: 1 }),
      node('env-1', 'envelope', 700, 200, { attack: 1.2, decay: 0.5, sustain: 0.85,
        release: 1.5 }),
      node('master-1', 'master', 920, 200, {}, 'Master'),
      node('macro-1', 'macro', 260, 400, { value: 0 }),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'mixer-1', 'in1'),
      edge('edge-2', 'osc-2', 'audio', 'mixer-1', 'in2'),
      edge('edge-3', 'osc-3', 'audio', 'mixer-1', 'in3'),
      edge('edge-4', 'mixer-1', 'audio', 'filter-1', 'audio'),
      edge('edge-5', 'filter-1', 'audio', 'env-1', 'audio'),
      edge('edge-6', 'env-1', 'audio', 'master-1', 'audio'),
      edge('edge-7', 'macro-1', 'control', 'filter-1', 'frequency',
        { depth: 3.5, mapping: 'log', polarity: 'unipolar' }),
      edge('edge-8', 'macro-1', 'control', 'mixer-1', 'level3',
        { depth: 0.3, mapping: 'linear', polarity: 'unipolar' }),
    ],
    tracks: [track('track-1', 'event', 'Chord', 'env-1')],
    clips: [clip('clip-1', 'track-1', 'event', 0, 5.5, { action: 'gate' })],
    automation: [lane('lane-1', 'macro-1', 'value', [
      ['pt-1', 0, 0, 'linear'],
      ['pt-2', 3, 1, 'linear'],
      ['pt-3', 6, 0.2, 'linear'],
    ])],
  }),
};
