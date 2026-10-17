---
schema: skill/v1
id: fail-first-change
version: 1
title: Make a feat or fix change fail-first
description: Land a feat or fix pull request whose unit test is committed first and fails on the merge base, proven locally with scripts/fail-first.mjs, or waived with a reasoned fail-first n/a line (rule fail-first).
status: draft
tags: [testing, ci, process]
related: [add-a-browser-check, review-a-guarded-pr]
inputs:
  - a behaviour to add or a defect to fix, in a worktree of its own branch
outputs:
  - a test commit that fails without the change, then the change that makes it pass
  - a pull request body naming the fail-first commit, or carrying the waiver line
---

# Purpose

Makes the evidence of a `feat`/`fix` pull request a run, not a claim (rule
`project.fail-first`): CI runs the base branch's `scripts/fail-first.mjs` on the unit tests
the pull request adds or changes, against its merge base. Other title types prove nothing
and need nothing.

# Procedure

1. Write the unit test first, under `tests/unit/` as `<name>.test.mjs`, exercising the path
   that changes (not a helper beside it). A new test file gets its row in the table of
   `tests/README.md`.

2. See it fail on the unchanged tree, for the reason the change addresses:

   ```bash
   node --test tests/unit/<name>.test.mjs
   ```

   A failure of the harness (a missing fixture, a test that needs `git log`, which the
   extracts do not have) is not evidence; fix the test until the failure is the behaviour.

3. Commit the test alone, then the change:

   ```bash
   git add tests/unit/<name>.test.mjs tests/README.md
   git commit -m "test(<scope>): <the behaviour> (fail-first)"
   git add <changed paths>
   git commit -m "fix(<scope>): <the behaviour>"
   ```

   A change under `src/` also commits the rebuilt `dist/index.html` (`npm run build`).

4. Prove it as CI will, against the branch the pull request targets:

   ```bash
   node scripts/fail-first.mjs --title "fix(<scope>): <the behaviour>" --base-branch origin/<base>
   npm run verify
   ```

   It prints each test file as evidence or not, with the kind of failure on the base
   (`assertion`, `module-not-found`, ...). Exit 1 means no file is evidence.

5. Open the pull request and name the test commit in its body:

   ```bash
   majordomus finish --check
   git push -u origin <branch>
   gh pr create --base <base> --title "fix(<scope>): <the behaviour>" --body-file <file>
   ```

6. When no unit test can show it (only a browser suite observes it, or it is documentation
   under a `fix` title), the body carries, on a line of its own and outside code blocks,
   quotes and comments: `fail-first: n/a <the real reason>`. The reviewer judges the reason.

7. After editing the title or the body, run the job again: an edit does not trigger it.

   ```bash
   gh run list --branch <branch> --workflow ci.yml --limit 1 --json databaseId
   gh run rerun <run-id>
   ```

# Output

- On the branch: the `test(...)` commit that fails without the change, then the
  `feat`/`fix` commit that passes it.
- `node scripts/fail-first.mjs` reporting at least one file as evidence, or the waiver line
  with its reason in the pull request body.
- The pull request body naming the fail-first commit.
