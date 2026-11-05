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
| `project.no-inert-surfaces` v1 | blocking | no placeholder copy, no control disabled without a stated reason, no `data-osc` control without a handler; the allowance only shrinks | `tests/unit/no-inert-surfaces.test.mjs`, `no-inert-controls` in `tests/browser/qa-regressions.cjs`; review-only: a literal shown as data, placeholder copy in substance |
| `project.about-names-current-release` v1 | blocking | the About timeline names the release line | `tests/unit/about.test.mjs` |
| `project.studio-model-is-canonical` v1 | blocking | the Studio model is the one source of truth | `tests/unit/v31-studio-model.test.mjs` |
| `project.typed-ports` v1 | blocking | connections validated before the runtime changes | `tests/unit/v31-studio-model.test.mjs`, `tests/unit/v31-studio-compiler.test.mjs`, `tests/browser/v31-studio-graph.cjs` |
| `project.no-silent-feedback` v1 | blocking | a feedback loop is refused, never made silently | `tests/unit/v31-studio-model.test.mjs`, `tests/unit/v31-studio-compiler.test.mjs`, `tests/browser/v31-studio-graph.cjs`; a new graph-changing path is held by review until a test names it |
| `project.a-phone-sounds` v1 | blocking | the instrument sounds on a phone: unlock at a touch's end, iOS playback session; the proving suite stays in the gate with the gesture rule on | `tests/unit/audio-unlock.test.mjs`, `tests/unit/rule-a-phone-sounds.test.mjs`, `tests/browser/touch-audio.cjs` |
| `project.visual-identity-lock` v4 | blocking | the interface is Flowbite Pro themed to OSCILLA; the domain views keep their meaning inside Pro cards; no product's name, logo, colourway or layout, no flow-editor theme or other UI kit; a restrained old-school modular hardware treatment app-wide (Q071), drawn only from OSCILLA tokens, procedural textures, no glassmorphism, animated gradient or neon glow, motion behind reduced-motion, LEDs and needles bound to real state | `tests/unit/visual-identity-lock-v4.test.mjs`, `tests/unit/ui-flowbite-pro.test.mjs`, `tests/unit/synth-panel-tokens.test.mjs`, `tests/unit/synth-wording.test.mjs`, `tests/browser/synth.cjs` (`s-look`), `npm run test:visual` (pixel regressions of referenced views); review-only: the hidden-logo question, the theme mapping, the domain views, no trade dress or traced face, restraint, an indicator's source is real |
| `project.ui-uses-flowbite-pro` v1 | blocking | every surface built from Flowbite Pro on Tailwind (build time, inlined); no other UI kit, no new stylesheet, no Pro source file committed; the legacy surfaces, osc-* class tokens, class names, CSS and inline styles only shrink, and nothing is migrated before the Tailwind build | `tests/unit/ui-flowbite-pro.test.mjs` with `tests/unit/ui-flowbite-pro-baseline.json`; review-only: Pro fidelity in substance and the rule's "What no check decides" |
| `project.rules-name-their-enforcement` v1 | blocking | a rule, bootstrap or script header names only enforcement that exists | `tests/unit/knowledge-integrity.test.mjs` |
| `project.no-conflict-markers` v1 | blocking | no conflict marker in a tracked file or a staged change | `tests/unit/repo-hygiene.test.mjs`, pre-commit `git diff --cached --check` |
| `project.worktree-topology` v1 | blocking | a branch is committed from its canonical worktree; no stash advice | pre-commit `majordomus worktree guard`, `tests/unit/repo-hygiene.test.mjs` |
| `project.majordomus-layer-current` v1 | blocking | the local Majordomus is the pinned one; no missing policy key | `scripts/majordomus-pin-check.mjs` in `npm run verify`, `.github/doctor-verdict.jq` |
| `project.bounded-test-timing` v2 | blocking | a browser check waits for its condition against a named wall-clock deadline; no new fixed sleep in the suite or the page, frame count or assumed rate; the recorded debt only shrinks | `tests/unit/browser-timing.test.mjs` |
| `project.suite-harness` v1 | blocking | every browser suite runs through one harness: no unknown or empty selection, no leg without checks or on another engine, no undeclared skip in CI, no start on a loaded machine | `tests/unit/browser-suite-contract.test.mjs` |
| `project.release-receipt-binds-gate` v3 | blocking | a release is published only on a tree a gate verdict binds: the CI run of its release pull request (ADR 0082) or the local receipt over every tracked file except the release records, with how the gate ran | `tests/unit/release-ci-receipt.test.mjs`, `tests/unit/release-publish.test.mjs`, `tests/unit/release-gate-env.test.mjs` |
| `project.release-flow-complete` v1 | blocking | prepare, pull request, publish, live verification and record, in order; every published tag in a checkout's history has its record in that checkout | `tests/unit/release-analyze.test.mjs`, `release-publish.test.mjs`, `release-record.test.mjs` |
| `project.deploy-often` v1 | blocking | a releasable commit on main is released within 24 hours | `tests/unit/release-cadence.test.mjs`, `.github/workflows/cadence.yml` (not part of the required `gate`) |
| `project.ci-bounded` v2 | blocking | every workflow job and network step bounded, pinned, retried; nothing fatal made non-fatal; ci.yml starts on pull_request and merge_group only, never cancels a queue run, and judges a queue run only as the merge commit of one pull request's head (ADR 0083) | `tests/unit/ci-workflows.test.mjs` over `scripts/ci-workflow-rules.mjs`, `tests/unit/queued-pr.test.mjs`, `tests/unit/ci-changes.test.mjs`, in `npm test`; the queue's grouping (ALLGREEN) is held by the ruleset alone; a pull request that rewrites the workflow is held only by `project.review-verdict` |
| `project.fail-first` v1 | blocking | a `feat`/`fix` pull request's unit tests fail on the merge base, or its body carries a reasoned waiver; a merge train lists its members and has no `feat`/`fix` one | the `fail-first` job of `ci.yml` (the base branch's `scripts/fail-first.mjs` through `.github/scripts/base-rule.sh`), needed by `gate`; `tests/unit/fail-first.test.mjs`, `tests/unit/base-rule.test.mjs`; a retitle nobody re-runs is not caught |
| `project.review-verdict` v2 | blocking | a pull request changing a guarded path (the Synth since v2) carries a reviewer's verdict for the content it changes | the `review-verdict` job of `ci.yml` (the base branch's `scripts/review-verdict.mjs` through `.github/scripts/base-rule.sh`), needed by `gate`; `tests/unit/review-verdict.test.mjs`, `tests/unit/base-rule.test.mjs`; reviewer independence is reviewer-owned, a pull request that rewrites the job itself is not stopped, and a branch that has not merged the `main` carrying the job is not judged |
| `project.shared-machine-discipline` v1 | advisory | how a session behaves on the shared machine and clone | none: see its `# Why advisory` |

## Release rules

How a release is cut, in the order the steps happen. Each rule's `# Enforcement` names the
script and the test that hold it, and says what no check holds.

- `project.release-receipt-binds-gate` (`release-receipt-binds-gate.v3.md`; v1 and v2 deprecated):
  a release is published only on a tree a gate verdict binds, the CI run of its release pull
  request (ADR 0082) or the local receipt, so a merge to main between the verdict and
  `release:publish` needs the gate again.
- `project.release-flow-complete` (`release-flow-complete.v1.md`): the flow from prepare to
  the record, in order; the next release does not start before the previous one is recorded,
  the first stable release of a new major follows a published release candidate, and a Pages
  run of which no job starts is diagnosed.
- `project.deploy-often` (`deploy-often.v1.md`): a releasable commit is released within 24
  hours; a workflow run on every push to main and on a best-effort hourly schedule is red and
  keeps one issue open until it is.
