---
schema: skill/v1
id: add-a-browser-check
version: 1
title: Add a browser check
description: Add a check or an entry suite under tests/browser that runs through the suite harness, waits only on bounded named conditions and is listed in tests/README.md (rules suite-harness and bounded-test-timing).
status: draft
tags: [tests, browser, timing]
related: [fail-first-change]
inputs:
  - a behaviour only a real browser can observe, and the suite it belongs to
outputs:
  - the check, counted against its leg, with every wait bounded and named
  - its tests/README.md row (and a Declared skips row for any skip)
---

# Purpose

Adds browser coverage that measures OSCILLA and not the host: one harness for selection,
engines and legs (rule `project.suite-harness`), and waits that poll the judged condition
against a wall-clock deadline (rule `project.bounded-test-timing`). `tests/README.md`
("The browser harness") is the reference; this skill is the order of the work.

# Procedure

1. Prefer a check in an existing suite. A new entry suite is `tests/browser/<name>.cjs`
   and opens its run through the harness, reading no `OSC_BROWSERS` itself:

   ```js
   const suite = require('./lib/suite.cjs');
   const { until, bounded, frames } = require('./lib/wait.cjs');
   const RUN = suite.open({ name: '<name>', browsers: arg('browsers'), origins: arg('origins') });
   const playwright = RUN.playwright;          // engines by selected name only
   await RUN.ready();                          // the load gate, before any launch
   const browser = await playwright[name].launch();
   RUN.tally(leg);                             // in the check function, once per check
   RUN.reportLeg({ leg, checks });             // or once per finished leg
   ```

   Copy the shape of `tests/browser/v31-studio-links.cjs` for the argument parsing.

2. Wait for the condition the assertion then judges, with a deadline and a name:

   ```js
   await until(() => page.evaluate(() => window.OSCILLA.engine.snapshot().playing),
     { ms: 5000, what: 'the engine reports playing after PLAY' });
   await bounded(promise, { ms: 10000, what: 'the WAV render finishes' });
   ```

   A Playwright wait states a non-zero `timeout` at the call. No fixed sleep, in the suite or
   in the page; a deliberate hold carries `// timing-allow: <reason of three words or more>`.

3. Take frame windows from the context's rate, never a count or an assumed 44100/48000:
   `frames(seconds, ctx.sampleRate)`, or `anchor(ctx, leadS)` from `tests/browser/lib/wait.cjs`
   run in the page.

4. An http leg serves dist through the shared server, never a port of its own:

   ```js
   const { serveDist } = require('./lib/serve.cjs');
   const server = await serveDist(DIST, { prefix: 'oscilla-<name>-' });
   await page.goto(server.url);
   server.close();
   ```

5. A check that is not run goes through `RUN.skip(leg, id, reason)` and gets a row
   `<suite>:<id>` with its reason in the "Declared skips" table of `tests/README.md`.

6. A new suite is reached by an npm script `test:release` runs (`package.json`), and gets
   its row in the table of `tests/README.md`: `` | `browser/<name>.cjs` | GATE | <what it
   proves> | ``. The inventory check fails in both directions.

7. Check statically, then run the one suite in one browser on a quiet machine:

   ```bash
   node --test tests/unit/browser-suite-contract.test.mjs tests/unit/browser-timing.test.mjs \
     tests/unit/browser-static-server.test.mjs tests/unit/knowledge-integrity.test.mjs
   node tests/browser/lib/timing-scan.cjs
   npm run build
   sysctl -n vm.loadavg
   OSC_BROWSERS=chromium node tests/browser/<name>.cjs
   ```

   Never stop a hung suite by a name pattern; stop the PID it was started with.

8. When the change removes a recorded sleep, lower the debt record in the same change, and
   only then: `node tests/browser/lib/timing-scan.cjs --write-baseline`, committing
   `tests/browser/timing-baseline.json`. It never raises a count.

9. A `fix` proven only by a browser check carries `fail-first: n/a <reason>` in its pull
   request body (skill `fail-first-change`): the fail-first job runs unit tests only.

# Output

- The check in its suite, counted with `RUN.tally` or `RUN.reportLeg`, every wait an
  `until` or `bounded` with `ms` and `what`, frames from the context's rate.
- The `tests/README.md` row (and any Declared skips row), and a lowered
  `tests/browser/timing-baseline.json` when debt was paid.
- The static tests and the timing scan passing, and the suite's run in one browser.
