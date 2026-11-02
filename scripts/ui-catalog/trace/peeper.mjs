// Trace of the peeper's controls (plan issues G001 and U006, W004 for the view it hosts; ADR
// 0081 decision 4): for each declaration of src/js/ui/catalog/decl/peeper.js, the module that
// carries its hook and the tests that name it (NAMED, not VERIFIED). Docs-only, outside src/.

const entry = (e = {}) => ({ plan: ['G001', 'U006', 'W004'],
  intents: ['component-system#contract-and-registry'], adrs: ['adr-0081', 'adr-0061'],
  source: 'src/index.html',
  tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/peeper.test.mjs'], ...e });
const browser = { tests: ['tests/unit/ui-catalog.test.mjs', 'tests/unit/peeper.test.mjs',
  'tests/browser/ui-flowbite-pro.cjs'] };

export default {
  'peeper.toggle': entry(browser),
  'peeper.stub': entry(),
  'peeper.tap': entry(browser),
  'peeper.window': entry(),
  'peeper.pin': entry(browser),
  'peeper.collapse': entry(),
  'peeper.close': entry(browser),
  'peeper.canvas': entry(),
  'peeper.reason': entry(),
};
