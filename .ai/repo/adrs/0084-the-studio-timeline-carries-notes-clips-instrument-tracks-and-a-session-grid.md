---
schema: adr/v1
id: adr-0084
kind: adr
title: "The Studio timeline carries notes clips with a piano roll, several instrument tracks, a session grid and later MIDI output (amends ADR 0058 decision 5)"
status: accepted
date: 2026-11-03
tags:
  - midi
  - studio
  - daw
related:
  - file:.ai/repo/adrs/0058-midi-is-an-optional-local-input-layer-over-the-audio-engine.md
  - rule:project.studio-model-is-canonical
---

# 84. The Studio timeline carries notes clips with a piano roll, several instrument tracks, a session grid and later MIDI output

## Context

ADR 0058 (proposed) makes MIDI an optional local control layer over the one AudioEngine. Its
decision 5 puts MIDI clock, MIDI output to external instruments and multiple tracks outside its
first version and rejects turning the block sequencer into a MIDI sequencer; it names no piano
roll. The owner's orders of 2026-10-29 ("a full DAW, a full sequencer and a full piano") and
2026-11-02 ("+ profi daw + vse propojene", "ableton like ui as well - notes, tracks, daw,
tracks, edit mode") ask for those surfaces; plan issue Q062 put the scope to the owner.

## Decision

Only ADR 0058's decision 5 changes; its decisions 1-4 stand as written.

- Notes clips (`{ notes: [{ at, note, len, vel }] }`, beats from the clip start, the form K099
  and K149 share) with a piano-roll editor, several instrument tracks, a session grid and, later,
  MIDI output to external instruments are in scope, on the Studio timeline of the one
  StudioModel (`project.studio-model-is-canonical`): no second model, and the timeline and the
  session grid are projections of it.
- The block sequencer stays a sound-pattern editor; it does not become a MIDI sequencer.
- MIDI clock and AI improvisation stay out of scope until a plan issue names them.

## Consequences

The owner gate on K099, K107 and K111 (and W011, W012, W015) is lifted; their dependencies still
apply. MIDI output, when it comes, is its own slice with its own consent and safety rules.

## Resolution notes

### 2026-11-03: accepted by the owner

The owner chose "(a) DAW in scope (Recommended)" in the session of oscilla-b0 (AskUserQuestion,
2026-11-03 about 00:0xZ), recorded as Q062's owner_decision evidence by oscilla-26.
