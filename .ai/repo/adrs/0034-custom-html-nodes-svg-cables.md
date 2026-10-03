---
schema: adr/v1
id: adr-0034
kind: adr
title: The Studio graph editor is custom HTML nodes over an SVG cable layer in the OSCILLA visual language, without a flow-editor framework or React, inside the single file
status: proposed
date: 2026-10-02
tags:
  - studio
  - ui
  - visual
  - deliverable
  - v31
related:
  - rule:project.visual-identity-lock
  - rule:project.single-file-deliverable
  - rule:project.studio-model-is-canonical
  - claim:studio-file-protocol
  - claim:studio-non-drag-operation
  - file:docs/specs/oscilla-v3.1-studio.md
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - issue:V402
---

# 34. The Studio graph editor is custom HTML nodes over an SVG cable layer in the OSCILLA visual language, without a flow-editor framework or React, inside the single file

## Context

Studio needs an editable node graph: draggable nodes with inline controls, typed ports,
cables with large hit targets, selection, pan and zoom, keyboard operation and screen-reader
labels (specification §53-§80, §138-§149). The application is Alpine.js and plain
token-based CSS bundled into one `dist/index.html` that must run from `file://`
(ADR 0011, ADR 0012, rule `project.single-file-deliverable` v2), already near its size
budget. Its look is locked: Signal Path is the visual ancestor of the Studio graph, and no
surface may take the identity of another audio product or of a generic flow editor (the
VISUAL IDENTITY LOCK of the V3.1 specification). The specification asks for a short,
measured comparison with lightweight libraries (§55) and forbids a React migration without
overwhelming evidence (§54).

## Decision

Proposed:

- Nodes are HTML elements (OSCILLA panel primitives and controls from
  `src/styles/tokens.css`); cables are one SVG layer beneath them; both are positioned in
  logical graph coordinates under a `{ panX, panY, zoom }` viewport. No full-canvas editor.
- The editor is written for OSCILLA, not adopted: no flow-editor framework, no React,
  Preact or virtual-DOM layer, and no library default theme. Interaction patterns (cable
  drag, quick add, frame all) may be studied from other tools; their visual identity is not
  imported.
- The editor is a projection of the StudioModel (ADR 0030) and edits only by dispatching
  actions (ADR 0031); port compatibility comes from `canConnect` (ADR 0032), not from DOM
  drop targets. Pointer Events with capture drive drags; every drag has a non-drag
  equivalent (connection dialog, keyboard movement).
- Studio is part of the one `dist/index.html`. It adds no runtime dependency, file, fetch,
  module script or worker loaded from a path; a worker or worklet, if ever needed, is
  embedded source loaded from a `data:` URL (ADR 0012, ADR 0026). This is the existing
  single-file decision applied to Studio, not a new one.

## Alternatives rejected

- React Flow or another React-based editor: needs React, and its styling and DOM structure
  would fight the locked identity; a migration of the application to React is out of scope.
- A framework-free flow library (for example Drawflow, Rete.js, LiteGraph): each brings its
  own model of nodes and connections that would compete with the StudioModel, its own
  undo or none, its own theme to override, and bytes in a file already near budget;
  LiteGraph is canvas-only, which loses DOM controls, text and accessibility.
- A full-canvas editor: hit testing, text, focus and screen-reader support would all be
  reimplemented.

## Consequences

- OSCILLA owns pan, zoom, cable routing, hit targets and drag performance; the
  specification's targets (§145-§149) become the editor's tests.
- Rule `project.visual-identity-lock` v1 binds every Studio surface; the visual regression
  check of ADR 0029 gains compact and full Studio references (§203-§205).
- Confirmation criteria: not yet built (issues V409-V413, V421, V422). The decision is
  confirmed when (a) the §55 comparison is written down with measured bundle bytes, licence,
  framework dependency, `file://` bundling, touch and keyboard support for the custom editor
  against at least two lightweight libraries (issue V401; written retrospectively on 2026-10-03,
  after the editor shipped, in `docs/v31/audit-current-state.md` §3, which measures Drawflow,
  Rete.js and LiteGraph and supports this decision), (b) the editor meets the §145-§146
  frame-time targets on the large-graph fixture (§250), and (c) `verify-dist` and the
  `file://` browser gate pass with Studio included. It is revised if the measured comparison
  shows a library that satisfies the identity lock, single-file rule and accessibility
  requirements at a smaller cost.

## Open questions

Recorded as Majordomus questions and repeated here: the graph zoom bounds (the model accepts
any positive zoom; the specification suggests 0.25x-2.5x, to be chosen by testing, §58);
whether browser Fullscreen is worth its cleanup cost beside a maximized Studio
(§133-§135).
