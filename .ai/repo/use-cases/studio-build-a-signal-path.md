---
id: studio-build-a-signal-path
kind: use-case
title: 'Build a simple signal path in Studio'
summary: 'Place Oscillator, Envelope, Filter and Master Output nodes, connect them with typed cables and hear the chain.'
category: studio
status: active
target: advisory
weight: 300
difficulty: basic
commands: [knowledge]
claims: [studio-typed-connections, studio-registry-reuses-engine, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone opens **Studio** and builds Oscillator → Envelope → Filter → Master Output
(specification §14 UC1, the §257 Basic Synth chain; the Subtractive Synth template is that
chain). They add each node from the Node library (click, or drag onto the graph), drag a cable
from each audio output to the next audio input, and press **Play** (docs/v31/user-guide.md,
"Create a node" and "Connect nodes").

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-model.test.mjs ("§257 Basic Synth topology builds and
  validates", "every compiler and reuse key names an existing export", "node defaults match the
  existing engine defaults") and tests/unit/v31-studio-compiler.test.mjs ("§257 Basic Synth
  compiles to a deterministic plan", "Master Output feeds only the engine safety chain").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs checks library-add, cable-connect
  and play-stop (0 engine nodes and sources after STOP), and tests/browser/v31-studio-audio.cjs
  §209 (the filtered chain's harmonic matches the browser's own biquad response), in Chromium,
  Firefox and WebKit.

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
  - id: studio-registry-reuses-engine-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-registry-reuses-engine is implemented by src/js/studio/registry.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-registry-reuses-engine +implementation:src/js/studio/registry\.js']
  - id: studio-registry-reuses-engine-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-registry-reuses-engine is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-registry-reuses-engine +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-compiled-topology-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-compiled-topology is implemented by src/js/studio/compiler.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-compiled-topology +implementation:src/js/studio/compiler\.js']
  - id: studio-compiled-topology-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-compiled-topology is proven by tests/browser/v31-studio-audio.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-compiled-topology +test:tests/browser/v31-studio-audio\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The chain is one valid StudioModel and the running Web Audio graph is that chain, built
from the existing engine builders inside AudioEngine accounting and leaving only through the
engine's safety chain; STOP leaves no node.
