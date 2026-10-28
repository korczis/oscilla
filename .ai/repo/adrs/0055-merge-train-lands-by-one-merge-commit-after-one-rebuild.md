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

### Amendment, 2026-10-28: decision 5 (#252)

Decision 5's second sentence is replaced. The train-wide `fail-first: n/a` let an unproven
`feat` member land: the train's waiver excused a member whose tests no run had judged.
From this date:

- A `feat` or `fix` pull request does not ride a train. It lands as its own pull request,
  where `project.fail-first` runs its tests against the merge base. The `fail-first` job
  recognises a train by its head branch `train/...` or its title (`Merge train <date>: ...`,
  `train(...)`), reads the `| member | what |` table of its body, refuses a `feat` or `fix`
  row, and does not count the train's waiver line for its members. A pull request titled
  `feat` or `fix` is judged as one even on a `train/...` branch: a train is not titled so.
- A member that changes a guarded path rides only with the train's own reviewer-written
  verdict (`project.review-verdict`), as decision 5's first sentence already says.
- Decision 1 is amended: each member is merged with `--no-ff --no-commit` (decision 1 said
  `--no-ff` only), and the merge is committed after its unmerged paths and conflict markers
  are checked, so the pre-commit hook judges each merge commit. Decisions 2 to 4 stand:
  `npm run verify` is the gate on the train head, and the train lands by merge commit.

The procedure is the skill `merge-train` (`.ai/repo/skills/merge-train/SKILL.md`), the only
one; the code is `scripts/fail-first.mjs` and `tests/unit/fail-first.test.mjs`.

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
