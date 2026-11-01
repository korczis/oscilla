// Trace of the Studio Inspector's helper-built fields and buttons (plan issue G001, ADR 0081
// decision 4): for each declaration of src/js/ui/catalog/decl/studio-inspector.js, the module that
// carries its hook, the plan issues, intent criteria and decisions it serves, and the tests that
// name its hooks (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the app
// never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0030'], ...e });

export default {
  'studio.inspector.fields': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.inspector.settings': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-workflows.cjs'] }),
  'studio.inspector.edits': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.inspector.select': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.inspector.dialogs': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-graph.cjs'] }),
  'studio.inspector.permission': entry({ source: 'src/js/ui/studio/inspector.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v31-studio-workflows.cjs'] }),
};
