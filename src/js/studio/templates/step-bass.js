// Template: Step Bass (plan issue K014). A sawtooth bass line through a resonant low-pass
// filter whose cutoff the Step Modulator moves on a log edge: eight steps at 8 Hz, one per 16th
// note of the line, free-running from PLAY.
import { edge, node, noteClips, studioDoc, track } from './data.js';

/** An original bass line in A minor, one 16th note (0.125 s at 120 BPM) per step, 4 s. */
const LINE = [33, 33, 45, 33, 36, 33, 43, 33, 31, 31, 43, 31, 38, 36, 33, 28,
  33, 33, 45, 33, 36, 33, 43, 33, 31, 31, 43, 31, [40, 2], [38, 2]];

export default {
  id: 'step-bass',
  version: 1,
  title: 'Step Bass',
  category: 'synthesis',
  learn: {
    summary: 'A sawtooth bass line through a low-pass filter whose cutoff a Step Modulator '
      + 'moves by up to 1.5 octaves, one step per 16th note.',
    points: [
      'The Step Modulator plays its eight values (-1 to 1) in a loop at 8 steps per second; '
        + 'the log edge turns each into octaves around the 400 Hz cutoff.',
      'Step 1 opens the filter to 1.1 kHz, step -1 closes it to 141 Hz.',
      'Without a clock edge the steps run from PLAY at their own rate; a Sequence trigger '
        + 'into the clock input steps them at the start of each of its clips instead.',
    ],
  },
  studioHash: '701d7e300d2c0307da24b0c8b75610e30de59c4d6da2a0e2e9fa2439cc5079fc',
  model: studioDoc({
    title: 'Step Bass',
    nodes: [
      node('osc-1', 'oscillator', 40, 160, { waveform: 'sawtooth', frequency: 55, level: 0.9 }),
      node('filter-1', 'filter', 260, 160, { type: 'lowpass', frequency: 400, Q: 3 }),
      node('master-1', 'master', 480, 160, {}, 'Master'),
      node('steps-1', 'step-modulator', 40, 320, { steps: [1, -0.5, 0.25, -1, 0.75, -0.25, 0.5,
        -0.75], rate: 8, playback: 'loop' }),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'filter-1', 'audio'),
      edge('edge-2', 'filter-1', 'audio', 'master-1', 'audio'),
      edge('edge-3', 'steps-1', 'control', 'filter-1', 'frequency',
        { depth: 1.5, mapping: 'log', polarity: 'bipolar' }),
    ],
    tracks: [track('track-1', 'event', 'Bass', 'osc-1')],
    clips: noteClips('clip', 'track-1', LINE, 0.125),
  }),
};
