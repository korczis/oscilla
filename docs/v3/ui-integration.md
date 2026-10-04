# MEASURE and EXPERIMENTS: UI integration contract

How the DOM/Alpine layer will bind the pure view models in `src/js/measurement/views/`
(specification §72-§78, §105-§122, §150-§151, §156-§161, §238-§239). The view modules turn
engine events, `MeasurementResult`s, `QualityAssessment`s and `Experiment`s into plain
descriptors; the integration step only renders them. Nothing in the UI computes a level, a
mask, a range or a label: if a value is not in a view model, it is not shown.

Status: integrated. `src/js/ui/measure.js` and `src/js/ui/experiments.js` bind these view
models (with `src/js/ui/measure-experiment.js`, the pure experiment builder),
`src/js/charts/measure-charts.js` draws them with uPlot, `src/styles/measure.css` lays the
workspaces out; gated by `tests/browser/v3-ui.cjs`, `tests/unit/v3-ui.test.mjs` and
`scripts/visual-measure.mjs`. Where the integration differs from the plan below it says so in
"Integration notes" at the end.

## Modules

| Module | Input | Output |
| --- | --- | --- |
| `views/common.js` | — | quantity kinds (REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED, NORMALIZED, SMOOTHED, DELTA), UNKNOWN / NOT MEASURED / UNCALIBRATED words, colour roles, status presentation (glyph, icon, shape), line styles, mask splitting, axis helpers, `levelAxis()` |
| `views/measure-flow.js` | engine state, preflight report, recipe, calibration, result, progress | `measureFlow()` 7 steps + primary action; `expertFields()` with basic/advanced disclosure; `recipeFromFields()`; `CHARACTERIZE_PLAYBACK_CHAIN`; `OUTPUT_LEVEL_CHOICES`; `safetyNotes()`; `ROOM_NOTES` |
| `views/quality-bar.js` | engine events (incl. progress `capture` chunks) | `reduceQualityBar()` / `qualityBarView()` (INPUT, NOISE, CLIPPING, SIGNAL, CAPTURE); `qualityPanel(assessment)` |
| `views/response-chart.js` | engine result or Experiment | `buildResponseView()`: x, axes, series, bands, markers, badges, notes, summary, `readout(i)` / `readoutAt(hz)` (phase line where measured), `normalizationApplied` / `normalizationNote`, `phase`, `masterGain`; `normalizationAvailability()`; `buildPhaseView()` (expert phase over frequency) |
| `views/ir-chart.js` | IrResult | `buildIrView()`: ms re direct peak, absolute origin, window region, series decimated over the VISIBLE span only (`range` `[from, to]` or `'full'`); `buildIrOverlayView()`: two or more IRs at one rate, ms re each own direct peak, original scale (V356) |
| `views/rta-chart.js` | RtaResult (or FFT bins), averager state, a live-rta.js `viewInput()` | `buildRtaView()`: bars over band edges, peak ticks, labels, summary; `live` / `snapshotLabel` badge, fixed live axis (`liveRange`) |
| `views/experiment-summary.js` | Experiment, store `list()` rows | `experimentSummary()` (§161), `experimentListRows()` |
| `views/compare-view.js` | 2+ Experiments | `buildCompareView()`: common config, differences, overlay, A − B, IR overlay (equivalent sets only; `irDelta` always refused) |
| `views/input-devices.js` | enumerateDevices() result, chosen deviceId | `inputDeviceView()`: Default input first, real inputs with the browser's labels, a vanished choice kept and marked "not available" with its message (V322) |
| `core/url-state-measure.js` | setup values, location hash | `encodeRecipeLink()` / `decodeRecipeLink()` (the `mr` hash parameter; recipe only, refused whole when invalid), `recipeParamOf()`, `withRecipeParam()` (V355) |
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
  `peaks[]` as dashed horizontal ticks. The live RTA does not rebuild the view per frame: the
  chart draws the live frame's arrays in its `draw` hook (`setLive(frame)` + `redraw()`, no
  rebuild, no allocation; the FFT trace one vertex per pixel column) and the view model is
  rebuilt 4 times a second (`updateView()` keeps the uPlot when the axes did not change). See
  "Live RTA" below.
- every chart has its text summary (`view.summary`) in an associated `aria-describedby`
  element (§150); points are never exposed to assistive technology.
- views are rebuilt when a result or an option (smoothing, normalization, scale, window, IR
  span, response quantity) changes, not per frame. The IR view slices the visible span before
  it decimates, so every span change builds a new view (the Direct span of a 10 s sweep is
  drawn sample by sample).
- a view option never fails a measurement (M6): `measure.js` builds each view inside a guard
  (a failing view becomes a note in its panel), presents the result only after the engine has
  resolved, and disables a normalization whose reference lies outside the shown result's grid
  (`normalizationAvailability()`, `meas.normAvail`); a selection the new result cannot use
  resets to None.
- smoothing never crosses a coverage or reliability edge (m1): `response-chart.js` smooths each
  region (covered and reliable, covered and unreliable) with smoothing.js's `mask` option.

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
- Every response states the master output gain included in its magnitudes (M9); a stored
  quality verdict reads "as assessed by OSCILLA <version>, commit <c>, <rule set>" (M11), and
  the result hash names its version and what it covers.
- Phase (expert, m3): the response toolbar offers Magnitude / Phase; without a phase the panel
  says why (`PHASE_REASON_TEXT`: not requested, no alignment, alignment not robust, aggregate).

## Calibration in the MEASURE workspace

- Level calibration (M3). The dialog names the scale of the reading (`LEVEL_SCALE`: the
  one-third-octave band level at the reference frequency, dB re digital full scale on the
  mean-square scale, where a full-scale sine reads −3.01 dB — the noise and RTA band scale).
  "Capture reference" records `REFERENCE_CAPTURE_S` (3 s) through the SAME capture io as a
  measurement (`io.captureNoise`, stimulus-free; microphone or the loopback TEST CONTEXT) and
  reads the band with `calibration/reference.js`; a reading without a dominant tone or a
  clipped one is refused. Stop, Cancel, Escape (the dialog's close event) and leaving the
  workspace abort the capture; the input is released afterwards. The stored LevelCalibration
  (schema 2) carries method `captured`, the scale and the capture's input (hashed deviceId,
  sample rate, echo cancellation, noise suppression, AGC, channel count). Typing the reading is
  an advanced switch labelled with the same scale (method `manual`, bound to the current input
  when one is known).
- The level indicator reads UNCALIBRATED, with the reason in the panel and the indicator's
  title, whenever the current input (the latest setup check, result or reference capture)
  differs from the calibration's; such a calibration is neither applied to a measurement nor
  saved with an experiment. Before a measurement with a bound calibration and no known input,
  the setup check runs first so the input is known.
- Frequency profile (M4). The import states the sign convention and a one-point preview (the
  profile's largest value: "At 10 kHz the file states +2.10 dB; a reading of 0.00 dB becomes
  −2.10 dB"). A file whose header does not state the convention ("correction", "gain", "EQ",
  "cal", "value") opens the convention dialog (`osc-dlg-cal-convention`): nothing is loaded
  until "the microphone's deviation" or "a correction to add" is chosen, each with its preview.
- Files are size-checked before they are read (m6): 1 MiB for calibration, 32 MiB for
  experiments (`readFileText(file, { maxBytes })`).
- Profile export (V315). With a profile loaded, "Export CSV" and "Export JSON"
  (`measureExportCalibration`, `calibration/export.js`) download deterministic files named
  `<name>-<id prefix>.calibration.csv|json`; both import back through the same path to the same
  id and convention without the convention dialog (the CSV states it on `# convention:`).

## Input device in the MEASURE workspace (V322)

- The Live input panel has an "Input device" select (`#osc-m-input-device`,
  `measureSelectInput`). Its first option is "Default input (chosen by the browser and
  system)": no deviceId is requested, exactly as before. The other options are filled from
  `navigator.mediaDevices.enumerateDevices()` only after the microphone was opened (setup check,
  live RTA, reference capture; browsers hide the list before the permission) and on every
  `devicechange`.
- A chosen input is passed to `createCaptureIo({ deviceId })` (getUserMedia `deviceId:
  { exact }`); the capture io is re-created for it at the next capture, never while a
  measurement or reference capture runs (the select is disabled while busy). A READY setup check
  is reset, and the level calibration is checked against the new input first.
- Provenance: the result's `input.constraints.requested.deviceId` holds the raw id in memory;
  the experiment stores it hashed (`{ exact: 'sha256:…' }`, `schema.js normalizeInput`,
  `calibration/device-id.js`). The default input records no requested deviceId.
- A chosen input that disappears stays selected, its option reads "<label> — not available",
  the panel shows the message (`role="alert"`) and it is announced assertively. A setup check
  then fails at the input step with `INPUT_DEVICE_UNAVAILABLE_TEXT` (capture.js maps the
  OverconstrainedError / NotFoundError of `{ exact }`). Nothing switches microphones silently.

## Recipe link (V355)

- "Copy recipe link" (top of Measurement setup, `measureCopyRecipeLink`) writes
  `#…&mr=<base64url JSON>` with `history.replaceState`, keeping every other hash parameter (the
  instrument link), and copies the URL; without a clipboard the dialog `osc-dlg-recipe-link`
  shows it. The link holds the recipe fields only (`RECIPE_WIRE_KEYS`).
- `measureApplyRecipeHash` runs at start-up (from `measureInit`) and on `hashchange`. A valid
  recipe fills `meas.values` (absent keys take the CHARACTERIZE PLAYBACK CHAIN preset), resets a
  READY check, opens MEASURE and notifies "Measurement recipe loaded from the link"; it never
  starts a check or a measurement. An invalid one is refused whole (notification "Recipe link
  not applied" and the reasons under the button); a link opened while a measurement runs is
  refused too. The same `mr` value is applied once (the one this page wrote is not re-applied).

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

## Live RTA

Spec §44-§49, §122-§123, §150; plan V341-V344. The RTA tab of MEASURE analyses the input live.

- **Input**: "Start live RTA" opens the measurement input through the capture io's own
  permission path and constraints (`capture.js` `openLiveTap`): one `AnalyserNode` on the
  `MediaStreamAudioSourceNode` (or the TEST CONTEXT loopback), configured like the V2 microphone
  analyser (`audio/microphone.js` `configureAnalyser`), never connected to the destination. Its
  time-domain samples are read with the V2 reader (`analysis/analyser.js`
  `createAnalyserReader().readTime`) on the shared frame loop (`charts/frame-loop.js`); the
  analyser's own dB values and smoothing are not used.
- **Analysis**: `measurement/live-rta.js` (pure): each frame is windowed and transformed on
  the `spectrum.js` mean-square scale, so band levels equal `welch()` → `bandPowers()` of the
  same signal (a sine of amplitude A reads 10·log10(A²/2) in its band). Modes FFT / OCTAVE /
  1/3 OCTAVE (`role="radio"` segmented choice); averaging INSTANT / FAST (τ = 125 ms) / SLOW
  (τ = 1 s) with `createRtaAverager` (power, conventional constants, not IEC-verified); peak
  hold, freeze, reset peaks; under-resolved bands (< 2 bins) hatched. Expert fields without a
  recipe path drive it: RTA mode, FFT size (4096-32768), window (Hann, Blackman-Harris),
  RTA averaging (`LIVE_RTA_FIELDS` in `ui/measure.js`); they never change the recipe.
- **Calibration**: the frequency profile per band through `applyFrequencyCorrectionToBands`
  (that frame's spectrum as in-band weighting, written in place) and per FFT bin through
  `correctionCurve`; uncovered bands and bins stay raw and are said to be. Levels are "dB
  relative (dBFS-like)" unless a valid level calibration applies (then dB SPL, CALIBRATED).
- **Per frame** (§123): read samples, `push()` (no allocation; unit-tested), `chart.redraw()`.
  No Alpine write per frame; the view model (summary, badges, notes, readout text) every
  `LIVE_VIEW_INTERVAL_MS` = 250 ms. The axis is fixed (`LIVE_RTA_Y_RANGE`: bands −120 … 0 dB,
  FFT −150 … 0 dB, shifted by a valid level offset), so it does not jump.
- **Lifecycle**: exclusive with a measurement: the start is refused (BUSY) while a setup check
  or measurement runs, a READY setup is released first, and "Check setup" / "Start
  measurement" stop the live RTA before they capture (`capture.js` also drops the tap before any
  capture). Leaving the RTA tab or MEASURE, Escape, page hide (`pagehide`, hidden document), a
  track that ends and a closed context stop it; every stop releases the analyser, the source
  node and every track (`counts()` all zero, asserted in `tests/browser/v3-ui.cjs` live-rta).
  "Live RTA started" / "Live RTA stopped" are announced once each (polite).
- **Not stored**: live RTA is feedback. `snapshot()` gives the `RtaResult` (raw band levels,
  the default `ALGORITHMS.rta`, `oscilla.rta.v2`, the window ID, fftSize) an explicit snapshot
  would store; saving it into an
  experiment is not offered yet, because an experiment's recipe requires a stimulus and a live
  snapshot has none (a schema decision, not taken here).
- **Browsers**: Chromium and Firefox run it on their fake microphones in the gate (a 1 kHz tone
  of amplitude 0.1 reads −23.0 dB in its band); WebKit offers no fake device, so the gate checks
  the refused start, its message and the disabled controls.

## Integration notes

- Each workspace is ONE full-width view (`#osc-view-measure`, `#osc-view-experiments`, keyed on
  `workspace`) that holds its own `.osc-panel`s in a 12-column grid, instead of loose panels in
  the V2 focus grid: the V2 panels are hidden in these workspaces at every width, and the V2
  focus/tablet rules stay untouched. The spans are the ones proposed above.
- Noise check: 5 s by default (`DEFAULT_NOISE_CHECK_S`, preset and field). The SNR is assessed
  only above about 10 / (0.1156 · T) Hz, so the V3.0 default of 1 s could never assess below
  ~87 Hz and a default 20 Hz sweep could never be GOOD; the field help says so.
- RTA: live input analysis as described in "Live RTA". Without it, the tab shows the noise
  check's stored one-third-octave band power (engine `summarizeNoise`, binHz from
  `NOISE_FFT`) badged NOISE CHECK SNAPSHOT (never LIVE), with its Welch averaging described as
  such; the instant averager gives peak hold and freeze over successive noise checks. FFT and
  octave modes apply to the live input only (stored data is one-third-octave).
- Expert fields without a recipe path: RTA mode, FFT size, window and RTA averaging drive the
  live RTA (help text "Live RTA (RTA tab); not part of the measurement recipe."). The output
  level is the Stimulus panel's LOW / MEDIUM / HIGH control only.
- Light theme: no new token values; warning text is `--osc-text` on `--osc-warn-bg`, orange and
  red are icons, strokes and the 3 px leading edge of status chips only.
- Status chips: text + lucide icon (the shape differs per status) + the V2 toast convention of a
  coloured 3 px leading edge; the `osc-q-shape--*` classes set the outline (dotted ring, dashed
  unknown).
