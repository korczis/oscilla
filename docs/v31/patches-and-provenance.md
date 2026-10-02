# OSCILLA Studio templates, patches, persistence, provenance, offline rendering and accessible text (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §105, §109-§117, §143-§144, §154-§163,
§194-§197, §249-§258. Plan issues V423 (templates), V425 (provenance), V426 (patches, save,
load, import, export), V427 (offline rendering), V428 (graph text summary, labels and
announcements; the interactive parts of V428 are not here). ADRs 0019, 0022, 0030, 0038 say
why; this document says **how**.

| Module | Role |
| --- | --- |
| `src/js/studio/templates/*.js` | the six templates as canonical, versioned data; `index.js` lists, validates and instantiates them |
| `src/js/studio/patches.js` | patch schema, `createPatch`, `importPatch`, `insertPatch`, `replaceWithPatch`, `applyPatch` |
| `src/js/studio/library.js` | save/load of projects and patches through the experiment store, file export/import, dirty tracker |
| `src/js/studio/provenance.js` | the experiment `studio` block, its semantic verification, the recipe derived from a topology |
| `src/js/studio/offline.js` | `planOfflineRender`, `renderStudioOffline` |
| `src/js/studio/a11y.js` | `summarizeGraph`, `describeNode`, `describeEdge`, `describePortLabel`, announcements |
| `src/js/experiments/store.js` | DB version 2: the Studio partition (additive) |
| `src/js/experiments/validate.js`, `hash.js`, `schema.js` | the optional `studio` block of an experiment (additive) |
| `src/js/studio/actions.js` | `PATCH_INSERT`, `PATCH_REPLACE` reducers (additive) |

Everything except the store and the renderer is pure: plain data in, plain data out.

Tests: `tests/unit/v31-studio-templates.test.mjs` (templates, a11y, offline plan),
`tests/unit/v31-studio-patches.test.mjs` (patches, store partition, library, files, dirty state),
`tests/unit/v31-studio-provenance.test.mjs` (provenance round trip). Browser:
`tests/browser/v31-studio-offline.cjs` (offline render in chromium, firefox, webkit; written,
**not yet run**, see "What remains").

## Templates (§194-§196, §256-§258)

A template is a frozen record:

```js
{ id: 'subtractive-synth', version: 1, title: 'Subtractive Synth', category: 'synthesis',
  learn: { summary, points: [≤ 4 short texts] },          // §194: no textbook walls
  studioHash: '3982a31f…',                                 // pinned
  model: { kind: 'oscilla-studio', schemaVersion: 1, … } } // may be partial; normalized on use
```

| Id | Graph | Timeline | Teaches |
| --- | --- | --- | --- |
| `basic-tone` | Oscillator 440 Hz → Master | — | the single output and its safety chain |
| `subtractive-synth` | Oscillator (saw 220 Hz) → Envelope → Filter (LP) → Master; LFO → Filter cutoff (1 octave, log, bipolar); Spectrum taps the filter | Tone 0-1 s, Sweep 1-3 s on the Oscillator; cutoff lane 500 Hz → 8 kHz (exponential) | modulation vs automation, side-chain analysis; the §257 reference fixture |
| `sweep-sequence` | Sequence → Master; Spectrogram tap | sweep up, silence, sweep down on the Sequence | pattern clips through the existing sequencer |
| `stereo-beat` | 200 Hz and 204 Hz → Stereo Split (A left, B right) → Master; Meter tap | — | stereo routing; what is physical and what arises in hearing (no-fake-science wording) |
| `filter-automation` | white Noise → Filter (band-pass, Q 4) → Master; Spectrum tap | centre frequency 200 Hz → 4 kHz → 200 Hz | automation lanes |
| `measurement-sweep` | Sweep (log 20 Hz-20 kHz, 5 s) → Master; Sweep reference → Transfer Analyzer; Microphone → Calibration → Transfer Analyzer → Measurement Result | noise check, pre-roll, stimulus, tail, analysis; capture window on a second track | transfer measurement routing; the §258 fixture |

Provenance (§196): `validateTemplate` normalizes the model, runs `validateStudioModel`, checks the
Learn bounds and compares `studioHash(model)` with the pinned value. Anything that changes the
executed result — a parameter, an edge, a clip, a point, or an engine default the normalized
model inherits — changes the hash, and the unit test fails until the template's `version` is
raised and the hash re-pinned. Positions, names and Learn text are presentation and need no
bump. `templateModel(id)` returns a fresh normalized copy; `templateProvenance(t)` is what a
project or experiment may record about its origin.

Every template validates without warnings, passes the editor-level clip rules
(`timeline.js validateClip`), round-trips through `importStudio`, and compiles with
`compileStudio` to `ready` / `data` nodes; only a Microphone without permission is `degraded`
(and `MIC_UNAVAILABLE_TEXT` where `getUserMedia` is missing, as on Chromium `file://`).

## Patches (§111-§115)

Patch schema 1 is an explicit subset of the StudioModel with its own kind and version:

```js
{ kind: 'oscilla-patch', schemaVersion: 1, studioSchemaVersion: 1,
  name, description,
  graph: { nodes: [{ id, type, position, params, metadata: { name } }], edges: [...] },
  automation: [{ id, target: { node, param }, points }] }
```

- `createPatch(model, nodeIds, { name, description, includeAutomation })` keeps the selected
  nodes (model order), only edges with both ends selected, and the automation lanes of those
  nodes. Positions become relative to the top-left node. Parameters are complete, so the patch
  carries its own defaults. No view state, selection, tracks, clips, markers or runtime state:
  a patch is a graph fragment; the timeline belongs to the project it is inserted into.
- `schemaVersion` versions the envelope (`patchMigrations`, identity at 1);
  `studioSchemaVersion` versions the embedded graph, which migrates through
  `studioMigrations` exactly like a project file.

### Import safety (§115, §159, §238)

`importPatch(input)` never evals and never throws: size cap before `JSON.parse` → structural scan
(`scanUntrusted`: plain data, no `__proto__`/`constructor`/`prototype`, finite numbers) → depth →
kind (a project file is named as such) → envelope migration → strict envelope keys and string
bounds → the embedded graph as a Studio document through `importStudio` with
`PATCH_IMPORT_LIMITS` → normalized copy.

| Limit | Patch | Project (`STUDIO_IMPORT_LIMITS`) |
| --- | --- | --- |
| bytes | 1 MiB | 4 MiB |
| nodes / edges | 128 / 512 | 512 / 2048 |
| automation lanes / points / per lane | 128 / 5000 / 1024 | 512 / 20000 / 4096 |
| tracks, clips, markers | 0 | 64, 2048, 512 |
| depth, strings | 12, 256 (name 64, description 2000) | 12, 256 |

Unknown node types, references to nodes outside the patch, type mismatches, cycles and feedback
are rejected before anything compiles.

### Insert or replace (§114)

| Function | Effect |
| --- | --- |
| `insertPatch(model, patch, at?)` | new ids for every node, edge, lane and point (the store's `<prefix>-<n>` scheme, never colliding); top-left at `at` (default: `PATCH_INSERT_GAP` = 120 units right of the existing content); default names renumbered ("Filter 2"), custom names kept; a node over `maxInstances` (Master Output) is skipped with its edges and lanes and reported in `skipped` |
| `replaceWithPatch(model, patch)` | every node goes with the same cascade as `NODE_REMOVE` (edges, lanes, clips that target the node; track targets cleared); tracks, other clips, markers, loop, transport, view and metadata stay; then the patch is inserted at (0, 0) with ids that never reuse those of the replaced graph |
| `applyPatch(model, patch, { mode })` | `mode` is required: `'insert'` or `'replace'` — the explicit user intent |

Both return a validated model or throw `PatchError`. In the store they are the actions
`PATCH_INSERT { patch, at? }` ("Insert Synth voice") and `PATCH_REPLACE { patch, at? }`
("Replace graph with Synth voice"): one undo entry each; undo restores the exact earlier model;
a rejected patch changes nothing. Graph grouping and collapsed groups (§116-§117) are optional
for 3.1 and not built; a patch is the serialization such a group would use.

## Persistence (§154-§158, §225-§226)

### The Studio partition of the experiment database

No second database layer: `experiments/store.js` gains two object stores in the SAME database.

| `DB_VERSION` | Upgrade step | Stores |
| --- | --- | --- |
| 1 (V3.0) | `oldVersion < 1` | `experiments`, `summaries` (keyPath `experimentId`) |
| 2 (V3.1) | `oldVersion < 2` | `studio`, `studioSummaries` (keyPath `id`) |

The upgrade only creates stores, each guarded by `objectStoreNames.contains`, so a partial
earlier upgrade completes and nothing is ever deleted (§225; the unit test opens a V3.0
version-1 database and checks its experiment record is untouched, and the fake database throws if
`deleteObjectStore` is called). A record is

```js
{ id, kind: 'oscilla-studio' | 'oscilla-patch', name, savedAt (ISO), studioHash, doc }
```

The store checks only the envelope (`studioRecordProblem`: id pattern, kind, name, timestamp,
hash format, plain `doc` whose `kind` equals the record kind, ≤ 8 Mi characters) and writes
record and summary in one transaction; `listStudio({ kind })` reads the summaries, newest first.
Content validation is the Studio layer's job, so `experiments/` imports nothing from `studio/`.
The memory store has the same methods: under `file://` without IndexedDB
`openExperimentStoreOrMemory` falls back and the library reports `persistent: false`.

### Library

`createStudioLibrary(store)`:

| Method | Rule |
| --- | --- |
| `saveProject(model, { id, now })` | validated first ('invalid'); canonical JSON; overwrites the user's own project `id`; refuses an id held by a patch |
| `loadProject(id)` | `importStudio` on the stored doc and a `studioHash` comparison: a tampered or invalid record is 'corrupt', never loaded |
| `savePatch(patch, { id, now, overwrite = false })` | an existing patch is never silently overwritten (§155): 'exists' unless `overwrite: true` |
| `loadPatch(id)` | `importPatch` and a `patchHash` comparison |
| `list({ kind })`, `remove(id)` | the store's summaries; explicit deletion only |

Autosave and crash recovery (§155, §157) are optional for 3.1 and not built; the tracker below
is what they would use, and they must never write over an explicit patch.

### Files (§158)

`exportProjectFile(model)` → `{ name: '<slug>.oscilla-studio.json', type: 'application/json',
text }` (pretty canonical JSON); `exportPatchFile(patch)` → `<slug>.oscilla-patch.json`.
`importStudioFile(text)` reads `kind` to choose `importStudio` or `importPatch`; each pipeline
re-checks everything. Nothing leaves the browser unless the user exports a file (§239).

### Dirty state (§156, §253-§254)

`createDirtyTracker(baseline)` compares `canonicalJson(semanticState(model))` (execution +
presentation) with the last explicit save (`markSaved(model, { id, savedAt, target })`). Pan,
zoom, timeline scale and selection never make a document dirty; moving or renaming a node, or
editing notes, does; undo back to the saved state is clean again. The digest is cached per
frozen model, so polling it after every store change is cheap.

## Studio in experiment provenance (§109-§110, ADR 0038)

```js
experiment.studio = { schemaVersion: 1, studioHash, execution }   // optional, top level
```

`execution` is `executionState(model)` (node ids, types and parameters; edges and properties;
tracks, clips, automation, loop; transport). Never positions, names, markers, metadata, view or
selection (§163, §252, §255), never results, never only a patch id (a patch can change after the
run).

| Layer | Checks |
| --- | --- |
| `experiments/validate.js` (every import and every store read) | strict keys, bounded generic JSON (`STUDIO_EXECUTION_LIMITS`: depth 8, 20000 elements, 256-character strings), `execution.kind` and `schemaVersion`, and `studioExecutionHash(execution) === studioHash` — a mismatch is `{ path: 'studio.studioHash', code: 'corrupt' }` |
| `studio/provenance.js verifyExperimentStudio` | the execution state rebuilt as a model (`executionToModel` → `importStudio`): node types, ports, roles, cycles; canonical form; hash |

The split keeps `experiments/` independent of `studio/` while the hash is still recomputed on
every import (`studioExecutionHash` = SHA-256 of the canonical JSON, which equals
`schema.js studioHash` of the model that ran).

Relationship to the recipe (ADR 0019): the recipe stays the one authoritative description of
what the measurement does, and `configHash` does not include Studio state. A Studio run derives
its recipe from the topology with `recipeFromStudio(model, { sampleRate })`:

| Recipe field | From |
| --- | --- |
| `stimulus` | the logarithmic Sweep wired to a Transfer Analyzer REFERENCE, normalized by `measurement/stimulus.js` exactly as the Sweep adapter renders it (fade = min(`SWEEP_FADE_S`, duration / 4)) |
| `analysis.preRollS`, `postRollS`, `noiseCheckS` | the pre-roll, tail and noise-check clips (engine `DEFAULT_TIMING` when absent or out of `TIMING_LIMITS`) |
| `analysis.gapS`, `aggregation` | engine defaults (0.5 s, mean) |
| `analysis.phase` | the Transfer Analyzer's `phase` |

So a measurement run from Studio and the same measurement from the Measure workspace share a
configHash; the Studio block is provenance beside it. `measurement/engine.js validateRecipe`
accepts the derived recipe (unit test). The round trip (Measurement Sweep template →
`createExperiment` → `withStudioProvenance` → `experimentToJson` → `validateExperiment` →
store put/get) keeps the block byte for byte and `verifyExperimentStudio` passes.

The field is optional and keeps its presence, the precedent of `results.aggregate`: experiments
without Studio serialize and hash exactly as before, and `EXPERIMENT_SCHEMA_VERSION` stays 1. An
older OSCILLA rejects a file with a `studio` field as an unknown field, as it would a newer
schema version.

## Offline rendering (§105, §175-§176)

`planOfflineRender(model, { duration })` decides from registry capabilities:

| Node | Role |
| --- | --- |
| `capabilities.offline` (sources, modulators, processing, Master Output) | rendered |
| Recorder/Export | rendered; its sample rate and channels set the render format |
| `requiresInputPermission` (Microphone) | **refused**: the render does not happen, with the limitation "Microphone 1 is a live input and cannot be rendered offline. Remove it to export audio, or record the Studio while it plays." |
| analysis views, measurement data nodes | skipped (they observe; they are not part of the audio) |

| Timeline item | Rendered when |
| --- | --- |
| pattern clip | the live transport plays it (`transport.js clipPlayReason`): on a Sequence (into its bus) or on an Oscillator (pattern-played: carrier held at `ROUTE_FLOOR`, voices into a pattern bus feeding the oscillator's AUDIO routes) |
| event clip | a gate on an Envelope (the adapter's `gate`) |
| automation lane | its node is rendered (the lane's AudioParam, owned by the lane, with the modulation edges' constant offsets added, as in live playback) |
| measurement clip | never: measurements run live through the measurement engine |

The reasons are the transport's (`OFFLINE_TEXT.patternTarget` / `eventTarget` are
`TRANSPORT_TEXT`'s): a render plays what live playback plays. The Subtractive Synth lists no
limitation.

Everything not rendered is listed in `limitations`. The duration is explicit or the timeline end
(`timelineEnd`), at most `DEFAULT_RENDER.maxDuration` (120 s).

`renderStudioOffline(model, opts)` runs the plan's model through the SAME compiler, runtime,
adapters and transport (`createStudioRuntime`, `createStudioTransport` with a fixed store and
`lookAheadS` = the render duration, then one `start()`) on `offlineEngine(ctx, master)` — the
AudioEngine surface the engine hooks use, backed by the OfflineAudioContext and the master gain
of `audio/offline-renderer.js render()`; `encodeWav` gives the WAV. The scheduled Web Audio trace
equals live playback's at exact times (`tests/unit/v31-studio-parity.test.mjs`); the result
carries `debug: { transport, runtime }` (their `debugInfo()` after scheduling) and lists in
`warnings` anything the transport did not play that the plan did not foresee. The Master Output level is the
render's output gain, as the sequencer export uses the master gain; the live limiter and ceiling
are not in the offline chain, so `stats` (`bufferStats`) reports peak and clipping. The graph
starts at the runtime's click-free start time (scheduling lead + render-quantum boundary,
21.3 ms at 48 kHz), fades in over `STUDIO_XFADE_S` and out over `STUDIO_STOP_S` before the end.
A refused or invalid plan returns `{ ok: false }` before any audio object is created.

## Accessible text (§143-§144, §249-§250)

`summarizeGraph(model)` of the Subtractive Synth is exactly the §249 example: "6 nodes,
5 connections. Signal path: Oscillator 1 to Envelope 1 to Filter 1 to Master. Modulation: LFO 1
controls Filter 1 cutoff. Analysis: Spectrum 1 observes Filter 1 output."

- Signal paths follow AUDIO edges into SIGNAL inputs back from the Master Output, in input-port
  order; later paths stop at the first node already named ("Noise 1 to Mixer 1"); path counts
  are exact (DAG path counting). Bounded for large graphs (§250): `maxPaths` 3 then "and N
  more"; paths longer than `maxPathNodes` 8 read "… through 195 more nodes to Master"; every
  other section lists `maxItems` 6 then "and N more".
- Further sections: "No Master Output.", "Not connected to the output: …" (sounding sources
  without a path), "Modulation:", "Triggers:", "Analysis:" (taps: observes / records /
  captures), "Measurement:" ("Transfer Analyzer 1 takes reference from Sweep 1 and observed
  from Calibration 1"). `summarizeStudio` adds one timeline sentence.
- `describeNode` → "Oscillator 1, source node, selected" (optional card summary and compiled
  status: unavailable, offline only); `describeEdge` → "Connection from Oscillator 1 audio to
  Filter 1 input" (modulation adds depth and polarity, muted edges say so);
  `describePortLabel` wraps `ports.js portAccessibleLabel` with the connected node names.
- Announcements are derived from store results, never built in the UI: `announceAction`
  (past tense of the history label: "Connected Oscillator 1 to Filter 1", "Deleted Filter 1";
  `Connection rejected: …` kept; other refusals "Not done: …"; view changes say nothing),
  `announceUndo` / `announceRedo` ("Undo: deleted Filter 1"), `announceSelection`. No text
  contains coordinates (a move is "Moved Filter 1").

## Decision candidates

- Patch envelope: own `kind` + `schemaVersion`, embedded `studioSchemaVersion`;
  `PATCH_IMPORT_LIMITS` (above); positions relative to the top-left; patches carry automation
  lanes but no tracks, clips or markers; `PATCH_INSERT_GAP` 120 units.
- `replaceWithPatch` uses the `NODE_REMOVE` cascade (track clips stay on an untargeted track).
- Studio persistence: `DB_VERSION` 2 with `studio` + `studioSummaries` in the experiment
  database; the store checks only the envelope; projects overwrite by id, patches need explicit
  `overwrite`.
- `experiment.studio` is optional without an experiment schema bump (precedent:
  `results.aggregate`), deviating from ADR 0038's "its own migration": old readers reject it as
  an unknown field either way. Studio state stays out of `configHash`.
- `recipeFromStudio` mapping (above), including the engine defaults for `gapS` and aggregation.
- Offline: a Microphone refuses the whole render (not silently dropped); the Master Output level
  is the offline output gain; the render plays exactly what the live transport plays.
- Template hashes pinned in the data; any executed change needs a version bump.

## What remains

- **Browser verification pending**: `node tests/browser/v31-studio-offline.cjs` (chromium,
  firefox, webkit, file://) was written but not run in this change (the machine was reserved for
  other realtime gates). It asserts the Basic Tone level and frequency, frames, fades, the Sweep
  Sequence silence, the Subtractive Synth's Tone then Sweep content and the Measurement Sweep
  refusal. The unit tests cover the plan and the
  refusal paths; the render path itself is verified only by that browser test.
- UI integration: Save/Load/Insert/Replace dialogs, file pickers, the dirty indicator, the
  template picker with Learn text, live-region and aria-label wiring (`src/js/ui`, out of scope).
- `ports.js portAccessibleLabel` lower-cases every label, so the Q input reads "Filter 1 q
  control input"; a fix belongs in ports.js (all-capital labels should keep their case).
- Autosave and crash recovery (§155, §157), graph groups (§116-§117), Studio search (§251).
