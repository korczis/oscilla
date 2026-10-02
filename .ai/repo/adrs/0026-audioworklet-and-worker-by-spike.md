---
schema: adr/v1
id: adr-0026
kind: adr
title: AudioWorklet capture and Worker DSP are adopted only on the evidence of a recorded spike; the native graph and main thread stay the default
status: proposed
date: 2026-10-02
tags:
  - audio
  - performance
  - dsp
  - v3
provenance:
  origin: authored
---

# 26. AudioWorklet capture and Worker DSP are adopted only on the evidence of a recorded spike; the native graph and main thread stay the default

## Context

V3 needs sample-accurate PCM capture of tens of seconds and offline FFT work on arrays of up to
2²¹ points (ADR 0018, ADR 0021). The application has no AudioWorklet or Worker today; the build
already supports embedding one (`?raw` imports) and `verify-dist` allows only `data:` or `blob:`
sources (ADR 0012). Evidence collected so far: Chromium cannot load a worklet module from a
`blob:` URL on a `file://` page while a `data:` URL loads; Firefox delivers empty worklet inputs
while upstream is silent; ScriptProcessor drops buffers in Firefox; the test tap needs zero
filling and frame indexing (ADR 0006, `knowledge/curated/audio-measurement-pitfalls.md`). V3
specification §79-§83, §124 and §170-§171 ask for evaluation, not migration. WASM is out of scope
unless a benchmark demands it.

## Decision

Proposed:

- Spike before adoption (issue V307). For capture, compare an AudioWorklet recorder (frame
  indexed, zero-filled, posting transferable chunks) against ScriptProcessor and MediaRecorder
  (encoded by default, so it needs decoding); for analysis, time the offline DSP on the main
  thread against a Worker.
- Measure and record per browser (Chromium, Firefox, WebKit) under `file://` and the Pages
  sub-path: load success from `data:` and `blob:`; dropped or discontinuous frames over a 40 s
  capture; timing stability; main-thread blocking during analysis of 10 s and 20 s sweeps at
  48 kHz and 96 kHz; added bytes to `dist/index.html`.
- Adopt the worklet for capture if it records 40 s without a discontinuity in every target
  browser under `file://` and the Pages sub-path; otherwise use the candidate that does and record
  why. Adopt a Worker for analysis if main-thread analysis blocks for more than about 200 ms
  (§170) on the benchmark; otherwise keep analysis on the main thread.
- Whatever is adopted is embedded source, loaded from a `data:` URL on `file://`; a `blob:` URL is
  used only where the spike proves it loads on `file://` in every target browser.

## Alternatives rejected

- Migrate the engine to AudioWorklet DSP now: rewrites the verified V1/V2 engine (ADR 0015)
  without evidence of a problem it would solve.
- Rule out worklets and workers: ScriptProcessor is deprecated and lossy in Firefox, and long
  analyses would freeze the UI.

## Consequences

- Until the spike reports, capture and analysis designs keep a seam (capture returns a `Capture`
  object; analysis is pure functions on plain arrays) so either execution context can host them.
- The spike's results are recorded as evidence and knowledge; this ADR is then revised to state
  what was adopted, or rejected, and why.
- If a `blob:` loader is adopted, rule `project.single-file-deliverable` v2 (which says worklets
  use `data:` URLs) needs a new version first.
