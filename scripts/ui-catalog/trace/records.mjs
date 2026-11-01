// Trace of the Experiments and Findings list rows (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/records.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'records.rows': entry({ source: 'src/js/ui/connections.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/v3-ui.cjs'] }),
};
