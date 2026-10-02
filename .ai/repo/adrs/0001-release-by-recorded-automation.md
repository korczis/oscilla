---
schema: adr/v1
id: adr-0001
kind: adr
title: Releases freeze recorded automation on the audio clock, by one code path in every browser
status: proposed
date: 2026-10-02
tags:
  - audio
  - envelope
  - firefox
provenance:
  origin: authored
---

# 1. Releases freeze recorded automation on the audio clock, by one code path in every browser

## Context

A voice is `sources → env (programmed envelope) → rel (release gain) → master`. Stopping
mid-attack or mid-ramp needs the envelope held at its current value. Chromium and WebKit
offer `AudioParam.cancelAndHoldAtTime`; Firefox does not, and in Firefox cancelling an
in-progress ramp makes the param revert to the previous event's value. The earlier
emulation snapped to a wrong value: stopping 200 ms into a 500 ms attack produced a
one-sample step 8–15× the sine's largest slope (peer probe `p10`/`p10b`). Separately, the
release ramp was anchored at the main thread's `currentTime`, which in Firefox trails the
render position, so the ramp started partly done (`holdRelease400ms` steps up to 12.7×).

## Decision

- Every envelope and release-gain event goes through `AudioEngine._ev`, which records it.
  `_valueAt(track, t)` computes the param's value at any time from that record (linear and
  exponential segments).
- `_freeze(track, t)` inserts an event at `t` that re-ends the in-progress segment on its own
  curve (a ramp of the same kind to the computed value, or a `setValueAtTime` on a constant
  segment), then cancels only the events after `t`. The segment sounding now never loses its
  end, so no browser reverts. `cancelAndHoldAtTime` is not used anywhere.
- A release freezes `env` and `rel` at `t = currentTime + SCHEDULE_LEAD_S` (20 ms, at least
  256 frames), rounded up to a render-quantum boundary, and ramps `rel` linearly to
  `GAIN_FLOOR`. The rounding matters in Firefox, which starts a ramp anchored mid-quantum at
  the quantum's edge (a deterministic step of up to 128 frames' worth of the ramp, measured
  2.8–3.2× the sine slope for a 30 ms release). Sources stop 10 ms after the ramp
  ends; frequency automation after the stop is cancelled.
- A voice already releasing is re-released when the new fade ends sooner (Escape during a
  3000 ms release): both gains are frozen at their scheduled values and fade from there.

## Alternatives rejected

- `cancelAndHoldAtTime` where available plus an emulation elsewhere: two code paths, and the
  emulation was the bug.
- `cancelScheduledValues(t)` then `setValueAtTime(v, t)`: in Firefox the cancel drops the
  in-progress ramp's end and the value jumps back for at least one render quantum.
- A lead of one render quantum (128 frames): measured late by up to 10–16 ms in Firefox under
  main-thread load (see `knowledge/curated/web-audio-scheduling-lateness.md`).

## Consequences

- Under heavy CPU contention (load average ~40 during this session) Firefox occasionally
  applies a release 20–70 ms late, which no fixed lead prevents; the tests judge click ratios
  by the median of three takes. A lag-proof release would need an AudioWorklet envelope that
  ramps from its current value on message arrival (not done: the worklet loads
  asynchronously, after the first gesture).

- Stop, Escape, safety-limit and retrigger fades start 20 ms after the call. Accepted: it
  equals the existing start offset and is below typical output latency.
- Step ratio after the change (firefox / chromium / webkit, `p10`): hold release 1 / 1 / 1,
  stop mid-attack 0.4 / 0.4 / 0.4, stop mid-step-release 1 / 1 / 1. Enforced by
  `tests/engine.cjs` (click ratio < 3) and `tests/smoke.cjs` (release probes on the tap).
