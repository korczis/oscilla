---
id: project.shared-machine-discipline
version: 1
kind: rule
title: Session discipline on a shared machine and a shared repository
description: How a session behaves where other sessions share the machine, the clone, the remote and the owner's attention; guidance a session follows, which no test in the repository can observe.
statement: A session on the shared machine kills only processes it started and by their recorded PID, never uses the stash, never chains a merge with a commit, never works in the primary checkout, chains state-changing steps so a failure stops them, closes its Majordomus task truthfully, clears an environmental failure only by re-running the whole gate, runs heavy suites one at a time, checks peers before writing, never force-pushes, ships through small gated pull requests, lands dist-changing pull requests one at a time, leaves owner-only actions to the owner, and reports visual-reference changes instead of accepting them.
status: active
class: advisory
depends_on: [project.worktree-topology@1, project.no-conflict-markers@1]
tags: [process, sessions, shared-machine]
---

# Rationale

OSCILLA is built by several AI sessions at once on one Mac, in one clone with many linked
worktrees, against one remote, for one owner. Each item below is here because its opposite
happened in this repository and cost other sessions work: browsers killed by a name pattern
under a peer's gate, a stash entry met in another worktree (#136), conflict markers
committed by a chained merge (#99), a task started in the primary checkout, a worktree
removed before its task was closed, a release receipt made stale by a merge between prepare
and publish.

# Required behaviour

Processes and load

1. Never kill processes by name pattern on the shared Mac: no `pkill`, `pkill -f`, `killall`
   or `kill $(pgrep ...)`. Start a long run in the background through the harness and stop
   it with the harness's stop or the PID recorded at start. If a pattern kill happened, tell
   the coordinator, so that peers re-run what it failed. Every brief that runs browsers or
   builds carries this line.
2. Run heavy browser suites and gates one at a time, under `nice`, and only while the
   machine's load is below the threshold the brief gives. (A load gate in the browser-suite
   harness is planned as its own rule; until it lands this is the only statement of it.)
3. An environmental failure (network flap, ENOSPC, load, runner outage, killed browsers) is
   cleared only by re-running the whole gate after the environment has recovered, never the
   one failing test. Triage and pull-request verification tables keep three columns apart:
   "re-run and passed", "explained but not re-run" and "not run", each with the head SHA
   and the load at the time.

Git

4. Never use `git stash` in any checkout of a repository that has linked worktrees:
   `refs/stash` is shared. Set work aside by copying files to a scratch directory or by
   committing on a throwaway branch. (What the repository itself may say about the stash is
   enforced by `project.worktree-topology`.)
5. Never put a `git merge`, `rebase` or `pull` in the same command as `git add` or
   `git commit`. After a merge, check `git diff --name-only --diff-filter=U` and search for
   markers before staging. When the branch already contains main's squashed content, use
   `git merge -X ours origin/main` and rebuild dist; never hand-resolve `dist/index.html`.
   (A committed marker is caught by `project.no-conflict-markers`.)
6. Never edit, start a task, check out a branch or detach HEAD in the primary checkout: it
   hosts the trunk and the owner's uncommitted edits. Start work with `majordomus worktree
   create <branch>`, and publish a release from a fresh clone of main. (The pre-commit guard
   of `project.worktree-topology` refuses a branch committed there; it passes a detached
   HEAD and never sees an uncommitted edit.)
7. Never force-push, `--force-with-lease` included. Check the remote head with
   `git ls-remote` and push plainly.
8. Chain state-changing steps with `&&` or under `set -e`, never with `;`. A lock
   acquisition blocks (`until mkdir LOCK; do sleep 20; done`) or aborts; it never falls
   through.

Majordomus

9. Run `majordomus finish` alone and read `finish: <id> completed` before removing a
   worktree. A completed outcome passes `--verify-command` and `--note <a real file>`,
   never `/dev/stdin`. Report a refused finish as it is and leave the task open.
10. Start or re-anchor a task only after rebasing or fast-forwarding. When a needed file is
    outside the claimed scope, close the task as partial with the reason and start a new
    one; never widen a scope silently.
11. Before writing, check peers (the session list, the Majordomus peer board,
    `majordomus check --overlap`) and announce the intent and the paths.

Shipping

12. Ship through small pull requests with `gh pr merge --auto --squash`, gated on `gate`;
    open long work as an early draft. Read release and deploy state from GitHub
    (`gh release list`, `npm run release:verify-deploy`), never from memory.
13. Land dist-changing pull requests one at a time, each merged up to date with main and
    rebuilt. Do not arm auto-merge on a pull request that changes build inputs between
    `release:prepare` and `release:publish`: the receipt the gate wrote would describe a
    tree that is no longer HEAD.
14. Owner-only actions are listed for the owner and never routed around, and "proceed
    autonomously" is not approval for them: accepting an ADR, the machine-wide Majordomus
    launcher flip, `gh release upload` or an asset backfill, raising the size budget or
    replacing p5, changing GitHub repository or branch-protection settings, and anything
    the permission system blocked.
15. A worker session reports a visual-reference change; it does not accept one. A reference
    is re-accepted on macOS and in the Linux CI container together, after review.

# Why advisory

Every item is about what a session does between commits: which processes it signals, which
git commands it types and in what order, what it reads before it writes, whom it asks. None
of that leaves a trace in the tracked tree, so no test in this repository can decide it, and
a test that pretended to would be the false claim `project.rules-name-their-enforcement`
exists to refuse. Where a consequence does reach the tree or a commit, another rule catches
it and is named beside the item: a committed marker (`project.no-conflict-markers`), a
branch committed outside its worktree and stash advice in the repository
(`project.worktree-topology`), a local Majordomus that differs from the pin
(`project.majordomus-layer-current`). The rest is enforced by the reviewer of the pull
request and by the coordinator of the sessions, and a violation is reported, not hidden.

# Failure behaviour

A violation is reported to the coordinator and in the pull request, with what it may have
broken for peers (a killed browser fails a peer's gate; a pattern kill, a stash or a forced
push is said out loud so the affected work is re-run). It is not grounds to rewrite history.
