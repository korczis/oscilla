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
  - adr:adr-0019
  - adr:adr-0022
  - adr:adr-0023
  - adr:adr-0024
  - adr:adr-0028
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
