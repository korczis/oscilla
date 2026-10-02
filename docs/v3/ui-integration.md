# MEASURE and EXPERIMENTS: UI integration contract

How the DOM/Alpine layer will bind the pure view models in `src/js/measurement/views/`
(specification §72-§78, §105-§122, §150-§151, §156-§161, §238-§239). The view modules turn
engine events, `MeasurementResult`s, `QualityAssessment`s and `Experiment`s into plain
descriptors; the integration step only renders them. Nothing in the UI computes a level, a
mask, a range or a label: if a value is not in a view model, it is not shown.

Status: the view models and their unit tests (`tests/unit/v3-views.test.mjs`) exist; the DOM
integration described below does not yet. Nothing in `src/index.html`, `src/styles`,
`src/js/ui` or `src/js/charts` uses these modules yet.

## Modules

| Module | Input | Output |
| --- | --- | --- |
| `views/common.js` | — | quantity kinds (REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED, NORMALIZED, SMOOTHED, DELTA), UNKNOWN / NOT MEASURED / UNCALIBRATED words, colour roles, status presentation (glyph, icon, shape), line styles, mask splitting, axis helpers, `levelAxis()` |
| `views/measure-flow.js` | engine state, preflight report, recipe, calibration, result, progress | `measureFlow()` 7 steps + primary action; `expertFields()` with basic/advanced disclosure; `recipeFromFields()`; `CHARACTERIZE_PLAYBACK_CHAIN`; `OUTPUT_LEVEL_CHOICES`; `safetyNotes()`; `ROOM_NOTES` |
| `views/quality-bar.js` | engine events (incl. progress `capture` chunks) | `reduceQualityBar()` / `qualityBarView()` (INPUT, NOISE, CLIPPING, SIGNAL, CAPTURE); `qualityPanel(assessment)` |
| `views/response-chart.js` | engine result or Experiment | `buildResponseView()`: x, axes, series, bands, markers, badges, notes, summary, `readout(i)` / `readoutAt(hz)` |
| `views/ir-chart.js` | IrResult | `buildIrView()`: ms re direct peak, absolute origin, window region, decimated series |
| `views/rta-chart.js` | RtaResult (or FFT bins), averager state | `buildRtaView()`: bars over band edges, peak ticks, labels, summary |
| `views/experiment-summary.js` | Experiment, store `list()` rows | `experimentSummary()` (§161), `experimentListRows()` |
| `views/compare-view.js` | 2+ Experiments | `buildCompareView()`: common config, differences, overlay, A − B |
| `views/announcements.js` | engine events | `reduceAnnouncements()` / `announce()` (§151) |

Every module is pure (no DOM, no uPlot instance, no clock, no globals) and never mutates its
input. Reducers return new state objects; the Alpine component keeps the latest state and the
latest view model, never the engine or its buffers (Alpine reactivity must not wrap typed
arrays or the engine; keep them in closure variables, as `AudioEngine` is kept outside
Alpine's reactive state today).

## Event wiring

```js
// one engine per page (engine.js); io = capture.js browser adapter
let bar = initialQualityBar();
let said = initialAnnouncements();
const engine = createMeasurementEngine({ io, assess: assessMeasurement, onEvent(e) {
  bar = reduceQualityBar(bar, e);
  const a = reduceAnnouncements(said, e);
  said = a.state;
  if (a.message) liveRegion(a.message.politeness).textContent = a.message.text;
  ui.qualityBar = qualityBarView(bar);          // plain data for Alpine
  if (e.type === 'state' || e.type === 'preflight' || e.type === 'noise') ui.flow = flowNow();
} });
```

- Progress text comes only from engine events (audio clock, §110); the UI does not run a timer.
  A frame loop may call `engine.progress()` and feed it as `{ type: 'progress', ...p }`.
- Announcements: two regions, `role="status" aria-live="polite"` and `aria-live="assertive"`
  (terminal failures), `.osc-sr-only` like the existing status region in `index.html`. One
  message per stage; never write progress percentages into a live region.
- Escape / STOP call `engine.abort('user')` (§111); the existing Escape handling that stops the
  sequencer stays first in line.
- Known gaps for the integration step: capture chunks are `{ frames, framesTotal }` today; when
  `capture.js` adds `{ peak, rmsDb }` per chunk the bar shows live CLIPPING and SIGNAL ACTIVE
  without code changes (until then it says NOT CHECKED YET / STIMULUS PLAYING). The engine's
  state events do not say whether a READY came from `preflight()` or `measure()`, so a
  measurement without a noise check also announces "Setup check complete: ready".

## Workspaces and navigation

- `src/js/ui/app.js` `MODES` gains `'measure'` and `'experiments'`; `setWorkspace()` and
  `navItem()` are reused unchanged. Nav entries go after Playground, in the §73 order:

  ```html
  <li><a class="osc-tab" href="#osc-panel-measure" data-osc="nav.measure"
    x-bind="navItem('measure')">Measure</a></li>
  <li><a class="osc-tab" href="#osc-panel-experiments" data-osc="nav.experiments"
    x-bind="navItem('experiments')">Experiments</a></li>
  ```

  The nav is a list of links with `aria-current="page"` (not a roving tablist); keyboard
  roving (`ROVING_ROLES` tab/radio, `rovingKeydown`) applies inside the panels: result tabs
  (Frequency response / Impulse response / RTA) are `role="tab"` via the existing tab binding,
  segmented choices (output level, smoothing, RTA mode, averaging) are `role="radio"` via
  `choice(key, value)`.
- Panels: `<section class="osc-panel" data-osc-modes="measure">` (STIMULUS, LIVE INPUT,
  QUALITY, MEASUREMENT RESULT, MEASUREMENT SETUP, EXPERIMENT) and `data-osc-modes="experiments"`
  (list, detail, compare). Like the Learn and Presets sections they carry
  `hidden :hidden="workspace !== 'measure'"` so the 768-1279 px two-column layout, which shows
  every panel, keeps the V2 workspaces unchanged.
- ≥ 1280 px focus grid (`src/styles/integration.css`): add `[data-mode="measure"]` and
  `[data-mode="experiments"]` to the `:is(...)` lists of the 12-column focus layout and the
  `.osc-panel:not([data-osc-modes~="…"])` hiding rule. Proposed spans (§72, §116): row 1
  STIMULUS 4 | LIVE INPUT 4 | QUALITY 4; row 2 MEASUREMENT RESULT 12; row 3 SETUP 7 |
  EXPERIMENT 5. EXPERIMENTS: list 5 | detail or compare 7.
- < 768 px (§115): the nav already becomes the workspace switcher. MEASURE shows the guided
  flow first, in the order status (quality bar) → stimulus → input → result → save; expert
  fields (`expertFields({ disclosure: 'advanced' })`) sit in a collapsed panel using the
  existing `collapse` state; the dense cockpit is not squeezed to 390 px.
- `tests/browser/layout.cjs`: `WORKSPACES` gains `'measure'` and `'experiments'`; the covered
  check gains the MEASURE primary action button (e.g. `osc-measure-primary`) and STOP.

## Charts

All quantitative charts reuse the uPlot conventions of `src/js/charts` (`chartTheme()`,
`uplotAxis()`, `withAlpha()`, `formatHzTick`, `formatDbTick`, `observeSize`, the shared frame
loop). From a view model:

- x scale: `axes.x.uplot` (`distr: 3, log: 10`) and `range: () => axes.x.range`; splits
  `axes.x.ticks`, values `axes.x.tickLabels`. y: `range: () => axes.y.range`, splits
  `axes.y.ticks`; the axis title is `axes.y.label` (+ `axes.y.unit` in the legend/readout).
- one uPlot series per descriptor: `stroke = withAlpha(theme[MEASUREMENT_ROLES[role].token],
  alpha)`, `width`, `dash`, `points: { show: false }`; `null` values are gaps (`spanGaps`
  off). Unreliable stretches are their own dashed, faded series (§156), so no per-segment
  styling is needed.
- `bands[]` → uPlot `bands: [{ series: [upperIdx, lowerIdx], fill: withAlpha(colour, alpha) }]`
  (the run-spread envelope).
- `markers` (requested range, calibrated range, window region) are drawn in a `draw` hook like
  the dashed requested-frequency marker of `spectrum-chart.js`; shaded uncalibrated or
  unreliable spans additionally get a hatch so they do not differ by colour alone.
- cursor: `setCursor` hook → `view.readout(u.cursor.idx)` → `.osc-chip-readout` chip; the chip
  shows `readout.lines`, never a raw float.
- RTA bars: a `draw` hook (or the custom canvas style of `bio-chart.js`) fills each bar from
  `valToPos(bar.lo)` to `valToPos(bar.hi)`, height `bar.value`; `underResolved` bars hatched;
  `peaks[]` as dashed horizontal ticks. Live 30 fps RTA rebuilds the view per averager frame
  (tens of bands); the live FFT stays on the V2 `spectrum-chart.js` path and `buildRtaView({
  fft })` serves frozen or stored spectra.
- every chart has its text summary (`view.summary`) in an associated `aria-describedby`
  element (§150); points are never exposed to assistive technology.
- views are rebuilt when a result or an option (smoothing, normalization, scale, window)
  changes, not per frame.

## Labels the UI must keep

- Levels: `RELATIVE_SCALE_LABEL` / `RELATIVE_UNIT` (calibration/level.js) unless a valid
  `LevelCalibration` applies (`levelAxis()`), then "dB SPL" with the CALIBRATED indicator
  (§24). The frequency response is a ratio: its unit is `TRANSFER_RATIO_UNIT` and it never
  becomes dB SPL (experiments/csv.js, G19); with a level calibration the view adds
  `RATIO_NOT_LEVEL_NOTE`.
- Derived views name themselves in every series label and in `badges`: "SMOOTHED: 1/N octave
  (power mean)", "NORMALIZED: 0 dB at 1 kHz", IR "NORMALIZED: dB re IR peak". RAW stays
  visible (faded) behind a derived view.
- The device characterization preset's result is "OBSERVED PLAYBACK / CAPTURE CHAIN RESPONSE"
  (§106); output levels are LOW / MEDIUM / HIGH digital peaks, never SPL (§208).
- Missing data reads UNKNOWN, NOT MEASURED, UNCALIBRATED, UNAVAILABLE or NOT ASSESSED (§249).

## Visual identity constraints

Rule `project.visual-identity-lock` (on `feature/v31-studio`) and spec §117-§118 apply: the
MEASURE and EXPERIMENTS surfaces are built from the existing panels (`.osc-panel`, panel
header, `.osc-tabs`, segmented controls, `.osc-chip-readout`, `--osc-info-*` / `--osc-warn-*`
alerts), typography and chart styling. No new colour family is introduced.

Measurement colour roles (`MEASUREMENT_ROLES`) map onto existing semantic tokens:

| Role | Token (chart key) | Existing use in V2 |
| --- | --- | --- |
| requested / generator | `--osc-blue-trace` (`trace`) | "Generator (target)" trace, filter curve |
| observed | `--osc-green` (`green`) | "Microphone (live)" trace, PLAYING |
| calibrated | `--osc-purple` (`purple`) | spectrum legend, chirp block |
| derived (A − B delta) | `--osc-cyan` (`cyan`) | cyan accent |
| warning | `--osc-orange` (`orange`) stroke/icon; panels `--osc-warn-bg` / `--osc-warn-border` | pulse block, release, warning alert |
| invalid | `--osc-red` (`red`) | record key |
| neutral / not assessed / markers | `--osc-text-muted` (`textMuted`), `--osc-text-dim` | secondary readouts, axis ticks |
| info | `--osc-info-icon` with `--osc-info-bg` / `--osc-info-border` | Device & Limits alert |
| compared experiments A, B, C, D | observed, requested, calibrated, warning (`COMPARE_ROLES`) | — |

Unreliable = the role colour at alpha 0.45 and dashed `[4, 4]` (the V2 BYPASSED convention of
`filter-chart.js`); envelopes = role colour at alpha 0.12 (the V2 trace fills).

Status presentation (§118) never relies on colour: each status has text, a glyph, a lucide icon
(inlined with `<!-- @icon:<name> -->`) and a shape class. New CSS classes, built only from the
tokens above: `osc-q`, `osc-q--ok|warn|fail|pending|unknown|info` and
`osc-q-shape--circle|triangle|octagon|ring|dashed|square`.

| Status | Glyph | Icon | Shape |
| --- | --- | --- | --- |
| ok | ✓ | `circle-check` | circle |
| warn | ! | `triangle-alert` | triangle |
| fail | ✗ | `circle-x` | octagon |
| pending | … | `loader-circle` | ring |
| unknown / not measured | ? | `circle-dashed` | dashed |
| info | i | `info` | square |

Light theme: `--osc-orange` and `--osc-red` have no light-theme values in `tokens.css`; orange
on white is about 1.9:1, so in the light theme warning text is `--osc-text` on
`--osc-warn-bg` and orange is used for icons and strokes beside a glyph. A light value for
`--osc-orange` is a proposed extension of the existing token (not a new family), to be decided
in the integration step.
