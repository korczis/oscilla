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
    docs: 'Warns beside the gain that the output is clipped at its ceiling while it sounds.',
    state: 'instrument.gainLevel',
  }),
  defineComponent({
    id: 'status.ceiling',
    kind: 'readout',
    label: 'Ceiling in the status bar',
    docs: 'Replaces the status label with the ceiling warning while the output clips.',
    state: 'instrument.gainLevel',
  }),
  defineComponent({
    id: 'seq.unsaved',
    kind: 'readout',
    label: 'unsaved sequence',
    docs: 'Flags a sequence edited since it was last exported or loaded.',
    state: { none: 'it compares two digests and edits nothing' },
  }),
  defineComponent({
    id: 'copy.note',
    kind: 'readout',
    label: 'Config link note',
    docs: 'Says what the copied config link restores and that it never starts playback.',
    state: { none: 'it describes the link and edits nothing' },
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
