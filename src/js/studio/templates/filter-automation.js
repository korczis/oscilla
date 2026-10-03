// Template: Filter Automation (spec §195, §97-§103). White noise through a band-pass filter
// whose centre frequency an automation lane moves up and back down.
import { edge, lane, node, studioDoc } from './data.js';

export default {
  id: 'filter-automation',
  version: 1,
  title: 'Filter Automation',
  category: 'synthesis',
  learn: {
    summary: 'Noise through a band-pass filter; an automation lane moves the centre frequency '
      + 'from 200 Hz to 4 kHz and back over 8 seconds.',
    points: [
      'Automation writes a parameter value along the timeline; modulation (an LFO, an '
        + 'Envelope) is continuous control from another node and adds on top of it.',
      'Exponential segments move the frequency by equal musical steps per second.',
      'The Spectrum shows the band of noise that passes the filter.',
    ],
  },
  studioHash: '5c107b61379ebc01c124e73c9888679120407c3a1ad695bb519e62954e4f66c7',
  model: studioDoc({
    title: 'Filter Automation',
    nodes: [
      node('noise-1', 'noise', 60, 160, { color: 'white', level: 0.5, seed: 1 }),
      node('filter-1', 'filter', 280, 160, { type: 'bandpass', frequency: 200, Q: 4 }),
      node('master-1', 'master', 500, 160, {}, 'Master'),
      node('spectrum-1', 'spectrum', 500, 320, {}),
    ],
    edges: [
      edge('edge-1', 'noise-1', 'audio', 'filter-1', 'audio'),
      edge('edge-2', 'filter-1', 'audio', 'master-1', 'audio'),
      edge('edge-3', 'filter-1', 'audio', 'spectrum-1', 'audio'),
    ],
    automation: [lane('lane-1', 'filter-1', 'frequency', [
      ['pt-1', 0, 200, 'linear'],
      ['pt-2', 4, 4000, 'exponential'],
      ['pt-3', 8, 200, 'exponential'],
    ])],
  }),
};
