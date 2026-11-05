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
    label: 'Insert, Replace graph',
    docs: 'Puts a saved patch into the graph, beside or instead of what is there.',
    state: 'studio.model',
  }),
  defineComponent({
    id: 'studio.saved.manage',
    pattern: { template: 'studio.saved.{key}', keys: ['delete', 'export'],
      sites: ['src/js/ui/studio/patches-panel.js'] },
    kind: 'action',
    label: 'Delete, Export',
    docs: 'Deletes a saved patch from the library or exports it as a file.',
    state: { none: 'it acts on a stored library record, not on a state path' },
    effect: { command: 'delete or export the saved patch record' },
  }),
];
