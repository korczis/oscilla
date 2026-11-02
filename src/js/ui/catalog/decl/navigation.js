// Declarations: the workspace navigation (ui/app.js; the bar in src/index.html). The grouped
// entries are built at run time and declared as patterns whose keys are the values the callers
// pass; the Synth entry is a literal link (plan issue G001).
// Trace: scripts/ui-catalog/trace/navigation.mjs.

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
  defineComponent({
    id: 'nav.synth',
    kind: 'open',
    label: 'Synth',
    docs: 'Opens the Synth workspace, the semi-modular voice with its patch bay and keys.',
    state: 'ui.workspace',
    effect: { route: 'synth' },
  }),
];
