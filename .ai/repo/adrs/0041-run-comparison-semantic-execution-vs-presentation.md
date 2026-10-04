---
schema: adr/v1
id: adr-0041
kind: adr
title: Run comparison is semantic and classifies execution vs presentation changes
status: proposed
date: 2026-10-04
tags:
  - measurement
  - experiments
  - comparison
  - studio
  - v3
related:
  - file:.ai/repo/adrs/0019-recipe-versus-experiment.md
  - file:.ai/repo/adrs/0024-versioned-algorithm-ids.md
  - file:.ai/repo/adrs/0030-studio-model-canonical-separate-from-runtime.md
  - file:.ai/repo/adrs/0039-studio-runtime-truth-plan-identity-applied-record-divergence.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - rule:project.no-fake-science
  - file:src/js/experiments/semantic-diff.js
  - file:src/js/studio/diff.js
  - file:src/js/experiments/compare.js
  - file:src/js/measurement/views/compare-view.js
  - file:src/js/ui/experiments.js
  - test:tests/unit/v3-semantic-compare.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/experiments/compare.js
    - file:src/js/studio/schema.js
---

# 41. Run comparison is semantic and classifies execution vs presentation changes

## Context

Comparing two experiments showed overlaid curves, A − B and a flat list of differing fields
(`compareExperiments` differences, severity `info` or `warn`). The list compared whole objects:
a changed stimulus read as "Stimulus: 20 Hz → 20 kHz log sweep, 2 s vs …", whichever of its
eleven fields moved. It did not cover the quality reasons, the build's source digest or the
Studio graph a run recorded (ADR 0038). Two runs from the same Studio graph laid out
differently already share a `studioHash` (ADR 0030), but nothing said so to the user. The
curves alone cannot say what differs between two runs.

## Decision

Proposed:

- **A domain comparator.** `experiments/semantic-diff.js` `runChanges(a, b)` returns typed
  changes `{ domain, path, kind: added|removed|changed|unchanged, class:
  execution|presentation|metadata, before, after, unit?, label, note? }`. The domains are, in
  display order: recipe (stimulus and analysis key by key, repeats, the requested range),
  algorithms (per role, with a note for a version step of one method from `describeAlgorithm`),
  calibration, conditions (sample rate, input, output, notes recorded at measurement time),
  studio, build (version, commit, source digest, artifact SHA-256), result (quality verdict,
  quality reasons by code, stored response kind) and metadata. Identity and time are not
  compared: two runs always differ there. Values keep full precision; only the view formats.
- **Studio comparator.** `studio/diff.js` `studioChanges(a, b)` compares two execution states
  or two full models: nodes, parameters (label and unit from the node registry's parameter
  schema), connections, tracks, clips, automation lanes, loop and transport are execution
  changes. Positions, names, markers, document metadata and the view are presentation changes
  and are never reported as execution. An experiment records only the execution state, so two
  runs can differ only in execution. The experiment layer does not import the Studio layer:
  the view injects `studioChanges`.
- **One source.** `compareExperiments` keeps its N-way `common`, `differences`, `warnings` and
  equivalence verdict, built from the same field descriptors (`runFields`, the ones with a
  severity). It adds `semantic: [{ index, changes }]`, each other experiment against the first.
  `responseDelta` is unchanged.
- **Baseline.** A run is marked with `annotations.baseline = true` through
  `store.annotate(id, { baseline })`. This is metadata, so no hash covers it and the run stays
  immutable (ADR 0040). It is exported and imported with the file. **At most one baseline per
  store**: marking a run clears the previous mark in the same write. `put` of a marked record
  while another run is the baseline is refused (`conflict`), a duplicate does not copy the mark,
  and an imported file keeps its mark only when no run is the baseline. Compare puts the
  baseline first (A), and one selected run is compared with the baseline.
- **Wording.** The UI lists the changes grouped by domain, under headings, execution first.
  Presentation and metadata groups are collapsed. The headings say "Changed between runs A
  and B" and a note says that a listed change does not show what caused a difference between
  the responses (`project.no-fake-science`).

## Alternatives rejected

- **A baseline per recipe.** Equal recipes are identified by `configHash`, which includes the
  build. A per-recipe mark would split one setup across builds and need a lookup the user cannot
  see. One baseline per store is a rule the user can predict.
- **A project-level baseline reference** (a separate store key). It would need a database
  upgrade, would not travel with an exported file and could point at a deleted run.
- **Diff of the serialized JSON.** It would report paths, not meanings, without units, and a
  layout change in a Studio document would look like any other change.
- **Replacing `differences`.** Existing consumers and tests read its N-way shape and severity,
  which decide equivalence. It stays and shares the descriptors.

## Consequences

- A file with `annotations.baseline` is refused by builds before this one as an unknown field,
  the same as the earlier optional fields (schema version unchanged).
- The compare panel grows by one list. The bundle grows by about 4 KB gzip.
- Confirmation criteria (`tests/unit/v3-semantic-compare.test.mjs`, check `experiments-changes`
  in `tests/browser/v3-ui.cjs`): every domain, no execution change between identical runs, a
  layout-only Studio change classified as presentation only, a parameter change with its unit,
  topology added and removed, an algorithm version change, a calibration change, determinism
  under key order, baseline annotate, persist and export round trip with hashes unchanged, at
  most one baseline, and the compare UI in three browsers.
