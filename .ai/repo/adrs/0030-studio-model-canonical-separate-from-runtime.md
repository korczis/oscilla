---
schema: adr/v1
id: adr-0030
kind: adr
title: One canonical StudioModel of plain serializable data, separate from the runtime graph; every Studio view is a projection of it
status: proposed
date: 2026-10-02
tags:
  - studio
  - data-model
  - v31
related:
  - rule:project.studio-model-is-canonical
  - claim:studio-model-plain-data
  - claim:studio-deterministic-hash
  - claim:studio-schema-version
  - claim:studio-one-store-projections
  - file:src/js/studio/schema.js
  - file:docs/v31/studio-model.md
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/schema.js
    - issue:V402
---

# 30. One canonical StudioModel of plain serializable data, separate from the runtime graph; every Studio view is a projection of it

## Context

V3.1 turns the passive Signal Path into an editable, executable model (specification §1-§2).
The same graph appears in a compact widget, a full workspace, the Inspector, the timeline,
the Signal Path view and experiment provenance (§9). The obvious implementation, a state per
view kept in sync, drifts; a model that holds `AudioNode`s cannot be serialized, hashed,
undone or diffed against the running graph (§10, §43). V2 already separates engine objects
from Alpine state (rule `project.audio-engine-discipline` v2) and V3 already separates
recipes from experiments (ADR 0019) and versions every persisted format on its own
(ADR 0023). The model core exists on `feature/v31-studio` (`src/js/studio/`, issue
V404-V408, 43 passing unit tests).

## Decision

Proposed:

- Exactly one canonical Studio state, the StudioModel (`schema.js`), owned by one store
  (`actions.js`). Compact Studio, full Studio, Inspector, timeline, Signal Path preview and
  experiment serialization are projections; a view keeps only ephemeral presentation of its
  own (hover, drag preview). "Compact" and "full" are two renderings of one model, not two
  models.
- The model is plain, frozen, deterministic data: `{ kind, schemaVersion, graph, timeline,
  transport, view, metadata }`. It never holds AudioContext, AudioNode, AudioParam,
  MediaStream, DOM, canvas, uPlot, p5, worker or worklet references; `assertPlainData`
  enforces this on every normalize. Runtime handles live in an ephemeral map keyed by node
  id that the compiler owns (ADR 0035).
- State has three layers with different obligations: execution (what sounds and measures;
  undoable, dirty, hashed), presentation (positions, names, markers, metadata; undoable,
  dirty, not hashed) and view (pan, zoom, timeline scale and scroll; persisted but not
  undoable; selection is store-only). `studioHash` is SHA-256 over canonical JSON of the
  execution state, versioned by `STUDIO_HASH_VERSION`.
- The Studio schema is a persisted format under ADR 0023: its own integer
  (`STUDIO_SCHEMA_VERSION = 1`), independent of the product version (3.1.x) and of the
  experiment, recipe and preset schemas, read through one import pipeline (parse, scan,
  validate, normalize, migrate) and nowhere else. This is ADR 0023 applied, not a new
  versioning policy.

## Alternatives rejected

- One state per view, synchronized by events (the spec's `compactSequencerState`,
  `fullStudioState`, `signalPathState`): every sync path is a drift bug, and no single object
  can be saved, hashed or undone.
- The runtime graph as the model (read topology back from Web Audio): Web Audio cannot be
  enumerated or serialized, and an invalid edit would already be applied before it could be
  checked.
- The DOM or SVG as the model: couples semantics to rendering and makes the compact view,
  tests and provenance depend on a layout.
- Hashing the whole model: moving a node or renaming it would change the identity of an
  experiment setup that sounds identical.

## Consequences

- Every surface reads the store and writes through `dispatch` (ADR 0031); rule
  `project.studio-model-is-canonical` v1 makes that a blocking invariant.
- Provenance and comparison can use `studioHash` as "the same setup" independent of layout
  (ADR 0038).
- A Studio file from 3.1.0 stays valid in later products until the Studio schema changes;
  a change ships a migration and a test (ADR 0023).
- Confirmation criteria: built and tested now are plain-data rejection, deterministic
  serialization, execution-only hashing and the schema constant
  (`tests/unit/v31-studio-model.test.mjs`). Not yet built: the views. The decision is
  confirmed when the compact/full model test (specification §214, issue V430) shows one
  store driving both views with identical topology after every action, and revised if a
  view proves to need state the model cannot hold.

## Recorded values and open questions

Values this decision relies on, recorded as Majordomus decisions (local state) and repeated
here so they survive outside one checkout: Studio files use `.oscilla-studio.json`
(`STUDIO_FILE_EXTENSION`); ids are `<prefix>-<n>` from `createIdGenerator`, one namespace
across nodes, edges, tracks, clips, lanes, points and markers, matching the experiment
schema `ID_PATTERN`; the hash selection excludes positions, names, markers, metadata, view
and selection; the default timeline view is 100 px/s. Import limits are recorded in ADR 0032.
Open: the file extension of a patch (issue V426), and whether groups and subgraphs belong in
3.1.0 or 3.2 (specification §116-§117), which decides whether schema 1 needs a group record.
