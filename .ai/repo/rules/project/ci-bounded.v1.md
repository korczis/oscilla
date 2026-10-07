---
id: project.ci-bounded
version: 1
kind: rule
title: Every CI job and network step is bounded, pinned and retried
description: Every workflow job and every step that installs, downloads or runs a browser suite has its own time limit; installs go through one bounded wrapper, downloads retry, are digest-checked and are never executed, nothing is made non-fatal, gate needs every job, and ci.yml starts on a pull request only.
statement: Every job in .github/workflows/*.yml declares timeout-minutes, and so does every step that installs through .github/scripts/ci-install.sh, runs curl, wget or gh, or runs a browser suite; browser and apt installs go only through .github/scripts/ci-install.sh; every curl carries --retry and --connect-timeout (wget --tries and --connect-timeout); every download whose output is not discarded to /dev/null is checked with sha256sum -c against a digest pinned in the workflow, and none is piped into an interpreter, substituted into a command or fetched in a step that uses eval; every action is pinned to a version tag or commit and every container image to a tag; no job or step sets continue-on-error and no install, download or browser suite is followed by `|| true`; the gate job's needs list every other job of ci.yml; and a workflow with a gate job is started by pull_request only.
status: active
class: blocking
depends_on: []
tags: [ci, process, reliability]
---

# Rationale

Each clause is a failure that happened.

- #153: a WebKit `playwright install --with-deps` took 827 s (apt at 158 kB/s), the job's
  15 minutes ran out 75 s into a healthy engine suite, and the run read as a product hang in
  the check that had just started. A limit on the job alone cannot say which step used it up.
- #152: the Firefox job died at its 15-minute limit after 12 minutes of apt.
- #145: an install hang held a docs-only pull request.
- #120: the Majordomus release download had no retry, so one transient asset error stalled
  every merge, and `install.sh` was fetched unpinned, so what CI ran could change under it.

`ci.yml` was fixed job by job after each of these, and `pages.yml` was not: on the commit this
rule was written against, the Pages smoke still installed its browser with a bare
`npx playwright install --with-deps` and a bare `apt-get`, with no step limit. A convention
that is repaired where it last hurt regresses in the next job somebody adds.

# Required behaviour

- A job declares a positive `timeout-minutes`. The one exception is a job that calls a
  reusable workflow (a job-level `uses:`), where GitHub accepts none: the limits are the
  called workflow's jobs', and a local one is checked as a workflow file itself.
- A step declares its own `timeout-minutes` when its `run` installs through
  `.github/scripts/ci-install.sh`, runs `curl`, `wget`, any `gh` command or `verify-deploy`,
  or runs a browser suite. The browser suites are not listed by hand: they are the npm
  scripts of `package.json` whose command, with `npm run <x>` expanded, starts a file of
  `tests/browser/` or a `scripts/visual-*` program; a `run` that names `tests/browser`,
  `tests/visual` or `scripts/visual-*` itself (after a `cd`, say) or runs `playwright test`
  counts too. A step that uses a local composite action whose steps do any of this carries
  the limit, since a composite action's steps cannot.
- `playwright install`, `playwright install-deps`, `apt`, `apt-get`, `aptitude` and `dpkg -i`
  appear as a command in no workflow, in no composite action (an `action.yml` anywhere under `.github/`) and in
  no other shell script under `.github/` or `scripts/`, whatever options stand between the
  program and its verb (`apt-get -o Acquire::Retries=3 install` is the same install): the
  wrapper bounds each install by wall time and retries it once, against the next mirror for
  apt, and must keep doing so.
- A download is `curl` with `--retry <n>` and `--connect-timeout <s>` (`wget`: `--tries`
  and `--connect-timeout`). Whatever it fetches is checked with `sha256sum -c` in the same
  step against a 64-hex digest written in the workflow, however it is kept: `-o`, a `>`
  redirect, a pipe into `tar` or `tee`, or printed. Only a download that says it keeps
  nothing (`-o /dev/null`, `> /dev/null`, `--spider`, and no pipe) needs the flags alone.
- A download is never executed: not piped into a shell or another interpreter (`sh`, `bash`,
  `python`, `node`, `perl`, `ruby`, ...), not substituted into a command (`$(curl ...)`,
  `<(curl ...)`, backticks), and not fetched in a step that uses `eval`. A digest check
  elsewhere in the step does not excuse it.
- `uses:` names a version tag (`@v7`) or a full commit; a container image names a tag other
  than `latest`, or a digest.
- Nothing is made non-fatal: no job and no step sets `continue-on-error` (GitHub reports such
  a job as succeeded, so `gate` would pass over its failure), and no line that installs,
  downloads or runs a browser suite ends in `|| true` or `|| :`.
- `gate` runs with `if: always()`, its `needs` list every other job of its workflow, and it
  fails unless every one of them succeeded. A job that `gate` does not need is not required
  by branch protection, whatever it checks.
- A workflow with a `gate` job is started by `pull_request` and nothing else. Its
  `fail-first` and `review-verdict` jobs judge a pull request; a manual run on a pull
  request's branch would have none to judge, and its `gate` would land on the same commit as
  the required check.

By convention, not checked: a job's limit is the sum of its steps', rounded up.

Not covered, and bounded only by their job's limit: `npm ci` (npm retries its own fetches)
and the `uses:` actions themselves (checkout, setup-node, upload-artifact, the Pages
actions). The rule does not pin `runs-on` images.

# Enforcement

`scripts/ci-workflow-rules.mjs` parses every `.github/workflows/*.yml` and every composite
action (`action.yml` under `.github/`), reads every `*.sh` under `.github/` and `scripts/`,
and reports each violation with its rule, file, job and step. The parser is `scripts/yaml-subset.mjs`, a strict reader (pinned by
`tests/unit/yaml-subset.test.mjs`) that throws on YAML it does not implement, so a workflow
it cannot read fails the test instead of passing unread.
`tests/unit/ci-workflows.test.mjs` runs it in `npm test`, so in `npm run verify`, in
`npm run release-gate` and in the `unit` job of `ci.yml`, which `gate` needs:

- "the repository has no violation" fails on any of the above in any workflow file, including
  one added later.
- The `mutation:` tests apply each violation to a copy of the real `ci.yml` or `pages.yml`
  (a job without a limit, a bare `npx playwright install --with-deps`, a bare `apt-get`, apt
  behind `-o <value>`, `-t <release>` or `--option <value>`, inside `sh -c "..."` and as
  `apt install`, `dpkg --force-all -i`, an unbounded install, suite or download step, a suite
  run after `cd tests/browser`, `playwright test`, a `gh` command, a `curl` without `--retry`
  or `--connect-timeout`, a download with no digest check or no pinned digest whether kept
  with `-o`, `>`, `>>`, `| tee` or printed, an installer piped into `sh`, `bash`, `zsh`,
  `python3`, `node`, `perl` or `ruby`, through `sudo -E` or `env`, `bash <(curl ...)`,
  `sh -c "$(curl ...)"`, backticks, `eval`, `continue-on-error` on a job and on a step,
  `|| true` after a suite and after an install, an install in a composite action, in a
  script under `scripts/` and behind a local action used without a limit, each job in turn
  removed from `gate.needs`, a new job nobody added to it, `gate` without `if: always()`,
  `workflow_dispatch` or `push` added to `ci.yml`'s triggers, an action on a branch, an image
  without a tag, a reusable workflow on a branch) and require the checker to name that rule
  and that job and nothing else. A checker that stopped looking fails here. The same tests
  hold the forms that must stay allowed: `ci-install.sh apt <package>`, a path containing
  `apt`, `dpkg -l`, a digest-checked download, a discarded probe, `|| true` on a cleanup, a
  job that calls a reusable workflow.
- "the pull-request rules are judged by the base branch's programs" fails if the
  `fail-first` or `review-verdict` job stops running its program through
  `.github/scripts/base-rule.sh`, or passes when there is no pull request.

`tests/unit/ci-knowledge-job.test.mjs` keeps the `knowledge` job's own assertions (the exact
retry flags, the verdict program).

What the test cannot see:

- Whether a limit is long enough or short enough, and whether a pinned tag still points at
  the commit it did. Those stay with whoever reads a slow run.
- Shell it does not read: a program in another language that downloads or installs
  (`scripts/*.mjs`, an inline `node -e` or `python -c`), and a shell script outside
  `.github/` and `scripts/`. The patterns are matched per logical line, so an install built
  from variables (`$PM install`) is not recognised.
- A pull request that rewrites the workflow. On a pull request GitHub runs the workflow file
  the pull request carries, so a change to `ci.yml` is judged by this test as that pull
  request leaves it. What holds such a change back is `project.review-verdict`: everything
  under `.github/`, this checker and this test are guarded paths there.

# Failure behaviour

`npm test` fails and names the rule, the file, the job and the step. The fix is in the
workflow or in `ci-install.sh`, never an exception in the checker.
