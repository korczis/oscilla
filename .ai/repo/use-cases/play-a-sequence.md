---
id: play-a-sequence
kind: use-case
title: 'Compose and play a block sequence'
summary: 'Arrange tone, sweep and silence blocks on the sequencer timeline, play it, and stop it with nothing left running.'
category: shape
status: active
target: advisory
weight: 50
difficulty: basic
commands: [knowledge]
claims: [sequencer-safe-automation]
tags: [oscilla, product-acceptance]
---

# Situation

Someone builds a short sequence: a tone, a sweep, a pause, a modulated block. They play it
from the sequencer panel and stop it partway through.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/sequencer-*.test.mjs)
- `npm run test:browser` (tests/browser/app.cjs, check labs-basic: sequencer play and stop)
- tests/browser/sequencer.cjs renders the real Web Audio graph; not yet in the release gate (peer issue R007 adds test:sequencer)

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
  - id: sequencer-safe-automation-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim sequencer-safe-automation is implemented by src/js/sequencer/compiler.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:sequencer-safe-automation +implementation:src/js/sequencer/compiler\.js']
  - id: sequencer-safe-automation-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim sequencer-safe-automation is proven by tests/unit/sequencer-compiler.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:sequencer-safe-automation +test:tests/unit/sequencer-compiler\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The timeline compiles into sorted automation whose gain never reaches zero and whose
frequencies stay between 20 Hz and the safe maximum; playing shows PLAYING and an audible
level, and stopping leaves no active source.
