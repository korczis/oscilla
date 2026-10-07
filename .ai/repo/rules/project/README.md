---
schema: context/v1
id: ai.repo.rules.project
kind: context
title: Project rules
description: The rules this repository writes for itself, resolved together with the vendored baseline.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Project rules

The rules this repository writes for itself. The format, the loading and the composition
are the section's, in `../README.md`, and are not repeated here.

A file here is `<slug>.v<version>.md`, and the file name is a convenience: identity is the
`id` and `version` in the front matter. A project rule may add a constraint the vendored
baseline does not carry. It may not reuse a vendored identity, weaken a vendored rule, or
exist only to restate one — the effective set is additive and has no override mechanism,
so a rule that contradicts its baseline is two rules in force at once.

A rule with an `x-majordomus` block claims the tool enforces it, and that claim is checked
in both directions. A rule without one is normative for whoever reads it and enforced by a
reviewer; `class` still says what a violation means. Write the second kind when the tool
cannot decide the question — a validator that always passes is worse than admitting a
reviewer owns it.

## Process and CI rules

Rules about how a change reaches `main`. Each names its mechanism in its `# Enforcement`
section, and the mechanism is in the repository.

| rule | class | enforced by |
|---|---|---|
| [`project.ci-bounded@1`](ci-bounded.v1.md) | blocking | `tests/unit/ci-workflows.test.mjs` over `scripts/ci-workflow-rules.mjs`, in `npm test` |
| [`project.fail-first@1`](fail-first.v1.md) | blocking | the `fail-first` job of `ci.yml` (`scripts/fail-first.mjs`), needed by `gate`; `tests/unit/fail-first.test.mjs` |
| [`project.review-verdict@1`](review-verdict.v1.md) | blocking | the `review-verdict` job of `ci.yml` (`scripts/review-verdict.mjs`), needed by `gate`; `tests/unit/review-verdict.test.mjs`; reviewer independence is reviewer-owned |
