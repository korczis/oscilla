---
id: project.visual-identity-lock
version: 1
kind: rule
title: Visual identity lock for every V3.x surface
description: Every V3.x surface, Studio included, is built from the existing OSCILLA design tokens and primitives and looks like the production V2/V3 interface, never like another product.
statement: New surfaces extend the existing OSCILLA tokens (src/styles/tokens.css), panel primitives, controls, typography, chart styling and Signal Path visual language before inventing any token, shape, colour family or interaction surface; no surface imports the visual identity of another audio product or of a generic flow editor; and the answer to the question whether the screen would still obviously belong to OSCILLA with the logo hidden must be yes.
status: active
class: blocking
depends_on: []
tags: [design, visual, studio, v3]
---

# Rationale

The VISUAL IDENTITY LOCK appended to `docs/specs/oscilla-v3.1-studio.md` binds every V3.x
surface; V3.1 specification §21 ("no generic flow-editor visual identity"), §53, §74 and
§166-§169; ADR 0034 (custom HTML nodes and SVG cables) and ADR 0029 (visual regression in the
release gate). The production V2/V3 interface is the canonical design language; a mode that
looks like a different application forks the product.

# Required behaviour

- The design language is fixed: dark technical cockpit; navy and blue-gray surfaces; thin
  structural borders; compact radii; dense layout; restrained spacing; technical
  typography; tabular numeric readouts; cyan/blue interaction accent; semantic secondary
  accents; precise grids; minimal decoration. No glassmorphism, marketing gradients,
  oversized pills, soft consumer-app styling or skeuomorphic analog-synth treatment.
- Colours come only from `src/styles/tokens.css` (which already forbids hard-coded colours
  elsewhere). A new token, component shape, colour family or interaction surface is added
  only after showing that no existing primitive can be extended; prefer extension.
- Signal Path is the direct visual ancestor of the Studio graph: a Studio node looks like an
  editable OSCILLA Signal Path node and a cable like an interactive extension of the
  signal-flow view. Audio, control, measurement and analyzer nodes stay one visual family.
- Arturia, Ableton, Bitwig, Native Instruments, Max/MSP, Reaktor, Node-RED, React Flow and
  DAW software are studied for interaction patterns only; their visual identity is not
  imported, and no flow-editor library default theme ships.
- The identity holds across compact Studio, full Studio, mobile Studio, Measure, Analyzer,
  Experiments, Learn, dialogs, inspectors, timelines, nodes, cables, automation lanes and
  charts, in dark and light themes; the product is not forked visually by mode.

# Failure behaviour

A review rejection; a surface that fails the hidden-logo question is wrong even when every
functional test passes.

# Verification

The visual regression check of ADR 0029 (`scripts/visual-compare.mjs`, `npm run visual`,
regions in `tests/visual/regions.json`, reference `tests/visual/reference.png`) catches
regressions of the existing surfaces; ADR 0029 puts it in the release gate (plan R006).
Planned (issue V430, specification §203-§205): deterministic compact and full Studio
references with per-region thresholds join that check. Reviewers apply the hidden-logo
question to every new surface; the cross-model UX review (§236) records the answer.
