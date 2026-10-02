---
schema: knowledge/v1
id: majordomus-0-10-0-quirks
kind: knowledge
class: observation
title: Majordomus 0.10.0 behaviours that shape how this repository is worked
description: Missing worktree command, branch-bound finish check, linked-worktree hooks path, and plan evidence flow.
status: verified
epistemics: observed
date: 2026-10-02
tags:
  - majordomus
  - git
  - workflow
provenance:
  origin: authored
---

# Majordomus 0.10.0 behaviours that shape how this repository is worked

- `majordomus worktree` does not exist in 0.10.0, though the bootstrap text names it.
  Worktrees are made by convention at `<repository>-wt/<branch>` (V2), or by agent isolation
  under `.claude/worktrees/` (ignored).
- The pre-push hook runs `majordomus finish --check`. It fails with "recorded on branch
  'main', now on '<branch>'" when the active task was started on `main`, so feature branches
  are pushed from the `main` checkout (`git push -u origin <branch>`).
- Doctor checks `$MJ_ROOT/.git/hooks`, which does not exist in a linked worktree where
  `.git` is a file. Setting `core.hooksPath` to the primary checkout's `.git/hooks` keeps the
  hooks running and doctor passing there.
- A new branch with no checkpoint or handover fails doctor's lifecycle checks on commit.
  Run `majordomus checkpoint --derive` and `majordomus handover` on that branch first.
- The `majordomus decision` log is append-only. A wrong number in an entry is corrected by a
  new entry with `--supersedes`, never by editing.
- Plan status is derived only from evidence: `majordomus plan evidence <id> --covers verified
  --type test --command ... --result ... --artifact <commit>`, then `majordomus plan done <id>`.
