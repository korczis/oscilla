---
id: studio-sequence-multiple-events
kind: use-case
title: 'Sequence a tone, a sweep and a pulse on the Studio timeline'
summary: 'Place Tone, Sweep and Pulse clips one after another on a track and play them in order on the audio clock.'
category: studio
status: active
target: advisory
weight: 330
difficulty: basic
commands: [knowledge]
claims: [studio-timeline-model, studio-transport-audio-clock]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone places a Tone clip, a Sweep clip and a Pulse clip one after another on a track that
targets an Oscillator or a Sequence node (specification §14 UC4), with **+** in the track
header or by double-click, moves and resizes them with snapping, and presses **Play**
(docs/v31/user-guide.md, "Sequence on the timeline").

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-timeline.test.mjs ("§212 timeline compiles to the
  expected schedule on the audio clock": Tone, Sweep, Silence and Pulse clips at whole-frame
  times, each item exactly the sequencer's own plan of its block; "§212 fake scheduler plays
  every clip on the AudioContext clock with look-ahead") and
  tests/unit/v31-studio-transport.test.mjs ("Basic Synth: Tone and Sweep clips play on the
  oscillator at exact audio-clock times").
- `npm run test:studio`: tests/browser/v31-studio-transport.cjs (the Tone and Sweep start, meet
  and end on the predicted frames; STOP leaves 0 nodes) and tests/browser/v31-studio-timeline.cjs
  (clip-drag, clip-resize, create-split, playback), in Chromium, Firefox and WebKit.

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
  - id: studio-timeline-model-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-timeline-model is implemented by src/js/studio/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-timeline-model +implementation:src/js/studio/schema\.js']
  - id: studio-timeline-model-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-timeline-model is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-timeline-model +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-transport-audio-clock-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-transport-audio-clock is implemented by src/js/studio/transport.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-transport-audio-clock +implementation:src/js/studio/transport\.js']
  - id: studio-transport-audio-clock-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-transport-audio-clock is proven by tests/browser/v31-studio-transport.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-transport-audio-clock +test:tests/browser/v31-studio-transport\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The clips play in order at their scheduled AudioContext times, pattern clips through the
existing sequencer compiler; STOP releases every voice and the sequence round-trips in the
Studio file.
