// Declarations: the on-screen keyboard (the panel in src/index.html, its controller
// midi/keyboard-ui.js), docked in the Playground, the Studio and the Synth. The arm switch and
// the octave and velocity steps write the component's page-only keys (ui.kbdArmed, ui.kbdBase,
// ui.kbdVelocity of sources.js). Trace: scripts/ui-catalog/trace/keyboard.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'keyboard',
    kind: 'panel',
    label: 'Keyboard',
    docs: 'Holds the computer-keyboard controls and the on-screen keys of the view in sight.',
    state: { none: 'the panel holds the keys and owns no value' },
  }),
  defineComponent({
    id: 'keyboard.arm',
    kind: 'switch',
    label: 'Arm keys',
    docs: 'Arms or disarms the computer keyboard in the view in sight, each view on its own.',
    state: 'ui.kbdArmed',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.octave-down',
    kind: 'action',
    label: 'Octave −',
    docs: 'Moves the playable range of the keys one octave down (shortcut Z).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.octave-up',
    kind: 'action',
    label: 'Octave +',
    docs: 'Moves the playable range of the keys one octave up (shortcut X).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-down',
    kind: 'action',
    label: 'Velocity −',
    docs: 'Lowers the velocity the keys play their notes with (shortcut C).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-up',
    kind: 'action',
    label: 'Velocity +',
    docs: 'Raises the velocity the keys play their notes with (shortcut V).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.readout',
    kind: 'readout',
    label: 'Keyboard readout',
    docs: 'Says whether the keys are armed here, the range they play and the velocity.',
    state: 'ui.kbdArmed',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.held',
    kind: 'readout',
    label: 'Holding',
    docs: 'Lists the notes the keys or the pointers are holding down right now.',
    state: { none: 'it lists the sounding notes and edits nothing' },
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.keys',
    kind: 'action',
    label: 'On-screen keys',
    docs: 'Draws the keys and plays one note per pointer; a drag glides from key to key.',
    state: { none: 'it plays notes and keeps no value' },
    effect: { command: 'play the note under each pointer on the AudioEngine' },
    in: 'keyboard',
  }),
];
