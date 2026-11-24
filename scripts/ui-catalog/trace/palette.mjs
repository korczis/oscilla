// Trace of the command palette (ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/palette.js, the module that carries its hook, the plan issue and
// intent criterion it serves (everything reachable, U130), the decisions it follows (the one
// hash dispatcher, ADR 0045; the catalogue, ADR 0081; the Pro modal, ADR 0061) and the tests
// that name its hooks (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the
// app never imports or bundles it.

const entry = (e) => ({ plan: ['U130'], intents: ['one-instrument#everything-reachable'],
  adrs: ['adr-0081', 'adr-0045', 'adr-0061'], source: 'src/js/ui/palette.js',
  tests: ['tests/unit/palette.test.mjs', 'tests/browser/palette.cjs'], ...e });

export default {
  palette: entry({ source: 'src/index.html' }),
  'palette.input': entry(),
  'palette.list': entry(),
};
