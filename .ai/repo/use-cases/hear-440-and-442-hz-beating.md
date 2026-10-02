---
id: hear-440-and-442-hz-beating
kind: use-case
title: 'Hear 440 Hz against 442 Hz beat at 2 Hz'
summary: 'Enable the dual oscillator with A at 440 Hz and B at 442 Hz, mix to mono, and hear the level rise and fall twice a second.'
category: generate
status: active
target: advisory
weight: 30
difficulty: basic
commands: [knowledge]
claims: [dual-oscillator-beats]
tags: [oscilla, product-acceptance]
---

# Situation

A teacher demonstrates beating: two tones 2 Hz apart. The dual oscillator's defaults are
exactly that, A at 440 Hz and B at 442 Hz. Mixed to mono, the level should pulse at the
difference frequency; split to stereo, each ear gets one tone.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:engine` (tests/browser/engine-v1port.cjs: beating 440 + 442 Hz, level envelope at 2 +/- 0.2 Hz)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: dual-oscillator-beats-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim dual-oscillator-beats is implemented by src/js/audio/modulation.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:dual-oscillator-beats +implementation:src/js/audio/modulation\.js']
  - id: dual-oscillator-beats-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim dual-oscillator-beats is proven by tests/browser/engine-v1port.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:dual-oscillator-beats +test:tests/browser/engine-v1port\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The mono mix shows a level envelope at 2 Hz (within 0.2 Hz) with a deep modulation, and the
stereo split puts A on the left channel and B on the right. The phase view and the
Lissajous figure of the same pair are covered by the phase feature.
