---
schema: knowledge/v1
id: product-landscape-and-the-pigments-path
kind: knowledge
class: fact
title: "OSCILLA sits beside Arturia, Bitwig, Max/MSP, Learning Synths, REW and free browser tone tools; building \"Arturia Pigments, free in the browser\" was rejected because OSCILLA's advantage is understanding, measuring and reproducing, not making sound"
description: "The competitive context the ChatGPT conversations gave, and why the visual identity lock and the non-goals keep Studio from becoming a synth clone; read before a Studio or positioning change."
status: verified
epistemics: observed
date: 2026-10-18
tags:
  - product
  - positioning
  - studio
provenance:
  origin: authored
  derived_from:
    - file:.ai/repo/rules/project/visual-identity-lock.v1.md
    - file:docs/specs/oscilla-v3.1-studio.md
relations:
  - type: derived_from
    target: knowledge:chatgpt-oscilla-project
  - type: relates_to
    target: knowledge:positioning-candidates
---

# The landscape, and the path not taken

Sources are the conversations of `chatgpt-oscilla-project`; times are UTC.

## What OSCILLA resembles

When the owner remarked that the Studio "looks like some Arturia product" (`6abec18d`,
2026-10-02T03:35:50Z), ChatGPT placed it (03:35:53Z) among:

- Arturia Pigments and MiniFreak V: the modulation workflow;
- Bitwig The Grid: visual modular flow;
- Max/MSP and Reaktor: the graph as a program;
- Ableton Learning Synths: didactic clarity (the owner's own UX reference for V1, `6abec18d`,
  2026-10-01T20:34:05Z);
- REW: measurement.

Its interaction lessons from Arturia, to borrow as patterns and never as code or look: visible
modulation, live response, a parameter shows who modulates it, direct source-to-target
patching, a clean inspector, a fast patch workflow, progressive disclosure. The repository's
`project.visual-identity-lock` names these products for interaction patterns only.

## The path rejected

ChatGPT (`6abec18d`, 03:35:53Z): building OSCILLA as "Arturia Pigments, but free in the browser"
is a dead end, because there Arturia wins on sound design, presets, effects, MIDI and polish. The
risk it named is a "Pigments clone" or a "Christmas tree of DSP widgets" (03:18:10Z, 03:35:53Z).
Its formula instead: "Arturia UX discipline + Bitwig graph semantics + REW measurement honesty +
OSCILLA identity", a "precision technical cockpit", not a "warm analog instrument".

## The other neighbours

- Free browser tone and audio tools exist in quantity (Tonal.fm and others), and REW is free,
  professional and uses calibrated microphones; "browser-only, nothing uploaded" does not set
  OSCILLA apart by itself (`6abf3077`, 2026-10-02T04:21:01Z, 04:31:55Z).
- The category ChatGPT drew in V3 (`6abec18d`, 2026-10-02T03:15:06Z): between "Ableton Learning
  Synths + signal generator + oscilloscope/RTA + REW-lite + interactive textbook", not a
  competitor of Ableton, Spotify or synth demos.

None of this is a decision. The owner's adopted steering is that acoustic measurement is the
wedge, ChatGPT's framing in `6ac1beb8` (2026-10-04T03:30:06Z, "To je tvoje wedge"), adopted on
2026-10-07 (ADR 0051); the positioning sentence is still to be chosen (`positioning-candidates`,
issue Q002).
