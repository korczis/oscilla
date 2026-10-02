// Template: Stereo Beat (spec §195). Two steady tones 4 Hz apart, one per stereo channel.
// Wording follows rule project.no-fake-science: what happens in the signal and what happens in
// hearing are stated separately, and no effect on the listener is claimed.
import { edge, node, studioDoc } from './data.js';

export default {
  id: 'stereo-beat',
  version: 1,
  title: 'Stereo Beat',
  category: 'synthesis',
  learn: {
    summary: 'Two sine tones, 200 Hz on the left and 204 Hz on the right, routed by a Stereo '
      + 'Split.',
    points: [
      'On speakers the two channels mix in the air, and the sum rises and falls 4 times per '
        + 'second: a physical beat.',
      'On headphones each ear receives one steady tone; any beat you notice arises in hearing, '
        + 'not in either signal.',
      'Use a moderate volume: the level shown is relative, not a sound pressure.',
    ],
  },
  studioHash: 'c32148891dbbad5f44ff5559a936daeaf183de8ac63bf2959945b02a2ff29c2b',
  model: studioDoc({
    title: 'Stereo Beat',
    nodes: [
      node('osc-1', 'oscillator', 60, 100, { waveform: 'sine', frequency: 200, level: 1 },
        'Left tone'),
      node('osc-2', 'oscillator', 60, 260, { waveform: 'sine', frequency: 204, level: 1 },
        'Right tone'),
      node('stereo-1', 'stereo-split', 300, 180, { mode: 'split' }),
      node('master-1', 'master', 540, 180, {}, 'Master'),
      node('meter-1', 'meter', 540, 340, {}),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'stereo-1', 'a'),
      edge('edge-2', 'osc-2', 'audio', 'stereo-1', 'b'),
      edge('edge-3', 'stereo-1', 'audio', 'master-1', 'audio'),
      edge('edge-4', 'stereo-1', 'audio', 'meter-1', 'audio'),
    ],
  }),
};
