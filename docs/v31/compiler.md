# OSCILLA Studio graph compiler and runtime (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §41-§46, §80, §170-§171, §177-§179,
§186-§190, §209-§210, §213, §240-§242. Plan issues V414 (graph compiler) and V415 (incremental
runtime patching). ADR 0035 says why; this document says how. Code:

| File | Role |
| --- | --- |
| `src/js/studio/compiler.js` | `compileStudio` (model → plan), `diffPlans`, `instantiateNode`, `createEdgeHandle`, `computeBases`, `disposeHandle` |
| `src/js/studio/runtime.js` | `createStudioRuntime`: id → handle map, transactional `apply`, `start` / `stop` / `dispose`, `debugInfo`, owned parameters (`setOwnedParams`, `baseOffset`) |
| `src/js/studio/adapters/nodes.js` | one adapter per registry node type, built only from existing builders |
| `src/js/studio/adapters/engine-hooks.js` | the single place that touches the AudioEngine instance; accounting closures |
| `src/js/studio/adapters/ramp.js` | click-free route ramps (ADR 0001 applied to edge gains) |

Tests: `tests/unit/v31-studio-compiler.test.mjs` (recording fake AudioContext under the real
AudioEngine), `tests/browser/v31-studio-audio.cjs` (chromium, firefox, webkit, file://).

## No second audio engine (§42)

The runtime never creates an AudioContext or an output chain. It takes the application's
`AudioEngine` and

- registers every node it creates in `engine.nodes` and every scheduled source in
  `engine.sources` (as `measurement/capture.js` already does), so `engine.activeNodeCount` and
  `activeSourceCount` include the Studio graph and drop to 0 after `stop()`;
- leaves the graph only through the Master Output bus, connected to `engine.master`, the head
  of the existing safety chain `master → limiter → trim → ceiling → analyser → destination`.
  Nothing in `src/js/studio/` connects to `ctx.destination` (§186, §240; asserted by the unit
  test that walks every Studio node's connections);
- maps the Master Output level onto `engine.setMasterGain` (clamped to `MAX_OUTPUT_GAIN`,
  smoothed) while it plays, so the logical master gain is still one value; STOP gives the
  engine back the level it had before start (its glide held until the Studio bus has faded),
  so MEASURE, Labs and the Playground never inherit the Studio's level.
  `options.masterLevel: 'ignore'` leaves the engine gain alone.

### Adapters per node type

| Type | Registry `compiler` | Built with |
| --- | --- | --- |
| Oscillator | `audio/audio-engine.js#AudioEngine` | `engine._osc` (frequency clamp, start) + level GainNode |
| Noise | `audio/noise.js#createNoiseSource` | `createNoiseSource` (its start/stop fades, colour crossfade) |
| Sweep | `audio/patterns.js#buildPlan` | log, 1-30 s, start < end: `renderStimulus` buffer (the exact digital reference); otherwise the engine `ramps` topology (`engine._osc`, frequency ramp, linear fades) and no reference, with a reason |
| Sequence | `sequencer/compiler.js#compileSequence` | a level bus exposed as `info.destination` + `info.accounting` for the timeline's `compileSequence` voices |
| Microphone | `audio/microphone.js#openMicrophone` | `openMicrophone` → output gain (analysis only); degraded without getUserMedia or until the Inspector's Allow microphone; its tracks stop on dispose, also when the context closes |
| LFO | `audio/modulation.js#buildLfo` | `engine._osc` as modulator; the depth gain belongs to the edge |
| Envelope | `audio/envelope.js#applyAdsr` | `applyAdsr` / `releaseAt` on a VCA gain and on a ConstantSourceNode offset (contour 0..1) |
| Random | `audio/noise.js#mulberry32` | seeded values in a looping AudioBuffer (`steppedControl`) |
| Step Modulator | `audio/scheduler.js#scheduleSteps` | the step list in a looping AudioBuffer (`once`: holds the last step) |
| Gain | `audio/audio-engine.js#AudioEngine` | GainNode |
| Filter | `audio/filters.js#createFilterStage` | `createFilterStage` (glides, bypass crossfade, Q conversion) |
| Pan | `audio/stereo.js#createStereoRouter` | StereoPannerNode on a 1-channel input (the engine's `buildDual` panner); fallback `createStereoRouter` 'pan' mode |
| Stereo Split | `audio/stereo.js#createStereoRouter` | `createStereoRouter` |
| Mixer | `audio/audio-engine.js#AudioEngine` | one level GainNode per input into a sum (the only summing node, §188) |
| Scope, Spectrum, Meter | `analysis/analyser.js#createAnalyserReader` | AnalyserNode + `createAnalyserReader` |
| Spectrogram | `analysis/spectrogram.js#createSpectrogram` | AnalyserNode + reader; the view binds `createSpectrogram(canvas)` |
| RTA | `measurement/rta.js#createRtaAverager` | AnalyserNode + reader + `createRtaAverager` |
| Master Output | `audio/audio-engine.js#AudioEngine` | bus GainNode → `engine.master` |
| Recorder/Export | `audio/offline-renderer.js#renderToWav` | offline only: an explicit `offline-only` handle |
| Capture | `measurement/capture-checks.js#checkCapture` | a tap GainNode, the attach point of the measurement io |
| Calibration, Transfer Analyzer, Measurement Result | their measurement keys | data handles: ANALYSIS edges are bindings for the measurement engine, not Web Audio |

`compileStudio` checks that every adapter implements its definition's `compiler` key; a missing
adapter or a key mismatch compiles to a degraded node with that reason.

## Compilation

`compileStudio(model, { engine, registry, adapters, options })` is pure (no audio node is
created):

1. **Validate** with `validateStudioModel`; an invalid model is refused with its diagnostics
   (`{ ok: false, errors }`), never thrown, so Web Audio never discovers a topology (§38, §241).
2. **Resolve** each node's adapter through the registry and decide its status: `ready`,
   `degraded` (capability missing: Microphone without `getUserMedia`, as on file:// in
   Chromium, or before permission; no Web Audio), `offline-only` (Recorder), `data`
   (measurement data nodes). Each non-ready status carries a reason (§170-§171).
3. **Order** nodes by the validator's deterministic topological order (Kahn, ties in model
   order) and edges by (source rank, target rank).
4. **Edges**: kind from the source port type, properties completed by `validateEdgeProps`,
   status `active`, `logical` (TRIGGER), `data` (ANALYSIS) or `inactive` with the reason when an
   end is unavailable.

The runtime then instantiates the plan in order and routes it:

- **AUDIO edge**: source output → edge GainNode → target input. Every route has its own gain,
  which is the crossfade point of every change. Fan-out is explicit (§189): an output feeds as
  many edge gains as it has edges; AUDIO inputs accept one edge (validator), so summing only
  happens in the Mixer (§188).
- **Analysis tap** (§190): the same edge into an analyzer, Capture or Recorder input, nodes with
  no output, so a tap observes a copy and cannot alter the path.
- **CONTROL edge**: modulator output → edge depth GainNode → target AudioParam. A source range
  `[lo, hi]` (LFO, Random, Steps: −1..1; Envelope contour: 0..1) maps onto `[−depth, depth]`
  (bipolar) or `[0, depth]` (unipolar): edge gain `a = (t1 − t0) / (hi − lo)`, and
  `b = t0 − a·lo + offset` is added to the parameter's base value. Linear mapping is in the
  parameter's unit; log mapping (frequency-like parameters) is in octaves, applied as cents on
  the node's `detune` AudioParam (`f · 2^(cents/1200)`, exact). This is automation.js's
  combination rule realised with AudioParam summing. Several edges on one parameter add.
- **Safety clamp**: frequency parameters keep base + upward excursion ≤ 0.95 × Nyquist of the
  running context: the base is clamped and the edges' excursion scaled down to fit; such edges
  are listed in `debugInfo().limitedEdges`. A frequency an automation lane owns is sized from
  the lane's peak (the transport claims it with `setOwnedParams([{ node, param, peak }])`),
  not from the static value the lane overrides, and a changed peak re-sizes the node on the
  next apply (review V431 X1). Other parameters are not clamped at audio rate
  (an AudioParam sum cannot be); when base ± modulation can leave the range it is listed in
  `debugInfo().exceeds` (§242: excessive gain made visible, the limiter is a last resort).
- Unsupported modulation targets become **inactive routes with a reason**: Q of a low- or
  high-pass filter (a dB AudioParam in Web Audio, a linear depth would be mis-scaled), log
  mapping without a detune AudioParam, pan without StereoPannerNode.
- **TRIGGER / ANALYSIS** edges get no Web Audio connection; `runtime.bindings()` lists them for
  the timeline scheduler and the measurement engine.

## Runtime representation (§43)

`runtime.nodes.get('filter-1')` is the handle of that node: `{ id, type, name, status, reason,
inputs, outputs, info, nodes, sources, modTarget(key, mapping), applyBase, update, stop,
dispose }` plus type-specific `info` (`info.stage` of a filter, `info.analyser` / `info.reader`
of an analyzer, `info.reference` of a sweep, `info.destination` of a Sequence, `gate(t, durS)`,
`release(t)` and `hold(t)` of an Envelope). `runtime.edges.get(id)` is the route. The model stays plain data; handles are
never stored in it or in Alpine state.

## Diffing (§44)

`diffPlans(prev, next)` produces the minimal patch, in a deterministic order:

| Model change | Operation | Runtime effect |
| --- | --- | --- |
| parameter value | `node-params` | modulatable keys: base re-computed and glided (`setTargetAtTime`, τ 15 ms, as `engine.updateLive`); other keys: the builder's own `update` (filter bypass crossfade, noise colour crossfade, router glide, analyser size, engine master gain) |
| structural key (`waveform`, LFO `shape`, filter `type`, every sweep parameter, Random `seed`/`smooth`, Steps `steps`/`playback`, RTA averaging) or status change | `node-replace` | a new node is built and its edges are `edge-rewire`d: crossfade old → new |
| an adapter's `rebuildWhenOwned` key (filter `enabled`) on a node with an owned parameter | `node-replace` | as above: the builder's live update cannot skip the owned parameter |
| node added / removed | `node-add` / `node-remove` | built silent and faded in / routes faded out, sources stopped after the fade, disposed |
| edge added / removed | `edge-add` / `edge-remove` | route gain 0 → 1 / → floor, then disconnected |
| edge endpoints moved | `edge-remove` + `edge-add` | crossfade |
| mapping changed (linear ↔ log) | `edge-rewire` | another AudioParam: crossfade |
| other edge properties | `edge-props` | mute ramps the route; depth, polarity and offset re-compute the target's base and edge gain |

Structural keys exist because some changes cannot be applied to a running node without a
click: `OscillatorNode.type` cannot be scheduled, and a filter type change would make
`createFilterStage` crossfade to its second biquad, away from the AudioParams the modulation is
wired to.

## Transactions (§46, §179)

`runtime.apply(model, { revision })` while running:

1. **validate**: `compileStudio`; refusal → `{ ok: false, phase: 'validate' }`, nothing touched.
2. **prepare**: build every new and replacement node and every new route, route gains at 0
   (also as intrinsic value, see below), sources starting at `t = hooks.soon()`. An exception
   here disposes everything prepared; the previous runtime keeps playing unchanged
   (`{ ok: false, phase: 'prepare', kept: true }`, `lastError` set). Never half-connected: the
   unit test injects a builder failure and compares maps, node counts and live connections.
   In the Studio the edit is then refused, as ADR 0035 says. While playing, the store's commit
   gate is `transport.admit`, which runs this transaction before the store commits. A failure
   refuses the dispatch, undo or redo, and model, revision and history stay as they were.
   Nothing global is written while preparing: an adapter's `create` never changes engine state
   outside the Studio graph (below, "Global side effects"), so a refusal leaves none. The
   reason is announced and shown (V431 review #15,
   `tests/unit/v431-studio-refused-edit.test.mjs`). Node and edge status in the UI come from
   the running runtime while it plays (`graph-view.js` `runtimeStatus`, judged by the
   divergence verdict, below).
3. **commit**: swap the handle and route maps and the plan; `revision` (the store's, or an
   internal counter) now names the topology the runtime reflects (§178). From here the
   transaction is committed and `apply` does not throw: every later step is guarded, a guarded
   step that throws is its `<step>-failed` warning and any other throw is `commit-failed`, the
   result is `ok` with those warnings, and the applied record names this revision. A throw
   escaping here would make the commit gate refuse an edit whose plan the runtime already holds
   (v4.0 closure audit F4, `tests/unit/v40-studio-runtime-closure.test.mjs`).
4. **crossfade** at `t`: new routes ramp 0 → 1 and removed routes 1 → floor over
   `STUDIO_XFADE_S` (20 ms, `filters.js` CROSSFADE_S) in the same window (equal-gain linear
   crossfade; the two paths of a reconnect are usually correlated, where equal-power would bump
   the level); parameter bases glide; new nodes `engage` their global side effects; retired
   sources stop 10 ms after the fade. Each step is guarded; a failure there becomes a warning,
   never a half-applied route.
5. **cleanup** `CLEANUP_MARGIN_S` (50 ms) after the fade: retired routes and nodes are
   disconnected, disposed and removed from the engine accounting. The timer is UI bookkeeping
   (`engine._timers`); on a suspended or closed context cleanup runs at once, as the engine does.

While stopped, `apply` only stores the plan (`applied: false`). `start()` is the transaction
from the empty plan; `stop()` fades the Master bus to the floor over `STUDIO_STOP_S` (15 ms,
the engine's fast release; `{ fast: true }`: 8 ms, Escape), stops every source after it,
disposes everything and resolves with the counts once released (§184). PLAY → STOP → PLAY
repeats without growth. `dispose()` stops and detaches from the engine. If the context is
closed from outside, the runtime drops its graph and removes its nodes from the engine sets; it
still disposes each builder, so a Microphone's MediaStream tracks stop.

### Global side effects

One Studio parameter changes state outside the Studio graph: the Master Output `level` drives the
ONE engine master gain (`engine.setMasterGain`), which MEASURE's stimulus, Labs and the Playground
also pass. An adapter reaches it only through `env.global.setMasterLevel`, from `engage()` (called
by the runtime after the commit, for each node the transaction created) and from `update` (also
after the commit); `create` never writes it. The first write of a running session saves the
engine's level, and every way out gives it back: STOP (held until the fade ends), a PLAY whose
transaction failed, `setOptions({ masterLevel: 'ignore' })`, `dispose()`, and a context closed
from outside. Before v4.0 the Master adapter wrote the level in `create`, so a PLAY refused in
prepare, or a refused live edit that added a Master Output, left the Studio's level on the engine
(after STOP too), and MEASURE then played its stimulus at that level.

### Click-free routes (§45)

`createRamp` keeps the last segment of each route gain and, like the engine's `_freeze`
(ADR 0001), inserts the hold before cancelling only what follows it: an in-progress ramp is
re-ended on its own line at `t`, so a crossfade started inside another continues from the exact
current gain; no `cancelAndHoldAtTime`, one code path in every browser. Two browser findings
shaped it (`tests/browser/v31-studio-audio.cjs`):

- Firefox: a route or the bus ramped to exactly 0 while its source plays gave a deterministic
  step at the end of the fade (5.35 × the sine slope for a mute, 3.44 × for a stop): once the
  input to the master chain is digital silence the tail of the fade is dropped. Routes and the
  bus therefore fade to `ROUTE_FLOOR` (the engine's `GAIN_FLOOR`, −80 dB) and are disconnected
  only from there, as the engine's releases do; a muted edge sits at −80 dB. Measured after the
  change: 1.0.
- WebKit: a route connected while rendering passed one sample at the GainNode default 1 before
  the `setValueAtTime(0, now)` event applied (a one-sample doubling, 64 × slope, in 1 of 6
  filter insertions). New route and bus gains also set the intrinsic `value` before connecting.
  Measured after the change: 1.0 in every take.

## Debug mode (§177)

`debugInfo()` → `{ state, compiledRevision, modelNodeCount, modelEdgeCount, runtimeNodeCount,
runtimeSourceCount, handleCount, routedEdgeCount, pendingCleanups, engineNodeCount,
engineSourceCount, degraded, inactiveEdges, limitedEdges, exceeds, warnings, diagnostics,
lastOps, lastError, applied, ownedParams }`. `degraded` and `inactiveEdges` are
`{ id, status, code, reason }` (the live handle's or route's, else the plan's); `diagnostics`
holds validation's warnings and the runtime's own, structured; `warnings` is their message text.

## Runtime truth (ADR 0039)

The screen must never show one topology while Web Audio runs another (§1). These four pieces
make "what runs" plain data that a view, a test or an agent can compare, instead of object
identity or prose.

### Diagnostics

One shape (`validate.js` `studioDiagnostic`), used by validation, the compiler, the runtime and
the transport:

```js
{ code, severity: 'error' | 'warning', owner, entity: { kind, id } | null, message, details? }
```

`owner` is one of `DIAGNOSTIC_OWNERS` (`validate`, `compiler`, `runtime`, `transport`).
`code` is the machine reason that a consumer branches on, and `message` is display prose that
nobody parses. `entity` names the node, edge, clip or lane the diagnostic is about. `details`
is optional plain data, reserved: no producer sets it yet. Validation
keeps its compatibility fields `path`, `nodeId?`, `edgeId?` and `detail?` (a cycle's node names,
as prose). A plan node or edge, a runtime handle or route, and a transport `unplayed` entry carry
the same `code` beside their display `reason`. `code` is `null` when there is no reason. The
status maps the views read (`compiledStatus`, `compiledEdgeStatus`, `runtimeStatus`) are
`{ status, code, reason }`.

| Owner | Where | Codes |
| --- | --- | --- |
| validate | `validateStudioModel`, `validateStudioImport` | the rule codes of `validate.js` (header): `audio-feedback`, `unreachable-output`, `invalid-structure`, `limit-exceeded`, ... |
| compiler | PlanNode `code` | `no-adapter`, `adapter-mismatch`, `offline-only`, `no-web-audio`, an adapter check's code: `mic-unsupported` (no `getUserMedia`), `mic-off` (no input permission); `unavailable` for a check that gives no code |
| compiler | PlanEdge `code` | `endpoint-offline-only`, `endpoint-unavailable` (an end is not usable) |
| compiler | a refused compile | `invalid-structure` (validation threw on a model of the wrong shape) |
| compiler | `studioStatus(...).error`, every node and edge status | `compile-failed`: `compileStudio` threw after validation (it should not); the Studio shows the reason instead of a blank status |
| runtime | handle `code` | `mic-pending` (waiting for the input), `mic-error` (the input failed to open), `mic-ended` (its track ended by itself: permission withdrawn, device gone); otherwise the plan node's. A settled handle is announced as the runtime event `'handle'` |
| runtime | route `code` | `no-output`, `no-input`, `no-mod-target` (the handles cannot make the route); otherwise the plan edge's |
| runtime | `apply` warnings, `debugInfo().diagnostics` | `update-failed`, `parameters-failed`, `output-failed`, `engage-failed`, `stop-failed` (entity: node), `route-failed` (entity: edge): a guarded step after the commit that threw; `commit-failed` (no entity): any other throw after the commit |
| runtime | `lastError.errors`, a refused `apply` / `start` | `prepare-failed` (entity: the node or edge whose preparation threw), `start-failed`, `nothing-compiled`, `disposed`; a validation refusal carries validation's diagnostics |
| transport | `debugInfo().diagnostics`, the `'warning'` event | `edit-refused` (the commit gate refused a live edit), `sync-refused` (the runtime refused a synced model), both with the runtime diagnostic's entity, `automation-failed` (entity: lane), `measurement-callback-failed`, `timeline` (a timeline-compiler warning, its prose as the message). One diagnostic per code and entity (per code and message without an entity); a newer one replaces the older |
| transport | `debugInfo().lastError` (a Diagnostic plus `phase`), `start()`'s `code` | PLAY refused: `disposed`, `claim-failed` (the output claim threw), `claim-refused`, `play-refused` (the runtime refused to apply or start the model; entity: the runtime diagnostic's); or a live edit's `edit-refused` / `sync-refused` |
| transport | `debugInfo().unplayed[].code` | `no-target`, `pattern-target`, `event-target`, `target-unavailable`, `no-parameter` |

`runtime.apply` returns `warnings` as diagnostics in both branches, stopped and running. The
transport's diagnostics are those of the current playback: PLAY starts an empty list, and an
`edit-refused` or `sync-refused` leaves it once a later model is applied. The transport's
`'warning'` event passes the diagnostic. The workspace's warning line and the
offline render's warnings use its `message`.

### Plan identity

`planHash(plan)` (`compiler.js`) is SHA-256 (lowercase hex) of the canonical JSON of:

```js
{ v: PLAN_HASH_VERSION,
  studioHash,                                    // of the plan's model (execution state)
  nodes: [[id, type, adapterCompilerKey, status, code], ...],          // topological order
  edges: [[id, kind, fromNode, fromPort, toNode, toPort, status, code], ...] }  // edge order
```

It is computed with the same `canonicalJson` and synchronous `sha256Hex` as `studioHash`. It
runs on first read and is memoized per plan object (plans and store models are immutable), so
compiling and the audio path never wait for it. Equal models compiled with equal capabilities
give equal hashes. Moving or renaming a node, metadata and view state change neither
`studioHash` nor `planHash`. A parameter or route change changes both. A status change, for
example the microphone permission or Web Audio availability, changes only `planHash`, because
the plan that runs is different. A refused or empty plan has `null`.

### Applied record

`runtime.applied()` → `{ revision, studioHash, planHash, at } | null`, also
`debugInfo().applied`. It is set only when a transaction commits: `start()`, and `apply` while
running, including an apply that only changes presentation. A refused apply (validate or prepare)
leaves it as it was, and so does an apply while stopped, which only stores the plan.
`setOptions` (microphone permission) re-applies the same model at the same revision, so the
record keeps its revision and gets the new `planHash`. It is
`null` while stopped or before the first start, because nothing runs then. `at` is wall-clock ISO
text for people reading a log. It is never used for audio timing. The hashes are computed on
first read.

`runtime.lastError` also names the `revision` it refused (the one passed to `apply`, or the
compiled revision `start` could not build) and the `studioHash` of that model (`null` when it
has none, a model of the wrong shape). It is cleared when a transaction later commits that same
revision (a PLAY that failed, then succeeded).

### Divergence

`studioDivergence({ model, revision }, runtime)` (`runtime.js`) is pure. It reads the runtime's
`state`, `applied()` and `lastError` and changes nothing; a `null` runtime (none created yet) is
a stopped one. A refusal is of the desired model when its revision matches (or, without a
revision, it is newer than the applied record) and its `studioHash` is the desired one: under
the commit gate a refused attempt's revision number is the next commit's, possibly of another
document.

```js
{ state, desired: { revision, studioHash }, applied: record | null, reason: Diagnostic | null }
```

| State | When | `reason` |
| --- | --- | --- |
| `not-applied` | the runtime is not running (stopped, never started) | the refusal of this revision if PLAY failed on it, else `null` |
| `in-sync` | the applied record is the desired revision; without a revision, the same `studioHash` | `null` |
| `refused` | the runtime refused the desired revision (`lastError.revision`); without a revision, a refusal newer than the applied record | the runtime's diagnostic (`lastError.errors[0]`) |
| `behind` | the applied record is another revision, normally older, and the desired one was not refused: it has not been applied yet | `null` |

With the workspace's commit gate, a refused live edit never becomes the desired model, so the
verdict stays `in-sync` and the refusal is the dispatch result. `refused` arises when a store
commits first (no gate) and the runtime then refuses. `runtimeStatus(model, runtime, revision)`
(`graph-view.js`) consumes the verdict. When it is not `in-sync`, a model node or edge that the
running plan does not hold is `degraded` / `inactive` with code `not-in-runtime`. The workspace
passes the store revision (`studioStatus(model, { runtime, revision })`).

The Inspector shows the verdict to users (`inspector.js` `runtimeView`, the Studio view's
**Runtime** section, user guide "Is what plays what you see?"). It derives nothing: the state is
the verdict's (`not-applied` with a reason is shown as Failed), the identities are the verdict's
and `applied()`'s, the counts are the status maps the graph draws (`studioStatus`, `edgeRoute`),
the lanes and owned parameters are `transport.debugInfo().lanes` and `runtime.ownedParams()`,
and the diagnostics are the verdict's reason plus, while a graph runs, `debugInfo().diagnostics`
of the runtime and the transport; each entity links to the selection that shows it. Node and
connection status lines add the status `code` and the diagnostics that name them.

`transport.sync()` follows the same truth. When `runtime.apply` refuses the store's model, the
transport keeps the model, owned parameters and schedule of the graph that still runs. It does
not schedule clips or lanes of the refused model. It records the refusal (`lastError` with code
`sync-refused`, and a diagnostic) and returns `{ ok: false, synced: false, applied }`. The next
store change tries again.

### Operation trace (ADR 0042)

The verdict says *whether* what plays is what the model says. The trace says *what happened*
to one edit. `core/trace.js` `createTrace({ cap, now, onIdle })` keeps the last `TRACE_CAP`
(256) steps in a ring. When it is full, each new step drops the oldest and `stats().dropped`
counts it. Producers get one port, `{ run(fn), record(owner, kind, fields) }`, at the Studio
composition point (`workspace.js`): the store handle, the runtime and the transport. None of
them imports another to report, and each defaults to `NO_TRACE`, which records nothing.

```js
{ op, seq, at, owner, kind, revision, entity: { kind, id } | null, outcome, code, detail }
```

A step is frozen plain data, and `detail` is a flat object of primitives. `op` (`op-<n>`) is
the correlation id, assigned at the first step of the outermost `run`. Ids are gapless, and
`stats().ops` counts only operations that recorded a step. Everything called inside that run
reports under the same op, including the commit gate's `transport.admit` and `runtime.apply`.

These are operations:

- the store's semantic `dispatch`, `undo`, `redo` and a cancelled gesture's return (`cancel`);
- the handle's `replace` (opening a project, template or file);
- `transport.start`, `stop`, `sync` (including a wake-up's sync) and `admit`;
- the transport's abort (`stop`, `aborted`);
- `runtime.apply` and `start` when called alone.

These are not traced: selection and view changes, `endGesture` (no model change), the
timeline's scheduled clips and lane events, a pending handle settling, and deferred disposals. The ids the code already shares end to end are kept: `revision` is the store
revision (in the handle's numbering) that the gate offers and the runtime applies, and `entity`
is the model's node or edge id, which is also the plan entry's and the handle's id. `code` is a
Diagnostic code from the table above whenever a step is a refusal or a failure.

| Owner | Kind | Outcome, detail |
| --- | --- | --- |
| store | `action`, `undo`, `redo`, `cancel` | `requested`; the action type, key and value (a primitive, else `null`) |
| store | `replace` | `committed`: the revision and the reason (open, template, import) |
| store | `commit` | `committed` (with the revision), `unchanged`, `rejected` (validation code), `refused` (the gate's reason) |
| runtime | `compile` | `compiled`: `planHash` and the number of diff ops; `refused`: validation's code |
| runtime | `apply` | `applied`: `at` (the crossfade time), ops, nodes, edges; `not-applied`: the runtime `state` (stopped: the plan is kept for PLAY); `refused`: `prepare-failed` or `disposed` with the entity that threw |
| runtime | `node` | `built`, `replaced`, `retired` |
| runtime | `route` | `scheduled`: the edge `gain`, from `at`, reached at `end` (the value `ramp.to` returned) |
| runtime | `param` | `scheduled`: `param`, `value`, `unit`, `via` and `at` for `set` and `glide` (none for a `crossfade`); `stored`: not written now (`via` `next-gate` for an Envelope, else `null`), no `at`; `owned`: not written, another owner drives it |
| runtime | `update`, `parameters`, `output`, `stop`, `route` | `failed`, with its `<step>-failed` code |
| runtime | `start`, `stop` | `start` refused (`start-failed`, `nothing-compiled`); `stop`: `at`, `fade` |
| transport | `play`, `stop` | `playing`: `position`, `baseTime`; `refused`: the failed `phase` and reason; `stopped`: the reason; `aborted`: the context closed or the runtime stopped elsewhere |
| transport | `admit` | `admitted`; `refused` (`edit-refused`); `not-applied`: `playing: false`, so the edit commits and PLAY applies it |
| transport | `sync` | `applied`; `refused` (`sync-refused`) |

A `param` step is what the node's adapter reports it did (the optional report argument `w` of
`applyBase` and `update`, `adapters/nodes.js`):

- **`applyBase`** reports each AudioParam value it wrote after its own clamp or conversion: an
  Oscillator's clamped frequency, a Filter's normalized frequency and node Q, and a log edge's
  cents as `detune`. A write that differs from the node's previous write is a `scheduled` glide
  from `at`.
- **`update`** reports how it acted on each live key: `set`, `glide`, `crossfade` or
  `next-gate`. A key the adapter did not act on is `stored`, with no audio time. A Spectrum's
  scale, for example, is read by the view from the plan.

It is not a read-back of what the AudioParam renders. A PLAY records `apply` with its counts, not every node and route it builds, so a large
Studio does not flush the ring. The timeline's wake-ups (clips, lanes) run outside any operation
and are not traced.

Cost. A dispatch while stopped records three steps (action, admit, commit). A live parameter
edit records six or more, each one small frozen object, and memory is bounded by the cap. The
`compile` step's `planHash` and the adapters' write reports exist only with a real trace. With
`NO_TRACE` (offline render, tests) the runtime neither hashes nor collects anything. A traced
`runtime.apply` hashes before its transaction. That runs at PLAY, on `setOptions` and, while
running, for every edit, when `applied()` (read by every Graph and Inspector render) hashes the
same memoized plan anyway. The traced edit on the 100-node fixture while playing is measured in
`tests/unit/v31-studio-trace.test.mjs` against the one-frame `dispatchParam` budget. The ring's
cap is per step: a slider drag of 60 inputs records about 360 steps and evicts older operations,
and `stats().dropped` counts them.

The Inspector's **Trace** section (`inspector.js` `traceView`, pure) groups the steps by op,
newest first, at most `TRACE_OPS_SHOWN` (12). The node view keeps the ops with a step that
names the node. Each op is a disclosure, and each step is text:
`<owner> <kind>: <outcome> (<code>) · rev <n> · <what>`. An operation's headline is the store's
verdict (else its first refusal, else its last step). A step that failed after a commit is
listed after the headline (`· failed: route-failed`), not in its place. The section is built
from the settled operations (`steps(true)`) and refilled once an operation ends (`onIdle`),
never halfway through one. When the focused operation is no longer listed, focus goes to the
Inspector heading. `?debug=1` shows the counts (`studio trace`), and
the test seam exposes the live trace (`window.OSCILLA.studio.trace`).

The trace is not evidence. It lives in memory, is never persisted, is never exported with a
project or an experiment, and no hash covers it (`studioHash`, `planHash`, `resultHash`).

## Engine hooks to add properly

The adapter uses these engine internals on the instance; each should become a public engine
method (an engine change, out of this issue's scope):

| Used now | Proposed engine API | Why |
| --- | --- | --- |
| `engine.nodes.add/delete`, `engine.sources.add/delete` | `engine.account(owner) → { track, source, release }` and `engine.release(owner)` | external graphs (Studio, capture io) register through a supported hook; `stop()` / `_discardContext()` could then release owners too instead of each client listening for `'context'` |
| `engine.master` | `engine.connectToOutput(node)` / `disconnectFromOutput(node)` | the only legal way into the safety chain, assertable in one place (§240) |
| `engine._soon(ctx)` | `engine.scheduleTime()` | the ADR 0001 lead + render-quantum boundary for any click-free change |
| `engine._f(f)`, `engine._osc(type, f, at)` | `engine.clampFrequency(f)`, `engine.createOscillator(type, f, at, account)` | the Nyquist clamp and the oscillator factory outside a voice |
| `engine._timers` | `engine.timers` | UI-bookkeeping timers injectable in tests |
| `buildLfo` needs a voice record | `buildModulator(ctx, { shape, rate }, account)` in `modulation.js` | an LFO as a standalone control source, reused by voices and Studio |
| none (Random/Steps use `steppedControl` in the adapter) | a looping control-buffer builder in `audio/` | the registry names `noise.js#mulberry32` and `scheduler.js#scheduleSteps`, which only produce values or voice schedules |
| `engine.stopAll()` does not reach Studio | an `'escape'` engine event or a stop hook list | Escape / STOP must also stop the Studio graph (§185); today the UI must call `runtime.stop({ fast: true })` |
| — (the transport's `onClaimOutput` hook) | `engine.on('voice')` arbitration | decided: exclusive (below); a voice event on the engine would let the transport stop itself without the UI relaying it |

## Integration notes

- **Timeline playback** is `src/js/studio/transport.js` (`createStudioTransport`, documented in
  `docs/v31/timeline.md` "Transport integration"). It starts the graph with `runtime.start()`
  and uses the start's crossfade time as the timeline's `baseTime`, applies every model change
  with `runtime.apply` before `scheduler.edit`, and stops the Studio output with
  `runtime.stop()`.
- **Owned parameters** (the decision "Automated parameters belong to their lane", wired):
  `runtime.setOwnedParams([{ node, param }])` names the parameters another owner drives (the
  transport: every automation lane's target, and the `level` of a pattern-played Oscillator);
  `runtime.ownedParams()` lists them and `debugInfo().ownedParams` shows them. The skip is an
  explicit adapter contract (`adapters/nodes.js` header), no AudioParam method is ever
  reassigned:
  - the runtime calls `applyBase(base, false, owned)` and `update(changed, owned)`, where
    `owned` is the Set of the node's owned keys whose `handle.modTarget(key, 'linear').param`
    exists (the AudioParam the owner automates; a key without one has nothing to own, e.g. the
    Q of a low-pass filter);
  - the adapter does not write that AudioParam and writes every other parameter as before (an
    Oscillator's `detune`, which carries log-mapped modulation offsets, stays written while its
    `frequency` is owned; an owned `detune` owns them too). A node's first `applyBase`
    (immediate, the node is still silent) gets no owned keys: it gives the parameter its initial
    value and the lane schedules from there;
  - the Filter's `createFilterStage.update` writes frequency, Q and gain together: with an owned
    key the adapter applies the others itself with the stage's glide (τ 10 ms), clamp
    (`normalizeFilter`) and Q conversion (`nodeQ`), and always hands the stage the full base
    later, so its config catches up. The bypass (`update({ enabled })`) cannot be applied
    without re-gliding all three, so the adapter names `enabled` in `rebuildWhenOwned` and
    `diffPlans(prev, next, { owned })` turns a bypass change on a filter with an owned parameter
    into a `node-replace` (graph crossfade; the transport rebinds the lane on the new biquad);
  - additive: with no owned parameters every adapter writes exactly what it wrote before.
  `tests/unit/v31-studio-parity.test.mjs` asserts that no AudioParam method is reassigned
  during playback with edits on owned nodes.
- `runtime.baseOffset(id, key)` is the constant part the modulation edges add to a parameter's
  base (linear edges: unipolar polarity, `offset`), in the parameter's unit. The lane owns the
  intrinsic value, so the transport adds it to the values it schedules (actual = base +
  Σ edges, `combineAutomationAndModulation`); log-mapped edges stay on `detune`, which the
  runtime keeps writing.
- Pattern clips play into `nodes.get(sequenceId).info.destination` with the handle's accounting
  (`handle.acct`, whose `track` / `source` are `info.accounting`), or, on an Oscillator, into a
  pattern bus routed into the oscillator's AUDIO routes (`runtime.edges`, `fromNode`, `gain`).
  CONTROL edges into a pattern-played oscillator's `level` (`toNode`, `toPort`, `gain`) are
  re-routed by the transport onto that bus gain (docs/v31/timeline.md "Transport integration").
- Offline rendering (`offline.js`) runs the same runtime AND transport on the offline engine
  (`lookAheadS` = the render duration), so a render schedules exactly what live playback does.
  Envelopes are gated through `handle.gate(t, durS)`; the Envelope adapter additionally exposes
  `release(t)` (gate off from the current contour, `envelope.js releaseAt`) and `hold(t)`
  (`holdAt`: drop everything after t), which the transport uses to close a timeline-gated
  envelope at PLAY and to re-render its gates after an edit or a STOP.
- Microphone permission: the Inspector's **Allow microphone** on a Microphone node (code
  `mic-off`, `mic-error` or `mic-ended`) asks the browser through `audio/microphone.js`
  `requestMicrophonePermission` (the request `openMicrophone` makes; the probe's tracks stop at
  once), then calls `runtime.setOptions({ inputPermission: true })`, which re-applies the model
  at the same revision: while playing, degraded microphones become `node-replace`d and open the
  input; while stopped, the status compile uses `runtime.options`, so the node shows ready and
  opens at PLAY. A refusal (`micErrorMessage`: permission denied, no device) keeps the input off
  and is shown in the Inspector as an alert.
- Output exclusivity is the transport's `onClaimOutput` hook (below); `engine.stopAll()` still
  does not reach the Studio graph, so the UI's Escape goes through `transport.escape()`.

## Known limitations

- Resolved: owned parameters no longer shadow AudioParam methods (explicit `owned` argument,
  above); offline rendering no longer differs from live playback (pattern clips on an
  Oscillator, gate events, lanes, owned parameters and constant modulation offsets all render
  through the transport); modulation into a pattern-played oscillator's `level` modulates the
  voices, not the silenced carrier.
- A Filter's stage config (`stage.config`, `getResponse`'s probe) keeps the last base the
  runtime applied through `createFilterStage.update` while an owner drives one of its
  parameters; it catches up at the next stage update. The Studio does not read it.
- A filter bypass change under an owned parameter is a graph crossfade (rebuild, 20 ms linear)
  rather than the stage's own dry/wet crossfade.
- `engine.stopAll()` does not reach the Studio graph (Engine hooks, above).

## Decisions (recorded with `majordomus decision add`, 2026-10-02)

- **Studio output and the Playground voice are exclusive.** Starting one stops the other through
  the normal release path; both pass the same master safety chain. Summing them would make the
  heard topology differ from either view (V3.1 spec §1) and double the level. Wiring:
  `transport.start()` calls the injected `onClaimOutput({ owner: 'studio', position })` before
  anything is built; the UI stops the Playground voice there (`engine.release()` /
  `stopAll()`), and a hook returning `false` refuses PLAY. When the Playground starts a voice,
  the UI calls `transport.stop()`. `audio-engine.js` is unchanged.
- **Automated parameters belong to their lane.** For a parameter with an automation lane the
  runtime does not glide its base value; the lane owns the AudioParam and modulation edges add on
  top (`automation.js` `combineAutomationAndModulation`).
