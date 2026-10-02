# OSCILLA Studio graph compiler and runtime (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §41-§46, §80, §170-§171, §177-§179,
§186-§190, §209-§210, §213, §240-§242. Plan issues V414 (graph compiler) and V415 (incremental
runtime patching). ADR 0035 says why; this document says how. Code:

| File | Role |
| --- | --- |
| `src/js/studio/compiler.js` | `compileStudio` (model → plan), `diffPlans`, `instantiateNode`, `createEdgeHandle`, `computeBases`, `disposeHandle` |
| `src/js/studio/runtime.js` | `createStudioRuntime`: id → handle map, transactional `apply`, `start` / `stop` / `dispose`, `debugInfo` |
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
  smoothed), so the logical master gain is still one value. `options.masterLevel: 'ignore'`
  leaves the engine gain alone.

### Adapters per node type

| Type | Registry `compiler` | Built with |
| --- | --- | --- |
| Oscillator | `audio/audio-engine.js#AudioEngine` | `engine._osc` (frequency clamp, start) + level GainNode |
| Noise | `audio/noise.js#createNoiseSource` | `createNoiseSource` (its start/stop fades, colour crossfade) |
| Sweep | `audio/patterns.js#buildPlan` | log, 1-30 s, start < end: `renderStimulus` buffer (the exact digital reference); otherwise the engine `ramps` topology (`engine._osc`, frequency ramp, linear fades) and no reference, with a reason |
| Sequence | `sequencer/compiler.js#compileSequence` | a level bus exposed as `info.destination` + `info.accounting` for the timeline's `compileSequence` voices |
| Microphone | `audio/microphone.js#openMicrophone` | `openMicrophone` → output gain (analysis only); degraded without getUserMedia or permission |
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
  are listed in `debugInfo().limitedEdges`. Other parameters are not clamped at audio rate
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
of an analyzer, `info.reference` of a sweep, `info.destination` of a Sequence, `gate(t, durS)`
of an Envelope). `runtime.edges.get(id)` is the route. The model stays plain data; handles are
never stored in it or in Alpine state.

## Diffing (§44)

`diffPlans(prev, next)` produces the minimal patch, in a deterministic order:

| Model change | Operation | Runtime effect |
| --- | --- | --- |
| parameter value | `node-params` | modulatable keys: base re-computed and glided (`setTargetAtTime`, τ 15 ms, as `engine.updateLive`); other keys: the builder's own `update` (filter bypass crossfade, noise colour crossfade, router glide, analyser size, engine master gain) |
| structural key (`waveform`, LFO `shape`, filter `type`, every sweep parameter, Random `seed`/`smooth`, Steps `steps`/`playback`, RTA averaging) or status change | `node-replace` | a new node is built and its edges are `edge-rewire`d: crossfade old → new |
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
3. **commit**: swap the handle and route maps and the plan; `revision` (the store's, or an
   internal counter) now names the topology the runtime reflects (§178).
4. **crossfade** at `t`: new routes ramp 0 → 1 and removed routes 1 → floor over
   `STUDIO_XFADE_S` (20 ms, `filters.js` CROSSFADE_S) in the same window (equal-gain linear
   crossfade; the two paths of a reconnect are usually correlated, where equal-power would bump
   the level); parameter bases glide; retired sources stop 10 ms after the fade. Each step is
   guarded; a failure there becomes a warning, never a half-applied route.
5. **cleanup** `CLEANUP_MARGIN_S` (50 ms) after the fade: retired routes and nodes are
   disconnected, disposed and removed from the engine accounting. The timer is UI bookkeeping
   (`engine._timers`); on a suspended or closed context cleanup runs at once, as the engine does.

While stopped, `apply` only stores the plan (`applied: false`). `start()` is the transaction
from the empty plan; `stop()` fades the Master bus to the floor over `STUDIO_STOP_S` (15 ms,
the engine's fast release; `{ fast: true }`: 8 ms, Escape), stops every source after it,
disposes everything and resolves with the counts once released (§184). PLAY → STOP → PLAY
repeats without growth. `dispose()` stops and detaches from the engine. If the context is
closed from outside, the runtime drops its graph and removes its nodes from the engine sets.

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
engineSourceCount, degraded, inactiveEdges, limitedEdges, exceeds, warnings, lastOps,
lastError }`.

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
| — | `engine.on('voice')` arbitration | an engine voice and a running Studio graph both feed `engine.master`; the product decision (exclusive or summed) belongs to the integration |

## Integration notes

- Automation (automation.js, timeline-compiler.js) authors the base value on the same
  AudioParam that `applyBase` glides; when a lane drives a parameter the runtime should skip
  `applyBase` for that key and let the lane's events own it (`handle.modTarget(key,
  'linear').param` is that AudioParam). Not wired yet.
- The timeline plays pattern clips into `nodes.get(sequenceId).info.destination` with
  `info.accounting`, and gates envelopes through `handle.gate(t, durS)`.
- Microphone permission: `runtime.setOptions({ inputPermission: true })` re-applies the model;
  degraded microphones become `node-replace`d and open the input.
