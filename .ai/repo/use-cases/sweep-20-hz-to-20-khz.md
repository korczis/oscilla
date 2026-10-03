---
id: sweep-20-hz-to-20-khz
kind: use-case
title: 'Sweep 20 Hz to 20 kHz on a log curve'
summary: 'Choose the sweep pattern, keep or narrow its range, trigger it, and watch the frequency rise until it ends or is stopped.'
category: generate
status: active
target: advisory
weight: 20
difficulty: basic
commands: [knowledge]
claims: [sweep-rises-through-range]
tags: [oscilla, product-acceptance]
---

# Situation

Someone wants to hear where their speakers or ears stop: the sweep pattern defaults to
20 Hz to 20 kHz on a log curve over 10 s. They trigger it and watch the spectrum peak climb,
or stop it early with Escape.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm run test:browser` (tests/browser/app.cjs, check pattern-select-plays-sweep)
- `npm run test:engine` (tests/browser/engine-v1port.cjs: a 10 s sweep plays 10 s)

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
  - id: sweep-rises-through-range-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim sweep-rises-through-range is implemented by src/js/audio/scheduler.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:sweep-rises-through-range +implementation:src/js/audio/scheduler\.js']
  - id: sweep-rises-through-range-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim sweep-rises-through-range is proven by tests/browser/app.cjs'
    expect:
      exit: 0
      stdout_contains: ['claim:sweep-rises-through-range +test:tests/browser/app\.cjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The instantaneous frequency and the spectrum peak both rise through the requested range,
the transport names the pattern, and stopping leaves no audio node. The browser check
narrows the range to 200 Hz to 4 kHz over 2 s to stay fast; the 10 s duration of the default
sweep is held by the engine suite. Digital generation does not mean the hardware
reproduces 20 kHz, and the safety text says so.
