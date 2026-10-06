---
id: record-a-finding-linked-to-evidence
kind: use-case
title: 'Record a finding linked to its evidence'
summary: 'Write down what two runs seem to show as a finding that cites them, mark it supported, see it from each run, and keep the reference honest when a cited run is deleted.'
category: experiments
status: active
target: advisory
weight: 185
difficulty: basic
commands: [knowledge]
claims: [findings-linked-to-evidence, run-evidence, semantic-run-comparison]
tags: [oscilla, product-acceptance, v4]
---

# Situation

Someone measured a desk speaker twice, once with a foam pad under it. Comparing the two runs,
they think the pad lowers the level above 6 kHz. In the first run's detail they press "Record a
finding about this run", write the statement, link the comparison of the two runs and mark the
finding supported. The finding now lists its two references, and each run's detail lists it
under "Findings that cite this run".

Later they delete the second run to free space. The delete dialog says that one finding cites
it. Afterwards the finding still says supported and still cites the comparison, which now reads
"missing: run … is not stored here". They export the findings to send to a colleague; the file
carries each cited run's id and result hash, and on the colleague's machine the runs that were
not sent read "not stored here".

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v4-findings.test.mjs: statuses, evidence required for supported and contradicted, typed references and the identity of each cited run, unsafe input, integrity issues, the store and its DB version 4 migration, export and import)
- `npm run test:measure` (tests/browser/v3-ui.cjs, check findings: record from a run, link a comparison, supported, backlinks, the export, deleting the cited run with the dialog's warning and the missing reference, 390 px, light theme)

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not run
the page. It proves the traceability instead: the claim's implementation and test are tracked
files wired to the claim in the knowledge graph. The setup `oscilla-tree`
(`test/fixtures/commands/setup/oscilla-tree.sh`) copies the tracked files of this checkout into
a disposable repository and the steps ask the knowledge graph of that copy.

# What it cannot prove

Whether a statement is a fair reading of its evidence. A status is the user's judgement; OSCILLA
checks that the evidence exists and is the record that was cited, never that it supports the
statement.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: findings-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim findings-linked-to-evidence is implemented by src/js/experiments/findings.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:findings-linked-to-evidence +implementation:src/js/experiments/findings\.js']
  - id: findings-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim findings-linked-to-evidence is proven by tests/unit/v4-findings.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:findings-linked-to-evidence +test:tests/unit/v4-findings\.test\.mjs']
then:
  - 'the claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The finding is stored apart from both runs, which are unchanged. Its status is a word, not a
number. Its references are listed with their state: present, or missing with the reason. A
comparison reference says what changed between the runs, not why. Deleting a cited run never
removes the reference or the finding, and the dialog says beforehand how many findings cite it.
