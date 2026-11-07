// Trace of the saved-patch rows of the Studio library (plan issue G001, ADR 0081 decision 4): for
// each declaration of src/js/ui/catalog/decl/studio-patches.js, the module that carries its hook,
// the plan issues, intent criteria and decisions it serves, and the tests that name its hooks
// (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the app never imports or
// bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0030'], ...e });

export default {
  'studio.saved.apply': entry({ source: 'src/js/ui/studio/patches-panel.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.saved.manage': entry({ source: 'src/js/ui/studio/patches-panel.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs',
      'tests/browser/v31-studio-workflows.cjs'] }),
};
