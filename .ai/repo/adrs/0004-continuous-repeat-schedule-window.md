---
schema: adr/v1
id: adr-0004
kind: adr
title: Continuous repeat is a plan kind scheduled ten seconds ahead and topped up
status: accepted
date: 2026-10-02
tags:
  - audio
  - scheduling
provenance:
  origin: authored
---

# 4. Continuous repeat is a plan kind scheduled ten seconds ahead and topped up

## Context

A continuous sweep was built as a finite plan of 600 s: for a 20 ms pass that is 12 000
segments and 72 004 automation events, scheduled in one call (34 ms to over 1 s on the main
thread), and playback stopped silently at 600 s.

## Decision

- `buildPlan` returns `kind: 'continuous'` with one cycle of segments, `period` (cycle length)
  and `dur: Infinity`. `planFreqAt` / `planAmpAt` read time modulo `period`.
- The engine schedules whole cycles up to `SCHEDULE_AHEAD_S` (10 s) ahead on the audio clock.
  A one-second UI timer (bookkeeping only) tops the schedule up from `ctx.currentTime`; after a
  stall it skips cycles already in the past, keeping the grid. Old envelope records are pruned.
- No hard cap. The voice runs until stopped or until continuous permission is withdrawn
  (ADR 0005). `transportText` says "repeats until stopped".

## Consequences

- Initial scheduling: ~1 200 events for a 20 ms pass; horizon stays 8–10 s ahead.
- If the page's timers stall for more than ten seconds the sweep holds its last frequency
  (whole envelope) or goes silent (segment envelope) until the next top-up.
- Consumers that test `kind === 'finite'` treat a continuous plan as open-ended.

## Resolution notes

### 2026-10-18: accepted by the owner

Accepted by the owner (explicit instruction in the session of 2026-10-18, applied by the
coordinating Claude session) — implemented as described; evidence: claim
`sweep-rises-through-range`; the continuous plan kind in `src/js/audio/patterns.js` and the
`SCHEDULE_AHEAD_S` top-up in `src/js/audio/scheduler.js`; the "continuous sweep" checks (about
10 s ahead, topped up, "repeats until stopped", 0 oscillators after stop) in
`tests/browser/engine-v1port.cjs` (CI).
