---
id: project.fail-first
version: 1
kind: rule
title: A feat or fix PR's tests fail without the change
description: For a pull request titled feat or fix, CI runs the unit tests it adds or changes against the merge base and at least one must fail there and pass on the head, unless the body carries a printed waiver; a merge train is judged by its member table and may not carry a feat or fix member.
statement: For a pull request whose title starts with feat or fix (in any case or spacing, behind bracketed tags), at least one tests/unit/**/*.test.mjs file the pull request adds or changes fails when run against the merge base's tree (its src/ and everything else outside tests/) and passes against the head's, unless the pull request body carries, in its own prose, a line `fail-first: n/a <reason>` with a real reason, which the CI job prints; a merge train (a pull request not titled feat or fix whose head branch is train/... or whose title starts with train or merge train, as in Merge train <date>:) has no change of its own and passes only when its body's `| member | what |` table lists every member with a conventional type and none is feat or fix; the program that judges is the base branch's copy.
status: active
class: blocking
depends_on: []
tags: [ci, process, testing]
---

# Rationale

A test that passes with or without the change says nothing about the change.

- #149, second review: the unit test written for finding 1.3 of the first review called
  `experimentsRefresh()` directly. It never took the `findingsRefresh`-without-list path where
  the P0 lived, and it passed with the defect in place.
- #50: a mutation row in `tests/README.md` claimed a failure that did not happen.
- From #98 to #157 fail-first evidence was written into each pull request by hand, sometimes
  measured against the wrong commit.

A claim a person types is not evidence; a run against the merge base is.

# Required behaviour

- A `feat` or `fix` pull request adds or changes at least one unit test file that fails on
  the merge base and passes on the head. The title is matched without regard to case or
  spacing and behind bracketed tags (`Fix(x):`, `fix (x) :`, `[WIP] fix(x):`, `FEAT!:`);
  every other type has nothing to prove.
- "Without the change" is the merge base's whole tree with the head's `tests/` in place of
  its own: a test of `scripts/` must fail on the base's script as a test of `src/` must fail
  on the base's source, and `dist/` there is the base's build.
- A test file that fails on the head as well is not evidence: something other than the
  change fails it (a test that needs the git history, for one: both trees are `git archive`
  extracts made repositories with their files staged, so `git ls-files` answers and
  `git log` does not). The head run is repeated once when it fails, and the job says so,
  because a test that is sensitive to a loaded machine would otherwise hide real evidence.
- A change no unit test can demonstrate (documentation under a `fix` title, a behaviour only
  a browser suite can observe) says so in the pull request body, on a line of its own:
  `fail-first: n/a <reason>`. The reason is required, and the placeholder `<reason>` or
  punctuation is not one. The line counts only in the body's own prose: inside a fenced code
  block, an HTML comment or a blockquote it is a quotation. The reason is printed in the job
  log, and whether it is a good reason is for the reviewer.
- The program that judges a pull request is the base branch's `scripts/fail-first.mjs`, not
  the copy the pull request carries.
- A train (skill `merge-train`, `.ai/repo/skills/merge-train/SKILL.md`; ADR 0055 as amended
  on 2026-10-28) has no change of its own to prove and is judged by its members instead. A
  pull request is a train when its title is not feat or fix and its head branch is
  `train/...` or its title starts, behind bracketed tags, with the word `train` or `trains`,
  or `merge` then that word (`Merge train 2026-10-17: #1, #2`, `Merge-train ...`,
  `Merge trains ...`, `train(x):`, `Train:`). A feat or fix title is judged as a feat or fix
  pull request on any branch, `train/...` included. Its body carries, in its
  own prose, a table `| member | what |` with one row per member: `#<n>` and that member's
  pull request title (every such table is read; `\|` is a `|` inside a cell). A train
  without the table or with an empty one, a row that is not `#<n>`, a `what` that does not
  start with a conventional type (`feat`, `fix`, `docs`, `chore`, `test`, `build`, `ci`,
  `perf`, `refactor`, `style`, `revert`), and a feat or fix member are refused: a feat or fix
  lands as its own pull request, where its tests are judged. The train's waiver line does not
  count for its members.
- One proving file satisfies the rule. It does not prove that every test in the pull request
  is meaningful: the job lists the files that pass without the change so a reviewer sees
  them, and the #149 defect (a test beside the path it claims to cover) is caught only when
  that test is the one the pull request relies on.

# Enforcement

`scripts/fail-first.mjs` extracts the head and the merge base with `git archive` into two
temporary trees, puts the head's `tests/` into the base tree, and runs `node --test` on each
added or changed `tests/unit/**/*.test.mjs` file in both. It prints, per file, whether it is
evidence, the kind of failure on the base (`assertion`, `module-not-found`, `missing-file`,
`error`, `timeout`) and the names of the failing tests, so a test that fails only because a
new module does not exist yet is visible as that. It exits 1 when no file is evidence.

The `fail-first` job of `.github/workflows/ci.yml` runs it on every pull request with the
title, body and head branch (`headRefName`) read from the pull request at run time, and
`gate` needs the job (`tests/unit/ci-workflows.test.mjs` fails if `gate` stops needing it, or
if the step's `gh pr view --json` stops asking for `headRefName`). The job runs it
through `.github/scripts/base-rule.sh`, which extracts `scripts/` of the base branch outside
the checkout and runs that copy on the pull request, printing the commit it came from; the
same test fails if the last command of the job's last step is anything but that call with
its exact arguments (`--title` in place of `--pr-json`, `|| true`, an `if:`), if the step
passes when there is no pull request, or if `ci.yml` can be started by anything but a pull
request (`project.ci-bounded`, `triggers`). That test binds a pull request only as far as
the pull request leaves it standing; see below. `tests/unit/base-rule.test.mjs` runs the wrapper on a
fixture pull request that replaces `scripts/fail-first.mjs` with a program that always
passes: the base's copy still refuses it.

`tests/unit/fail-first.test.mjs` runs the script on fixture repositories: a `fix` whose new
test also passes on the base is refused; one whose test fails on the base passes with the
kind printed; the same refused fixture with `fail-first: n/a docs-only` in the body passes
and prints the reason, and a waiver without a reason does not; other title types pass; a
`fix` with no unit test is refused; a new module is reported as `module-not-found`; a test
that fails on the head too is not evidence, and one that fails there once and passes on
the retry still is; a test file with a non-ASCII name is seen; `Fix(x):`, `fix (x):`, `[WIP] fix(x):` and `FEAT!:` are checked like
`fix(x):`; a waiver whose reason is `<reason>` or `...`, or that stands in a code block, an
HTML comment, a blockquote or mid-sentence, is refused; a test that reads `git ls-files`
is evidence; a train of chore and docs members passes and prints each member; a train with a
`feat` member is refused under the titles `train(x):`, `Train:`, `[WIP] train (x) :` and the
skill's own `Merge train 2026-10-17: #1, #2`, and on a `train/x` branch under a `chore(train):`
title, even with a waiver in its body; a train with no member table, a table inside a code
block, an empty table, an untyped row (`a new control`, `feature(y):`, `fixes:`, `wip:`) or a
row that is not `#<n>` is refused; a `fix` row in a second member table is refused; a
`chore(train):` title on a branch that is not `train/...` has nothing to prove; a
`feat(...)` or `fix:` title on a `train/x` branch with a docs-only member table is judged as a
feat or fix and refused for changing no unit test; the titles `Merge train 2026-10-17 (night):`,
`Merge train #1, #2:`, `Merge-train`, `Merge trains` and `merge train 2026-10-17 — #1` are
trains, and `Training notes:` is not.

What it cannot see:

- Browser suites (`tests/browser/`, `tests/visual/`). A fix proven only there needs the
  waiver, and the proof stays a claim in the pull request.
- The title at merge time. The job reads the title when it runs; a pull request retitled to
  `feat` or `fix` after its last run is not re-checked until the job is run again. The
  pull_request event does not fire on an edit, so after editing the title or the body,
  re-run the job. Nothing here catches a retitle that nobody re-runs.
- Whether a waiver's reason is true.
- A test that needs the git history: it fails in both trees and is never evidence.
- The pull request that introduces the program (the base has no copy, the wrapper says so
  and runs the pull request's), and a pull request that rewrites the `fail-first` job itself:
  GitHub runs the workflow file the pull request carries. The second is not closed; it needs
  a check GitHub runs from the base branch and branch protection requiring it, which is the
  owner's setting. Both change guarded paths, so `project.review-verdict` asks for a
  reviewer's verdict on them, with the same limit on its own job.
- A train that is neither on a `train/...` branch nor titled as one: it is judged by its title
  like any other pull request. The skill names both.
- Whether a train's member table tells the truth. The job reads the titles the body states;
  that a row's title is its member's and that every merged member is listed is for the
  reviewer of the train (`gh pr view <n> --json title` answers it).
- A merge that bypasses branch protection. Protection on `main` requires `gate` on an
  up-to-date branch (`strict: true`, `contexts: [gate]`, read from
  `gh api repos/korczis/oscilla/branches/main/protection` on 2026-10-28), so a pull request
  merges only after a run on a head that contains `main`, and therefore this rule; a branch
  whose last green run predates the rule must merge `main` and run again first. An
  administrator's merge past protection is the owner's and is not checked here
  (`project.review-verdict` says the same of itself).

Locally: `node scripts/fail-first.mjs --title "fix(scope): ..."` checks the committed head against
`origin/main`.

# Failure behaviour

The `fail-first` job fails, so `gate` fails and the pull request does not merge. The fix is a
test that exercises the changed path, or the waiver line with its reason; never a change to
the script to let a pull request through, which would not work: the base's copy judges.
