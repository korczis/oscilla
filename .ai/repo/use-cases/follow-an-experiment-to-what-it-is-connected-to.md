---
id: follow-an-experiment-to-what-it-is-connected-to
kind: use-case
title: 'Follow an experiment to what it is connected to, and to what depends on it'
summary: 'From a saved experiment, see the definition version, the experiment it duplicates, the Studio project it was measured from and the findings that cite it, each from a stored field, and see a different record under a cited id named as such.'
category: experiments
status: active
target: advisory
weight: 186
difficulty: basic
commands: [knowledge]
claims: [connected-records, findings-linked-to-evidence, run-evidence]
tags: [oscilla, product-acceptance, v4]
---

# Situation

Someone measures a loudspeaker from a saved Studio project, duplicates the experiment to keep a copy
before renaming it, and records a finding that cites it. A week later they open the experiment in
Experiments. Under "Connected records" it says what it is connected to: the Studio project
whose saved graph has the hash the experiment stores, the build that made it, and what depends on it:
the finding citing it and the copy. Each line names the stored field it comes from. Pressing
Enter on the copy opens it; Back returns to the experiment.

They then delete the experiment and import a colleague's file that happens to use the same id. The
finding's connected records now say "does not match: a different record is stored under this
id", and the copy says the same of its original. Nothing was hidden or repaired.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v4-connections.test.mjs: every entry and its field, the five states, nothing inferred, the bounds, the record link, the store rows and the workspace adapter)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check connections: a record link, both directions, keyboard, Back and Forward, an impostor and a record altered under its hash)
- `npm run test:studio` (tests/browser/v31-studio-workflows.cjs, check connections-from-studio)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not run
the page. It proves the traceability instead: the claim's implementation and test are tracked
files wired to the claim in the knowledge graph. The setup `oscilla-tree`
(`test/fixtures/commands/setup/oscilla-tree.sh`) copies the tracked files of this checkout into
a disposable repository and the steps ask the knowledge graph of that copy.

# What it cannot prove

That two experiments nobody linked are related. Connected records follow stored fields only: equal
recipes, names or times connect nothing, and a repeat, which records no identity of its
original, is never shown as verified.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: connections-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim connected-records is implemented by src/js/experiments/connections.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:connected-records +implementation:src/js/experiments/connections\.js']
  - id: connections-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim connected-records is proven by tests/unit/v4-connections.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:connected-records +test:tests/unit/v4-connections\.test\.mjs']
then:
  - 'the claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

Every entry names its field and its state in words. An entry reads "stored here" only
for a record that is stored, readable and the one the field names; missing, mismatched,
unverifiable and unreadable targets are listed and say so. Following an entry is a link
that Back and Forward walk through, and focus lands on the opened record.
