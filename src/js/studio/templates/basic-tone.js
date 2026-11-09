// Template: Basic Tone (spec §195). One oscillator into the Master Output.
import { edge, node, studioDoc } from './data.js';

export default {
  id: 'basic-tone',
  version: 1,
  title: 'Basic Tone',
  category: 'synthesis',
  learn: {
    summary: 'One oscillator into the Master Output: the shortest signal path a Studio can '
      + 'have.',
    points: [
      'Every sound leaves through the single Master Output, which feeds the OSCILLA limiter '
        + 'and output ceiling.',
      'The level shown is a relative digital level; what reaches your ears depends on the '
        + 'device and its volume.',
    ],
  },
  studioHash: '59dff06b79e068668072ef5593847473813c9bdf05b3d8ad3da01a1e4a027b5a',
  model: studioDoc({
    title: 'Basic Tone',
    nodes: [
      node('osc-1', 'oscillator', 80, 160, { waveform: 'sine', frequency: 440, level: 1 }),
      node('master-1', 'master', 360, 160, {}, 'Master'),
    ],
    edges: [edge('edge-1', 'osc-1', 'audio', 'master-1', 'audio')],
  }),
};
