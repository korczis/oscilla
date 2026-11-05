// Trace of the warnings shown in place (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/status.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'source.ceiling': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs'] }),
  'status.ceiling': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs'] }),
  'seq.unsaved': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/navigation.cjs'] }),
  'copy.note': entry({ source: 'src/index.html', plan: ['G001', 'C018'],
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/navigation.cjs'] }),
};
