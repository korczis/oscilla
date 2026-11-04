// Trace of the workspace navigation (plan issue G001, ADR 0081 decision 4): for each declaration
// of src/js/ui/catalog/decl/navigation.js, the module that carries its hook, the plan issues,
// intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001', 'F002'],
  intents: ['component-system#contract-and-registry'], adrs: ['adr-0081', 'adr-0061'], ...e });

export default {
  'nav.groups': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/v3-ui.test.mjs',
      'tests/browser/app.cjs', 'tests/browser/demo-song.cjs'] }),
  'nav.workspaces': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/v3-ui.test.mjs',
      'tests/browser/app.cjs', 'tests/browser/qa-regressions.cjs',
      'tests/browser/ui-flowbite-pro.cjs', 'tests/browser/v31-studio-graph.cjs'] }),
};
