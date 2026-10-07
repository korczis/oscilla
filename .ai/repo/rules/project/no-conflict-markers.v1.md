---
id: project.no-conflict-markers
version: 1
kind: rule
title: No tracked file contains git conflict markers
description: A leftover conflict marker never reaches a commit; the pre-commit hook refuses staged ones and a unit test refuses tracked ones.
statement: No tracked text file contains a line that is a git conflict marker (seven "<" or ">" followed by a space or the end of the line, or seven "=" alone on a line) outside an allowlist whose entries carry reasons, and the pre-commit hook refuses a commit whose staged changes contain one.
status: active
class: blocking
depends_on: []
tags: [git, process, hygiene]
---

# Rationale

On 2026-10-04, on the runtime-inspector branch (#99), one command line ran
`git merge origin/main`, took one side of `dist/index.html`, rebuilt, staged everything and
committed. The merge had conflicted in six other files; the chain went on regardless and
committed them with their markers. Git refuses to commit an unmerged path, and a path stops
being unmerged the moment it is staged, markers included. Nothing named the cause: 24
unrelated unit tests failed on files that no longer parsed.

# Required behaviour

- A merge, rebase or pull is never in the same command as `git add` or `git commit`. After
  one, `git diff --name-only --diff-filter=U` is empty and the files are free of markers
  before anything is staged.
- `dist/index.html` is never resolved by hand: resolve `src/`, then `npm run build`.
- A line that only looks like a marker (a test fixture, a quoted diff) is listed in
  `tests/unit/fixtures/conflict-marker-allowlist.json` with its file, its exact text and the
  reason. An entry whose line is gone is removed.
- The pre-commit hook is never bypassed.

# Enforcement

- `tests/unit/repo-hygiene.test.mjs` ("no tracked file contains a git conflict marker") runs
  `git grep` over the tracked text files and fails with each file and line. It runs in
  `npm test`, so in `npm run verify` and the CI `unit` job. `dist/index.html` is not
  scanned: `npm run build:check` compares it byte for byte with a rebuild, and a rebuild
  from marker-free sources has none. The same file tests the allowlist (every entry has a
  reason and is still needed) and proves the scan on a throwaway repository with a committed
  marker.
- `.ai/repo/policy.yaml` declares the `enforcement` entry `diff-check-on-commit`
  (`git diff --cached --check`, `wired_by: git-hook:pre-commit`). `majordomus doctor` fails a
  developer checkout whose pre-commit hook does not run it, and the same test asserts the
  policy entry exists. The hook check also refuses whitespace errors in staged lines, which
  is git's definition of `--check` and not a requirement of this rule.

# Failure behaviour

The hook exits non-zero and names `file:line: leftover conflict marker`; the commit does not
exist. A marker that reached a branch another way fails `npm test` and so the pull request.

Not machine-checked: a marker inside `dist/index.html` taken from one side of a merge and
committed without a rebuild is caught as a `build:check` mismatch, not as a marker; and the
hook exists only in a developer checkout, so a commit made by a tool that skips hooks is
caught by the unit test alone.
