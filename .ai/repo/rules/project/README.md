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
in both directions. A rule without one names its mechanism under `# Enforcement` (older
rules: `# Verification`): the files it names in backticks exist, its tests and scripts are
run, and at least one of them is a test or script file CI executes (an npm script alone is
not a rule's own mechanism). A rule no mechanism can decide is `class: advisory`
and says why under `# Why advisory` — a validator that always passes is worse than admitting
a reviewer owns it. `project.rules-name-their-enforcement` holds every rule here to that, in
`tests/unit/knowledge-integrity.test.mjs`.

## Index

Every rule in force, with its version and class. `tests/unit/knowledge-integrity.test.mjs`
compares these rows, and separately the list in `CLAUDE.md`, with the front matter of the
rule files in this directory, and fails when a row is missing, extra or stale.

| Rule | Class | What it binds | Mechanism |
| --- | --- | --- | --- |
| `project.single-file-deliverable` v2 | blocking | one static `dist/index.html`, no runtime fetch | `scripts/verify-dist.mjs`, browser gate, `scripts/verify-deploy.mjs` |
| `project.audio-engine-discipline` v2 | blocking | nodes and timing only inside the engine's accounting | `tests/unit/freeze.test.mjs`, `tests/browser/engine-v1port.cjs` |
| `project.no-fake-science` v2 | blocking | no unsupported claim; dB SPL only when calibrated | `x-majordomus` tests |
| `project.about-names-current-release` v1 | blocking | the About timeline names the release line | `tests/unit/about.test.mjs` |
| `project.studio-model-is-canonical` v1 | blocking | the Studio model is the one source of truth | `tests/unit/v31-studio-model.test.mjs` |
| `project.typed-ports` v1 | blocking | connections validated before the runtime changes | `tests/unit/v31-studio-model.test.mjs` |
| `project.no-silent-feedback` v1 | blocking | a feedback loop is refused, never made silently | `tests/unit/v31-studio-model.test.mjs` |
| `project.visual-identity-lock` v1 | blocking | new surfaces use the existing tokens and primitives | `npm run test:visual`, and review for a new surface |
| `project.rules-name-their-enforcement` v1 | blocking | a rule, bootstrap or script header names only enforcement that exists | `tests/unit/knowledge-integrity.test.mjs` |
| `project.no-conflict-markers` v1 | blocking | no conflict marker in a tracked file or a staged change | `tests/unit/repo-hygiene.test.mjs`, pre-commit `git diff --cached --check` |
| `project.worktree-topology` v1 | blocking | a branch is committed from its canonical worktree; no stash advice | pre-commit `majordomus worktree guard`, `tests/unit/repo-hygiene.test.mjs` |
| `project.majordomus-layer-current` v1 | blocking | the local Majordomus is the pinned one; no missing policy key | `scripts/majordomus-pin-check.mjs` in `npm run verify`, `.github/doctor-verdict.jq` |
| `project.bounded-test-timing` v1 | blocking | a browser check waits for its condition against a named wall-clock deadline; no fixed sleep in the suite or the page, frame count or assumed rate | `tests/unit/browser-timing.test.mjs` |
| `project.suite-harness` v1 | blocking | every browser suite runs through one harness: no unknown or empty selection, no leg without checks or on another engine, no undeclared skip in CI, no start on a loaded machine | `tests/unit/browser-suite-contract.test.mjs` |
| `project.shared-machine-discipline` v1 | advisory | how a session behaves on the shared machine and clone | none: see its `# Why advisory` |
