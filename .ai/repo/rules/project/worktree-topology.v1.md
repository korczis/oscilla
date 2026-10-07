---
id: project.worktree-topology
version: 1
kind: rule
title: Work happens in its canonical worktree, never through shared refs
description: A feature branch is committed only from its canonical linked worktree, and nothing in the repository recommends the stash, which every worktree shares.
statement: A feature branch is committed only from its canonical worktree, <repository>-wt/<branch>, as checked by majordomus worktree guard in the pre-commit hook; the primary checkout hosts the trunk. The mechanism is documented in docs/WORKTREES.md. No tracked script, message or document recommends git stash, because refs/stash is one ref shared by every linked worktree.
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
- On 2026-10-06 a `git stash` in one linked worktree met an entry a peer session had pushed
  from another (#136): `refs/stash` belongs to the clone, not to the worktree.
- `scripts/release-prepare.mjs` told the user of a dirty tree to "commit or stash first".

# Required behaviour

- New work starts with `majordomus worktree create <branch>` and continues in the path it
  prints. `majordomus worktree` says where a session is and whether the branch belongs
  there; `majordomus worktree migrate` brings a misplaced worktree home.
- A branch other than the trunk is never committed from the primary checkout or from a
  worktree that is not at its derived path.
- The stash is never used in any checkout of this repository. Work is set aside by copying
  it out of the tree or by committing it on a throwaway branch.
- No script, message, workflow or document recommends the stash. A line that mentions it
  forbids it or names `refs/stash`.

# Enforcement

- `.ai/repo/policy.yaml` declares the `enforcement` entry `worktree-guard`
  (`majordomus worktree guard`, `wired_by: git-hook:pre-commit`). The guard exits 10 with
  the reason for a branch committed anywhere but its canonical worktree. `majordomus doctor`
  fails a developer checkout whose hook does not run a declared entry or swallows its exit
  code, and `npm run verify` and the hook itself run doctor.
- `tests/unit/repo-hygiene.test.mjs`, run by `npm test` in the CI `unit` job, asserts that
  the policy declares that entry exactly (a removed entry, or `wired_by: manual`, fails),
  that `docs/WORKTREES.md` exists and documents the layout, the guard and its limits, and
  that no tracked file under `scripts/`, `src/`, `docs/`, `.github/` or a root Markdown file
  mentions the stash on a line that does not forbid it.
- `.github/doctor-verdict.jq` excuses the git-hook entries in CI, where no hook exists;
  `tests/unit/ci-knowledge-job.test.mjs` holds the excused list to the policy's.

# Failure behaviour

The hook refuses the commit and prints where the branch belongs and the remedy. A change
that removes the policy entry, the document, or reintroduces stash advice fails `npm test`.

Not machine-checked, and so not claimed: the guard passes a detached HEAD, so it cannot
refuse work done detached in the primary checkout; it runs at commit time, so it does not
see an edit or a started task that is never committed there; and the stash scan reads lines,
so it cannot judge advice spread over two. `project.shared-machine-discipline` states those
as advisory guidance.
