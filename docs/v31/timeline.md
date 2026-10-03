# OSCILLA Studio timeline, transport and automation (V3.1)

Specification: `docs/specs/oscilla-v3.1-studio.md` §81-§105, §180-§185, §211-§212. Plan issues
V416-V420. This document says **how** the pure timeline layer works; the canonical model it
extends is `docs/v31/studio-model.md`, the sequencer concept map is
`docs/v31/sequencer-migration.md`. Tests: `tests/unit/v31-studio-timeline.test.mjs`.

| Module | Role |
| --- | --- |
| `src/js/studio/timeline.js` | Track and clip semantics, clip validation, time modes and tempo conversion, snap, drag / resize / duplicate / nudge results, loop and marker helpers |
| `src/js/studio/timeline-compiler.js` | Transport anchor and loop passes, per-clip compilation through the sequencer compiler, look-ahead scheduler, edit-during-playback rebuild, STOP plan, Escape priority |
| `src/js/studio/automation.js` | Lane value, AudioParam event compilation, the thin `applyAutomation` applier, holds, parameter scales, automation + modulation rule, editor actions |
| `src/js/studio/sequence-import.js` | V2 sequence import and export |
| `src/js/studio/transport.js` | Live playback: applies the scheduler's output to the Studio runtime (see "Transport integration") |

The first four are pure: no DOM, no Web Audio objects, no clock, no timers. The transport and
the runtime own the AudioContext side and apply what they return; `AudioContext.currentTime` is
the only time authority (§94, §181, project rule `audio-engine-discipline`). Tests:
`tests/unit/v31-studio-transport.test.mjs` (fake AudioContext under the real AudioEngine, one
virtual clock), `tests/unit/v31-studio-parity.test.mjs` (offline/live parity, owned parameters,
modulation into a pattern level) and `tests/browser/v31-studio-transport.cjs` (real Web Audio).

## Tracks and clips (§81-§84)

Track kinds exist only where semantics differ (§82):

| Row | Model | Holds |
| --- | --- | --- |
| event track | `timeline.tracks` kind `event` | pattern clips (sequencer blocks) and event clips (gate / trigger) |
| measurement track | `timeline.tracks` kind `measurement` | measurement clips (noise-check, pre-roll, stimulus, capture, tail, analysis) |
| automation lane | `timeline.automation` | one lane per node parameter (points, not clips) |
| markers | `timeline.markers` | annotations and anchors; never executed (§96) |

A clip is `{ id, trackId, kind, start, duration, target, payload, musical? }` (§83) and plays on
its own target or, when that is null, on its track's target. Event clip payload:
`{ action: 'gate' | 'trigger' }` (default gate). Pattern clips on one track may overlap in the
model (an earlier V404 decision the tests depend on); they then play as separate voices and the
editor warns (`clip-overlap`). `patternRuns` groups contiguous pattern clips, which is what a V2
sequence is.

### Clip validation (§87)

`validateClip(model, clip)` returns `{ ok, errors, warnings }`; `clipDurationBounds(clip)` gives
the duration range the resize gesture clamps to.

| Clip | Duration bounds (s) | Other requirements |
| --- | --- | --- |
| any | `MIN_CLIP_S` (0.01) .. timeline end (3600) | track kind accepts the kind; target node accepts the kind |
| pattern | the block type's `BLOCK_SCHEMA` bounds (e.g. sweep 0.02-30, chirp 0.01-5) | payload under the sequencer's block rules (validate.js) |
| event | — | action gate or trigger |
| measurement noise-check | 0.25-10 (`TIMING_LIMITS.noiseCheckS`, `CONTRACT_LIMITS.maxNoiseS`) | target Microphone or Capture |
| measurement pre-roll | 0.05-5 (`TIMING_LIMITS.preRollS`) | — |
| measurement stimulus | 1-30 (log sweep `DURATION_LIMITS`, `maxSweepS`) | target a logarithmic Sweep; shorter than the sweep → warning `stimulus-truncated` |
| measurement capture | 0.05-40 (`maxCaptureS`) | target Microphone or Capture |
| measurement tail | 0.1-10 (`TIMING_LIMITS.postRollS`) | — |
| measurement analysis | any | target Transfer Analyzer |
| measurement, any | — | never tempo-linked (`musical-measurement`) |

The measurement bounds come from the measurement engine's own constants; they are editor-level
checks (the store accepts the V404 measurement fixtures, whose stimulus clip is shorter than its
sweep).

## Time (§89-§91)

- Model times are absolute seconds; the scale (pixels per second, scroll) is view state.
- **Seconds** is the default time mode (`transport.timeMode`); **musical** is a display mode.
- A clip is **absolute** (no `musical` field) or **tempo-linked** (`musical: { startBeats,
  durationBeats }`). Its seconds stay authoritative for playback; validate.js requires them to
  equal the beats at the transport tempo within `MUSICAL_TOLERANCE_S` (1 µs).
- Conversion: `seconds = beats × 60 / tempo`; one beat is one tempo beat; a bar is
  `timeSignature[0]` beats; positions read `bar.beat.thousandths` with bar 1 beat 1 at 0 s.
- A tempo change (`TRANSPORT_SET`) rescales tempo-linked clips from their beats; absolute clips
  stay. Moving or resizing a tempo-linked clip in seconds re-derives its beats (rounded to 1e-9
  beats).
- Musical time never enters a measurement: a measurement clip cannot be tempo-linked (action,
  helper and validator refuse it) and a musical snap falls back to the time grid for it.
- Automation points and markers are always absolute.

## Snap (§92)

`snapTime(t, snap, { transport, markers, loop, clipKind })`, `snap = { mode, gridS,
beatsPerStep, thresholdS }`, default `off`:

| Mode | Result |
| --- | --- |
| off | unchanged |
| time | nearest multiple of `gridS`, cleaned to a nanosecond (0.1 × 3 = 0.3) |
| musical | nearest multiple of `beatsPerStep` beats at the tempo (measurement clips: time grid) |
| markers | nearest marker or active loop bound within `thresholdS` (editor: threshold px / px per second) |

A dragged clip snaps its start; in markers mode whichever edge lands closer to an anchor.
Results are never negative. `snapGridLines` lists the grid for drawing.

## Gestures (§86-§88, §141)

The helpers compute the action to dispatch at gesture end; inside `store.beginGesture()` /
`endGesture()` a drag is one undo entry and `cancelGesture()` (Escape) restores the start.

| Helper | Action | Rules |
| --- | --- | --- |
| `moveClipResult(model, id, { start \| deltaS, trackId?, snap })` | `CLIP_MOVE` | horizontal = time, vertical = a compatible track; clamped to the timeline; overlap is a warning |
| `resizeClipResult(model, id, { edge, time, snap })` | `CLIP_RESIZE` | the moving edge snaps, the duration clamps to `clipDurationBounds` (`clamped`, `reason`), the other edge never moves |
| `duplicateClipPlacement(model, id)` | `DUPLICATE` with `placements` | right after the clip; a pattern clip skips past overlapping pattern clips; new id, same payload |
| `nudgeClipResult(model, id, { direction, trackDelta, snap })` | `CLIP_MOVE` | keyboard: one grid step (musical step at the tempo), next compatible track |

## Loop region and markers (§95-§96)

`normalizeLoopBounds` orders and clamps bounds (an active loop is at least `MIN_LOOP_S` =
0.01 s; validate.js enforces it), `loopEdgeResult` drags a bound or the whole region,
`loopAroundClips` fits the selection. Markers (start, sweep, capture, analysis, end, custom) are
annotations: `addMarkerAction`, `moveMarkerAction` (grid snap only), `adjacentMarker` for
keyboard navigation.

## Compilation and scheduling (§93-§95, §180-§181)

### Reuse

A pattern clip compiles as a one-block V2 sequence through `sequencer/model.js normalizeModel`
and `sequencer/compiler.js buildTimeline` + `planFromTimeline`; the runtime plays it with
`compileSequence(item.sequence, ctx, destination, item.startTime)`. No scheduling maths is
rewritten. One clip is one voice: block boundaries sit at the envelope floor either way, so
contiguous clips sound as the V2 chain did.

### Anchor and passes

Playback starts at audio time `baseTime` (rounded up to a frame) from timeline position
`startPosition`. Pass 0 covers `[startPosition, loopEnd)` when an active loop lies ahead, else
`[startPosition, timelineEnd)`; pass k ≥ 1 covers `[loopStart, loopEnd)`. Pass starts are
`baseFrame + firstPassFrames + (k − 1) × loopFrames`, integers, so no pass drifts; a position
plays at `(passStartFrame + round((position − passStart) × sampleRate)) / sampleRate`.
`positionAt(anchor, ctxTime)` is the playhead (§94).

Loop boundary rules:

- In each pass, clips whose start lies in the pass range play; a clip that begins before the loop
  start is not retriggered in loop passes; clips entirely after the loop end never play while
  looping (playback started after the loop end plays to the end without looping).
- A clip crossing the pass end is truncated there. A sweep or chirp keeps its curve and ends at
  the frequency it reaches at the cut; other blocks lay their steps from the block start already.
  A remnant shorter than its type's minimum is dropped with a warning.
- Automation is anchored at every pass start with the lane value there and ramps to its exact
  value at every cut, so each pass reproduces the authored curve.
- Measurement clips inside the loop region repeat on every pass (warning).

### Items

`compilePass(model, anchor, k)` and `compileTimeline(model, { sampleRate, baseTime,
startPosition, passes })` return items sorted by start: `pattern` items (`sequence`, `events` =
the sequencer plan with absolute `time`, `level`), `event` items (`action` gate / trigger) and
`measurement` items (`action`), each with `key`, `clipId`, `target`, `pass`, `startTime`,
`endTime`, `truncated`, and a snapshot of the clip used by the edit policy; plus automation
entries `{ laneId, target, events }`.

§212 (Tone 0.0-1.0, Sweep 1.0-3.0, Silence 3.0-3.5, Pulse 3.5-4.5, base 10 s, 48 kHz) compiles
to pattern items starting at exactly 10, 11, 13 and 13.5 s and ending at 11, 13, 13.5 and
14.5 s; played through the fake scheduler, the carriers start and stop at those times
(+ `STOP_PAD_S`).

### Clip start

A clip's start is the **envelope start**, not the first audible sample, as for a V2 block: the
frame `baseTime + position` (whole frames, pass grid above) at which its voice's envelope leaves
`GAIN_FLOOR` and its carrier starts. The voice ramps to full level over `EDGE_S` (3 ms) from
there, and its release edge ends on the clip's end frame, so contiguous clips meet at the floor
exactly on the boundary frame ("Tone 0.0-1.0" is the frames [b, b + 1 s), the Sweep's attack
starting on b + 1 s). V2 does the same: `START_OFFSET_S` (20 ms) is the scheduling lead the
sequencer editor adds before it chooses the voice's `t0`, and the block starts at `t0`; the
Studio's lead is in `baseTime` (`hooks.soon()`), never added after it.

The first audible sample depends on what follows the voice, not on the clip:

- PLAY from a stopped runtime starts the graph at `baseTime` too: every route ramps 0 → 1 over
  `STUDIO_XFADE_S` and an ungated Envelope starts its attack. In the Basic Synth (three routes
  plus the Master Output fade, a 10 ms attack) the level rises like t^6: the first non-zero sample
  is 2.75 ms after `baseTime` and −40 dB of the Tone is reached at 6.5 ms (measured identically in
  chromium, firefox and webkit; `tests/browser/v31-studio-transport.cjs` derives that window from
  the constants).
- The engine's limiter (a DynamicsCompressorNode) delays what reaches the destination by its
  look-ahead, 6 ms in all three engines: the analyser sees the boundary at b + 1.006 s.

### Look-ahead

`createTimelineScheduler(model, { sampleRate, baseTime, startPosition })`:

- `advance(now)` returns the items starting in `[scheduledUntil, now + LOOKAHEAD_S)` (the
  sequencer editor's 1 s) and the automation events due in that window. A ramp is due when its
  segment begins (`scheduleAt` = the previous event's time): an AudioParam ramp interpolates from
  the previous event, so it must be scheduled before the audio thread renders that segment; a set
  is due at its own time.
- `nextWakeMs(now)` suggests the next call: half a look-ahead before the scheduled horizon,
  between 50 ms and the engine's `TOP_UP_EVERY_MS`. Timers decide only when to compile; they
  never time audio.
- After a stall, items that would start less than `SCHEDULE_LEAD_S` from now are skipped (the
  grid is kept, as `audio/scheduler.js scheduleCycles` does) and automation is re-anchored at the
  safe horizon with its authored value there.
- The first window of an anchor caps that horizon at `baseTime` while `baseTime` is still ahead
  of the clock. `baseTime` is `hooks.soon()` — already `SCHEDULE_LEAD_S` after the clock reading
  it came from, and the time the runtime starts the graph — but the first `advance(now)` reads
  the clock again; a fresh browser context had moved two render quanta by then (chromium:
  `baseTime` 0.021333 s, first advance at 0.005333 s) and PLAY skipped its first clip as late.
  A stall past `baseTime` itself is handled as any other stall.

## Edit during playback (§182-§183)

`scheduler.edit(nextModel, now)` rebuilds from the **safe horizon** `h = frameCeil(now +
SCHEDULE_LEAD_S)`: nothing closer to now than the engine's scheduling lead is changed. Policy
(`EDIT_POLICY`):

| Situation | Decision | Runtime action |
| --- | --- | --- |
| Parameter change (`NODE_PARAM_SET`) | live | applied now through the click-free parameter path (§80) |
| Item starting at or after `h` | `cancel` + `schedule` | dispose the old voice, play the rebuilt item |
| Item sounding across `h`, unchanged | `keep` | nothing |
| …clip removed or retargeted | `release` at `h` | `voice.stop(h)` / gate off (faded, `STOP_RAMP_S`) |
| …only shortened, new end after `h` | `retime-end` | `voice.stop(newEnd)` / gate off moved (compatible live edit) |
| …event / measurement clip lengthened | `retime-end` | gate off moved later |
| …anything else (payload, start, a longer pattern clip) | `keep-until-end` | the current event stays; the edited clip plays from its next trigger (next loop pass or next play) |
| Clip now covering `h` that never started | `next-trigger` | waits for its next trigger |
| Automation lane changed | hold and continue | `cancelFrom: h`, a ramp in progress re-ended at `h` with its exact value, value pinned, then the new lane's events after `h` (a ramp that began before `h` now starts from the held value) |
| Loop region changed | re-anchor | a new pass grid from `h`; the position at `h` is continuous |

Every decision is recorded (`plan.decisions`, `getState().decisions`) so the behaviour is
inspectable and testable. A tempo change is an ordinary clip change (tempo-linked clips move).

## STOP (§184) and Escape (§185)

`scheduler.stop(now)` (`STOP_POLICY`): `at = stopTime(now)`, `now + STOP_LEAD_S` (at least two
render quanta) rounded up to a render-quantum boundary: the realtime default of the sequencer's
`voice.stop()` and the same lead and boundary as the engine's releases (`hooks.soon()`), so the
voices and the runtime's output fade start on the same quantum, on frames not rendered yet, and
no ramp starts mid-quantum. Sounding items are released (`voice.stop(at)`: the voice's output
gain, a constant 1, is held at `at` and faded to the floor over `STOP_RAMP_S`; its envelope,
frequency and AM schedules are not edited while they sound; its sources stop after a further
`STOP_PAD_S`, and once every source has ended the voice cancels its remaining automation and
disconnects its nodes); scheduled items that have not started are cancelled (disposed, never
heard); every automation lane is held at its exact value at `at`;
future scheduling is cancelled (`advance` returns nothing, `nextWakeMs` returns null); the model
is never touched; the playhead returns to the position playback started from (RETURN goes to 0).
There is no pause (§93): stop and play again.

`resolveEscape({ gesture, popup, selectionMode, audioActive })` returns the first applicable of
`cancel-gesture`, `close-popup`, `cancel-selection-mode`, `stop-audio`.

## Automation (§97-§104)

### Curves (§98)

A point's curve says how the value arrives at it from the previous point (Web Audio's convention):

| Curve | AudioParam call | Legal |
| --- | --- | --- |
| step | `setValueAtTime(v, t)` | always |
| linear | `linearRampToValueAtTime(v, t)` | always |
| exponential | `exponentialRampToValueAtTime(v, t)` | parameter domain strictly positive (definition `min > 0`: frequency, Q, LFO rate) and both values > 0 |

The first point compiles to `setValueAtTime`. Exponential to or from zero, and exponential on a
parameter that can reach zero (gain, level, pan, detune, filter gain in dB), is rejected by
validate.js (so by the store), by `pointProblem` and by the compiler; `applyAutomation` refuses a
non-positive exponential target.

§211 (filter cutoff 0 s 500 Hz, 1 s 2 kHz, 2 s 8 kHz, base 5 s) compiles to exactly:

| Curve | Events |
| --- | --- |
| linear | set(500, 5), linearRamp(2000, 6), linearRamp(8000, 7) |
| step | set(500, 5), set(2000, 6), set(8000, 7) |
| exponential | set(500, 5), expRamp(2000, 6), expRamp(8000, 7) |

### Compiler and applier (§99)

`compileLaneEvents(points, { paramDef, sampleRate, posStart, posEnd, toAudio | baseTime })`
returns `[{ method, value, time, position, pointId, boundary? }]`: an anchor set at `posStart`,
the points inside the segment, and a boundary ramp at a loop cut. Values are clamped to the
parameter range and frequencies to 0.95 × Nyquist of the running context. Before the first point
the lane holds the first value, after the last the last. `applyAutomation(paramLike, events,
{ cancelFrom })` is the one applier; `holdAutomation` / `holdEvents` hold a param exactly (native
`cancelAndHoldAtTime` where present, otherwise the value computed from the schedule with the
in-progress ramp re-ended, as `compileSequence` does).

### Scales (§101)

`automationScale(paramDef, { sampleRate })` gives `{ kind, unit, min, max, toNormalized,
fromNormalized, format, ticks }` per parameter — no shared 0-1 chart:

| Kind | Parameters | Mapping |
| --- | --- | --- |
| log | frequency (display 20 Hz-20 kHz, capped at the running safe maximum), Q (0.1-30), LFO rate | logarithmic |
| db | linear amplitude (Gain gain, levels) | 20·log10, −60 dB at the bottom, 0 = −∞ |
| linear | dB-valued parameters (filter gain), detune, others | linear in the parameter's unit |
| bipolar | pan −1..1 | linear, centre in the middle, "L 50 %" / "C" / "R 50 %" |

### Editor actions (§100, §102)

`pointAtLaneCoordinates` maps a double-click or tap to `{ time, value }`; `editPointAction`
(drag, curve change; value clamped, illegal exponential refused) and `nudgePointAction`
(keyboard: 1 % of the scale per step, ×10 with large, 10 ms time steps) produce
`AUTOMATION_POINT_MOVE`; `automateParameter` (Inspector AUTOMATE) reveals the lane or creates it
with one point at the parameter's current value; `curveOptions` lists the legal curves.

### Automation and modulation (§103-§104)

Automation authors the **base** value over time; modulation is continuous control from another
node, owned by the modulation edge (`depth`, `polarity`, `mapping`, `offset`) and never simulated
by rewriting automation. The rule (`combineAutomationAndModulation`):

```
actual = clamp((base + Σ linear contributions) × 2^(Σ log contributions))
contribution = offset + depth × m'      m' = m (bipolar) | (m + 1) / 2 (unipolar), m ∈ [−1, 1]
```

Linear-mapped edges add in the parameter's unit, log-mapped edges add octaves; muted edges add
nothing; the clamp is the parameter range (frequencies also 0.95 × Nyquist). Example: base
1000 Hz, LFO depth 1200 Hz bipolar at m = 0.5 → 1600 Hz. `modulationRange` gives the band the
editor can draw around the automation curve. The graph runtime realises the rule with AudioParam
summing: the base value is automated on the parameter and the modulator reaches the same
parameter through its depth gain.

## Transport integration (§93-§95, §180-§185)

`createStudioTransport({ runtime, engine, store, onClaimOutput, onMeasurement })` plays the
store's model, graph and timeline, on the ONE AudioEngine. It is the only module here that
touches Web Audio objects, and it does so only through the runtime's handles.

| Call | Effect |
| --- | --- |
| `start({ position })` | `onClaimOutput({ owner: 'studio', position })` (false refuses), `runtime.setOwnedParams`, `runtime.apply`, `runtime.start()`; the start's crossfade time is the anchor's `baseTime`, so a clip at position p sounds at `baseTime + p` on whole frames; then the first scheduler window |
| `stop({ fast })` | `scheduler.stop(now)` applied (sounding voices `voice.stop(at)`, pending ones disposed unheard, every lane held at its exact value, gate-owned envelopes released), owned parameters released, `runtime.stop({ fast })`; resolves with the counts once released (0 nodes, 0 sources); the model is never touched; the playhead returns to the play start |
| `returnToStart()` / `locate(p)` | the return point becomes p; while playing, the current schedule is stopped as above (without stopping the graph) and a new anchor starts at `hooks.soon()` from p |
| `setLoop({ enabled, start, end })` | `LOOP_SET` through the store, then `sync()` (the scheduler re-anchors, `EDIT_POLICY.loopChange`) |
| `sync()` | the store's model now: owned parameters, `runtime.apply`, ownership and node rebinds, `scheduler.edit(model, now)` applied. The UI's store `onChange` calls it; every wake-up also compares the store revision |
| `escape({ gesture, popup, selectionMode })` | `resolveEscape` with `audioActive` = playing or the runtime running; `stop-audio` stops fast (8 ms, `STUDIO_FAST_STOP_S`) |
| `playhead()` | `positionAt(anchor, ctx.currentTime)` while playing, else the return point |
| `debugInfo()` | playing, anchor, voices, gates, lanes, claims, gated envelopes, owned parameters, `unplayed` (id + reason), late skips, decisions, warnings |

Timing. There is one timer, the bookkeeping wake-up: it is armed with `scheduler.nextWakeMs`
(half a look-ahead before the scheduled horizon, at most `TOP_UP_EVERY_MS`), calls
`advance(ctx.currentTime)` and applies what it returns. It decides when to compile, never when a
sound happens; every time comes from the scheduler. After the last window of a non-looping
timeline the wake-up waits until the end (+ `STOP_PAD_S`) and stops the transport ('ended').

What plays where:

| Timeline content | Played as |
| --- | --- |
| pattern clip on a Sequence | `compileSequence(item.sequence, ctx, handle.info.destination, item.startTime, { track, source, timers })` with the node's accounting; a finished voice untracks its nodes at once (`onEnded`), so a long loop never accumulates. The Sequence's TRIGGER edges into an Envelope `gate` gate that envelope for the clip |
| pattern clip on an Oscillator | the oscillator is **pattern-played**: its free-running carrier is held at `ROUTE_FLOOR` (its `level` AudioParam is owned by the transport; built in this transaction → set at once, already sounding → 20 ms ramp) and the voices (the oscillator's waveform, `clipSequence`) play into a pattern bus (gain = the oscillator's level + `runtime.baseOffset(id, 'level')`, the base the runtime would give the carrier) connected to every AUDIO route leaving the oscillator. They pass its routes, crossfades included, and everything downstream (OSC → ADSR → FILTER → MASTER in the Basic Synth). A level change glides the bus; a lane on the oscillator's level drives the bus (offsets added). **Modulation into its `level`** reaches the voices: every active CONTROL edge into `level` is re-routed from the carrier's level AudioParam onto the pattern bus gain — the edge's depth gain feeds a path gain into the bus (1) and one into the carrier's level (0). Claiming an oscillator that already sounds ramps the carrier path 1 → 0 together with the carrier's own 20 ms fade, releasing it ramps it 0 → 1 with the carrier's fade-in (click-free both ways); edges built during playback are silent when they are re-routed. Depth, polarity and offset edits keep acting on the edge (its gain, the bus base) |
| gate event clip on an Envelope | `handle.gate(startTime, duration)`; an envelope the timeline gates is closed at PLAY (`release`) and opened again when no gate clip targets it any more |
| automation lane | `applyAutomation(handle.modTarget(param, 'linear').param, events)`; the parameter is owned (`runtime.setOwnedParams`), so the runtime's base glide and live updates skip it (the adapters' explicit `owned` argument, `docs/v31/compiler.md` "Owned parameters"); `runtime.baseOffset` (linear modulation offsets) is added to the scheduled values (none in the templates: exact events) |
| measurement clip | data only: `onMeasurement({ type: 'schedule', key, clipId, action, target, trackId, pass, position, startTime, endTime, duration, truncated })`, then `cancel` / `release` / `retime` / `stop` events; the V3 measurement engine integration is a later UI step |
| anything else | not played; listed in `debugInfo().unplayed` with its reason (`TRANSPORT_TEXT`): an event clip on a source, a `trigger` event clip, a target that is not ready |

Edits during playback apply `scheduler.edit`'s plan as `EDIT_POLICY` says: `cancel` disposes the
not-yet-started voice, `schedule` plays the rebuilt item, `release` / `retime-end` call
`voice.stop(at)`, lanes are held at the horizon and continue (`applyAutomation` with
`cancelFrom`); a removed lane is held, then glides back to the parameter's base. Graph edits go
through `runtime.apply` first; then:

- a node rebuilt by the runtime (`node-replace`): its lane continues on the new AudioParam from
  the horizon with the exact value there (`rebind`); a pattern-played oscillator is claimed
  again (built silent, so at once); voices sounding into the old node fade with the runtime's
  crossfade (recorded as `release`, reason `node-replaced`) and the future ones are rebuilt on
  the new node by the edit (future items are always rescheduled), with its new waveform;
- an envelope whose gates changed is re-rendered from the horizon: held (or released when no
  gate is sounding), the sounding gate's release, every later gate again. A gate interrupted in
  its attack by such an edit is held at its value at the horizon (a flattened attack, no step);
- a filter bypass (`enabled`) change while one of its parameters is owned rebuilds the filter
  (`rebuildWhenOwned`: `createFilterStage.update` would re-glide the owned cutoff); the bypass
  is then the runtime's 20 ms route crossfade instead of the stage's internal one, and the lane
  continues on the new biquad from the horizon (`rebind`).

**Offline rendering is this transport.** `renderStudioOffline` (`offline.js`) builds the
runtime on the offline engine, creates the transport with a fixed store and `lookAheadS` = the
render duration, and calls `start()`: the one start schedules every item and automation event
that begins inside the render, with the same anchor (the runtime's start time) and the same
routing as live playback — pattern-played oscillators, gates, owned lanes, constant modulation
offsets, modulation into a pattern level. `planOfflineRender` classifies clips with the
transport's `clipPlayReason`, so the plan lists exactly what the transport would not play (the
Basic Synth / Subtractive Synth lists nothing). `tests/unit/v31-studio-parity.test.mjs` compares
the complete scheduled Web Audio trace of the Subtractive Synth, live and offline, at exact
times.

Known limitations: `baseOffset` is read when events are scheduled, so a changed edge offset
reaches the lane within one look-ahead (1 s); a lane on an Oscillator's `detune` owns the
oscillator's `detune` AudioParam, which also carries the log-mapped frequency modulation's
constant cents (the runtime does not rewrite it while the lane plays); an offline render of a
looping timeline compiles at most `MAX_PASSES_PER_WINDOW` (4096) loop passes.

## Model and action additions

Additive to V404 (`schema.js`, `validate.js`, `actions.js`); a model without tempo-linked clips
serializes and hashes exactly as before.

| Addition | Where |
| --- | --- |
| optional clip field `musical: { startBeats, durationBeats }`, `CLIP_TIME_BASES`, `MUSICAL_TOLERANCE_S` | schema.js, import structure check |
| `musical-measurement`, `invalid-musical`; exponential only on strictly positive domains; active loop ≥ `MIN_CLIP_S` | validate.js |
| `CLIP_ADD` with `timeBase: 'tempo'` or `startBeats` / `durationBeats` | actions.js |
| `CLIP_MOVE`, `CLIP_RESIZE` keep tempo-linked clips linked | actions.js |
| `TRANSPORT_SET` tempo change rescales tempo-linked clips ("Change tempo") | actions.js |
| `DUPLICATE` `placements: { [clipId]: { start, trackId? } }`; copies keep their link | actions.js |
| `CLIP_UPDATE { clipId, payload?, target? }`, `CLIP_SET_TIME_BASE { clipId, timeBase }`, `MARKER_MOVE { markerId, time?, kind?, label? }` | actions.js |

All are undoable through the existing snapshot history (§208 semantics: undo restores the exact
earlier model).

## Decision candidates

`SAFE_HORIZON_S` (= `SCHEDULE_LEAD_S`, 20 ms), `TIMELINE_LOOKAHEAD_S` (= `LOOKAHEAD_S`, 1 s),
one voice per pattern clip, the loop boundary rules above, `EDIT_POLICY`, `STOP_POLICY` (playhead
returns to the play start), `CONTIGUITY_TOLERANCE_S` (1 µs), `MUSICAL_TOLERANCE_S` (1 µs),
`MIN_LOOP_S` (10 ms), `DB_SCALE_FLOOR` (−60 dB), the measurement clip bounds, and that pattern
clips may overlap (separate voices).
