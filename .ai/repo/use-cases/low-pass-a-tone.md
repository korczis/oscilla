---
id: low-pass-a-tone
kind: use-case
title: 'Low-pass a 5 kHz tone at 500 Hz'
summary: 'Enable the Filter Lab low-pass at 500 Hz, play a 5 kHz tone, and hear it drop; bypass it and the level returns.'
category: shape
status: active
target: advisory
weight: 60
difficulty: basic
commands: [knowledge]
claims: [lowpass-attenuates]
tags: [oscilla, product-acceptance]
---

# Situation

A student wants to see what a low-pass filter does. They pick the low-pass type, set the
cutoff to 500 Hz, and play a tone a decade above it.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:browser` (tests/browser/app.cjs, check labs-basic)
- tests/browser/labs.cjs compares the drawn response with getFrequencyResponse; not yet in the release gate

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: lowpass-attenuates-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim lowpass-attenuates is implemented by src/js/audio/filters.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:lowpass-attenuates +implementation:src/js/audio/filters\.js']
  - id: lowpass-attenuates-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim lowpass-attenuates is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:lowpass-attenuates +test:tests/browser/app\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

With the filter enabled the 5 kHz tone's level falls below a fifth of the set gain; with it
bypassed the level is back to the gain within 0.01.
