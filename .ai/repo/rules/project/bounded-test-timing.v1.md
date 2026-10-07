---
id: project.bounded-test-timing
version: 1
kind: rule
title: Browser timing checks measure OSCILLA, not the host
description: A browser check waits for the condition it judges against a wall-clock deadline that names it, takes every frame window from the context's sample rate, and never sleeps for a fixed time in place of a product condition.
statement: Every wait in tests/browser is a condition poll through tests/browser/lib/wait.cjs, with a wall-clock deadline that names the stalled check on expiry, and its ending predicate is the predicate the assertion judges. No fixed sleep stands in for a product condition, in the suite or in the page, and every page.evaluate is bounded. No frame window or tolerance is a fixed count or a 44100/48000 literal outside an OfflineAudioContext or WAV render rate. Each exception carries `// timing-allow: <reason>`.
status: active
class: blocking
depends_on: []
tags: [tests, browser, timing, ci]
---

# Rationale

A browser check that waits a fixed time, or counts frames at an assumed rate, passes or fails
with the machine it runs on. Each of these was observed:

- #153: `untilAudio()` and `gone()` in `engine-v1port.cjs` followed only the audio clock, and
  a `page.evaluate` whose page function never returned had no bound at all. A stalled
  AudioContext held the WebKit leg until the CI job was killed, with no check named.
- #157: the periodicWave check read the carrier a fixed 100 ms after the change and failed
  2 runs in 10 on a starved host.
- #146 and #35: fixed 150 ms sleeps in front of an assertion.
- 2026-10-03: the V3 after-abort check scanned a fixed 280 frames. That is 6 ms at 48 kHz and
  longer at the 44.1 kHz of the CI browsers, long enough to reach the next sweep's fade-in
  in all three browsers.
- #133 and #116: a poll ended on a predicate looser than the assertion that followed it, so
  the race moved from the wait into the assertion.

`project.audio-engine-discipline` forbids assuming 48 kHz in `src/`; nothing held the tests to
the same.

# Required behaviour

- A wait is `until(pred, { ms, what })` from `tests/browser/lib/wait.cjs`: `pred` is the
  condition the following assertion judges, `ms` a wall-clock deadline and `what` the name of
  the check, which the timeout carries together with the last value read. `bounded(promise,
  { ms, what })` puts the same deadline on any promise. Neither accepts a wait without a
  deadline or a name.
- No fixed sleep stands in for a product condition. A fixed sleep is `page.waitForTimeout`,
  a promise whose executor only arms `setTimeout` with its own resolve (run by the suite or
  by the page through `page.evaluate`, awaited where it is made or later), `setTimeout` of
  `timers/promises`, and a call of any helper that wraps one of these.
- A sleep is the period of a poll only when its innermost enclosing loop is a `while`, a
  `do` or a `for` whose own condition reads `Date.now()` or `performance.now()`, or which is
  left by a `break`, `throw` or `return` guard on such a reading directly in its body. A
  loop over a collection (`for … of`, `for … in`) or over a count is never a bounded poll,
  whatever its body measures: each iteration takes as long as the host makes it.
- A loop that waits (it awaits, or reads `currentTime`) carries a wall-clock deadline of the
  same kind. The audio clock alone is not one: a stalled context never advances it.
- `page.waitForFunction`, `waitForSelector`, `waitForEvent`, `waitForLoadState`,
  `waitForURL`, `waitForResponse`, `waitForRequest` and a locator's `waitFor` state their
  `timeout` as a key of the options argument written at the call, and not as the literal
  `0`, which in Playwright disables the timeout.
- Every `page.evaluate`, `page.evaluateHandle`, `page.$eval` and `page.$$eval` is bounded. A
  suite gets that by taking playwright from the harness (`project.suite-harness`), whose
  pages reject such a call that has not answered within `OSC_EVALUATE_MS` and name the page
  function.
- A frame window is seconds times the context's `sampleRate` (`frames(seconds, sampleRate)`
  and `anchor(ctx, leadS)` in `wait.cjs`), never an integer literal. `44100` and `48000`
  appear only where the test sets the rate itself: an `OfflineAudioContext`, a WAV render, or
  the value of a `sampleRate:` / `sr:` property handed to a renderer or an analysis.
- A deliberate exception (a hold that is the stimulus, a dwell before a stop under test, a
  manual diagnostic) carries `// timing-allow: <reason>` on its line, or on a line directly
  above that holds only that comment. The reason says what the wait is, in at least three
  words; a marker without one is itself a finding.

# Enforcement

`tests/unit/browser-timing.test.mjs`, run by `npm test` (so by `npm run verify`, the release
gate and the CI `unit` job). Its failures start with `project.bounded-test-timing:`.

- "tests/browser holds no timing finding beyond its recorded debt" scans every `.cjs`, `.mjs`
  and `.js` file under `tests/browser` (entry suites, the harness and the fixtures pages run)
  with `tests/browser/lib/timing-scan.cjs` and fails with `file:line: [kind]` for each new
  finding. The kinds: `fixed-sleep`, `timer-sleep`, `counted-poll`, `unbounded-loop`,
  `unbounded-wait`, `raw-playwright` (a file that requires playwright itself, so its
  `page.evaluate` has no bound), `fixed-frame-window`, `fixed-rate` and `empty-allow`.
- The scan's own cases are in the same file, one or more tests per kind: a sleep in each
  spelling above, in the page and through `timers/promises`; a helper followed to its calls
  through a wrapper, through a second helper and from one file of the tree to another; a
  sleep in a `for … of` loop that only measures a duration; `timeout: 0`; a marker of fewer
  than three words; and that strings, comments, templates and regular expressions are not
  read as code. The waits of `wait.cjs` are tested there too: the deadline is wall time, it
  ends a predicate that never answers, and the timeout names the check.
- "mutation: each forbidden wait added to dsp.cjs is reported with its line" reads
  `tests/browser/dsp.cjs` from disk, appends one forbidden line at a time (nine of them,
  one per shape above) and requires `tests/browser/dsp.cjs:<last line>: [kind]`; the same
  line with a reasoned marker is required to pass.
- "every timing-allow marker of tests/browser gives its reason, printed for review" prints
  each marker with its file, line and reason as a test diagnostic.

What the mechanism does not decide, stated so nothing above is read as more than it is:

- Debt. The findings that predate this rule are recorded in
  `tests/browser/timing-baseline.json` as a count per file and kind: fixed sleeps through
  the suites' own `sleep()` helpers, count-bounded polls, one `|| 48000` fallback, and the
  findings of `v3-ui.cjs`, which another change owned when the rule landed. The test fails
  when a count rises; it prints, and does not fail, when a count falls, so that a change
  which removes a sleep needs no second file. The scan's command line (in
  `tests/README.md`) prints what it finds beyond the record, and with `--write-baseline`
  lowers the record and never raises it. `fixed-sleep`, `unbounded-loop` and `empty-allow`
  can never be recorded as debt;
  `raw-playwright`, `unbounded-wait` and `fixed-frame-window` only for `v3-ui.cjs`.
- Paid debt is headroom until the record follows it down. In a file whose count fell below
  its record, that many new findings of the same kind pass. Nothing lowers the record but
  `--write-baseline`, run by whoever removes the sleep or by a later change.
- The record is a file, and a hand edit can raise a count of `timer-sleep`, `counted-poll`
  or `fixed-rate`. No test compares it with an earlier commit; a raised count is a line of
  the diff that a reviewer reads.
- Within a file that carries debt of a kind, the scan cannot tell which finding is new: it
  lists them all with the two counts. Two findings of one kind on one line count once.
- A function that sleeps and also does something else is one finding, at its sleep, however
  often it is called. Only a function that does nothing but sleep is followed to its calls.
- A helper is followed by name. One brought in from outside `tests/browser`, or called
  through an alias (`const z = nap`), is not seen, except under the names `sleep`, `delay`,
  `pause`, `nap` and `snooze`, which count as a sleep wherever they are awaited.
- "The ending predicate is the predicate the assertion judges" is not machine-checked. The
  scan sees that a wait is a bounded poll, not what it polls for; a reviewer reads that.
- Whether a `timing-allow` reason is a good one. The scan counts three words; the test
  prints every marker so that a new one is seen.
- A `timeout` given as a name (`{ timeout: T }`) is taken as stated; its value is not traced.
- Only the page's own `evaluate`, `evaluateHandle`, `$eval` and `$$eval` are bounded. A
  frame, a worker, a locator and an element handle keep Playwright's unbounded evaluate, and
  the scan does not look for them.
- `fixed-frame-window` reads `.subarray()`, `.slice()` on a receiver that is not recognisably
  text, and `for` loops that index with their counter. A window held in a named constant
  (`const N = 280`), built in a `while` loop or built another way is not seen, and a count
  of bins, pixels or notes in one of the shapes it reads is reported as if it were frames;
  the message says to mark it. `fixed-rate` reads the literal spellings of 44100 and 48000,
  not `48 * 1000`, and accepts a literal by the statement around it (any statement that
  mentions an offline or WAV render), not by tracing where the value goes.
- The scan reads `tests/browser` only. Playwright scripts under `scripts/` (the visual gate)
  are outside it.

# Failure behaviour

`npm test` fails and names the rule, the file, the line and the kind. The fix is the wait: poll the
condition with `until()`, or mark a deliberate exception with its reason. The baseline is not
a place to put a new finding.
