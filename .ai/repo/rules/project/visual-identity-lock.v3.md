---
id: project.visual-identity-lock
version: 3
kind: rule
title: Visual identity lock - the Flowbite Pro interface around OSCILLA's own domain views, with one narrowing for the Synth panel surface
description: Every surface's interface (shell, panels, dialogs, controls) is Flowbite Pro on Tailwind themed to OSCILLA, and the domain views (charts, Signal Path, the Studio graph and timeline) keep OSCILLA's own visual language inside Pro cards; no surface imports the visual identity of another audio product, flow editor or UI kit. Version 3 keeps every guarantee of version 2 and narrows one, the skeuomorphism ban, on one surface only, the Synth panel surface, by the owner's order of 2026-10-30.
statement: The interface of every surface, Studio included, is built from Flowbite Pro on Tailwind (project.ui-uses-flowbite-pro, ADR 0061), themed with OSCILLA's palette in dark and light; the domain views (charts, Signal Path, the Studio graph, nodes, cables and timeline, the spectrogram, meters and readouts) keep OSCILLA's own visual language, the dataviz rules and tabular numerals as the content of Pro cards; no surface imports the visual identity of another audio product, of a generic flow editor or of another UI kit; no surface carries a skeuomorphic analog-synth treatment except the Synth panel surface (the module plates, knobs, patch bay, jacks and cables drawn by src/js/synth/view), which may draw a two-token tonal plate gradient, rotary knobs with one highlight and a value ring, jacks as rings and cables with sag and a soft shadow, every colour read from an OSCILLA token, with no wood, photographic or bitmap texture, no screws or rivets, and no brand mark, logo, product name, product colourway, panel layout or other trade dress of any product; and with the logo hidden the screen still obviously belongs to OSCILLA.
status: active
class: blocking
depends_on: []
tags: [design, visual, studio, synth, v3, flowbite]
x-majordomus:
  tests: [tests/unit/ui-flowbite-pro.test.mjs, tests/unit/synth-panel-tokens.test.mjs, tests/unit/synth-wording.test.mjs]
---

# Rationale

Version 1 bound every V3.x surface to the existing OSCILLA tokens and panel primitives
(`src/styles/tokens.css`, `osc-panel`), the design language ADR 0012 chose when it dropped
Tailwind and Flowbite. On 2026-10-28 the owner ordered Flowbite Pro for the UI of every
project (ADR 0061), so the interface's component system is no longer OSCILLA's own: the
shell, panels, dialogs and controls are Flowbite Pro. What makes OSCILLA recognisable stays:
the domain views, which no UI kit has (the Signal Path and the Studio graph as its editable
extension, ADR 0034; the charts; the measurement readouts). Version 2 moved the lock from
"the existing primitives" to "Pro around the domain views". The VISUAL IDENTITY LOCK appended
to `docs/specs/oscilla-v3.1-studio.md` (V3.1 specification §21, §53, §74, §166-§169) still
binds the domain views; its sentences about the existing panel primitives are read through
ADR 0061.

Version 3 (2026-10-30) keeps all of that. It exists for one order of the owner, given in
Czech on 2026-10-30 for the Synth workspace, verbatim: "musi to vypadat jako arturia" ("it
must look like Arturia"). Version 2 banned "skeuomorphic analog-synth treatment" on every
surface and named that maker among the identities not to import. A hardware look and another
maker's identity are different things: the first is a way of drawing knobs, jacks and plates;
the second is a logo, a product name, a colourway, a panel layout, a trade dress. Version 3
therefore narrows exactly one guarantee, on exactly one surface, and says so below; every
other clause of version 2 is restated here and binds unchanged. The decision that records the
narrowing is ADR 0061's resolution note of 2026-10-30 (the instrument visuals and the Synth
panel surface), which also supersedes, for that surface only, the flat knob of D11 (Q018)
that plan issue K058 records.

# Required behaviour

- **Interface: Flowbite Pro.** Shell, page headers, cards, tables, tabs, buttons, forms,
  dropdowns, modals, alerts and badges are the Pro components (`project.ui-uses-flowbite-pro`),
  with the Pro radius, spacing and typography, themed through the Tailwind configuration:
  `primary` is OSCILLA's cyan/blue interaction accent and the surface greys map onto its navy
  and blue-gray surfaces in the dark theme, so the cockpit reads dense and technical. No
  glassmorphism, marketing gradients, soft consumer-app styling or skeuomorphic analog-synth
  treatment, on every surface but the one the narrowing below names. The Synth workspace's
  own chrome (its page header, toolbar, presets dropdown, buttons, cards, status line and
  lists) is this interface and gets no narrowing.
- **Domain views: OSCILLA's own.** The Signal Path is the direct visual ancestor of the Studio
  graph: a Studio node looks like an editable Signal Path node and a cable like an interactive
  extension of the signal-flow view; audio, control, measurement and analyzer nodes stay one
  visual family. Charts follow the dataviz rules (validated palette, one axis per quantity,
  labelled status) and tabular numerals. They render inside Pro cards. The Studio graph's
  nodes and cables, the timeline and the spectrogram keep this language; the narrowing below
  does not reach them.
- **No foreign identity.** Arturia, Ableton, Bitwig, Native Instruments, Max/MSP, Reaktor,
  Node-RED, React Flow and DAW software are studied for interaction patterns only; their
  visual identity is not imported, no flow-editor library default theme ships, and no UI kit
  but Flowbite Pro is used. The owner's order of 2026-10-30 names a maker; it is read as "a
  hardware instrument's look", never as that maker's logo, name, colourway, layout or trade
  dress, which stay banned on every surface, the Synth panel surface included.
- **One product across modes.** The identity holds across compact Studio, full Studio, mobile
  Studio, Synth, Measure, Analyzer, Experiments, Learn, dialogs, inspectors, timelines, nodes,
  cables, automation lanes and charts, in dark and light themes; the product is not forked
  visually by mode, and a surface not yet migrated (the debt of `project.ui-uses-flowbite-pro`)
  is not a reason to fork a new one.

# Narrowed in version 3, and why

One guarantee of version 2 is narrowed, on one surface. Nothing else is.

- **What:** the ban on "skeuomorphic analog-synth treatment" no longer holds on the **Synth
  panel surface**: the module plates, knobs, patch bay, jacks and cables that
  `src/js/synth/view/` draws (`face.js`, `knob.js`, `bay.js`), inside the Pro cards of the
  Synth workspace. Everywhere else the ban stands as written above, the docked keys and the
  Studio graph's nodes and cables included.
- **Why:** the owner's order of 2026-10-30, quoted under Rationale; a flat panel does not
  meet it, and the alternative the pull request offered (a flat panel within version 2) was
  not what the owner asked for.
- **How far:** a module plate's tonal gradient between two OSCILLA tokens; a knob cap with
  one highlight (two tokens) and a value ring in the accent token; jacks drawn as rings in
  the jack shapes of `PORT_VISUALS`; patch cables with sag and a soft shadow, coloured by
  source module from a token set, patterned by signal type (never colour alone). Every
  colour is an OSCILLA token read at run time (`src/js/synth/view/tokens.js`), so the two
  themes differ only by the tokens; no colour literal, texture, bitmap or remote image.
- **Never, there either:** wood, photographic or bitmap textures, screws or rivets; any brand
  mark, logo, product name or product colourway; reproducing any product's panel layout or
  trade dress. The panel's names are generic (VCO, HPF, LPF, EG, MG, VCA, S&H, PATCH BAY),
  and its title is "Semi-modular mono voice".
- **What it must still meet:** a jack ring and a cable are graphical objects (3:1 against the
  bay card) and a plate label is text (4.5:1 against its plate), in both themes; a focused
  jack shows a focus ring; the legacy stylesheet draws nothing on the panel.

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
  accepting it is the review. The Synth view has no accepted reference yet: until its leg
  is written, the rendered-output check below and the review hold it.
- `tests/unit/synth-panel-tokens.test.mjs` (in `npm test`): no hex colour, no colour
  function, no named colour as a paint value, no literal paint attribute and no `url()` but an
  in-SVG fragment reference in `src/js/synth/view/`, and every token the panel reads exists in
  `src/styles/tokens.css`.
- `tests/unit/synth-wording.test.mjs` (in `npm test`): no product, brand or model name and no
  "analog", "vintage", "warm" or "fat" claim in the Synth's code, markup or Learn copy.
- `tests/browser/synth.cjs` check `s-look` (in `npm run test:studio`: CI's studio job and the
  release gate): on the rendered Synth panel, in the dark and the light theme, no legacy `svg`
  stroke on a jack or a plate, every jack ring and every cable colour at 3:1 or more on the
  bay card, every plate label at 4.5:1 or more on its plate, a keyboard-focused jack's ring
  shown, and a card that folds with `aria-expanded`.

Review-only (a reviewer owns them): the hidden-logo question for a new or migrated surface;
the theme mapping (that Pro's greys and `primary` read as OSCILLA's cockpit); that the domain
views keep their language and the dataviz rules; that no other product's or library's visual
identity is imported, the Synth panel surface included (no layout or trade dress of any
product; the treatment restrained: one highlight, two tokens); and the identity in the light
theme, in Firefox and WebKit, and at sizes without a reference. The cross-model UX review
(§236) records the answer.
