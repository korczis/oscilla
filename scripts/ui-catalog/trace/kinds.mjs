// Trace of the instrument kinds (plan issue W001, ADR 0081 decision 4): for each defineKind
// declaration of src/js/ui/catalog/kinds/, keyed kind:<kind>, the plan issues, the intent
// criteria it serves, its rules, ADRs and tests (the tests name the kind in a string literal),
// and the day the entry last changed. scripts/ui-catalog/kinds-check.mjs resolves every id; the
// component check (check.mjs) leaves kind:<kind> entries to it. The docs-only part: it lives
// outside src/, so the app never imports or bundles it.

export default {
  'kind:step-grid': {
    plan: ['W001', 'W008', 'K222'],
    serves: ['instrument-kinds#kind-contract', 'instrument-kinds#sequencer-surfaces'],
    rules: ['project.studio-model-is-canonical', 'project.no-inert-surfaces',
      'project.ui-uses-flowbite-pro', 'project.audio-engine-discipline',
      'project.single-file-deliverable', 'project.rules-name-their-enforcement'],
    adrs: ['adr-0081', 'adr-0086', 'adr-0061', 'adr-0050'],
    tests: ['tests/unit/ui-kinds.test.mjs', 'tests/unit/ui-kind-step-grid.test.mjs'],
    since: '2026-11-07',
  },
};
