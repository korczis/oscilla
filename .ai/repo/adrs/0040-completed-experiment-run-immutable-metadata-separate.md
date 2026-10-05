---
schema: adr/v1
id: adr-0040
kind: adr
title: A completed experiment run is immutable; metadata is separate
status: proposed
date: 2026-10-04
tags:
  - measurement
  - data-model
  - storage
  - provenance
  - v3
related:
  - file:.ai/repo/adrs/0019-recipe-versus-experiment.md
  - file:.ai/repo/adrs/0022-experiment-persistence.md
  - file:.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md
  - file:.ai/repo/adrs/0024-versioned-algorithm-ids.md
  - file:.ai/repo/adrs/0028-provenance-without-a-fixed-point.md
  - rule:project.no-fake-science
  - file:src/js/experiments/schema.js
  - file:src/js/experiments/store.js
  - file:src/js/experiments/hash.js
  - file:src/js/experiments/migrate.js
  - file:src/js/experiments/validate.js
  - file:src/js/ui/experiments.js
  - test:tests/unit/v3-experiment-immutable.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/experiments/store.js
    - file:src/js/ui/experiments.js
---

# 40. A completed experiment run is immutable; metadata is separate

## Context

ADR 0019 says an experiment is immutable once complete. An audit of the code as of v3.5.0
found that this was a convention only:

- `store.put` overwrote a record by id. Nothing compared the new record with the stored one.
- Rename read the record, changed `name` and called `put`. The same path could rewrite the
  verdict, the runs or the results.
- Duplicate copied the record under a new id, kept its hashes and set `createdAt` to the
  current time. A copy then claimed to be a run made at another time.
- `measurement.runs[]` entries were identified only by their index, and no result hash covered
  them. A run could be dropped or reordered and the record still verified.
- `provenance.build` did not record the build's source digest or, for a deployed build, the
  artifact SHA-256 (ADR 0028). An experiment made from a source build was not tied to its
  exact source.

## Decision

Proposed:

- **Execution facts and metadata.** User metadata is `name` and an optional
  `annotations: { notes }` (`schema.js` `METADATA_KEYS`). No hash covers them. Every other
  field is an execution fact, including `environment.notes` as recorded at measurement time,
  the provenance block and the Studio block.
- **A stored completed run is immutable.** A record whose `provenance.resultHash` is stamped
  is complete. `store.put` of the same id is a no-op when nothing differs. Any other
  difference is refused with `ExperimentStoreError` code `immutable`, and `err.fields` names
  the changed paths (`schema.js` `executionFactChanges`). The IndexedDB store reads, checks and
  writes in one transaction. An unstamped record (still being measured) may be replaced.
- **Metadata has its own operation.** `store.annotate(id, { name, notes })` applies
  `schema.js` `annotateExperiment` and verifies that no execution fact moved before it writes.
  It fails with `missing` for an unknown id and `invalid` for a bad value. The Experiments
  rename uses it.
- **Duplicate is the same run.** `duplicateExperiment(e, { id, name })` keeps every execution
  fact, both hashes and `createdAt`, and records `provenance.duplicateOf`. It never presents a
  copy as a new measurement. Lineage (`repeatOf`, `duplicateOf`) is not hashed, so a duplicate
  verifies under the same result hash.
- **Run identity.** `measurement.runs[i].id` is `run-<i + 1>` (`schema.js` `runId`). It is
  derived from the run's position in the immutable run list, never from a clock, and is first
  among the run's fields. `validate.js` requires it.
- **Result hash version 3.** It covers version 2 (results, quality, calibration, input,
  output) plus the measurement block (startedAt, sampleRate, the runs with their ids, notes)
  and `provenance.build`. New records are stamped with version 3. Versions 1 and 2 stay
  verifiable in their own version, and export re-stamps a sanitized record in its own version.
- **Build provenance.** `normalizeBuild` records `sourceDigest` (null when the runtime has
  none, as in an unbundled dev page) and `artifactSha256` (null unless the page was stamped by
  the deployment). Both are optional in validation, so earlier records still validate.
- **Experiment schema 2.** Run ids are required, so the schema goes from 1 to 2 (ADR 0023).
  `migrate.js` step 1 → 2 assigns run ids and changes nothing else. Hash versions 1 and 2 do
  not cover the measurement block, so a migrated record keeps its stored hash and version, and
  that hash still verifies. A schema-1 export file imports and reports "migrated from schema
  v1". A file from schema 2 opened in an older build is refused as "newer than this OSCILLA
  supports".

## Alternatives rejected

- **Immutability in the UI only.** Any other caller of `put`, such as an import or a future
  feature, could still overwrite evidence.
- **Content-derived run ids.** A hash of each run entry adds no protection, because result
  hash version 3 already covers the runs in order. It would also cost a SHA-256 per run.
- **Timestamp run ids.** They depend on a clock, are not deterministic in tests, and two runs
  can share a millisecond.
- **`environment.notes` as editable metadata.** These notes record the conditions at
  measurement time, and for a TEST CONTEXT capture they carry its label. Later notes go in
  `annotations`.
- **Re-stamping old records with version 3 on migration.** That would replace the hash a
  record was verified with by one computed after the fact.

## Consequences

- Correcting a run's facts means measuring again (a repeat, ADR 0019) or keeping the record as
  it is. Only the name and annotations can change.
- A stored schema-1 record is migrated whenever it is read and is written back as schema 2 by
  `annotate`. Its stored hash and hash version stay as they were.
- Confirmation criteria (`tests/unit/v3-experiment-immutable.test.mjs`, check `experiments` and
  `persistence` in `tests/browser/v3-ui.cjs`):
  - `put` refuses each execution-fact change, both in memory and in IndexedDB.
  - `annotate` changes only the metadata and survives a reload.
  - A duplicate keeps its hashes and records `duplicateOf`.
  - Run ids are deterministic.
  - Version 1 and 2 records and schema-1 files keep verifying.
  - The build digests round-trip.

## Resolution notes

Appended; the sections above are left as written on 2026-10-04, and the status stays
`proposed`.

### 2026-10-05: calibration and notes are recorded as measured, not as they are at Save

An audit found two false-provenance defects in how MEASURE built the record, both before the
store's immutability applies:

- The frequency profile was read when the user pressed Save. A run measured with profile A and
  saved after loading profile B was recorded, hash-verified, as measured with B, while its
  quality mask came from A's coverage; clearing the profile before Save recorded "none" for a
  run A had corrected.
- A level calibration created after an uncalibrated run was recorded as used, so the record
  showed dB SPL for a run measured uncalibrated. `environment.notes` was also read at Save,
  although the decision above calls it the notes at measurement time.

Resolved without a schema or hash version of its own. It was written against experiment
schema 2 and result hash version 3; since ADR 0043 new records are schema 3 with result hash
version 4 (recipe and definition covered), and everything below applies to them unchanged. The
record's definition reference, like its notes and repeat link, is evidence taken when the
measurement starts:

- **The engine reports what it applied.** `result.calibrated.frequency` already names the
  profile by `profileId` (its SHA-256, ADR 0020) and name; `result.calibrated.level.calibration`
  is now a frozen copy of the LevelCalibration the engine applied, or null
  (`src/js/measurement/engine.js` `applyCalibration`).
- **The record is built from that only.** `measure-experiment.js` `appliedCalibration(result)`
  is the record's calibration; `experimentFromResult` no longer takes a profile or a level
  calibration from its caller. A calibration loaded, switched or created after the run changes
  the next measurement, never this record.
- **Notes at the start.** When a measurement starts, MEASURE keeps the notes as they are; when
  it returns, it keeps a frozen companion of the result (`measuredEvidence`: the applied
  calibration and those notes). Save builds `environment.notes` from it. Text edited later is
  user metadata and is saved as `annotations.notes`, which no hash covers. The start is chosen
  over the completion because a measurement can take a minute and the notes describe the set-up
  it ran with, not an edit typed while it ran.
- **Said in the UI.** While a completed result differs from what the workspace now holds, the
  Experiment panel states it: "Calibration changed after this measurement; the saved record
  keeps the calibration it was measured with (...)", and that later notes are saved as an
  annotation. Saving is not refused: the record keeps what was used.
- **Cross-checked on validation, without losing data.** `validate.js`
  `calibrationClaimFindings` compares the calibration a record names with what its results say
  was applied, when its quality assessment judged the calibration (FREQUENCY_CALIBRATION and
  LEVEL_CALIBRATION reasons): a profile named without `algorithms.calibration` or the reverse, a
  calibrated point in `quality.mask.calibrated` with no profile named, a level calibration named
  while `quality.metrics.levelCalibrated` is false or the reverse, or an `offsetDb` other than
  the LEVEL_CALIBRATION reason's value. Each disagreement is a finding with code
  `calibration-claim-contradicted` and a text naming the field, the rule and the evidence.
- **Earlier records stay readable.** Earlier builds saved such records, and a user's stored
  experiments and exported files must keep opening. By default a finding is not fatal:
  `validateExperiment` returns the record with `findings`, the stored record reads back from
  IndexedDB unchanged, its hash verifies as stored, and an exported file imports with a warning
  that names the field and the reason. Nothing is rewritten. The Experiments detail states: "This
  record names a calibration its own results say was not applied (earlier versions of OSCILLA
  could save it after a calibration changed). Its calibrated values are not trustworthy: it is
  shown and compared as uncalibrated." The detail, its summary, the CSV export, Compare and the
  inspection in MEASURE use `withoutContradictedCalibration`, a presentation copy without the
  contradicted claim, so such a record never shows dB SPL and Compare treats it as uncalibrated
  (and says so in its warnings). Export and duplicate keep the record as stored.
- **Strict for new measurements.** `validateExperiment(json, { calibrationClaims: 'strict' })`
  refuses any finding, with the same code and text, and MEASURE's Save (also used by Studio's
  measurement clips) refuses to store a record with a finding: every new measurement the
  application saves passes strict validation. Records it copies or reads keep what they say:
  Duplicate copies a stored record as it is, a contradicted claim and its finding included, and
  an imported file is stored as imported.
- **The stored noise-check snapshot follows the run.** The RTA of a completed measurement's
  noise check is drawn with the level calibration that measurement applied, not with one
  selected afterwards; the live RTA keeps using the current one, since it is measured now.
- **One save record per result.** MEASURE keeps one record per result (`ctx.save`: the
  experiment id and timestamp chosen once, whether it is stored, and the record stored). A
  retry writes the same record, never a second copy (ADR 0043's idempotent save). When a write
  reports an error the store is read back; a record that is there (a lost acknowledgement) is
  the saved run, and the save continues as "Update name and notes", so a metadata edit before
  the retry is annotated rather than refused as `immutable` and reported as "not saved".
- **A run is saved once.** The saved state belongs to the result shown, not to the setup:
  applying a recipe link or loading a recipe no longer clears it, so a stored run cannot be
  saved a second time (before, that stored a second record of the same run, and with an
  idempotent save key it would be refused as `immutable` and reported as "not saved"). Once
  the run is saved the button reads "Update name and notes": it sends through `store.annotate`
  only what differs from the stored record (an annotation added in Experiments is never cleared
  from MEASURE), says "Nothing to update" when nothing does, and stores a record deleted since
  again under its id, creation time and repeat link. Until then the panel says that notes typed
  after the Save are not stored yet, and never that they were saved.
- **The limit.** The check is on presence, not identity: a record stores a profile's id and name
  but not its points, so one saved by an earlier build naming profile B for a run profile A
  corrected has no finding; nothing in the record can tell the two apart.

Proven by `tests/unit/v3-evidence-at-completion.test.mjs` and checks `evidence-at-completion`,
`resave-after-link`, `notes-after-save` and `older-claim` in `tests/browser/v3-ui.cjs`
(chromium, firefox, webkit; file:// and /oscilla/).
