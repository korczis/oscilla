---
id: studio-save-and-load-a-patch
kind: use-case
title: 'Save a Studio patch and load it back'
summary: 'Save the current graph as a patch, change things, then load the patch back by explicit replace or insert.'
category: studio
status: draft
target: advisory
weight: 390
difficulty: intermediate
commands: [knowledge]
claims: [studio-patch-round-trip, studio-untrusted-import, studio-deterministic-hash]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone saves the Basic Synth graph as a patch, edits the graph, then loads the patch, choosing replace (specification §14 UC10). Later they import a patch file somebody sent them.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- A serialized Studio file imports back to the same normalized model, deterministically (tests "validateStudioImport accepts a serialized Studio and returns a normalized copy" and "serialization is deterministic and round-trips through normalize (§161)").
- An imported file is untrusted: oversized, too deep, prototype-polluting or newer-schema input is refused without evaluation (test "import rejects malicious and oversized input (§115, §159, §238)").

Not yet provable:

- The patch format, local persistence, replace and insert, and export (issue V426). Claim `studio-patch-round-trip` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-patch-round-trip-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-patch-round-trip is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-patch-round-trip +document:docs/specs/oscilla-v3\.1-studio\.md']
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
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

The loaded patch is the saved graph and parameters exactly, and nothing malformed reaches the model.
