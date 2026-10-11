---
id: project.no-conflict-markers
version: 1
kind: rule
title: No tracked file contains git conflict markers
description: A leftover conflict marker never reaches a commit; the pre-commit hook refuses staged ones and a unit test refuses tracked ones.
statement: No tracked text file contains a line that is a git conflict marker (seven "<", ">" or "|" followed by a space or the end of the line, or seven "=" alone on a line) outside an allowlist whose entries carry reasons, and the pre-commit hook refuses a commit whose staged changes contain one.
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
  reason, and its path sets `conflict-marker-size=<n>` (not 7) in `.gitattributes`: the hook
  has no allowlist, and git judges that path by the size it is given. An entry whose line is
  gone is removed.
- The pre-commit hook is never bypassed.

# Enforcement

- `tests/unit/repo-hygiene.test.mjs` ("no tracked file contains a git conflict marker") runs
  `git grep` over the tracked text files and fails with each file and line, a CRLF file
  and the diff3 base marker included, under the rule's id. It runs in
  `npm test`, so in `npm run verify` and the CI `unit` job. `dist/index.html` is not
  scanned: `npm run build:check` compares it byte for byte with a rebuild, and a rebuild
  from marker-free sources has none. The same file tests the allowlist (every entry has a
  reason and is still needed) and proves the scan on a throwaway repository with a committed
  marker.
- `.ai/repo/policy.yaml` declares the `enforcement` entry `diff-check-on-commit`
  (`git diff --cached --check`, `wired_by: git-hook:pre-commit`), and the same test asserts
  the policy entry exists. `majordomus doctor` 0.13.2 fails a developer checkout with no hook
  file, a hook that does not name the entry, and an entry followed by `|| true`.
- `.gitattributes` sets `-whitespace` on every path, so that check reports leftover conflict
  markers and nothing else. Without it the hook refused a correctly resolved merge: the
  staged diff of a merge commit holds every line the other side added, a trailing space or a
  blank line at the end of a file among them. The same test asserts the attribute, that an
  allowlisted path sets its marker size, and proves both on a throwaway repository (the
  other side's whitespace passes, a marker beside it is refused, a seven-character setext
  underline is refused until its path sets `conflict-marker-size`).

# Failure behaviour

The hook exits non-zero and names `file:line: leftover conflict marker`; the commit does not
exist. A marker that reached a branch another way fails `npm test` and so the pull request.

Not machine-checked: a marker inside `dist/index.html` taken from one side of a merge and
committed without a rebuild is caught as a `build:check` mismatch, not as a marker; and the
hook exists only in a developer checkout, so a commit made by a tool that skips hooks is
caught by the unit test alone. Doctor's wiring proof is a text match: a hook line that is
commented out, sits in a branch never taken or below an early `exit 0`, or is not followed
by `|| exit $?`, counts as wired, and a clone that never wrote the hook file runs nothing at
commit (`npm run verify` fails there, the commit does not).
