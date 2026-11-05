// Trace of the generator's parameter fields (plan issue G001, ADR 0081 decision 4): for each
// declaration of src/js/ui/catalog/decl/pattern-params.js, the module that carries its hook, the
// plan issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED,
// not VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles
// it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'pattern.param': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/control-drive-baseline.test.mjs',
      'tests/browser/app.cjs'] }),
  'sweep.param': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/control-drive-baseline.test.mjs'] }),
};
