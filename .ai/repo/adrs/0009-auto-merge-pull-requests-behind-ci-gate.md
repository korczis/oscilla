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
