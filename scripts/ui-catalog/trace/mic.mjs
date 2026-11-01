// Trace of the microphone analyser's compare switches (plan issue G001, ADR 0081 decision 4): for
// each declaration of src/js/ui/catalog/decl/mic.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'mic.compare': entry({ source: 'src/js/labs/mic-analyzer.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/app.cjs', 'tests/browser/labs.cjs',
      'tests/unit/control-drive-baseline.test.mjs'] }),
};
