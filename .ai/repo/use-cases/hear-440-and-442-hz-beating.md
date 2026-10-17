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
claims: [dual-oscillator-beats, phase-and-lissajous-model, stereo-correlation-meter]
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
- `npm test` (tests/unit/charts.test.mjs: the phase view and the Lissajous figure computed from the two frequencies and phases; tests/unit/analysis-misc.test.mjs: the correlation meter reads +1 in phase, -1 inverted, about 0 in quadrature and resets on silence)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
play audio. It proves the traceability instead: each claim's implementation and test are
tracked files wired to the claim in the knowledge graph, so a renamed or deleted test
breaks this use case rather than silently orphaning the claim. Majordomus classes
`knowledge` as state-mutating from 0.11 on, and a live scenario may run only read-only
commands, so the setup `oscilla-tree` (`test/fixtures/commands/setup/oscilla-tree.sh`)
copies the tracked files of this checkout into a disposable repository and the steps ask
the knowledge graph of that copy.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
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
  - id: phase-and-lissajous-model-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim phase-and-lissajous-model is implemented by src/js/charts/phase-model.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:phase-and-lissajous-model +implementation:src/js/charts/phase-model\.js']
  - id: phase-and-lissajous-model-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim phase-and-lissajous-model is proven by tests/unit/charts.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:phase-and-lissajous-model +test:tests/unit/charts\.test\.mjs']
  - id: stereo-correlation-meter-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim stereo-correlation-meter is implemented by src/js/analysis/correlation.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:stereo-correlation-meter +implementation:src/js/analysis/correlation\.js']
  - id: stereo-correlation-meter-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim stereo-correlation-meter is proven by tests/unit/analysis-misc.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:stereo-correlation-meter +test:tests/unit/analysis-misc\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The mono mix shows a level envelope at 2 Hz (within 0.2 Hz) with a deep modulation, and the
stereo split puts A on the left channel and B on the right. The phase view and the
Lissajous figure of the same pair are covered by the phase feature.
