# 01. Architecture inventory and ownership map

Product reconstruction, deliverables 1, 5, 6 and 12 (architecture inventory, current
information architecture, duplication report, state ownership map). Measured read-only on
`main` at `c3b15610`, 2026-11-24. Line references are to that commit; they drift,
so re-measure before acting on one. Anything not confirmed directly is marked INFERRED.

## 1. Composition

**One Alpine component.** `src/index.html:128` carries the page's only `x-data`:
`<div class="osc-app" x-data="oscilla" :data-mode="workspace">`.
`registerOscillaUi` (`ui/app.js:691-694`) registers it, built by `createOscillaComponent`
(`main.js:883-958`).

- **Merge order.** `compose()` (`main.js:639-645`) merges the parts with
  `Object.defineProperties`, and the last part wins. The order is: instrument, ui (shell +
  `createShell()`), workbench, measure, experiments, findings, connections, studio, navigation,
  midi, crossLinks, provenance, about, proClasses, `TEMPLATE_HELPERS`, `busArmed`
  (`main.js:922-924`).
- **No collision check.** A name defined by two parts is settled silently by that order.
  Example: the shell's `theme` and `waveform` override the instrument's (`main.js:11-13`,
  `app.js:267,275`).
- **Spread exceptions.** The "never spread" rule is broken in two places, safe only because
  the spread parts have no getters today:
  - the Studio part spreads the Synth part (`ui/studio/workspace.js:484`, `:589`);
  - the instrument spreads `V1_LAB_HOOKS` (`core/instrument.js:1083`).
- **`init` order is a hidden contract** (`main.js:937-956`): the bus leave-watch runs first,
  then shell, measure, experiments, findings, studio, midi, `integrationInit`. The Studio's
  window keydown listener must register before the page dispatcher (`main.js:949`,
  `workspace.js:531-534`).
- **Non-reactive services sit in closures:** engine, bridge, labs, adapter
  (`main.js:110-186`), the output bus (`:292`), trace (`:291`), the Studio `ctx`, the measure
  `ctx`.
- **Four event channels run beside Alpine reactivity:**
  - `osc:ui` CustomEvents (`app.js:312-317`), read by the labs;
  - adapter listeners (`main.js:122-156`);
  - `bus.subscribe` / `onStop`;
  - `engine.on`.

### Panels, views and the workspaces that show them

| Element | Line | `data-osc-modes` | Visibility mechanism |
|---|---|---|---|
| source | 489 | playground sequencer synthesis | CSS |
| analysis | 699 | playground analyzer synthesis | CSS |
| spectrogram | 796 | analyzer | CSS; hidden on the Playground at 1536 px and wider (`instrument.css:100-104`) |
| mic | 845 | analyzer compare | CSS |
| device | 898 | analyzer | CSS |
| measure-view | 970 | measure | `:hidden` on workspace (972); the Playground shows only its flow card (`instrument.css:108`) |
| sequencer | 1471 | sequencer | CSS; also on the Playground from 768 px |
| studio.compact | 1640 | playground sequencer | CSS + `workspace==='synth' && 'hidden'`; `studio.css:26-29` |
| filter | 1644 | filter | CSS |
| envelope / additive | 1721 / 1783 | synthesis | CSS |
| phase | 1840 | compare synthesis | CSS |
| bio | 1932 | compare | CSS |
| dual | 1973 | synthesis | inside `.osc-workspace`, `display:none` outside synthesis (`instrument.css:149-157`) |
| experiments-view | 2196 | experiments | `:hidden` on workspace |
| learn-view / presets-view | 2586 / 2626 | learn / presets | `:hidden` on the **V1 `mode`**, not on workspace |
| synth-view / studio-view / about-view | 2731 / 2824 / 2988 | own | `:hidden` on workspace |

**Six mechanisms decide which panel shows.** The registry (`ui/shell.js`) names the
workspaces, but it owns none of these:

1. `data-osc-modes` in the markup.
2. `.is-focused`, set by `markWorkspacePanels` (`app.js:185-192`), which drives the rule below
   1536 px (`responsive.css:51`).
3. A hard-coded list of five modes at 1536 px and wider (`integration.css:496-500`).
4. Playground and Studio special cases (`instrument.css:100-161`, `studio.css:18-31`,
   `measure.css:15`).
5. `:hidden` bindings on the views.
6. `workspace==='synth' && 'hidden'` on containers (`index.html:484, 1468, 1641, 1970`).

There are 84 `data-mode` selectors across five stylesheets. The Playground's composition also
changes with width:

| Width | What the Playground shows |
|---|---|
| 1536 px and wider | the lab panels are hidden |
| 768 to 1535 px | every panel shows |
| phone | only the panels listed for the Playground |

The census note in `tests/unit/surface-census.json` contradicts the CSS.

## 2. Routing and URL state

- **One dispatcher** (`ui/navigation.js`, ADR 0045). `routeOfHash` (`:133-152`) tries, in
  order: Studio keys, `m`, record keys, `mr`, then the Playground.
- **Seven codecs** handle the hash:
  - instrument, labs, measure, studio and records register in `main.js:671-675`;
  - keyboard registers in `midi/keyboard-ui.js:242`;
  - synth registers in `synth/ui.js:808`.
- **History.** A workspace switch pushes a history entry (`:457-460`). Load and link replace
  the current one (`:419-428`, `:399`). Back and Forward are recognised by `HISTORY_STAMP`
  (`:393-396`).
- **Writes outside the dispatcher.** Every Copy-link action calls `replaceState` directly:
  `core/instrument.js:1089`, `ui/studio/workspace/navigation.js:193`, `ui/measure/run.js:285`,
  `ui/measure/input.js:80`, and probably `synth/ui.js:886` (INFERRED). The address does not
  follow live state.
- **Unsaved-work guard** (`ui/unsaved.js`). It covers studio, measure, experiments, findings and
  sequencer. It does not cover the labs or the instrument, and Back/Forward never trigger it.

| Parameter | Where | Owner |
|---|---|---|
| `m` | hash | route; the instrument also writes it as the V1 mode (`url-state.js:38`) |
| `v s p w f g d a r rm x` | hash | instrument (`core/url-state.js:37-54`) |
| `lab` | hash | labs (`url-state-labs.js:17`) |
| `mr` | hash | measure recipe |
| `st`, `sv` | hash | Studio template, subview |
| `exp`, `def`, `finding` | hash | records |
| `kbd` | hash | keyboard arm |
| `yt ye yp yv yc` | hash | Synth tab, engine, preset, values, cables |
| `?debug=1`, `?measure=loopback`, `?mock=1` | query | debug panel, loopback test context, mock |

## 3. State owners

| Domain | Owner | Writers | Readers | Persistence |
|---|---|---|---|---|
| Audio | `AudioEngine`, one AudioContext | instrument, labs (adapter), Studio runtime, MIDI notes | bridge, labs, measure | none |
| Output owner | `core/output-bus.js` (`OUTPUT_OWNER_TABLE`) | `bus.claim/release/stopAll` | workbench, keyboard, Synth | none |
| Instrument params | `core/instrument.js` | markup, presets, hash | workbench, status bar | hash on Copy; `oscilla.presets` (local), `oscilla.history` (session) |
| Lab settings | `labs/*` controllers, non-reactive | panel DOM, `applyLabSections` | `labFlags`, export | `lab=` on Copy, config file |
| V2 sequence | `sequencer/model.js` + `editor.js` (own undo) | `labs/sequencer-panel.js` | `seqRev`, `seqDigest` | config export only |
| Studio document, selection, undo | `studio/actions.js` store behind `ctx.handle` | graph, inspector, timeline, compact, Synth, Drums, step strip | the same | IndexedDB `oscilla-experiments` (Studio partition) |
| Synth patch | the Studio store | knobs via `NODE_PARAM_SET` | Synth view, Inspector | hash `y*`, patches in IndexedDB |
| Measurement | `ui/measure/session.js` + `measurement/engine.js` | `ui/measure/*` | Studio task strip | saved as an experiment |
| Experiments, findings | `experiments/store.js` (`oscilla-experiments`) | `ui/experiments.js`, `findings.js` | connections, Studio library | IndexedDB, memory fallback |
| Calibration | `meas` + `ui/measure/calibration.js` | dialogs | measure engine | in experiment files; level calibration in page memory only |
| UI preferences | `app.js`, `shell.js` | shell | shell | `oscilla.v2.theme`, `.analysisTab`, `.sidebar`, `.navGroups` |
| Safety notice | instrument | — | — | session `oscilla.safetyNoticeCollapsed` |

`oscilla.theme` (`constants.js:46`) is declared but never read: a dead V1 key.

## 4. Second sources of truth and duplicated paths

- **UI mirrors of canonical state.**
  - `filterType` (`app.js:278`) is written only by `setChoice`; the Filter Lab listens one-way.
  - `inputMode`↔`noteMode`, `dualRoute`/`stereoRoute`↔`dual.stereo` and `sourceKind` are kept
    in step by effects (`main.js:743-749, 838`).
  - `mode`↔`workspace` is written in two places (`main.js:739`, `navigation.js:351`).
  - `seqPlaying` is a 150 ms copy of the bus state.
  - `studio.masterLevel` is cleared by a watch (`main.js:755-758`).
- **Two synthesis paths.** The V1 `engine.play` voice with lab inserts (`main.js:21-27,
  299-307`) runs beside the StudioModel graph that the Synth plays.
- **Three sequencing engines across eight surfaces.**
  - Engines: V2 blocks, with their own undo and transport (`sequencer/transport-handle.js`);
    the StudioModel timeline and notes clips; the instrument's user-step pattern.
  - Surfaces: source steps, Pattern Sequencer, Studio timeline, notes-clip step grid, Synth
    step strip, Drums tab, step-voltage nodes, riffs.
  - The only bridge between engines is a one-way import (`studio/sequence-import.js`).
- **Three parameter editors.**
  - the Synth knob (`ui/synth/knob.js` + `synth/view/knob.js`);
  - the Inspector fields (`inspector-fields.js`);
  - the Playground `.osc-slider` (`app.js:76-91`, 19 instances).
- **The experiment store is opened twice**, by Experiments (`experiments.js:258-268`) and by the
  Studio library (`workspace/files.js:103-112`). Under the memory fallback that is likely two
  separate stores (INFERRED).
- **Three menu systems.** The `app.js` `menus`, the Synth dock's `open`, and Flowbite JS.
  Flowbite JS is initialised (`flowbite.js:46`), but no element uses its `data-*-toggle` API.
- **Six transports:** the status-bar Play, the instrument's Hold/Trigger, the Sequencer, the
  Studio bar, the compact Studio, and Drums Play/Arm.
- **Six preset families:**
  - instrument presets;
  - `data/presets.js`;
  - Synth presets;
  - Studio node presets;
  - patches;
  - Studio templates.

  The patch library unifies four of them (plus XY recipes and riffs); the instrument presets
  stay outside it.
- **Four ways of building DOM:** Alpine markup, `h()` (`graph-dom.js`), HTML strings
  (`synth/view/face.js`), and lab DOM (`labs/dom.js`).

## 5. Dialogs, overlays, docked controls

Native dialogs (`index.html:3309-3923`) are managed by `ui/dialogs.js`. They belong to these
parts:

| Owner | Dialogs |
|---|---|
| instrument | save, headphones, copy |
| `dialogs.js` | help, settings (including all of MIDI) |
| measure | level-cal, cal-convention, recipe-link |
| experiments | def, rename, delete |
| findings | finding, finding-delete |
| studio | templates, link, add, connect, find, render, library, patch |

The rest of the persistent chrome:

- **Page furniture:** header (133), sidebar/drawer (253), toasts (325), hints (353), safety
  notice (365), page header with Related strip (396, 427).
- **Status bar** (3204), owned by the workbench.
- **Keys dock** (2107), owned by `midi/keyboard-ui.js`. It is docked in every workspace except
  the Playground (`KEYBOARD_VIEWS = WORKSPACE_IDS`, `keyboard.js:38`).

## 6. Keyboard

The registry (`ui/keys/registry.js`) and its one dispatcher bind four chords: Escape, Space,
the dock key and Record (`keys/clients.js:33-49`). Everything else uses its own listener.

- **The ratchet.** `tests/unit/key-listener-baseline.json` counts about 40 own listeners. Its
  regex (`keys-registry.test.mjs:140`) misses listeners bound through helpers:
  `labs/sequencer-panel.js:653`, `labs/envelope.js:106,110`, `ui/kinds/xy-pad.js:442,456`,
  `ui/kinds/step-grid.js:317`.
- **Studio precedence** comes from registration order plus `stopImmediatePropagation`
  (`workspace/graph.js:42-63`).

## 7. Theme and tokens

- **Size.** `src/styles/` holds 8,681 lines: tokens 246, instrument 1400, studio 1526, measure
  1225, studio-timeline 931, components 840, integration 730.
- **Theming.** `tokens.css` holds the `--osc-*` variables. `tailwind.config.cjs` keys dark mode
  on `data-theme`, and its `primary` is the blue scale. `ui/pro-classes.js` holds the named
  Pro class lists, and `ui/theme.js` bridges the tokens into the charts.
- **Two synth token modules:** `ui/synth/tokens.js` and `synth/view/tokens.js`.

## 8. Size

| Module | Lines |
|---|---|
| `src/index.html` | 3927 |
| `ui/studio/inspector.js` | 1500 |
| `core/instrument.js` | 1269 |
| `ui/studio/timeline-editor.js` | 1205 |
| `main.js` | 1076 |
| `ui/experiments.js` | 1014 |
| `sequencer/editor.js` | 947 |
| `synth/ui.js` | 927 |
| `ui/synth/knob.js` | 821 |
| `ui/workbench.js` | 809 |
| `ui/app.js` | 694 |

`ui/` holds 132 files and 31,801 lines; `ui/studio/` is 45 of those files and 13,016 of
those lines.

## 9. Ownership map

| Part | Responsibility | State owner | Consumers | Contracts and tests | Duplication | Migration risk |
|---|---|---|---|---|---|---|
| `main.js` | services, composition | closures | Alpine | `app.cjs`, `window.OSCILLA` | 4 event channels | high: implicit order |
| `ui/app.js` | workspace, tabs, choices, menus, theme | `workspace` | markup, navigation, keys | `navigation.test`, `workspace-registry.test` | mirror choices | high |
| `ui/shell.js` | registry, sidebar, drawer, search | registry rows | app, navigation, About, shortcuts, README | `ui-shell`, `workspace-lists-derived` | does not own panel membership | medium |
| `ui/navigation.js` | hash dispatcher, history | `nav` closure | 7 codecs | `navigation.test`, `navigation.cjs` | out-of-band `replaceState` | high: deep links |
| `core/instrument.js` | V1 voice | reactive fields | workbench, status bar | `core.test` | `mode`/`workspace` | medium |
| `core/output-bus.js` | single output owner | bus | every player | `output-owner-one-table` | none | low |
| `labs/*` | lab panels | controller closures | `applyLabSections` | `labs.cjs` | shell mirrors | medium |
| `ui/measure*` | MEASURE | `meas` + `ctx` | Studio, Playground | `v3-measure.cjs`, visual `measure/` | none | medium: integrity |
| experiments, findings, connections | records | IndexedDB | navigation records domain | `storage-inventory`, `journeys` | store opened twice | medium |
| `ui/studio/workspace.js` | Studio and Synth host | StudioModel store | Synth, compact, keyboard | `v31-studio-*.cjs` | spreads | high |
| `synth/ui.js` | Synth projection | StudioModel | dock, keys | `synth.cjs`, `knob.cjs`, `drums.cjs` | knob vs Inspector | medium |
| `midi/*` | keys, MIDI, dock | `kbd*` + notes layer | every workspace | `midi.cjs`, `keys-routes.test` | own key listeners | medium |
| `ui/keys/*` | key registry | registry | dispatcher | `keys-registry.test` | 4 bindings only | low |

## 10. The ten problems that matter for a reconstruction

1. **Panel membership** is decided by six mechanisms that nothing coordinates (section 1).
2. **Each workspace has a dual identity:** the workspace and the V1 `mode`.
3. **One god-component of about 16 parts**, merged by order with no collision guard.
4. **The UI mirrors canonical state:** `filterType`, `inputMode`, `dualRoute`,
   `stereoRoute`, `sourceKind`, `seqPlaying`, `masterLevel`.
5. **Three sequencing engines** with separate undo and transports.
6. **Two synthesis paths.** The lab settings are outside the URL and outside the unsaved
   guard.
7. **Keyboard handling is fragmented:** about 40 own listeners against 4 registry bindings,
   and a ratchet blind to helper-bound listeners.
8. **The URL is a flat namespace** shared by seven codecs, with writers outside the
   dispatcher.
9. **Persistence is fragmented:** a store opened twice, a dead key, six preset families.
10. **Controls and DOM construction are duplicated:** three parameter editors, four ways of
    building DOM, and Flowbite JS shipped but unused.
