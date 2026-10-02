---
schema: adr/v1
id: adr-0018
kind: adr
title: Measurement results come from captured PCM through deterministic offline DSP; the live analyser is feedback only
status: proposed
date: 2026-10-02
tags:
  - measurement
  - architecture
  - v3
provenance:
  origin: authored
---

# 18. Measurement results come from captured PCM through deterministic offline DSP; the live analyser is feedback only

## Context

V2's analysis is AnalyserNode → chart: a frame polled from the main thread, Blackman-windowed at a
fixed FFT size, smoothed or not, and gone the moment it is drawn. Polled analysers miss frames
under load (`knowledge/curated/audio-measurement-pitfalls.md`), so a value depends on which frame
happened to be visible, and nothing can be recomputed, repeated, compared or audited later. V3
(specification §11-§13, §84-§85, §248) must answer what the playback/capture chain did, with
provenance, from the same input every time. Not yet implemented; the layer contract is
`docs/v3/architecture.md` on `feature/v3`.

## Decision

Proposed:

- Generation and measurement are separate layers: Stimulus → Output → physical system → Input →
  Capture → Calibration → Analysis → MeasurementResult → QualityAssessment → Experiment.
- A measurement renders its stimulus from one canonical, Nyquist-clamped specification, plays it
  through the existing engine and master chain (ADR 0015; not bypassed, ADR 0002), and captures a
  bounded mono PCM buffer with pre- and post-roll. At conservative measurement levels the
  compressor and ceiling are transparent; their lookahead delay is absorbed by alignment.
- Final results are computed offline from the captured buffer and the rendered stimulus by pure
  functions (plain data in, plain data out; no DOM, no Web Audio, no clock reads), after
  cross-correlation alignment, since capture never starts with output. Equal inputs give equal
  results.
- The result is a structured object (transfer, impulse response, RTA bands, quality, provenance)
  independent of any chart. Charts and UI adapters render it and own no scientific state.
- AnalyserNode stays for live feedback (level, live spectrum, preflight) and is never the sole
  source of a stored result.
- Orchestration lives in a measurement engine with an explicit state machine (IDLE … COMPLETE,
  INVALID, ABORTED, ERROR) outside Alpine; abort cleans stimulus nodes, capture, buffers and
  timers in every state.

## Alternatives rejected

- Results from AnalyserNode frames (V2 style): not reproducible, resolution fixed by the node,
  frames missed under load.
- A separate measurement engine with its own output chain: duplicates generator and safety logic
  and could bypass the output ceiling.
- Orchestration in Alpine handlers: untestable and impossible to abort cleanly from every state.

## Consequences

- Memory: 48 kHz × 40 s mono Float32 is about 7.7 MB per run; capture is capped and released
  after analysis unless the user saves raw data.
- Analysis of a 10-20 s sweep is a long task on the main thread unless a Worker carries it
  (ADR 0026).
- Confirmation criteria: synthetic systems (flat, −6 dB, low-pass, high-pass, echo) convolved in
  tests are recovered within mathematically justified tolerances (specification §138-§139,
  §203); repeated analysis of one capture is bit-identical; abort tests leave zero sources and
  zero capture tasks (§218). Revise if alignment proves unreliable on real devices (then add a
  timing marker to the stimulus).
