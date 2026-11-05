// Template: Drive Lead (plan issue K014). A sawtooth line into the Drive (K012: a tanh curve
// with 4x oversampling, then a trim and a clip that bound its output), then a low-pass filter
// that tames the top of the added harmonics.
import { edge, node, noteClips, studioDoc, track } from './data.js';

/** An original line in A minor pentatonic, one 8th note (0.25 s at 120 BPM) per step. */
const LINE = [[69, 2], 72, 74, [76, 3], 74, 72, [69, 2], 67, 69, [72, 2], [69, 2]];

export default {
  id: 'drive-lead',
  version: 1,
  title: 'Drive Lead',
  category: 'synthesis',
  learn: {
    summary: 'A sawtooth lead through the Drive, a tanh soft-saturation curve, then a low-pass '
      + 'filter at 3.2 kHz.',
    points: [
      'Drive 60 % adds about 22 dB in front of the curve; the louder the input, the flatter '
        + 'the peaks and the more harmonics the curve adds.',
      'The trim sets the level after the curve; a clip after it bounds the output whatever '
        + 'the drive.',
      'The curve is a mathematical function: it does not model any circuit.',
    ],
  },
  studioHash: '24725ac1da7d547cd57e4a68e2c955dcf5893d6a10163b4eb33bfa6ebf298521',
  model: studioDoc({
    title: 'Drive Lead',
    nodes: [
      node('osc-1', 'oscillator', 40, 160, { waveform: 'sawtooth', frequency: 440, level: 0.7 }),
      node('drive-1', 'drive', 260, 160, { drive: 0.6, trim: 0.7 }),
      node('filter-1', 'filter', 480, 160, { type: 'lowpass', frequency: 3200, Q: 0.7 }),
      node('master-1', 'master', 700, 160, {}, 'Master'),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'drive-1', 'audio'),
      edge('edge-2', 'drive-1', 'audio', 'filter-1', 'audio'),
      edge('edge-3', 'filter-1', 'audio', 'master-1', 'audio'),
    ],
    tracks: [track('track-1', 'event', 'Lead', 'osc-1')],
    clips: noteClips('clip', 'track-1', LINE, 0.25),
  }),
};
