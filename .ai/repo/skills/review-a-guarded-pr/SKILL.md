---
schema: skill/v1
id: review-a-guarded-pr
version: 1
title: Review a pull request that touches a guarded path
description: As a session that did not build it, review a pull request's guarded content and commit the .ai/repo/reviews/<pr>.yaml verdict that rule review-verdict requires, bound to the digest of that content.
status: draft
tags: [review, ci, process]
related: [merge-train, fail-first-change]
inputs:
  - an open pull request number and its base branch
  - a session that built no part of the change
outputs:
  - findings with severity P0 to P3 and status, each with its evidence
  - .ai/repo/reviews/<pr>.yaml on the pull request's branch, or none when nothing guarded changed
---

# Purpose

Records an independent review of the guarded content a pull request changes (rule
`project.review-verdict`; the format is `.ai/repo/reviews/README.md`). The program checks
the file, the digest and the findings; it cannot check who wrote it, so step 1 is the
reviewer's own.

# Procedure

1. Confirm you may review it. Read who built it; if any of it is yours, stop and say so:

   ```bash
   gh pr view <pr> --json title,body,baseRefName,headRefName,author,commits
   ```

2. Check out the head in its canonical worktree and start the review task (when the
   builder's task is still active there, `start` refuses: agree with the builder first):

   ```bash
   majordomus worktree ensure <head-branch>
   cd "$(majordomus worktree path <head-branch>)"
   git fetch origin && git merge --ff-only origin/<head-branch>
   npm ci
   majordomus start "Review #<pr>" --scope .ai/repo/reviews
   ```

3. Is a verdict needed, and over what? Against the pull request's base:

   ```bash
   node scripts/review-verdict.mjs --content --list --base-branch origin/<base>
   ```

   No path listed (the digest of nothing, `e3b0c442...`): no verdict is needed.

4. Review the listed paths and the tests that claim to cover them:

   ```bash
   git diff origin/<base>...HEAD -- <listed paths>
   npm run verify
   ```

   Write each finding with an id, a severity (P0 to P3), its evidence and the smallest fix.
   A `feat`/`fix` pull request also has to prove fail-first: read its `fail-first` job, or
   run `node scripts/fail-first.mjs --title "<title>" --base-branch origin/<base>`.

5. Write `.ai/repo/reviews/<pr>.yaml` with the digest step 3 printed:

   ```yaml
   schema: review-verdict/v1
   pr: <pr>
   verdict: merge                   # or changes-requested
   reviewer: <your session>
   content: <digest>
   findings:
     - { id: R1, severity: P2, status: open, title: <one line> }
   ```

   An open P0 or P1 refuses the merge whatever `verdict` says; a finding is closed by the
   change that fixes it and your look at the new content, not by editing the word.

6. Check it and commit it on the pull request's branch:

   ```bash
   node scripts/review-verdict.mjs --pr <pr> --base-branch origin/<base>
   git add .ai/repo/reviews/<pr>.yaml
   git commit -m "docs(review): verdict for #<pr>"
   majordomus finish --outcome completed --note <file> \
     --verify-command "node scripts/review-verdict.mjs --pr <pr> --base-branch origin/<base>"
   git push origin <head-branch>
   ```

7. After the builder merges the base or adds commits, run step 6's check again. It still
   passes when no guarded path of the pull request moved (a rebuilt `dist/index.html`, docs,
   UI code, a merge of main that left those files alone). It refuses when a guarded path
   changed, or main changed a guarded file the pull request also changes; then read what
   moved, `git diff <reviewed-head> HEAD -- <listed paths>`, and replace the verdict with
   the new digest.

# Output

- The findings, each with severity, status, evidence and the smallest fix, reported to the
  builder.
- `.ai/repo/reviews/<pr>.yaml` on the pull request's branch, accepted by
  `node scripts/review-verdict.mjs --pr <pr>`, or the statement that nothing guarded changed.
