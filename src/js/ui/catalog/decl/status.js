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
  // U138: the reload's recovery notice (ui/session-draft.js).
  defineComponent({
    id: 'draft.notice',
    kind: 'readout',
    label: 'Obnovená práce',
    docs: 'Po opětovném načtení stránky jmenuje, co se vrátilo z rozpracované relace: nástroj, '
      + 'laboratoře, patch Synthu a sekvenci (U138).',
    state: { none: 'ukazuje větu obnovy a nic neupravuje' },
  }),
  defineComponent({
    id: 'draft.reset',
    kind: 'action',
    label: 'Začít znovu',
    docs: 'Vrátí obnovené části do stavu, s nímž se stránka otevřela, a zahodí rozpracovanou '
      + 'relaci (U138).',
    state: 'instrument.frequency',
    effect: { command: 'zahodit obnovenou práci' },
    in: 'draft.notice',
  }),
  defineComponent({
    id: 'draft.close',
    kind: 'action',
    label: 'Zavřít oznámení',
    docs: 'Zavře oznámení o obnovené práci; obnovené části zůstanou (U138).',
    state: { none: 'skryje jen oznámení a obnovené části nechá' },
    effect: { command: 'zavřít oznámení o obnovené práci' },
    in: 'draft.notice',
  }),
];
