---
id: studio-sequence-multiple-events
kind: use-case
title: 'Sequence a tone, a sweep and a pulse on the Studio timeline'
summary: 'Place Tone, Sweep and Pulse clips one after another on an event track and play them in order.'
category: studio
status: draft
target: advisory
weight: 330
difficulty: basic
commands: [knowledge]
claims: [studio-timeline-model, studio-transport-audio-clock]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone adds an event track targeting an oscillator and places a Tone clip, a Sweep clip and a Pulse clip on it (specification §14 UC4), then plays the timeline.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Clips are placed in absolute seconds and carry the sequencer block payloads (tone, sweep, pulse and the other block types) checked by the sequencer block rules; the Basic Synth track holds a tone clip and a sweep clip (tests "§257 Basic Synth topology builds and validates" and "timeline actions validate references and undo exactly").

Not yet provable:

- The timeline editor and clip drag (issue V417).
- Playback on the audio clock through the sequencer compiler, and the timeline test (issues V416, V418, specification §212). Claim `studio-transport-audio-clock` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

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
  - id: studio-transport-audio-clock-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-transport-audio-clock is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-transport-audio-clock +document:docs/specs/oscilla-v3\.1-studio\.md']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

The three clips play in order at their scheduled AudioContext times, stop leaves no node, and the sequence round-trips in the Studio file.
