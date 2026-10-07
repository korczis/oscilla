---
id: project.fail-first
version: 1
kind: rule
title: A feat or fix PR's tests fail without the change
description: For a pull request titled feat or fix, CI runs the unit tests it adds or changes against the merge base and at least one must fail there and pass on the head, unless the body carries a printed waiver.
statement: For a pull request whose title starts with feat or fix, at least one tests/unit/**/*.test.mjs file the pull request adds or changes fails when run against the merge base's tree (its src/ and everything else outside tests/) and passes against the head's, unless the pull request body carries a line `fail-first: n/a <reason>`, which the CI job prints.
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
  the merge base and passes on the head. The title is matched as
  `^(feat|fix)(\(scope\))?!?:`; every other type has nothing to prove.
- "Without the change" is the merge base's whole tree with the head's `tests/` in place of
  its own: a test of `scripts/` must fail on the base's script as a test of `src/` must fail
  on the base's source, and `dist/` there is the base's build.
- A test file that fails on the head as well is not evidence: something other than the
  change fails it (a test that needs the git history, for one, since both trees are plain
  `git archive` extracts). The head run is repeated once when it fails, and the job says so,
  because a test that is sensitive to a loaded machine would otherwise hide real evidence.
- A change no unit test can demonstrate (documentation under a `fix` title, a behaviour only
  a browser suite can observe) says so in the pull request body, on a line of its own:
  `fail-first: n/a <reason>`. The reason is required. It is printed in the job log, and
  whether it is a good reason is for the reviewer.
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
title and body read from the pull request at run time, and `gate` needs the job
(`tests/unit/ci-workflows.test.mjs` fails if `gate` stops needing it).

`tests/unit/fail-first.test.mjs` runs the script on fixture repositories: a `fix` whose new
test also passes on the base is refused; one whose test fails on the base passes with the
kind printed; the same refused fixture with `fail-first: n/a docs-only` in the body passes
and prints the reason, and a waiver without a reason does not; other title types pass; a
`fix` with no unit test is refused; a new module is reported as `module-not-found`; a test
that fails on the head too is not evidence, and one that fails there once and passes on
the retry still is.

What it cannot see:

- Browser suites (`tests/browser/`, `tests/visual/`). A fix proven only there needs the
  waiver, and the proof stays a claim in the pull request.
- The title at merge time. The job reads the title when it runs; a pull request retitled to
  `feat` or `fix` after its last run is not re-checked until the job is run again. The
  pull_request event does not fire on an edit, so after editing the title or the body,
  re-run the job.
- Whether a waiver's reason is true.

Locally: `node scripts/fail-first.mjs --title "fix(scope): ..."` checks the committed head against
`origin/main`.

# Failure behaviour

The `fail-first` job fails, so `gate` fails and the pull request does not merge. The fix is a
test that exercises the changed path, or the waiver line with its reason; never a change to
the script to let a pull request through.
