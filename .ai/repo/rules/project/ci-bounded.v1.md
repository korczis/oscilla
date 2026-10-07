---
id: project.ci-bounded
version: 1
kind: rule
title: Every CI job and network step is bounded, pinned and retried
description: Every workflow job and every step that installs, downloads or runs a browser suite has its own time limit; installs go through one bounded wrapper, downloads retry and are digest-checked, and gate needs every job.
statement: Every job in .github/workflows/*.yml declares timeout-minutes, and so does every step that installs through .github/scripts/ci-install.sh, runs curl, wget or gh, or runs a browser suite; browser and apt installs go only through .github/scripts/ci-install.sh; every curl carries --retry and --connect-timeout (wget --tries and --connect-timeout); every downloaded file is checked with sha256sum -c against a digest pinned in the workflow and none is piped into a shell; every action is pinned to a version tag or commit and every container image to a tag; and the gate job's needs list every other job of ci.yml.
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

- A job declares a positive `timeout-minutes`.
- A step declares its own `timeout-minutes` when its `run` installs through
  `.github/scripts/ci-install.sh`, runs `curl`, `wget`, `gh` or `verify-deploy`, or runs a
  browser suite. The browser suites are not listed by hand: they are the npm scripts of
  `package.json` whose command, with `npm run <x>` expanded, starts a file of `tests/browser/`
  or a `scripts/visual-*` program. The job's limit is the sum of its steps', rounded up.
- `playwright install`, `playwright install-deps`, `apt`, `apt-get` and `dpkg -i` appear in no
  workflow and in no other script under `.github/scripts/`: the wrapper bounds each install by
  wall time and retries it once, against the next mirror for apt, and must keep doing so.
- A download is `curl` with `--retry <n>` and `--connect-timeout <s>`. A download written to
  a file or piped into an archiver is checked with `sha256sum -c` in the same step against a
  64-hex digest written in the workflow. A download piped into a shell is refused outright.
- `uses:` names a version tag (`@v7`) or a full commit; a container image names a tag other
  than `latest`, or a digest.
- `gate` runs with `if: always()`, its `needs` list every other job of its workflow, and it
  fails unless every one of them succeeded. A job that `gate` does not need is not required
  by branch protection, whatever it checks.

Not covered, and bounded only by their job's limit: `npm ci` (npm retries its own fetches)
and the `uses:` actions themselves (checkout, setup-node, upload-artifact, the Pages
actions). The rule does not pin `runs-on` images.

# Enforcement

`scripts/ci-workflow-rules.mjs` parses every `.github/workflows/*.yml` and reads
`.github/scripts/*.sh`, and reports each violation with its rule, file, job and step. The
parser is `scripts/yaml-subset.mjs`, a strict reader (pinned by
`tests/unit/yaml-subset.test.mjs`) that throws on YAML it does not implement, so a workflow
it cannot read fails the test instead of passing unread.
`tests/unit/ci-workflows.test.mjs` runs it in `npm test`, so in `npm run verify`, in
`npm run release-gate` and in the `unit` job of `ci.yml`, which `gate` needs:

- "the repository has no violation" fails on any of the above in any workflow file, including
  one added later.
- The `mutation:` tests apply each violation to a copy of the real `ci.yml` or `pages.yml`
  (a job without a limit, a bare `npx playwright install --with-deps`, a bare `apt-get`, an
  unbounded install, suite or download step, a `curl` without `--retry` or
  `--connect-timeout`, a download with no digest check or no pinned digest, an installer
  piped into `sh`, each job in turn removed from `gate.needs`, a new job nobody added to it,
  `gate` without `if: always()`, an action on a branch, an image without a tag) and require
  the checker to name that rule and that job and nothing else. A checker that stopped
  looking fails here.

`tests/unit/ci-knowledge-job.test.mjs` keeps the `knowledge` job's own assertions (the exact
retry flags, the verdict program).

What the test cannot see: whether a limit is long enough or short enough, and whether a
pinned tag still points at the commit it did. Those stay with whoever reads a slow run.

# Failure behaviour

`npm test` fails and names the rule, the file, the job and the step. The fix is in the
workflow or in `ci-install.sh`, never an exception in the checker.
