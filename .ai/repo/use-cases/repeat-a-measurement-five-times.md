---
id: repeat-a-measurement-five-times
kind: use-case
title: 'Repeat a measurement five times'
summary: 'Set five runs, measure once, and get the aggregate response with its dispersion and a repeatability figure as the primary stored result.'
category: measure
status: active
target: advisory
weight: 170
difficulty: intermediate
commands: [knowledge]
claims: [aggregate-primary-response, measurement-quality]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone wants to know whether their measurement is repeatable. They set Runs to 5 in the
expert settings, keep the microphone fixed and measure once.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-storage.test.mjs: the aggregate is the primary stored response; tests/unit/v3-rta-aggregate.test.mjs mean and median aggregation; tests/unit/v3-engine.test.mjs runs never overlap; tests/unit/v3-quality.test.mjs repeatability warn and fail)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

The engine test runs three repeats, not five; the recipe allows 1 to 10 and five uses the
same path. No browser check runs five repeats through the UI.

# Scenario

```yaml
mode: live
steps:
  - id: aggregate-primary-response-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim aggregate-primary-response is implemented by src/js/measurement/aggregate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:aggregate-primary-response +implementation:src/js/measurement/aggregate\.js']
  - id: aggregate-primary-response-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim aggregate-primary-response is proven by tests/unit/v3-storage.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:aggregate-primary-response +test:tests/unit/v3-storage\.test\.mjs']
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
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The runs are captured one after another with a gap, never overlapping. The stored result is
the aggregate (centre, envelope and repeatability in dB); the stored transfer is its centre
marked as derived, never one run, and phase is absent with the reason AGGREGATED. Large
disagreement between runs lowers the quality status with a repeatability reason.
