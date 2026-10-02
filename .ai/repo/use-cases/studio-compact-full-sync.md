---
id: studio-compact-full-sync
kind: use-case
title: 'Switch between compact and full Studio on one model'
summary: 'Edit in the compact Studio widget, expand to the full workspace and back, and see the same graph and timeline everywhere.'
category: studio
status: draft
target: advisory
weight: 380
difficulty: basic
commands: [knowledge]
claims: [studio-one-store-projections, studio-model-plain-data]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone moves a clip in the compact Studio widget, expands to full Studio, adds a node there, and collapses again (specification §14 UC9).

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- There is one store, the only writer of a frozen plain-data model (tests "store models are frozen plain data and the initial model must be valid" and "assertPlainData rejects runtime objects, typed arrays and unsafe values (§10)").

Not yet provable:

- The compact widget and the full workspace (issues V421, V422) and the compact/full model test (specification §214, issue V430). Claim `studio-one-store-projections` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-one-store-projections-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-one-store-projections is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-one-store-projections +document:docs/specs/oscilla-v3\.1-studio\.md']
  - id: studio-model-plain-data-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim studio-model-plain-data is implemented by src/js/studio/schema.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-model-plain-data +implementation:src/js/studio/schema\.js']
  - id: studio-model-plain-data-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim studio-model-plain-data is proven by tests/unit/v31-studio-model.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-model-plain-data +test:tests/unit/v31-studio-model\.test\.mjs']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Both views render the same StudioModel; neither keeps a copy to synchronize (rule `project.studio-model-is-canonical`).
