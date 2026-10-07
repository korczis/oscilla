---
id: project.review-verdict
version: 1
kind: rule
title: Risky changes merge only with a recorded review verdict for the reviewed tree
description: A pull request that changes a guarded path merges only with a committed verdict file that says merge, names the reviewer and the tree reviewed, matches the head's tree and lists no open P0 or P1 finding.
statement: A pull request touching src/js/audio, src/js/analysis, src/js/experiments, src/js/studio, src/js/core/storage*, scripts/release-*, anything under .github/, or the programs and tests that enforce the process rules (scripts/review-verdict.mjs, scripts/fail-first.mjs, scripts/ci-workflow-rules.mjs, scripts/yaml-subset.mjs, their tests under tests/unit/ and tests/unit/fixtures/git-repo.mjs) merges only with .ai/repo/reviews/<pr>.yaml in its head commit carrying `verdict: merge`, the reviewer session, a `tree` equal to the head's git tree hash computed without .ai/repo/reviews/, and no finding of severity P0 or P1 with status open; the guarded list that applies is the base branch's, and the verdict is written by a reviewer who did not build the change.
status: active
class: blocking
depends_on: []
tags: [ci, process, review]
---

# Rationale

On these paths the builder's own suites passed every time and an independent review still
found defects:

- #149: the first review found two P0 false-provenance defects; the second found one P0
  surviving on a second path.
- #139: a calibration binding was never checked in the engine, so microphone A's calibration
  was applied to microphone B.
- #140 (D1): an audible LFO-to-level carrier leak.

The review was practised on every such pull request from #98 to #157 and recorded nowhere,
so nothing could tell a reviewed head from one that had moved since, or from one that was
never reviewed.

# Required behaviour

- The guarded paths are the audio engine and graph builders (`src/js/audio/`), the analysis
  code (`src/js/analysis/`), experiments (`src/js/experiments/`), Studio (`src/js/studio/`),
  storage (`src/js/core/storage*`), the release scripts (`scripts/release-*`), and what
  enforces the process rules: everything under `.github/` (the workflows, `ci-install.sh`,
  `base-rule.sh`, composite actions, `doctor-verdict.jq`), the programs
  `scripts/review-verdict.mjs`, `scripts/fail-first.mjs`, `scripts/ci-workflow-rules.mjs` and
  `scripts/yaml-subset.mjs`, their tests `tests/unit/review-verdict.test.mjs`,
  `fail-first.test.mjs`, `ci-workflows.test.mjs`, `ci-knowledge-job.test.mjs`,
  `yaml-subset.test.mjs` and `base-rule.test.mjs`, and `tests/unit/fixtures/git-repo.mjs`.
  An added, changed, renamed or deleted file there counts. The list is `GUARDED` in
  `scripts/review-verdict.mjs`.
- The list that judges a pull request is the base branch's, not the one the pull request
  carries: a pull request that shortens the list is judged by the list it found, and needs
  a verdict for touching it.
- The verdict is `.ai/repo/reviews/<pr>.yaml`, schema `review-verdict/v1`, described in
  `.ai/repo/reviews/README.md`: `pr`, `verdict`, `reviewer`, `tree`, `findings`.
- `tree` is the reviewed head's tree with `.ai/repo/reviews/` left out
  (`node scripts/review-verdict.mjs --tree`). The verdict is committed on top of the reviewed
  head as a commit that changes nothing else. Any later commit, a merge of `main` included,
  makes it stale, and the reviewer records the new tree after looking at what moved.
- Every finding of the review is listed with its severity (P0 to P3) and status. An open P0
  or P1 refuses the merge whatever `verdict` says.
- The reviewer is a session other than the one that built the change, and writes the file
  itself. This part is reviewer-owned: no program here can tell who wrote a file, and a
  builder who writes its own verdict passes the check and breaks the rule.
- A pull request that touches no guarded path needs no verdict, and a verdict file does it
  no harm.

# Enforcement

`scripts/review-verdict.mjs --pr <n>` diffs the pull request's head against its merge base;
when a guarded path changed, it reads `.ai/repo/reviews/<n>.yaml` from the head commit and
refuses unless the schema, the pull request number, `verdict: merge`, a non-empty `reviewer`,
a `tree` equal to the head's (computed in a throwaway index with the reviews directory
removed) and a findings list with no open P0 or P1 are all there. An unknown severity or
status refuses.

The `review-verdict` job of `.github/workflows/ci.yml` runs it on every pull request against
the pull request's own head commit (not the merge with `main`, so `main` moving does not
stale a verdict), and `gate` needs the job (`tests/unit/ci-workflows.test.mjs` fails if
`gate` stops needing it). The job runs it through `.github/scripts/base-rule.sh`, which
extracts `scripts/` of the base branch outside the checkout and runs that copy, printing the
commit it came from; the same test fails if the job calls the program any other way, if it
passes when there is no pull request, or if `ci.yml` can be started by anything but a pull
request (`project.ci-bounded`, `triggers`: a manual run on the branch would put a green
`gate` on the head with nothing judged).

`tests/unit/base-rule.test.mjs` runs the wrapper on fixture pull requests whose `main`
carries the real programs: one that changes the audio engine and deletes `src/js/audio/*`
from `GUARDED`, and one that replaces the program with one that always accepts, are both
refused by the base's copy, while the second's own copy lets it through.

`tests/unit/review-verdict.test.mjs` runs the script on fixture pull requests: an engine
change with no verdict is refused; a verdict for the previous tree followed by one more
source commit is refused; a verdict at the head tree with an open P0 or P1 is refused; a
verdict at the head tree with every finding closed is accepted, and committing it leaves the
tree hash unchanged; a docs-only pull request passes without one; `changes-requested`,
another pull request's number, a missing reviewer, a missing findings list, an unknown
severity or status and invalid YAML are refused; a deleted guarded file needs a verdict; a
change to each kind of enforcement file (the programs, `ci-install.sh`, a composite action,
`doctor-verdict.jq`, a test, the fixture) with no verdict is refused; every guarded file
that is not a pattern exists.

What it cannot see:

- Who wrote the verdict, whether the review happened, and whether a finding marked closed is
  fixed. Those are the reviewer's, as above.
- A pull request that rewrites the `review-verdict` job itself, or the wrapper. On a pull
  request GitHub runs the workflow file the pull request carries, so a pull request that
  removes the step is not stopped by the step. Closing that needs a check GitHub runs from
  the base branch (`pull_request_target` or a ruleset's required workflow) and branch
  protection that requires it, which is the owner's setting and is not in this repository.
  Until then such a pull request is visible as a change under `.github/`, which a reviewer
  of any pull request sees in its file list, and that is all.
- The pull request that introduces the program: the base has no copy, the wrapper says so in
  a warning and runs the pull request's.

# Failure behaviour

The `review-verdict` job fails and prints the guarded paths, the reason and the tree hash to
record; `gate` fails and the pull request does not merge. The fix is a review of the current
head and its verdict, never a hand-edited hash.
