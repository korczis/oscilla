---
id: studio-copy-and-paste-a-subgraph
kind: use-case
title: 'Copy and paste a Studio subgraph'
summary: 'Select a few connected nodes, copy them and paste a copy with its internal cables, offset from the original.'
category: studio
status: active
target: advisory
weight: 370
difficulty: intermediate
commands: [knowledge]
claims: [studio-subgraph-paste]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone selects Oscillator, Envelope and Filter (Shift-click or a Shift-drag rectangle),
presses Ctrl/⌘ C, then Ctrl/⌘ V, or Ctrl/⌘ D to duplicate (specification §14 UC8).

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("copy/paste maps a subgraph to new ids
  with internal edges and an offset", "duplicate keeps relative geometry and payloads with new
  ids").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs check multi-select (Shift-click,
  rectangle, Ctrl/Cmd C and V with new ids, offset and internal edges kept, Ctrl/Cmd D, Delete;
  focus lands on a node), in Chromium, Firefox and WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not open a browser or play audio. It proves the
traceability instead: each claim's implementation and test are tracked files wired to the
claim in the knowledge graph, so a renamed or deleted test breaks this use case rather than
silently orphaning the claim. The behaviour itself is proven by the commands above, which the
release gate runs and CI blocks a merge on.

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
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The copy is an independent subgraph wired like the original, and one undo removes it. Node
groups are not built.
