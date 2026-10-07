---
schema: adr/v1
id: adr-0049
kind: adr
title: The raw capture lives only for its analysis; a run stores derived results
status: proposed
date: 2026-10-07
tags:
  - measurement
  - privacy
  - experiments
  - storage
  - v4
related:
  - file:.ai/repo/adrs/0019-recipe-versus-experiment.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md
  - rule:project.no-fake-science
  - file:src/js/measurement/engine.js
  - file:src/js/measurement/analysis-task.js
  - file:src/js/measurement/impulse-response.js
  - file:src/js/ui/measure-experiment.js
  - file:src/js/experiments/validate.js
  - file:src/js/experiments/evidence.js
  - test:tests/unit/raw-retention.test.mjs
  - test:tests/unit/v3-engine.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/v4/completion-ledger.md
    - file:docs/specs/oscilla-v3-measure.md
---

# 49. The raw capture lives only for its analysis; a run stores derived results

## Context

The v4 completion ledger lists "Raw data retention" as MISSING: the engine has a `keepRaw`
option and nothing states what happens to a recording. The V3 MEASURE specification asks for
transient capture "unless explicitly saved" (§87), local microphone data with derived results
stored by default (§88) and an optional SAVE RAW CAPTURE with a size warning (§89). The product
never offered §89. The evidence checklist (ADR 0044) already reads "Raw capture retained: not
retained (OSCILLA stores the derived result, not the raw capture)", and the README said the
recording "is released after analysis".

Checking that sentence against the code found it untrue in one respect. The engine awaited
every capture through `guard()`, a `Promise.race` against the session's abort promise, and
hung the analysis abort on that promise too. A completed session never settles it, so each
reaction kept the value it resolved with reachable: the noise capture and every run capture
stayed in memory after `measure()` resolved, until the next measurement replaced the session.
With the analysis Worker (the built page) the run and noise buffers are transferred and only
detached views were held; on the inline path (the Worker fallback, node) the PCM itself was.
Nothing was stored or exported; it was held in memory longer than stated.

A second fact the README did not say: the stored impulse response is derived from the
recording, but it is not an anonymising transform. `results.ir.samples` is the causal part of
the regularized deconvolution of one run's whole capture, `len(capture) − start` samples
(capped at `IR_MAX_SAMPLES` = 2^21), so convolving it with the stimulus rebuilds the in-band
capture at those lags. For an exponential sweep a component at frequency f captured at time t
lands at lag t − t_sweep(f) (Farina 2000); the stored IR keeps lags ≥ start ≥ 0, so a sound in
the room lands in it when it was picked up after the sweep had passed its frequency: in the
post-roll (1.5 s by default) almost entirely, during the sweep in part, before it not at all.

## Decision

Proposed:

- **In memory, during a run.** The engine holds each capture (the background-noise check and
  every run, Float32 PCM at the context rate) from the moment the io returns it until its
  analysis no longer needs it. With the Worker the captures are transferred to it and are gone
  from the page thread when the analysis starts; inline they are dropped when the analysis
  returns. When `measure()` resolves (COMPLETE or INVALID), rejects (ERROR) or is aborted,
  nothing in the engine references a capture any more. Their size is bounded by the contract
  limits (sweep ≤ 30 s, repeats ≤ 10, capture ≤ 40 s per run, all captures together ≤
  `maxRawBytes` = 128 MiB).
- **`keepRaw`.** `measure(recipe, { keepRaw: true })` returns the captures as `runs[i].raw` and
  `noise.raw`, untransferred. No product path calls it: it exists for tests (the browser
  residual check). Even then only the caller's result holds them, and they go when the caller
  drops it. §89's SAVE RAW CAPTURE is not offered; adding it needs its own decision (format,
  size warning, consent, export).
- **Persisted.** Nothing raw. A saved experiment (`experimentFromResult`) keeps the recipe and
  definition, the input facts (device label and a one-way hash of its id), the applied
  calibration, the per-run facts (frames, sample rate, alignment lag and peak correlation,
  clipping ratio), the quality assessment and the derived results: `results.transfer`, the
  aggregate of repeated runs, optional per-run transfers, and the impulse response of the
  representative run. `validate.js` rejects unknown fields, so the store (which validates on
  put) and an import refuse a record that carries a raw array anywhere.
- **Exported.** An experiment file is the stored record in its portable form
  (`sanitizeForExport`, `experimentToJson`), the same derived arrays and no more; the CSV
  exports are the transfer, aggregate, impulse response and RTA tables. No export contains a
  capture.
- **What the impulse response carries.** It is derived data that can still carry sound the
  microphone picked up, as described above. The product says so where a run is saved (MEASURE,
  Experiment panel), in About and in the README, and asks the user to check an exported file
  before sharing it.
- **Why.** Privacy: microphone audio never leaves the page, and keeping a recording nobody
  asked for, even in memory, is a retention the user did not choose. Size: a 10 s sweep at
  48 kHz with its pre- and post-roll is about 2.3 MB of PCM per run, 10 runs of the longest
  recipe about 77 MB, against about 20 kB of encoded response and 26 kB of aggregate for a 2 s
  sweep of three runs (the impulse response is as long as one capture, 131 998 of 132 000
  samples in the test fixture, but there is one per experiment). Immutability: a completed run is stored once and never changed
  (ADR 0040), so a raw field could never be removed from a run later without breaking that
  rule; leaving it out is the decision that keeps the option open without a record that
  contradicts it.

## Consequences

- `engine.js` keeps a set of kill callbacks per session that holds only what is still pending
  (a guard's rejection until its value settles, the analysis abort until the analysis ends);
  the abort promise is gone. Abort and error behaviour is unchanged (`tests/unit/v3-engine`).
- `tests/unit/raw-retention.test.mjs` pins the policy: WeakRefs to the io's capture buffers and
  a forced collection prove that nothing references a capture after `measure()` resolves,
  aborts or fails, with or without `keepRaw` (the test failed on the base for both resolved
  cases); a
  saved experiment and its export carry only derived arrays and no `raw` field; validation
  refuses a record with a raw array; and a voice in the post-roll is rebuilt from the stored IR
  (r > 0.99) while one before the sweep is not (|r| < 0.1).
- Whether to store a shorter impulse response, which would carry less room sound but give up
  the long tail kept "for later ETC / Schroeder / RT60 work" (impulse-response.js), is not
  decided here: it changes a scientific result and its hash, and is the owner's call.
