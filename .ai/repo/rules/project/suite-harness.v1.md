---
id: project.suite-harness
version: 1
kind: rule
title: Every browser suite runs through one harness that never passes vacuously
description: A browser suite opens its run through tests/browser/lib/suite.cjs, which refuses a selection it cannot run, fails a leg that checked nothing, fails an undeclared skip under CI and holds a start on a loaded machine.
statement: Every tests/browser entry suite goes through tests/browser/lib/suite.cjs. It refuses an empty or unknown browser or origin list with exit 2 and never maps an unknown name to a default engine. It fails a leg that ran 0 checks, and under CI it fails any skip not listed with a reason in tests/README.md. Outside CI (a no-op when CI is set) it waits, bounded, for the 1-minute loadavg to fall below OSC_LOAD_MAX (default 2 × cores) and prints the load at start and end.
status: active
class: blocking
depends_on: [project.bounded-test-timing@1]
tags: [tests, browser, harness, ci]
---

# Rationale

A suite that runs nothing reports no failure, and "no failure" was printed as a pass:

- #147: `dsp.cjs` imported only chromium and firefox, so `OSC_BROWSERS=webkit` ran 0 checks
  and printed ALL PASS; `labs.cjs` launched Chromium for any name but firefox, under the
  other browser's label; the About provenance tests skipped silently in CI.
- 2026-10-03: the v3.2.0 gate failed three times at a load average of 23-48 and passed at
  about 4, with no change to the code. 2026-10-04: an analysis took 10.4 s against a 1.0 s
  budget at load 93-101. The suites measured the machine.
- Each suite parsed `OSC_BROWSERS` itself. Some exited 2 on an unknown name, each in its own
  words; seven split the variable without looking at the result, and none guarded a leg that
  ran no check or a skip nobody declared.

# Required behaviour

- An entry suite (`tests/browser/<name>.cjs`) opens its run with `suite.open({ name: '<name>',
  browsers, origins })` from `tests/browser/lib/suite.cjs` and reads no `OSC_BROWSERS` or
  `OSC_ORIGINS` itself. The harness takes the suite's flag first, then the variable, then the
  default; an empty list, a blank or repeated name and an unknown name exit 2 with the list of
  known names. A variable that is set and empty is an empty list, not "everything".
- Playwright is `RUN.playwright`. An engine is indexed by the selected name
  (`playwright[name]`); a name the harness does not know throws, and no code picks an engine
  by a comparison with a default branch or names one outright.
- Every executed check is counted against its leg: `RUN.tally(leg)` in the suite's check
  function, or `RUN.reportLeg({ leg, checks })` when a leg finishes. `reportLeg` throws on 0
  checks, and at exit a selected browser with 0 checks turns exit code 0 into 1.
- A check that is not run is taken through `RUN.skip(leg, id, reason)`. Under `CI` or
  `GITHUB_ACTIONS` the skip `<suite>:<id>` must be a row with a reason in the "Declared
  skips" table of `tests/README.md`; otherwise the suite fails. A skip never counts as a
  check.
- A suite awaits `RUN.ready()` before it launches anything. Outside CI it waits for the
  1-minute load average to fall below `OSC_LOAD_MAX` (default 2 × cores) for at most
  `OSC_LOAD_WAIT_MS` (default 10 minutes) and then fails by name without running; under CI it
  returns at once. The load is printed at start and at end.

# Enforcement

`tests/unit/browser-suite-contract.test.mjs`, run by `npm test` (so by `npm run verify`, the
release gate and the CI `unit` job):

- Static, "every entry suite under tests/browser runs through the harness": each
  `tests/browser/*.cjs` requires `./lib/suite.cjs`, opens its run under its own file name,
  awaits `ready()`, tallies or reports, requires no playwright of its own, reads no
  `OSC_BROWSERS` / `OSC_ORIGINS`, and names no engine outright (`playwright.chromium`, or
  `=== 'firefox' ? … : chromium`). Comments and strings are not read as code.
- Behavioural, on the harness itself: `parse('bogus')` and `parse('')` carry exit code 2 and
  a process that opens a run with either exits 2; "every migrated suite exits 2 on an unknown
  and on an empty OSC_BROWSERS" spawns each entry suite both ways; `reportLeg({ checks: 0 })`
  throws and a process whose selected browser ran 0 checks exits 1 although it asked for 0;
  an unlisted skip under `GITHUB_ACTIONS` or `CI` throws and fails the run; the load gate
  returns at once under CI, waits while an injected load is high, and ends in a named failure
  at its bound, in-process on a fake clock and once as a real process; an unknown engine name
  throws; `page.evaluate` of every page of a harness browser rejects by name at its bound.
- "every skip a suite can take is declared in tests/README.md, and nothing else is" reads the
  `skip(` calls of the suites against the table, in both directions, so an undeclared skip
  fails `npm test` before it fails a CI browser job.
- The mutation cases are tests of the same file: `dsp.cjs` reverted to splitting
  `process.env.OSC_BROWSERS` is out of the contract, as are a default engine, a raw
  `require('playwright')`, a missing tally and a missing `ready()`.

What the mechanism does not decide:

- `tests/browser/v3-ui.cjs` does not go through the harness yet. It is the one entry of
  `PENDING` in the test, with the reason (another change owned the file when this rule
  landed); the list may only shrink, and a pending suite that conforms fails the test until
  its entry is removed. Until then that suite still parses `OSC_BROWSERS` itself: an unknown
  name exits 2 there, an empty one runs every browser, and none of the guards above apply.
- The 0-checks guard at exit is per selected browser. A suite with several origins is
  guarded per leg only where it calls `reportLeg` for each leg; a suite that tallies in its
  check function could run one origin and not the other without the harness seeing it.
- A check that returns early without calling `RUN.skip` is not seen: the static test reads
  the `skip(` calls that exist, it cannot find a skip that was never declared as one. A check
  limited to some browsers by an `if` is such a case.
- The load gate reads the 1-minute average once every 5 s before the suite starts. Load that
  arrives during the run is printed at the end and judged by nobody.
- Playwright scripts under `scripts/` (the visual gate) are outside the contract.

# Failure behaviour

A refused selection exits 2 before any browser starts and names the list it expected. A leg
or browser without checks, and an undeclared skip under CI, exit 1 with a `FAIL [suite]` line.
A machine that stays loaded ends the suite with the load, the limit and the time waited;
nothing ran, so nothing is reported as passed or failed. The fix is never the default: a new
suite goes through the harness, and a new skip gets its row.
