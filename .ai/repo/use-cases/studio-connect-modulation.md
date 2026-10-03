---
id: studio-connect-modulation
kind: use-case
title: 'Modulate a filter cutoff with an LFO'
summary: 'Connect an LFO control output to the Filter cutoff parameter port and set the modulation depth on the cable.'
category: studio
status: draft
target: advisory
weight: 310
difficulty: intermediate
commands: [knowledge]
claims: [studio-typed-connections, studio-feedback-rejected, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone adds an LFO beside the filter of a working chain and drags its control output onto the Filter cutoff port (specification §14 UC2). The cable is dashed, carries a depth of 1200 Hz bipolar, and the cutoff moves around its set value.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- A CONTROL output connects only to a PARAMETER input, which knows its parameter, unit, range and mapping (tests "parameter target ports know parameter, unit, range and mapping (§34)" and "port compatibility matrix: only same-type connections are allowed (§31, §33)").
- Depth, polarity, mapping and offset live on the edge with unit-aware bounds; the Basic Synth edge `lfo-1.control → filter-1.frequency` carries depth 1200, bipolar (tests "modulation edge properties: depth, polarity, mapping, offset (§35)" and "§257 Basic Synth topology builds and validates").
- A modulation loop is refused as a control cycle (test "control-cycle policy (§40)").

Not yet provable:

- Cable drag and the connection inspector (issues V411, V413).
- The modulation signal in Web Audio: compiler and modulation test (issue V414, specification §210). Claim `studio-compiled-topology` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-typed-connections-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-typed-connections is implemented by src/js/studio/ports.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-typed-connections +implementation:src/js/studio/ports\.js']
  - id: studio-typed-connections-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-typed-connections is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-typed-connections +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-feedback-rejected-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-feedback-rejected is implemented by src/js/studio/validate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-feedback-rejected +implementation:src/js/studio/validate\.js']
  - id: studio-feedback-rejected-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-feedback-rejected is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-feedback-rejected +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-compiled-topology-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-compiled-topology is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-compiled-topology +document:docs/specs/oscilla-v3\.1-studio\.md']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

The modulation is an edge of the model with its own depth (ADR 0037); compiled, it adds to the cutoff value and never rewrites the cutoff automation.
