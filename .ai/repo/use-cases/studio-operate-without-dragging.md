---
id: studio-operate-without-dragging
kind: use-case
title: 'Operate Studio without pointer dragging'
summary: 'Connect ports, nudge nodes, and move, resize and edit clips and automation points with the keyboard, or connect by tapping on touch.'
category: studio
status: active
target: advisory
weight: 420
difficulty: intermediate
commands: [knowledge]
claims: [studio-non-drag-operation, studio-typed-connections]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone using only a keyboard and a screen reader adds an Oscillator and a Filter (Node
library buttons, or **N** for the picker), focuses the Oscillator with Tab, presses **C** and
chooses the Filter input from the list of compatible inputs, nudges nodes with the arrows,
and moves a clip later on the timeline with the arrow keys or its details panel (specification
§14 UC13). On a phone they tap an output, then a highlighted input.

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-ui-graph-view.test.mjs ("connection targets list every
  other input with its verdict", "the shortcut table resolves keys without taking Tab or
  typing"), tests/unit/v31-studio-templates.test.mjs ("§143 node, connection and port labels",
  "§144 semantic announcements from real store results; never coordinates") and
  tests/unit/v31-studio-model.test.mjs ("port visuals are distinguishable without colour").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs checks keyboard-connect,
  controls-labelled (every control named and keyboard-reachable), mobile-tap-connect (375 × 812
  touch, 44 px targets) and tests/browser/v31-studio-timeline.cjs checks clip-keyboard and
  automation, in Chromium, Firefox and WebKit.

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

# What it cannot prove

Dragging several clips at once is not built, by pointer or keyboard. The **N** picker
has a keyboard path but no browser check of its own.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: studio-non-drag-operation-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-non-drag-operation is implemented by src/js/ui/studio/graph-keys.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-non-drag-operation +implementation:src/js/ui/studio/graph-keys\.js']
  - id: studio-non-drag-operation-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-non-drag-operation is proven by tests/browser/v31-studio-graph.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-non-drag-operation +test:tests/browser/v31-studio-graph\.cjs']
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
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Each of these operations has a non-drag path that dispatches the same store actions as the
pointer path, and changes are announced in words, never coordinates.
