---
id: build-a-tone-from-harmonics
kind: use-case
title: 'Build a tone from harmonics'
summary: 'Enable additive synthesis, pick a preset or set harmonic gains and phases, and hear exactly the spectrum the bars show.'
category: shape
status: active
target: advisory
weight: 70
difficulty: basic
commands: [knowledge]
claims: [additive-coefficients-play]
tags: [oscilla, product-acceptance]
---

# Situation

Someone wants to hear how a square wave is built from odd harmonics. They enable
additive synthesis, choose "Square approx", then change one harmonic's gain.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/audio-synthesis.test.mjs)
- `npm run test:browser` (tests/browser/app.cjs, check labs-basic: the carrier becomes a custom PeriodicWave)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: additive-coefficients-play-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim additive-coefficients-play is implemented by src/js/audio/additive.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:additive-coefficients-play +implementation:src/js/audio/additive\.js']
  - id: additive-coefficients-play-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim additive-coefficients-play is proven by tests/unit/audio-synthesis.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:additive-coefficients-play +test:tests/unit/audio-synthesis\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The oscillator plays a PeriodicWave whose coefficients are the ones the harmonic bars
draw; the Fourier series of square, saw and triangle converge to the ideal shapes, and the
peak is normalised with the Gibbs overshoot included.
