// Declarations: the lists of the About workspace (src/index.html; the roadmap of ui/about.js).
// Each list is one readout whose items carry hooks of their own, so the items are its `hooks`
// (plan issue G001). Trace: scripts/ui-catalog/trace/about.mjs.

import { defineComponent } from '../define.js';

const WORKSPACES = ['playground', 'measure', 'experiments', 'analyzer', 'filter', 'compare',
  'synthesis', 'sequencer', 'presets', 'learn', 'studio', 'synth', 'about'];

export default [
  defineComponent({
    id: 'about.workspaces',
    hooks: WORKSPACES.map((w) => `about.workspace.${w}`),
    kind: 'readout',
    label: 'Workspaces',
    docs: 'Lists every workspace of the navigation in its order, with what it is for.',
    state: { none: 'the list is static text of the release' },
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
