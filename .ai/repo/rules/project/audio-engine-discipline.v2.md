---
id: project.audio-engine-discipline
version: 2
kind: rule
title: Audio engine discipline
description: Every Web Audio node is accounted to an engine-owned voice or stage, schedules on the audio clock, and never clicks, accumulates or exceeds Nyquist.
statement: Web Audio nodes are created only by the AudioEngine or by graph builders it invokes with its track()/source() accounting; all audio timing uses audioContext.currentTime; envelopes are click-free; stop() leaves zero active nodes; requested frequencies stay below 0.95 x Nyquist.
status: active
class: blocking
depends_on: []
tags: [audio, dsp]
---

# Rationale

V1 specification §15-§18 and §6-§7 define the engine contract. V2 adds filter, ADSR, additive,
stereo, sequencer and offline-render stages as separate modules; they may build nodes, but only
inside the engine's accounting, or leaks and clicks become invisible to its checks.

# Required behaviour

- Alpine and UI code never create nodes; engine objects never enter Alpine reactive state.
- A graph builder (`createFilterStage`, `createStereoRouter`, `createNoiseSource`, the additive
  oscillator, `compileSequence`, ...) receives the context and `{ track, source }` from the engine,
  registers every node and every scheduled source through them, and exposes `dispose()` that
  stops and disconnects everything it created.
- Audio timing uses AudioParam automation against `audioContext.currentTime`. `setTimeout` and
  `setInterval` are for UI bookkeeping only; a sequence compiles to scheduled events.
- Gain never hard-switches from nonzero to zero and is never exponentially ramped to 0. A release
  holds the exact current value first (`cancelAndHoldAtTime`, or a value computed from the known
  schedule where the browser lacks it).
- `stop()` ramps down, cancels future automation, stops and disconnects every node and clears
  references. PLAY → STOP → PLAY works indefinitely. Escape and STOP also cut voices already in
  their release.
- `safeMaximum = sampleRate / 2 * 0.95` comes from the running context; 48 kHz is never assumed.
  Nothing is scheduled at or above it.
- Wide-range frequency controls map logarithmically.
- Draw loops read engine state through `engine.snapshot()` and the visualization bridge, reuse
  their buffers and do not touch the DOM per frame.

# Failure behaviour

A review rejection; a test run whose independent oscillator count or engine node count is
nonzero after stop fails.

# Verification

The freeze suite replays the V1 engine schedules on a recording mock context; the browser gate
counts live oscillators independently after stop, Escape, safety limit, natural end and mode
switch; click checks measure the largest one-sample step at release.
