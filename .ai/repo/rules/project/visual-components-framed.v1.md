---
id: project.visual-components-framed
version: 1
kind: rule
title: A visual component exists only as a catalogue declaration inside the one frame
description: Every chart, scope, curve, meter, canvas or drawing of the page is a declaration with visual true in the UI catalogue, and renders inside the one frame, which gives it full screen, its menu and a size class from its own box; no view has a full-screen control of its own.
statement: Every chart host (an element with the class osc-chart-host or a data-osc-chart attribute) and every drawing surface (a canvas, or an svg with role img or a data-osc hook) of src/index.html sits in an element whose data-osc is a declaration of the UI catalogue with visual true, and the one frame (src/js/ui/catalog/frame.js) wraps that element at run time. A visual declaration's id is a concrete hook, never a pattern; its fullscreenControls are declarations of the frame control kinds (action, switch, choice, param), each a hook of its own; the hooks the frame builds (<id>.fullscreen, <id>.frame and the controls) are owned by the visual declaration and never declared twice. Full screen is the frame's (the Fullscreen API, or a fixed overlay inside the safe area where the element cannot go full screen), Escape and Back leave it and focus returns to the trigger; no view adds a full-screen control of its own. The frame's size class comes from the frame's own box, never from the device.
status: active
class: blocking
depends_on: [project.ui-uses-flowbite-pro@1, project.no-inert-surfaces@1]
tags: [ui, components, catalogue]
---

# Rationale

The owner's order of 2026-11-02 (verbatim, in Czech): "kazda z visualnich komponent musi byt
wrapped v genericky ramecek, ktery umozni full screeen + eventuelne full screen specific
extra controlls, tohle musi byt genericke a vsude - pripraveno na mobily, male monitory,
velke monitory, vice monitoru": every visual component sits in one generic frame with full
screen and optional full-screen extra controls, everywhere, ready for phones, small monitors,
large monitors and several monitors; and "generic / dynamic / inferred / derived / data
driven / configurable / ui exposed / documented".

Before this rule three panels had a full-screen button each, written by hand in
`src/index.html` and handled by one `toggleFullscreen(panelId)` of `src/js/ui/workbench.js`
with its own `is-fullscreen` class, and the other seventeen chart hosts and the keyboard
canvas had none. A fourth button, Filter Lab's `filter.fullscreen`, carried the expand icon
and the `fullscreen` kind but changed the workspace: it is a route, and is declared as one.

# Required behaviour

- A visual component is declared once, in `src/js/ui/catalog/decl/visual.js`, with
  `visual: true`: `defineComponent` (`src/js/ui/catalog/define.js`) refuses `visual` that is
  not a boolean, a visual pattern, `fullscreenControls` without `visual: true`, a control that
  is not a declaration or not of a frame control kind, and a repeated control.
- The element whose `data-osc` is the declaration's id is the frame. The frame puts its
  trigger into the element's `[data-osc-frame-slot]` (a panel header) or into a bar of its own
  as the first child, and writes `data-osc-frame`, `data-osc-frame-state` (`inline` or
  `full`) and `data-osc-frame-size` (`phone`, `small` or `large`, from its own width).
- Every chart host and drawing surface of `src/index.html` is inside such an element.
- The parts are Flowbite Pro buttons and a Pro dropdown on Tailwind classes (rule
  `project.ui-uses-flowbite-pro`): no `osc-*` class is added, and a target is 44 px on a
  coarse pointer.
- Full screen uses the Fullscreen API; where the element has none (Safari on iPhone) or it is
  refused, a fixed overlay inside the safe-area insets. Escape and Back leave it; focus
  returns to the trigger. A change of workspace leaves it.
- The menu (`<id>.frame`) exists when the declaration lists `fullscreenControls`, and lists
  every option: full screen and each control. The controls show as a row while the frame is
  full screen.

# Enforcement

- `tests/unit/ui-frame.test.mjs`, run by `npm test` in the CI `unit` job: the declaration
  schema (each refusal above as a fixture), the frame hooks the catalogue covers and owns, the
  size classes, the full-screen mode, what the frame shows, and the visual census of
  `scripts/ui-catalog/check.mjs` on the repository and on fixtures.
- `tests/unit/ui-catalog.test.mjs`, run by `npm test`: the catalogue contract
  (`checkCatalog`), which carries the visual census, holds on the repository.
- `tests/browser/ui-flowbite-pro.cjs` legs `frame-fullscreen` (enter, Escape, focus back on the
  trigger), `frame-overlay` (the overlay where the Fullscreen API is missing, Back leaves it)
  and `peeper` (the peeper is framed), run by `npm run test:browser` in CI.

Mutation proofs, each a fixture of `tests/unit/ui-frame.test.mjs` that the check refuses: a
`<canvas>` outside any frame; a chart host inside an element whose declaration is not visual;
an `<svg role="img">` outside any frame; a frame-built hook on a page with no visual
declaration; `fullscreenControls` without `visual: true`; a full-screen control of the `panel`
kind; a visual pattern; and the repository's `src/index.html` with the `data-osc` of a
visual frame removed.

# What no check decides

Whether a new view is a visual component when it draws through a module under `src/js`
(a canvas a chart library creates inside a declared host is inside the frame; one created
elsewhere is the reviewer's to catch), and whether a frame's full-screen layout serves the
view in substance.
