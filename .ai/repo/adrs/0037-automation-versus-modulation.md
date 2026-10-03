---
schema: adr/v1
id: adr-0037
kind: adr
title: Automation is a timed base value on a timeline lane; modulation is a control edge with its own depth; the two never stand in for each other
status: proposed
date: 2026-10-02
tags:
  - studio
  - audio
  - automation
  - v31
related:
  - rule:project.audio-engine-discipline
  - rule:project.studio-model-is-canonical
  - claim:studio-automation-model
  - claim:studio-typed-connections
  - claim:studio-transport-audio-clock
  - file:src/js/studio/ports.js
  - file:src/js/studio/validate.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - issue:V402
---

# 37. Automation is a timed base value on a timeline lane; modulation is a control edge with its own depth; the two never stand in for each other

## Context

Both automation and modulation move a parameter over time, and a naive implementation
merges them: an LFO "baked" into automation points, or automation implemented as a hidden
modulator. The specification separates them (§97-§104): automation is the authored base
value over time, modulation is continuous control from another node, and the actual value is
base plus modulation within bounds. Modulation depth belongs to the connection (§35, §104).
Web Audio supports exactly this: an AudioParam's own automation timeline plus signals
connected into it, which add.

## Decision

Proposed:

- Automation lives on the timeline as lanes `{ target: { node, param }, points: [{ time,
  value, curve }] }`, one lane per parameter, only on parameters the registry marks
  automatable. Curves are STEP, LINEAR and EXPONENTIAL; exponential only between positive
  values. Each lane compiles to the parameter's own AudioParam schedule
  (`setValueAtTime`, `linearRampToValueAtTime`, `exponentialRampToValueAtTime`) on the audio
  clock (ADR 0036).
- Modulation is a CONTROL edge into a PARAMETER port. The edge carries depth, polarity,
  mapping (linear in the parameter's unit, or log in octaves on logarithmic parameters) and
  offset; it compiles to a gain-scaled signal connected into the AudioParam, so it adds to
  whatever the automation sets.
- Neither is ever simulated with the other. The effective value is automation (or the static
  parameter value) plus the sum of modulations, clamped to the parameter's safe range by the
  compiler.
- Automation editors scale per parameter (frequency logarithmic, gain in dB, pan -1..1),
  never on a shared 0-1 chart unless clearly normalized.

## Alternatives rejected

- Modulation recorded as automation points: loses the source node, cannot follow a changed
  LFO rate, and multiplies points.
- Automation as an implicit modulator node: two sources of truth for the base value and an
  invisible node in the graph.
- Depth as a parameter of the modulator node: one LFO could not drive two targets at
  different depths, and the edge would carry no meaning of its own.

## Consequences

- An Inspector "Automate" action creates or reveals a lane; a cable creates modulation. The
  two appear in different places because they are different things.
- Confirmation criteria: the model side is built and tested (automatable-only lanes, sorted
  points, exponential through zero refused, modulation edge properties with unit-aware
  bounds). Not yet built: the automation compiler and editor (issues V419, V420). Confirmed
  when the automation test (specification §211) renders cutoff 500 Hz → 8 kHz offline and
  matches the scheduled curve, and the modulation test (§210) shows LFO depth on the edge
  adding to that automated base value.
