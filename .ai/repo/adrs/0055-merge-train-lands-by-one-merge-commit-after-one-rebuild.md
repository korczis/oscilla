---
schema: adr/v1
id: adr-0055
kind: adr
title: A merge train lands ready pull requests by one merge commit after one rebuild
status: proposed
date: 2026-10-17
tags:
  - process
  - ci
related:
  - file:.ai/repo/adrs/0009-auto-merge-pull-requests-behind-ci-gate.md
  - file:.ai/repo/adrs/0011-modular-source-one-committed-dist.md
  - rule:project.review-verdict
  - rule:project.fail-first
  - rule:project.no-conflict-markers
  - rule:project.deploy-often
provenance:
  origin: extracted
  derived_from:
    - issue:174
    - issue:179
---

# 55. A merge train lands ready pull requests by one merge commit after one rebuild

## Context

ADR 0009 ships every change as its own auto-merge pull request behind the required `gate`
check. Two facts made that expensive once several PRs were ready at once:

- Every PR that changes `src/` also changes the committed `dist/index.html` (ADR 0011). After
  any one of them merges, every other one conflicts on `dist` and must merge main, rebuild and
  run CI again. N ready PRs cost about N full CI rounds, run in sequence.
- The account's GitHub runners are a shared pool, also used by prismatic-majordomus. On
  2026-10-11 jobs queued for 45 minutes and more, and from 21:03 to 21:28 UTC nothing ran in
  either repository.

## Decision

When several PRs are ready, they land together through one integration branch, a train
`train/<date>` in its own worktree:

1. Each ready PR's branch is merged into the train with `--no-ff`, in an order chosen so that
   every merge commit passes the pre-commit hook. A tooling migration such as #178 goes first.
2. A conflict on `dist/index.html` is resolved by taking either side, because the train rebuilds
   `dist` once after the last merge. Every other conflict is resolved by hand, and no conflict
   marker is committed (`project.no-conflict-markers`).
3. `npm run verify` runs once on the train head, and CI's `gate` runs once on its PR.
4. The train's PR lands by a **merge commit** (`gh pr merge --auto --merge`), so each included
   PR's head reaches main and GitHub marks that PR merged.
5. The train is a change like any other. It needs its own reviewer-written verdict when it
   touches a guarded path (`project.review-verdict`). Each included `feat`/`fix` PR carries its
   own fail-first commits, so the train's body says `fail-first: n/a` with that reason.

Train 1 was #174 (2026-10-12). Train 2 is #179 (2026-10-17: #178, #167, #155, #154).

## Alternatives rejected

- **Merging the ready PRs one by one** (ADR 0009 alone): N CI rounds in sequence, each after a
  `dist` rebuild, on a runner pool that stalls.
- **Squash-merging the train**: one commit on main, but the included PRs' heads would not reach
  main, so GitHub would show them as open and their history would be lost.

## Consequences

- A batch of N ready PRs costs one CI round and one rebuild.
- Main's history has one merge commit per train, with the included PRs' commits beneath it.
- ADR 0009 still holds for a single change. A train is for batches.
- The review is concentrated: one reviewer reads the train's combined diff, including the
  conflict resolutions, which no single PR's review covered.
