---
schema: adr/v1
id: adr-0083
kind: adr
title: "Pull requests land through a merge queue, not a race of armed auto-merges on a strict branch"
status: proposed
date: 2026-11-02
tags:
  - ci
  - landing
  - process
related:
  - rule:project.ci-bounded
  - rule:project.fail-first
  - rule:project.review-verdict
  - rule:project.release-receipt-binds-gate
  - rule:project.deploy-often
  - file:.ai/repo/adrs/0082-a-release-rests-on-the-ci-run-of-its-own-pull-request.md
---

# 83. Pull requests land through a merge queue, not a race of armed auto-merges on a strict branch

Status: proposed. Protection of `main` is the owner's to change; nothing here is applied until
the owner accepts it.

## Context

`main` is protected with "require branches to be up to date" (strict, kept by the owner on
2026-10-31) and pull requests land by armed auto-merge (`gh pr merge --auto --merge`). Every
landing therefore puts every other armed pull request BEHIND, and each of them must merge `main`
again and pay a whole CI round (20 jobs, about 25 min of jobs, 1-3 h of wall time on this
account's runners) before it can land, even when nothing in it changed and its own round had
just gone green.

Measured on 2026-11-02 for #385 (the synth train), from `gh run list --workflow CI --branch
feat/train-2026-11-02-synth`:

| head | started (UTC) | ended | result | why it did not land |
|---|---|---|---|---|
| e1589ad1 | 09:56 | 10:17 | cancelled | superseded by the reviewer's verdict commit |
| 89573c86 | 09:57 | 14:23 | failure | two real defects, fixed |
| 2e372b50 | 16:18 | 17:06 | cancelled | #387 landed first: BEHIND |
| f683e66f | 16:50 | 18:44 | cancelled | #390 landed first: DIRTY (dist) |
| 82f784a8 | 18:27 | 21:03 | **success** | #389 landed first: BEHIND, the green round discarded |
| e5ca3c20 | 21:06 | 21:49 | failure | one real test leak, fixed; and the v3.16.0 freeze |
| 24b36ce2 | 21:57 | (running) | | |

Three of seven rounds (2e372b50, f683e66f, 82f784a8) were lost to other pull requests landing
first, one of them fully green. The same happened to #367 on 2026-11-01. Freezing `main` for one
pull request only moves the wait to another one (the coordinator, 2026-11-02), and the owner's
order is at least one landing per 30 minutes ("landing throughput", 2026-11-01).

## Decision

Land through GitHub's merge queue (repository ruleset "require merge queue"; merge method
`merge`, as today). A pull request is approved by its own CI round as now, then queued; the queue
builds a temporary `gh-readonly-queue/main/pr-N-<sha>` ref that is `main` plus every pull request
ahead of it plus this one, runs the required check on that ref (event `merge_group`), and lands
the pull requests in order when their group is green. Nobody updates a branch by hand, a
landing never makes the next pull request BEHIND, and a green group lands without a second round
of its own.

Strictness is kept, by construction: what lands is exactly the tree the queue tested.

## What has to change (each in the pull request that adopts this)

- `.github/workflows/ci.yml`: `on: [pull_request, merge_group]`. The `gate` job stays the one
  required check and must report on `merge_group` too.
- `concurrency`: `ci-${{ github.ref }}` already separates queue refs; `cancel-in-progress` must
  stay off for `merge_group` refs (a cancelled group would drop out of the queue).
- `fail-first` and `review-verdict` judge a pull request. On `merge_group` the pull request is
  the queue ref's own (`github.event.merge_group.head_ref` names it, `pr-N`); the jobs read N from
  it and judge that pull request's head against its base through the base copy, exactly as on
  `pull_request` (`.github/scripts/base-rule.sh`). They must not rejudge the whole group.
- `project.ci-bounded`: its triggers clause names `pull_request` only; it gains `merge_group`,
  with the same bounds.
- `main-checks.yml` stays as it is (push to `main`): it still names the merge that turned `main`
  red, now one per queue landing.
- R028's CI receipt (`scripts/release-ci-receipt.mjs`) accepts runs of event `pull_request` on
  the release pull request's head. A queued release pull request lands on its `merge_group`
  run; the receipt must accept that run when its tree equals the merged tree (or the release pull
  request lands outside the queue, as the one exception the release flow names).
- The release flow (`project.release-flow-complete`): "nothing else merges until the publish"
  becomes "the release pull request is alone in the queue": queue entry is paused (or the queue
  is emptied) while a receipt waits for its publish.
- `tests/unit/main-checks.test.mjs`, `ci-workflows`, `ci-bounded` and the receipt tests are
  updated in the same pull request; a mutation test proves `merge_group` is required.

## Consequences

- Positive: no BEHIND races, no hand updates, a green pull request lands without paying again;
  throughput is bounded by the queue's CI, not by the number of armed pull requests.
- Negative: a failing group re-runs the pull requests behind it (the queue removes the failing
  one); queue checks consume the same runner minutes as today's rerounds (fewer in total, since
  discarded green rounds disappear); the setting is GitHub-side and must be documented in
  `tests/README.md` and the operating notes.
- Neutral: review verdicts, fail-first and size reports keep judging the pull request, not the
  group.

## Alternatives considered

- Keep strict + auto-merge, coordinate by hand (today): measured above.
- Drop strict (not up to date): fastest, but two green pull requests can combine into a `main`
  nobody tested; main-checks would catch it only after the fact (owner decision 2026-10-30 kept
  that risk off).
- Trains only: they help (one round for N members) but still race other armed pull requests.
