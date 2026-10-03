---
id: measure-a-playback-capture-chain-response
kind: use-case
title: 'Measure a playback and capture chain response'
summary: 'Run the guided sweep measurement from setup check to review and read the observed response of speaker, room and microphone with its quality and valid range.'
category: measure
status: active
target: advisory
weight: 140
difficulty: intermediate
commands: [knowledge]
claims: [measurement-workbench, transfer-function, measurement-quality, measurement-abort-releases-everything]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone wants to know how their laptop speaker and microphone shape sound. They open
Measure, choose CHARACTERIZE PLAYBACK CHAIN, press Check setup (permission, input, sample
rate, background noise), then Start measurement, and read the Frequency response tab.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-transfer-ir.test.mjs synthetic known systems; tests/unit/v3-quality.test.mjs; tests/unit/v3-engine.test.mjs state flow and abort)
- `npm run test:measure` (tests/browser/v3-measure.cjs loopback recovery of a known BiquadFilterNode and 0 nodes after finish and abort; tests/browser/v3-ui.cjs checks loopback-workflow, abort-stages and output-exclusive)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

Every automated run uses a TEST CONTEXT digital loopback or a fake microphone. No test
proves the response of a physical speaker, room or microphone; only a physical measurement
does, and its result is still an estimate of the whole chain.

# Scenario

```yaml
mode: live
steps:
  - id: measurement-workbench-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim measurement-workbench is implemented by src/js/ui/measure.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-workbench +implementation:src/js/ui/measure\.js']
  - id: measurement-workbench-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim measurement-workbench is proven by tests/browser/v3-ui.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-workbench +test:tests/browser/v3-ui\.cjs']
  - id: transfer-function-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim transfer-function is implemented by src/js/measurement/transfer.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:transfer-function +implementation:src/js/measurement/transfer\.js']
  - id: transfer-function-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim transfer-function is proven by tests/unit/v3-transfer-ir.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:transfer-function +test:tests/unit/v3-transfer-ir\.test\.mjs']
  - id: measurement-quality-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim measurement-quality is implemented by src/js/measurement/quality.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-quality +implementation:src/js/measurement/quality\.js']
  - id: measurement-quality-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim measurement-quality is proven by tests/unit/v3-quality.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-quality +test:tests/unit/v3-quality\.test\.mjs']
  - id: measurement-abort-releases-everything-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim measurement-abort-releases-everything is implemented by src/js/measurement/capture.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-abort-releases-everything +implementation:src/js/measurement/capture\.js']
  - id: measurement-abort-releases-everything-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim measurement-abort-releases-everything is proven by tests/browser/v3-ui.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-abort-releases-everything +test:tests/browser/v3-ui\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The result is labelled OBSERVED PLAYBACK / CAPTURE CHAIN RESPONSE: a relative magnitude
(a ratio, never dB SPL) over its valid range, with unreliable stretches dashed, a quality
status (GOOD, USABLE, POOR or INVALID) with its reasons, and the algorithm IDs that produced
it. While it runs the instrument cannot play; Escape, STOP, hiding the page or leaving the
workspace aborts it and leaves no node, source, capture or input track behind.
