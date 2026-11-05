// Declarations: the rows of the Experiments and Findings lists (src/index.html; ui/connections.js
// focuses them by a built selector).
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/records.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'records.rows',
    pattern: { template: '{key}.row', keys: ['def', 'fnd'], sites: ['src/js/ui/connections.js'] },
    kind: 'readout',
    label: 'Definition row, Finding row',
    docs: 'Lists one stored experiment definition or finding with its own actions.',
    state: { none: 'a row shows a stored record and edits nothing itself' },
  }),
];
