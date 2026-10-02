---
id: studio-operate-without-dragging
kind: use-case
title: 'Operate Studio without pointer dragging'
summary: 'Add nodes, connect ports and move nodes and clips with the keyboard and dialogs only.'
category: studio
status: draft
target: advisory
weight: 420
difficulty: intermediate
commands: [knowledge]
claims: [studio-non-drag-operation, studio-typed-connections]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone using only a keyboard and a screen reader adds an oscillator and a filter, connects them through the connection dialog, and nudges a clip later on the timeline (specification §14 UC13).

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Port shapes are distinguishable without colour and every port has an accessible label stating type, direction and connection ("Audio output port, connected to Filter 1") (test "port visuals are distinguishable without colour; labels are accessible (§32, §143)").
- The dialog will use the same `canConnect` as the editor, so its refusals carry the same sentences (claim `studio-typed-connections`).

Not yet provable:

- Tap connection mode, the accessible connection dialog, keyboard node and clip movement, focus management and live regions (issue V428, specification §138-§144). Claim `studio-non-drag-operation` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-non-drag-operation-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-non-drag-operation is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-non-drag-operation +document:docs/specs/oscilla-v3\.1-studio\.md']
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
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Every Studio operation has a non-drag path that dispatches the same actions as the pointer path.
