// Declarations: the saved-patch rows of the Studio library (ui/studio/patches-panel.js).
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/studio-patches.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'studio.saved.apply',
    pattern: { template: 'studio.saved.{key}', keys: ['insert', 'replace'],
      sites: ['src/js/ui/studio/patches-panel.js'] },
    kind: 'action',
    label: 'Vložit, Nahradit graf',
    docs: 'Vloží uložený patch do grafu, vedle toho, co v něm je, nebo místo toho.',
    state: 'studio.model',
  }),
  defineComponent({
    id: 'studio.saved.manage',
    pattern: { template: 'studio.saved.{key}', keys: ['delete', 'export'],
      sites: ['src/js/ui/studio/patches-panel.js'] },
    kind: 'action',
    label: 'Smazat, Exportovat',
    docs: 'Smaže uložený patch z knihovny, nebo ho exportuje jako soubor.',
    state: { none: 'pracuje s uloženým záznamem knihovny, ne s cestou stavu' },
    effect: { command: 'smazat nebo exportovat záznam uloženého patche' },
  }),
];
