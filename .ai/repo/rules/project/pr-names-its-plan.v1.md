---
id: project.pr-names-its-plan
version: 1
kind: rule
title: A pull request names its plan record, judged by the base branch
description: Every pull request names an existing plan record in its title or branch, or waives with a reason; its title is conventional; neither its title, its body nor its commits carry a closing keyword. The base branch's program judges, and writes the metadata to the job summary.
statement: A pull request names an existing plan record in its title or branch, or waives with a reason; its title is conventional; neither its title, its body nor a commit message between the merge base and the head carries a closing keyword. An ID is a capital letter and 3 or 4 digits in the title, or a branch segment of that shape in any case, whose letter begins a record file under .ai/repo/project/issues or .ai/repo/project/milestones and whose <ID>.yaml exists there at the base or the head. A release, a release record and a merge train, each recognised by its branch and its title together, are exempt from naming one; any other pull request without one carries a line `plan: n/a <reason>` in its body's own prose. The program that judges is the base branch's copy, run by a read-only job on every pull-request event that can change the title, the body or the commits; the rule binds a merge once branch protection requires that job (owner decision C2).
status: active
class: blocking
depends_on: []
tags: [ci, process, plan]
---

# Rationale

The plan is the repository's: every milestone and issue is a record under `.ai/repo/project/`,
and Majordomus attributes a pull request to a record from its title and branch alone. On
2026-10-29, 7 of the last 40 non-release pull requests named no plan ID in either (#252, #250,
#246, #244, #230, #217, #214), so their work was delivered to nothing; an ID written
only in the body is read by nothing. A typo or a renamed record is worse: it looks like a link
and points nowhere.

A closing keyword is a write to GitHub's issues that bypasses the records: a `Closes #N`
merged in Majordomus on 2026-10-03 closed an issue whose record was still open. GitHub closes
an issue named so in any commit message that reaches the default branch, and since owner
decision C1 the title is the merge commit's subject, the body its message, and every commit
of the branch lands unchanged: all three reach `main`.

The owner decided on 2026-10-29: merge commits only (C1, applied as a repository setting) and
the rule applies to every pull request, not a type list (C3).

# Required behaviour

- The title parses as a conventional commit (`type(scope)!: description`) with a type
  `scripts/release-analyze.mjs` gives a level of its own (build, chore, ci, docs, feat, fix,
  perf, refactor, revert, style, test) or `train`, written in lower case (`title-grammar`).
  The title is the merge commit's subject on `main`, so a `[WIP]` tag (which fail-first
  reads past, to decide whether it applies) and GitHub's `Revert "..."` title are refused:
  retitle `revert: ...` before the merge.
- The title or the branch names at least one plan record (`plan-id-missing`). A title ID is
  case-sensitive (`V603`); a branch segment split on `/`, `-`, `_` and `.` is matched in any
  case (`feat/v603-timeline-pinch` names V603). The letters are the first letters of the
  record file names at the base or the head, never a list: `H264`, `A440` and a version in a
  branch (`release/v100.0.0`) are no candidates. A record the pull request itself adds counts.
- A title candidate whose letter is a record letter but which has no record file is refused
  (`plan-id-unknown`) when the pull request names no record at all: then it is a typo, or a
  record renamed without the title following it, and the title is the fix. Beside a named
  record (`V603 EBU R128`), or from the branch, which an open pull request cannot rename, it
  is a warning in the output and the summary and counts for nothing; a branch-only one leaves
  the pull request to name a record in its title or to waive.
- Exempt from naming a record, each by its branch and its title together: a release (branch
  `release/vX.Y.Z` or `chore/release-vX.Y.Z`, title `chore(release): vX.Y.Z`, and the head's
  `package.json` at X.Y.Z), a release record (branch `chore/release-record-vX.Y.Z`, title
  `chore(release): record vX.Y.Z`) and a merge train (branch `train/...`, a `train(...)`
  title naming its members as `#N`). The release and merge-train skills write these titles
  and branches, and the test reads them from the skills. Each still needs a conventional
  title and no closing keyword.
- Any other pull request that names no record says why on a line of its body:
  `plan: n/a <reason>`. The line counts only in the body's own prose (not in a fenced code
  block, an HTML comment or a blockquote), as `fail-first: n/a` does, and a reason that is
  empty, the placeholder `<reason>` or punctuation is refused (`waiver-form`). Whether the
  reason is good is the reviewer's.
- No closing keyword (`Closes`, `Fixes`, `Resolves` and their forms, with or without a
  colon, before `#N`, `owner/repo#N` or an issue URL; `closing-keyword`) in the title, the
  body (read whole: in the merge commit's message a code fence is plain text) or the message
  of a commit between the merge base and the head. A link is `Refs #N`.
- The job writes what it derived to its step summary: the records with their title (linked on
  `main`, or at the head for a record only the head adds), the milestone, what they serve, the
  SemVer level of the title, the guarded paths and the verdict state for them (`needed`,
  `refused` or `recorded`, by review-verdict's own `verdictProblems()`), the warnings, the
  fail-first state, whether plan evidence changed and the landing method. `--facts` prints the same as JSON (`pr-facts/v1`), the seam a GitHub
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
outcome of ten real pull requests hold, each at a head carrying the records its own head
carried (#254, #251 with the M055, F001 and F012 it adds, #253 refused because its head has no
F001, #248, #194 under the merge-train skill's old title, #247, #246, #228, #229 and #252; #228
and #229 stand for #237 and #243, whose version is the current one and is kept out of the tree
by `npm run version:check`); the titles and branches the release and merge-train skills write
pass; an unknown candidate is refused only as the title's one link; a waiver with a reason
passes and one that is quoted, mid-sentence, empty or the placeholder does not; every
closing-keyword spelling is refused in the title, the body and a commit message, and
`Refs #N`, `hotfix #12` and the base's own history are not; a record the head adds counts;
`--facts` and `--summary` carry the facts, the verdict state as review-verdict would judge the
file, and the diff from the merge base when the base has moved on. Its
mutation table removes each `// rule:` block in turn from a copy of the program and shows that
block's fixture then passes, so no rule is held by nothing. It also holds the workflow to its
model: a copy with `pull-requests: write`, an added permission, `edited` missing, another
trigger, another bound or job name, a non-fatal or conditional step, the checkout's own copy, a
command after the call, no guard for a missing pull request, or another or no concurrency
group each fails, and one with its permission keys in another order passes.

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
- Whether a record file is a valid record: an empty `V999.yaml` the pull request adds counts
  by its name alone. The records' shape is `majordomus plan validate`'s, which the pre-commit
  hook and `majordomus doctor` run.
- Whether a `#N` after a keyword is an issue or a pull request: both are refused (`Closes
  #197` naming a pull request closes nothing, and `Refs #197` is the right word anyway).
- Whether a train's `#N` are its members: that is fail-first's member table.
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
same. The fix is the title or the body (an open pull request's branch cannot be renamed):
name the record, correct the ID, add `plan: n/a <reason>`, write `Refs #N`, or reword the
commit whose message carries a keyword. An edit of the title or the body re-runs the job.
Never a change to the program to let a pull request through, which would not work: the base's
copy judges.
