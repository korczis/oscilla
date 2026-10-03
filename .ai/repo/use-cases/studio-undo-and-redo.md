---
id: studio-undo-and-redo
kind: use-case
title: 'Undo and redo Studio edits exactly'
summary: 'Undo a series of node, cable, clip and automation edits back to the start and redo them to the end, exactly.'
category: studio
status: draft
target: advisory
weight: 360
difficulty: basic
commands: [knowledge]
claims: [studio-exact-undo-redo]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone builds a chain, drags a node across the canvas, changes a parameter, deletes a cable, then presses undo repeatedly and redo repeatedly (specification §14 UC7).

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Undo-all returns the initial model by reference and byte-equal serialization, redo-all the final one (test "§208 history: undo all → exact initial state; redo all → exact final state").
- A 400-event drag is one history entry; a new edit after undo clears redo (tests "gesture coalescing: 400 NODE_MOVE dispatches are one history entry (§50)" and "a new edit after undo clears redo (§51)").
- Selection and view are not undoable (test "selection and view are view state: not undoable, no revision, pruned on delete").

Not yet provable:

- Keyboard shortcuts and toolbar buttons that trigger undo and redo (issue V412), and the browser history test (issue V430).

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-exact-undo-redo-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-exact-undo-redo is implemented by src/js/studio/history.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-exact-undo-redo +implementation:src/js/studio/history\.js']
  - id: studio-exact-undo-redo-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-exact-undo-redo is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-exact-undo-redo +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Every edit is one labelled step back and forward, and the restored state is exactly the earlier one.
