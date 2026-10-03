---
id: studio-save-and-load-a-patch
kind: use-case
title: 'Save a Studio patch and load it back'
summary: 'Save a project or a selection as a patch, change things, then open the project or insert the patch by explicit choice.'
category: studio
status: active
target: advisory
weight: 390
difficulty: intermediate
commands: [knowledge]
claims: [studio-patch-round-trip, studio-untrusted-import, studio-deterministic-hash]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone saves the current Studio as a project, selects three nodes and chooses **Save as
patch…**, edits the graph, then opens the project and inserts the patch (specification §14
UC10). Later they **Import** a `.oscilla-studio.json` file somebody sent them
(docs/v31/user-guide.md, "Save, export and patches").

# What proves it

The behaviour is proven by the OSCILLA tests named in each claim of `docs/CLAIMS.yaml` and
by these, run by:

- `npm test`: tests/unit/v31-studio-patches.test.mjs ("§113 save and load a project: the
  exact model", "§114 insertPatch", "§114 replaceWithPatch", "§155 patches are never silently
  overwritten", "§158 JSON export and import", "§115 importPatch: ... untrusted input
  rejected", "§154 the memory fallback (file://)") and tests/unit/v31-studio-model.test.mjs
  ("import rejects malicious and oversized input", "serialization is deterministic").
- `npm run test:studio`: tests/browser/v31-studio-graph.cjs check patches-files (save locally,
  the Open dialog lists it; export and re-import with identical semantics; save a selection as
  a patch and insert it, undoable; malformed and hostile files refused), in Chromium, Firefox and
  WebKit.

A use-case/v1 scenario can only invoke `bin/majordomus`, so the scenario below does not
open a browser or play audio. It proves the traceability instead: each claim's
implementation and test are tracked files wired to the claim in the knowledge graph, so a
renamed or deleted test breaks this use case rather than silently orphaning the claim.
Majordomus classes `knowledge` as state-mutating from 0.11 on, and a live scenario may run
only read-only commands, so the setup `oscilla-tree`
(`test/fixtures/commands/setup/oscilla-tree.sh`) copies the tracked files of this checkout
into a disposable repository and the steps ask the knowledge graph of that copy. The
behaviour itself is proven by the commands above, which the release gate runs and CI blocks
a merge on.

# What it cannot prove

A patch is a graph fragment: nodes, parameters, internal cables and their automation
lanes, never tracks, clips or markers; the timeline travels in a project. Autosave and crash
recovery are not built.

# Scenario

```yaml
setup: oscilla-tree
given:
  - 'a disposable repository holding the tracked files of this checkout'
steps:
  - id: studio-patch-round-trip-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-patch-round-trip is implemented by src/js/studio/patches.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-patch-round-trip +implementation:src/js/studio/patches\.js']
  - id: studio-patch-round-trip-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-patch-round-trip is proven by tests/unit/v31-studio-patches.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-patch-round-trip +test:tests/unit/v31-studio-patches\.test\.mjs']
  - id: studio-untrusted-import-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-untrusted-import is implemented by src/js/studio/migrate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-untrusted-import +implementation:src/js/studio/migrate\.js']
  - id: studio-untrusted-import-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-untrusted-import is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-untrusted-import +test:tests/unit/v31-studio-model\.test\.mjs']
  - id: studio-deterministic-hash-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-deterministic-hash is implemented by src/js/studio/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-deterministic-hash +implementation:src/js/studio/schema\.js']
  - id: studio-deterministic-hash-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-deterministic-hash is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-deterministic-hash +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The loaded project is the saved model exactly, an inserted patch gets new ids beside what is
there, and nothing malformed reaches the model.
