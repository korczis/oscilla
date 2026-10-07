---
id: project.deploy-often
version: 1
kind: rule
title: Releasable commits on main do not sit unreleased
description: When main carries commits that need a release, the oldest of them is at most 24 hours old; an hourly workflow is red and keeps one "release overdue" issue open until a release ships.
statement: When release:analyze reports a level other than none for main, the oldest unreleased release-relevant commit (one release-analyze gives a level other than none - feat, fix, perf, revert, a breaking change, or a commit that is not a conventional commit) landed at most 24 hours ago. Otherwise the Release cadence workflow fails and one open issue titled "release overdue" names the commit, until a release ships.
status: active
class: blocking
depends_on: [project.release-flow-complete@1]
tags: [release, cadence, deployment]
x-majordomus:
  tests: [tests/unit/release-cadence.test.mjs]
---

# Rationale

The public page is the showcase, and a feature that is merged and not released is not on it
under a version anyone can name. 2026-10-03 00:11, the owner: "still nothing new deployed i
see"; V3 had sat on a branch for hours. 2026-10-05: the owner judged a day without a published
release a bad showcase. 2026-10-07: "deploy often, follow rules, formalize them, enforce
them". Until this rule the expectation lived in one worker's memory and nothing measured it.

# Required behaviour

- A commit that needs a release is released within 24 hours of landing on main. The clock is
  the oldest such commit since the last `v*` tag, by committer date (for a squash merge, the
  time of the merge); a later fix does not restart it.
- What needs a release is decided by `scripts/release-analyze.mjs` and by nothing else: any
  commit it gives a level other than none. Commits that are only `build`, `chore`, `ci`,
  `docs`, `refactor`, `style` or `test` never make a release overdue, however old.
- An overdue release is cleared by shipping it through the flow of
  `project.release-flow-complete`, not by retitling commits and not by closing the issue: the
  workflow reopens the verdict every hour.
- A release that must wait (an owner decision) is recorded as a decision; the check stays red
  for as long as that lasts. There is no silence switch.

# Enforcement

`scripts/release-cadence.mjs`: `cadence()` is a pure function over the last tag, the dated
commits since it and the current time, using `analyzeCommits()` of
`scripts/release-analyze.mjs` for the level. Exit 1 when overdue, 2 when no `v*` tag is
reachable (the lag cannot be measured). With `--issue`, `syncIssue()` opens, updates or closes
the one issue through `gh`.

`.github/workflows/cadence.yml` runs `node scripts/release-cadence.mjs --issue` every hour, on
every push to main and on every `v*` tag, with full history, a 5-minute timeout and a token
that reads contents and writes issues only. The run fails while the release is overdue.

`tests/unit/release-cadence.test.mjs`: a `feat` 48 hours old fails and is named; the same
commit at 2 hours passes; `chore` and `docs` commits at 72 hours pass; the issue is created
once, edited while overdue and closed when it clears; the workflow file keeps its schedule,
its timeout, its permissions and the failing step. The same file prints the lag of the current
checkout as a diagnostic line and never fails on it, so `npm test`, `npm run verify` and the
release gate show it.

What this is not: a required check. The `gate` check that blocks a merge does not include the
cadence, because the pull request that clears an overdue release is the release itself and a
required red check would block it. A violation is a red scheduled workflow on main and an open
issue; nothing stops a merge. The lag is not a step of the `verify` npm script because
`package.json` is a build input and a new step would change `dist/index.html`; the diagnostic
line of the unit test carries it instead.

# Failure behaviour

The Release cadence workflow is red on main and the "release overdue" issue names the oldest
unreleased commit, its age and the level the release needs. Ship the release; the next run
closes the issue.
