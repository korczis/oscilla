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

## Release rules

How a release is cut, in the order the steps happen. Each rule's `# Enforcement` names the
script and the test that hold it, and says what no check holds.

- `project.release-receipt-binds-gate` (`release-receipt-binds-gate.v1.md`): the gate receipt
  binds every tracked file outside the release records, so a merge to main between
  `release:prepare` and `release:publish` needs the gate again.
- `project.release-flow-complete` (`release-flow-complete.v1.md`): the flow from prepare to
  the record, in order; the next release does not start before the previous one is recorded,
  a major follows a published release candidate, and a Pages run that never starts is
  diagnosed.
- `project.deploy-often` (`deploy-often.v1.md`): a releasable commit is released within 24
  hours; an hourly workflow is red and keeps one issue open until it is.
