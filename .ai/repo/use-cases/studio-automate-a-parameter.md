---
id: studio-automate-a-parameter
kind: use-case
title: 'Automate a filter cutoff from 500 Hz to 8 kHz'
summary: 'Add an automation lane on the Filter cutoff and ramp it from 500 Hz to 8 kHz over the timeline.'
category: studio
status: draft
target: advisory
weight: 340
difficulty: intermediate
commands: [knowledge]
claims: [studio-automation-model, studio-transport-audio-clock]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone chooses Automate on the Filter cutoff in the Inspector, adds a point at 500 Hz at 0 s and an exponential ramp to 8 kHz at 3 s (specification §14 UC5), and plays.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- The lane is accepted only on an automatable parameter, one lane per parameter, points kept sorted; the Basic Synth lane holds 500 linear at 0 s and 8000 exponential at 3 s (tests "§257 Basic Synth topology builds and validates" and "timeline actions validate references and undo exactly").
- An exponential ramp to zero and a lane on a non-automatable parameter are refused (tests "timeline actions validate references and undo exactly" and "invalid parameters, edge properties and timeline references are reported").

Not yet provable:

- Compiling the lane to AudioParam automation and the offline render check (issue V419, specification §211). Claim `studio-transport-audio-clock` is planned.
- The automation editor (issue V420).

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-automation-model-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-automation-model is implemented by src/js/studio/validate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-automation-model +implementation:src/js/studio/validate\.js']
  - id: studio-automation-model-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-automation-model is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-automation-model +test:tests/unit/v31-studio-model\.test\.mjs']
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

The cutoff follows the authored curve on the audio clock; an LFO on the same cutoff adds to it rather than replacing it (ADR 0037).
