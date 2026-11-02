---
schema: adr/v1
id: adr-0082
kind: adr
title: "A release rests on the CI run of its own pull request: the CI receipt binds the merged tree, and the local gate becomes optional"
status: accepted
date: 2026-11-02
tags:
  - release
  - ci
  - provenance
related:
  - rule:project.release-receipt-binds-gate
  - rule:project.release-flow-complete
  - rule:project.deploy-often
  - rule:project.ci-bounded
  - adr:adr-0059
---

# 82. A release rests on the CI run of its own pull request: the CI receipt binds the merged tree, and the local gate becomes optional

## Context

The owner ordered on 2026-11-02 "finish those one by one - each fix is one version - deployed
as app": every landed fix or train becomes its own patch release, deployed. The release flow
ran the whole release gate locally in `release:prepare` (rule
`project.release-receipt-binds-gate` v1): about an hour on the shared Mac, longer behind the
load waits of `OSC_LOAD_MAX`, and nothing may merge while a receipt waits for its publish. One
release per landing at that cost serialises the whole repository behind one machine.

CI already runs every suite of `npm run release-gate` on each pull request (`ci.yml`, whose
`gate` job branch protection requires): unit and build checks, the engine, DSP, labs,
sequencer, measurement, Studio and browser suites in Chromium, Firefox and WebKit from
`file://` and the `/oscilla/` sub-path, CI's strict skips, the visual gate in its pinned
container and the `.ai` doctor. It runs them on `refs/pull/<n>/merge`. For the
`chore(release)` pull request, landed by merge commit under strict protection, that merge has
exactly the tree that lands on main.

## Decision

1. The CI run of the release pull request is a gate verdict for the release. `release:publish`
   accepts it on main's HEAD (the CI receipt, `scripts/release-ci-receipt.mjs`) when HEAD is
   the merge of that pull request's head H, HEAD's tree is H's tree and H contains the base it
   merged into; the newest CI `pull_request` run on H is green on its latest attempt; every
   job `ci.yml` declares is in that run's latest jobs, on H and green, and no other job is; and
   the committed roadmap matches the plan, the one local-gate check CI does not run.
2. This holds for every release, patch and minor alike (the owner chose it over patch-only).
3. `release:prepare` without flags builds the candidate and runs `npm run verify` and the
   roadmap check (about five minutes) and writes no receipt; `--local-gate` keeps the full
   local gate and its receipt, which `release:publish` still accepts.
4. The release pull request lands by merge commit (`gh pr merge --auto --merge`) and nothing
   else merges before the publish; any later merge changes HEAD's tree and the receipt
   refuses.

## Alternatives rejected

- Keep the local gate for every release: correct, but one release per hour at best on a
  shared machine, against an order for one release per landing.
- Accept the landed feature pull request's own green CI: its tree is not the release tree
  (the bump, the roadmap and the rebuilt `dist` come after it), so its verdict binds a
  different tree.
- Patch releases on CI, minors on the local gate: keeps the Mac's 48 kHz coverage at release
  time (CI runs Linux at 44.1 kHz), but the owner chose the CI receipt for all releases. The
  48 kHz paths stay covered by the suites developers run locally and by `--local-gate` when a
  release wants it.

## Consequences

- A release costs a short local prepare, one CI run of the release pull request and the
  publish; landing and releasing alternate without an hour of freeze.
- The CI workflow is now part of the release verdict: a suite added to `release-gate` and not
  to `ci.yml` would be released without having run. `tests/unit/main-checks.test.mjs` and
  `tests/unit/ci-workflows.test.mjs` hold the jobs and their scripts.
- `release:publish` reads GitHub (the run and its jobs) as a precondition; an unreadable answer
  refuses.

## Resolution notes

### 2026-11-02: accepted by the owner

The owner chose "CI receipt for all releases" in the session of 2026-11-02, over patch-only
and over keeping the local gate. Implemented by plan issue R028: `scripts/release-ci-receipt.mjs`, `gateVerdict()` in
`scripts/release-publish.mjs`, `CI_PREPARE_COMMANDS` and `--local-gate` in
`scripts/release-prepare.mjs`, rule `project.release-receipt-binds-gate` v2, tests
`tests/unit/release-ci-receipt.test.mjs`. Its judge verified the real release merge of
v3.15.0 (e8bb8b95, CI run 41400581754, 21 jobs) with no problem.
