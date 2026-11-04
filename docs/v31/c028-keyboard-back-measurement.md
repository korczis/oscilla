# C028: keyboard Back in WebKit, measured (2026-11-04)

Plan issue C028, slice 2. Slice 1 (`test/c028-round-trip-diagnostics`, 17883bda) made every
round-trip failure in `tests/browser/cross-links.cjs` print the last state it read: workspace,
hash, `focusTag`, `focusOsc`, `focusBody`, `headingOf`. This note records what those checks
did when run many times on that commit, before anything is called a flake or a defect.

## Result

**No failure reproduced.** 31 runs, 124 WebKit checks, 0 failures; no product code and no
predicate or deadline is changed by this slice.

| Platform | Engine | Runs | Origins | Checks run | Failures | Load during the runs |
| --- | --- | --- | --- | --- | --- | --- |
| linux/amd64, CI image | WebKit 26.6 | 20 | file, http | 80 | 0 | 0.08-3.77 (container, 6 CPUs) |
| darwin (shared Mac) | WebKit 26.6 | 11 | file, http | 44 | 0 | 7.54-28.72 (18 cores) |

A check is one of the two below on one origin; each runs three input legs (pointer, keyboard,
touch), so the keyboard leg of each check ran 62 times (31 per origin), 124 keyboard round trips
in all, and none missed. With zero failures in n trials the 95 % upper bound on the rate is about
3/n: below 15 % per check and origin in the linux container (n = 20), below 2.5 % for a keyboard
round trip across both checks, origins and platforms (n = 124). The rate oscilla-21 saw (1 in 3
runs of learn-demo-back on darwin at load 13-33) would leave all 11 darwin runs green with
probability (2/3)^11, about 1.2 %; the darwin runs here covered loads 7.5-28.7, the upper half
of that range in runs 6-10, while the linux container ran alongside.

## What was run

The command C028 names, on the slice 1 commit (app: `dist/index.html` as on d0e5fec1, the slice
changing only tests), Playwright 1.63.0:

```bash
node tests/browser/cross-links.cjs --browsers webkit --origins file,http \
  --only studio-back,learn-demo-back
```

- linux: 20 consecutive runs in `mcr.microsoft.com/playwright:v1.63.0-noble`,
  `--platform linux/amd64 --ipc=host -e CI=1` (the CI image and its 44.1 kHz), 2026-11-04
  23:10-23:32 UTC, about 60-80 s a run.
- darwin: 11 runs (one, then ten consecutive), private `TMPDIR` each, `OSC_LOAD_MAX=20`
  (the suite waited for the load where needed), 2026-11-04 23:09-23:17 UTC.

Every run printed `ALL PASS (6 checks passed)`: studio-back, learn-demo-back and no console
errors on each origin.

## The two checks

- `studio-back` (P8): Expand in the Sequencer's compact Studio, then Studio's Back button; the
  check waits (`NAV_MS`, 10 s) for the Sequencer with focus not on `<body>`, then history Back
  (Studio, its heading focused) and Forward (the Sequencer, its heading focused). The failure in
  merge train 3 (#404, run 41582489422 at 8849bc27, webkit/file) was this keyboard leg.
- `learn-demo-back` (one-way link 2): a Learn demo opens the Playground; its notice's "Back to
  the lesson" returns to Learn with the heading focused; history Back must return to the
  Playground with its heading focused. oscilla-21's failure was this last step
  ("keyboard: Back did not return to the demo").

## What this decides, and what it does not

C028's criteria split on the printed state: focus on `<body>` or no control after the round
trip is a product defect (fix the Back path's focus hand-off), anything else corrects the
predicate or deadline. Neither branch has evidence here: no failing state was printed, so
neither a focus-restore defect nor a too-tight predicate is shown, and changing either would
be a guess. Both earlier failures predate the diagnostics, so their state is unknown.

What stays open:

- The next failure in CI or on a lane now prints its state (slice 1); that state, not this
  note, decides between fix(nav) and a predicate change.
- ADR 0045's Focus paragraph names Back, Forward and links (focus to the workspace heading)
  and nav clicks (focus stays on the pressed control). It does not name a control that
  disappears with its view. Today `studioBack()` (`src/js/ui/studio/workspace.js`) focuses the
  compact Studio's Expand, else the active nav tab, one animation frame later unless focus is
  already on a shown control, and the
  `studio-back` predicate asks only that focus is not on `<body>`; the demo notice's action is
  a link, so it falls under the heading rule. Whether the Studio Back button falls under the
  heading rule, or the ADR gains the case, is C028's remaining contract question.
- C028's last criterion (20 consecutive linux WebKit passes after the change) is met by the
  linux series above for the slice 1 commit; a later change to either check must repeat it.
</content>
</invoke>
