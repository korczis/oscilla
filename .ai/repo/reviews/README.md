---
schema: context/v1
id: ai.repo.reviews
kind: context
title: Review verdicts
description: One review-verdict/v1 record per pull request that changed a guarded path, written by the reviewer and checked by scripts/review-verdict.mjs.
status: active
scope: subtree
providers: ["*"]
audience: [human, agent]
composition: extend
order: 100
---

# Review verdicts

One file per pull request, `<pr number>.yaml`, required by rule `project.review-verdict` when
the pull request changes a guarded path (the list is `GUARDED` in `scripts/review-verdict.mjs`
and in the rule; the copy that judges a pull request is the base branch's). The
`review-verdict` job of `.github/workflows/ci.yml` refuses the pull request without a valid
one, and `gate` needs that job.

```yaml
schema: review-verdict/v1
pr: 160
verdict: merge                   # merge | changes-requested
reviewer: oscilla-25             # the reviewing session, never the session that built the change
content: 9f2c4e1ab7d05c63e8a1f4b29d7c05e6a3b8f1d24c6e9a0b7d3f5c8e1a2b4d6f
findings:                        # every finding of the review; [] when it found none
  - { id: R1, severity: P1, status: closed, title: calibration bound to the wrong input }
  - { id: R2, severity: P3, status: open, title: wording of the refusal }
```

## Who writes these

The reviewer, after reviewing the head of the pull request, and nobody else. The builder of a
change does not write its verdict. The program cannot tell a reviewer from a builder: that the
`reviewer` is independent is the reviewer's own statement, and a verdict written by the builder
is a violation of the rule that only a person or another reviewer can see.

## The content

`content` is a SHA-256 over the guarded paths the pull request changes against its merge base
(mode, blob and name of each at the head):

```bash
git fetch origin
node scripts/review-verdict.mjs --content --list  # at the head that was reviewed
```

It names what the pull request changes, not the head's tree, so it does not move with `main`:

| after the review | the verdict |
|---|---|
| the verdict is committed | stands |
| a commit that touches no guarded path (`dist/index.html` rebuilt, documentation, UI code) | stands |
| `main` is merged and the pull request's guarded files come out as reviewed | stands |
| a commit changes, adds or drops a guarded path | stale |
| `main` is merged and it changed a guarded file the pull request also changes, conflict or not | stale |
| `main` changed such a file and the branch has not merged it | refused in CI, which judges the pull request as merged with `main`; merge `main` first |

When it is stale the job refuses and prints the digest of the current content; the reviewer
looks at what moved and records that.

## Findings

`severity` is P0, P1, P2 or P3 and `status` is open or closed. An open P0 or P1 refuses the
merge whatever `verdict` says; anything the program cannot read (another severity, another
status, no list) refuses too. A finding is closed by the change that fixes it and the reviewer
confirming it on the new content, not by editing the word.

## What the reviewer checks

Besides the change itself, three checks that past reviews missed:

1. For an audio, studio or synth member, every allocation per event (a node built, a connect, a
   push onto the handle's own state) has a release during play, not only at stop. The reviewer
   drives N events (triggers, notes, resets) and an advance past their ends, then asserts the
   handle's own bookkeeping and the shared sources' fan-out are bounded (O(live voices)), not
   only the engine census.
2. Run the release receipt against the base ci.yml when gate jobs change (the #509 miss).
3. Run every suite that reads a changed string or a touched module (the F-2 and K104 misses).

## Trains

A train's members are judged by their own verdicts (rule `project.review-verdict`). Each
member's `<n>.yaml` at the train's head, where one exists, must say `verdict: merge`. A member
whose verdict says anything else rides only when the train's reviewer judges its content and
names it in the train's verdict:

```yaml
members:                         # optional; only for members whose own verdict is not merge
  - { pr: 303, verdict: merge, reason: "R-1 and R-2 fixed in the train at 3a840b66" }
```

Adding `members` does not change `content`: the verdict file is not a guarded path.

A train goes in this order:

1. The members are assembled.
2. The pre-stamp head goes to the reviewer (fail-first, units, the guarded read) while peers run
   the browser suites.
3. Fixes.
4. The release stamp.
5. The verdict yaml on the stamped head, after checking the guarded digest is unchanged (the
   stamp touches no guarded path).
6. Push, the CI legs, "legs OK", arm.

T5 was stamped first; stale assertions in three suites (v31-studio-graph, demo-song, app) and
C1-K229-1 forced a rebuild and a re-stamp.

## Checking one locally

```bash
node scripts/review-verdict.mjs --pr <number>     # the committed head against origin/main
gh pr view <number> --json title,body,headRefName > pr.json
node scripts/review-verdict.mjs --pr <number> --pr-json pr.json   # a train, with its members
```
