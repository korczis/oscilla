// Trace of the visual components (plan issue G001, ADR 0081 decision 4, rule
// project.visual-components-framed): for each declaration of src/js/ui/catalog/decl/visual.js
// that no other trace file owns, the module that carries its hook, the plan issues, intent
// criteria and decisions it serves, and the tests that name its hooks (NAMED, not VERIFIED).
// keyboard, studio.compact and synth.bay keep their entries in keyboard.mjs, studio-compact.mjs
// and synth.mjs. The docs-only part: it lives outside src/, so the app never imports it.

const TESTS = ['tests/unit/ui-catalog.test.mjs', 'tests/unit/ui-frame.test.mjs'];
const entry = (e = {}) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081', 'adr-0061'], source: 'src/index.html', tests: TESTS, ...e });

export default {
  analysis: entry({ tests: [...TESTS, 'tests/browser/ui-flowbite-pro.cjs'] }),
  spectrogram: entry(),
  mic: entry(),
  'measure.resultView': entry(),
  'seq.panel': entry(),
  'filter.lab': entry(),
  envelope: entry(),
  additive: entry(),
  phase: entry(),
  bio: entry(),
  'exp.detailView': entry(),
  'exp.compareView': entry(),
  peeper: entry({ plan: ['G001', 'U067'],
    tests: [...TESTS, 'tests/unit/peeper.test.mjs', 'tests/browser/ui-flowbite-pro.cjs'] }),
};
