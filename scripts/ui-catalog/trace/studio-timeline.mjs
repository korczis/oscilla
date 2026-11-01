// Trace of the Studio timeline and its details panel (plan issue G001, ADR 0081 decision 4): for
// each declaration of src/js/ui/catalog/decl/studio-timeline.js, the module that carries its hook,
// the plan issues, intent criteria and decisions it serves, and the tests that name its hooks
// (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the app never imports or
// bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0030'], ...e });

export default {
  'studio.tl.root': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs'] }),
  'studio.tl.live': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.ruler': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.scroll': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.playhead': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs'] }),
  'studio.tl.loop-band': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.snap': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.add-clip': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.timeline.zoom': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.timeline.marker': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.timeline.tools': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.details': entry({ source: 'src/js/ui/studio/timeline-editor.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs'] }),
  'studio.tl.details-status': entry({ source: 'src/js/ui/studio/timeline-details.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.d-close': entry({ source: 'src/js/ui/studio/timeline-details.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.timeline.details-actions': entry({ source: 'src/js/ui/studio/timeline-details.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.timeline.details-hints': entry({ source: 'src/js/ui/studio/timeline-details.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
};
