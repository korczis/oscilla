---
schema: adr/v1
id: adr-0032
kind: adr
title: Studio ports are typed with roles, and connection validity is pure model logic checked before any runtime mutation
status: proposed
date: 2026-10-02
tags:
  - studio
  - graph
  - v31
related:
  - rule:project.typed-ports
  - claim:studio-typed-connections
  - claim:studio-untrusted-import
  - claim:studio-measurement-topology
  - file:src/js/studio/ports.js
  - file:src/js/studio/validate.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/ports.js
    - issue:V402
---

# 32. Studio ports are typed with roles, and connection validity is pure model logic checked before any runtime mutation

## Context

Studio connects audio, modulation, triggers and measurement signals (specification §31-§37,
§190-§192). Web Audio itself accepts almost any `connect()`; an audio output wired into a
parameter, or a capture wired where the stimulus belongs, either fails silently or produces
a meaningless measurement. The type of a connection must drive compatibility, the port's
shape, the cable style, the Inspector wording and the compiler, and the same answer must
come from the editor, the keyboard dialog, paste, patch load and import.

## Decision

Proposed:

- Four port types: AUDIO, CONTROL, TRIGGER, ANALYSIS. Measurement is not a fifth type; it is
  ANALYSIS with roles. Roles refine a type: AUDIO SIGNAL / TAP (an analyzer side input that
  does not alter the path), CONTROL SIGNAL / PARAMETER (an input bound to one parameter with
  unit, range and mapping), ANALYSIS REFERENCE / OBSERVED / RESULT.
- Compatibility is `canConnect(source, target)` → `{ allowed, reason }`, pure model logic
  in `ports.js`: same type only, ANALYSIS same role only, never against direction or to the
  same node. Each input declares its multiplicity (one edge for audio, trigger and analysis
  inputs; several for a parameter, whose modulations add). An edge's signal type is derived
  from its ports and never stored.
- Graph validation (`validate.js`) runs on the whole model after every semantic action and
  returns structured diagnostics with codes, paths and sentences. Nothing reaches the
  runtime that did not validate; untrusted input passes the import pipeline first.
- Visual distinction does not rely on colour: AUDIO circle, CONTROL diamond, TRIGGER
  triangle, ANALYSIS square, with accessible labels stating type and direction.

## Alternatives rejected

- Untyped ports with Web Audio as the judge: errors surface as silence or noise, after the
  runtime has already changed.
- Compatibility in the DOM (CSS classes, drop targets): the keyboard dialog, paste and import
  would each need their own copy.
- A separate MEASUREMENT port type: reference, observed and result differ by role, not by
  how they are carried; a type per role multiplies the matrix without adding meaning.

## Consequences

- Rule `project.typed-ports` v1 makes validation-before-mutation a blocking invariant.
- Adding a node type means declaring its ports in the registry; no switch statement grows.
- Confirmation criteria (built and tested now): the compatibility matrix, role separation,
  single-input multiplicity, a rejected EDGE_ADD that leaves the store unchanged, and import
  rejection of malicious and oversized input. Not yet built: the editor's live feedback
  while dragging a cable (issue V411) and the accessible connection dialog (V428), both of
  which must call `canConnect` rather than reimplement it.

## Recorded values

Recorded as a Majordomus decision and repeated here: `STUDIO_IMPORT_LIMITS` are 4 MiB
before parsing, nesting depth 12, 512 nodes, 2048 edges, 64 tracks, 2048 clips, 512
automation lanes, 20000 automation points (4096 per lane), 512 markers, strings of 256
characters (names 64, notes 10000).
