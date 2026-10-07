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

## Index

Every rule in force.

| Rule | Class | What it binds | Mechanism |
| --- | --- | --- | --- |
| `project.single-file-deliverable` v2 | blocking | one static `dist/index.html`, no runtime fetch | `npm run verify-dist`, browser gate, `scripts/verify-deploy.mjs` |
| `project.audio-engine-discipline` v2 | blocking | nodes and timing only inside the engine's accounting | `tests/unit/freeze.test.mjs`, `tests/browser/engine-v1port.cjs` |
| `project.no-fake-science` v2 | blocking | no unsupported claim; dB SPL only when calibrated | `x-majordomus` tests |
| `project.about-names-current-release` v1 | blocking | the About timeline names the release line | `tests/unit/about.test.mjs` |
| `project.studio-model-is-canonical` v1 | blocking | the Studio model is the one source of truth | `tests/unit/v31-studio-model.test.mjs` |
| `project.typed-ports` v1 | blocking | connections validated before the runtime changes | `tests/unit/v31-studio-model.test.mjs` |
| `project.no-silent-feedback` v1 | blocking | a feedback loop is refused, never made silently | `tests/unit/v31-studio-model.test.mjs` |
| `project.visual-identity-lock` v1 | blocking | new surfaces use the existing tokens and primitives | `npm run test:visual`, and review for a new surface |
| `project.bounded-test-timing` v1 | blocking | a browser check waits for its condition against a named wall-clock deadline; no fixed sleep, frame count or assumed rate | `tests/unit/browser-timing.test.mjs` |
| `project.suite-harness` v1 | blocking | every browser suite runs through one harness: no unknown or empty selection, no leg without checks, no undeclared skip in CI, no start on a loaded machine | `tests/unit/browser-suite-contract.test.mjs` |
