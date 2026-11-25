// Declarations: the warnings shown in place (src/index.html; the getters ceilingActing and
// seqUnsaved of ui/workbench.js, and the config link dialog's note, configLinkNote of the same
// module). The ceiling follows the output gain level of the instrument; the unsaved flag
// compares two digests of the sequence (plan issue G001).
// Trace: scripts/ui-catalog/trace/status.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'source.ceiling',
    kind: 'readout',
    label: 'Výstup na stropu',
    docs: 'Varuje vedle zesílení, že výstup je oříznutý na svém stropu, dokud zní.',
    state: 'instrument.gainLevel',
  }),
  defineComponent({
    id: 'status.ceiling',
    kind: 'readout',
    label: 'Strop ve stavovém řádku',
    docs: 'Nahradí popisek stavu varováním o stropu, dokud se výstup ořezává.',
    state: 'instrument.gainLevel',
  }),
  defineComponent({
    id: 'seq.unsaved',
    kind: 'readout',
    label: 'neuložená sekvence',
    docs: 'Označí sekvenci upravenou od posledního exportu nebo načtení.',
    state: { none: 'porovnává dva otisky a nic neupravuje' },
  }),
  defineComponent({
    id: 'copy.note',
    kind: 'readout',
    label: 'Poznámka k odkazu na nastavení',
    docs: 'Říká, co zkopírovaný odkaz na nastavení obnoví a že nikdy nespustí přehrávání.',
    state: { none: 'popisuje odkaz a nic nemění' },
  }),
];
