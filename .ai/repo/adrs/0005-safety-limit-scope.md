---
schema: adr/v1
id: adr-0005
kind: adr
title: The hard safety limit caps open signals and the finite tone; patterns are exempt up to 30 s
status: proposed
date: 2026-10-02
tags:
  - safety
  - playback
provenance:
  origin: authored
---

# 5. The hard safety limit caps open signals and the finite tone; patterns are exempt up to 30 s

## Context

The specification sets a hard playback limit (0.5–5 s, default 2 s) that only "Allow
continuous playback" may bypass. A Finite tone of 10 s played 10 s regardless of the limit;
switching continuous playback off left a latched tone, an unlimited hold or a continuous sweep
running.

## Decision

- Open patterns (HOLD, TRIGGER, latch) and the Finite tone (`plan.limitable`) are capped at
  the limit, on HOLD and TRIGGER alike, unless continuous playback is allowed. The cap is
  scheduled on the audio clock.
- Patterns whose frequency moves or that have gaps (pulse, burst, sweeps, chirp, sequences,
  random, alternating, octave, ping-pong) keep their programmed end, at most
  `MAX_PROGRAMMED_S` (30 s).
- A voice the permission actually lengthened is marked `extended`. Switching the permission
  off calls `engine.revokeContinuous()`, which fades every extended voice in 15 ms, before the
  sweep repeat is reset to "once".
- `transportText` states which rule applies: "programmed 10 s · limited to 2 s", or
  "programmed 10 s (patterns are exempt from the hold limit, max 30 s)".

## Consequences

- Finite tone 10 s with limit 2 s ends at 2.01 s; a 10 s sweep plays 10.01 s.
- Revocation stops latch, hold and continuous sweep within 100 ms (`tests/engine.cjs`).
- `durationText` and the Playback-safety note in the markup are owned by the UI and must say
  the same thing.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: where the cited check lives now

`tests/engine.cjs`, `tests/smoke.cjs` and `tests/spec.cjs` were V1's test files; they left with
V1's single file in the V2 change (9fe0a15, #3) and stay readable at tag `v1.0.0`. The
revocation checks run on the current engine as `tests/browser/engine-v1port.cjs` (`npm run
test:engine`, in CI).
