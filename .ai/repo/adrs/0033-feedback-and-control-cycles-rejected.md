---
schema: adr/v1
id: adr-0033
kind: adr
title: Instantaneous audio feedback and control or analysis cycles are rejected by the model until a delay node has its own decision
status: proposed
date: 2026-10-02
tags:
  - studio
  - graph
  - safety
  - v31
related:
  - rule:project.no-silent-feedback
  - claim:studio-feedback-rejected
  - file:src/js/studio/validate.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/validate.js
    - issue:V402
---

# 33. Instantaneous audio feedback and control or analysis cycles are rejected by the model until a delay node has its own decision

## Context

An editable graph lets a user close a loop. In Web Audio an audio cycle without a
`DelayNode` is muted by the browser; with one it can run away to the output ceiling. A
modulation loop (LFO 1 modulates LFO 2, which modulates LFO 1) has no defined value, and a
loop through calibration stages has no meaning. The specification requires explicit cycle
detection and topological ordering, never letting Web Audio discover invalid topology
(§38-§40, §241), and leaves safe delay/feedback nodes to a later feature and ADR.

## Decision

Proposed:

- Cycles are detected on the node graph by Tarjan strongly connected components. A cyclic
  component whose internal edges are all AUDIO is `audio-feedback` ("Connection rejected:
  This would create an unsupported instantaneous audio feedback loop."); one containing a
  CONTROL or TRIGGER edge is `control-cycle`; one with only ANALYSIS edges is
  `analysis-cycle`. All three are errors, reported with the shortest cycle path.
- The policy is node-level and conservative: a node is in a cycle whenever a path leaves and
  re-enters it, without modelling which output depends on which input inside the node.
  Consequently "an envelope driven by an oscillator modulating that oscillator's frequency"
  is rejected; acyclic modulation chains and several modulators on one parameter are legal.
- A microphone with an AUDIO path to Master Output is rejected as well (acoustic feedback
  through the speaker).
- A valid graph always has a deterministic topological order (Kahn, ties by model order),
  which the compiler uses.
- No cycle is ever repaired silently; the action is refused.

## Alternatives rejected

- Allow audio cycles and rely on the browser: silent mute or runaway level, discovered by
  the user's ears.
- Port-level dependency tracking inside nodes: more permissive, but every node type would
  need an internal dependency map that the registry does not have yet; the conservative rule
  can be relaxed later without invalidating saved graphs, the reverse cannot.
- Insert an implicit one-block delay on every cycle: changes the sound without the user
  asking and hides the loop.

## Consequences

- Some musically legitimate patches (feedback delay, Karplus-Strong style loops) are not
  possible in 3.1; they need a delay/feedback node with its own feature, a superseding or
  amending ADR, and a new version of rule `project.no-silent-feedback`.
- Confirmation criteria (built and tested now): the specification message for audio
  feedback, the control-cycle table, analysis cycles, live input to output, deterministic
  topological order. Not yet built: the editor showing the rejected cable and the cycle path
  (issue V411) and the browser audio-graph test (specification §209, issue V430).
