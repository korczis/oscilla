---
id: project.review-verdict
version: 1
kind: rule
title: Risky changes merge only with a recorded review verdict for the reviewed content
description: A pull request that changes a guarded path merges only with a committed verdict file that says merge, names the reviewer, records the digest of the guarded content the pull request changes and lists no open P0 or P1 finding.
statement: A pull request touching src/js/audio, src/js/analysis, src/js/experiments, src/js/studio, src/js/core/storage*, scripts/release-*, anything under .github/, or the programs and tests that enforce the process rules (scripts/review-verdict.mjs, scripts/fail-first.mjs, scripts/ci-workflow-rules.mjs, scripts/yaml-subset.mjs, their tests under tests/unit/ and tests/unit/fixtures/git-repo.mjs) merges only with .ai/repo/reviews/<pr>.yaml carrying `verdict: merge`, the reviewer session, a `content` equal to the SHA-256 of the guarded paths the pull request changes against its merge base (mode, blob and name of each, as merged with the base branch for the run), and no finding of severity P0 or P1 with status open; the guarded list that applies is the base branch's, the verdict is written by a reviewer who did not build the change, and a pull request is bound from the first CI run of a head that contains this rule's job.
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
  `.ai/repo/reviews/README.md`: `pr`, `verdict`, `reviewer`, `content`, `findings`.
- `content` binds the verdict to what the pull request changes, not to a tree that moves
  with `main`. It is a SHA-256 over every guarded path that differs between the merge base
  and the head, each as its mode, blob and name at the head (a deleted path as deleted):
  `node scripts/review-verdict.mjs --content` prints it, and `--content --list` the paths.
  What does and does not make a recorded verdict stale follows from that:
  - Committing the verdict does not: the verdict file is not a guarded path.
  - A later commit that touches no guarded path does not. Such a commit needs no verdict by
    this rule on its own; this includes the rebuilt `dist/index.html`, which
    `npm run build:check` ties to the tree it is committed in.
  - A merge of `main` that leaves the pull request's guarded paths as the reviewer saw them
    does not, whatever else `main` brought (other guarded files included): the merge base
    moves with the head and the difference between them is the same.
  - A commit that changes, adds or drops a guarded path of the pull request does.
  - A merge of `main` does when `main` changed a guarded file the pull request also changes
    (with or without a conflict: the merged file is one nobody reviewed), when `main` landed
    a guarded change the pull request carried, when the merge commit itself carries a guarded
    change, or when `main` brought a longer guarded list that now covers a path of the pull
    request.
  A stale verdict is replaced by the reviewer after looking at what moved.
- Every finding of the review is listed with its severity (P0 to P3) and status. An open P0
  or P1 refuses the merge whatever `verdict` says.
- The reviewer is a session other than the one that built the change, and writes the file
  itself. This part is reviewer-owned: no program here can tell who wrote a file, and a
  builder who writes its own verdict passes the check and breaks the rule.
- A pull request that touches no guarded path needs no verdict, and a verdict file does it
  no harm.

# Enforcement

`scripts/review-verdict.mjs --pr <n>` diffs the head it is given against its merge base
(`git diff --raw -z`, so a path with non-ASCII characters is read as itself); when a guarded
path changed, it reads `.ai/repo/reviews/<n>.yaml` from that commit and refuses unless the
schema, the pull request number, `verdict: merge`, a non-empty `reviewer`, a `content` equal
to the digest it computes and a findings list with no open P0 or P1 are all there. An unknown
severity or status refuses, and so does a 40-character tree hash in place of the digest.

The `review-verdict` job of `.github/workflows/ci.yml` runs it on every pull request, on the
`HEAD` of its checkout: the pull request as GitHub merged it with the base branch for that
run. So a base branch that has changed one of the pull request's guarded files since the
review is refused in that run even when the branch has not merged it yet, and the remedy is
to merge `main` into the branch and have the result reviewed. `gate` needs the job
(`tests/unit/ci-workflows.test.mjs` fails if `gate` stops needing it). The job runs the
program through `.github/scripts/base-rule.sh`, which extracts `scripts/` of the base branch
outside the checkout and runs that copy, printing the commit it came from. The same test
holds the caller: the last command of the job's last step is exactly that call with exactly
those arguments (`|| true`, a command after it, another `--head` or base, the checkout's own
copy, an `if:` on the job or the step and an early `exit 0` each fail it), the step fails
when there is no pull request, and `ci.yml` can be started by nothing but a pull request
(`project.ci-bounded`, `triggers`: a manual run on the branch would put a green `gate` on
the head with nothing judged). That test binds a pull request only as far as the pull
request leaves it standing; see below.

`tests/unit/base-rule.test.mjs` runs the wrapper on fixture pull requests whose `main`
carries the real programs: one that changes the audio engine and deletes `src/js/audio/*`
from `GUARDED`, and one that replaces the program with one that always accepts, are both
refused by the base's copy, while the second's own copy lets it through.

`tests/unit/review-verdict.test.mjs` runs the script on fixture pull requests: an engine
change with no verdict is refused; a verdict followed by one more commit to a guarded
path is refused; a verdict for the head's content with an open P0 or P1 is refused; one with
every finding closed is accepted, and committing it leaves the digest unchanged; after a
merge of `main` that changed another guarded file, an unguarded file and `dist/index.html`
(a conflict, resolved by a rebuild) the same verdict is still accepted; after a merge of
`main` that changed another region of the pull request's own guarded file it is refused, and
so is a merge commit that carries a guarded change of its own; a later commit to unguarded
paths keeps it and a new guarded path does not; a guarded change reverted to the base needs
none; a mode change and a deletion change the digest; a guarded file with a non-ASCII or
quoted name is seen; a docs-only pull request passes without one; `changes-requested`,
another pull request's number, a missing reviewer, a missing findings list, an unknown
severity or status and invalid YAML are refused; a deleted guarded file needs a verdict; a
change to each kind of enforcement file (the programs, `ci-install.sh`, a composite action,
`doctor-verdict.jq`, a test, the fixture) with no verdict is refused; every guarded file
that is not a pattern exists.

What it cannot see:

- Who wrote the verdict, whether the review happened, and whether a finding marked closed is
  fixed. Those are the reviewer's, as above.
- What the reviewer looked at beyond the guarded paths. The digest covers the guarded paths
  only, so a commit after the review that changes other files (UI code, a test outside the
  list, documentation) leaves the verdict standing. And a merge of `main` that leaves the
  pull request's guarded files alone keeps the verdict although the reviewer never saw the
  two together: whether they still work together is what the suites of the same run are
  for, not this rule.
- `main` moving after the run. Branch protection on `main` requires the `gate` check and
  does not require the branch to be up to date (`strict: false`, read from
  `gh api repos/korczis/oscilla/branches/main/protection` when this rule was written). A
  green `gate` on an unchanged head stays valid when `main` moves, so a guarded file changed
  on `main` after a pull request's last run is merged with it unjudged unless the two
  conflict. Requiring up-to-date branches is the owner's setting.
- A branch that does not contain this rule. On a pull request GitHub runs the `ci.yml` of
  the pull request's own merge with `main`, and with `strict: false` a pull request whose
  last run was green before the rule reached `main` keeps that green `gate` and can merge
  with neither a verdict nor a fail-first run. Such a pull request is bound only from its
  next run, which needs a new commit on it, in practice a merge of `main`. Nothing in the
  repository forces that merge: a pull request that changes `src/` conflicts with `main` in
  `dist/index.html` as soon as another such one lands and has to merge `main` to become
  mergeable, and one that does not conflict does not have to. Merging `main` into every
  pull request that was open when the rule landed, before landing it, is a step of the
  coordinator's landing procedure and is not machine-checked.
- A stale branch started by hand. The `triggers` check holds on a branch that contains this
  rule; a branch from before it still carries a `ci.yml` with `workflow_dispatch`.
- A pull request that rewrites the `review-verdict` job itself, or the wrapper, or the test
  that holds the caller. On a pull request GitHub runs the workflow file the pull request
  carries, so a pull request that removes the step is not stopped by the step. This is not
  closed. Closing it needs a check GitHub runs from
  the base branch (`pull_request_target` or a ruleset's required workflow) and branch
  protection that requires it, which is the owner's setting and is not in this repository.
  Until then such a pull request is visible as a change under `.github/`, which a reviewer
  of any pull request sees in its file list, and that is all.
- The pull request that introduces the program: the base has no copy, the wrapper says so in
  a warning and runs the pull request's.

# Failure behaviour

The `review-verdict` job fails and prints the guarded paths, the reason and the digest to
record; `gate` fails and the pull request does not merge. The fix is a review of the current
content and its verdict, never a hand-edited digest.
