---
id: project.visual-identity-lock
version: 2
kind: rule
title: Visual identity lock - the Flowbite Pro interface around OSCILLA's own domain views
description: Every surface's interface (shell, panels, dialogs, controls) is Flowbite Pro on Tailwind themed to OSCILLA, and the domain views (charts, Signal Path, the Studio graph and timeline) keep OSCILLA's own visual language inside Pro cards; no surface imports the visual identity of another audio product, flow editor or UI kit.
statement: The interface of every surface, Studio included, is built from Flowbite Pro on Tailwind (project.ui-uses-flowbite-pro, ADR 0061), themed with OSCILLA's palette in dark and light; the domain views (charts, Signal Path, the Studio graph, nodes, cables and timeline, the spectrogram, meters and readouts) keep OSCILLA's own visual language, the dataviz rules and tabular numerals as the content of Pro cards; no surface imports the visual identity of another audio product, of a generic flow editor or of another UI kit; and with the logo hidden the screen still obviously belongs to OSCILLA.
status: deprecated
class: blocking
depends_on: []
tags: [design, visual, studio, v3, flowbite]
---

> Deprecated on 2026-10-30: superseded by `visual-identity-lock.v3.md`, which restates every
> clause below and narrows one, the skeuomorphism ban, on the Synth panel surface only (the
> owner's order of 2026-10-30; ADR 0061's resolution note of that date).

# Rationale

Version 1 bound every V3.x surface to the existing OSCILLA tokens and panel primitives
(`src/styles/tokens.css`, `osc-panel`), the design language ADR 0012 chose when it dropped
Tailwind and Flowbite. On 2026-10-28 the owner ordered Flowbite Pro for the UI of every
project (ADR 0061), so the interface's component system is no longer OSCILLA's own: the
shell, panels, dialogs and controls are Flowbite Pro. What makes OSCILLA recognisable stays:
the domain views, which no UI kit has (the Signal Path and the Studio graph as its editable
extension, ADR 0034; the charts; the measurement readouts). Version 2 moves the lock from
"the existing primitives" to "Pro around the domain views". The VISUAL IDENTITY LOCK appended
to `docs/specs/oscilla-v3.1-studio.md` (V3.1 specification §21, §53, §74, §166-§169) still
binds the domain views; its sentences about the existing panel primitives are read through
ADR 0061.

# Required behaviour

- **Interface: Flowbite Pro.** Shell, page headers, cards, tables, tabs, buttons, forms,
  dropdowns, modals, alerts and badges are the Pro components (`project.ui-uses-flowbite-pro`),
  with the Pro radius, spacing and typography, themed through the Tailwind configuration:
  `primary` is OSCILLA's cyan/blue interaction accent and the surface greys map onto its navy
  and blue-gray surfaces in the dark theme, so the cockpit reads dense and technical. No
  glassmorphism, marketing gradients, soft consumer-app styling or skeuomorphic analog-synth
  treatment.
- **Domain views: OSCILLA's own.** The Signal Path is the direct visual ancestor of the Studio
  graph: a Studio node looks like an editable Signal Path node and a cable like an interactive
  extension of the signal-flow view; audio, control, measurement and analyzer nodes stay one
  visual family. Charts follow the dataviz rules (validated palette, one axis per quantity,
  labelled status) and tabular numerals. They render inside Pro cards.
- **No foreign identity.** Arturia, Ableton, Bitwig, Native Instruments, Max/MSP, Reaktor,
  Node-RED, React Flow and DAW software are studied for interaction patterns only; their
  visual identity is not imported, no flow-editor library default theme ships, and no UI kit
  but Flowbite Pro is used.
- **One product across modes.** The identity holds across compact Studio, full Studio, mobile
  Studio, Measure, Analyzer, Experiments, Learn, dialogs, inspectors, timelines, nodes,
  cables, automation lanes and charts, in dark and light themes; the product is not forked
  visually by mode, and a surface not yet migrated (the debt of `project.ui-uses-flowbite-pro`)
  is not a reason to fork a new one.

# Failure behaviour

A failing check fails CI or the release gate; a surface that fails the hidden-logo question
is a review rejection even when every functional test passes.

# Verification

- `tests/unit/ui-flowbite-pro.test.mjs`, in `npm test` (CI `unit` job): the interface half.
  Growth of the recorded legacy interface (a surface not migrated, an osc-* class token, a
  class name outside the frozen vocabulary, a legacy selector or declaration, an inline
  style), a migrated surface that regresses or is counted without the Tailwind build, another
  UI kit or a new stylesheet fails; what it does not decide is listed in rule
  `project.ui-uses-flowbite-pro`.
- `npm run test:visual`, in the release gate and CI's visual job (ADR 0029): a pixel
  regression, beyond the accepted tolerance, of a view with an accepted reference
  (`scripts/visual-gate.mjs`, `scripts/visual-measure.mjs`, `scripts/visual-studio.mjs`;
  regions and values under `tests/visual/`). A migrated view gets a new reference, and
  accepting it is the review.

Review-only (a reviewer owns them): the hidden-logo question for a new or migrated surface;
the theme mapping (that Pro's greys and `primary` read as OSCILLA's cockpit); that the domain
views keep their language and the dataviz rules; that no other product's or library's visual
identity is imported; and the identity in the light theme, in Firefox and WebKit, and at sizes
without a reference. The cross-model UX review (§236) records the answer.
