// Template: Sweep Sequence (spec §195). A Sequence node plays pattern clips (the V2 sequencer
// blocks) on its timeline track; a Spectrogram taps the result.
import { clip, edge, node, studioDoc, track } from './data.js';

const sweep = (start, end) => ({ blockType: 'sweep', params: { start, end, curve: 'log' } });

export default {
  id: 'sweep-sequence',
  version: 1,
  title: 'Sweep Sequence',
  category: 'synthesis',
  learn: {
    summary: 'A rising sweep, a short silence and a falling sweep, played by the existing '
      + 'sequencer from pattern clips on the timeline.',
    points: [
      'A logarithmic sweep spends the same time in every octave, so it sounds even from low '
        + 'to high.',
      'The Spectrogram is an analyzer on a side chain: it draws frequency over time and does '
        + 'not alter what you hear.',
    ],
  },
  studioHash: 'a4e06d13f869a5976ff7058e7b42533a6735061268c6d7e7910c5119b635b5df',
  model: studioDoc({
    title: 'Sweep Sequence',
    nodes: [
      node('seq-1', 'sequence', 80, 160, { waveform: 'sine', level: 1 }),
      node('master-1', 'master', 380, 160, {}, 'Master'),
      node('sgram-1', 'spectrogram', 380, 320, {}),
    ],
    edges: [
      edge('edge-1', 'seq-1', 'audio', 'master-1', 'audio'),
      edge('edge-2', 'seq-1', 'audio', 'sgram-1', 'audio'),
    ],
    tracks: [track('track-1', 'event', 'Sweeps', 'seq-1')],
    clips: [
      clip('clip-1', 'track-1', 'pattern', 0, 2, sweep(100, 1000)),
      clip('clip-2', 'track-1', 'pattern', 2, 0.5, { blockType: 'silence', params: {} }),
      clip('clip-3', 'track-1', 'pattern', 2.5, 2, sweep(1000, 100)),
    ],
  }),
};
