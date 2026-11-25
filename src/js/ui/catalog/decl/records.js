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
    label: 'Řádek definice, Řádek zjištění',
    docs: 'Vypíše jednu uloženou definici experimentu nebo zjištění s jeho vlastními akcemi.',
    state: { none: 'řádek ukazuje uložený záznam a sám nic neupravuje' },
  }),
];
