---
schema: adr/v1
id: adr-0035
kind: adr
title: The StudioModel compiles into the existing AudioEngine and measurement engine, and edits patch the running graph incrementally in transactions
status: proposed
date: 2026-10-02
tags:
  - studio
  - audio
  - architecture
  - v31
related:
  - rule:project.audio-engine-discipline
  - rule:project.typed-ports
  - claim:studio-registry-reuses-engine
  - claim:studio-compiled-topology
  - claim:studio-click-free-live-edit
  - file:src/js/studio/registry.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/registry.js
    - issue:V402
---

# 35. The StudioModel compiles into the existing AudioEngine and measurement engine, and edits patch the running graph incrementally in transactions

## Context

The screen must never show one topology while Web Audio runs another (specification §1).
OSCILLA already has an engine that owns every node through `track`/`source` accounting,
schedules on the audio clock, releases click-free and leaves zero nodes after stop
(ADR 0001-0005, ADR 0015, rule `project.audio-engine-discipline` v2), plus graph builders
(filter, ADSR, additive, stereo, noise), analyzers, an offline renderer and the V3
measurement engine. Studio must orchestrate these and never become a second audio engine
(§41-§42). Users edit while sound plays (§44-§46, §182); tearing down and rebuilding the
whole graph on every edit clicks, restarts envelopes and loses phase.

## Decision

Proposed:

- A graph compiler turns a validated StudioModel into calls on the existing runtime:
  resolve types through the node registry, walk the topological order (ADR 0033),
  instantiate each node through the builder its registry entry names
  (`compiler`/`reuses` keys such as `audio/filters.js#createFilterStage`), connect ports,
  bind parameters and modulation, register everything with AudioEngine accounting, bind
  analyzers, and return an ephemeral map from Studio node id to runtime handle with
  `dispose()`. No node type owns DSP of its own when an engine builder exists.
- Edits are applied as a diff between the previous and the new model, not a rebuild: a
  parameter change updates one node; an added node is created; an added edge connects; a
  removed edge or node crossfades out, disconnects and disposes. The master path is never
  disconnected abruptly while playing.
- Each runtime change is a transaction: validate the new model, prepare new nodes off the
  live path, commit the model, connect and crossfade, then clean up. If preparation fails,
  the model change is refused and the last valid runtime graph keeps running; the runtime is
  never half-connected.
- Offline rendering compiles the same model into an `OfflineAudioContext` through the same
  builders; live-only nodes (Microphone) report an explicit limitation.

## Alternatives rejected

- A Studio audio engine beside AudioEngine: two engines to keep click-free and leak-free,
  and the V1/V2 engine tests would no longer cover what Studio plays.
- Full rebuild on every edit: audible clicks and restarts while playing, and a burst of
  node creation per slider movement.
- Mutating Web Audio directly from UI handlers and reconciling the model afterwards: the
  model would follow the runtime instead of defining it.

## Consequences

- The compiler and patcher are the only code that maps Studio ids to runtime objects; leak
  tests count engine nodes and independent oscillators after every edit and after stop
  (specification §209, §213).
- New node types arrive by extending engine builders and adding a registry entry; the
  registry already names an existing export for every one of its 25 types, checked by the
  unit tests.
- Confirmation criteria: only the registry side exists (every compiler and reuse key names
  an existing export; defaults equal engine defaults). Not yet built: the compiler (issue
  V414) and the patcher (V415). The decision is confirmed when the browser audio-graph test
  shows the compiled topology equal to the model for the §257 Basic Synth and §258
  Measurement templates, edits during playback show no click above the existing click-check
  threshold, and node counts return to zero after stop. It is revised if an edit class
  cannot be patched without a click, which then gets its own documented rebuild path.

## Resolution notes

Appended; the sections above are left as written on 2026-10-02, and the status stays
`proposed`.

### 2026-10-04: "the model change is refused" is enforced by a commit gate (V431 review #15)

The V431 review (finding #15, A6) showed the store committing first and the runtime failing
afterwards: with an injected `createBiquadFilter` throw while playing, dispatch returned ok,
the store moved to revision 2, the runtime stayed on revision 1 with `lastError: prepare`, and
the node card looked healthy. The decision above stands; the fix makes the code keep it.

- **Refused, not kept.** Dispatch, undo and redo are synchronous and so is `runtime.apply`, so
  the runtime can answer before the store commits. The store asks an injected commit gate
  (`src/js/studio/actions.js` `gate`) before every model change. While playing, the
  workspace's gate is `transport.admit` (`src/js/studio/transport.js`), which applies the new
  model to the running graph first. If the transaction fails (validate or prepare), the
  edit is refused: dispatch returns `{ ok: false, refused: true, phase, reason }`, and the
  model, revision, selection, undo stack and redo stack stay as they were. The runtime keeps
  its last good revision and plan. A refused undo or redo leaves its entry where it was. A
  refused return to a cancelled gesture's start keeps the gesture's edit as one undo entry.
  The workspace announces the reason assertively and shows it in the Studio warning line.
  While stopped, every valid edit commits, and PLAY applies the model. A store with no gate
  (the offline render, tests) keeps the earlier behaviour: the runtime keeps its last good
  graph, and the next apply retries.
- **Order.** The prepare and the runtime's own commit and crossfade happen inside the gate,
  just before the store commits, in the same synchronous task, so nothing can observe the
  runtime ahead of the model. A split prepare/commit API in the runtime was not needed.
- **Status from the runtime.** While the runtime runs, node and edge status come from it
  (`src/js/ui/studio/graph-view.js` `runtimeStatus`, selected by `src/js/ui/studio/workspace.js`
  `studioStatus`): live handle and route status, and `degraded` / `inactive` with the reason
  for anything in the model that the running plan does not hold. While stopped, status comes
  from a compile of the model, as before.
- Proven by `tests/unit/v431-studio-refused-edit.test.mjs`. Each of its four tests fails on
  the code before the fix.

### 2026-10-05: global side effects only at commit; the commit cannot throw (v4.0 closure audit F1, F4)

An independent v4.0 closure audit found two places where the transaction above did not hold.

- **F1, a global side effect in prepare.** The Master Output adapter called
  `engine.setMasterGain` from `create`, so preparing it changed the ONE engine master gain before
  the transaction committed. When prepare then failed, the catch released the prepared nodes but
  not the level; STOP returned early (nothing ran), and the context-closed path did not restore
  it either. Repro: engine level 0.2, Studio Master 0.15, a `createGain` failure after the Master
  was built: PLAY refused, the engine level 0.15 after STOP. MEASURE's stimulus passes
  `engine.master` (`measurement/capture.js`: stimulus → fade → master → limiter → …), so the next
  measurement played at the Studio's level. Its result recorded that gain truthfully
  (`output.masterGain`), but it was not the level the user had set.
  Resolution: "prepare new nodes off the live path" now also means "write no global state". An
  adapter reaches global engine state only through the runtime's `env.global.setMasterLevel`,
  from `engage()` (called for each created node after the commit) and `update` (after the commit
  too). The runtime saves the engine's level at the first write of a running session and gives it
  back on every way out: STOP, a failed PLAY, `masterLevel: 'ignore'`, dispose, and a context
  closed from outside (`runtime.js` "Global side effects").
- **F4, a commit that could throw.** After the maps and the plan were swapped, `computeBases` and
  the parameter loop ran unguarded. A throw there escaped `apply`; the commit gate turned it into
  a refusal, so the store kept the old revision while the runtime held the new plan, and the
  divergence verdict read in-sync by revision: a hidden divergence. Resolution: the commit is
  the point of no return. Every later step is guarded (`<step>-failed`), any other throw after it
  is `commit-failed`, `apply` returns ok with those warnings, and the applied record names the
  revision whose plan the maps hold. The record always describes what is running; what failed
  inside it is a diagnostic.

Proven by `tests/unit/v40-studio-runtime-closure.test.mjs` (F1: refused PLAY, refused live edit
that adds a Master, context closed, `masterLevel: 'ignore'`; F4: a one-shot throw after the plan
swap). Each fails on the code before the change.
