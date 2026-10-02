---
schema: adr/v1
id: adr-0015
kind: adr
title: The V2 engine is the V1 engine on the native Web Audio API, extended through option hooks and engine-accounted graph builders
status: proposed
date: 2026-10-02
tags:
  - audio
  - architecture
  - v2
provenance:
  origin: authored
---

# 15. The V2 engine is the V1 engine on the native Web Audio API, extended through option hooks and engine-accounted graph builders

## Context

V1's `AudioEngine` encodes hard-won browser behaviour: recorded automation frozen on release
(ADR 0001), one voice at a time and a waveshaper ceiling (ADR 0002), live changes (ADR 0003),
continuous scheduling ahead on the audio clock (ADR 0004), the safety limit (ADR 0005). V2 adds a
filter insert, ADSR, additive PeriodicWave, stereo routing, noise and a block sequencer, plus
offline rendering for WAV export. An audio framework would bring its own scheduler, node
ownership and release semantics.

## Decision

- No audio framework. `src/js/audio/audio-engine.js` is the V1 class, split only into cohesive
  parts (`voice`, `scheduler`, `modulation`, `microphone`); with no options it builds V1's graph
  and schedule (frozen, ADR 0014).
- V2 features attach through `play(plan, o)` options (`inserts`, `periodicWave`, `adsr`,
  `envelope`, `stepEnvelope`, `output`, `dualRouter`). Each is a graph builder that receives the
  context and the engine's `track`/`source` accounting and exposes `dispose()`, so
  `activeNodeCount` stays exact and stop leaves zero nodes (rule
  `project.audio-engine-discipline` v2).
- Timing stays on the audio clock, by reference to ADR 0001 and ADR 0004: the sequencer compiles
  a block model into a time-sorted event list applied as AudioParam automation, with boundaries
  quantised to sample frames so live and `OfflineAudioContext` renders agree. JS timers only do
  bookkeeping (top-up, end notices, the waveform-switch moment of ADR 0003).
- WAV export renders the same configuration through the same graph builders in an
  `OfflineAudioContext` (`offline-renderer.js`) and rejects frequencies at or above 0.95 × the
  render rate's Nyquist instead of clamping them.

## Alternatives rejected

- Tone.js or a similar framework: its transport and voice model would replace the V1 release and
  replacement semantics that the V1 engine tests (`tests/browser/engine-v1port.cjs`, 77 checks)
  were written against, and it adds size to an already large single file (ADR 0012).
- A new V2 engine beside the V1 one: two engines to keep click-free and leak-free.
- Sequencer timing by `setTimeout`/`setInterval`: timers drift and stall under main-thread load,
  the failure ADR 0004 already removed from continuous sweeps; even audio-clock events scheduled
  from the main thread need a lead (`knowledge/curated/web-audio-scheduling-lateness.md`).

## Consequences

- New audio features must fit the hook model or extend it; a builder that creates nodes outside
  `track`/`source` is a rule violation.
- The V1 engine checks run against the V2 modules in CI (`npm run test:engine`).
- The V3 measurement stimulus reuses this engine and the pattern definitions rather than a second
  generator (V3 specification §14; ADR 0018).
