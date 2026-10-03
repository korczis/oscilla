---
id: studio-reject-an-invalid-connection
kind: use-case
title: 'See an invalid Studio connection rejected with a reason'
summary: 'Try to connect incompatible ports or close an audio loop and get a refusal that says why, with nothing changed.'
category: studio
status: active
target: advisory
weight: 320
difficulty: basic
commands: [knowledge]
claims: [studio-typed-connections, studio-feedback-rejected]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone drags an audio output onto a control input, then wires a node's output back into
the chain that feeds it (specification §14 UC3). While the cable is dragged only compatible
inputs are emphasised; both connections are refused with a sentence, and the graph and the
sound stay as they were.

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("port compatibility matrix", "canConnect
  rejects wrong direction, unknown ports and self-connection", "rejected EDGE_ADD leaves model,
  history and revision unchanged", "cycle detection: audio feedback rejected with the spec
  message") and tests/unit/v31-studio-ui-graph-view.test.mjs ("probeConnection agrees with the
  store").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs check cable-reject (no edge, the
  type reason announced; an instantaneous feedback loop refused with the §39 sentence), in
  Chromium, Firefox and WebKit.

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
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Nothing invalid reaches the model or Web Audio (rules `project.typed-ports` and
`project.no-silent-feedback`); the user reads why, and screen readers hear it.
