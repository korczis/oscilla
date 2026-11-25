// Trace of Sonda, the observed lens (ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/lens.js, the module that carries its hook, the plan issue, intent
// criterion and decisions it serves (the views name what sounds, C069 and ADR 0063; the Pro
// drawer, ADR 0061), and the tests that name its hooks (NAMED, not VERIFIED). The docs-only
// part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['C069'], intents: ['coherent-state#views-describe-what-sounds'],
  adrs: ['adr-0081', 'adr-0063', 'adr-0061'], source: 'src/index.html',
  tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/journeys.cjs'], ...e });

export default {
  'status.lens': entry(),
  'header.lens': entry(),
  lens: entry(),
  'lens.subject': entry(),
  'lens.view': entry(),
};
