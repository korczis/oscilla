---
schema: adr/v1
id: adr-0083
kind: adr
title: "Pull requests land through a merge queue, not a race of armed auto-merges on a strict branch"
status: accepted
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

Status: accepted by the owner on 2026-11-02 (AskUserQuestion in the session of oscilla-b0, about
22:35Z; the choice, verbatim: "Yes, implement it (Recommended)"; its text: "Accept ADR 0083; 26
implements the workflow and script changes in a PR, af reviews, and then you switch the ruleset
to require the queue"). Plan issue E045 implements it; switching the ruleset to require the
queue is the owner's act after that pull request lands.

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
`merge` (MERGE), as today, and grouping strategy ALLGREEN, both required: see "The ruleset of
`main`" below). A pull request is approved by its own CI round as now, then queued; the queue
builds a temporary `gh-readonly-queue/main/pr-N-<sha>` ref that is `main` plus every pull request
ahead of it plus this one, runs the required check on that ref (event `merge_group`), and lands
the pull requests in order when their group is green. Nobody updates a branch by hand, a
landing never makes the next pull request BEHIND, and a green group lands without a second round
of its own.

Strictness is kept, by construction: what lands is exactly the tree the queue tested.

### The ruleset of `main` (the owner's act, after E045 lands)

The rules jobs and the path-gating classifier read a queue run's change as `HEAD^1..HEAD`. That
is one pull request's whole change only when the queue builds one merge commit per pull request
(merge method MERGE) and every entry's own run must pass (grouping ALLGREEN). Under REBASE or
SQUASH a pull request of a runtime commit followed by a docs commit becomes linear commits whose
last is docs only; under HEADGREEN a docs pull request queued behind a runtime one can be the
only run that gates both. The run refuses what it can see (a queue head without exactly two
parents, a HEAD^1 that is not the base the queue ref names, a HEAD^2 that is not the pull
request's `headRefOid`: `.github/scripts/queued-pr.sh`; the classifier runs everything). The
queue ref is `gh-readonly-queue/<base>/pr-<N>-<sha>`, and GitHub's `<sha>` is the entry's
base, the queue commit's first parent HEAD^1, not the pull request's head (review N1: read on
rust-lang/rust-analyzer, merge method MERGE and ALLGREEN, entry pr-23616 whose merge commit has
parents [the ref's sha, the pull request head], and four more entries; on primer/react a squash
queue commit's single parent is the ref's sha). The grouping is not visible
inside a run, so it is held by the ruleset alone. The change, in the ruleset that protects
`main` (its `merge_queue` rule; the values are the ruleset API's):

- add the `merge_queue` rule ("Require merge queue");
- `merge_method: MERGE` (a merge commit), never `SQUASH` or `REBASE`;
- `grouping_strategy: ALLGREEN` (every entry's own run must pass), never `HEADGREEN` (only the
  group's last entry);
- the required status check stays `gate`; it reports on `merge_group` too;
- keep "Require branches to be up to date before merging" as it is; the queue makes it moot.

Until the owner makes this change nothing in how pull requests land changes; a different merge
method or grouping later is a change of this decision, not a setting.

## What has to change (each in the pull request that adopts this)

- `.github/workflows/ci.yml`: `on: [pull_request, merge_group]`. The `gate` job stays the one
  required check and must report on `merge_group` too.
- `concurrency`: `ci-${{ github.ref }}` already separates queue refs; `cancel-in-progress` must
  stay off for `merge_group` refs (a cancelled group would drop out of the queue).
- `fail-first` and `review-verdict` judge a pull request. On `merge_group` the pull request is
  the queue ref's own (`github.event.merge_group.head_ref` names it, `pr-N`); the jobs read N from
  it through `.github/scripts/queued-pr.sh` and judge that pull request through the base copy,
  exactly as on `pull_request` (`.github/scripts/base-rule.sh`). They must not rejudge the whole
  group: review-verdict measures `HEAD^1..HEAD`, the queue's merge of that one pull request onto
  main plus the pull requests ahead of it, as a pull_request run measures its merge commit.
- `project.ci-bounded`: its triggers clause names `pull_request` only; it gains `merge_group`,
  with the same bounds.
- `main-checks.yml` stays as it is (push to `main`): it still names the merge that turned `main`
  red, now one per queue landing.
- R028's CI receipt (`scripts/release-ci-receipt.mjs`, rule v3) accepts, beside the release
  pull request's own run, the newest `merge_group` run whose head is main's HEAD itself (the
  queue commit main fast-forwarded to) from the queue ref of that same pull request (review of
  oscilla-af): a run on another sha, from another pull request's queue ref, a queue group of more
  than one pull request (HEAD^1 not in the pull request head) and a skipped or missing job each
  refuse; both events run the same jobs under the same conditions, so the only skip excused is
  the flake ledger's own first attempt (#417), on either event.
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

## Resolution notes

### 2026-11-02: accepted by the owner; implemented by E045

The owner answered in the session of oscilla-b0 (AskUserQuestion, about 22:35Z), verbatim choice
"Yes, implement it (Recommended)", whose text read "Accept ADR 0083; 26 implements the workflow
and script changes in a PR, af reviews, and then you switch the ruleset to require the queue".
Plan issue E045 implements it: `.github/workflows/ci.yml` starts on `merge_group` too and never
cancels a queue run; `.github/scripts/queued-pr.sh` names the queued pull request
(`tests/unit/queued-pr.test.mjs`); `project.ci-bounded` v2 (`scripts/ci-workflow-rules.mjs`,
`tests/unit/ci-workflows.test.mjs`); the release CI receipt, `project.release-receipt-binds-gate`
v3 (`scripts/release-ci-receipt.mjs`, `tests/unit/release-ci-receipt.test.mjs`, with
oscilla-af's five review points as its mutation cases). Requiring the queue in the ruleset of
`main` is the owner's act after E045 lands; until then nothing in how pull requests land changes.

### 2026-11-05: review of E045 (seat 98, findings F1-F9)

The review of `ci/merge-queue` at 1c7a7529 found that nothing required the queue head to be a
merge commit (F1). E045 now: requires merge method MERGE and grouping ALLGREEN in the ruleset
section above; `.github/scripts/queued-pr.sh` refuses a queue head without exactly two parents
or whose HEAD^1 is not the base the queue ref names (DIFF_BASE is bound to that sha), and
`--check-head` refuses a HEAD^2 that is not the pull request's `headRefOid`, and `.github/scripts/ci-changes.mjs` runs everything for such a head;
the jobs read the script as `vars="$(...)"; eval "$vars"`, so its exit 2 fails the step (F2);
the base names are allowlisted and mutation-proven against injection (F3, F8: `base_ref`
required and equal to the ref's base, `pr-N` with N of 1 or more); a cancellable queue run is
refused by `project.ci-bounded` v2's `queue-cancel` (F4). Tests: `tests/unit/queued-pr.test.mjs`,
`tests/unit/ci-changes.test.mjs`, `tests/unit/ci-workflows.test.mjs`,
`tests/unit/release-ci-receipt.test.mjs`.

The re-review of d1873663 (N1, P0) found that the first fix compared HEAD^2 with the ref's sha,
on the reviewer's own wrong reading of the ref: GitHub's `<sha>` is HEAD^1, so every real
`merge_group` run would have exited 2 and the queue would never land. The comparison is now
HEAD^1 against the ref's sha, HEAD^2 against `headRefOid`; the test fixtures name the ref by
HEAD^1, as GitHub does, and the earlier shape (the ref naming HEAD^2) is a refusal case.
