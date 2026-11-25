// Declarations: Sonda, the observed lens (src/index.html; the component part createLensPart of
// ui/lens.js): the status bar's toggle, the sheet, the sounding owner it names and its views.
// Trace: scripts/ui-catalog/trace/lens.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'status.lens',
    kind: 'switch',
    label: 'Sonda',
    docs: 'Otevře nebo zavře Sondu nad kteroukoli pracovní plochou; zvuk nechá hrát.',
    state: 'ui.lensOpen',
    related: ['lens'],
  }),
  defineComponent({
    id: 'header.lens',
    kind: 'switch',
    label: 'Sonda',
    docs: 'Otevře nebo zavře Sondu z navigační lišty od šířky tabletu; zvuk nechá hrát.',
    state: 'ui.lensOpen',
    related: ['lens', 'status.lens'],
  }),
  defineComponent({
    id: 'lens',
    kind: 'panel',
    label: 'Sonda',
    docs: 'Ukazuje pozorovaný výstup za omezovačem a jmenuje zdroj, který právě zní.',
    state: { none: 'panel rozkládá pozorované pohledy a nevlastní žádnou hodnotu' },
  }),
  defineComponent({
    id: 'lens.subject',
    kind: 'readout',
    label: 'Co zní',
    docs: 'Jmenuje zdroj, kterému právě patří výstup, nebo řekne, že nic nehraje.',
    state: { none: 'čte vlastníka zveřejněného sběrnicí přehrávání a nic nemění' },
    in: 'lens',
  }),
  defineComponent({
    id: 'lens.view',
    kind: 'choice',
    label: 'Pohled Sondy',
    docs: 'Vybere pozorovaný pohled Sondy: průběh, spektrum nebo spektrogram.',
    state: 'ui.analysisTab',
    in: 'lens',
  }),
];
