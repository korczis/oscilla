// Declarations: the lists of the About workspace (src/index.html; the roadmap of ui/about.js).
// Each list is one readout whose items carry hooks of their own, so the items are its `hooks`
// (plan issue G001). Trace: scripts/ui-catalog/trace/about.mjs.

import { WORKSPACE_IDS } from '../../shell.js';
import { defineComponent } from '../define.js';

// The list is built from the workspace registry, so its items are patterns keyed by its ids.
const WORKSPACES = [...WORKSPACE_IDS];

export default [
  defineComponent({
    id: 'about.workspaces',
    kind: 'readout',
    label: 'Workspaces',
    docs: 'Lists every workspace of the navigation in its order, with what it is for.',
    state: { none: 'the list is derived from the workspace registry' },
  }),
  defineComponent({
    id: 'about.workspace',
    pattern: { template: 'about.workspace.{key}', keys: WORKSPACES, sites: ['src/index.html'] },
    kind: 'readout',
    label: 'Workspace row',
    docs: 'Names one workspace of the registry and says in one sentence what it is for.',
    state: { none: 'the row is derived from the workspace registry' },
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.open',
    pattern: { template: 'about.open.{key}', keys: WORKSPACES.filter((w) => w !== 'about'),
      sites: ['src/index.html'] },
    kind: 'open',
    label: 'Open workspace (About)',
    docs: 'Opens the workspace a row of the About list names.',
    state: 'ui.workspace',
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.next',
    hooks: ['about.next.milestone'],
    kind: 'readout',
    label: 'What comes next',
    docs: 'Counts the done and required issues of each open milestone of the plan.',
    state: { none: 'the roadmap is a data file bundled with the build' },
  }),
];
