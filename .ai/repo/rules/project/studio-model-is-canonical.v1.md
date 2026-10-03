---
id: project.studio-model-is-canonical
version: 1
kind: rule
title: The StudioModel is the one canonical Studio state
description: Every Studio surface is a projection of one plain-data StudioModel that is changed only through the action layer and never holds a runtime object.
statement: Studio has exactly one canonical state, the StudioModel; compact Studio, full Studio, Inspector, timeline, Signal Path and experiment serialization only read it; it holds no AudioContext, AudioNode, AudioParam, MediaStream, DOM, canvas, chart, p5, worker or worklet reference; every semantic change goes through the store dispatch and is undoable.
status: active
class: blocking
depends_on: [project.audio-engine-discipline@2]
tags: [studio, data-model, v31]
---

# Rationale

V3.1 specification §1, §9, §10, §21 and §47-§48; ADR 0030 and ADR 0031. Two synchronized
copies of a graph drift, and a graph that is not the one the audio engine runs makes the
screen lie about the sound (§1). A model that holds runtime objects cannot be serialized,
hashed, diffed, undone or entered into experiment provenance.

# Required behaviour

- One StudioModel, owned by one store (`src/js/studio/actions.js` `createStudioStore`). No
  `compactSequencerState`, `fullStudioState`, `signalPathState` or any other parallel copy
  that has to be kept in sync; a view keeps only its own ephemeral presentation (hover, drag
  preview) and derives everything else from the model.
- The model is plain data: `assertPlainData` (run by `normalizeStudio` and so by every
  serialization) rejects functions, class instances, typed arrays, prototype keys,
  non-finite numbers and cycles. Runtime handles live in an ephemeral map keyed by Studio
  node id, outside the model (§43).
- Every semantic mutation is `dispatch({ type, ... })`: node, edge, track, clip, automation,
  marker, loop, transport and metadata changes. No UI code, DOM handler or compiler writes
  the model directly, and no UI code sets an AudioParam that the model owns, unless the
  change is explicitly ephemeral (a live preview that the next dispatch overwrites, §80).
- Every semantic action is undoable and redoable (§48); a continuous gesture is one history
  entry (§50). Selection, pan, zoom and timeline scroll are view state: not undoable, not
  dirty, not hashed.
- Execution state (what sounds and measures), presentation state (positions, names, markers,
  metadata) and view state stay separable, because `studioHash` and experiment provenance
  cover execution state only (§163).
- Audio timing that the model drives (timeline, automation, transport, playhead) is governed
  by `project.audio-engine-discipline` v2, on which this rule depends: the audio clock is
  the authority, and `requestAnimationFrame` or timers never schedule audio. This rule does
  not restate it.

# Failure behaviour

A review rejection. A second Studio state, a runtime object reachable from the model, or a
mutation that bypasses the store is a defect even when the screen happens to look right.

# Verification

`tests/unit/v31-studio-model.test.mjs`: `assertPlainData` rejects runtime objects; store
models are frozen plain data; a rejected action leaves model, history and revision
unchanged; undo all restores the initial model by reference and by serialization. Planned
(issue V430, specification §214): one store drives compact and full Studio in the browser
and both show the same topology after every action.
