// Trace of the grouped navigation entries (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/navigation.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'nav.groups': entry({ source: 'src/js/ui/app.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs', 'tests/browser/v3-ui.cjs',
      'tests/unit/v3-ui.test.mjs'] }),
};
