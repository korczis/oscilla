// Trace of the Studio toolbar transport (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/studio-transport.js, the module that carries its hook, the
// plan issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED,
// not VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles
// it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0030'], ...e });

export default {
  'studio.toolbar.transport': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs'] }),
  'studio.toolbar.loop': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.transport': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.time': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs'] }),
  'studio.tl.state': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.mode-seconds': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'studio.tl.tempo': entry({ source: 'src/js/ui/studio/transport-bar.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-timeline.cjs',
      'tests/browser/v31-studio-workflows.cjs'] }),
};
