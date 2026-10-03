---
id: run-a-third-octave-rta
kind: use-case
title: 'Run a third-octave RTA'
summary: 'Read one-third-octave band levels in the RTA tab of the Measure workspace with peak hold and freeze, relative unless calibrated.'
category: measure
status: active
target: advisory
weight: 160
difficulty: basic
commands: [knowledge]
claims: [rta-bands, spl-only-with-level-calibration]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone wants a band-by-band picture of the background noise in their room. In Measure they
run a measurement with the noise check enabled, open the RTA tab, which on this branch shows
the one-third-octave band power of that noise check, turn on peak hold and freeze the
display.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-rta-aggregate.test.mjs: band layout, power integration, averaging constants; tests/unit/v3-views.test.mjs RTA view, peak hold, freeze, SPL only under a valid level calibration)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check no-spl on the RTA tab)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
play or capture audio. It proves the traceability instead: each claim's implementation and
test are tracked files wired to the claim in the knowledge graph, so a renamed or deleted
test breaks this use case rather than silently orphaning the claim. Majordomus classes
`knowledge` as state-mutating from 0.11 on, and a live scenario may run only read-only
commands, so the setup `oscilla-tree` (`test/fixtures/commands/setup/oscilla-tree.sh`)
copies the tracked files of this checkout into a disposable repository and the steps ask
the knowledge graph of that copy.

# What it cannot prove

The bands use the standard base-10 edges, but no IEC 61260-1 class or sound-level-meter
conformance is claimed. The browser gate checks the RTA tab text, not the acoustic band
levels.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: rta-bands-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim rta-bands is implemented by src/js/measurement/rta.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:rta-bands +implementation:src/js/measurement/rta\.js']
  - id: rta-bands-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim rta-bands is proven by tests/unit/v3-rta-aggregate.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:rta-bands +test:tests/unit/v3-rta-aggregate\.test\.mjs']
  - id: spl-only-with-level-calibration-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim spl-only-with-level-calibration is implemented by src/js/calibration/level.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:spl-only-with-level-calibration +implementation:src/js/calibration/level\.js']
  - id: spl-only-with-level-calibration-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim spl-only-with-level-calibration is proven by tests/unit/v3-calibration.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:spl-only-with-level-calibration +test:tests/unit/v3-calibration\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Bars span each band from its lower to its upper edge, under-resolved bands are hatched,
peak hold draws dashed ticks and freeze holds the display. The axis reads dB relative
(dBFS-like) unless a valid level calibration applies.
