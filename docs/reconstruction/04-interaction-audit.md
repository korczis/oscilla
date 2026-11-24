# 04. Interaction audit and control-family contracts

Deliverables 4 and 9 (interaction audit, interaction specification). Read from source on
`main` at `c3b15610`, 2026-11-24.

- **Counts.** Instance counts are static markup in `src/index.html`. The Synth counts come
  from importing `synth/panels/semi-mono.js`: 23 modules, 96 knobs, 16 switches, 6 amounts,
  2 toggles, 73 jacks.
- **Open PR #449 (G021 family census)** is based on the v3.24.2 tree. It already picks one
  model per family:

  | Family | Model module |
  |---|---|
  | knob | `ui/synth/knob.js` |
  | patch-bay | `ui/patch/patch-bay.js` |
  | keyboard | `midi/keyboard.js` |
  | envelope | `audio/envelope.js` |
  | filter-response | `audio/filters.js` |
  | pad | `ui/kinds/xy-pad.js` |
  | slider, switch | none yet (slice G023) |

The browser-measured accessibility audit is in `05-accessibility-audit.md`.

## Control families today

| Family | Implementations | Problem |
|---|---|---|
| Knob | `ui/synth/knob.js` core → `synth/view/knob.js` + `face.js` + `synth/gestures.js` | Double-click resets to the panel's `initial` (`synth/ui.js:666-670`), not to the core's `defaultValue`; there is no reset key. |
| Slider | native `.osc-slider` (19); Inspector native range (1/1000 grid) | Two fill formulas (`app.js:77`, `labs/dom.js:29`). The Inspector has no Shift fine, wheel or reset. Sustain has no valuetext (`index.html:1765`). |
| Switch | Alpine role=switch, `labs/dom.js bindSwitch`, Inspector, `record-switch.js`; Synth face toggle | The same boolean is a `role=switch` in the Inspector and an `aria-pressed` button on the Synth. |
| Segmented choice | `app.js rovingKeydown`, `ui/keys/roving.js`, `synth/gestures.js choiceKey`, graph-picker `listKeys` | Four roving engines. |
| Button | 271 in markup, 53 icon-only | At least 11 aria-labels are English. Hold has its own key handlers. |
| Select | 25 native; Synth dock `role=menu`; Studio custom listboxes | Three models. |
| Number field | 11 `type=number`; about 33 `inputmode=decimal` | Three commit models: commit on blur (Synth), restore on blur (Inspector), `setField` (labs). The same `dual.a.freq` is a number field in Stereo and a unit-aware text field in Dual. |
| Jack / cable | Synth bay (`patch-bay.js`); Studio graph (`graph-geometry.js`, `graph-rewire.js`) | Two geometries and two connect models over one port typing. |
| On-screen keyboard | `midi/keyboard*.js`; canvas `role=img` | Not focusable or playable from the keyboard. Black keys are about 29 px at 390 px width. The 44-px test exempts one octave. |
| XY pad | `ui/kinds/xy-pad.js`; `ui/synth/xy.js` (395 lines) | `ui/synth/xy.js` is imported by no source module. `aria-pressed` sits on role=application. The axes report raw values while the knob reports 0..1000. |
| Envelope editor | `charts/envelope-graph.js` (drag only, aria-hidden) + sliders + fields; Synth knobs; Inspector | Three editors over one law. English aria-labels. |
| Filter editor | `charts/filter-chart.js` | A press anywhere jumps the cutoff. The wheel always changes Q with `preventDefault`. `touchAction:none` covers the whole plot. |
| Timeline / clip | `timeline-editor.js`, `compact.js`; Sequencer timeline | Shift is fine in the Studio; the Sequencer uses Alt+arrows. |
| Step grid | `ui/kinds/step-grid.js` | Good (role=grid, 44-px cells, one tab stop); Shift means "extend" or "octave" depending on the key. |
| Tabs (19 in 8 tablists) | `app.js tab()`, Studio subview, Presets, Synth | The Synth tablist has no roving and no arrows. The Studio ignores Up/Down. |
| Collapse / fullscreen | `<details>`, Alpine `collapsed.*`, Synth `data-collapse`, nav groups; two fullscreen toggles | The `#i-expand` icon means fullscreen in three places and navigation in one (`index.html:1665`). |
| Formatters | about 30 | Frequency is "2.40 kHz" in one place and "2.4 kHz" in another. Cents use "−5 cents" and "-5 ct". Booleans read "On/Off" (English). |

## The fifteen most important problems, ranked

1. **One parameter, two behaviours.** The same StudioModel parameter behaves differently on
   the Synth knob and in the Inspector: different value model, keys, wheel, reset, format and
   commit (`knob.js:303,475,529`; `inspector-fields.js:17-30`; `inspector.js:630-660`).
2. **Escape that closes a menu also stops all audio.** The menu listener on `document` does
   not stop propagation (`ui/app.js:302-309`), and the window dispatcher then runs stopAll
   (`keys/clients.js:33-41`).
3. **Escape in an Inspector field stops the Studio transport.** The field restores its value
   without stopping propagation (`inspector.js:635-639`). The Studio Escape branch runs before
   its editing-target check (`workspace/graph.js:33-51`).
4. **The key-listener ratchet is blind to wrapper helpers.** Its regex
   (`keys-registry.test.mjs:140`) misses:
   - `on()` and `listen()` wrappers: `step-grid.js:317`, `xy-pad.js:442,456`,
     `envelope.js:106,110`, `sequencer-panel.js:653`;
   - Alpine `'@keydown'` objects: `app.js:332,348`, `workspace/navigation.js:108`.
5. **Native `disabled` hides the reason for a refusal.** This affects the dual preset chips
   (`index.html:2092`) and the Measure buttons (`:999,1028,1066,1346`). The Synth already does
   it right: `aria-disabled` plus a reason (`face.js:87`).
6. **ARIA value models disagree** between the knob (a 0..1000 position) and the XY pad (raw
   values).
7. **Printed key letters assume QWERTY on a Czech QWERTZ layout.** The readout and
   `aria-keyshortcuts` hard-code "Z / X / C / V" (`keyboard-ui.js:175`,
   `index.html:2158-2167`). The registry matches by code, while the Studio matches by
   character (`graph-keys.js:63-88`).
8. **Shift and PageUp mean different things per control.** Shift is fine adjustment, ×4,
   extend or octave; PageUp is 10 %, an octave, the Y axis or a semitone.
9. **Four tab implementations.** The Synth tablist has no roving and no arrows.
10. **One concept, several names.**
    - Gate: "Gate", "Brána", "Hradlo".
    - Gain: "Zesílení" and "Gain".
    - Velocity: "Úhoz", "Síla úhozu", "Velocity".
11. **Canvas prompts name a control that no longer exists** ("press HOLD TO PLAY",
    `waveform.js:281`, `spectrum-data.js:26`).
12. **The filter chart traps scroll and pointer** on a phone.
13. **Keyboard keys are below the touch-target size:** black keys are about 29 px wide. The
    canvas keys cannot be reached from the keyboard.
14. **Read errors are reported as something else.**
    - A failed finding read shows as "deleted in another tab" (`findings.js:270-275`).
    - A failed list read shows as empty (`connections.js:152-154`).
    - A MIDI `open()` rejection is silent (`midi/support.js:174`).
    - A tainted canvas is dropped from an export without notice (`exporters.js:79`).
15. **Dead and duplicate code in the pad and slider families.**
    - `ui/synth/xy.js` is unused.
    - Two slider fill formulas.
    - Two `DRAG_THRESHOLD_PX` constants.
    - The expand icon has two meanings.

Problems 2 and 3 are behaviour bugs with a one-line cause each. They are scheduled as the
first fix slices (R-fix-1, R-fix-2 in `06-plan.md`).

## Interaction contract per family (the specification)

These contracts build on what exists: the knob core, the key registry, `ui/keys/roving.js`,
and the models #449 chose. **One model per family; a visual difference is a skin.**

- **Knob.**
  - `ui/synth/knob.js` is the one value model for every parameter control (Synth knob and
    amount, Inspector, XY axes).
  - Keys: arrows step, Shift fine, PgUp/PgDn 10 %, Home/End to the limits.
  - Enter opens typed entry. Enter or blur commits a valid value. Escape restores it and stops
    propagation. An invalid value keeps `aria-invalid` until it is corrected.
  - Double-click or Delete resets to `defaultValue(p)`.
  - Pointer: vertical drag over 200 px; Shift ÷10, re-anchored.
  - Wheel: acts only while hovered or focused, and makes one undo burst.
  - ARIA: a 0..1000 position plus `aria-valuetext` from `formatValue`.
- **Slider.**
  - A knob skin on a track, or a native range driven by the knob's mapping.
  - The same keys, fine modifier, reset and valuetext as the knob.
  - One fill helper. A 44-px thumb under a coarse pointer in every engine.
- **Switch.**
  - `role=switch` plus `aria-checked`, through one binder (`bindSwitch` promoted). The lever is
    a skin.
  - Space or Enter toggles. A disabled switch uses `aria-disabled` plus a described reason.
- **Segmented choice.** A radiogroup through `ui/keys/roving.js`: one tab stop, arrows move and
  select, and a focused option takes the wheel.
- **Button.**
  - Native, with a visible Czech label. An icon-only button carries a Czech aria-label and a
    matching title.
  - A refusal always states its reason (`aria-disabled` plus describedby, never a bare
    `disabled`).
- **Select.** Native. A custom menu is used only for rich rows, through `roving` with menu
  semantics.
- **Number field.**
  - One `inputmode=decimal` text field, parsed by the parameter's parser (units, k, decimal
    comma). No `type=number`.
  - Commits on Enter or change. Escape restores without touching audio.
- **Jack and cable.**
  - One `patch-bay.js` model with one geometry.
  - Tap-tap or drag. Enter or Space picks a jack; `C` lists the compatible jacks; Delete
    removes the selected cable; Escape cancels.
  - Each jack's name states its type and its connections.
- **Keyboard.**
  - `midi/keyboard.js`, matched by code.
  - Every printed letter comes from a layout map, with a QWERTZ fallback table.
  - The canvas is focusable (`data-keys-focus="piano"`), so arrows and Enter play.
  - Black keys are tappable at 44 px.
- **XY pad.**
  - One `xy-pad.js` model whose axes are knob sliders. Arrows move per axis; Enter gates.
  - `ui/synth/xy.js` is removed.
- **Envelope editor.** One editor over `audio/envelope.js`. Its four handles are knobs, and
  canvas drag is an addition, never the only way to edit.
- **Filter editor.**
  - The cutoff and Q handles are knobs. A drag starts only on a handle.
  - Touch scrolls the page anywhere else, and the wheel follows the knob's rules.
- **Timeline and clip.**
  - Arrows move, Shift fine, Alt coarse, everywhere (the Sequencer too).
  - Enter edits, Delete removes. Escape cancels a gesture before anything else.
- **Step grid.** Keep W008. Shift means "extend"; transposition moves to Alt.
- **Inspector.** Built only from the knob, slider, switch and choice models. Announcements are
  in Czech.
- **Tabs.** One `tab()` binder on `roving` for every tablist: horizontal, wrapping, Home/End,
  selection follows focus, `aria-controls`.
- **Collapse and fullscreen.**
  - Collapse is a button with `aria-expanded`; `<details>` stays only for phone folds.
  - One fullscreen toggle with `aria-pressed`, a Czech enter/exit label, and Escape to exit.
  - An expand icon never means navigation.
- **Key routing.**
  - Every key goes through the registry with its `focus: text | dialog | piano` scopes.
  - A local handler that consumes a key stops propagation.
  - "A modal is open" is defined once, in `focusOf`.
  - The ratchet also counts `on()`, `listen()` and Alpine `@keydown`.
