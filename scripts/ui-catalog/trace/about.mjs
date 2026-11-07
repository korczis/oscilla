// Trace of the About lists (plan issue G001, ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/about.js, the module that carries its hooks, the plan issues, intent
// criteria and decisions it serves, and the tests that name its hooks (NAMED, not VERIFIED).
// The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], source: 'src/index.html', ...e });

export default {
  'about.workspaces': entry({ plan: ['G001', 'U006'],
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/about-current.test.mjs',
      'tests/browser/app.cjs'] }),
  'about.workspace': entry({ plan: ['G001', 'U006'],
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'about.open': entry({ plan: ['G001', 'U006'],
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'about.next': entry({ plan: ['G001', 'U002'],
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/about-current.test.mjs',
      'tests/browser/app.cjs'] }),
  'about.next.later-toggle': entry({ plan: ['G001', 'U002'],
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/about-current.test.mjs',
      'tests/browser/app.cjs', 'tests/browser/control-census.cjs'] }),
};
