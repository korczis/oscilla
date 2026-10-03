---
id: studio-reject-an-invalid-connection
kind: use-case
title: 'See an invalid Studio connection rejected with a reason'
summary: 'Try to connect incompatible ports or close an audio loop and get a refusal that says why, with nothing changed.'
category: studio
status: draft
target: advisory
weight: 320
difficulty: basic
commands: [knowledge]
claims: [studio-typed-connections, studio-feedback-rejected]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone drags an audio output onto a trigger input, then wires a filter output back into the mixer that feeds it (specification §14 UC3). Both connections are refused with a sentence, and the graph and the sound stay as they were.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Incompatible types, wrong direction, unknown ports and self connections are refused by `canConnect` with a sentence such as "Audio output cannot connect to a trigger input." (tests "port compatibility matrix: only same-type connections are allowed (§31, §33)" and "canConnect rejects wrong direction, unknown ports and self-connection").
- A rejected EDGE_ADD leaves model, history and revision unchanged (test "rejected EDGE_ADD leaves model, history and revision unchanged").
- An instantaneous audio loop is refused with "Connection rejected: This would create an unsupported instantaneous audio feedback loop." (test "cycle detection: audio feedback rejected with the spec message (§38-§39, §241)").

Not yet provable:

- The editor showing the refusal while the cable is dragged, and the live-region announcement (issues V411, V428).

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
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Nothing invalid reaches the model or Web Audio (rules `project.typed-ports` and `project.no-silent-feedback`); the user reads why.
