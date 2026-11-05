// Trace of the one patch library (plan issue G001, ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/patch-browser.js, the module that carries its hook, the plan issues,
// intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001', 'K102'],
  intents: ['component-system#contract-and-registry'], adrs: ['adr-0081'],
  source: 'src/js/ui/patch-browser.js', ...e });
const CATALOG = 'tests/unit/ui-catalog.test.mjs';
const SYNTH = 'tests/browser/synth.cjs';
const CENSUS = 'tests/browser/control-census.cjs';

export default {
  library: entry({ tests: [CATALOG, SYNTH] }),
  'library.search': entry({ tests: [CATALOG, CENSUS] }),
  'library.instrument': entry({ tests: [CATALOG, CENSUS, SYNTH] }),
  'library.tag': entry({ tests: [CATALOG, CENSUS, SYNTH] }),
  'library.list': entry({ tests: [CATALOG, CENSUS, SYNTH] }),
  'library.detail': entry({ tests: [CATALOG, SYNTH] }),
  'library.name': entry({ tests: [CATALOG, SYNTH] }),
  'library.detail.text': entry({ tests: [CATALOG, SYNTH] }),
  'library.inUse': entry({ tests: [CATALOG] }),
  'library.reason': entry({ tests: [CATALOG] }),
  'library.listen': entry({ tests: [CATALOG, SYNTH] }),
  'library.load': entry({ tests: [CATALOG, SYNTH] }),
  'library.save': entry({ plan: ['G001', 'K102', 'K097'], tests: [CATALOG] }),
  'library.saveName': entry({ plan: ['G001', 'K102', 'K097'], tests: [CATALOG, SYNTH] }),
  'library.capture': entry({ plan: ['G001', 'K102', 'K097'], tests: [CATALOG, SYNTH] }),
  'library.status': entry({ tests: [CATALOG] }),
};
