---
id: project.review-verdict
version: 1
kind: rule
title: Risky changes merge only with a recorded review verdict for the reviewed tree
description: A pull request that changes a guarded path merges only with a committed verdict file that says merge, names the reviewer and the tree reviewed, matches the head's tree and lists no open P0 or P1 finding.
statement: A pull request touching src/js/audio, src/js/analysis, src/js/experiments, src/js/studio, src/js/core/storage*, scripts/release-* or .github/workflows merges only with .ai/repo/reviews/<pr>.yaml in its head commit carrying `verdict: merge`, the reviewer session, a `tree` equal to the head's git tree hash computed without .ai/repo/reviews/, and no finding of severity P0 or P1 with status open; the verdict is written by a reviewer who did not build the change.
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
  storage (`src/js/core/storage*`), the release scripts (`scripts/release-*`) and the
  workflows (`.github/workflows/`). An added, changed, renamed or deleted file there counts.
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
`gate` stops needing it).

`tests/unit/review-verdict.test.mjs` runs the script on fixture pull requests: an engine
change with no verdict is refused; a verdict for the previous tree followed by one more
source commit is refused; a verdict at the head tree with an open P0 or P1 is refused; a
verdict at the head tree with every finding closed is accepted, and committing it leaves the
tree hash unchanged; a docs-only pull request passes without one; `changes-requested`,
another pull request's number, a missing reviewer, a missing findings list, an unknown
severity or status and invalid YAML are refused; a deleted guarded file needs a verdict.

What it cannot see: who wrote the verdict, whether the review happened, and whether a
finding marked closed is fixed. Those are the reviewer's, as above.

# Failure behaviour

The `review-verdict` job fails and prints the guarded paths, the reason and the tree hash to
record; `gate` fails and the pull request does not merge. The fix is a review of the current
head and its verdict, never a hand-edited hash.
