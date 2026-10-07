---
id: project.release-flow-complete
version: 1
kind: rule
title: Every release completes prepare, pull request, publish, live verification and record
description: A release is finished when its record is on main. release:prepare refuses to start the next one before that, and refuses a major release no published release candidate preceded; release:publish diagnoses a Pages run that never starts instead of waiting on it.
statement: release:prepare refuses to start when the newest v* tag at or after v3.4.0 has no .ai/repo/releases/<tag>.yaml, or when the proposed version is a stable X.0.0 and no vX.0.0-rc.N tag has a record on the prerelease channel (overridden only by --no-rc-because naming an accepted ADR). Every v* tag at or after v3.4.0 that is more than 6 hours old has a record. release:publish refuses while a pages.yml run has sat in waiting or queued for 15 minutes, reports its run id, its commit and the git merge-base --is-ancestor verdict against HEAD, never watches a run that has not started, and prints the majordomus finish line that verifies the published commit.
status: active
class: blocking
depends_on: [project.release-receipt-binds-gate@1, project.about-names-current-release@1]
tags: [release, flow, provenance, deployment]
x-majordomus:
  tests: [tests/unit/release-analyze.test.mjs, tests/unit/release-publish.test.mjs, tests/unit/release-record.test.mjs]
---

# Rationale

The release has five steps and each has been skipped or left hanging once.

- v3.0.0 shipped without a release candidate although the process supported one (ADR 0047,
  #145). That left plan issue V386 permanently unmet (#152), and ADR 0047 itself says that no
  script refuses it.
- The record is a second, manual pull request. Thirteen were landed by hand, v3.4.0 to
  v3.10.3; v3.0.0 to v3.3.3 have none, and nothing would have noticed the next one being
  forgotten.
- 2026-10-06: a Pages run (#144) sat about 40 minutes in `waiting` and silently stalled every
  deploy queued behind it. `release:publish` could only time out, without saying which run or
  why.
- 2026-10-06 17:59: the v3.10.2 task could not be closed, because `verify-deploy` ran against
  the worktree HEAD instead of the published commit.

# Required behaviour

The flow, in the order it is practised. Each step names what holds it in place.

1. **Station first, for a minor or a major.** The About timeline gains the line's station in
   a change that lands before the release starts. Enforced by
   `project.about-names-current-release` (`tests/unit/about.test.mjs`, in the gate).
2. **`npm run release:prepare` on a clean tree of main.** It refuses a dirty tree, refuses
   while the newest release has no record, and refuses a stable `X.0.0` that no published
   `vX.0.0-rc.N` preceded. It bumps once, rebuilds, runs the full gate and writes the receipt.
   The first candidate of a major is `npm run release:prepare -- --prerelease` (when
   `package.json` already carries `X.0.0`, it is set to `X.0.0-rc.1` for the candidate). Once
   the candidate is published and recorded, a plain `release:prepare` proposes `X.0.0` even
   when no releasable commit followed the candidate.
3. **The `chore(release): vX.Y.Z` pull request, merged by auto-merge** behind the required
   `gate` check. It is the only pull request armed while a release is in flight: any other
   merge to main changes the gate tree and the publish refuses until the gate is re-run
   (`project.release-receipt-binds-gate`).
4. **`npm run release:publish`, then `-- --yes`**, from a checkout of main at `origin/main`
   that has the receipt (the receipt lives in the common git directory, so a linked worktree
   of the clone that prepared it sees it; a separate fresh clone needs the receipt file copied
   into its `.git/`). It refuses without a matching receipt, on a dirty tree, off main, when
   HEAD is not `origin/main`, when the tag exists, when `build:check` fails, and while a Pages
   run is stuck. It tags, pushes the tag, waits for the Pages run of HEAD to start, watches
   it, runs `verify-deploy` against that commit and creates the GitHub Release.
5. **Live verification.** `.github/workflows/pages.yml` runs `verify-deploy` and `test:live`
   in Chromium, Firefox and WebKit on every deployment and fails on a mismatch;
   `release:publish` runs `verify-deploy` itself before it creates the GitHub Release.
6. **`npm run release:record -- --version X.Y.Z`**, landed by its own small pull request from
   the branch `chore/release-record-vX.Y.Z`. The release is finished when that record is on
   main, and the next `release:prepare` does not start before.
7. **Close the task against the published commit**, with the line `release:publish` prints:
   `majordomus finish … --verify-command "npm run release:verify-deploy -- --commit <sha>"`.
   Without `--commit`, `verify-deploy` expects the worktree HEAD, which is no longer the
   published commit once main has moved.

Two orderings around the flow:

- **Pull requests that change `dist/index.html` land one at a time.** Each rebuilds the
  committed artifact; two built from the same base cannot both be right. The second is
  rebased and rebuilt after the first lands.
- **Arm auto-merge on other pull requests only after an in-flight release has published.**

# Enforcement

`scripts/release-prepare.mjs`, `flowProblems()`, checked after the analysis and before
anything changes, as a dry run too:

- the newest `v*` tag reachable from HEAD, when at or after `RECORD_FLOOR` (v3.4.0, the first
  release published with its artifact attached), must have its `.ai/repo/releases/` record in
  the checkout;
- a proposed stable `X.0.0` needs a `vX.0.0-rc.N` tag whose record's `channel` is
  `prerelease`. `--no-rc-because <ADR>` lifts this only when `adrStatus()` finds that ADR in
  `.ai/repo/adrs/` with `status: accepted`; a proposed ADR, or a number that names none, is
  refused. Every ADR of this repository is `proposed` today, so the override cannot be used
  until the owner accepts one.

`scripts/release-analyze.mjs`, `proposeVersion()`: after a `vX.Y.Z-rc.N` tag with no
release-relevant commit, the proposal is `X.Y.Z`, so the step this rule makes mandatory can be
finished without an invented commit.

`scripts/release-publish.mjs`: `stuckPagesRuns()` and `diagnoseStuckRuns()` over
`gh run list --workflow pages.yml --json databaseId,status,conclusion,headSha,createdAt`. A
run in `waiting`, `queued`, `pending` or `requested` for `STUCK_AFTER_MIN` (15) minutes is a
blocked precondition, reported with its id, its commit and the verdict of
`git merge-base --is-ancestor <run commit> <HEAD>`. With `--yes`, the wait for the Pages run
of HEAD ends at `--pages-timeout` with the same diagnosis when the run exists and has not
started; `gh run watch`, which has no timeout, is only ever given a run that has started.
`finishLine()` is printed by the dry run and after a publish.

`scripts/release-record.mjs`, `missingRecords()`, and the test "every published release from
v3.4.0 on, past its publish window, has a record" in `tests/unit/release-record.test.mjs`: it
reads the tags of the clone and fails for any tag older than `RECORD_WINDOW_HOURS` (6) without
a record. The CI unit job checks out with `fetch-depth: 0`, so the tags are there; under
GitHub Actions a clone without them fails the test instead of skipping it.

`tests/unit/release-analyze.test.mjs` drives `release:prepare` as a dry run against a fake
git and a fixture checkout (both refusals, the override with a proposed, a missing and an
accepted ADR). `tests/unit/release-publish.test.mjs` drives `release:publish` against fake
git and gh (a run `waiting` for 30 minutes blocks the dry run and `--yes`; a run of HEAD that
stays `queued` is diagnosed and never watched; the full `--yes` sequence; the finish line).

Not mechanically enforced, and stated as such:

- that dist-changing pull requests land one at a time. `build:check` in the `gate` and in
  `pages.yml` refuses a stale committed dist, and two such pull requests normally conflict in
  `dist/index.html`, but no check orders them;
- that auto-merge stays unarmed during a release. The consequence is enforced
  (`project.release-receipt-binds-gate`), the abstention is not;
- that the record pull request uses the branch name above, and that the task is closed with
  the printed line. The script prints both; a reviewer owns the rest;
- the 6-hour window is a test of the clock: a tag that nobody records turns the unit job red
  for every pull request once the window closes. That is the intent.

# Failure behaviour

`release:prepare` prints `refusing to start (rule project.release-flow-complete)` with each
reason and changes nothing. `release:publish` prints one `BLOCKED Pages run <id> …` line per
stuck run and tags nothing; after the tag is pushed, a run that never starts ends the publish
with `STUCK` lines, the undo command for the tag and the `verify-deploy` command for later.
A missing record fails `npm test`; the fix is `release:record` and its pull request, never a
hand-written record.
