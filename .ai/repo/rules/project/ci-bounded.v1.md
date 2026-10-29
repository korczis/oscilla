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

- A job declares a positive `timeout-minutes`, written as a number (an expression such as
  `${{ vars.LIMIT }}` cannot be read here and is refused). The one exception is a job that calls a
  reusable workflow (a job-level `uses:`), where GitHub accepts none: the limits are the
  called workflow's jobs', and a local one is checked as a workflow file itself.
- A step declares its own `timeout-minutes` when its `run` installs through
  `.github/scripts/ci-install.sh`, runs `curl`, `wget`, any `gh` command or `verify-deploy`,
  or runs a browser suite. The browser suites are not listed by hand: they are the npm
  scripts of `package.json` whose command, with `npm run <x>` expanded, starts a file of
  `tests/browser/` or a `scripts/visual-*` program, however the script is started (`npm run`
  with options before or after `run`, `node --run`, `yarn`, `pnpm`); a `run` that names `tests/browser`,
  `tests/visual` or `scripts/visual-*` itself (after a `cd`, say) or runs `playwright test`
  counts too. A step that uses a local composite action whose steps do any of this carries
  the limit, since a composite action's steps cannot.
- `playwright install`, `playwright install-deps`, `apt`, `apt-get`, `aptitude` and `dpkg -i`
  appear as a command in no workflow, in no composite action (an `action.yml` anywhere under
  `.github/`), in no other shell script under `.github/` or `scripts/` and in no script of
  `package.json` (where `npm run <x>` or a `postinstall` under `npm ci` would hide it),
  whatever options stand between the program and its verb
  (`apt-get -o Acquire::Retries=3 install` is the same install) and whether or not it is
  named by its path (`/usr/bin/apt-get`). A plain `echo` or `printf` line and a
  `command -v <name>` lookup name a program without running it and are not read as one. The
  wrapper bounds each install by wall time and retries it once, against the next mirror for
  apt, and must keep doing so.
- A download is `curl` with `--retry <n>` and `--connect-timeout <s>` (`wget`: `--tries`
  and `--connect-timeout`). Whatever it fetches is checked with `sha256sum -c` in the same
  step against a 64-hex digest written in the workflow, however it is kept: `-o`, a `>`
  redirect, a pipe into `tar` or `tee`, or printed. Only a download that says it keeps
  nothing (`-o /dev/null`, `> /dev/null`, `--spider`, and no pipe) needs the flags alone.
  A check that has to read a response body that changes (a deployed page, an API answer)
  cannot carry a pinned digest and has no allowed `curl` form: it is written as a Node
  program, as `scripts/verify-deploy.mjs` and the live smoke are.
- A download is never executed: not piped into a shell or another interpreter (`sh`, `bash`,
  `python`, `node`, `perl`, `ruby`, ...), not substituted into a command (`$(curl ...)`,
  `<(curl ...)`, backticks), and not fetched in a step that uses `eval`. A digest check
  elsewhere in the step does not excuse it.
- `uses:` names a version tag (`@v7`) or a full commit; a container image names a tag other
  than `latest`, or a digest.
- Nothing is made non-fatal: no job and no step sets `continue-on-error` (GitHub reports such
  a job as succeeded, so `gate` would pass over its failure); no line that installs,
  downloads, checks a digest or runs a browser suite throws its failure away with
  `|| true`, `|| :`, `|| exit 0`, a trailing `|| echo ...` or a trailing `; true`; and no
  step that has such a line turns `set +e` on. Other ways to ignore a failure are listed
  below as not seen.
- `gate` runs with `if: always()`, its `needs` list every other job of its workflow, and it
  fails unless every one of them succeeded. A job that `gate` does not need is not required
  by branch protection, whatever it checks.
- A workflow with a `gate` job is started by `pull_request` and nothing else. Its
  `fail-first` and `review-verdict` jobs judge a pull request; a manual run on a pull
  request's branch would have none to judge, and its `gate` would land on the same commit as
  the required check.
- A job that calls `.github/scripts/base-rule.sh` (a judge job: `fail-first`,
  `review-verdict`, `metadata`) is shaped so that nothing of the pull request runs before the
  judge, and the judge drives the install. That shape is the guarantee (review of #255,
  round 4): `actions/setup-node` first, without `cache` or `node-version-file`, so it reads
  no file of the checkout; the checkout; the step `id: judge`, which takes
  `.github/scripts/base-rule.sh` and `scripts/` from the base commit into
  `$RUNNER_TEMP/judge`, writes the commit to `.base-commit` and the sha256 of every file to
  `.manifest`, makes the copy read-only (`chmod -R a-w`) and records the judge's PATH (setup-
  node's node directory and the system's) and the manifest's own sha256 as step outputs;
  then the judge's step, the job's last, which runs in `/usr/bin/env -u BASH_ENV -u ENV
  /bin/bash --noprofile --norc -eo pipefail {0}` and calls `"${{ runner.temp
  }}/judge/.github/scripts/base-rule.sh"` with `/bin/bash` under `/usr/bin/env -i`, with that
  PATH, `JUDGE_MANIFEST` set to that digest, a HOME under `runner.temp`, and no name outside
  PATH, HOME, CI, GH_TOKEN, GITHUB_REPOSITORY, LANG, LC_ALL, TZ, JUDGE_MANIFEST. The copy
  checks itself against the manifest (`scripts/judge-isolation.mjs --verify`) and then
  `exec`s the program, so no shell reads a file after the program starts. Nothing is
  installed before the judge: the fail-first judge (the base's `fail-first.mjs`) runs the
  base's `install-guard.mjs` in-process, then `npm ci --ignore-scripts` and the pull
  request's tests as its own children, each in a process group of its own with a cleared
  environment (no `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`,
  `RUNNER_TEMP`, `NODE_OPTIONS`, `BASH_ENV`), and judges in its own memory; it refuses to
  judge where Yama's `ptrace_scope` is 0 or missing, and when its copy departs from the
  manifest before the first child or after the last (defence in depth: the same user could
  chmod the copy back). The `review-verdict` and `metadata` judges install nothing. The
  verdict of each is the judge's exit status alone; nothing reads its log.
- `judge-first` is advisory: a lint backing `project.review-verdict` (every change under
  `.github/` is reviewed), not the guarantee. It reads the shape above: up to the call no
  action runs, no command installs or runs code of the pull request (any package manager,
  an interpreter or task runner, `eval`, `source` / `.`, a program named by a relative or
  workspace path, a glob, a variable or a substitution, `git -c`, awk's `system()`, a PATH
  or loader variable assigned or exported on the way), each command read as bash reads it
  (`scripts/shell-words.mjs`), its program the word after assignments, redirections, shell
  keywords and definitions (`if`, `!`, `{`, `while`, `coproc`, `function`) and wrappers
  (`env`, `sudo`, `command`, `exec`, `time`, `nice`, `nohup`, `timeout`, `xargs`, ...); no
  workflow, job or step `env:` before the call sets `BASH_ENV`, `ENV`, `PATH`,
  `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `GIT_*`, `npm_config_*` or another loader variable, and
  no step before it runs in a `shell:` of its own or under a default shell other than bash
  (R23); the call is found by its structure, not by the first mention of `base-rule.sh`, and
  a judge named through a variable or reached through a local action is refused. It reads a
  subset of bash, so a form it cannot read can pass it (R19); the review of the `.github`
  change is what catches that. History: the `fail-first` job ran `npm ci` before the judge,
  so a `postinstall` could rewrite `base-rule.sh` or reach the judge's step through
  `$GITHUB_PATH` or `$GITHUB_ENV` (R12); `--ignore-scripts` left a git dependency's
  `prepare` and a PR `.npmrc`'s `git=` (R17, R18); round 4 showed both together, from a tree
  the guard passed, rewriting even the read-only extracted copy before the judge ran (R22).
  What the judge itself runs (fail-first runs the pull request's tests) runs after the
  base's program has loaded; see `project.fail-first` for what that does not cover.

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
  without a tag, a reusable workflow on a branch, an install in a script of `package.json`
  including `postinstall`, apt and dpkg by their path, a suite behind `npm run -s`,
  `npm --silent run`, `node --run`, `yarn` and `pnpm`, a failure thrown away with
  `|| exit 0`, `|| echo`, `; true` or `set +e`, a digest check followed by `|| true`, a
  download after a quoted `#`) and require the checker to name that rule
  and that job and nothing else. A checker that stopped looking fails here. The same tests
  hold the forms that must stay allowed: `ci-install.sh apt <package>`, a path containing
  `apt`, `dpkg -l`, a digest-checked download, a discarded probe, `|| true` on a cleanup, a
  job that calls a reusable workflow, an `echo` that mentions apt or curl, `command -v curl`,
  `--retry "$VAR"`, a pre-release version tag, `|| { ...; exit 1; }`.
- "the pull-request rules are judged by the base branch's programs" fails unless the last
  command of the `fail-first` and of the `review-verdict` job is exactly its call of the
  base commit's copy of `.github/scripts/base-rule.sh` under `env -i` with its exact
  arguments, in the judge's shell, unconditional, and the step fails when there is no pull
  request; "a rule job whose call can no longer refuse" applies thirteen such edits and
  requires each to be reported. The `judge-first` tests refuse each departure from the
  job's shape, any install, each wrapped, keyworded or variable-named command, and each
  loader `env:` or shell of a step's own before the judge (R23), and
  `tests/unit/base-rule.test.mjs` runs the judge jobs step by step against a postinstall, a
  git dependency's `prepare`, a `.npmrc` `git=` and the reproduction of R22 (a git spec
  nested in a registry entry and a `git=` after a lone CR): with an install step before the
  judge (the control) the PR's code rewrites the read-only copy and the judge's step prints a
  forged pass; in each job as it is the judge's guard refuses first and the copy is the one
  extracted (R12, R17, R18, R22).

`tests/unit/ci-knowledge-job.test.mjs` keeps the `knowledge` job's own assertions (the exact
retry flags, the verdict program).

What the test cannot see:

- Whether a limit is long enough or short enough, and whether a pinned tag still points at
  the commit it did. Those stay with whoever reads a slow run.
- Shell it does not read: a program in another language that downloads or installs
  (`scripts/*.mjs`, an inline `node -e` or `python -c`), and a shell script outside
  `.github/` and `scripts/`. The patterns are matched per logical line, so an install built
  from variables (`$PM install`) is not recognised.
- Other ways to keep a download or ignore a failure: a failure swallowed by
  `if ! <suite>; then ...; fi` or by a `|| echo` with a separator inside its quotes; two
  downloads in one step with a digest check that covers one of them (the clause holds per
  step, not per file); a sums file that was itself downloaded; `gh release download`,
  `git clone`, `npx <remote package>`, `aria2c` and `docker run`, which are not read as
  downloads (a `gh` command still needs its step limit).
- YAML the strict reader does not implement (anchors, a multi-line flow sequence): the file
  is refused as unreadable, which is a refusal of a legal workflow, not a pass.
- A pull request that rewrites the workflow. On a pull request GitHub runs the workflow file
  the pull request carries, so a change to `ci.yml` is judged by this test as that pull
  request leaves it. What holds such a change back is `project.review-verdict`: everything
  under `.github/`, this checker and this test are guarded paths there.

# Failure behaviour

`npm test` fails and names the rule, the file, the job and the step. The fix is in the
workflow or in `ci-install.sh`, never an exception in the checker.
