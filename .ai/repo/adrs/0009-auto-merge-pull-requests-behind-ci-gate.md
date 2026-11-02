---
schema: adr/v1
id: adr-0009
kind: adr
title: V1 ships through auto-merge pull requests behind a required CI gate
status: accepted
date: 2026-10-02
tags:
  - delivery
  - ci
provenance:
  origin: authored
---

# 9. V1 ships through auto-merge pull requests behind a required CI gate

## Context

The person asked for Pages to stay fresh, with pull requests opened as early as possible and
merged automatically. Pushing `main` directly deploys Pages with no gate.

## Decision

- `main` is protected and requires the `gate` job of `.github/workflows/ci.yml`. That job
  runs `tests/smoke.cjs`, `tests/spec.cjs` and `tests/engine.cjs` over file:// in Chromium.
- Work ships as small pull requests with `gh pr merge --auto --squash`, and the branch is
  deleted on merge. Pages redeploys from every merge to `main` (`pages.yml`, index.html only).
- After a squash merge the lead resets the local trunk to `origin/main`, once the tree diff
  against the merged branch has been checked.
- Branches are pushed from the trunk checkout, because `majordomus finish --check` (the
  pre-push hook) refuses a push from a branch other than the one the active task was recorded
  on.

## Consequences

- Linux runner layout can differ from macOS (the first gate run caught the 390 px
  first-viewport check), so CI is a real second platform.
- Squash merges rewrite local history; agents must rebase onto the merged `main`.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: what the gate runs now

`tests/engine.cjs`, `tests/smoke.cjs` and `tests/spec.cjs` were V1's test files; they left with
V1's single file in the V2 change (9fe0a15, #3) and stay readable at tag `v1.0.0`. The `gate`
job of `.github/workflows/ci.yml` now aggregates parallel jobs (unit and build checks, the V1
engine port, DSP/labs/sequencer, Measure, Studio, the browser gate in Chromium, Firefox and
WebKit, the visual gate, and a pinned `majordomus doctor` of the `.ai/` layer);
`tests/README.md` lists what each runs. Pages deploys `dist/` (ADR 0011), not `index.html`.
Work ships from its own worktree and branch, not from the trunk checkout (see the note on ADR
0008).

### 2026-10-18: accepted by the owner

Accepted by the owner (explicit instruction in the session of 2026-10-18, applied by the
coordinating Claude session) — implemented as described; evidence: `main` is protected with the
required, strict `gate` status check (`gh api repos/korczis/oscilla/branches/main/protection`,
read 2026-10-18); single changes land by `gh pr merge --auto`; what the gate runs, the `dist/`
deploy and per-worktree branches as its 2026-10-05 note states; batches by ADR 0055, which keeps
this decision for a single change.

### 2026-10-30: the gate no longer requires an up-to-date branch

By the owner's decision of 2026-10-30, protection on `main` keeps `gate` as the required check
and drops "require branches to be up to date" (`contexts: [gate]`, `strict: false`; read it
with `gh api repos/korczis/oscilla/branches/main/protection -q .required_status_checks`). A
merge queue is not available on a user-owned repository, and on a starved Actions account
strict protection let about one pull request land per CI round of 40 minutes or more while
about 25 were green or reviewed. The owner sets this; no session changes it.

A pull request now merges on its last green run, which judged GitHub's merge of its head into
`main` as `main` stood when the run started. Two risks follow, and this is what does and does
not catch each:

- **The last run may predate what has since landed on `main`**: a rule, a change to the
  programs that judge (`scripts/fail-first.mjs`, `scripts/review-verdict.mjs` and its
  `GUARDED` list, run from the base branch through `.github/scripts/base-rule.sh`), or a
  guarded file changed under the reviewed one. The base's copy judges as of the run, not as
  of the merge. Nothing judges the pull request again: the `fail-first` and `review-verdict`
  jobs run only for a pull request, and `ci.yml` does not run on a push to `main`
  (`project.ci-bounded` allows a workflow with a `gate` job only `pull_request`). Merging
  `main` into the branch starts a run that judges with the new base; nothing requires it.
- **Two individually green pull requests can combine into a red `main`.** On a push to
  `main`, `pages.yml` runs `build:check`, `verify-dist` and `version:check` before it deploys
  (a failure there stops the deploy, and the site keeps the previous page), then
  `verify-deploy` and the public smoke in three browsers against the page it deployed (a
  failure there comes after the page is live). `cadence.yml` checks only the release lag
  and the release records. None of `gate`'s jobs runs on `main` (`unit`, `knowledge` with
  `majordomus doctor`, `engine`, `suites`, `measure`, `studio`, `browser`, `visual`,
  `fail-first`, `review-verdict`), so `npm test` and the browser and visual suites never see
  the combination there. A combination that breaks one of them first shows as a red run of
  the next pull request started after the merge, which tests its merge with the new `main`
  and so is blamed for it (reproduce on `main` to tell), and at the latest in the next
  release: `release:prepare` runs the full gate on a tree of `main` and the
  `chore(release)` pull request runs `gate`.
  Two pull requests that both rebuild `dist/index.html` normally conflict there, and GitHub
  does not merge a conflicted pull request.

No check on `main` itself runs the gate's suites, and nothing alerts on such a breakage
before the next pull request or release does. Closing that is a follow-up for the owner: a
push-to-`main` workflow without a `gate` job, at the cost of one more CI round per merge.
