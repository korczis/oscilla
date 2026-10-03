---
id: studio-automate-a-parameter
kind: use-case
title: 'Automate a filter cutoff from 500 Hz to 8 kHz'
summary: 'Add an automation lane on the Filter cutoff and ramp it from 500 Hz to 8 kHz over the timeline.'
category: studio
status: active
target: advisory
weight: 340
difficulty: intermediate
commands: [knowledge]
claims: [studio-automation-model, studio-transport-audio-clock]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone selects the Filter, chooses **Automate** on its cutoff in the Inspector, adds a
point at 500 Hz at 0 s and an exponential ramp to 8 kHz at 3 s in the lane (double-click, drag,
arrow keys or a typed value such as "2 kHz"), and plays (specification §14 UC5; the
Subtractive Synth template carries this lane).

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-timeline.test.mjs ("§211 automation produces the exact
  AudioParam event list", "exponential automation to or from zero ... is rejected", "automation
  clamps to the parameter range and 0.95 × Nyquist", "AUTOMATE from the Inspector creates or
  reveals the lane"), tests/unit/v31-studio-transport.test.mjs ("cutoff automation reaches the
  filter frequency AudioParam") and tests/unit/v31-studio-ui-timeline-automation.test.mjs.
- `npm run test:studio`: tests/browser/v31-studio-transport.cjs (the automated cutoff shows in
  the spectrum at the predicted frequency at 0.15 s and 0.85 s), tests/browser/v31-studio-graph.cjs
  check inspector (AUTOMATE creates or reveals a lane) and tests/browser/v31-studio-timeline.cjs
  check automation (points added, dragged, nudged, typed; logarithmic lane), in Chromium,
  Firefox and WebKit.

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

The cutoff follows the authored curve on the audio clock; an LFO on the same cutoff adds to
it rather than replacing it (ADR 0037).
