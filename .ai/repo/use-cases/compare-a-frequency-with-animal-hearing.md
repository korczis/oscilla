---
id: compare-a-frequency-with-animal-hearing
kind: use-case
title: 'Compare a frequency with human and animal hearing ranges'
summary: 'Open the bioacoustics panel, read where a frequency falls against cited hearing ranges and call bands, and see no claim the sources do not make.'
category: analyse
status: active
target: advisory
weight: 45
difficulty: basic
commands: [knowledge]
claims: [bioacoustics-cited, no-fake-science-in-shipped-copy]
applications: [hearing-ranges-and-bioacoustics]
tags: [oscilla, product-acceptance]
---

# Situation

Someone wants to know whether a dog or a bat could hear the 25 kHz tone they are about to
play. They open the bioacoustics panel, compare the tone with the hearing-range and call
bars, and follow a bar to the publication it comes from. What they need is a range they can
trace to its source and its threshold criterion, a plain statement that ranges vary, and no
copy anywhere in the page that promises what a frequency does to a person or an animal.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/bioacoustics.test.mjs: every value cites a full source, each hearing
  range states its criterion, each call band says what was measured, the disclaimer is in the
  page and rendered, and every bar's source is listed; tests/unit/no-fake-science.test.mjs:
  no shipped text claims a medical, wellness, cognitive or animal-specific effect,
  inaudibility or the safety of a frequency, except in a sentence that negates it)

Whether each value is the one its source gives is reviewed against the sources, not tested.

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
open the page. It proves the traceability instead: each claim's implementation and test are
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
  - id: bioacoustics-cited-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim bioacoustics-cited is implemented by src/js/data/bioacoustics.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:bioacoustics-cited +implementation:src/js/data/bioacoustics\.js']
  - id: bioacoustics-cited-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim bioacoustics-cited is proven by tests/unit/bioacoustics.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:bioacoustics-cited +test:tests/unit/bioacoustics\.test\.mjs']
  - id: no-fake-science-in-shipped-copy-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim no-fake-science-in-shipped-copy is implemented by src/index.html, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:no-fake-science-in-shipped-copy +implementation:src/index\.html']
  - id: no-fake-science-in-shipped-copy-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim no-fake-science-in-shipped-copy is proven by tests/unit/no-fake-science.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:no-fake-science-in-shipped-copy +test:tests/unit/no-fake-science\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Each bar carries its range, its basis and its citation with a link; a hearing range says the
dB SPL level its limits were taken at, or that its source states none; the panel says that
ranges are approximate and vary by source and individual. Nothing in the page says what an
animal hears from these speakers or what a frequency does to anyone (rule
`project.no-fake-science`).
