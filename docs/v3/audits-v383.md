# V383 — final science, UX, expert, performance, memory and file:// audits (spec §237–§242)

Three Claude auditors, none of whom wrote the code under audit, worked from main at 34f967a
against the committed `dist/index.html`. The science auditor read the code paths and proved
defects through the real modules in Node. The UX and expert auditor drove the page in Playwright
at 1536x1024 and 390x844. The performance auditor used headless Chromium over file://, with a
long-task observer, frame timing, heap snapshots, a FinalizationRegistry on every AudioNode,
wrapped Worker and AudioWorkletNode constructors, WeakRefs on getUserMedia tracks, listener
accounting and IndexedDB counts. Every defect was fixed in a PR with a test that fails on the old
code, or is listed below as open, with the reason. No stored number changed, so no algorithm ID
was minted (ADR 0024).

## Defects found and fixed

| § | Defect (observed) | Fix | PR |
|---|---|---|---|
| 237 | Live RTA with a frequency profile and a level calibration drew 94.0 dB SPL; the bar text and summary said 92.0 dB SPL (profile offset re-added without the profile) | the view text uses the same profile-aware offset as the frame | #65 |
| 237 | Input panel "Levels" said CALIBRATED for a calibration taken with another input, while the header said UNCALIBRATED | the row follows the same applicability as the header | #65 |
| 237 | Live FFT trace coloured CALIBRATED across its whole span when a profile was loaded, including bins the profile does not cover | covered bins drawn calibrated, the rest observed | #65 |
| 237 | Live RTA on a newly selected input, not yet checked, applied the previous input's level offset | an unchecked input gets no level calibration | #65 |
| 237 | "Strongest bin 23.4 Hz" with 5.86 Hz bin spacing (3 significant digits, not the resolution) | printed to the local bin resolution | #65 |
| 237, 239 | "None (RAW)" and the CSV "RAW (unsmoothed)" were 1/48-octave band power means of the analysis grid | RAW names its grid ("1/48-octave bands"); the smoothing label and CSV view line say so | #66 |
| 237 | A smoothed and normalized response said only "normalized" in its summary and cursor readout | both are named | #66 |
| 238 | "Save experiment" disabled with no stated reason | the reason in `title` and a described-by text | #66 |
| 239 | Expert table "Repeatability 0.0 dB" beside the reason "within ±0.1 dB"; under the v4 MAD rule the table showed the raw MAD labelled SD | the table shows the judged value, rounded as the reason rounds it | #66 |
| 241 | Every saved, renamed or opened experiment stayed decoded for the page's lifetime: +2.16 MB of ArrayBuffer data per saved 10 s experiment (heap snapshots 2.76 → 9.56 MB over three saves) | cache holds the experiments on screen plus the 4 most recent, LRU out | #67 |
| 237 | Clipping "NONE" read as no clipping at all; only digital full scale is checked | the detail says analog/AGC clipping before the converter cannot be seen | #68 |
| 238 | "Lower the input gain" with no input gain control in OSCILLA | says where the gain is (OS sound settings or audio interface) | #68 |
| 238 | Stimulus panel "averaged: mean" while the setup select says "Mean (power)" | "power mean" / "median" | #68 |
| 237 | Compare overlay named a multi-run curve "RAW · OBSERVED" (one run) | "<method> of N runs", as the response view names it | #68 |
| 237 | About: "Levels: relative, never calibrated sound pressure" contradicted the V3 SPL path | "Relative (dBFS); dB SPL only with a level calibration in MEASURE" | #68 |
| 238 | Clicking an experiment's name did nothing; only "Open" opened it | the name opens it; Open stays the keyboard path | #68 |

## §237 science: verified correct

- No "dB SPL" without a valid level calibration anywhere (enforced by `v3-ui` no-spl and G10).
- Frequencies are printed to the local resolution in the response, IR and quality views
  (format.js); estimates are marked as estimates.
- Measurement texts describe the whole chain, not a speaker response.
- Hearing data carries its basis and alternatives (bioacoustics.js); no universal hearing limit.
- Every quality status is shown with its reasons; FREQUENCY_CALIBRATION claims "whole range" only
  at full coverage.
- CALIBRATED only where a profile covers (response, compare, live RTA after #65).
- SMOOTHED and NORMALIZED are labelled in series, badges, summaries and readouts (after #66).
- CSV keeps ratio and SPL columns apart; noise level is relative only; IR normalization is labelled.

## §238 UX: journey without documentation

At 1536x1024 and 390x844 a new user reached Measure, saw the sweep, ran the setup check (READY in
about 0.5 s on the fake mic), measured over loopback to COMPLETE, read a quality headline with
"Main issue" and plain-language reasons, and saved the experiment. No horizontal overflow on the
phone. Failure paths (full-scale background, denied mic) end with a readable recovery step.

## §239 expert transparency

Sample rate (Input panel and Expert), smoothing (select, default RAW), RAW labels, calibration
badges and reasons, the full quality metrics table, algorithm IDs (transfer, IR, align, clip,
aggregate, quality, discontinuity), master-gain note and provenance (config hash, result hash,
build version, repeat-of) are on screen or in the `.oscilla.json` export, which also carries the
transfer and IR FFT sizes, bin spacing and resolution.

## §240 performance (headless Chromium, file://)

| Scenario | longest task | p95 / max frame | frames ≥ 200 ms |
|---|---|---|---|
| Idle (Playground 10 s, Measure 5 s) | 0 | 16.8 / 16.8 ms | 0 |
| Spectrogram with a tone, 10 s | 0 | 16.7 / 16.8 ms | 0 |
| Live RTA, 10 s (606 frames) | 0 | 16.8 / 16.8 ms | 0 |
| Analyzer mic, 10 s | 0 | 16.8 / 16.8 ms | 0 |
| 10 s sweep measurement | 52 ms | 16.8 / 33.4 ms | 0 |
| IR tab render | 0 | 16.8 / 16.8 ms | 0 |
| 5 repeats × 10 s, mean (68 s, heap peak 23.1 MB) | 0 | 16.7 / 33.3 ms | 0 |

No pathological freeze on the default (Worker) path.

## §241 memory

After 30 unsaved measurements the audio nodes alive stayed at 14, net listeners flat, heap flat
after warm-up (heap-snapshot diff: nothing retained by the app). Every analysis Worker was
terminated, every capture AudioWorkletNode disconnected with its port closed, every MediaStream
track stopped (after live RTA, setup check, abort by Escape, Stop, pagehide or leaving the
workspace). IndexedDB grows only on an explicit save (about 2.95 MB for a 10 s experiment). The
one leak, decoded saved experiments, is fixed by #67.

## §242 file://

Playground tone and stop; Analyzer mic and spectrogram; Measure setup check, run, save and the
noise-check RTA; experiment export (`.oscilla.json` and CSV), refusal of a duplicate import and
re-import after delete, surviving a reload; calibration CSV import; live RTA over test-context
loopback with no getUserMedia call; persistent IndexedDB; denied, overconstrained, not-found,
not-readable and unsupported mic errors end INVALID with readable text and no open track.

## Open, not fixed (with reasons)

- **Inline analysis fallback blocks the main thread** for up to 480 ms per step (4 frames ≥ 200 ms
  over 3 × 10 s) when no Worker can be created. The default path builds the Worker from a data:
  URL and works over file:// and Pages; the fallback yields between steps but not inside one
  deconvolution. Low priority.
- **Busy, overconstrained and missing devices share NO_INPUT** ("no input signal"); a separate
  "device busy" reason would read better. Minor.
- **A manual level calibration saved before any input is known** binds to no device and applies to
  every input. It is the user's own statement, labelled as manual; binding it needs a product
  decision.
- **A level calibration taken in TEST CONTEXT loopback** can show dB SPL on a digital loop; the
  conditions are prefixed TEST CONTEXT and the binding voids it for a real microphone.
- **Sweep range and duration** are under "Measurement setup", below the result (collapsed on the
  phone); the Stimulus panel shows them without a link to change them. Layout change, deferred.
- **Raw per-run magnitudes and audio are not exported**; the export carries the aggregate and
  per-run capture metadata. **Commit is unknown in a local file:// build** by design; only the
  Pages deploy stamps it.
- **The V2 Analyzer "Microphone (live)" trace** is time-smoothed by the AnalyserNode (0.5) without
  saying so; V2 lab, outside MEASURE.

## Release readiness

`npm run release-gate` passed (exit 0) on main at d13ccd6 with #65–#68 merged: unit 2139 pass,
0 fail; every browser suite in Chromium, Firefox and WebKit over file:// and http; the visual,
MEASURE and STUDIO references. The Pages deployment of d13ccd6 passed verify-deploy.
