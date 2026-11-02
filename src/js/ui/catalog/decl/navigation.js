// Declarations: the workspace navigation groups (ui/app.js; the sidebar of src/index.html and
// ui/shell.js). The grouped entries are built at run time and declared as a pattern whose keys
// are the groups of the registry; the workspace entries themselves are nav.workspaces of
// decl/shell.js (plan issue G001).
// Trace: scripts/ui-catalog/trace/navigation.mjs.

import { GROUP_REGISTRY } from '../../shell.js';
import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'nav.groups',
    pattern: { template: 'nav-group.{key}', keys: Object.keys(GROUP_REGISTRY),
      sites: ['src/js/ui/app.js', 'src/index.html', 'src/js/ui/shell.js'] },
    kind: 'open',
    label: 'ANALYZE, SYNTHESIS',
    docs: 'Opens the menu of workspaces grouped under one navigation entry.',
    state: 'ui.navOpen',
  }),
];
