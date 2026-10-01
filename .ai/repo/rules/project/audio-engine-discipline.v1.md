---
id: project.audio-engine-discipline
version: 1
kind: rule
title: Audio engine discipline
description: One AudioEngine owns every Web Audio node, schedules on the audio clock, and never clicks, accumulates or exceeds Nyquist.
statement: Only AudioEngine creates or connects Web Audio nodes; all audio timing uses audioContext.currentTime; envelopes are click-free; stop() leaves zero active nodes; requested frequencies stay below 0.95 x Nyquist.
status: active
class: blocking
depends_on: []
tags: [audio, dsp]
---

# Rationale

Specification sections 15-18 and 6-7 define the engine contract. Violations produce clicks,
leaked oscillators that keep sounding, or aliasing the user cannot see.

# Required behaviour

- Alpine never creates nodes; engine objects are never placed into Alpine reactive state.
- Audio timing uses AudioParam automation against `audioContext.currentTime`. `setTimeout` and
  `setInterval` are for UI bookkeeping only.
- Gain never hard-switches from nonzero to zero and is never exponentially ramped to 0; a small
  positive floor is used where an exponential ramp needs one.
- `stop()` ramps down, cancels future automation, stops and disconnects every node, clears
  references and updates playback and visualization state. PLAY → STOP → PLAY works indefinitely.
- `safeMaximum = sampleRate / 2 * 0.95` is derived from the running context; 48 kHz is never
  assumed. Nothing is scheduled at or above Nyquist.
- Wide-range frequency controls map logarithmically via `frequencyToNormalized` /
  `normalizedToFrequency`.
- The p5 draw loop reads engine and UI state through the visualization bridge, allocates nothing
  per frame and does not touch the DOM.

# Failure behaviour

A review rejection; a smoke-test run whose active-node count is nonzero after stop fails.

# Verification

The smoke test repeats play/stop cycles and asserts the engine reports zero active nodes after
each release.
