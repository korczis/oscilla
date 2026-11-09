// Template: Ring Mod (plan issue K014). A Gain at 0 whose gain input takes a bipolar edge from
// an LFO at audio rate (K010): the gain swings between -1 and 1 at 470 Hz, so the Gain multiplies
// the note by a sine. Each partial f of the note becomes |f - 470| Hz and f + 470 Hz.
import { edge, node, noteClips, studioDoc, track } from './data.js';

/** An original line, one quarter note (0.5 s at 120 BPM) per step. */
const LINE = [57, 60, 64, [62, 2], 57, 55, 60];

export default {
  id: 'ring-mod',
  version: 1,
  title: 'Ring Mod',
  category: 'synthesis',
  learn: {
    summary: 'A triangle line multiplied by a 470 Hz sine: a Gain at 0 with a bipolar LFO edge '
      + 'of depth 1 on its gain, so the gain runs from -1 to 1.',
    points: [
      'Multiplying by a sine moves every partial f of the note to the difference |f - 470| Hz '
        + 'and the sum f + 470 Hz (220 Hz gives 250 and 690 Hz); the note itself drops out.',
      'The new lines are not harmonics of the note, so the result sounds bell-like and its '
        + 'pitch is unclear.',
      'Lower the edge depth to 0.5 and raise the Gain to 0.5 for amplitude modulation: the '
        + 'note returns between the sidebands.',
    ],
  },
  studioHash: 'c68121d5b95bf281a8ce6b54f64fb4cd881ce6db4e8ebb60dfc999b991bbbd3d',
  model: studioDoc({
    title: 'Ring Mod',
    nodes: [
      node('osc-1', 'oscillator', 40, 160, { waveform: 'triangle', frequency: 220, level: 0.8 }),
      node('gain-1', 'gain', 260, 160, { gain: 0 }, 'Ring gain'),
      node('lfo-1', 'lfo', 40, 320, { shape: 'sine', rate: 470 }, 'Modulator'),
      node('master-1', 'master', 480, 160, {}, 'Master'),
    ],
    edges: [
      edge('edge-1', 'osc-1', 'audio', 'gain-1', 'audio'),
      edge('edge-2', 'gain-1', 'audio', 'master-1', 'audio'),
      edge('edge-3', 'lfo-1', 'control', 'gain-1', 'gain',
        { depth: 1, mapping: 'linear', polarity: 'bipolar' }),
    ],
    tracks: [track('track-1', 'event', 'Notes', 'osc-1')],
    clips: noteClips('clip', 'track-1', LINE, 0.5),
  }),
};
