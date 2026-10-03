---
id: studio-topology-in-experiment-provenance
kind: use-case
title: 'Keep the Studio topology in experiment provenance'
summary: 'Run a measurement from Studio and find the Studio schema version, studioHash and execution state recorded in the experiment.'
category: studio
status: active
target: advisory
weight: 410
difficulty: advanced
commands: [knowledge]
claims: [studio-experiment-provenance, studio-deterministic-hash]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

After a measurement run from Studio, someone opens the experiment in **Experiments**,
exports it, and later runs the same topology with the nodes laid out differently
(specification §14 UC12).

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-provenance.test.mjs ("§109 the Studio block is schema
  version, studioHash and the execution state only", "§255 view state and presentation never
  change the provenance; parameters do", "ADR 0019: the recipe stays authoritative — Studio
  never enters configHash", "ADR 0038 round trip: export → validate → import keeps the Studio
  block byte for byte", "§109 tampering with the Studio block is corrupt") and
  tests/unit/v31-studio-model.test.mjs ("studioHash covers execution state only").
- `npm run test:studio`: tests/browser/v31-studio-workflows.cjs check measure-from-studio (the
  saved experiment carries the studioHash of the model that ran and the recipe derived from the
  topology), in Chromium, Firefox and WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not open a browser or play audio. It proves the
traceability instead: each claim's implementation and test are tracked files wired to the
claim in the knowledge graph, so a renamed or deleted test breaks this use case rather than
silently orphaning the claim. The behaviour itself is proven by the commands above, which the
release gate runs and CI blocks a merge on.

# Scenario

```yaml
mode: live
steps:
  - id: studio-experiment-provenance-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-experiment-provenance is implemented by src/js/studio/provenance.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +implementation:src/js/studio/provenance\.js']
  - id: studio-experiment-provenance-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-experiment-provenance is proven by tests/unit/v31-studio-provenance.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +test:tests/unit/v31-studio-provenance\.test\.mjs']
  - id: studio-deterministic-hash-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-deterministic-hash is implemented by src/js/studio/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-deterministic-hash +implementation:src/js/studio/schema\.js']
  - id: studio-deterministic-hash-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-deterministic-hash is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-deterministic-hash +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The experiment states which Studio graph and timeline ran, by schema version, hash and
execution state; two layouts of one topology carry the same studioHash, and the recipe, not
the Studio, decides the experiment's configHash.
