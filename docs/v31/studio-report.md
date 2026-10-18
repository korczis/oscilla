# OSCILLA V3.1 Studio final report (spec §259)

Snapshot as of commit `4f241e5` (2026-10-18), the head of `train/2026-10-17`. Spec §259 asks
for the final report of the Studio: schema version, node types, port types, timeline and
automation capabilities, patch support, measurement integration, test counts, artifact size
delta, Majordomus artifacts, ADRs, use cases, features, public version, commit and deployment
run. Every fact below was read from the repository, from git or from GitHub at the snapshot.

How the report stays true: each list that has a source in code or in the `.ai/` layer sits
between `<!-- name:begin -->` and `<!-- name:end -->` markers, and
[`tests/unit/v31-studio-report.test.mjs`](../../tests/unit/v31-studio-report.test.mjs) derives
it from that source and compares. A change that adds a node type, a port role, an ADR tagged
`studio` or a use case fails `npm test` until this report says so. Numbers that change with
every pull request (test counts, the current artifact size) are given as snapshot values beside
the command that measures them, and only the command is checked.

How it works is in [the model](studio-model.md), [the compiler](compiler.md),
[the timeline](timeline.md), [patches and provenance](patches-and-provenance.md) and
[performance](performance.md). How to use it is the [user guide](user-guide.md).

## Schema versions

Each version is independent of the product version (ADR 0023): a Studio file from the release
that introduced Studio stays readable in later releases.

<!-- schema-versions:begin -->
| Record | Kind | Schema version |
| --- | --- | --- |
| Studio project (StudioModel) | oscilla-studio | 1 |
| Studio execution-state hash (studioHash) | oscilla-studio | 1 |
| Studio patch | oscilla-patch | 1 |
| Measured path (experiment studio.measured) | oscilla-experiment | 1 |
| Experiment run from Studio with a measured path | oscilla-experiment | 4 |
| Every other experiment | oscilla-experiment | 3 |
<!-- schema-versions:end -->

Sources: `src/js/studio/schema.js` (`STUDIO_SCHEMA_VERSION`, `STUDIO_HASH_VERSION`),
`src/js/studio/patches.js` (`PATCH_SCHEMA_VERSION`), `src/js/experiments/hash.js`
(`MEASURED_PATH_VERSION`) and `src/js/experiments/schema.js`. An experiment is written in the
lowest schema that describes it: 4 only when its Studio block names a measured path, so a
plain MEASURE run still opens in a build that reads schema 3. `studioHash` is the SHA-256 of
the execution state only (nodes, parameters, edges, tracks, clips, automation, loop,
transport); positions, names, markers and view state are excluded.

## Node types

The registry of `src/js/studio/registry.js`, by category in library order. A definition holds
no audio node; the compiler builds each one with the existing engine's builders (ADR 0035).

<!-- node-types:begin -->
| Category | Count | Node types |
| --- | --- | --- |
| Sources | 5 | Oscillator `oscillator`, Noise `noise`, Sweep `sweep`, Sequence `sequence`, Microphone `microphone` |
| Modulation | 4 | LFO `lfo`, Envelope `envelope`, Random `random`, Step Modulator `step-modulator` |
| Processing | 5 | Gain `gain`, Filter `filter`, Pan `pan`, Stereo Split `stereo-split`, Mixer `mixer` |
| Analysis | 5 | Scope `scope`, Spectrum `spectrum`, Spectrogram `spectrogram`, Meter `meter`, RTA `rta` |
| Output | 2 | Master Output `master`, Recorder/Export `recorder` |
| Measurement | 4 | Capture `capture`, Calibration `calibration`, Transfer Analyzer `transfer-analyzer`, Measurement Result `measurement-result` |
<!-- node-types:end -->

## Port types

Four typed ports; roles are metadata within a type, so the type set stays at four
(`src/js/studio/ports.js`, ADR 0032). Glyph and cable pattern tell the types apart without
colour. Modulation depth, polarity, mapping and offset belong to the CONTROL edge, never to a
node parameter (ADR 0037).

<!-- port-types:begin -->
| Type | Roles | Glyph | Cable | Edge properties |
| --- | --- | --- | --- | --- |
| AUDIO | SIGNAL, TAP | circle | solid | muted |
| CONTROL | SIGNAL, PARAMETER | diamond | dashed | muted, depth, polarity, mapping, offset |
| TRIGGER | SIGNAL | triangle | pulse | muted |
| ANALYSIS | OBSERVED, REFERENCE, RESULT | square | dash-dot | muted |
<!-- port-types:end -->

Connection rules (ADR 0032, ADR 0033): only compatible ports connect, ANALYSIS roles must
match exactly, and an instantaneous audio feedback loop, or a control or analysis cycle, is
rejected with a reason before anything reaches Web Audio (rules `project.typed-ports`,
`project.no-silent-feedback`).

## Actions and history

Every mutation is a dispatched action reduced into a new immutable model, and undo and redo
restore earlier snapshots (`src/js/studio/actions.js`, `src/js/studio/history.js`, ADR 0031).
`SELECTION_CHANGE` and `VIEW_SET` change view state only and are neither undoable nor dirtying.

<!-- actions:begin -->
`NODE_ADD`, `NODE_REMOVE`, `NODE_MOVE`, `NODE_PARAM_SET`, `NODE_RENAME`, `EDGE_ADD`, `EDGE_REMOVE`, `EDGE_UPDATE`, `TRACK_ADD`, `TRACK_REMOVE`, `CLIP_ADD`, `CLIP_REMOVE`, `CLIP_MOVE`, `CLIP_RESIZE`, `CLIP_UPDATE`, `CLIP_SET_TIME_BASE`, `AUTOMATION_POINT_ADD`, `AUTOMATION_POINT_MOVE`, `AUTOMATION_POINT_REMOVE`, `MARKER_ADD`, `MARKER_REMOVE`, `MARKER_MOVE`, `LOOP_SET`, `TRANSPORT_SET`, `METADATA_SET`, `PASTE`, `DUPLICATE`, `PATCH_INSERT`, `PATCH_REPLACE`, `SELECTION_CHANGE`, `VIEW_SET`
<!-- actions:end -->

## Timeline and automation

<!-- timeline:begin -->
| Model field | Values |
| --- | --- |
| Track kinds | event, measurement |
| Clip kinds | pattern, event, measurement |
| Clip time bases | absolute, tempo |
| Event clip actions | gate, trigger |
| Measurement clip steps | noise-check, pre-roll, stimulus, capture, tail, analysis |
| Automation curves | step, linear, exponential |
| Marker kinds | start, sweep, capture, analysis, end, custom |
| Transport time modes | seconds, musical |
<!-- timeline:end -->

- **Timeline** ([timeline](timeline.md), ADR 0036): tracks of clips you create, move, resize,
  split and delete with snapping; a loop region; markers; a playhead on the audio clock. Times
  are absolute seconds, scheduled through the existing sequencer compiler (the V2 sequencer's
  data migrates, [sequencer migration](sequencer-migration.md)). Editing during playback
  reschedules; STOP and Escape release every node and source.
- **Automation** (ADR 0037): one lane per parameter, points with a step, linear or exponential
  curve compiled to `setValueAtTime`, `linearRampToValueAtTime` and
  `exponentialRampToValueAtTime`. Exponential curves are refused on a parameter that can reach
  zero. Each lane is drawn in its parameter's own scale (log, dB, linear or bipolar). Automation
  sets a timed base value; modulation is a CONTROL edge; neither stands in for the other.
- **Transport**: tempo, time signature, loop and notes in the Inspector when nothing is
  selected; the Inspector's Runtime and Trace sections say whether the graph on screen is the
  one that plays and what each edit did (ADR 0039, ADR 0042).

## Patches, templates and persistence

- **Patches** ([patches and provenance](patches-and-provenance.md)): `oscilla-patch` schema 1,
  an explicit subset of the model (selected nodes, the edges between them, their automation),
  inserted with fresh ids or replacing the graph, one undo entry each. Import never evaluates,
  checks size, structure, depth, kind, keys and bounds before the embedded graph is validated as
  a Studio document, and refuses unknown node types, cycles and feedback. An existing patch is
  never silently overwritten.
- **Persistence**: projects and patches live in the `studio` and `studioSummaries` object stores
  of the experiment database (database version 2; the upgrade only creates stores). A stored
  record whose `studioHash` does not verify is reported as corrupt and is not loaded. Without
  IndexedDB (for example from `file://`) the library uses memory and says so.
- **Render WAV**: offline rendering through the same compiler, runtime and transport as live
  playback; a live input is refused.
- **Templates** (`src/js/studio/templates/`):

<!-- templates:begin -->
| Template id | Title | Category |
| --- | --- | --- |
| basic-tone | Basic Tone | synthesis |
| subtractive-synth | Subtractive Synth | synthesis |
| sweep-sequence | Sweep Sequence | synthesis |
| stereo-beat | Stereo Beat | synthesis |
| filter-automation | Filter Automation | synthesis |
| measurement-sweep | Measurement Sweep | measurement |
<!-- templates:end -->

## Measurement integration

ADR 0038, feature `studio-measurement-routing`. In the Measurement Sweep template, PLAY hands
the measurement clips to the V3 measurement engine of the Measure workspace; Studio does not
measure by itself. `recipeFromStudio` (`src/js/studio/provenance.js`) derives the recipe from
the graph and the clips, so the two cannot disagree about the stimulus, and the recipe's
`configHash` never includes Studio state. The saved experiment carries a `studio` block beside
the recipe: the Studio schema version, the execution state of the graph, its `studioHash` and
the measured path (the Sweep reference into the Transfer Analyzer, its route to the Master
Output, the observed chain and the measurement clips) with its own hash. A node the measurement
never reads is recorded but is not an execution change when two runs are compared (ADR 0041).
Such a record needs experiment schema 4.

## Tests

The commands measure; the values are the snapshot at `4f241e5`.

<!-- commands:begin -->
| What | Command | Snapshot value |
| --- | --- | --- |
| Unit tests, all | `npm test` | 2808 tests, 2808 pass, 0 fail |
| Unit test files, all | `ls tests/unit/*.test.mjs` | 116 files |
| Unit test files, Studio (V3.1) | `ls tests/unit/v31-studio-*.test.mjs` | 25 files, before this report's own test |
| Studio browser suites | `npm run test:studio` | the eight suites below, run by `npm run release-gate` |
| Visual comparison, Studio included | `npm run test:visual` | run by `npm run release-gate` |
| Public smoke of the deployed page | `npm run test:live` | 17/17 checks in chromium, firefox and webkit (run 38453063858) |
| Artifact size and budget | `npm run verify-dist` | raw 2731.0 KiB of 3418.0 KiB, gzip 789.6 KiB of 976.6 KiB |
<!-- commands:end -->

Further unit tests cover the Studio outside the `v31-studio-` prefix (`v4-*`, `v40-*` and
`v431-*` files). The browser suites `npm run test:studio` runs:

<!-- browser-suites:begin -->
- `tests/browser/v31-studio-graph.cjs`
- `tests/browser/v31-studio-timeline.cjs`
- `tests/browser/v31-studio-audio.cjs`
- `tests/browser/v31-studio-transport.cjs`
- `tests/browser/v31-studio-offline.cjs`
- `tests/browser/v31-studio-workflows.cjs`
- `tests/browser/v31-studio-links.cjs`
- `tests/browser/v31-studio-runtime.cjs`
<!-- browser-suites:end -->

For this report only the unit tests were run (`npm run verify`); the browser suites and the
release gate were not.

## Artifact size delta

The deliverable is the one file `dist/index.html` (rule `project.single-file-deliverable`).
Gzip is level 9, as `scripts/verify-dist.mjs` measures it.

| Point | Commit | Raw bytes | Gzip bytes | Raw delta from v3.0.0 |
| --- | --- | --- | --- | --- |
| v3.0.0 | `5d94576` | 2,146,727 | 601,392 | |
| v3.1.0 | `a810b94` | 2,561,441 | 728,219 | +414,714 (+19.3 %) |
| Snapshot | `4f241e5` | 2,796,561 | 808,559 | +649,834 (+30.3 %) |

The v3.0.0 to v3.1.0 delta is the Studio as first released. The snapshot row includes every
later 3.x change, Studio and other work alike. The tag rows are checked by the test when the
tags are present; re-measure with `git show <tag>:dist/index.html | wc -c`.

## Public version, commit and deployment run

The public URL is <https://korczis.github.io/oscilla/>. The deployment evidence is the release
record plus the Pages run, as ADR
[0057](../../.ai/repo/adrs/0057-a-static-pages-deployment-is-evidenced-by-its-release-v1-rec.md)
decides; `.ai/repo/deployments/` holds no object because `deployment/v1` describes a container
service and a static Pages site has no honest shape in it.

- **Studio release, v3.1.0.** Tag commit `a810b948cab4d17adc81c63357e99601739fed33`; GitHub
  Release "OSCILLA v3.1.0" published 2026-10-03T06:38:40Z
  (<https://github.com/korczis/oscilla/releases/tag/v3.1.0>); Pages run
  [37103655560](https://github.com/korczis/oscilla/actions/runs/37103655560) (success) deployed
  that commit. The Release has no asset, so v3.1.0 has no release/v1 record; records start at
  v3.4.0.
- **Newest release.** The newest record in [`.ai/repo/releases/`](../../.ai/repo/releases/)
  names commit `e4772ee` and the artifact digest
  `f8d5b609d285880133cc6bee3fe3627aefb597625a6793c8acda307e334f615a`. Its version is not
  written here: `version:check` forbids a copy of the current version outside `package.json`.
  `gh release list -L 1` shows it.
- **Latest deployment.** Pages run
  [38453063858](https://github.com/korczis/oscilla/actions/runs/38453063858), 2026-10-13, success,
  deployed `main` at `964e25d7e009eaa290540cdbf24edee6e07cb66c` (#176) with the stamped artifact
  `6e93ae1852dac4e5fa8bfe0f2cd3852b8ed47ccf1db501363dd66f99954c3c41`. `verify-deploy` passed
  on attempt 1/10. The public smoke passed 17/17 checks in each of chromium, firefox and
  webkit, including the compact Studio, the Subtractive Synth's six nodes, five connections and
  timeline, PLAY and STOP leaving 0 nodes, the Measurement Sweep's six nodes and five
  connections, and no microphone request. Re-read with `gh run list --workflow pages.yml -L 3`.

## Majordomus artifacts

The plan issues of the Studio, by milestone. Status is derived from evidence, not from this
table: at the snapshot `majordomus plan status` shows M021 to M031 DONE, M032 ACTIVE (1 of 3)
and M033 BLOCKED (0 of 1). V433, the release and public verification, stays open.

<!-- plan:begin -->
| Milestone | Title | Issues |
| --- | --- | --- |
| M021 | V3.1 Studio architecture | V401, V402, V403 |
| M022 | V3.1 Studio graph model | V404, V405, V406, V407, V408 |
| M023 | V3.1 Studio graph editor | V409, V410, V411, V412, V413 |
| M024 | V3.1 Studio audio graph compiler | V414, V415 |
| M025 | V3.1 Studio timeline | V416, V417, V418 |
| M026 | V3.1 Studio automation | V419, V420 |
| M027 | V3.1 compact Studio | V421 |
| M028 | V3.1 full Studio workspace | V422, V423 |
| M029 | V3.1 Studio measurement integration | V424, V425 |
| M030 | V3.1 Studio persistence and patches | V426, V427 |
| M031 | V3.1 Studio accessibility and mobile | V428, V429 |
| M032 | V3.1 Studio verification | V430, V431, V432 |
| M033 | V3.1 release and deployment | V433 |
<!-- plan:end -->

The project rules the Studio features name:

<!-- rules:begin -->
`project.audio-engine-discipline`, `project.no-fake-science`, `project.no-silent-feedback`, `project.single-file-deliverable`, `project.studio-model-is-canonical`, `project.typed-ports`, `project.visual-identity-lock`
<!-- rules:end -->

The claims of `docs/CLAIMS.yaml` for the Studio:

<!-- claims:begin -->
`studio-model-plain-data`, `studio-deterministic-hash`, `studio-typed-connections`, `studio-feedback-rejected`, `studio-exact-undo-redo`, `studio-subgraph-paste`, `studio-untrusted-import`, `studio-schema-version`, `studio-timeline-model`, `studio-automation-model`, `studio-measurement-topology`, `studio-registry-reuses-engine`, `studio-one-store-projections`, `studio-compiled-topology`, `studio-click-free-live-edit`, `studio-runtime-divergence`, `studio-operation-trace`, `studio-transport-audio-clock`, `studio-patch-round-trip`, `studio-experiment-provenance`, `studio-non-drag-operation`, `studio-file-protocol`
<!-- claims:end -->

### Features

<!-- features:begin -->
| Feature | Title | Status |
| --- | --- | --- |
| [studio-automation](../../.ai/repo/features/studio-automation.md) | Automate parameters over time, separately from modulation | stable |
| [studio-measurement-routing](../../.ai/repo/features/studio-measurement-routing.md) | Lay out a measurement as a Studio graph and keep it in experiment provenance | stable |
| [studio-patches](../../.ai/repo/features/studio-patches.md) | Save, load and share Studio projects and patches as validated files | stable |
| [studio-signal-graph](../../.ai/repo/features/studio-signal-graph.md) | Connect typed nodes into a sounding signal graph | stable |
| [studio-timeline](../../.ai/repo/features/studio-timeline.md) | Sequence events and measurement phases on a multi-track timeline | stable |
| [studio](../../.ai/repo/features/studio.md) | Program sound and measurement as an editable signal graph with a timeline | stable |
<!-- features:end -->

### Use cases

<!-- use-cases:begin -->
| Use case | Title |
| --- | --- |
| [studio-automate-a-parameter](../../.ai/repo/use-cases/studio-automate-a-parameter.md) | Automate a filter cutoff from 500 Hz to 8 kHz |
| [studio-build-a-signal-path](../../.ai/repo/use-cases/studio-build-a-signal-path.md) | Build a simple signal path in Studio |
| [studio-compact-full-sync](../../.ai/repo/use-cases/studio-compact-full-sync.md) | Switch between compact and full Studio on one model |
| [studio-connect-modulation](../../.ai/repo/use-cases/studio-connect-modulation.md) | Modulate a filter cutoff with an LFO |
| [studio-copy-and-paste-a-subgraph](../../.ai/repo/use-cases/studio-copy-and-paste-a-subgraph.md) | Copy and paste a Studio subgraph |
| [studio-define-a-measurement-pipeline](../../.ai/repo/use-cases/studio-define-a-measurement-pipeline.md) | Define a measurement pipeline in Studio |
| [studio-edit-while-playing](../../.ai/repo/use-cases/studio-edit-while-playing.md) | Edit the Studio graph while it plays without leaking nodes |
| [studio-open-from-file](../../.ai/repo/use-cases/studio-open-from-file.md) | Open Studio from file:// |
| [studio-operate-without-dragging](../../.ai/repo/use-cases/studio-operate-without-dragging.md) | Operate Studio without pointer dragging |
| [studio-reject-an-invalid-connection](../../.ai/repo/use-cases/studio-reject-an-invalid-connection.md) | See an invalid Studio connection rejected with a reason |
| [studio-save-and-load-a-patch](../../.ai/repo/use-cases/studio-save-and-load-a-patch.md) | Save a Studio patch and load it back |
| [studio-sequence-multiple-events](../../.ai/repo/use-cases/studio-sequence-multiple-events.md) | Sequence a tone, a sweep and a pulse on the Studio timeline |
| [studio-topology-in-experiment-provenance](../../.ai/repo/use-cases/studio-topology-in-experiment-provenance.md) | Keep the Studio topology in experiment provenance |
| [studio-undo-and-redo](../../.ai/repo/use-cases/studio-undo-and-redo.md) | Undo and redo Studio edits exactly |
<!-- use-cases:end -->

### ADRs

Every ADR tagged `studio`. The deployment-evidence decision, ADR 0057, is tagged `release` and
`deployment` and is linked above. ADRs 0040, 0043 and 0044 (experiment runs, definitions and
evidence) are what the Studio's measurement records rely on.

<!-- adrs:begin -->
| ADR | Decision | Status |
| --- | --- | --- |
| [0030](../../.ai/repo/adrs/0030-studio-model-canonical-separate-from-runtime.md) | One canonical StudioModel of plain serializable data, separate from the runtime graph; every Studio view is a projection of it | proposed |
| [0031](../../.ai/repo/adrs/0031-studio-action-layer-snapshot-history.md) | Every Studio mutation is a dispatched action reduced into a new immutable model; undo and redo restore earlier snapshots | accepted |
| [0032](../../.ai/repo/adrs/0032-typed-ports-validated-before-runtime.md) | Studio ports are typed with roles, and connection validity is pure model logic checked before any runtime mutation | accepted |
| [0033](../../.ai/repo/adrs/0033-feedback-and-control-cycles-rejected.md) | Instantaneous audio feedback and control or analysis cycles are rejected by the model until a delay node has its own decision | accepted |
| [0034](../../.ai/repo/adrs/0034-custom-html-nodes-svg-cables.md) | The Studio graph editor is custom HTML nodes over an SVG cable layer in the OSCILLA visual language, without a flow-editor framework or React, inside the single file | proposed |
| [0035](../../.ai/repo/adrs/0035-compiled-into-existing-engine-incremental-patching.md) | The StudioModel compiles into the existing AudioEngine and measurement engine, and edits patch the running graph incrementally in transactions | accepted |
| [0036](../../.ai/repo/adrs/0036-timeline-on-audio-clock-via-sequencer-compiler.md) | The Studio timeline runs on the audio clock through the existing sequencer compiler, in absolute seconds | accepted |
| [0037](../../.ai/repo/adrs/0037-automation-versus-modulation.md) | Automation is a timed base value on a timeline lane; modulation is a control edge with its own depth; the two never stand in for each other | accepted |
| [0038](../../.ai/repo/adrs/0038-measurement-topology-inside-studio.md) | Measurement topology lives inside Studio as orchestration of the V3 measurement engine, and the StudioModel enters experiment provenance | proposed |
| [0039](../../.ai/repo/adrs/0039-studio-runtime-truth-plan-identity-applied-record-divergence.md) | Studio runtime truth: plan identity, applied record and divergence | accepted |
| [0041](../../.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md) | Run comparison is semantic and classifies execution vs presentation changes | accepted |
| [0042](../../.ai/repo/adrs/0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md) | Studio operation trace: one correlation id, bounded, not evidence | accepted |
| [0048](../../.ai/repo/adrs/0048-connected-records-over-stored-fields.md) | Connected records come from stored fields only, and read present only when the identity verifies | accepted |
<!-- adrs:end -->

## Not built

From the README's Studio section at the snapshot: a minimap, node groups, dragging several
clips at once, and pinch zoom on the timeline. Graph grouping (§116-§117) was optional for 3.1.
