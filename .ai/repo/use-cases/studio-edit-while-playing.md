---
id: studio-edit-while-playing
kind: use-case
title: 'Edit the Studio graph while it plays without leaking nodes'
summary: 'Add, remove and reconnect nodes during playback and hear the change without a click, with nothing left running after stop.'
category: studio
status: active
target: advisory
weight: 350
difficulty: advanced
commands: [knowledge]
claims: [studio-click-free-live-edit, studio-compiled-topology]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

While the Subtractive Synth plays, someone inserts a Gain node between Filter and Master
Output, removes the LFO and changes the Filter type (specification §14 UC6), then stops.

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-compiler.test.mjs ("diff: a parameter change updates the
  existing node", "§209 remove the filter: crossfade to the new route, then release the old
  nodes", "a failed transaction leaves the previous runtime intact and leaks nothing", "20 edits
  during playback then stop: 0 tracked nodes, 0 live sources") and
  tests/unit/v31-studio-timeline.test.mjs (edits during playback reschedule from the safe horizon).
- `npm run test:studio`: tests/browser/v31-studio-audio.cjs §45 (click ratio below the threshold
  for reconnect, filter insertion, waveform replacement, mute and stop) and §213 (20 edits, then
  0 engine, runtime and live nodes, no growth over 3 cycles), and tests/browser/v31-studio-graph.cjs
  check play-stop, in Chromium, Firefox and WebKit.

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
  - id: studio-click-free-live-edit-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-click-free-live-edit is implemented by src/js/studio/runtime.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-click-free-live-edit +implementation:src/js/studio/runtime\.js']
  - id: studio-click-free-live-edit-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-click-free-live-edit is proven by tests/browser/v31-studio-audio.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-click-free-live-edit +test:tests/browser/v31-studio-audio\.cjs']
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

Each edit is heard without a click, the runtime is never half-connected, and after stop the
engine and independent node counts are zero. `engine.stopAll()` does not reach the Studio
graph; Studio STOP and Escape do (docs/v31/compiler.md, "Known limitations").
