// Template: Filter Envelope Synth (plan issue K014). A sawtooth line through an Envelope and a
// resonant low-pass filter: the Envelope's audio output shapes the level of each note, and its
// CONTROL output opens the filter cutoff on a log edge (the Envelope sits before the filter, so
// the control path is no cycle). Notes are pattern clips on the Oscillator, gates are event
// clips on the Envelope; both start together.
import { edge, node, noteClips, studioDoc, track } from './data.js';

/** An original line in A minor, one 8th note (0.25 s at 120 BPM) per step. */
const LINE = [45, 45, 57, 45, 48, 45, 52, 50, 45, 45, 57, 45, 55, 52, 50, 48];

export default {
  id: 'filter-envelope-synth',
  version: 1,
  title: 'Filter Envelope Synth',
  category: 'synthesis',
  learn: {
    summary: 'A sawtooth through an Envelope and a resonant low-pass filter; the Envelope '
      + 'shapes the level of each note and, through its control output, sweeps the cutoff.',
    points: [
      'The control edge is log-mapped and unipolar: Envelope 0 leaves the cutoff at 150 Hz, '
        + 'Envelope 1 adds 5 octaves (4.8 kHz).',
      'Each note is a pattern clip on the Oscillator; a gate clip on the Envelope starts with '
        + 'it and lasts 70 % of the note.',
      'Shorten the decay to make each note pluck; raise the sustain to keep the filter open.',
    ],
  },
  studioHash: 'eea1d68a41f2e93a7d30da0a9c757cc42fef09c0c0240b67e4269339d7eb55e4',
  model: studioDoc({
    title: 'Filter Envelope Synth',
    nodes: [
      node('osc-1', 'oscillator', 40, 160, { waveform: 'sawtooth', frequency: 110, level: 0.8 }),
      node('env-1', 'envelope', 260, 160, { attack: 0.003, decay: 0.2, sustain: 0.15,
        release: 0.08 }),
      node('filter-1', 'filter', 480, 160, { type: 'lowpass', frequency: 150, Q: 4 }),
      node('master-1', 'master', 700, 160, {}, 'Master'),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'env-1', 'audio'),
      edge('edge-2', 'env-1', 'audio', 'filter-1', 'audio'),
      edge('edge-3', 'filter-1', 'audio', 'master-1', 'audio'),
      edge('edge-4', 'env-1', 'control', 'filter-1', 'frequency',
        { depth: 5, mapping: 'log', polarity: 'unipolar' }),
    ],
    tracks: [track('track-1', 'event', 'Notes', 'osc-1'),
      track('track-2', 'event', 'Gate', 'env-1')],
    clips: noteClips('clip', 'track-1', LINE, 0.25, { trackId: 'track-2', share: 0.7 }),
  }),
};
