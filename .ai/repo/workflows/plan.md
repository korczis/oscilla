# Taking work from the plan

Non-trivial work belongs to a milestone and to one issue with a place in a dependency
graph. Status is derived from what an issue records and from the state of its
dependencies; there is no status field to set, and writing one is an unknown key.

| When | Run |
|---|---|
| starting a session | `majordomus plan next` — the one issue that is ready |
| before you begin | `majordomus plan show <id>` — objective, scope, acceptance, evidence |
| you begin it | `majordomus plan start <id>` — refused unless it is READY |
| you have proof | `majordomus plan evidence <id> --covers <token> --type test --command "<cmd>" --result "<what it showed>"` |
| it is finished | `majordomus plan done <id>` — refused while a required token is uncovered |

Take something else only when it is a blocker, when it invalidates an assumption the
milestone rests on, or when a person reprioritised. Not because it looked more useful.
Trivial exceptions are a typo, a broken link, or a fix forced from outside the repository.

A repository with no `project/` section populated has no plan, and `plan` says so.

## Evidence names a commit of main

`majordomus plan evidence` writes the current HEAD into the entry's `commit:` (it has no
option to name another commit). On a pull request the `V272 D4` test of
`tests/unit/plan-evidence-commits.test.mjs` refuses every evidence commit that is not
already on `main`, whatever the merge method, because a branch commit is lost to every clone
once the branch is squashed or deleted (#238). So evidence is not recorded on the branch that
does the work: it is recorded after that branch lands, in a follow-up `chore(plan)` pull
request, and every entry is recorded **before that branch's first commit**, while HEAD is
still a commit of `main`:

```bash
majordomus worktree create chore/plan-<id>
cd "$(majordomus worktree path chore/plan-<id>)"
git fetch origin
git merge-base --is-ancestor HEAD origin/main && git log -1 --format='%H %s'
majordomus plan evidence <id> --covers <token> --type test --command "<cmd>" --result "<...>"
majordomus plan done <id>
git add .ai/repo/project
git commit -m "chore(plan): <id> done (landed as #<n>)"
git push -u origin chore/plan-<id>
gh pr create --base main --title "chore(plan): <id> done (landed as #<n>)" --body-file <file>
```

The `git merge-base` line must print the landing commit of the work (or a later commit of
`main`); if it prints nothing, HEAD is not on `main` and the entry would be refused. An entry
needed after the branch's first commit goes in a new branch from `origin/main`, not on top
of this one: its HEAD would be the branch commit. A pull request that already carries an entry
at one of its own commits removes that entry from its plan file and records it this way after
it lands.
