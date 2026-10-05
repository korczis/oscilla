---
schema: adr/v1
id: adr-0006
kind: adr
title: The audio engine is verified on a sample-accurate output tap, not on its own bookkeeping
status: proposed
date: 2026-10-02
tags:
  - testing
  - audio
provenance:
  origin: authored
---

# 6. The audio engine is verified on a sample-accurate output tap, not on its own bookkeeping

## Context

The smoke test asserted on `engine.activeNodeCount` and on an AnalyserNode polled from the
main thread. The engine's own counters cannot reveal a leak the engine does not know about,
and analyser polling missed its windows under load (`early: null`, `n = 1–11` in Firefox and
WebKit), so release probes flaked and could not see real steps.

## Decision

`tests/engine.cjs` (exports `instrument`, reused by `tests/smoke.cjs`) injects an init script
that:

- counts OscillatorNode start / stop / `ended` independently of the engine;
- logs every AudioParam call with its owner type and param name;
- can force the AudioContext sample rate (22 050 and 32 000 Hz runs);
- taps the node connected to the destination with an AudioWorklet that records every sample
  with its frame index, zero-filling quanta whose input is inactive, and flushes on any frame
  discontinuity. Blob URL first, `data:` URL as fallback (file:// pages), ScriptProcessor
  only when no worklet loads.

Assertions are made on the audio clock and on recorded samples: oscillator count, silence
(peak < 1e-4), click ratio (largest one-sample step / largest sine slope < 3), Nyquist and
gain-floor rules at the AudioParam level, the gain cap, stereo separation, beat rate, pulse
onset spacing, limits and lifecycle. "No samples captured" is its own failure.

## Consequences

- One engine run takes about 60–70 s per browser.
- The tests prove the before-state failing: against the pre-fix build the engine suite fails
  stacking, Escape mid-release, revocation, limit scope, Nyquist/detune, continuous scheduling
  and click checks.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: where the instrumentation lives now

`tests/engine.cjs`, `tests/smoke.cjs` and `tests/spec.cjs` were V1's test files; they left with
V1's single file in the V2 change (9fe0a15, #3) and stay readable at tag `v1.0.0`. The
instrumentation this decision describes (independent oscillator accounting, the AudioParam log
and the frame-indexed output tap) is carried verbatim by `tests/browser/engine-v1port.cjs`
(`npm run test:engine`, in CI), which runs V1's engine checks against the current modules.
