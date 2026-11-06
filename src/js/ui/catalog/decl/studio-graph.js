// Declarations: the Studio graph editor's view controls (ui/studio/graph-editor.js).
// Only the hooks built at run time are declared here, as patterns whose keys are the values
// the callers pass (plan issue G001). Trace: scripts/ui-catalog/trace/studio-graph.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'studio.graph.view-controls',
    pattern: { template: 'studio.graph.{key}',
      keys: ['minimapToggle', 'zoomOut', 'zoomIn', 'frameAll', 'frameSelection'],
      sites: ['src/js/ui/studio/graph-editor.js'] },
    kind: 'action',
    label: 'Minimap, Zoom out, Zoom in, Frame all, Frame selection',
    docs: 'Pans and zooms the Studio graph, or shows its minimap.',
    state: 'studio.view',
  }),
];
