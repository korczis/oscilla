---
id: studio-build-a-signal-path
kind: use-case
title: 'Build a simple signal path in Studio'
summary: 'Place Oscillator, Envelope, Filter and Master Output nodes and connect them into a sounding chain.'
category: studio
status: draft
target: advisory
weight: 300
difficulty: basic
commands: [knowledge]
claims: [studio-typed-connections, studio-registry-reuses-engine, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone opens Studio and builds Oscillator → ADSR → Filter → Master Output (specification §14 UC1, the §257 Basic Synth chain). They add each node from the library, drag a cable from each audio output to the next audio input, and press play.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- The chain builds through the action layer and validates with no error and no warning, as `osc-1.audio → env-1.audio → filter-1.audio → master-1.audio` (test "§257 Basic Synth topology builds and validates").
- Every node type names the existing engine builder it will compile to and takes the engine defaults (tests "every compiler and reuse key names an existing export (§28)" and "node defaults match the existing engine defaults").

Not yet provable:

- The node library, node drag and cable drag in the editor (issues V410, V411).
- Hearing it: the graph compiler (issue V414) and the browser audio-graph test (specification §209). Claim `studio-compiled-topology` is planned.

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
  - id: studio-registry-reuses-engine-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-registry-reuses-engine is implemented by src/js/studio/registry.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-registry-reuses-engine +implementation:src/js/studio/registry\.js']
  - id: studio-registry-reuses-engine-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-registry-reuses-engine is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-registry-reuses-engine +test:tests/unit/v31-studio-model\.test\.mjs']
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

The chain is one valid StudioModel; once the compiler lands, the running Web Audio graph is exactly that chain, inside AudioEngine accounting, and stop leaves no node.
