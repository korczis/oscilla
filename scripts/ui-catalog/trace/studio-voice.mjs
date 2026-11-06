// Trace of the Signal Path's Open in Studio and its guard dialog (plan issues G001, V605, ADR 0081
// decision 4): for each declaration of src/js/ui/catalog/decl/studio-voice.js, the module that
// carries its hook, the plan issues, intent criteria and decisions it serves, and the tests that
// name its hooks (NAMED, not VERIFIED). The docs-only part: it lives outside src/, so the app
// never imports or bundles it.

const entry = (e) => ({ plan: ['G001', 'V605'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0030'], ...e });

const TESTS = ['tests/unit/ui-catalog.test.mjs', 'tests/browser/qa-regressions.cjs'];

export default {
  'analysis.openInStudio': entry({ source: 'src/index.html', tests: TESTS }),
  'studio.voice.lost': entry({ source: 'src/js/ui/studio/workspace/voice.js', tests: TESTS }),
  'studio.voice.replace': entry({ source: 'src/js/ui/studio/workspace/voice.js', tests: TESTS }),
  'studio.voice.keep': entry({ source: 'src/js/ui/studio/workspace/voice.js', tests: TESTS }),
};
