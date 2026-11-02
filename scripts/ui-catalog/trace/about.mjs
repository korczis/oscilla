// Trace of the About lists (plan issue G001, ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/about.js, the module that carries its hooks, the plan issues, intent
// criteria and decisions it serves, and the tests that name its hooks (NAMED, not VERIFIED).
// The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'about.workspaces': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/about-current.test.mjs',
      'tests/browser/app.cjs'] }),
  'about.workspace': entry({ source: 'src/index.html', plan: ['G001', 'F002'],
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'about.open': entry({ source: 'src/index.html', plan: ['G001', 'F002'],
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'about.next': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/about-current.test.mjs',
      'tests/browser/app.cjs'] }),
};
