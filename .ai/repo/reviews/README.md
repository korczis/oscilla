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
tree: 197f198cda90725111e040dce2f054ae72214d4a
findings:                        # every finding of the review; [] when it found none
  - { id: R1, severity: P1, status: closed, title: calibration bound to the wrong input }
  - { id: R2, severity: P3, status: open, title: wording of the refusal }
```

## Who writes these

The reviewer, after reviewing the head of the pull request, and nobody else. The builder of a
change does not write its verdict. The program cannot tell a reviewer from a builder: that the
`reviewer` is independent is the reviewer's own statement, and a verdict written by the builder
is a violation of the rule that only a person or another reviewer can see.

## The tree

`tree` is the git tree of the reviewed head with this directory left out:

```bash
node scripts/review-verdict.mjs --tree            # at the head that was reviewed
```

Committing the verdict therefore does not change the hash it records, and any other commit
after the review does: the verdict then names a tree that is no longer the head's, the job
refuses, and the reviewer looks at what moved and records the new tree. Merging `main` into
the branch moves the tree too.

## Findings

`severity` is P0, P1, P2 or P3 and `status` is open or closed. An open P0 or P1 refuses the
merge whatever `verdict` says; anything the program cannot read (another severity, another
status, no list) refuses too. A finding is closed by the change that fixes it and the reviewer
confirming it on the new tree, not by editing the word.

## Checking one locally

```bash
node scripts/review-verdict.mjs --pr <number>     # the committed head against origin/main
```
