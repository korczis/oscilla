---
schema: adr/v1
id: adr-0008
kind: adr
title: Parallel fix agents work in isolated worktrees and are merged by three-way patch
status: proposed
date: 2026-10-02
tags:
  - process
  - git
provenance:
  origin: authored
---

# 8. Parallel fix agents work in isolated worktrees and are merged by three-way patch

## Context

The whole application is one file, so parallel agents editing `index.html` in one checkout
collide. Majordomus 0.10.0 has no `worktree` command.

## Decision

- Each fix agent runs in its own git worktree (Claude Code agent isolation, under
  `.claude/worktrees/`, ignored by git) and owns named regions of `index.html`.
- Agents do not commit. The lead exports `git diff <base>` from the worktree and applies it
  to the trunk with `git apply --3way`, runs every suite in three browsers, then commits.
- Agents rebase their uncommitted diff onto the current trunk before reporting, and resolve
  their own conflicts.
- The main checkout's working files are never stashed or reset while an agent may be editing
  them.

## Consequences

- Merges were mechanical except for one hunk (`toggleMic`), which the owning agent resolved.
- A `git stash` in the main checkout once reverted an agent's in-progress test file. It was
  recovered from the stash commit, and the last rule above exists because of it.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: superseded in practice

None of this decision describes how work is done any more; it is kept as the record of V1.
What replaced it, by practice and by ADR 0009 rather than by a superseding ADR:

- Each piece of work has its own branch and a linked worktree at `<repository>-wt/<branch>`
  (the primary checkout's `-wt` sibling), made with `git worktree add`, not under
  `.claude/worktrees/`.
- Agents commit on their own branch, push it, and open a small pull request; it lands by
  `gh pr merge --auto --squash` once the required `gate` job passes (ADR 0009). Nothing is
  merged by exporting a diff and `git apply --3way`.
- The application is modular source (ADR 0011), so parallel work rarely meets in one file;
  `dist/index.html` is rebuilt rather than merged.
- Each worktree runs its own Majordomus task (`majordomus start`, `check`, `finish`) against
  its own scope.

The status stays `proposed`; whether to mark it `superseded` is the owner's call.
