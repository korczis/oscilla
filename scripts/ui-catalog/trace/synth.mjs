// Trace of the Synth workspace (plan issue G001, ADR 0081 decision 4): for each declaration of
// src/js/ui/catalog/decl/synth.js, the module that carries its hook, the plan issues, intent
// criteria and decisions it serves, and the tests that name its hooks (NAMED, not VERIFIED).
// The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  'synth-view': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'synth.preset': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'synth.arm': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.studio': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.copy-link': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.tab': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth-engines.cjs'] }),
  'synth.status': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs',
      'tests/browser/synth-engines.cjs'] }),
  'synth.link': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'synth.panel': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.insert-cuts': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'synth.modules': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth-engines.cjs'] }),
  'synth.bay': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.bay.canvas': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'synth.bay.svg': entry({ source: 'src/js/synth/view/bay.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs',
      'tests/browser/synth-engines.cjs'] }),
  'synth.connect': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/synth.cjs'] }),
  'synth.cables': entry({ source: 'src/js/synth/ui.js',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
};
