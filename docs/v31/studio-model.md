# OSCILLA Studio model core (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` (§9-§11, §27-§40, §47-§52, §159-§163,
§172-§176, §187-§193, §237-§241, §252-§258). Plan issues V404-V408. This document says **how**
the canonical model, ports, node registry, validation and history work as implemented in
`src/js/studio/`; the Studio ADRs (not written yet) will say why. Tests:
`tests/unit/v31-studio-model.test.mjs`.

Every module here is pure: plain data in, plain data out, no DOM, no Web Audio, no globals, no
clock, no randomness. IDs come from an injected generator; inputs are never mutated.

```
 editor / compact view / inspector / timeline  ──dispatch(action)──►  actions.js store
                                                                        │ reducers (pure)
                                                                        │ validate.js (every
                                                                        │   semantic action)
                                                                        ▼ history.js snapshots
                                                       StudioModel (schema.js, frozen, plain)
                                                                        │ later issue
                                                                        ▼ graph compiler
 import file ──► migrate.js importStudio ──► validate.js ──► normalize ──┘
```

## Modules

| Module | Role |
| --- | --- |
| `schema.js` | Model shape, `STUDIO_SCHEMA_VERSION = 1`, `normalizeStudio`, `serializeStudio`, `studioHash`, execution/presentation/view split, plain-data guard |
| `ports.js` | Port types, roles, visual shapes, accessible labels, `canConnect`, modulation edge properties |
| `registry.js`, `nodes/*.js` | Canonical node-type registry and the §29 library (25 types) |
| `validate.js` | Structured graph and timeline diagnostics, cycle analysis, untrusted import |
| `actions.js` | The store: `dispatch`, reducers, copy/paste, duplicate, id generator |
| `history.js` | Undo/redo over immutable snapshots, gesture coalescing |
| `migrate.js` | Migration registry and the import pipeline |

## StudioModel (schema 1)

```js
{ kind: 'oscilla-studio', schemaVersion: 1,
  graph: {
    nodes: [{ id: 'filter-1', type: 'filter', position: { x: 430, y: 160 },
              params: { type: 'lowpass', frequency: 2400, Q: 0.7071, gain: 0, enabled: true },
              metadata: { name: 'Filter 1' } }],
    edges: [{ id: 'edge-4', from: { node: 'osc-1', port: 'audio' },
              to: { node: 'filter-1', port: 'audio' }, props: { muted: false } }] },
  timeline: {
    tracks: [{ id, kind: 'event'|'measurement', name, target: nodeId|null }],
    clips: [{ id, trackId, kind: 'pattern'|'event'|'measurement', start, duration,
              target: nodeId|null, payload }],
    automation: [{ id, target: { node, param }, points: [{ id, time, value, curve }] }],
    markers: [{ id, time, kind, label }],
    loop: { enabled, start, end } },
  transport: { timeMode: 'seconds', tempo: 120, timeSignature: [4, 4] },
  view: { graph: { panX, panY, zoom }, timeline: { pxPerSecond, scrollX } },
  metadata: { title, notes } }
```

- Times are absolute seconds; positions are logical units. An edge's signal type is derived from
  its ports and never stored. Automation points are kept sorted by time.
- Pattern clip payload: `{ blockType, params }` with the sequencer's block types and parameter
  rules (`sequencer/model.js` `BLOCK_SCHEMA`, checked through `normalizeBlock`). Measurement clip
  payload: `{ action }`, one of noise-check, pre-roll, stimulus, capture, tail, analysis. A clip
  without its own target plays on its track's target. Automation is held in lanes, not clips.
- `assertPlainData` (run by `normalizeStudio` and so by `serializeStudio`) rejects functions,
  symbols, BigInt, typed arrays, class instances (AudioNode, MediaStream, DOM, p5, uPlot, Map,
  Date, ...), prototype keys, non-finite numbers and cycles. The store deep-freezes its models.

### Three layers of state

| Layer | Contents | Undoable | Dirty | In `studioHash` | In the file |
| --- | --- | --- | --- | --- | --- |
| Execution | node ids, types, params; edges and props; tracks (id, kind, target); clips; automation; loop; transport | yes | yes | yes | yes |
| Presentation | node positions and names, track names, markers, metadata | yes | yes | no | yes |
| View | pan, zoom, timeline scale and scroll | no | no | no | yes (may persist locally) |
| Ephemeral view | selection, hover | no | no | no | no (store only) |

`studioHash(model)` is the SHA-256 (bundled `calibration/sha256.js`) of the canonical JSON
(`experiments/canonical-json.js`) of `executionState(model)`, whose records are sorted by id so
authoring order does not matter. `STUDIO_HASH_VERSION` versions that selection.
`serializeStudio` is canonical JSON of the normalized model (keys sorted); `serializeStudio(m,
2)` pretty-prints the same key order. `isSemanticallyEqual(a, b)` compares execution and
presentation and is what a dirty indicator should use.

## Ports

| Type | Glyph | Cable | Roles |
| --- | --- | --- | --- |
| AUDIO | circle | solid | SIGNAL (processing path), TAP (analyzer side-chain input; does not alter the path) |
| CONTROL | diamond | dashed | SIGNAL (modulator output), PARAMETER (input bound to one parameter) |
| TRIGGER | triangle | pulse | SIGNAL |
| ANALYSIS | square | dash-dot | REFERENCE (digital stimulus), OBSERVED (capture), RESULT |

A modulatable parameter gets a generated PARAMETER input with the parameter key as its id and
`param: { key, unit, range, mapping }` (mapping `log` for logarithmic parameters).
`portAccessibleLabel` gives "Audio output port, connected to Filter 1" and "Filter 1 cutoff
control input, available".

### Compatibility matrix (`canConnect`)

| from \ to | AUDIO | CONTROL | TRIGGER | ANALYSIS |
| --- | --- | --- | --- | --- |
| AUDIO | allowed (SIGNAL or TAP input) | rejected | rejected | rejected ("route it through a Capture node first") |
| CONTROL | rejected | allowed (PARAMETER input) | rejected | rejected |
| TRIGGER | rejected | rejected | allowed | rejected |
| ANALYSIS | rejected | rejected | rejected | allowed only for the same role (REFERENCE→REFERENCE, OBSERVED→OBSERVED, RESULT→RESULT) |

Every rejection carries a sentence, e.g. "Audio output cannot connect to a trigger input." or
"A reference signal cannot connect to an observed input. The Transfer Analyzer takes the digital
stimulus on REFERENCE and the capture on OBSERVED." `canConnect` also rejects wrong direction,
unknown ports and a node connected to itself.

### Edges per input

| Input | Edges | Why |
| --- | --- | --- |
| AUDIO (every node, incl. Master Output and taps) | one | accidental summing would bypass gain accounting; Mixer has one input per channel and is the only summing node (§188) |
| CONTROL parameter | several | modulations add, each with its own edge depth |
| TRIGGER, ANALYSIS | one | one gate/clock, one reference, one observed capture |

Outputs fan out freely (§189).

### Modulation edge properties

CONTROL edges carry `{ muted, depth, polarity: 'bipolar'|'unipolar', mapping: 'linear'|'log',
offset }`; other edges carry `{ muted }`. Linear mapping: depth and offset in the parameter's
unit, |value| ≤ its range span (the spec's "LFO 1 → cutoff, depth 1200 Hz, bipolar"; the
engine's LFO depth gain is in Hz the same way). Log mapping is only legal on logarithmic
parameters; depth and offset are octaves, |value| ≤ 10. New edges take the parameter's
`modDepth` hint (Filter cutoff 1200 Hz, Oscillator frequency 40 Hz, ...).

## Node registry

`NODE_REGISTRY` holds 25 frozen definitions: Sources (Oscillator, Noise, Sweep, Sequence,
Microphone), Modulation (LFO, Envelope, Random, Step Modulator), Processing (Gain, Filter, Pan,
Stereo Split, Mixer), Analysis (Scope, Spectrum, Spectrogram, Meter, RTA), Output (Master Output,
Recorder/Export), Measurement (Capture, Calibration, Transfer Analyzer, Measurement Result).

A definition has: `type`, `displayName`, `idPrefix`, `category`, `aliases`, `inputs` (explicit
ports, then generated parameter ports), `outputs`, `params` (`key, label, type, min, max, step,
unit, scale, options, default, automatable, modulatable, modDepth, softRange`), `summary(params)`
(e.g. "Low-pass · 2.40 kHz · Q 0.707"), `capabilities` (`realtime, offline, measurement,
requiresInputPermission, serializable`), `help` (`what, inputs, outputs, constraints`),
`clipKinds`, `maxInstances`, `sounding`, `summing`, and `compiler` plus `reuses`: string keys
`'module.js#export'` naming the existing builder the compiler will adapt (the unit tests import
each module and check the export exists). No definition holds an audio object.

Defaults come from the engine: `DEFAULT_FILTER`, `DEFAULT_ADSR`, `DEFAULT_SWEEP`,
`DEFAULT_PATTERN_PARAMS`, `createStereoRouter`, `createNoiseSource`, the engine analyser
(fftSize 8192, smoothing 0.55), `createSpectrogram`, `createRtaAverager`, `DEFAULT_RENDER`,
`DEFAULT_POINTS_PER_OCTAVE`, and `DEFAULT_GAIN` / `MAX_OUTPUT_GAIN` for Master Output, whose level
is neither automatable nor modulatable. Frequency ranges are model validity ranges up to
0.95 × Nyquist of the highest accepted sample rate; the compiler clamps to the running context.

Measurement routing (§106, §258): Sweep has an AUDIO output and an ANALYSIS REFERENCE output (the
exact digital stimulus); Microphone has a live AUDIO output (analyzers only; it may never reach
Master Output) and an ANALYSIS OBSERVED `capture` output; Capture turns any graph audio into an
OBSERVED capture (digital loopback); Calibration maps OBSERVED → OBSERVED; Transfer Analyzer
takes REFERENCE and OBSERVED on separate ports and outputs a RESULT for Measurement Result.

`searchNodeTypes(query)` scores each query token against the name (exact, word prefix,
substring), aliases, type id and category label; every token must match; ties keep library order.

## Validation

`validateStudioModel(model)` returns `{ ok, errors, warnings, diagnostics, order }`; each
diagnostic is `{ code, severity, message, path, nodeId?, edgeId?, detail? }`.

| Code | Severity | Rule |
| --- | --- | --- |
| unknown-node-type, missing-node, unknown-port, wrong-direction | error | references |
| self-connection, type-mismatch, role-mismatch | error | `canConnect` with its reason |
| duplicate-edge, multiple-connections | error | see "Edges per input" |
| invalid-edge-props, invalid-param, unknown-param | error | value rules |
| invalid-id, duplicate-id, invalid-position, invalid-name | error | ids share one namespace |
| too-many-instances | error | one Master Output (§187) |
| audio-feedback | error | "Connection rejected: This would create an unsupported instantaneous audio feedback loop." |
| control-cycle, analysis-cycle | error | see the policy below |
| live-input-to-output | error | a microphone has an AUDIO path to Master Output |
| unreachable-output, no-master-output | warning | a sounding source (Oscillator, Noise, Sweep, Sequence) is not heard |
| unconnected-input | warning | a required input (analyzer tap, Transfer Analyzer reference/observed, Master input) is open |
| timeline codes | error | missing-track, clip-kind-mismatch, invalid-clip, invalid-clip-target, invalid-time, not-automatable, duplicate-lane, invalid-automation, invalid-marker, invalid-loop, invalid-transport, invalid-view |

Unreachable sources are warnings, not errors, because building a graph passes through such
states (a source added before its cable) and an unheard source is not unsafe; the editor shows
them as "unconnected".

### Cycle detection and control-cycle policy

Cycles are found on the node graph with Tarjan's strongly connected components; a cyclic
component whose internal edges are all AUDIO is an `audio-feedback`, any other cyclic component
that contains a CONTROL or TRIGGER edge is a `control-cycle`, and one with only ANALYSIS edges an
`analysis-cycle`. The reported path is a shortest cycle through the component. A valid graph
always has a node topological order (Kahn; ties broken by model order, so deterministic), which
the compiler will use. Nothing invalid reaches Web Audio (§38, §241).

| Pattern | Example | Verdict |
| --- | --- | --- |
| Acyclic modulation chain | Random → LFO 1 rate → LFO 2 rate → Filter cutoff | allowed |
| Several modulators on one parameter | LFO 1, LFO 2 → Filter cutoff | allowed (contributions add) |
| Envelope contour as modulation | Envelope control → Filter cutoff | allowed |
| Modulator loop | LFO 1 → LFO 2 rate, LFO 2 → LFO 1 rate | rejected, control-cycle |
| Modulation of the source feeding the modulator | Oscillator → Envelope (audio), Envelope control → Oscillator frequency | rejected, control-cycle (use a second Envelope on the same gate for pitch) |
| Instantaneous audio loop | Mixer → Filter → Gain → Mixer input 2 | rejected, audio-feedback |
| Analysis loop | Calibration 1 → Calibration 2 → Calibration 1 | rejected, analysis-cycle |
| Self connection | any port to its own node | rejected, self-connection |

The policy is node-level and conservative: it does not track which output depends on which
input inside a node, so a node is in a cycle whenever a path leaves and re-enters it. Safe
delay/feedback nodes need their own feature and ADR (§39).

### Untrusted import

`validateStudioImport(input, limits)` (current schema) and `importStudio(input)` (any supported
schema) never eval and never throw. Pipeline: size cap before `JSON.parse` → structural scan
(`experiments/validate.js` `scanUntrusted`: plain data, no `__proto__`/`constructor`/
`prototype` keys, finite numbers) → nesting depth → kind and version → counts → strict schema
(unknown fields, node types, parameters) → normalize → `validateStudioModel`. Limits
(`STUDIO_IMPORT_LIMITS`): 4 MiB, depth 12, 512 nodes, 2048 edges, 64 tracks, 2048 clips, 512
automation lanes, 20000 points (4096 per lane), 512 markers, 256-character strings (names 64,
notes 10000).

### Migrations

`studioMigrations[n]` upgrades schema n − 1 to n; schema 1 is the first, so `1` is an identity
placeholder. `migrateStudio` reuses `experiments/migrate.js` (copying, stepwise application,
refusal of newer versions). `importStudio` runs the safety scan before any migration step, then
the strict current-schema validation after it; version numbers are read nowhere else.

## Actions and history

`createStudioStore(model, { idGenerator, onChange })` is the only writer of the model.

| Action | Payload | History label |
| --- | --- | --- |
| NODE_ADD | `nodeType, position?, params?, name?` | Add Filter 1 |
| NODE_REMOVE | `nodeId` or `nodeIds` (cascade: edges, clips targeting it, its lanes; track targets cleared) | Delete Filter 1 |
| NODE_MOVE | `nodeId, position` or `nodeIds, delta` | Move Filter 1 |
| NODE_PARAM_SET | `nodeId, key, value` or `nodeId, params` | Change Filter 1 Cutoff |
| NODE_RENAME | `nodeId, name` | Rename Filter 1 to HF Filter |
| EDGE_ADD / EDGE_REMOVE / EDGE_UPDATE | `from, to, props?` / `edgeId(s)` / `edgeId, props` | Connect Oscillator 1 to Filter 1 |
| TRACK_ADD / TRACK_REMOVE | `kind, name?, target?` / `trackId` (removes its clips) | Add Track 1 |
| CLIP_ADD / CLIP_REMOVE / CLIP_MOVE / CLIP_RESIZE | `trackId, kind?, start, duration, target?, payload?` / `clipId` / `clipId, start?, trackId?` / `clipId, start?, duration?` | Add pattern clip |
| AUTOMATION_POINT_ADD / _MOVE / _REMOVE | `target: { node, param }, time, value, curve?` (creates the lane) / `laneId, pointId, time?, value?, curve?` / `laneId, pointId` (removes an empty lane) | Automate Filter 1 Cutoff |
| MARKER_ADD / MARKER_REMOVE, LOOP_SET, TRANSPORT_SET, METADATA_SET | | Add sweep marker |
| PASTE | `clipboard` (from `copySubgraph`), `offset?` (default 24, 24) | Paste 3 nodes |
| DUPLICATE | `nodeIds?, clipIds?, offset?` | Duplicate Filter 1 |
| SELECTION_CHANGE, VIEW_SET | view state: no history, no revision | — |

- A semantic action is reduced, then the whole result is validated; any error rejects it with
  the first error's message and leaves model, history, selection and revision untouched. The
  initial model must be valid, so the store's model always is. NODE_MOVE alone skips graph
  validation (positions cannot change validity), keeping a 400-event drag cheap.
- Paste and duplicate map every node to a new id, keep only edges with both ends in the set,
  renumber default names ("Filter 2") and keep custom names; nodes over `maxInstances` (Master
  Output) are skipped and reported in `skipped`.
- `revision` is monotonic and in memory; it rises on every semantic change, undo and redo.

History strategy (§49): immutable snapshots with structural sharing. Each entry holds the model
references before and after; undo restores the earlier reference exactly, so no inverse code
can drift from its action (the §208 test checks reference equality and byte-equal
serialization). An entry costs only the changed path: one new array of node pointers, the
changed node and its parents, about 1-2 KB at 100 nodes; `STUDIO_HISTORY_LIMIT = 200` entries
therefore stay well under 1 MB. A command log would be smaller per entry but would need
hand-written inverses for ~25 actions and their cascades.

`beginGesture(label?)` … `endGesture()` folds every change in between into one entry labelled
with the gesture label or the first action's label (a 400-event drag is one "Move Filter 1");
gestures nest; `cancelGesture()` returns to the model at gesture start without an entry (Escape,
§185); undo and redo close an open gesture first. A new edit after undo clears redo, including
the first change inside a gesture. `debugInfo()` exposes undo/redo depth, last action,
revision and counts for the debug mode (§52, §177).

## Decision candidates

Values future work depends on and that should be recorded as Majordomus decisions:
`STUDIO_HISTORY_LIMIT` (200), `STUDIO_IMPORT_LIMITS` (above), the id scheme (`<prefix>-<n>` from
`createIdGenerator`, ids shared across nodes, edges, tracks, clips, lanes, points and markers,
`ID_PATTERN` of the experiment schema), `PASTE_OFFSET` (24, 24 logical units), the hash
selection (positions, names and markers excluded), and the default timeline view
(100 px/s). Zoom bounds are not decided yet: the model accepts any positive finite zoom.
