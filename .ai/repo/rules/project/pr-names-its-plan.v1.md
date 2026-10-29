---
id: project.pr-names-its-plan
version: 1
kind: rule
title: A pull request names its plan record, judged by the base branch
description: Every pull request names an existing plan record in its title or branch, or waives with a reason; its title is conventional; its body carries no closing keyword. The base branch's program judges, and writes the metadata to the job summary.
statement: A pull request names an existing plan record in its title or branch, or waives with a reason; its title is conventional; it carries no closing keyword. An ID is a capital letter and 3 or 4 digits in the title, or a branch segment of that shape in any case, whose letter begins a record file under .ai/repo/project/issues or .ai/repo/project/milestones and whose <ID>.yaml exists there at the base or the head. A release, a release record and a merge train are exempt from naming one; any other pull request without one carries a line `plan: n/a <reason>` in its body's own prose. The program that judges is the base branch's copy, run by a read-only job on every pull-request event that can change the title, the body or the commits; the rule binds a merge once branch protection requires that job (owner decision C2).
status: active
class: blocking
depends_on: []
tags: [ci, process, plan]
---

# Rationale

The plan is the repository's: every milestone and issue is a record under `.ai/repo/project/`,
and Majordomus attributes a pull request to a record from its title and branch alone. On
2026-10-29, 8 of the last 40 non-release pull requests named no plan ID in either (#252, #250,
#246, #244, #238, #230, #217, #214), so their work was delivered to nothing; an ID written
only in the body is read by nothing. A typo or a renamed record is worse: it looks like a link
and points nowhere.

A closing keyword in a body is a write to GitHub's issues that bypasses the records: a
`Closes #N` merged in Majordomus on 2026-10-03 closed an issue whose record was still open.
Since owner decision C1 the body is the merge commit's message, so the keyword reaches `main`.

The owner decided on 2026-10-29: merge commits only (C1, applied as a repository setting), the
rule applies to every pull request, not a type list (C3), and GitHub milestones come before
GitHub issues (C5, not this rule's work).

# Required behaviour

- The title parses as a conventional commit (`type(scope)!: description`) with a type
  `scripts/release-analyze.mjs` gives a level of its own (build, chore, ci, docs, feat, fix,
  perf, refactor, revert, style, test) or `train`, written in lower case (`title-grammar`).
- The title or the branch names at least one plan record (`plan-id-missing`). A title ID is
  case-sensitive (`V603`); a branch segment split on `/`, `-`, `_` and `.` is matched in any
  case (`feat/v603-timeline-pinch` names V603). The letters are the first letters of the
  record file names at the base or the head, never a list: `H264`, `A440` and the `v3` of a
  version are no candidates. A record the pull request itself adds counts.
- A candidate whose letter is a record letter but which has no record file is refused
  (`plan-id-unknown`): a typo, or a record renamed without the title following it.
- Exempt from naming a record: a release (branch `release/vX.Y.Z` and title
  `chore(release): vX.Y.Z` of the same version), a release record (branch
  `chore/release-record-vX.Y.Z`) and a merge train (a `train(...)` title naming its members
  as `#N`). Each still needs a conventional title and a body without a closing keyword.
- Any other pull request that names no record says why on a line of its body:
  `plan: n/a <reason>`. The line counts only in the body's own prose (not in a fenced code
  block, an HTML comment or a blockquote), as `fail-first: n/a` does, and a reason that is
  empty, the placeholder `<reason>` or punctuation is refused (`waiver-form`). Whether the
  reason is good is the reviewer's.
- The body carries no closing keyword (`Closes`, `Fixes`, `Resolves` and their forms, with or
  without a colon, before `#N` or `owner/repo#N`; `closing-keyword`). A link is `Refs #N`.
- The job writes what it derived to its step summary: the records with their title, the
  milestone, what they serve, the SemVer level of the title, the guarded paths and whether
  a verdict is recorded for them, the fail-first state, whether plan evidence changed and the
  landing method. `--facts` prints the same as JSON (`pr-facts/v1`), the seam a GitHub
  projection reads later; nothing in this repository writes labels, milestones or issues.

# Enforcement

`scripts/pr-metadata.mjs` derives the candidates from the title and the branch, the records
from `git ls-tree` at the base and the head, and judges the five codes above; each rule is a
block between `// rule: <code>` and `// end rule: <code>` markers. It exits 1 with one line
per violation. Its model is `.ai/repo/ci/pr-meta.yaml`: the judge job (workflow, job, bound,
triggers, permissions, the exact call), the record directories, the exemptions, the waiver,
the codes, the facts command and the repository settings of decision C1.

`.github/workflows/metadata.yml` runs it in one job, `metadata`, on `opened`, `edited`,
`synchronize`, `reopened` and `ready_for_review`, with the pull request's title, body and
branch read from GitHub at run time (three tries, ten seconds apart), and only the
`contents: read` and `pull-requests: read` permissions. The program is the base branch's,
through `.github/scripts/base-rule.sh`, which admits it beside the fail-first and
review-verdict programs. The job is bounded (5 minutes, every step its own), installs nothing,
and is not part of `gate`.

`tests/unit/pr-metadata.test.mjs` runs the program on fixture repositories: a clean pull
request passes and one fixture per code fails with exactly that code; the title, branch and
expected outcome of seven real pull requests hold (#254, #253, #248, #247, #246, #228, #252;
#228 stands for the release #237, whose version is the current one and is kept out of the tree
by `npm run version:check`); a waiver with a reason passes and one that is quoted,
mid-sentence, empty or the placeholder does not; every closing-keyword spelling is refused and
`Refs #N` is not; a record the head adds counts; `--facts` and `--summary` carry the facts. Its
mutation table removes each `// rule:` block in turn from a copy of the program and shows that
block's fixture then passes, so no rule is held by nothing. It also holds the workflow to its
model: a copy with `pull-requests: write`, an added permission, `edited` missing, another
trigger, another bound or job name, a non-fatal or conditional step, the checkout's own copy, a
command after the call or no guard for a missing pull request each fails.

`tests/unit/base-rule.test.mjs` runs the wrapper on a fixture pull request that replaces the
program with one that always passes: the base's copy still refuses it.
`tests/unit/ci-workflows.test.mjs` fails when `metadata.yml` can be started by anything but a
pull request (`project.ci-bounded`, `triggers`, which now covers every workflow with a step
that runs `base-rule.sh`) or when its job or its `gh` step loses its bound.

Locally: `node scripts/pr-metadata.mjs --pr-json <file> --check` with the file from
`gh pr view <n> --json title,body,headRefName,number`, against `origin/main`.

What it cannot see:

- A merge before branch protection requires `metadata` (owner decision C2: the owner adds it
  after the job has run green on three or more pull requests). Until then a red `metadata`
  is visible and does not block.
- Whether the named record is the right one, and whether a waiver's reason is true.
- An ID written only in the body, which counts for nothing, on purpose: delivery reads the
  title and the branch.
- The repository settings of decision C1. They are recorded in `.ai/repo/ci/pr-meta.yaml`
  and compared by nothing here; the comparison is Majordomus' (`forge check --repo`, draft B7).
- A pull request that rewrites `metadata.yml` itself: GitHub runs the workflow file the pull
  request carries, as for `ci.yml`. Such a change is under `.github/`, so
  `project.review-verdict` asks a reviewer for a verdict on it.
- The pull request that introduces the program: the base has no copy, the wrapper says so in
  a warning and runs the pull request's.

# Failure behaviour

The `metadata` job fails and prints each violation with its code; its step summary shows the
same. The fix is the title, the branch or the body: name the record, correct the ID, add
`plan: n/a <reason>`, or write `Refs #N`. An edit of the title or the body re-runs the job.
Never a change to the program to let a pull request through, which would not work: the base's
copy judges.
