---
schema: adr/v1
id: adr-0038
kind: adr
title: Measurement topology lives inside Studio as orchestration of the V3 measurement engine, and the StudioModel enters experiment provenance
status: proposed
date: 2026-10-02
tags:
  - studio
  - measurement
  - provenance
  - v31
related:
  - rule:project.no-fake-science
  - rule:project.typed-ports
  - claim:studio-measurement-topology
  - claim:studio-deterministic-hash
  - claim:studio-experiment-provenance
  - file:src/js/studio/nodes/measurement.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/nodes/measurement.js
    - issue:V402
---

# 38. Measurement topology lives inside Studio as orchestration of the V3 measurement engine, and the StudioModel enters experiment provenance

## Context

V3.0 measures through one pipeline: stimulus rendered from a canonical specification,
played through the engine, captured as PCM, aligned and analysed offline into a structured
result (ADR 0018), orchestrated by a measurement engine with an explicit state machine, with
a recipe saying what to do and an immutable experiment recording what was done (ADR 0019),
algorithm ids versioned (ADR 0024). V3.1 asks Studio to represent an experiment visually
(LOG SWEEP → OUTPUT; reference → TRANSFER ANALYZER ← observed CALIBRATION ← MICROPHONE),
sequence its phases on the timeline, and preserve the topology as provenance, without
duplicating the measurement engine or creating a competing orchestration schema
(specification §106-§110, §191).

## Decision

Proposed:

- Measurement nodes (Capture, Calibration, Transfer Analyzer, Measurement Result, plus the
  Sweep reference output and the Microphone capture output) are Studio views of the V3
  measurement pipeline. Their compiler adapters call the existing measurement modules
  (`measurement/*.js`, `calibration/*.js`); Studio adds no DSP.
- Measurement routing uses ANALYSIS ports with roles (ADR 0032): the digital stimulus is a
  REFERENCE, a capture is OBSERVED, an analysis output is a RESULT; reference and observed
  cannot be swapped, and a live microphone may feed analyzers but never Master Output.
- Measurement clips on a measurement track (noise check, pre-roll, stimulus, capture, tail,
  analysis) drive the existing measurement state machine; they do not schedule capture
  themselves.
- One orchestration schema: the recipe stays what ADR 0019 says it is. A measurement run
  from Studio derives its recipe from the Studio measurement topology, and the experiment
  records, beside the recipe, the Studio schema version, the `studioHash` (execution state
  only, ADR 0030) and the normalized execution state of the graph and timeline it ran, with
  the algorithm ids of ADR 0024. Studio state never replaces the recipe and never carries
  results.

## Alternatives rejected

- A Studio measurement engine: two pipelines that could disagree about alignment,
  calibration or quality.
- The StudioModel as the recipe: would put editor layout and non-measurement nodes into
  "the same experiment setup" and break recipe hashes for unchanged measurements.
- Provenance that only names a patch id: the patch can change after the run, so the
  experiment would no longer say what ran.

## Consequences

- Experiment schema gains optional Studio fields; that is an experiment schema change with
  its own migration (ADR 0023), not a Studio schema change.
- Level labels stay relative unless calibrated (ADR 0017, rule `project.no-fake-science`);
  a Calibration node does not make an uncalibrated chain look calibrated.
- Confirmation criteria: the model side is built and tested (the §258 measurement topology
  validates, reference and observed cannot be swapped, microphone to Master Output is
  rejected). Not yet built: measurement node adapters and timeline orchestration (issue
  V424) and provenance (V425). Confirmed when the measurement template run from Studio on a
  synthetic system produces the same result and recipe configuration hash as the same
  measurement run from the Measure workspace, and its experiment round-trips with the
  Studio fields intact. Revised if the recipe cannot be derived from the topology without
  loss, in which case the recipe gains an explicit Studio reference instead.

## Open questions

Recorded as a Majordomus question and repeated here: whether AudioWorklet capture loads
from `file://` in Safari (WebKit), which decides whether a Studio Capture node can use the
worklet path of ADR 0026 there or must fall back.

## Resolution notes

Appended; the sections above are left as written on 2026-10-02, and the status stays
`proposed`.

### 2026-10-04: the open question is answered for the WebKit engine, not for Safari

- **AudioWorklet capture from `file://` in WebKit: it loads.** The V3 spike measured a
  worklet from a `data:` URL loading on `file://` in Chromium, Firefox and WebKit 26.6, where
  a `blob:` worklet fails in Chromium and WebKit (`docs/v3/spike-audioworklet-worker.md`,
  "Loading from `file://` and from http"). The capture worklet is loaded from a `data:` URL
  (`src/js/measurement/capture.js:35-46`, `225-232`) and, in the default `auto` mode, falls
  back to ScriptProcessor only when the worklet is missing or fails
  (`src/js/measurement/capture.js:409-421`, ADR 0026). A Studio measurement does not have a
  capture path of its own: PLAY hands the derived recipe to the V3 MeasurementEngine (claim
  `studio-experiment-provenance`), whose `measure-from-studio` check in
  `tests/browser/v31-studio-workflows.cjs` runs in Chromium, Firefox and WebKit from
  `file://` (`npm run test:studio`). So no Studio-specific fallback is needed.
- **Not answered: Apple Safari itself.** The evidence is Playwright's WebKit build, not a
  shipped Safari on macOS or iOS, and the browser checks use the loopback test context, not a
  physical microphone. The question stays open for real Safari with a real input device.
- A `majordomus question` record lives in one checkout's `.ai/local/` state, never committed;
  on 2026-10-04 the primary checkout's log held no such question, so this note is the
  repository's record.

### 2026-10-06: the Studio block names the measured path (ledger D3)

The v4.0 completion ledger (finding D3) showed that the Studio block hashed nodes the
measurement did not use. `studioProvenance` recorded and hashed the whole execution state, so an
Oscillator nobody connected let `recipeFromStudio` succeed, changed `studioHash`, and appeared in
`studioChanges` as an execution change: two identical measurements read as differing in
execution.

Two options were weighed: record and hash only the subgraph the recipe is derived from, or keep
the whole graph and add a hash of the measured path. The second is chosen. This decision says
the experiment records "the normalized execution state of the graph and timeline it ran", and
`studioHash` is also how a run is matched to a Studio document in the library, so dropping the
rest of the graph would lose provenance and change what `studioHash` means. Compare and evidence
need to know what the measurement depended on, and an extra hash beside the graph says exactly
that.

- **The measured path.** `studio.measured = { v: 1, nodes, edges, clips, hash }` names by id
  what `recipeFromStudio` reads: the Sweep wired to a Transfer Analyzer REFERENCE and that edge,
  the Sweep's audio route to the Master Output (its edges and the Master node), the analyzer,
  its observed chain walked back through OBSERVED inputs (Calibration, Microphone and the edges
  between them) and every measurement clip. `hash` is the SHA-256 of those records exactly as
  the execution state stores them, with the Studio schema version (`experiments/hash.js`
  `measuredPathHash`). Nothing else in the graph sounds or is read during the measurement: the
  Studio output is released before the engine plays its own sweep (`measurement-run.js`). The
  Measurement Result node only displays a result and is not on the path. A graph with no Sweep
  reference into a Transfer Analyzer has no measured path, and its block has no `measured`.
- **Versioned.** Experiment schema 4 (ADR 0023) allows `studio.measured` (and, after the
  review below, is written only for a record that has one). `validate.js` checks
  its shape, that every id is in the execution state, and recomputes the hash (a mismatch is
  `corrupt`). `verifyExperimentStudio` checks that the ids are the path of the block's own
  graph. No result hash and no configHash covers the Studio block, so neither changes.
- **Earlier records.** Migration 3 → 4 changes nothing: a schema-3 block keeps its
  `studioHash`, verifies as before, and has no measured path, because none is inferred. It is
  read as recording the whole graph. A schema-3 file that claims `studio.measured` is refused.
- **Compare.** When both runs name their measured path, a Studio change of a node, connection or
  measurement clip on either path (or of the Studio schema version) is an execution change, and
  every other Studio change has class `unmeasured`: recorded, not used by either measurement. The
  view shows those under "Studio graph and timeline (not on the measured path: recorded, not used
  by either measurement)", collapsed and outside the execution count. When a run records the
  whole graph only, its Studio changes stay execution changes, each with a note that whether the
  measurement used it is not recorded. Without the injected Studio comparator, the measured-path
  hash decides.
- **Evidence.** The Studio link of a run's lineage (ADR 0044) names the measured path (nodes,
  connections, measurement clips and hash) beside the whole graph, and says the other nodes were
  recorded, not used. For a block without one it says the record does not say which nodes the
  measurement used.

Review of #139, same day:

- **Ids with a dot.** Studio ids may contain dots (`ID_PATTERN`), and compare cut a change path
  at the first dot, so a change of a Sweep named `sweep.a` read as `unmeasured`. A change path is
  now matched against the known ids as `studio.<list>.<id>` followed by its end or a dot, the
  longest id winning.
- **Written in the lowest schema.** Every record of this build was written as schema 4, so a
  plain MEASURE run would not open in a build that reads schema 3. A record is now written in the
  lowest schema that describes it (`schema.js` `experimentSchemaVersionFor`): 4 only when its
  Studio block has a measured path, else 3. Documents of schema 3 or earlier are read as schema 3,
  a schema-4 document stays 4, the validator accepts 3 and 4 and refuses a schema-3 document that
  claims a measured path. The limit that remains: a Studio run with a measured path is schema 4,
  and a build that reads only schema 3 refuses it as newer than it supports.

Proven by `tests/unit/v4-measurement-truth.test.mjs` (the D3 tests, which failed before the
change), `tests/unit/v4-review-139.test.mjs` (F2, F4), `tests/unit/v31-studio-provenance.test.mjs`
and check `measure-from-studio` in
`tests/browser/v31-studio-workflows.cjs` (a run from a graph with an unconnected Oscillator
records a measured path without it; chromium, firefox and webkit).
