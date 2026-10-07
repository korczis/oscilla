# Worktrees

How several sessions work in this repository at once without writing into each other's
files. The rule is `project.worktree-topology`
(`.ai/repo/rules/project/worktree-topology.v1.md`); this document is the mechanism.

## Layout

```text
<parent>/oscilla/                 the primary checkout: hosts the trunk (main), nothing else
<parent>/oscilla-wt/<branch>/     one linked worktree per branch, the branch hierarchy kept
```

`<parent>/oscilla-wt/feat/findings` holds `feat/findings`. The path is derived from the
branch name by `majordomus worktree path <branch>`; it is never chosen and never registered
anywhere. A worktree at its derived path is *canonical*.

Every linked worktree shares one git directory with the primary checkout: one object store,
one set of branches, one `hooks/` directory, and one `refs/stash`. That sharing is why the
rule exists.

## Commands

| Step | Command |
| --- | --- |
| Where am I, and is it where this branch belongs? | `majordomus worktree` |
| Start a branch | `majordomus worktree create <branch>`, then work in the path it prints |
| Bring a misplaced worktree home, dirty state included | `majordomus worktree migrate` (`--plan` shows the steps) |
| Every worktree and its standing | `majordomus worktree list` |
| Remove a merged, clean worktree | `majordomus worktree remove <branch>` |

Run `majordomus finish` and read `finish: <id> completed` before removing a worktree: the
task record lives in the worktree's `.ai/local/`, and removing it first loses the record.

## The guard

`.ai/repo/policy.yaml` declares, under `enforcement`:

```yaml
- name: worktree-guard
  path: majordomus
  args: [worktree, guard]
  wired_by: git-hook:pre-commit
```

`majordomus worktree guard` answers one question, "may a commit be made from here?":

| Where the commit is made | Answer |
| --- | --- |
| A canonical worktree, on its branch | exit 0 |
| The primary checkout, on the trunk | exit 0 |
| Any checkout with a detached HEAD | exit 0 |
| A branch other than the trunk in the primary checkout | exit 10, with the reason |
| A branch in a worktree that is not at its derived path | exit 10, with the reason and the remedy |

The pre-commit hook runs it first and stops on a non-zero exit:

```sh
majordomus worktree guard --quiet || exit $?
git diff --cached --check || exit $?
majordomus doctor || exit $?
```

Git hooks are not tracked, so each clone writes these lines once into the hook file that
`git rev-parse --git-path hooks/pre-commit` names (every worktree of the clone then has
them). `majordomus doctor` reads the policy and fails a checkout whose hook does not run a
declared entry, or runs it with its exit code swallowed; `npm run verify` and the hook itself
run doctor, so a clone cannot commit with the guard unwired. The CI runner has no hooks: the
verdict in `.github/doctor-verdict.jq` excuses exactly the git-hook entries of the policy, and
`tests/unit/repo-hygiene.test.mjs` proves in CI that the policy still declares the guard.

## What the guard cannot see

- **A detached HEAD passes.** The guard cannot tell a deliberate release check from a
  session that detached the primary checkout and went on working. Detaching, checking out a
  branch, editing or starting a task in the primary checkout is forbidden by
  `project.shared-machine-discipline`, which is advisory: nothing refuses it.
- **Uncommitted edits.** The guard runs when a commit is made. An edit made in the wrong
  checkout and never committed there is seen by nothing; `majordomus worktree` before the
  first edit is the check.
- **A session's scratch checkout.** A worktree a provider created elsewhere (for example
  under `.claude/worktrees/`) is refused when it holds a branch; the refusal prints the
  remedy (`majordomus worktree migrate --include-ephemeral --only <branch>`).

## Setting work aside

`refs/stash` is one ref for the whole clone. An entry pushed from one worktree is on top of
the list in every other, and a `pop` there applies a peer's work to the wrong tree (it
happened on 2026-10-06, #136). The stash is therefore never used in this repository, in any
checkout. Set work aside in one of two ways:

- copy the files out of the tree (a scratch directory outside the repository), or
- commit them on a throwaway branch in the same worktree.

No tracked script, message or document may recommend the stash; the scan in
`tests/unit/repo-hygiene.test.mjs` refuses a line under `scripts/`, `src/`, `docs/`,
`.github/` or a root Markdown file that mentions it without forbidding it.
