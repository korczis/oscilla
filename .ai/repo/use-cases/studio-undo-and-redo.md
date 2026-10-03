---
id: studio-undo-and-redo
kind: use-case
title: 'Undo and redo Studio edits exactly'
summary: 'Undo a series of node, cable, clip and automation edits back to the start and redo them to the end, exactly.'
category: studio
status: active
target: advisory
weight: 360
difficulty: basic
commands: [knowledge]
claims: [studio-exact-undo-redo]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone builds a chain, drags a node across the canvas, changes a parameter, deletes a cable,
then presses Ctrl/⌘ Z repeatedly and Ctrl/⌘ Shift Z (or Ctrl Y) repeatedly (specification §14
UC7).

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("§208 history: undo all → exact initial
  state; redo all → exact final state", "gesture coalescing: 400 NODE_MOVE dispatches are one
  history entry", "a new edit after undo clears redo", "selection and view are view state: not
  undoable") and tests/unit/v31-studio-timeline.test.mjs ("undo/redo of clip move/resize (one
  gesture) and automation point edits is exact").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs checks library-add (undo, redo),
  node-drag (one history entry, undo restores the position exactly), inspector (a slider drag is
  one entry) and pan-zoom-frame (view changes are not undoable), in Chromium, Firefox and WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
open a browser or play audio. It proves the traceability instead: each claim's
implementation and test are tracked files wired to the claim in the knowledge graph, so a
renamed or deleted test breaks this use case rather than silently orphaning the claim.
Majordomus classes `knowledge` as state-mutating from 0.11 on, and a live scenario may run
only read-only commands, so the setup `oscilla-tree`
(`test/fixtures/commands/setup/oscilla-tree.sh`) copies the tracked files of this checkout
into a disposable repository and the steps ask the knowledge graph of that copy. The
behaviour itself is proven by the commands above, which the release gate runs and CI blocks
a merge on.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
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
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Every edit is one labelled step back and forward, a continuous drag is one step, and the
restored state is exactly the earlier one.
