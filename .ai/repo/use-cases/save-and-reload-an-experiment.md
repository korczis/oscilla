---
id: save-and-reload-an-experiment
kind: use-case
title: 'Save and reload an experiment'
summary: 'Save a measurement as an experiment in the browser and open it again later, or learn plainly that it lives only in memory.'
category: experiments
status: active
target: advisory
weight: 190
difficulty: basic
commands: [knowledge]
claims: [experiment-persistence, reproducible-experiments, experiment-round-trip]
tags: [oscilla, product-acceptance, v3]
---

# Situation

After a measurement someone presses Save experiment, closes the tab and comes back the
next day to open it in Experiments.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-experiments.test.mjs: IndexedDB open, upgrade, CRUD and reopen on an in-process fake, quota and open failures, memory fallback; round trip)
- `npm run test:measure` (tests/browser/v3-ui.cjs, checks loopback-workflow (save, repeat as a new experiment) and experiments (list, open, rename, duplicate, delete with confirmation))

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

Not provable here: no test closes a real browser page and reads the record back after a
reload; persistence across sessions is proven on the IndexedDB fake only. Browser storage can
be cleared by the person or the browser; export is the durable path.

# Scenario

```yaml
mode: live
steps:
  - id: experiment-persistence-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim experiment-persistence is implemented by src/js/experiments/store.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-persistence +implementation:src/js/experiments/store\.js']
  - id: experiment-persistence-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim experiment-persistence is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-persistence +test:tests/unit/v3-experiments\.test\.mjs']
  - id: reproducible-experiments-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim reproducible-experiments is implemented by src/js/experiments/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:reproducible-experiments +implementation:src/js/experiments/schema\.js']
  - id: reproducible-experiments-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim reproducible-experiments is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:reproducible-experiments +test:tests/unit/v3-experiments\.test\.mjs']
  - id: experiment-round-trip-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim experiment-round-trip is implemented by src/js/experiments/encode.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-round-trip +implementation:src/js/experiments/encode\.js']
  - id: experiment-round-trip-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim experiment-round-trip is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-round-trip +test:tests/unit/v3-experiments\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The experiment is kept in the IndexedDB database `oscilla-experiments` with its recipe,
device, calibration, quality, algorithm IDs, product version and hashes, and opens again
identically. When IndexedDB is unavailable (some browsers under file://, private windows)
it is kept in memory and the workspace says so.
