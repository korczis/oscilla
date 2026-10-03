---
id: measure-an-impulse-response
kind: use-case
title: 'Measure an impulse response'
summary: 'Read the impulse response of the same sweep measurement, zoom to the direct sound, window it and view it normalised without altering the stored response.'
category: measure
status: active
target: advisory
weight: 150
difficulty: intermediate
commands: [knowledge]
claims: [impulse-response]
tags: [oscilla, product-acceptance, v3]
---

# Situation

After a sweep measurement someone wants to see reflections. They open the Impulse response
tab, zoom from the direct sound to the early part, show the analysis window and switch to
the dB view normalised to the peak.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-transfer-ir.test.mjs: identity and delayed impulses, an echo of 0.5 read at -6.02 dB, the Farina inverse filter as oracle, non-destructive windowing; tests/unit/v3-views.test.mjs IR view labels)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check loopback-workflow: the IR summary after a loopback measurement)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

The peak time is where the sweep starts in the recording, including unknown device and
browser delays; no test can turn it into a time of flight or a latency. RT60, EDT, T20 and T30
are V3.1 and not computed.

# Scenario

```yaml
mode: live
steps:
  - id: impulse-response-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim impulse-response is implemented by src/js/measurement/impulse-response.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:impulse-response +implementation:src/js/measurement/impulse-response\.js']
  - id: impulse-response-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim impulse-response is proven by tests/unit/v3-transfer-ir.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:impulse-response +test:tests/unit/v3-transfer-ir\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The impulse response is shown in ms from the direct peak with its absolute offset kept,
under its algorithm ID. Windows and normalised views are derived objects labelled
NORMALIZED; the stored response is never changed.
