---
schema: adr/v1
id: adr-0002
kind: adr
title: A new voice fades every earlier one out first; a waveshaper ceiling backs up the output cap
status: proposed
date: 2026-10-02
tags:
  - audio
  - gain
  - safety
provenance:
  origin: authored
---

# 2. A new voice fades every earlier one out first; a waveshaper ceiling backs up the output cap

## Context

`MAX_OUTPUT_GAIN` (0.25) is the documented level of UI 100 %. `play()` released earlier voices
but skipped any already releasing, so 20 HOLD presses 100 ms apart with a 3000 ms release left
20 voices sounding together: measured output peak 0.68 (2.7× the cap). The compressor stage
(threshold −3 dBFS, makeup removed by `trim`) never engages below 0.7 and could not help.

## Decision

- `play()` fast-releases (15 ms) every voice, releasing or not, regardless of the user's
  release setting.
- When it replaces a voice, the new voice starts after that fade (`t0 = lead + 15 ms`), not at
  the usual 20 ms offset: voices never overlap, so the sum never exceeds one voice's level.
- A `WaveShaperNode` after `trim` carries an identity curve clipped at ±`MAX_OUTPUT_GAIN`
  (4097 points, exact under linear interpolation, `oversample: 'none'`). It is transparent for
  any single voice at 100 % and bounds anything that still sums above the cap.
- The replaced voice stops being `engine.voice` before it is released, so its end is not
  reported as the end of playback.

## Alternatives rejected

- Crossfading (overlap): sums of in-phase voices reach 1.25× during the overlap and would
  rely on the ceiling clipping.
- Lowering the compressor threshold to the cap: attack time and lookahead let transients
  through, and it colours a single full-scale voice.

## Consequences

- Retrigger latency is 35 ms instead of 20 ms. At most two voices exist at once, briefly.
- Measured: 20 retriggers with release 3000 ms → 1 voice at a time, peak 0.25 (cap 0.25);
  `tests/engine.cjs` checks peak ≤ 0.2625 with the ceiling bypassed and ≤ 2 voices.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: where the cited check lives now

`tests/engine.cjs`, `tests/smoke.cjs` and `tests/spec.cjs` were V1's test files; they left with
V1's single file in the V2 change (9fe0a15, #3) and stay readable at tag `v1.0.0`. The
voice-count and peak checks run on the current engine as `tests/browser/engine-v1port.cjs`
(`npm run test:engine`, in CI).
