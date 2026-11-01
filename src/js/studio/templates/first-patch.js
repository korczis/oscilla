// Template: First Patch (plan issue V617). One oscillator into the Master Output, and five
// timeline markers whose labels are the first steps; [ and ] move between them. A template
// with notes, not a guided path (Q004). Markers, labels and notes are presentation (§163):
// rewording a step changes no studioHash.
import { edge, marker, node, studioDoc } from './data.js';

const STEPS = [
  '1 Press Play',
  '2 Add a Filter between them (Add node, then rewire)',
  '3 Move the Filter cutoff',
  '4 Add a Spectrum from the Filter output (cable to empty canvas)',
  '5 Save it as a patch',
];

const NOTES = [
  'Five steps, one per timeline marker; [ and ] move between them.',
  '1 Press Play: the sawtooth Oscillator sounds through the Master Output.',
  '2 Add a Filter between them: press N or use Add node and choose Filter, select the direct '
    + 'Oscillator to Master cable and press Delete (Master takes one input), then connect the '
    + 'Oscillator output to the Filter input and the Filter output to Master.',
  '3 Move the Filter cutoff: select the Filter and change Cutoff in the Inspector; the '
    + 'low-pass Filter passes the harmonics below the cutoff and attenuates those above it.',
  '4 Add a Spectrum from the Filter output: drag a cable from the Filter output into empty '
    + 'canvas and choose Spectrum. Press Play to see what the Filter passes.',
  '5 Save it as a patch: select the nodes and choose Save as patch in the Inspector.',
].join('\n');

export default {
  id: 'first-patch',
  version: 1,
  title: 'First Patch',
  category: 'synthesis',
  learn: {
    summary: 'A sawtooth Oscillator into the Master Output, with five timeline markers that '
      + 'name the first steps: play, add a Filter, move its cutoff, add a Spectrum, save.',
    points: [
      'Press ] and [ on the timeline to move the playhead to the next or previous step.',
      'The notes of the Inspector, with nothing selected, say each step in full.',
    ],
  },
  studioHash: '847a4cfd83a66ea94bcdccff48fdcfbf2c72f2697aa7b0840bbb6d69d5cffa2c',
  model: studioDoc({
    title: 'First Patch',
    notes: NOTES,
    nodes: [
      node('osc-1', 'oscillator', 80, 160, { waveform: 'sawtooth', frequency: 220, level: 0.5 }),
      node('master-1', 'master', 520, 160, {}, 'Master'),
    ],
    edges: [edge('edge-1', 'osc-1', 'audio', 'master-1', 'audio')],
    markers: STEPS.map((label, i) => marker(`marker-${i + 1}`, 2 * i, 'custom', label)),
  }),
};
