// Declarations: the microphone analyser (labs/mic-analyzer.js), its compare switches.
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/mic.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'mic.compare',
    pattern: { template: 'mic.{key}', keys: ['freeze', 'average', 'peakHold'],
      sites: ['src/js/labs/mic-analyzer.js'] },
    kind: 'switch',
    label: 'Freeze, Average, Peak hold',
    docs: 'Holds, averages or keeps the peaks of the microphone spectrum on screen.',
    state: 'ui.micCompare',
  }),
];
