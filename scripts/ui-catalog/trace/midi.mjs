// Trace of the MIDI section of the Settings dialog (plan issues V501, V507; ADR 0058): for each
// declaration of src/js/ui/catalog/decl/midi.js, the module that carries its hook, the plan
// issues, intent criteria and decisions it serves, and the tests that name its hooks (NAMED,
// not VERIFIED). The docs-only part: it lives outside src/, so the app never imports it.

const entry = (e) => ({ plan: ['G001', 'V501'], intents: ['midi-jam-companion#midi-support-state'],
  adrs: ['adr-0058', 'adr-0081'], source: 'src/index.html', ...e });
const v507 = { plan: ['G001', 'V507'], intents: ['midi-jam-companion#midi-devices-known'] };

export default {
  'midi.status': entry({ tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.actions': entry({ tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.connect': entry({ tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.devices': entry({ ...v507,
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.monitor': entry({ ...v507,
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.clock': entry({ plan: ['G001', 'V508'], intents: ['midi-jam-companion#midi-transport-clock'],
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
  'midi.monitor-clear': entry({ ...v507,
    tests: ['tests/unit/ui-catalog.test.mjs', 'tests/browser/midi.cjs'] }),
};
