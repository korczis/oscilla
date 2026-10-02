---
id: studio-define-a-measurement-pipeline
kind: use-case
title: 'Define a measurement pipeline in Studio'
summary: 'Wire Sweep to Output and Microphone through Calibration into the Transfer Analyzer with the sweep as reference.'
category: studio
status: draft
target: advisory
weight: 400
difficulty: advanced
commands: [knowledge]
claims: [studio-measurement-topology, studio-experiment-provenance]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone builds Sweep → Master Output, Sweep reference → Transfer Analyzer, Microphone capture → Calibration → Transfer Analyzer observed → Measurement Result (specification §14 UC11, the §258 template), places noise-check and stimulus clips on a measurement track, and runs it.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- The topology validates as typed analysis routing, with deterministic order, and reference and observed cannot be swapped (test "§258 Measurement topology builds and validates").
- A microphone with an audio path to Master Output is refused (test "analysis cycles and live input to output are rejected (§240)").

Not yet provable:

- Measurement node adapters over the V3 measurement engine and measurement timeline orchestration (issue V424, ADR 0038). Claim `studio-experiment-provenance` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-measurement-topology-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-measurement-topology is implemented by src/js/studio/nodes/measurement.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-measurement-topology +implementation:src/js/studio/nodes/measurement\.js']
  - id: studio-measurement-topology-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-measurement-topology is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-measurement-topology +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-experiment-provenance-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-experiment-provenance is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-experiment-provenance +document:docs/specs/oscilla-v3\.1-studio\.md']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Running the pipeline drives the existing measurement state machine and produces the same result as the Measure workspace; levels stay relative unless calibrated.
