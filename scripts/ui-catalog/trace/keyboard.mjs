// Trace of the on-screen keyboard (plan issue G001, ADR 0081 decision 4): for each declaration
// of src/js/ui/catalog/decl/keyboard.js, the module that carries its hook, the plan issues,
// intent criteria and decisions it serves, and the tests that name its hooks (NAMED, not
// VERIFIED). The docs-only part: it lives outside src/, so the app never imports or bundles it.

const entry = (e) => ({ plan: ['G001'], intents: ['component-system#contract-and-registry'],
  adrs: ['adr-0081'], ...e });

export default {
  keyboard: entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/navigation.cjs'] }),
  'keyboard.arm': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs',
      'tests/browser/navigation.cjs', 'tests/browser/demo-song.cjs'] }),
  'keyboard.octave-down': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'keyboard.octave-up': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'keyboard.velocity-down': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'keyboard.velocity-up': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'keyboard.readout': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'keyboard.held': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs'] }),
  'keyboard.keys': entry({ source: 'src/index.html',
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs',
      'tests/browser/synth.cjs', 'tests/browser/demo-song.cjs'] }),
};
