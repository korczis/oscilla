---
id: project.visual-identity-lock
version: 4
kind: rule
title: Visual identity lock - the Flowbite Pro interface around OSCILLA's own domain views, drawn app-wide as a restrained old-school modular
description: Every surface's interface (shell, panels, dialogs, controls) is Flowbite Pro on Tailwind themed to OSCILLA, and the domain views (charts, Signal Path, the Studio graph and timeline) keep OSCILLA's own visual language inside Pro cards; no surface imports the visual identity of any product, flow editor or UI kit. Version 4 keeps every guarantee of version 3 and lifts its one narrowing from the Synth panel surface to the whole app, by the owner's decision of 2026-11-02 (Q071) - a restrained hardware treatment (jacks, plugs, cables, screws, wooden cheeks, metal, texture, LED glow) drawn only from OSCILLA tokens, never implying a measurement that is not made.
statement: The interface of every surface, Studio included, is built from Flowbite Pro on Tailwind (project.ui-uses-flowbite-pro, ADR 0061), themed with OSCILLA's palette in dark and light; the domain views (charts, Signal Path, the Studio graph, nodes, cables and timeline, the spectrogram, meters and readouts) keep their meaning, the Signal Path grammar, the dataviz rules and tabular numerals as the content of Pro cards; no surface carries the brand mark, logo, product name, product colourway, panel layout, traced face or other trade dress of any product, and no surface uses another UI kit or a flow-editor theme; every surface may carry a restrained old-school modular hardware treatment (jacks with nuts, plugs on cable ends, cables with sag, sheen and shadow, screws, wooden cheeks, brushed or anodised metal plates, a subtle surface texture, LED glow; never rivets), drawn only by the one synth-theme layer, in which every colour is an OSCILLA token, every texture is procedural (CSS, SVG or token-driven) and never a bitmap, nothing animates a gradient or uses glassmorphism, no glow but on an LED that shows real state, motion honours prefers-reduced-motion, and no lamp, needle or scale implies a measurement, a calibration or a dB SPL figure the engine has not produced; and with the logo hidden the screen still obviously belongs to OSCILLA.
status: active
class: blocking
depends_on: [project.no-fake-science@2]
tags: [design, visual, studio, synth, v4, flowbite]
x-majordomus:
  tests: [tests/unit/visual-identity-lock-v4.test.mjs, tests/unit/ui-flowbite-pro.test.mjs, tests/unit/synth-panel-tokens.test.mjs, tests/unit/synth-wording.test.mjs]
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
binds the domain views; its sentences about the existing panel primitives, and its ban on
skeuomorphic analog-synth treatment, are read through ADR 0061 and this version.

Version 3 (2026-10-30) narrowed the skeuomorphism ban on one surface, the Synth panel
surface, for the owner's order "musi to vypadat jako arturia" ("it must look like Arturia"),
and kept wood, texture, screws and rivets banned even there.

Version 4 (2026-11-02) exists for the owner's decision Q071, given in session oscilla-21
through AskUserQuestion, verbatim:

- Asked "the 'real synth, cables as cables, Arturia inspiration' look: how should it
  apply?" with the options "Jen Synth + kabely" / "Celá appka jako synth" / "Synth + Studio
  uzly", the owner chose **"Celá appka jako synth"** (the whole app as a synth).
- Asked which hardware elements, a multiple choice, the owner chose all of "Jacky a
  konektory" (jacks and plugs/connectors), "Kabely s prověsem a leskem" (cables with sag and
  sheen), "Šroubky a dřevěné bočnice" (screws and wooden cheeks) and "Kov, textura, LED záře"
  (brushed or anodised metal, surface texture, LED glow), and added: `keep it decent, but
  real (no gen z fancy frills), old school modulars like ""` (the comparison after "like" was
  left empty).

A hardware look and another maker's identity remain different things: the first is a way of
drawing jacks, plates and cables; the second is a logo, a name, a colourway, a panel layout, a
trade dress. Version 4 therefore lifts the narrowing to the whole app and widens the element
set to what the owner chose, turns "decent, real, old school, no frills" into limits a check
can hold, and keeps every other clause of version 3 unchanged. ADR 0061's resolution note of
2026-11-02 records the change.

# Required behaviour

- **Interface: Flowbite Pro.** Shell, page headers, cards, tables, tabs, buttons, forms,
  dropdowns, modals, alerts and badges are the Pro components (`project.ui-uses-flowbite-pro`),
  with the Pro radius, spacing and typography, themed through the Tailwind configuration:
  `primary` is OSCILLA's cyan/blue interaction accent and the surface greys map onto its navy
  and blue-gray surfaces in the dark theme, so the cockpit reads dense and technical. The
  hardware treatment below wraps and skins Pro components; it never replaces one, adds no UI
  kit, no osc-* class token, no legacy selector and no inline style, and the ratchet of
  `project.ui-uses-flowbite-pro` only falls.
- **Domain views: OSCILLA's own meaning.** The Signal Path is the direct visual ancestor of
  the Studio graph: a Studio node reads as an editable Signal Path node and a cable as an
  interactive extension of the signal-flow view; audio, control, measurement and analyzer
  nodes stay one visual family, and a port keeps its typed shape (`PORT_VISUALS`, never colour
  alone). Charts follow the dataviz rules (validated palette, one axis per quantity, labelled
  status) and tabular numerals, inside Pro cards. A hardware skin on a node, a cable, a
  timeline lane or a chart frame keeps that grammar; it does not change what a mark means.
- **Measurement truth.** A skin never implies calibration (`project.no-fake-science`): a
  readout window shows its unit and whether it is relative or calibrated; a needle or a VU
  scale is labelled dB SPL only under the valid level calibration that rule names, and is
  otherwise relative. No decoration implies data that is not measured: a lit LED, a moving
  needle or a meter reflects real engine or measurement state, never a constant, a timer or a
  random value.
- **No foreign identity, ever.** No surface carries the brand mark, logo, product name,
  product colourway, panel layout, traced face or other trade dress of any product. Arturia,
  Moog, Buchla, Korg, Roland, Eurorack makers (Doepfer, Make Noise, Mutable Instruments,
  Intellijel and the rest), Ableton, Bitwig, Native Instruments, Max/MSP, Reaktor, Node-RED,
  React Flow and DAW software are references for style and interaction only. No flow-editor
  library default theme ships and no UI kit but Flowbite Pro is used. The only logo in the
  product is OSCILLA's.
- **The hardware treatment, app-wide.** Every surface (the shell, Studio's graph, nodes,
  cables and timeline, the Synth, the labs, MEASURE, Experiments, Analyzer and Compare) may
  draw: jacks with nuts; plugs on cable ends; cables with sag, sheen and a soft shadow; screws;
  wooden cheeks; brushed or anodised metal plates; a subtle surface texture; LED glow. Screws
  are allowed; rivets stay banned (not among Q071's options), on every surface, the layer
  included. The treatment is drawn only by the shared synth-theme layer (planned as plan issue
  F013: the directories `ui/synth/` and `ui/cable/` under `src/js`, with the Synth panel's
  `src/js/synth/view/`); a surface takes it by calling the layer, so its hardware vocabulary
  (wood, brushed, anodised, screw, jack nut, sheen, cheek, `data-led`, `data-needle`,
  `data-hw`) appears in no other source file and no skin escapes the layer's checks. And:
  - **Tokens only.** Every colour is an OSCILLA token (`src/styles/tokens.css`), read at run
    time or through a Tailwind theme key that maps to a `var(--osc-*)`; the two themes differ
    only by token values. No hex, colour function, named colour, literal paint or arbitrary
    Tailwind colour value in the theme layer.
  - **Procedural textures.** Wood grain, brushed metal and surface texture are CSS gradients,
    SVG patterns or filters, or token-driven; no photographic or bitmap image, no image file
    and no remote image. The only bitmap in `src/` stays the touch icon of `src/index.html`
    (`project.single-file-deliverable`; the size budget holds).
  - **Decent, real, old school: no frills.** No glassmorphism (no backdrop blur or backdrop
    filter), no animated gradient, no gradient text, no neon over-glow: a glow (a shadow with
    no offset) is drawn only on an LED (`data-led`) and spreads at most 6 px, and text never
    glows; the one glow recorded before this version (the shell's status lamp) only shrinks.
    Intensity is bounded: sheen, texture, the wooden cheek's width and the LED glow are the
    Tailwind keys `hw-sheen` (opacity at most 0.25), `hw-texture` (at most 0.08), `hw-wood`
    (at most 16 px) and `hw-led` (a token-coloured glow of at most 6 px), and the layer reads
    them, never a literal opacity, alpha or shadow (`src/styles/tokens.css` cannot gain a
    declaration under the ratchet of `project.ui-uses-flowbite-pro`). The palette of
    `tokens.css` changes only in a reviewed commit that rewrites its snapshot, so no product's
    colourway slips in as a token. Motion is restrained: the global `prefers-reduced-motion`
    guard of `src/styles/base.css` stays, a Tailwind `animate-*` in the theme layer is
    `motion-safe:`, and a script or SVG animation (`.animate(`, `<animate`) in the theme layer
    checks `prefers-reduced-motion` in the same file.
  - **Indicators bind to state.** An LED is marked `data-led` and a needle `data-needle`;
    the same element names its state source (`data-source`) and carries its state
    (`data-lit`, `data-value`) as an interpolated value, never a literal.
  - **What it must still meet:** a jack ring and a cable are graphical objects (3:1 against
    their card) and a label is text (4.5:1 against its plate), in both themes; a focused jack
    or control shows a focus ring; a hit target is at least 44 px where the design gives one.
- **One product across modes.** The identity holds across compact Studio, full Studio, mobile
  Studio, Synth, Measure, Analyzer, Experiments, Learn, dialogs, inspectors, timelines, nodes,
  cables, automation lanes and charts, in dark and light themes; the product is not forked
  visually by mode, and a surface not yet migrated (the debt of `project.ui-uses-flowbite-pro`)
  is not a reason to fork a new one.

# Changed in version 4, and why

- **Lifted:** the narrowing of version 3 held on the Synth panel surface only; version 4
  extends it to every surface (Q071, scope "Celá appka jako synth"). The ban on
  "skeuomorphic analog-synth treatment" of versions 1 and 2 no longer holds anywhere; the
  limits above replace it.
- **Widened:** version 3 banned wood, textures, screws and rivets on the Synth panel surface
  and allowed one highlight and two-token plates; version 4 allows jacks with nuts, plugs,
  cable sheen, screws, wooden cheeks, brushed or anodised metal, a subtle procedural texture
  and LED glow (Q071, all four element options). Bitmaps stay banned.
- **Reworded, domain views:** "the domain views keep OSCILLA's own visual language" became
  "keep their meaning, the Signal Path grammar and the dataviz rules", so a skin from the layer
  may now dress a domain view (a cable, a plate, a knob, a meter) without changing what it
  says.
- **Reworded, foreign identity:** "imports the visual identity of another product" became the
  enumerated trade dress: a brand mark, logo, product name, product colourway, panel layout or
  traced face, so a hardware look is allowed and a product's identity is not.
- **Rivets:** screws are allowed and rivets stay banned, as in version 3: the owner's option
  named "Šroubky a dřevěné bočnice" (screws and wooden cheeks), not rivets.
- **Where:** the treatment is drawn only by the synth-theme layer; the hardware vocabulary
  outside it fails (af's review of 2026-11-02, P2-A).
- **Unchanged:** the Flowbite Pro interface and its ratchet; the domain views' meaning; the
  measurement-truth clauses; no foreign identity; the hidden-logo question; contrast and
  focus. The flat-knob decision D11 (Q018) stays superseded on the Synth panel as ADR 0061's
  note of 2026-10-30 says, and K058's own component is unchanged by this version.

# Failure behaviour

A failing check fails CI or the release gate; a surface that fails the hidden-logo question
is a review rejection even when every functional test passes.

# Verification

- `tests/unit/visual-identity-lock-v4.test.mjs` (in `npm test`, CI `unit` job), each guard a
  pure function proved by a seeded violation inside the test:
  - app-wide over every tracked file under `src/`: no product or maker name (a deny list);
    no logo but OSCILLA's (`osc-logo*`); no image file and no bitmap `data:` URI but the touch
    icon; no backdrop blur or backdrop filter, no gradient text, no `@keyframes` that moves a
    background and no `animate-*` beside a gradient; a zero-offset glow only on a `data-led`
    element and at most 6 px, never on text (the legacy status lamp of the shell,
    `.osc-status.is-playing .osc-status-dot`, a real-state lamp that glows 8 px, is recorded
    debt in the test's `GLOW_DEBT`, only shrinks, and fails once stale); every `data-led` or
    `data-needle` element names an interpolated `data-source` and state; the global
    reduced-motion guard of `src/styles/base.css` exists; every colour key of
    `tailwind.config.cjs` but `primary` maps to a `var(--osc-*)` token; the hardware
    vocabulary appears only in the theme layer (an allow-list that only shrinks is empty at
    version 4) and "rivet" nowhere; the colour values of `src/styles/tokens.css` equal the
    reviewed snapshot `tests/unit/visual-identity-palette.json`; the intensity keys
    `hw-sheen`, `hw-texture`, `hw-wood` and `hw-led` exist within their bounds;
  - over the theme layer (`src/js/synth/view/` now, and `ui/synth/` and `ui/cable/` under
    `src/js` once they exist): no colour literal, colour function, named colour, literal paint,
    arbitrary Tailwind colour or `url()` but an in-SVG fragment; every `var(--osc-*)` it names
    is defined by `src/styles/tokens.css`; `animate-*` only behind `motion-safe:`; a script or
    SVG animation only in a file that checks `prefers-reduced-motion`; "SPL" only in a file
    that reads the calibration state; in the layer's own directories no literal opacity,
    alpha or shadow.
  While `ui/synth/` and `ui/cable/` under `src/js` do not exist the theme-layer guards judge
  only `src/js/synth/view/`, and the test prints that the layer's directories, and the
  intensity-literal guard, pass vacuously; once either directory exists it must hold a `.js`
  module and every guard is strict on it.
- `tests/unit/ui-flowbite-pro.test.mjs`, in `npm test` (CI `unit` job): the interface half.
  Growth of the recorded legacy interface (a surface not migrated, an osc-* class token, a
  class name outside the frozen vocabulary, a legacy selector or declaration, an inline
  style), a migrated surface that regresses or is counted without the Tailwind build, another
  UI kit or a new stylesheet fails; what it does not decide is listed in rule
  `project.ui-uses-flowbite-pro`.
- `tests/unit/synth-panel-tokens.test.mjs` (in `npm test`): no colour literal in
  `src/js/synth/view/`, and every token the panel reads exists in `src/styles/tokens.css`.
- `tests/unit/synth-wording.test.mjs` (in `npm test`): no product, brand or model name and no
  "analog", "vintage", "warm" or "fat" claim in the Synth's code, markup or Learn copy.
- `npm run test:visual`, in the release gate and CI's visual job (ADR 0029): a pixel
  regression, beyond the accepted tolerance, of a view with an accepted reference
  (`scripts/visual-gate.mjs`, `scripts/visual-measure.mjs`, `scripts/visual-studio.mjs`;
  regions and values under `tests/visual/`). A re-skinned view gets a new reference, and
  accepting it, with its reason, is the review.
- `tests/browser/synth.cjs` check `s-look` (in `npm run test:studio`: CI's studio job and the
  release gate): on the rendered Synth panel, in the dark and the light theme, no legacy `svg`
  stroke on a jack or a plate, every jack ring and every cable colour at 3:1 or more on the
  bay card, every plate label at 4.5:1 or more on its plate, a keyboard-focused jack's ring
  shown, and a card that folds with `aria-expanded`. A re-skinned surface outside the Synth
  gets a check of that style in the same change.

Review-only (a reviewer owns them), with this checklist line in the review of every pull
request that re-skins a surface (the repository has no pull-request template):
"Masked logo: with the OSCILLA logo covered, the re-skinned screens still read as OSCILLA, and
as no other product." Also review-only: the hidden-logo question for every re-skinned surface;
that no product's colourway, panel layout or face is reproduced (a deny list catches names,
not shapes; a palette change is judged on its snapshot diff); that the treatment stays
restrained and old-school (how much wood, how much
sheen, whether a texture is subtle); that an LED's or a needle's `data-source` is the real
engine or measurement state it names; the theme mapping; that the domain views keep their
grammar and the dataviz rules; and the identity in the light theme, in Firefox and WebKit,
and at sizes without a reference. The cross-model UX review (§236) records the answer.
