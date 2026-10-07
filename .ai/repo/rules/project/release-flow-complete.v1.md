---
id: project.release-flow-complete
version: 1
kind: rule
title: Every release completes prepare, pull request, publish, live verification and record
description: A release is finished when its record is on main. release:prepare refuses to start the next one before that, and refuses the first stable release of a new major that no published release candidate preceded; release:publish diagnoses a Pages run of which no job starts instead of waiting on it.
statement: release:prepare refuses to start when the newest v* tag at or after v3.4.0 has no .ai/repo/releases/<tag>.yaml, or when the proposed version is the first stable release of a new major (its major is above that of every stable v* tag reachable from HEAD, whatever its minor and patch) and no vX.0.0-rc.N tag has a record on the prerelease channel (overridden only by --no-rc-because naming an accepted ADR). Every v* tag at or after v3.4.0 that is reachable from HEAD and more than 6 hours old has its record in the checkout that is judged; the copy on origin/main counts only for a branch whose history never contained that record, so a record deleted or renamed on a branch is missing. release:publish refuses while a pages.yml run has had no job start for 15 minutes or the run list cannot be read, reports the run id, its commit and the git merge-base --is-ancestor verdict against HEAD, never watches a run of which no job has started, and prints the majordomus finish line that verifies the published commit.
status: active
class: blocking
depends_on: [project.release-receipt-binds-gate@1, project.about-names-current-release@1]
tags: [release, flow, provenance, deployment]
x-majordomus:
  tests: [tests/unit/release-analyze.test.mjs, tests/unit/release-publish.test.mjs, tests/unit/release-record.test.mjs, tests/unit/release-cadence.test.mjs, tests/unit/version-authority.test.mjs]
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
   while the newest release has no record, and refuses the first stable release of a new
   major that no published `vX.0.0-rc.N` preceded. "First stable release of a new major" is
   any stable version whose major is above every stable tag in the history: `X.0.0`, and
   equally `X.0.1` or `X.1.0` typed into `package.json`. It bumps once, rebuilds, runs the
   full gate and writes the receipt. The first candidate of a major is
   `npm run release:prepare -- --prerelease` (when `package.json` already carries an `X.y.z`
   version, it is set to `X.0.0-rc.1` for the candidate). Once the candidate is published and
   recorded, a plain `release:prepare` proposes `X.0.0` even when no releasable commit
   followed the candidate.
3. **The `chore(release): vX.Y.Z` pull request, merged by auto-merge** behind the required
   `gate` check. It is the only pull request armed while a release is in flight: any other
   merge to main changes the gate tree and the publish refuses until the gate is re-run
   (`project.release-receipt-binds-gate`).
4. **`npm run release:publish`, then `-- --yes`**, from a checkout of main at `origin/main`
   that has the receipt (the receipt lives in the common git directory, so a linked worktree
   of the clone that prepared it sees it; a separate fresh clone needs the receipt file copied
   into its `.git/`). It refuses without a matching receipt, on a dirty tree, off main, when
   HEAD is not `origin/main`, when the tag exists, when `build:check` fails, while a Pages
   run is stuck and when the Pages runs cannot be listed. It tags, pushes the tag, waits for
   a job of the Pages run of HEAD to start, watches the run, runs `verify-deploy` against
   that commit and creates the GitHub Release. A run is stuck when none of its jobs has
   started; a run that GitHub still reports as `queued` while its deploy job has run and its
   smoke legs wait for a runner is slow, and is waited for.
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
- a proposed stable version whose major is above the major of every stable `v*` tag
  reachable from HEAD (`git tag --merged HEAD`), whatever its minor and patch, needs a
  `vX.0.0-rc.N` tag, also reachable from HEAD, whose record's `channel` is `prerelease`. A
  version typed into `package.json` (`X.0.1`, `X.1.0` while every stable tag is below major
  `X`) is judged the same way as a computed `X.0.0`; with no stable tag at all, the `X.0.0`
  shape decides.
  `--no-rc-because <ADR>` lifts this only when `adrStatus()` finds that ADR in
  `.ai/repo/adrs/` with `status: accepted`; a proposed ADR, or a number that names none, is
  refused. Every ADR of this repository is `proposed` today, so the override cannot be used
  until the owner accepts one.

`release:prepare` bumps `package.json` and then runs `version:check`, which refuses a copy of
the product version outside `package.json`, the lock, `dist/`, `.ai/`, `CHANGELOG.md` and
`docs/specs/`. A literal of a version the product can reach next is therefore a release that
fails in its own gate. The test "no literal of a version the next release:prepare can
propose" in `tests/unit/version-authority.test.mjs` derives the next patch, minor and major
and the two other ways a new major can be typed (`X.0.1`, `X.1.0`) from `package.json` and
fails on any such literal in a scanned file. Prose and comments write `X.Y.Z`; fixtures use
major 40.

`scripts/release-analyze.mjs`, `proposeVersion()`: after a `vX.Y.Z-rc.N` tag with no
release-relevant commit, the proposal is `X.Y.Z`, so the step this rule makes mandatory can be
finished without an invented commit.

`scripts/release-publish.mjs`: `runStarted()`, `stuckPagesRuns()` and `diagnoseStuckRuns()`
over `gh run list --workflow pages.yml --json databaseId,status,conclusion,headSha,createdAt`
and, for each run whose status is `waiting`, `queued`, `pending`, `requested` or
`action_required`, `gh run view <id> --json jobs`. The run status alone does not say whether a
run started: GitHub reports `queued` for a run whose deploy job has succeeded while a smoke
leg waits for a runner (Pages run 37558326962, 2026-10-07). A run has started when one of its
jobs is `in_progress`, or `completed` and not skipped; a job's `startedAt` is not used, because
it carries the run's creation time while the job is queued. A run of which no job has started
for `STUCK_AFTER_MIN` (15) minutes is a blocked precondition, reported with its id, its commit
and the verdict of `git merge-base --is-ancestor <run commit> <HEAD>`; so is a run whose jobs
cannot be read, and so is a run list that cannot be read (`could not list the pages.yml
runs`): neither is taken for "no stuck run". With `--yes`, the wait for the Pages run of HEAD
ends at `--pages-timeout` (default `PAGES_TIMEOUT_MIN`, 30 minutes: longer than one whole
run ahead of it in the `pages` concurrency group, which the job timeouts bound at about 20)
with the same diagnosis when no job of it has started;
`gh run watch`, which has no timeout, is given the run as soon as one job has started and
never before. `finishLine()` is printed by the dry run and after a publish.

`scripts/release-record.mjs`, `checkoutMissingRecords()` over `missingRecords()`, and the test
"every published release from v3.4.0 on in this history, past its publish window, has a
record" in `tests/unit/release-record.test.mjs`. The `v*` tags reachable from HEAD
(`git for-each-ref --merged HEAD`) are the list of what must be recorded, because tags are
shared by every worktree of a clone and a branch does not answer for a release cut after it.
What is judged is the checkout: a record counts when `.ai/repo/releases/<tag>.yaml` is in the
working tree. The copy on `origin/main` (`git cat-file -e origin/main:<path>`) excuses one
state only, a branch cut between a tag and its record pull request: `recordInHistory()`
(`git rev-list -1 --full-history HEAD -- <path>`) finds that HEAD's history never touched the
record. When the history did contain it and the checkout does not, the record was deleted or
renamed there, and the trunk copy does not count: a pull request that deletes a record fails
its own unit job, where its base still has the file. `--full-history` matters: a merge that
drops the record agrees with the parent that never had it, and the simplified history would
not show the commit that added it. The test fails for any such tag older than
`RECORD_WINDOW_HOURS` (6). The CI unit job checks out with `fetch-depth: 0`, so the tags are
there; under GitHub Actions a clone without them fails the test instead of skipping it.

`.github/workflows/cadence.yml`, job `records`: `node scripts/release-record.mjs --complete`
runs the same check on main hourly, on every push to main and on every `v*` tag, with a
`contents: read` token. `ci.yml` runs only for pull requests, so without this job a tag that
nobody recorded would first be red on someone else's pull request. It exits 1 when no tag
from the floor on is reachable (a clone without tags is not a pass).
`tests/unit/release-cadence.test.mjs` pins the job, its token, its full-history checkout and
that no job or step of the workflow carries an `if:`.

`tests/unit/release-analyze.test.mjs` drives `release:prepare` as a dry run against a fake
git and a fixture checkout (both refusals; a new major typed as `X.0.1`, `X.1.0` and
`X.2.3`, and the same versions once the major has a stable tag; the override with a proposed,
a missing and an accepted ADR). `tests/unit/release-publish.test.mjs` drives
`release:publish` against fake git and gh (a run `waiting` for 30 minutes with no job started
blocks the dry run and `--yes`; a run `queued` for 20 minutes whose deploy job has run does
not; an unreadable run list blocks; a run of HEAD of which no job starts is diagnosed and
never watched; a run that stays `queued` is watched once its deploy job starts; the full
`--yes` sequence; the finish line). `tests/unit/release-record.test.mjs` builds real
repositories: a tag recorded in the checkout, one recorded only on `origin/main`, one
recorded nowhere and one on a line HEAD does not contain (only the third is reported); a
record deleted in a commit, every record deleted, a record renamed, a record removed from the
working tree only, each while `origin/main` still has it (each reported); a merge of the
trunk that drops the record (reported); and `--complete` with no tag, a recorded tag, a
deleted record and a tag inside its window.

Not mechanically enforced, and stated as such:

- that dist-changing pull requests land one at a time. `build:check` in the `gate` and in
  `pages.yml` refuses a stale committed dist, and two such pull requests normally conflict in
  `dist/index.html`, but no check orders them;
- that auto-merge stays unarmed during a release. The consequence is enforced
  (`project.release-receipt-binds-gate`), the abstention is not;
- that the record pull request uses the branch name above, and that the task is closed with
  the printed line. The script prints both; a reviewer owns the rest;
- the 6-hour window is a test of the clock: a tag that nobody records turns the unit job red
  for every pull request once the window closes, and `npm test` red in every checkout whose
  history contains the tag. That is the intent. A checkout whose `origin/main` is stale (not
  fetched since the record landed) and which contains the tag fails until it fetches;
- a shallow clone has no history to consult: a record absent from its checkout is judged by
  `origin/main` alone there. The CI unit job and `cadence.yml` check out full history, and a
  test pins `fetch-depth: 0` for the latter;
- the `records` job of `cadence.yml` has not run: a scheduled workflow runs from the default
  branch only, so its first run is after this rule lands. Until then the `--complete` path is
  proven by the unit test and by running the command in a checkout;
- `--no-rc-because` checks that the ADR is accepted, not that it is about the release being
  cut: any accepted ADR lifts the refusal. Whether the named ADR waives the candidate for
  this major is the reviewer's;
- a `v*` tag pushed by hand is trusted as a release by this rule and by
  `project.deploy-often`: nothing checks that a tag has a GitHub Release behind it;
- a stuck precondition also reports plain runner congestion: a Pages run of which no job has
  been given a runner for 15 minutes blocks the dry run until the queue clears. That is a
  transient refusal, and it is correct, because the deploy this publish waits for would not
  start either.

# Failure behaviour

`release:prepare` prints `refusing to start (rule project.release-flow-complete)` with each
reason and changes nothing. `release:publish` prints one `BLOCKED Pages run <id> … (rule
project.release-flow-complete)` line per stuck run, or `BLOCKED could not list the pages.yml
runs …`, and tags nothing; after the tag is pushed, a run of which no job starts within
`--pages-timeout` ends the publish with `STUCK` lines, the undo command for the tag and the
`verify-deploy` command for later. The tag is then on origin with no GitHub Release. To
resume without undoing it: once the Pages run of that commit has succeeded, run
`npm run release:verify-deploy -- --commit <sha>` and create the GitHub Release by hand with
the flags the dry run printed (`release:publish` itself refuses an existing tag). A missing
record fails `npm test` with one line per tag, saying whether the record is recorded nowhere
(the fix is `release:record` and its pull request, never a hand-written record) or was
deleted or renamed on this branch (the fix is to restore it); on main the `records` job of
`cadence.yml` is red with the same lines.
