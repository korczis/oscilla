---
id: studio-topology-in-experiment-provenance
kind: use-case
title: 'Keep the Studio topology in experiment provenance'
summary: 'Run a measurement from Studio and find the Studio schema version, studioHash and topology recorded in the experiment.'
category: studio
status: draft
target: advisory
weight: 410
difficulty: advanced
commands: [knowledge]
claims: [studio-experiment-provenance, studio-deterministic-hash]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

After a measurement run from Studio, someone opens the experiment, exports it, and later compares it with a run of the same topology laid out differently (specification §14 UC12).

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- The identity provenance will record exists: `studioHash` covers execution state only, so moving or renaming nodes does not change it (test "studioHash covers execution state only (§162-§163, §252-§255)").

Not yet provable:

- Recording Studio fields in the experiment and the round trip (issue V425, ADR 0038). Claim `studio-experiment-provenance` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-experiment-provenance-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-experiment-provenance is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +document:docs/specs/oscilla-v3\.1-studio\.md']
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
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

The experiment states which Studio graph and timeline ran, by schema version, hash and execution state, and two layouts of one topology compare as the same setup.
