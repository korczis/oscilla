---
id: project.worktree-topology
version: 1
kind: rule
title: Work happens in its canonical worktree, never through shared refs
description: A feature branch is committed only from its canonical linked worktree, and the stash is never recommended by the repository, because every worktree shares it.
statement: A feature branch is committed only from its canonical worktree, <repository>-wt/<branch>, as checked by majordomus worktree guard in the pre-commit hook; the primary checkout hosts the trunk. The mechanism is documented in docs/WORKTREES.md. The stash is never recommended by a line of a tracked script, source file, workflow, rule or document in the scanned paths (scripts/, src/, docs/, .github/, the root Markdown files, tests/README.md, and the .ai layer's README, rules, workflows, providers and skills), because refs/stash is one ref shared by every linked worktree.
status: active
class: blocking
depends_on: []
tags: [git, worktrees, process]
---

# Rationale

Several sessions work in this repository at once, each in a linked worktree (ADR 0008). They
share one git directory.

- On 2026-10-03 a task was started and a file edited in the primary checkout, which hosts
  the trunk and the owner's uncommitted edits.
- The bootstraps said for days that the pre-commit hook refused a misplaced commit, while
  the policy wired only `doctor` and `finish --check` (completion ledger, finding K1).
- On 2026-10-06 an entry pushed to `refs/stash` from one linked worktree was met by a peer
  session in another (#136): the ref belongs to the clone, not to the worktree.
- `scripts/release-prepare.mjs` answered a dirty tree with advice to use that same ref.

# Required behaviour

- New work starts with `majordomus worktree create <branch>` and continues in the path it
  prints. `majordomus worktree` says where a session is and whether the branch belongs
  there; `majordomus worktree migrate` brings a misplaced worktree home.
- A branch other than the trunk is never committed from the primary checkout or from a
  worktree that is not at its derived path.
- The stash is never used in any checkout of this repository. Work is set aside by copying
  it out of the tree, or by a work-in-progress commit on the branch itself in its canonical
  worktree, undone with `git reset --soft HEAD~1` before it is pushed. A second branch in the
  same worktree is not a way out: the guard refuses a commit on a branch whose canonical
  path is elsewhere.
- The stash is never recommended by a script, message, workflow, rule or document. A line
  that mentions it forbids it, names `refs/stash`, or names the thing as a noun
  (stash advice, a stash entry).

# Enforcement

- `.ai/repo/policy.yaml` declares the `enforcement` entry `worktree-guard`
  (`majordomus worktree guard`, `wired_by: git-hook:pre-commit`). The guard exits 10 with
  the reason for a branch committed anywhere but its canonical worktree.
  `majordomus doctor` 0.13.2 proves the wiring by reading the hook's text: it fails a
  checkout with no hook file, a hook that does not name a declared entry, and an entry
  followed by `|| true`. `npm run verify` and the hook itself run doctor.
- `tests/unit/repo-hygiene.test.mjs`, run by `npm test` in the CI `unit` job, asserts that
  the policy declares that entry exactly (a removed entry, or `wired_by: manual`, fails),
  that `docs/WORKTREES.md` exists and documents the layout, the guard and its limits, and
  that the stash scan finds no line in the scanned paths of the statement. The scan judges
  each mention on its own: a prohibition directly before it in the same clause ("never use
  the ..."), a passive directly after it ("... is never used"), `refs/stash`, or a noun use.
  A negation elsewhere on the line does not excuse it; the mutation test beside the scan
  holds the wordings round 1 of its review got through (a comma or a dash for the
  semicolon, a condition after the command).
- `.github/doctor-verdict.jq` excuses the git-hook entries in CI, where no hook exists;
  `tests/unit/ci-knowledge-job.test.mjs` holds the excused list to the policy's.

# Failure behaviour

The hook refuses the commit and prints where the branch belongs and the remedy. A change
that removes the policy entry, the document, or reintroduces stash advice fails `npm test`.

Not machine-checked, and so not claimed: the guard passes a detached HEAD, so it cannot
refuse work done detached in the primary checkout; it runs at commit time, so it does not
see an edit or a started task that is never committed there; the stash scan reads lines, so
it cannot judge advice spread over two, and it accepts a noun use ("a stash entry") whatever
the sentence around it says. Doctor's wiring proof is a text match, so a hook line that is
commented out, sits in a branch never taken or below an early `exit 0`, or is not followed
by `|| exit $?`, counts as wired; and a clone that never wrote the hook file runs nothing at
commit and is caught by `npm run verify`, not at the commit. ADR bodies and the test files
are outside the scan. `project.shared-machine-discipline` states the session's side of this
as advisory guidance.
