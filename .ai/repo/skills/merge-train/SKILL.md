---
schema: skill/v1
id: merge-train
version: 1
title: Build and land a merge train
description: Land several ready pull requests together through one train/<date> integration branch, one dist rebuild and one merge commit (ADR 0055).
status: draft
tags: [git, ci, release-engineering]
related: [review-a-guarded-pr, fail-first-change]
inputs:
  - two or more open pull requests whose gate is green and which the owner wants landed
  - a quiet machine for one npm run verify
outputs:
  - a train/<date> branch: one --no-ff merge commit per included pull request, one dist rebuild
  - one pull request to main, armed with gh pr merge --auto --merge
---

# Purpose

Turns N ready pull requests into one CI round and one `dist/index.html` rebuild instead of N
([ADR 0055](../../adrs/0055-merge-train-lands-by-one-merge-commit-after-one-rebuild.md)).
It is for a batch; a single change still ships alone with `gh pr merge --auto --squash`. It
does not replace the review of the included changes: the train's combined diff is reviewed
once, with `review-a-guarded-pr`.

# When to use

Several pull requests are ready at once and each one that changes `src/` would conflict on
`dist/index.html` after the first lands.

# Procedure

1. List the candidates and their state; keep only green, mergeable ones, and check no
   release is in flight (rule `project.release-flow-complete`: nothing else merges between
   prepare and publish):

   ```bash
   gh pr list --state open --json number,title,headRefName,mergeable,statusCheckRollup
   gh pr list --state open --search "chore(release) in:title" --json number,title
   ```

2. Create the train in its own worktree and start the task there
   ([task lifecycle](../../workflows/task-lifecycle.md)):

   ```bash
   majordomus worktree create train/<yyyy-mm-dd>
   cd "$(majordomus worktree path train/<yyyy-mm-dd>)"
   npm ci
   majordomus start "Merge train <yyyy-mm-dd>" --scope <every path the included PRs touch>
   ```

   `gh pr diff <n> --name-only` lists a pull request's paths.

3. Choose the order. A tooling migration (a Majordomus layer or pin change) goes first,
   because with the new tool installed every later commit on the old layer fails the hook.

4. Merge each branch, one command at a time, so the pre-commit hook judges every merge
   commit (a clean `git merge` would commit without it):

   ```bash
   git fetch origin
   git merge --no-ff --no-commit origin/<branch>
   git diff --name-only --diff-filter=U          # the unmerged paths
   ```

   - `dist/index.html` unmerged: take either side, `git checkout --theirs dist/index.html`,
     then `git add dist/index.html`. It is rebuilt once at the end.
   - Any other unmerged path: resolve it by hand, then `git add <path>`.
   - Before committing, no path is unmerged and no marker is left (rule
     `project.no-conflict-markers`; the test applies the allowlist of look-alike lines):

     ```bash
     git diff --name-only --diff-filter=U          # empty
     node --test tests/unit/repo-hygiene.test.mjs
     git commit --no-edit
     ```

   Never put the merge and the commit in one command line.

5. After the last merge, rebuild once, commit, and verify the train head:

   ```bash
   npm run build
   git add dist/index.html
   git commit -m "build(dist): rebuild for the train"
   npm run verify
   ```

   A unit test an included pull request added needs its `tests/README.md` row; the
   inventory check of `tests/unit/knowledge-integrity.test.mjs` names a missing one.

6. Push and open the pull request to main. The body lists the included pull requests, the
   conflicts and how each was resolved, the verification, and on a line of its own the
   waiver `fail-first: n/a integration train; each included PR carries its own fail-first`.

   ```bash
   majordomus finish --check
   git push -u origin train/<yyyy-mm-dd>
   gh pr create --base main --title "Merge train <yyyy-mm-dd>: #<a>, #<b>, ..." --body-file <file>
   ```

7. Fold follow-ups in before the review. A late change is opened against the train,
   `gh pr create --base train/<yyyy-mm-dd>`, and merged into it with step 4, then step 5
   again. Its pull request shows merged once its head is in the pushed train.

8. Review. `node scripts/review-verdict.mjs --content --list` lists the guarded paths the
   train changes against main; when it lists any, a session that built none of it writes
   `.ai/repo/reviews/<train-pr>.yaml` (skill `review-a-guarded-pr`). A fold-in after the
   verdict that touches a guarded path makes the verdict stale.

9. Land by a merge commit, so every included head reaches main and its pull request is
   marked merged:

   ```bash
   gh pr merge <train-pr> --auto --merge
   ```

# Output

- `train/<yyyy-mm-dd>` on origin: one `--no-ff` merge commit per included pull request,
  each made through the pre-commit hook, one `build(dist)` rebuild after the last merge.
- One pull request to main with the inclusion table, the conflict resolutions, the
  `npm run verify` result and the fail-first waiver, armed with `--auto --merge`, and its
  review verdict when guarded paths changed.
- The task closed with
  `majordomus finish --outcome completed --verify-command "npm run verify" --note <file>`.
