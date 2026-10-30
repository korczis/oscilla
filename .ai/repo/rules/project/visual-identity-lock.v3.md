---
id: project.visual-identity-lock
version: 3
kind: rule
title: Visual identity lock - Flowbite Pro around OSCILLA's domain views, with an instrument-panel carve-out
description: Every surface's interface is Flowbite Pro on Tailwind themed to OSCILLA and the domain views keep OSCILLA's own visual language inside Pro cards; the instrument panels (the Synth panel, its knobs, jacks, cables and the docked keys) may use a restrained hardware-panel treatment drawn only from OSCILLA tokens, never another product's identity.
statement: The interface of every surface is built from Flowbite Pro on Tailwind (project.ui-uses-flowbite-pro, ADR 0061), themed with OSCILLA's palette in dark and light; the domain views (charts, Signal Path, the Studio graph and timeline, meters and readouts) keep OSCILLA's own visual language as the content of Pro cards; the instrument panels may draw module plates with a two-token tonal gradient, rotary knobs with one highlight and a value ring in the accent, jacks as recessed rings and patch cables with sag and a soft shadow, every colour read from an OSCILLA token; no surface carries a wood, photographic or bitmap texture, screws or rivets, any brand mark, logo, product name or colourway, or another product's layout or trade dress; and with the logo hidden the screen still obviously belongs to OSCILLA.
status: active
class: blocking
depends_on: []
tags: [design, visual, studio, synth, v3, flowbite]
x-majordomus:
  tests: [tests/unit/synth-panel-tokens.test.mjs, tests/unit/synth-wording.test.mjs, tests/unit/ui-flowbite-pro.test.mjs]
---

# Rationale

Version 2 (2026-10-28) moved the lock to "Flowbite Pro around OSCILLA's domain views" and banned
"skeuomorphic analog-synth treatment", naming the instrument makers among the identities not to
import. On 2026-10-30 the owner ordered the Synth workspace to look like a hardware instrument
("musi to vypadat jako arturia": it must look like that maker's instruments). A hardware look and
another maker's identity are different things: the first is a way of drawing knobs, jacks and
plates; the second is a logo, a product name, a colourway, a layout. Version 3 allows the first,
narrowly, on the instrument panels only, and keeps banning the second everywhere. Everything else
of version 2 binds unchanged.

# Required behaviour

- **Interface: Flowbite Pro.** Unchanged from version 2: shell, page headers, cards, tables,
  tabs, buttons, forms, dropdowns, modals, alerts and badges are the Pro components, themed
  through the Tailwind configuration. No glassmorphism, marketing gradients or soft
  consumer-app styling.
- **Domain views: OSCILLA's own.** Unchanged from version 2.
- **Instrument panels (new).** The Synth panel (`src/js/synth/view/`), its engine faces and the
  docked keys are a domain view inside Pro cards and may use a restrained hardware-panel
  treatment: a module plate's two-token tonal gradient, knob caps with one highlight and a value
  ring in the accent token, jacks drawn as recessed rings in the jack shapes of `PORT_VISUALS`,
  cables with sag and a soft shadow. Every colour is an OSCILLA token read at run time
  (`src/js/synth/view/tokens.js`); the two themes differ only by the tokens.
- **Never.** Wood, photographic or bitmap textures, screws or rivets; any brand mark, logo,
  product name or product colourway; reproducing any product's panel layout or trade dress. The
  panel's names are generic (VCO, HPF, LPF, EG, MG, VCA, S&H, PATCH BAY), and its title is
  "Semi-modular mono voice".
- **One product across modes.** Unchanged from version 2, the Synth workspace included.

# Failure behaviour

A failing check fails `npm test` (CI `unit` job) or the visual gate; a surface that fails the
hidden-logo question is a review rejection even when every functional test passes.

# Verification

- `tests/unit/synth-panel-tokens.test.mjs` (in `npm test`): no hex, rgb, hsl or other colour
  literal, no literal paint attribute and no `url()` but an in-SVG fragment reference in
  `src/js/synth/view/**`, and every token the panel reads exists in `src/styles/tokens.css`.
- `tests/unit/synth-wording.test.mjs` (in `npm test`): no product, brand or model name and no
  "analog", "vintage", "warm" or "fat" claim in the Synth's code, markup or Learn copy.
- `tests/unit/ui-flowbite-pro.test.mjs` and `npm run test:visual`, as in version 2; the Synth
  references are the visual record of the carve-out.

Review-only (a reviewer owns them): the hidden-logo question, that the panel reproduces no
product's layout or trade dress, that the treatment stays restrained (one highlight, two tokens),
and the light theme, Firefox and WebKit, and sizes without a reference.
