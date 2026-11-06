// Declarations: the lists of the About workspace (src/index.html; the workspace list renders the
// registry of ui/shell.js through ui/app.js aboutWorkspaces, the roadmap is ui/about.js). The
// workspace items and their links are built at run time from the registry, so they are patterns
// whose keys are its ids; About's own item links nowhere. The roadmap is one readout whose phase
// lists and items are its `hooks` (plan issues G001, U002, U006).
// Trace: scripts/ui-catalog/trace/about.mjs.

import { WORKSPACE_IDS } from '../../shell.js';
import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'about.workspaces',
    kind: 'readout',
    label: 'Workspaces',
    docs: 'Lists every workspace of the navigation in its order, with what it is for.',
    state: { none: 'the list renders the workspace registry rows' },
  }),
  defineComponent({
    id: 'about.workspace',
    pattern: { template: 'about.workspace.{key}', keys: [...WORKSPACE_IDS],
      sites: ['src/index.html'] },
    kind: 'readout',
    label: 'Workspace item',
    docs: 'Names one workspace of the list and says in one sentence what it is for.',
    state: { none: 'an item is static text of the registry' },
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.open',
    pattern: { template: 'about.open.{key}', keys: WORKSPACE_IDS.filter((id) => id !== 'about'),
      sites: ['src/index.html'] },
    kind: 'open',
    label: 'Workspace name link',
    docs: 'Opens the workspace an item of the About list names.',
    state: 'ui.workspace',
    effect: { route: 'the workspace of the item' },
    in: 'about.workspaces',
  }),
  defineComponent({
    id: 'about.next',
    hooks: ['about.next.now', 'about.next.next', 'about.next.later', 'about.next.milestone'],
    kind: 'readout',
    label: 'What comes next',
    docs: 'Counts the done and required issues of each open milestone of the plan.',
    state: { none: 'the roadmap is a data file bundled with the build' },
  }),
  defineComponent({
    id: 'about.next.later-toggle',
    kind: 'switch',
    label: 'Show the later milestones',
    docs: 'Unfolds the milestones that wait on work above, or folds them back behind their count.',
    state: 'ui.aboutLaterOpen',
    in: 'about.next',
  }),
];
