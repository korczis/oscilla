// Declarations: the on-screen keyboard (the panel in src/index.html, its controller
// midi/keyboard-ui.js), docked in the Playground, the Studio and the Synth. The arm switch and
// the octave and velocity steps write the component's page-only keys (ui.kbdArmed, ui.kbdBase,
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
    docs: 'Drží ovládání klávesnice počítače a klávesy na obrazovce zobrazeného pohledu.',
    state: { none: 'panel drží klávesy a žádnou hodnotu nevlastní' },
  }),
  defineComponent({
    id: 'keyboard.arm',
    kind: 'switch',
    label: 'Připravit klávesy',
    docs: 'Připraví klávesnici počítače v zobrazeném pohledu ke hře, nebo ji odpojí; každý pohled '
      + 'zvlášť.',
    state: 'ui.kbdArmed',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.octave-down',
    kind: 'action',
    label: 'Oktáva −',
    docs: 'Posune hratelný rozsah kláves o oktávu dolů (zkratka Z).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.octave-up',
    kind: 'action',
    label: 'Oktáva +',
    docs: 'Posune hratelný rozsah kláves o oktávu nahoru (zkratka X).',
    state: 'ui.kbdBase',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-down',
    kind: 'action',
    label: 'Úhoz −',
    docs: 'Sníží úhoz, kterým klávesy hrají své noty (zkratka C).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.velocity-up',
    kind: 'action',
    label: 'Úhoz +',
    docs: 'Zvýší úhoz, kterým klávesy hrají své noty (zkratka V).',
    state: 'ui.kbdVelocity',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.readout',
    kind: 'readout',
    label: 'Údaje kláves',
    docs: 'Říká, zda jsou klávesy tady připravené, jaký rozsah hrají a jaký úhoz.',
    state: 'ui.kbdArmed',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.held',
    kind: 'readout',
    label: 'Držené',
    docs: 'Vypíše noty, které klávesy nebo ukazatele právě drží.',
    state: { none: 'vypisuje znějící noty a nic neupravuje' },
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.keys',
    kind: 'action',
    label: 'Klávesy na obrazovce',
    docs: 'Kreslí klávesy a hraje jednu notu na každý ukazatel; tažení klouže z klávesy na '
      + 'klávesu.',
    state: { none: 'hraje noty a žádnou hodnotu nedrží' },
    effect: { command: 'zahrát notu pod každým ukazatelem na AudioEngine' },
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.more',
    kind: 'switch',
    label: 'Vše, Skrýt',
    docs: 'Ukáže ovládání ukotvené klávesnice, které telefon schová, nebo je zase schová.',
    state: 'ui.kbdMore',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.handle',
    kind: 'switch',
    label: 'Klávesnice',
    docs: 'Složí ukotvenou klávesnici do jednoho řádku, zatímco noty patří padu, nebo ji '
      + 'rozloží (zkratka Alt+K).',
    state: 'ui.kbdDockExpanded',
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.handle.held',
    kind: 'readout',
    label: 'Světlo držené noty',
    docs: 'Rozsvítí se na rukojeti složené klávesnice, dokud klávesy drží notu (#444).',
    state: { none: 'svítí, dokud se drží nota; nic neupravuje' },
    in: 'keyboard',
  }),
  defineComponent({
    id: 'keyboard.dock-status',
    kind: 'readout',
    label: 'Stav doku kláves',
    docs: 'Sděluje asistenčním technologiím, zda je ukotvená klávesnice složená a která plocha '
      + 'hraje noty.',
    state: { none: 'hlásí, zda je klávesnice složená, a nic neupravuje' },
    in: 'keyboard',
  }),
];
