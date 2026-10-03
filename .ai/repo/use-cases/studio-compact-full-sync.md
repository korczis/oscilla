---
id: studio-compact-full-sync
kind: use-case
title: 'Switch between compact and full Studio on one model'
summary: 'Edit in the compact Studio widget on the Playground, expand to the full workspace and back, and see the same graph and timeline everywhere.'
category: studio
status: active
target: advisory
weight: 380
difficulty: basic
commands: [knowledge]
claims: [studio-one-store-projections, studio-model-plain-data]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone moves a clip in the compact Studio widget on the Playground with the arrow keys,
presses **EXPAND STUDIO**, adds a Filter in the full workspace, and returns to the Playground
(specification §14 UC9).

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-ui-graph-panels.test.mjs ("the compact view is a
  projection of the same model", "one store behind a stable handle") and
  tests/unit/v31-studio-model.test.mjs ("store models are frozen plain data").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs check compact-sync (the moved clip is
  the clip the full Studio and its Inspector show; the Filter appears in the compact signal path;
  selecting a chip selects it in the shared store; the store object is the same) and
  tests/browser/v31-studio-timeline.cjs check compact, in Chromium, Firefox and WebKit.

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

The compact widget's signal path is drawn from the StudioModel by its own layout
(`src/js/ui/studio/graph-layout.js`). The Playground's V2 Signal Path view
(`src/js/visualization/signal-path.js`) is not a Studio projection: it still draws the
Playground voice (docs/v31/audit-current-state.md).

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: studio-one-store-projections-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-one-store-projections is implemented by src/js/ui/studio/workspace.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-one-store-projections +implementation:src/js/ui/studio/workspace\.js']
  - id: studio-one-store-projections-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-one-store-projections is proven by tests/browser/v31-studio-graph.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-one-store-projections +test:tests/browser/v31-studio-graph\.cjs']
  - id: studio-model-plain-data-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-model-plain-data is implemented by src/js/studio/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-model-plain-data +implementation:src/js/studio/schema\.js']
  - id: studio-model-plain-data-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-model-plain-data is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-model-plain-data +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Both views render the same StudioModel; neither keeps a copy to synchronize (rule
`project.studio-model-is-canonical`).
