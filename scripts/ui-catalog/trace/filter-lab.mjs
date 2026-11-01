// Trace of the Filter Lab parameters (plan issue G001, ADR 0081 decision 4): for each declaration
// of src/js/ui/catalog/decl/filter-lab.js, the module that carries its hook, the plan issues,
// intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'filter.enable': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'filter.type': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'filter.cutoff': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'filter.q': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'filter.gain': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs'] }),
  'filter.fullscreen': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
};
