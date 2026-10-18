---
id: project.no-silent-feedback
version: 1
kind: rule
title: No silent feedback loops
description: An instantaneous audio feedback cycle, a control cycle or an analysis cycle is rejected with a visible reason and never built, dropped or repaired silently.
statement: The Studio model rejects any graph whose cycle analysis finds an all-AUDIO cycle (audio-feedback), a cycle through a CONTROL or TRIGGER edge (control-cycle) or an all-ANALYSIS cycle (analysis-cycle); the rejection names the cycle and states the reason, nothing cyclic reaches Web Audio, and no code removes or reroutes an edge to make a cycle disappear without the user seeing it.
status: active
class: blocking
depends_on: [project.typed-ports@1]
tags: [studio, graph, safety, v31]
---

# Rationale

V3.1 specification §38-§40 and §241; ADR 0033. An instantaneous audio loop in Web Audio is
either silently muted by the browser or a runaway level at the speaker; a modulation loop
has no defined value. Both must be refused where the user is acting, with a reason, not
discovered by the audio engine.

# Required behaviour

- Cycles are found on the node graph by explicit traversal (Tarjan strongly connected
  components in `src/js/studio/validate.js`); a valid graph always has a deterministic
  topological order, which the compiler uses.
- An all-AUDIO cycle is rejected with "Connection rejected: This would create an unsupported
  instantaneous audio feedback loop."; a cycle through a CONTROL or TRIGGER edge is a
  control-cycle, an all-ANALYSIS cycle an analysis-cycle. Each diagnostic carries the
  shortest cycle path so the editor can show it.
- A live input (Microphone) with an AUDIO path to Master Output is rejected
  (live-input-to-output).
- Nothing silently fixes a cycle: no automatic edge removal, no hidden mute, no implicit
  delay insertion. The user's action is refused and the model stays as it was.
- A safe delay or feedback node may only arrive with its own feature, ADR and a new version
  of this rule that states which cycles it makes legal.

# Failure behaviour

A review rejection; a cyclic graph reaching the compiler or the runtime, or a cycle removed
without a visible message, fails the rule.

# Verification

- `tests/unit/v31-studio-model.test.mjs`, in `npm test`: audio feedback rejected with the
  specification's message and the cycle path, the control-cycle policy table, analysis cycles
  and live input to output rejected, deterministic topological order; and "a cycle is refused
  at every model entry point, never repaired": EDGE_ADD, a looped PASTE clipboard,
  `normalizeStudio`, `validateStudioModel`, `importStudio`, `validateStudioImport` and the
  store's initial model each refuse the loop with its sentence or keep every edge, and none
  hands back a model with the loop removed.
- `tests/unit/v31-studio-compiler.test.mjs`, in `npm test`: "invalid models are refused
  before Web Audio; the runtime keeps its last graph" compiles and applies an audio-feedback,
  a control-cycle and a live-input-to-output model; each is refused in the validate phase, no
  audio node is created and the runtime's revision and nodes stay as they were.
- `tests/browser/v31-studio-graph.cjs` check cable-reject, in `npm run test:studio` (CI's
  `studio` job, three browsers): dragging a cable that closes an instantaneous feedback loop
  in the editor adds no edge and announces the specification's sentence.

Not machine-checked: the tests cover the entry points above. Code added later that changes
the graph another way (a new action, adapter or import path) is held to "nothing silently
fixes a cycle" by review until a test names it; the browser check observes the model and the
announcement, and the unchanged runtime is the compiler test's.
