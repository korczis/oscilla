// Declarations: the workspace navigation (ui/app.js), its grouped entries.
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/navigation.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'nav.groups',
    pattern: { template: 'nav-group.{key}', keys: ['analyze', 'synthesis'],
      sites: ['src/js/ui/app.js'] },
    kind: 'open',
    label: 'ANALYZE, SYNTHESIS',
    docs: 'Opens the menu of workspaces grouped under one navigation entry.',
    state: 'ui.navOpen',
  }),
];
