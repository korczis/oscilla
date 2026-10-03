---
id: export-an-experiment
kind: use-case
title: 'Export an experiment'
summary: 'Download an experiment as an .oscilla.json file or as CSV, and import it again elsewhere through the validated path.'
category: experiments
status: active
target: advisory
weight: 200
difficulty: basic
commands: [knowledge]
claims: [experiment-round-trip, experiment-import-validated, algorithm-ids-on-results]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone wants to keep a measurement outside the browser and send it to a colleague. They
export it as JSON and as CSV; the colleague imports the JSON file.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-experiments.test.mjs: round trip, corrupt and future-schema files refused, CSV columns; tests/unit/v3-integration.test.mjs result hash; tests/unit/v3-golden.test.mjs algorithm IDs)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check experiments: export re-validates, CSV header and units, re-import of an existing ID refused)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
play or capture audio. It proves the traceability instead: each claim's implementation and
test are tracked files wired to the claim in the knowledge graph, so a renamed or deleted
test breaks this use case rather than silently orphaning the claim. Majordomus classes
`knowledge` as state-mutating from 0.11 on, and a live scenario may run only read-only
commands, so the setup `oscilla-tree` (`test/fixtures/commands/setup/oscilla-tree.sh`)
copies the tracked files of this checkout into a disposable repository and the steps ask
the knowledge graph of that copy.

# What it cannot prove

The files are checked for structure, hashes and units; whether the measurement inside was
made carefully is what its quality status and notes say, not something an import can prove.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: experiment-round-trip-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim experiment-round-trip is implemented by src/js/experiments/encode.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-round-trip +implementation:src/js/experiments/encode\.js']
  - id: experiment-round-trip-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim experiment-round-trip is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-round-trip +test:tests/unit/v3-experiments\.test\.mjs']
  - id: experiment-import-validated-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim experiment-import-validated is implemented by src/js/experiments/validate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-import-validated +implementation:src/js/experiments/validate\.js']
  - id: experiment-import-validated-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim experiment-import-validated is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-import-validated +test:tests/unit/v3-experiments\.test\.mjs']
  - id: algorithm-ids-on-results-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim algorithm-ids-on-results is implemented by src/js/measurement/algorithms.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:algorithm-ids-on-results +implementation:src/js/measurement/algorithms\.js']
  - id: algorithm-ids-on-results-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim algorithm-ids-on-results is proven by tests/unit/v3-golden.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:algorithm-ids-on-results +test:tests/unit/v3-golden\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The JSON file carries the whole experiment with typed arrays as little-endian base64 and a
result hash; importing it yields an identical experiment, and a corrupt, oversized,
tampered or future-version file is refused with a reason. The CSV has a metadata header and
explicit unit columns; transfer magnitudes are ratios, never dB SPL.
