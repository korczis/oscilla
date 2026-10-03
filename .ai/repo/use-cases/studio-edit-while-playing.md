---
id: studio-edit-while-playing
kind: use-case
title: 'Edit the Studio graph while it plays without leaking nodes'
summary: 'Add, remove and reconnect nodes during playback and hear the change click-free, with nothing left running after stop.'
category: studio
status: draft
target: advisory
weight: 350
difficulty: advanced
commands: [knowledge]
claims: [studio-click-free-live-edit, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

While the Basic Synth chain plays, someone inserts a Gain node between filter and output, removes the LFO and changes the filter type (specification §14 UC6), then stops.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Nothing at runtime yet. The model side it relies on holds: every semantic action is validated before commit and a rejected one changes nothing (test "rejected EDGE_ADD leaves model, history and revision unchanged").

Not yet provable:

- Incremental transactional patching with crossfades (issue V415, ADR 0035) and the leak test (specification §213). Claims `studio-click-free-live-edit` and `studio-compiled-topology` are planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-click-free-live-edit-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-click-free-live-edit is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-click-free-live-edit +document:docs/specs/oscilla-v3\.1-studio\.md']
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

Each edit is heard without a click, the runtime is never half-connected, and after stop the engine and independent oscillator counts are zero.
