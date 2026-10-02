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
