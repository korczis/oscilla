---
schema: knowledge/v1
id: audio-measurement-pitfalls
kind: knowledge
class: convention
title: Measuring the audio output in headless browsers without false clicks or missed windows
description: Why the tests record the output with a frame-indexed AudioWorklet tap, and the engine quirks that tap has to absorb.
status: verified
epistemics: observed
date: 2026-10-02
tags:
  - testing
  - audio
provenance:
  origin: authored
  derived_from:
    - commit:a7b7a23d7cc64e34b31fa2448d7281029d5918f1
    - file:tests/browser/engine-v1port.cjs
---

# Measuring the audio output in headless browsers

Each of these produced a false result before the tap in `tests/engine.cjs` (V1, tag `v1.0.0`;
ported to `tests/browser/engine-v1port.cjs`) absorbed it.

- **Analyser polling misses windows.** Polling an AnalyserNode from the main thread every few
  milliseconds returned 1–11 samples per 120 ms in Firefox and WebKit under load, and
  `early: null`. Measure on recorded samples, never on polled analysers.
- **ScriptProcessor drops buffers in Firefox.** Concatenated `onaudioprocess` buffers had 2–4
  gaps per second; a gap looks like a one-sample step 4–30× a sine's slope (a false click).
  The peer probe `p10` reported Firefox ratios that partly came from this.
- **Firefox gives an AudioWorklet empty inputs while upstream is silent.**
  `inputs[0]` has no channels when nothing upstream is actively processing; a tap that skips
  those quanta loses the time base. Record zeros for them and index every chunk by
  `currentFrame`, flushing on any discontinuity.
- **Chromium cannot load a worklet module from a blob: URL on a file:// page** (the
  document's origin is opaque: "a dependency or cross-origin script failed to load"). A
  `data:` URL loads. Over http(s) blob: works everywhere.
- **The limiter delays the output by ~6 ms**, so windows placed relative to a scheduling time
  need that margin; a release scheduled 20 ms ahead plus 6 ms of lookahead means level checks
  start 30 ms after the stop call.
- **Square-wave peaks differ per engine**: at 55 Hz and 100 % gain Chromium peaks at 0.247,
  Firefox at 0.197 (different band-limiting). Lower-bound sanity checks must allow for it.
- **Contexts can be forced to a sample rate** by subclassing `AudioContext` in an init script
  (`super({ ...options, sampleRate })`); all three engines accepted 22 050 and 32 000 Hz.

Click metric used throughout: largest one-sample step in the window divided by the largest
slope of the playing sine (`2π f A / sampleRate`). A clean transition stays at or below 1;
the tests fail at 3.
