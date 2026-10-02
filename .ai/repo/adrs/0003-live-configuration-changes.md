---
schema: adr/v1
id: adr-0003
kind: adr
title: A configuration change while playing glides, dips or restarts, and never extends playback
status: proposed
date: 2026-10-02
tags:
  - audio
  - live-update
provenance:
  origin: authored
---

# 3. A configuration change while playing glides, dips or restarts, and never extends playback

## Context

`syncViz` calls `engine.updateLive(plan)` on every reactive change while playing. It returned
`false` for a different plan type and the caller ignored it: a latched 440 Hz tone kept
sounding after switching to DUAL (measured 439 Hz), a 1 kHz tone after picking Siren (1002 Hz).
Waveform changes assigned `OscillatorNode.type` directly: a one-sample step 12.5–13.8× the
sine's slope. Dual live changes glided frequency and detune separately and could overshoot
towards 1.06× the clamp for ~15 ms with ±1200 cents.

## Decision

`updateLive(np)` compares plans by `planKey` (JSON without `label`) and returns
`'same' | 'live' | 'restarted' | false`:

- Same open type (or a finite tone of unchanged length): parameters glide with
  `setTargetAtTime` (τ 15 ms). Dual oscillators play the sounding frequency with detune 0,
  one glide each, so no intermediate value passes the clamp.
- Only waveforms differ: `_switchWaves` dips the release gain to the floor over 5 ms (audio
  clock), switches `type` once the main thread sees the dip complete, and fades back in 5 ms.
  `type` cannot be scheduled; the timer only decides when the switch is safe.
- Anything else: `_restart` plays the new plan with the old voice's options. An open voice
  passes its deadline (safety limit or trigger length) as `until`, so a pattern change never
  lengthens playback. No change to `syncViz` was needed.

## Consequences

- Editing a programmed pattern while it plays restarts it from the beginning.
- A waveform change produces a silent gap of roughly 20–30 ms.
- Measured (`p9`, chromium): DUAL after a latched tone → dual plan, 328 Hz measured
  (A 220 / B 330); Siren → lfo plan; waveform switch step ratio 12.5 → 1.0.
