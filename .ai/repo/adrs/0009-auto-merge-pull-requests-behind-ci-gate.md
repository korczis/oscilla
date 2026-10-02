---
schema: adr/v1
id: adr-0009
kind: adr
title: V1 ships through auto-merge pull requests behind a required CI gate
status: proposed
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
