---
id: analyse-the-microphone
kind: use-case
title: 'Analyse the microphone and compare it with the generator'
summary: 'Turn the microphone on, see its spectrum and peak, and compare the observed frequency with the requested one.'
category: analyse
status: active
target: advisory
weight: 40
difficulty: basic
commands: [knowledge]
claims: [microphone-analysis-only, generator-mic-compare]
tags: [oscilla, product-acceptance]
---

# Situation

Someone plays a tone through their speakers and wants to know what the microphone
actually picks up. They press "Use microphone", grant permission, and open the Compare
tab.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/engine.test.mjs microphone cases; tests/unit/analysis-misc.test.mjs compareFrequencies)
- tests/browser/labs.cjs runs the panel against a fake capture device; it is not yet in the release gate (peer issue R007 adds test:labs)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play audio. It proves the traceability instead:
each claim's implementation and test are tracked files wired to the claim in the knowledge
graph, so a renamed or deleted test breaks this use case rather than silently orphaning
the claim.

# Scenario

```yaml
mode: live
steps:
  - id: microphone-analysis-only-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim microphone-analysis-only is implemented by src/js/audio/microphone.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:microphone-analysis-only +implementation:src/js/audio/microphone\.js']
  - id: microphone-analysis-only-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim microphone-analysis-only is proven by tests/unit/engine.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:microphone-analysis-only +test:tests/unit/engine\.test\.mjs']
  - id: generator-mic-compare-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim generator-mic-compare is implemented by src/js/analysis/compare.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:generator-mic-compare +implementation:src/js/analysis/compare\.js']
  - id: generator-mic-compare-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim generator-mic-compare is proven by tests/unit/analysis-misc.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:generator-mic-compare +test:tests/unit/analysis-misc\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The microphone is requested with echo cancellation, noise suppression and automatic gain
control off, goes to its own analyser and never to the output, and stopping ends every
track. The comparison reports the difference in hertz and cents and says match, close,
harmonic, mismatch or no signal. Everything is relative: no calibrated level and no SPL.
