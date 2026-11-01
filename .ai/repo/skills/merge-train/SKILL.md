---
schema: skill/v1
id: merge-train
version: 3
title: Build and land a merge train
description: Land several ready non-feat/fix pull requests together through one train/<date> integration branch, one dist rebuild and one merge commit (ADR 0055).
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

This skill is the one procedure for a train; `project.fail-first` judges what it lands.

# When to use

- Several pull requests are ready at once and each one that changes `src/` would conflict on
  `dist/index.html` after the first lands; or
- runners are slow or stalled and several pull requests wait for a CI round each. Branch
  protection on `main` no longer requires an up-to-date branch (`strict: false` since the
  owner's decision of 2026-10-30; read it with
  `gh api repos/korczis/oscilla/branches/main/protection -q .required_status_checks`), so a
  green pull request merges without merging `main` again; under `strict: true` every merge
  made every other one rerun CI (#248, 2026-10-28). A train still gives its members one run
  on their combination, which separate merges no longer get (ADR 0009, note of 2026-10-30).

# Who may join

- A pull request whose own `gate` was green on its last head, or that is green except for
  being out of date.
- **No `feat` or `fix` member.** Each lands as its own pull request, where `project.fail-first`
  runs its tests against the merge base. The train's `fail-first: n/a` once let an unproven
  `feat` through; the `fail-first` job now refuses a train whose member table lists one, and
  a waiver in the train's body does not excuse a member.
- A member that changes a guarded path (`GUARDED` in `scripts/review-verdict.mjs`) rides only
  when the train gets its own reviewer-written verdict (step 10). If that wait is what the
  train is avoiding, land the member on its own instead.
- A member whose own verdict (`.ai/repo/reviews/<n>.yaml`) is not `merge` rides only when the
  train's reviewer judges its content by name (step 3). #303 rode #367 at `changes` with an
  open P1; the `review-verdict` job now refuses that.
- No two members that change the same behaviour differently (step 2).
- No plan evidence recorded on a member branch: the `V272 D4` test of
  `tests/unit/plan-evidence-commits.test.mjs` refuses, on the pull request, an evidence commit
  that is not on `main` (`project.shared-machine-discipline`, item 12).

# Procedure

1. List the candidates and their state; keep only green, mergeable, non-feat/fix ones, and
   check no release is in flight (rule `project.release-flow-complete`: nothing else merges
   between prepare and publish):

   ```bash
   gh pr list --state open --json number,title,headRefName,mergeable,statusCheckRollup
   gh pr list --state open --search "chore(release) in:title" --json number,title
   ```

2. Before building, list each member's plan issue and the behaviour it changes; flag pairs
   that change the same behaviour (two envelope-edit policies, two owner tables) and leave one
   of each pair out, to be reconciled separately. In #367, C007 against C008 and C002 against
   C016 each set one behaviour two ways; the second of each had to be aborted mid-build, and
   the contradiction blocked a parallel train.

   ```bash
   gh pr view <n> --json title,body -q '.title, .body' | grep -E '^plan:|serves'
   gh pr diff <n> --name-only
   ```

   Two members touching one module is not yet a conflict; two that each say how one thing
   behaves (who owns the output, what an edit during playback does) are, even when git merges
   them cleanly.

3. Check every member's verdict is `merge`, or have the train reviewer judge it explicitly.
   For each member with a verdict file:

   ```bash
   git show origin/<branch>:.ai/repo/reviews/<n>.yaml | grep -E '^(verdict|content):'
   ```

   A member on `changes` (or with an open P0 or P1) leaves the train, or the train's reviewer
   judges its content in the train and records it in the train's verdict (step 10):

   ```yaml
   members:
     - { pr: 303, verdict: merge, reason: "R-1 and R-2 fixed in the train at 3a840b66" }
   ```

   The `review-verdict` job reads the member table, each member's verdict at the train head
   and this block, and refuses the train otherwise (rule `project.review-verdict`).

4. Create the train in its own worktree and start the task there
   ([task lifecycle](../../workflows/task-lifecycle.md)). The branch must be `train/...`:
   the `fail-first` job recognises a train by it, as well as by its title.

   ```bash
   majordomus worktree create train/<yyyy-mm-dd>
   cd "$(majordomus worktree path train/<yyyy-mm-dd>)"
   npm ci
   majordomus start "Merge train <yyyy-mm-dd>" --scope <every path the included PRs touch>
   ```

   `gh pr diff <n> --name-only` lists a pull request's paths.

5. Choose the order. A tooling migration (a Majordomus layer or pin change) goes first,
   because with the new tool installed every later commit on the old layer fails the hook.

6. Merge each branch, one command at a time, so the pre-commit hook judges every merge
   commit (a clean `git merge` would commit without it):

   ```bash
   git fetch origin
   git merge --no-ff --no-commit origin/<branch>
   git diff --name-only --diff-filter=U          # the unmerged paths
   ```

   - `dist/index.html` unmerged: take either side, `git checkout --theirs dist/index.html`,
     then `git add dist/index.html`. It is rebuilt once at the end.
   - Any other unmerged path: resolve it by hand, then `git add <path>`, or stop: abort with
     `git merge --abort`, drop that member and land it on its own.
   - Before committing, no path is unmerged and no marker is left (rule
     `project.no-conflict-markers`; the test applies the allowlist of look-alike lines):

     ```bash
     git diff --name-only --diff-filter=U          # empty
     node --test tests/unit/repo-hygiene.test.mjs
     git commit --no-edit
     ```

   Never put the merge and the commit in one command line.

7. After the last merge, rebuild once, commit, and verify the train head:

   ```bash
   npm run build
   git add dist/index.html
   git commit -m "build(dist): rebuild for the train"
   npm run verify
   ```

   A unit test an included pull request added needs its `tests/README.md` row; the
   inventory check of `tests/unit/knowledge-integrity.test.mjs` names a missing one.

8. Push and open the pull request to main. The body carries, in its own prose (not in a code
   block or a quotation), a member table with one row per included pull request, its number
   and its pull request title as `gh pr view <n> --json title` prints it; below it, the
   conflicts and how each was resolved and the verification:

   ```markdown
   | member | what |
   |---|---|
   | #243 | chore(release): record v1.2.3 |
   | #244 | docs(pack): usage comments name the checkout |
   ```

   The `fail-first` job refuses a train without the table, with an empty one, with a row
   that is not `#<n>` or whose title does not start with a conventional type, and with a
   `feat` or `fix` row. Every `| member | what |` table in the body is read; a `|` inside a
   title is written `\|`.

   ```bash
   majordomus finish --check
   git push -u origin train/<yyyy-mm-dd>
   gh pr create --base main --title "Merge train <yyyy-mm-dd>: #<a>, #<b>, ..." --body-file <file>
   ```

9. Fold follow-ups in before the review. A late change is opened against the train,
   `gh pr create --base train/<yyyy-mm-dd>`, and merged into it with step 6, then step 7
   again, and gets its row in the member table; its own verdict is checked as in step 3. Its
   pull request shows merged once its head is in the pushed train.

10. Review. `node scripts/review-verdict.mjs --content --list` lists the guarded paths the
    train changes against main; when it lists any, or a member's own verdict is not `merge`,
    a session that built none of it writes `.ai/repo/reviews/<train-pr>.yaml` (skill
    `review-a-guarded-pr`), with the `members` block of step 3 for each member it judges. A
    fold-in after the verdict that touches a guarded path makes the verdict stale. The
    reviewer also checks that each member row's title is its member's and that every merged
    member is listed, which neither job can see. Check the whole train as CI will:

    ```bash
    gh pr view <train-pr> --json title,body,headRefName > pr.json
    node scripts/review-verdict.mjs --pr <train-pr> --pr-json pr.json
    ```

11. Land by a merge commit, never squash, so every included head reaches main, its pull
    request is marked merged and its commits stay in the history:

    ```bash
    gh pr merge <train-pr> --auto --merge
    ```

# Output

- `train/<yyyy-mm-dd>` on origin: one `--no-ff` merge commit per included pull request,
  each made through the pre-commit hook, one `build(dist)` rebuild after the last merge.
- One pull request to main with the member table (no `feat` or `fix` member, no two members
  setting one behaviour two ways), the conflict resolutions and the `npm run verify` result,
  armed with `--auto --merge`, and its review verdict when guarded paths changed or a
  member's own verdict is not `merge`.
- The task closed with
  `majordomus finish --outcome completed --verify-command "npm run verify" --note <file>`.
