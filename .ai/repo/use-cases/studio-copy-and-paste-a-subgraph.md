---
id: studio-copy-and-paste-a-subgraph
kind: use-case
title: 'Copy and paste a Studio subgraph'
summary: 'Select a few connected nodes, copy them and paste a copy with its internal cables, offset from the original.'
category: studio
status: draft
target: advisory
weight: 370
difficulty: intermediate
commands: [knowledge]
claims: [studio-subgraph-paste]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone selects Oscillator, Envelope and Filter with the cables between them, copies, and pastes (specification §14 UC8).

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- The pasted nodes get fresh ids, only edges with both ends in the selection are kept, positions are offset, default names are renumbered and custom names kept, in one undoable step (tests "copy/paste maps a subgraph to new ids with internal edges and an offset (§121)" and "duplicate keeps relative geometry and payloads with new ids (§88, §123)").

Not yet provable:

- Selection, shortcuts and the system clipboard in the editor (issue V412, specification §122).

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-subgraph-paste-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-subgraph-paste is implemented by src/js/studio/actions.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-subgraph-paste +implementation:src/js/studio/actions\.js']
  - id: studio-subgraph-paste-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-subgraph-paste is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-subgraph-paste +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

The copy is an independent subgraph wired like the original, and one undo removes it.
