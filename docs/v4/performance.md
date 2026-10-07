# Startup and large-library performance (v4.0)

Ledger P2 item P1, "no startup budget or large-library fixture". This document records what is
measured, the measurements, the budgets derived from them, and why the suite that asserts them
is not part of the release gate.

Nothing below is typed in by hand. `tests/browser/fixtures/perf-sessions.json` holds the single
samples of every recorded session; `tests/browser/fixtures/perf-sessions.mjs` derives
`perf-budgets.json` (the measurements and the budgets the suite asserts) and every table of
this document between `begin` and `end` markers from it, and
`tests/unit/v4-performance-docs.test.mjs` recomputes all of that and fails on any difference.

The Studio-specific numbers (compile, render, large graph) are in
[`docs/v31/performance.md`](../v31/performance.md) and are not repeated here.

## What "interactive" means

`src/js/main.js` sets one User Timing mark, `oscilla:ready`, in the statement before it sets
`html[data-ready="true"]`: Alpine has started, the instrument component has initialised, and
its first `$nextTick` has mounted the visualizer, the labs and the MEASURE and Experiments
charts. The mark's `startTime` is milliseconds since navigation start, read inside the page, so
the startup number contains no polling interval of the test.

The suite's `ready-mark` check holds the definition: exactly one mark, and the attribute
observed by a `MutationObserver` in the same task. The observer's clock read 0.1 ms or less
after the mark in Chromium and 0 ms in Firefox and WebKit in the six measuring sessions, and
1 ms in one later Firefox session (Firefox and WebKit coarsen their timers to whole
milliseconds). In that observer callback, still the task that set the mark, Hold to Play and
the frequency slider are enabled and hit-testable. Once the page has reported ready, in a
later task, a slider input updates the readout through Alpine; that part is "directly after
the mark", not "at the mark".

## The large library

<!-- library:begin -->
500 experiments, 50 definitions, 20 Studio projects (10 recipes, 20 engine measurements)
<!-- library:end -->

`tests/browser/fixtures/large-library.mjs` builds it in Node with the app's own code: the
MeasurementEngine on its synthetic io, `experimentFromResult`, `validateExperiment`,
`serializeExperiment`, `summaryRecord`, `definition.js`, `studio/library.js`. Every experiment
is a TEST CONTEXT record and its name says so. The stored experiments are 437,198 to 993,354
bytes each (the impulse response is most of it) and 352,280,976 bytes together. The suite
writes them into the IndexedDB stores the app created, and its `library-seed` check passes only
when the app's own store lists 500 experiments, 50 definitions and 20 Studio projects.

## What is measured

All from `file://`, the built `dist/index.html`, viewport 1536x1024, reduced motion.

| Measurement | From | To |
| --- | --- | --- |
| `startup` | navigation start, fresh context, empty storage | the `oscilla:ready` mark |
| `startupLibrary` | navigation start, fresh page over the seeded library | the `oscilla:ready` mark |
| `experimentsList` | click on Experiments in the navigation | first animation-frame callback with 500 experiment rows and 50 definition rows in the DOM |
| `experimentDetail` | click on Open of an experiment not read on that page | first animation-frame callback in which the detail heading names it |
| `compare` | click on Compare selected, two experiments of one definition selected | first animation-frame callback in which the compare panel shows 2 entries and its summary |

The three click measurements end inside a `requestAnimationFrame` callback, which runs before
that frame's style, layout and paint. They therefore leave out the layout and paint of the
frame that shows the result. A reviewer's probe of the list in Chromium put the rows at the
first callback after 201.3 ms and the following callback at 216.6 ms, so about 15 ms (7 %) of
the list's cost is outside `experimentsList`. The numbers are lower bounds of what a person
waits for, by about one frame.

A session is one execution of the suite: per browser 7 startup samples (after one warm-up
context that is not counted), 7 startup samples over the library, and 5 fresh pages that each
give one sample of the list, the detail and Compare. The session's result for a measurement
is the median of its samples, and that median is what a budget judges. A measuring session is
`node tests/browser/perf-budgets.cjs --measure-only`, which reports without judging; an
asserting session is `npm run test:perf`.

## Measurements

Six sessions on 2026-10-07, main at 95561ee plus this change. Machine: Apple M5 Pro, 18 cores,
64 GB, macOS (Darwin 25.5.0), Node 22.20.0, Playwright 1.63.0 with its bundled Chromium,
Firefox and WebKit, headless.

The machine was shared with other work the whole time. The suite's harness holds a start until
the 1-minute load average is below 36 (2 x cores). These are therefore numbers of a busy
machine, not of an idle one, and a quieter machine was not available: a session gated at a
load of 20 waited its full 560 s and did not start. The load each session, and from session 3
on each browser's leg, started and ended with:

<!-- load:begin -->
| Session | 1-minute load at start | at end | Chromium leg | Firefox leg | WebKit leg |
| --- | --- | --- | --- | --- | --- |
| 1 | 32.7 | 51 | not recorded | not recorded | not recorded |
| 2 | 31.8 | 47.6 | not recorded | not recorded | not recorded |
| 3 | 34.5 | 33 | 34.5 -> 35 | 35 -> 37.4 | 37.4 -> 33 |
| 4 | 33 | 31.4 | 33 -> 31.5 | 31.5 -> 30.5 | 30.5 -> 31.4 |
| 5 | 30.2 | 32.2 | 30.2 -> 27.5 | 27.5 -> 31.4 | 31.4 -> 32.2 |
| 6 | 32.2 | 43.1 | 32.2 -> 32.1 | 32.1 -> 35.9 | 35.9 -> 43.1 |
<!-- load:end -->

The table is over the six session medians: their median, the fastest and the slowest.

<!-- measured:begin -->
| Measurement | Browser | Median (ms) | Fastest (ms) | Slowest (ms) | Sessions |
| --- | --- | --- | --- | --- | --- |
| startup | chromium | 287.7 | 278.1 | 312.1 | 6 |
| startup | firefox | 735.5 | 533 | 1408 | 6 |
| startup | webkit | 390 | 352 | 435 | 6 |
| startupLibrary | chromium | 297.6 | 274.7 | 310.9 | 6 |
| startupLibrary | firefox | 705.5 | 509 | 1222 | 6 |
| startupLibrary | webkit | 387 | 343 | 415 | 6 |
| experimentsList | chromium | 174.3 | 163.3 | 195.3 | 6 |
| experimentsList | firefox | 416.5 | 370 | 3348 | 6 |
| experimentsList | webkit | 278.5 | 262 | 326 | 6 |
| experimentDetail | chromium | 101.5 | 97 | 109.6 | 6 |
| experimentDetail | firefox | 143.5 | 105 | 536 | 6 |
| experimentDetail | webkit | 90 | 83 | 96 | 6 |
| compare | chromium | 151.1 | 147.8 | 164.4 | 6 |
| compare | firefox | 214.5 | 180 | 668 | 6 |
| compare | webkit | 142.5 | 134 | 153 | 6 |
<!-- measured:end -->

The session medians, in the order the sessions were made (ms):

<!-- sessions:begin -->
| Measurement | Browser | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| startup | chromium | 297.4 | 312.1 | 287.4 | 287.9 | 281.9 | 278.1 |
| startup | firefox | 1408 | 603 | 533 | 1112 | 851 | 620 |
| startup | webkit | 373 | 401 | 352 | 379 | 435 | 429 |
| startupLibrary | chromium | 289 | 307.8 | 310.9 | 286.5 | 274.7 | 306.2 |
| startupLibrary | firefox | 1101 | 589 | 1222 | 741 | 509 | 670 |
| startupLibrary | webkit | 370 | 404 | 343 | 370 | 410 | 415 |
| experimentsList | chromium | 170.9 | 177.6 | 181.9 | 170.1 | 163.3 | 195.3 |
| experimentsList | firefox | 3348 | 407 | 370 | 426 | 655 | 401 |
| experimentsList | webkit | 276 | 281 | 262 | 267 | 315 | 326 |
| experimentDetail | chromium | 109.6 | 100.6 | 102.1 | 97 | 102.3 | 100.9 |
| experimentDetail | firefox | 536 | 152 | 105 | 135 | 190 | 115 |
| experimentDetail | webkit | 92 | 88 | 83 | 83 | 96 | 96 |
| compare | chromium | 149.8 | 162.7 | 164.4 | 151.6 | 147.8 | 150.5 |
| compare | firefox | 668 | 230 | 180 | 199 | 288 | 182 |
| compare | webkit | 134 | 150 | 134 | 135 | 151 | 153 |
<!-- sessions:end -->

The single samples behind them, over all six sessions (ms):

<!-- samples:begin -->
| Measurement | Browser | Median | Min | Max | Samples |
| --- | --- | --- | --- | --- | --- |
| startup | chromium | 287.8 | 250 | 371.9 | 42 |
| startup | firefox | 666 | 512 | 1831 | 42 |
| startup | webkit | 397.5 | 296 | 463 | 42 |
| startupLibrary | chromium | 296.1 | 274 | 314.8 | 42 |
| startupLibrary | firefox | 672.5 | 498 | 3305 | 42 |
| startupLibrary | webkit | 382.5 | 302 | 484 | 42 |
| experimentsList | chromium | 178.4 | 160.1 | 234 | 30 |
| experimentsList | firefox | 476.5 | 348 | 4251 | 30 |
| experimentsList | webkit | 281.5 | 256 | 397 | 30 |
| experimentDetail | chromium | 101.9 | 88.1 | 150.4 | 30 |
| experimentDetail | firefox | 147 | 88 | 967 | 30 |
| experimentDetail | webkit | 91.5 | 79 | 128 | 30 |
| compare | chromium | 154.3 | 143.7 | 169.8 | 30 |
| compare | firefox | 216.5 | 160 | 1519 | 30 |
| compare | webkit | 140.5 | 126 | 175 | 30 |
<!-- samples:end -->

Firefox and WebKit report whole milliseconds (their timers are coarsened); Chromium reports
tenths.

### What the measurements say

- **A large library does not slow the start.** `startupLibrary` is within the spread of
  `startup` in all three browsers (297.6 against 287.7, 705.5 against 735.5, 387 against 390).
  Nothing reads the experiments before the Experiments workspace is opened.
- **Chromium and WebKit are steady; Firefox is not.** Across the same six sessions the
  Chromium and WebKit session medians stay within 13 % and 24 % of their fastest for the
  start; Firefox spans 533 to 1408 ms. In session 1 every Firefox measurement over the library
  was 3 to 9 times its median elsewhere (list 3348 ms, detail 536 ms, Compare 668 ms) while
  the load average rose from 32.7 to 51.0 during the session. The other two browsers did not
  move in that session. Whether that is Firefox's processes losing the CPU to the other work
  or something in the page is not decided by these numbers: the per-leg load was only recorded
  from session 3 on, and no later session reproduced it (the Firefox legs of sessions 3 to 6
  started and ended at loads between 27.5 and 37.4).
- **Opening an experiment validates it on the main thread, and that is the smaller part.**
  Beside each detail sample the suite times the store's `get()` of another experiment nobody
  has read on that page, and a bare IndexedDB read of a third:

<!-- reads:begin -->
| Browser | store `get()` median (min-max), ms | bare IndexedDB read median (min-max), ms | Samples |
| --- | --- | --- | --- |
| chromium | 28.5 (20.7-34.1) | 0.5 (0.3-1.5) | 30 |
| firefox | 39.5 (25-150) | 5.5 (2-19) | 30 |
| webkit | 23 (17-28) | 1 (0-7) | 30 |
<!-- reads:end -->

  The difference, about 22 to 34 ms for a record of 0.4 to 1.0 MB, is `validateExperiment`
  with the result hash recomputed by the bundled synchronous SHA-256. It is one blocked task
  of about two 60 Hz frames on this machine, about a quarter of the 90 to 145 ms an experiment
  takes to open, and it is paid once per experiment and page (the decoded experiment is
  cached). It grows with the record and with a slower processor; it is reported here, not
  changed.
- **Selecting an experiment re-evaluates every row, although no row changes.** Each click on
  a row's checkbox, to the first animation-frame callback that sees the selection:

<!-- select:begin -->
| Browser | click on a row's checkbox, median (min-max), ms | Samples |
| --- | --- | --- |
| chromium | 64.3 (56.2-76.2) | 60 |
| firefox | 191 (131-1585) | 60 |
| webkit | 116 (104-138) | 60 |
<!-- select:end -->

  That is above the 100 ms at which a click stops feeling immediate in two of the three
  browsers. No row element is replaced: a probe on the 500-row list in Chromium (every row
  element tagged, a `MutationObserver` over the list, one checkbox clicked) found all 500
  elements kept, none added or removed, and no attribute changed; the list is keyed by
  experiment id. What is replaced is every row object: `experimentsToggleSelect` in
  `src/js/ui/experiments.js` assigns `exps.rows` a new array of new objects with `selected`
  recomputed, so Alpine evaluates the bindings of all 500 rows again to arrive at the same
  DOM. It is recorded as an open line of the completion ledger with these numbers.
- **The list** with 500 + 50 rows takes 174 ms, 417 ms and 279 ms (Chromium, Firefox, WebKit)
  to the first animation-frame callback that finds the rows. The list is not windowed, so
  this grows with the library.
- Writing the library through IndexedDB took 2.2 to 2.9 s in Chromium, 1.9 to 3.4 s in WebKit
  and 5.3 to 12.9 s in Firefox. The app never writes 352 MB at once; this is the fixture's
  cost, not a product path.

## Budgets

<!-- rule:begin -->
budget = 2 x the median of the session medians, rounded up to 10 ms
<!-- rule:end -->

The margin is the factor 2 over the median session. A session's median is judged against it;
a single slow sample fails nothing. The unit test refuses a factor outside 1.5 to 3.

<!-- budgets:begin -->
| Measurement (median) | Chromium (ms) | Firefox (ms) | WebKit (ms) |
| --- | --- | --- | --- |
| startup | 580 | 1480 | 780 |
| startupLibrary | 600 | 1420 | 780 |
| experimentsList | 350 | 840 | 560 |
| experimentDetail | 210 | 290 | 180 |
| compare | 310 | 430 | 290 |
<!-- budgets:end -->

What these budgets do and do not hold:

- Every Chromium and WebKit session above is inside them: each budget is at least 1.7 times
  the slowest session of its measurement.
- Firefox sessions 2 to 6 are inside them. Session 1 is not, for the list, the detail and
  Compare, and it is inside the startup budget by 72 ms. The slowest session was deliberately
  not made part of the rule: a budget that admits 3348 ms for a list whose median is 417 ms
  would catch nothing. On a machine as loaded as this one was, one Firefox session in six can
  therefore fail without any change to the code; the suite prints the 1-minute load each leg
  started and ended with so that such a failure can be read for what it is and repeated.
- For Firefox the factor 2 is not a margin of 2 in practice. The asserting sessions made
  after the budgets were set, with the commit each ran on, the load of each browser's leg,
  and each session median as a share of its budget:

<!-- asserting:begin -->
| Commit | Browser | Leg load | startup (% of budget) | startupLibrary (% of budget) | experimentsList (% of budget) | experimentDetail (% of budget) | compare (% of budget) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `baf3cd4` | chromium | 35.3 -> 34.8 | 298.9 (52 %) | 275.5 (46 %) | 158.2 (45 %) | 90.3 (43 %) | 138.9 (45 %) |
| `baf3cd4` | firefox | 34.8 -> 26.7 | 467 (32 %) | 449 (32 %) | 306 (36 %) | 88 (30 %) | 148 (34 %) |
| `baf3cd4` | webkit | 26.7 -> 28.6 | 389 (50 %) | 338 (43 %) | 290 (52 %) | 93 (52 %) | 141 (49 %) |
| `e5fb470` | chromium | 35.2 -> 39.5 | 316.6 (55 %) | 276.1 (46 %) | 160.7 (46 %) | 101.8 (48 %) | 143.3 (46 %) |
| `e5fb470` | firefox | 39.5 -> 39.3 | 478 (32 %) | 605 (43 %) | 535 (64 %) | 168 (58 %) | 188 (44 %) |
| `e5fb470` | webkit | 39.3 -> 34.7 | 364 (47 %) | 357 (46 %) | 273 (49 %) | 91 (51 %) | 143 (49 %) |
| `1e1bf20` | chromium | 24.5 -> 25.1 | 333.9 (58 %) | 339.2 (57 %) | 202.1 (58 %) | 102.2 (49 %) | 158.4 (51 %) |
| `1e1bf20` | firefox | 25.1 -> 31.8 | 598 (40 %) | 922 (65 %) | 814 (97 %) | 239 (82 %) | 316 (73 %) |
| `1e1bf20` | webkit | 31.8 -> 35.4 | 452 (58 %) | 453 (58 %) | 335 (60 %) | 99 (55 %) | 147 (51 %) |
| `103d5c0` | chromium | 34.8 -> 31.2 | 298.8 (52 %) | 254 (42 %) | 153.4 (44 %) | 91.6 (44 %) | 141.9 (46 %) |
| `103d5c0` | firefox | 31.2 -> 38.6 | 1282 (87 %) | 652 (46 %) | 421 (50 %) | 105 (36 %) | 181 (42 %) |
| `103d5c0` | webkit | 38.6 -> 35.5 | 358 (46 %) | 392 (50 %) | 278 (50 %) | 85 (47 %) | 135 (47 %) |
<!-- asserting:end -->

  All of them passed every check. In the session on `1e1bf20`, at a lower load than any
  measuring session, the Firefox list took 814 ms against a budget of 840 ms (samples 687 to
  1101 ms), about twice its median over the measuring sessions, with the detail, Compare and
  the start over the library also 1.3 to 1.7 times theirs. In the session on `103d5c0` the
  Firefox start took 1282 ms against 1480 ms (samples 658 to 2848 ms) while everything over
  the library was at or below its median. In the session on `baf3cd4` Firefox was faster
  than in any measuring session. Firefox session medians of this page on
  this machine therefore range over a factor of about 2.7 between sessions that are not
  outliers (306 to 814 ms for the list), and the recorded 1-minute load does not order them;
  an earlier version of this document attributed the spread to the host, which the
  lower-load session contradicts. The Firefox budgets, the list's above all, can fail
  on ordinary variation between sessions. They were not widened: a rule that admits the
  slowest session holds nothing, and what would settle it is more sessions on a machine
  whose load is controlled.
- They are medians of one machine. They say nothing about a phone or a five-year-old laptop,
  and nothing here claims they do.

## Why the suite is not in the release gate

`npm run test:perf` is a diagnostic. It asserts its budgets and exits 1 when one is exceeded,
but `release-gate`, `test:release`, `verify`, `test:browser` and the workflows under
`.github/workflows/` do not run it, and `tests/unit/v4-performance-docs.test.mjs` holds that
(it reads those scripts and every workflow file).

- The budgets are wall-clock medians of one development machine. The CI runners are
  different hardware with fewer cores; the same budgets there would either fail for no reason
  or, widened until they pass, hold nothing. Budgets for the runners would have to be measured
  on the runners, which this change did not do.
- Even on the machine they come from, one Firefox session in six exceeded them under load,
  and a later one came within 3 % of the list budget at a lower load (above). A gate that
  fails one time in six without a code change teaches people to repeat it until it passes.
- What does not depend on the machine is gated: the unit test fails when `oscilla:ready` is
  not marked exactly once directly before `html[data-ready]`, when the committed dist does
  not carry the mark, when a measurement is not what the recorded sessions give, when a
  budget is not the rule applied to its measurement, when this document and the recorded
  sessions disagree, or when a selector, element id or field of the Experiments state that
  the suite reads (`tests/browser/fixtures/perf-dom.json`) is no longer in `src/`. The last
  one matters because nothing runs the suite automatically: without it a renamed selector
  would only be noticed by the next person who measures.

What would let it join: budgets measured on the CI runners over enough sessions to know their
spread, or a measure that does not depend on wall time (for example a count of bindings
evaluated per interaction, or of bytes hashed per open).

## Measuring again

```bash
npm run build
node tests/browser/perf-budgets.cjs --measure-only --json session-1.json   # six times
node tests/browser/fixtures/perf-sessions.mjs --new --measured session-*.json
npm run test:perf -- --json assert.json                                   # asserts the budgets
node tests/browser/fixtures/perf-sessions.mjs --asserting <commit> assert.json
```

`--measure-only` runs every check and reports every number without judging the budgets.
`perf-sessions.mjs` records the sessions' samples in `perf-sessions.json` and rewrites
`perf-budgets.json` and the tables above from them (without arguments: from what is already
recorded); the unit test refuses any other combination. The rule's factor is the `rule` of
`perf-budgets.json`. The library is cached under the system temporary directory by a digest
of `src/js` and the fixture, and is rebuilt (about a minute) when either changes.
