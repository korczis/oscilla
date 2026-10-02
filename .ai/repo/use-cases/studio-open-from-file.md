---
id: studio-open-from-file
kind: use-case
title: 'Open Studio from file://'
summary: 'Double-click the single dist/index.html and use Studio offline, with nothing fetched.'
category: studio
status: draft
target: advisory
weight: 430
difficulty: basic
commands: [knowledge]
claims: [studio-file-protocol]
tags: [oscilla, studio, v31, product-acceptance]
---

# Situation

Someone opens the downloaded `dist/index.html` from disk, without a network, and opens Studio (specification §14 UC14). The application-wide use case for `file://` (open-from-file, added with the product graph on main) covers the rest of the page.

# What proves it

Status `draft`: Studio is not in the shipped product yet, so nobody can perform this task today. What the Studio model core already proves is named below with its test, run by `npm test` (`tests/unit/v31-studio-model.test.mjs`); what is not yet provable is named with the issue that will prove it.

Proven now:

- Nothing Studio-specific yet. The model core is pure (no DOM, fetch, module loading or clock), which keeps it inside rule `project.single-file-deliverable`, but no test opens Studio from `file://`.

Not yet provable:

- Studio in the built file, the `file://` browser test, bundle and dependency audit (issue V430, specification §215-§219). Claim `studio-file-protocol` is planned.

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only commands, so the scenario below does not run Studio. It proves the traceability instead: each guaranteed claim resolves to a tracked implementation and a tracked test in the knowledge graph, and each planned claim to the document that specifies it, so a renamed or deleted test or specification breaks this use case rather than silently orphaning the claim.

# Scenario

```yaml
mode: live
steps:
  - id: studio-file-protocol-specified
    run: ['knowledge', 'edges', '--type', 'specified_by']
    note: 'claim studio-file-protocol is planned: specified by docs/specs/oscilla-v3.1-studio.md, with no implementation or test yet'
    expect:
      exit: 0
      stdout_contains: ['claim:studio-file-protocol +document:docs/specs/oscilla-v3\.1-studio\.md']
then:
  - 'every guaranteed claim this use case names resolves to a tracked implementation and a tracked test, and every planned one to its specification'
```

# Outcome

Studio works from `file://` and from the Pages sub-path with zero console errors and no network request.
