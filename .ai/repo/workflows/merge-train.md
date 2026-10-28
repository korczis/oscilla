# Merge train

Branch protection on `main` requires `gate` on an up-to-date branch (`strict: true`; read it
with `gh api repos/korczis/oscilla/branches/main/protection -q .required_status_checks`).
Every merge into `main` therefore makes every other open pull request out of date, and each
one has to merge `main` and run CI again before it can land. While runners are slow or
stalled, a queue of small pull requests then lands one per CI round, or not at all. A train
lands several of them in one CI run and one merge commit. It was first run as #248
(2026-10-28: four pull requests during a stalled forge).

## When

- Three or more ready pull requests wait behind the up-to-date requirement, and a CI round
  takes long enough that landing them one at a time would take hours; or
- the forge is stalled and pull requests are queuing behind it.

Otherwise ship each pull request on its own (`project.shared-machine-discipline`, item 12).

## Who may join

- A pull request whose own `gate` was green on its last head, or that is green except for
  being out of date.
- No guarded path (`GUARDED` in `scripts/review-verdict.mjs`). A guarded member makes the
  whole train need a reviewer's verdict (`project.review-verdict`), which is the wait the
  train exists to avoid.
- No `feat` or `fix` member: those land as their own pull request, where `project.fail-first`
  judges their tests. The `fail-first` job refuses a train that lists one.
- At most one member that changes `src/` (and so `dist/index.html`): dist is rebuilt once on
  the train, never hand-resolved.

## Steps

Run each step on its own and read its result before the next; never chain a merge with a
commit (`project.shared-machine-discipline`, item 5).

| Step | Command |
| --- | --- |
| Create the branch from `origin/main` | `majordomus worktree create train/<yyyy-mm-dd>`, then work in the path it prints |
| Start the task | `majordomus start "train <date>: #a, #b" --scope <the members' paths>` |
| Fetch each member's head | `git fetch origin pull/<n>/head:member-<n>` |
| Merge each member, without `-X` | `git merge --no-ff member-<n>` |
| After each merge: no unmerged path, no marker | `git diff --name-only --diff-filter=U` prints nothing; `npm test` refuses a committed marker (`project.no-conflict-markers`) |
| Rebuild dist once, after the last member | `npm run build`, commit `dist/` as `chore(build): rebuild dist for the train` |
| Check the train | `npm test`, `npm run build:check`, `majordomus plan validate` |
| Push and open | `git push -u origin train/<date>`, `gh pr create --base main --title "train(<date>): #a, #b ..."` |
| Land by merge commit | `gh pr merge <train> --auto --merge` |

A merge that conflicts stops the train: abort it (`git merge --abort`), drop that member from
the train and land it on its own. A conflict in `dist/index.html` is not resolved by hand;
take either side and rebuild.

Land by merge commit, never squash: the members' commits stay in the history, GitHub marks
each member pull request merged, and a member's plan evidence (if any) stays reachable. Plan
evidence should not be on a member branch at all: the `V272 D4` test refuses, on the pull
request, an evidence commit that is not already on `main`.

## The body

The `fail-first` job reads the train's body. It needs, in the body's own prose (not in a code
block or a quotation), a table with one row per member, its number and its pull request title:

```markdown
| member | what |
|---|---|
| #243 | chore(release): record v1.2.3 |
| #244 | docs(pack): usage comments name the checkout |
```

It refuses a train without the table, with an empty table, with a row that is not `#<n>` or
whose `what` does not start with a conventional type, and with a feat or fix member; a
`fail-first: n/a` line in the train's body does not excuse a member. Below the table, list
what was run on the train (`npm test`, `build:check`, `plan validate`) and any test that had
to be re-run, with the reason.

What the job cannot see: whether each row's title is its member's. The reviewer of the train
checks that (`gh pr view <n> --json title`).

## After landing

Each member pull request shows as merged. Finish the train's task
(`majordomus finish --outcome completed --verify-command "npm test" --note <file>`), then
remove the train worktree and the members' worktrees that are landed and clean.
