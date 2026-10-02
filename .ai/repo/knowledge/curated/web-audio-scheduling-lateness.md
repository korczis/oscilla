---
schema: knowledge/v1
id: web-audio-scheduling-lateness
kind: knowledge
class: observation
title: How late an AudioParam event scheduled from the main thread can land, per engine
description: Measured lateness of automation events scheduled at currentTime + lead, and the browser behaviours the engine design depends on.
status: verified
epistemics: measured
date: 2026-10-02
tags:
  - audio
  - firefox
  - scheduling
provenance:
  origin: authored
  derived_from:
    - file:index.html
    - file:tests/engine.cjs
---

# How late an AudioParam event scheduled from the main thread can land

Measured on 2026-10-02 (macOS, Playwright 1.63 builds of Chromium, Firefox and WebKit),
by stepping a ConstantSourceNode's offset at `ctx.currentTime + lead` through the app's
output chain and locating the step in a sample-accurate tap. Lateness is relative to the
same step scheduled 200 ms ahead; 25 trials per lead, with and without 0–15 ms of busy
main thread before each call.

| lead | Firefox idle | Firefox loaded | Chromium loaded | WebKit loaded |
|------|--------------|----------------|-----------------|---------------|
| 0 ms | max 5.3 ms | max 16 ms, median 5.3 | 0 | 0 |
| 3 ms | max 2.3 ms | max 13 ms | 0 | 0 |
| 6 ms | 0 | max 10 ms | 0 | 0 |
| 12 ms | 0 | 0 (one later engine-suite run: ~3 ms late) | 0 | 0 |
| 20 ms | 0 | 0 | 0 | 0 |

What follows from it:

- In Firefox the main thread's `currentTime` trails the render position by up to about one
  graph iteration and more under load; Chromium and WebKit were never late. An event in the
  past applies as a step, so the engine schedules every change to a sounding voice 20 ms
  ahead (`SCHEDULE_LEAD_S`).
- `getOutputTimestamp()` does not help in Firefox: `contextTime` plus elapsed time equals
  `currentTime` exactly.
- Firefox has no `AudioParam.cancelAndHoldAtTime`, and cancelling an in-progress ramp makes
  the value revert to the previous event's. Inserting the new end event first and cancelling
  only later events avoids both (ADR 0001).
- `OscillatorNode.type` cannot be scheduled; changing it while sounding is a hard switch
  (ADR 0003).
- The DynamicsCompressorNode delays its output by about 6 ms (lookahead): steps scheduled at
  `t` appear in the destination stream at `t + 6 ms`.
- Firefox starts a ramp whose anchor event falls mid-render-quantum at the quantum's edge:
  a release anchored at an arbitrary time stepped deterministically by 2.8–3.2× the sine's
  slope (same value on every run with the same timing). Rounding anchor times up to a
  multiple of 128 frames removed it (8/8 clean takes).
- Under heavy CPU contention (load average ~40, other browser suites running) Firefox applied
  a release scheduled 20 ms ahead 20–70 ms late in roughly half of fresh-page takes
  (step ratios 19–64); a 35 ms lead still saw a 120 ms outlier. Chromium and WebKit were
  unaffected. Treat single-take click measurements in Firefox under load as noisy.
