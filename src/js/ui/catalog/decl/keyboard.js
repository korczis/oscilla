// Declarations: the on-screen keyboard (the panel in src/index.html, its controller
// midi/keyboard-ui.js), docked in the Playground, the Studio and the Synth. The arm switch and
// the octave and velocity steps write the component's keys (ui.kbdLetters, the status bar's
// switch kept per browser, U134; ui.kbdBase,
// ui.kbdVelocity of sources.js), the docked keys' More switch ui.kbdMore, the dock's handle
// ui.kbdDockExpanded (midi/dock-yield.js builds the handle and the status line, K171).
// Trace: scripts/ui-catalog/trace/keyboard.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'alert.undo',
    kind: 'action',
    label: 'Zpět',
    docs: 'Vrátí vložení panelu Synthu, které klávesy udělaly mimo Synth a Studio, přímo z oznámení.',
    state: { none: 'vrací jednu změnu dokumentu Studia a žádnou hodnotu nedrží' },
    effect: { command: 'vrátit vložení panelu klávesami, dokud je poslední změnou dokumentu' },
  }),
  defineComponent({
    id: 'keyboard',
    kind: 'panel',
    label: 'Klávesy',
    docs: 'Holds the computer-keyboard controls and the on-screen keys of the view in sight.',
    state: { none: 'the panel holds the keys and owns no value' },
  }),
  defineComponent({
    id: 'keyboard.arm',
    kind: 'switch',
    label: 'Klávesnice hraje',
    docs: 'Jeden přepínač ve stavovém řádku zapne nebo vypne hraní not z písmen klávesnice '
      + 'počítače všude; hrají jen v nástrojových místech tabulky tras (U134, Q114).',
    state: 'ui.kbdLetters',
    related: ['keyboard'],
  }),
  defineComponent({
    id: 'keyboard.octave-down',
    kind: 'action',
    label: 'Oktáva −',
    docs: 'Moves the playable range of the keys one octave down (shortcut Z).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.octave-up',
    kind: 'action',
    label: 'Oktáva +',
    docs: 'Moves the playable range of the keys one octave up (shortcut X).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-down',
    kind: 'action',
    label: 'Úhoz −',
    docs: 'Lowers the velocity the keys play their notes with (shortcut C).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-up',
    kind: 'action',
    label: 'Úhoz +',
    docs: 'Raises the velocity the keys play their notes with (shortcut V).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.readout',
    kind: 'readout',
    label: 'Keyboard readout',
    docs: 'Says whether the letter keys play here, the range they play and the velocity.',
    state: 'ui.kbdLetters',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.held',
    kind: 'readout',
    label: 'Držené',
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
  defineComponent({
    id: 'keyboard.more',
    kind: 'switch',
    label: 'Vše, Skrýt',
    docs: 'Shows the docked keyboard controls a phone folds away, or folds them again.',
    state: 'ui.kbdMore',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.handle',
    kind: 'switch',
    label: 'Keyboard handle',
    docs: 'Složí ukotvenou klávesnici do jednoho řádku, zatímco noty patří padu, nebo ji '
      + 'rozloží (zkratka Alt+K).',
    state: 'ui.kbdDockExpanded',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.handle.held',
    kind: 'readout',
    label: 'Held light',
    docs: 'Rozsvítí se na rukojeti složené klávesnice, dokud klávesy drží notu (#444).',
    state: { none: 'svítí, dokud se drží nota; nic neupravuje' },
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.dock-status',
    kind: 'readout',
    label: 'Dock status',
    docs: 'Sděluje asistenčním technologiím, zda je ukotvená klávesnice složená a která plocha '
      + 'hraje noty.',
    state: { none: 'hlásí, zda je klávesnice složená, a nic neupravuje' },
    in: 'keyboard',
  }),
];
