---
id: compare-two-responses
kind: use-case
title: 'Compare two responses'
summary: 'Run one definition again, select two saved experiments (or one and the baseline), see what changed between the runs by domain, including an edit of the definition, and read A minus B only where the comparison is meaningful.'
category: experiments
status: active
target: advisory
weight: 180
difficulty: basic
commands: [knowledge]
claims: [measurement-comparison, aggregate-primary-response, semantic-run-comparison, experiment-definitions, run-evidence]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone measured the same speaker in two positions and saved both. In Experiments they
select the two and press Compare. Later they mark the first take as the baseline, select a
new take alone and press Compare: it is compared with the baseline.

To make the takes comparable on purpose, they save the setup as a definition ("Desk
speaker, 1 m") and press "Run this definition" for each take: every saved run records the
same definition version. When they later edit the definition's declared conditions, the next
run records version 2, and comparing it with the baseline says that the definition was edited
between the runs.

Before trusting a difference, they open each run's Evidence: the value at 1 kHz traced
through the analysis, capture, calibration, run, definition version and build, and a
checklist of what each record stores. Compare names the checklist items whose state differs
between the two runs, for example a calibration recorded in one and not in the other.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-experiments.test.mjs compareExperiments and responseDelta; tests/unit/v3-views.test.mjs compare view; tests/unit/v3-storage.test.mjs aggregate used when present)
- `npm test` (tests/unit/v3-semantic-compare.test.mjs: the semantic changes by domain, execution vs presentation, the baseline)
- `npm test` (tests/unit/v3-experiment-definitions.test.mjs: the definition hash and its versions, the run bound to its version in result hash v4, migration of earlier files, the version change in compare)
- `npm test` (tests/unit/v3-run-evidence.test.mjs: the lineage and checklist of a run from its stored fields, and the evidence differences between runs)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check experiments: an equivalent pair shows A - B, a non-equivalent pair is refused with the reason; check experiments-changes: the change list, the collapsed metadata group, the baseline; check definitions: two runs of one definition version, an edit, a run of version 2, the version change in compare; check evidence: the Evidence section of a run and the evidence differences line in compare)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
play or capture audio. It proves the traceability instead: each claim's implementation and
test are tracked files wired to the claim in the knowledge graph, so a renamed or deleted
test breaks this use case rather than silently orphaning the claim. Majordomus classes
`knowledge` as state-mutating from 0.11 on, and a live scenario may run only read-only
commands, so the setup `oscilla-tree` (`test/fixtures/commands/setup/oscilla-tree.sh`)
copies the tracked files of this checkout into a disposable repository and the steps ask
the knowledge graph of that copy.

# What it cannot prove

The browser check compares deterministic TEST CONTEXT fixtures, not physical measurements.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: measurement-comparison-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim measurement-comparison is implemented by src/js/experiments/compare.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-comparison +implementation:src/js/experiments/compare\.js']
  - id: measurement-comparison-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim measurement-comparison is proven by tests/unit/v3-experiments.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:measurement-comparison +test:tests/unit/v3-experiments\.test\.mjs']
  - id: semantic-run-comparison-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim semantic-run-comparison is implemented by src/js/experiments/semantic-diff.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:semantic-run-comparison +implementation:src/js/experiments/semantic-diff\.js']
  - id: semantic-run-comparison-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim semantic-run-comparison is proven by tests/unit/v3-semantic-compare.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:semantic-run-comparison +test:tests/unit/v3-semantic-compare\.test\.mjs']
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
  - id: experiment-definitions-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim experiment-definitions is implemented by src/js/experiments/definition.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-definitions +implementation:src/js/experiments/definition\.js']
  - id: experiment-definitions-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim experiment-definitions is proven by tests/unit/v3-experiment-definitions.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:experiment-definitions +test:tests/unit/v3-experiment-definitions\.test\.mjs']
  - id: run-evidence-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim run-evidence is implemented by src/js/experiments/evidence.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:run-evidence +implementation:src/js/experiments/evidence\.js']
  - id: run-evidence-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim run-evidence is proven by tests/unit/v3-run-evidence.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:run-evidence +test:tests/unit/v3-run-evidence\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Both responses are overlaid. Differences in calibration, sample rate, stimulus or algorithm
are named. What changed between the runs is listed by domain, execution changes first, with
units; layout and metadata changes are collapsed; nothing is presented as a cause. Runs of
one definition version show no definition change; a run of an edited definition is named as
version n → m of the same definition. A run whose setup was changed is not recorded as from
the definition. A minus B appears only for equivalent experiments and only over their overlapping
valid range, never normalised; otherwise the view says why it is not shown. The evidence
differences line lists only checklist items whose state differs, or says there are none.
