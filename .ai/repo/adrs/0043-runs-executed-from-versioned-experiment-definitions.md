---
schema: adr/v1
id: adr-0043
kind: adr
title: Runs are executed from a versioned experiment definition
status: proposed
date: 2026-10-05
tags:
  - measurement
  - experiments
  - data-model
  - provenance
  - v3
related:
  - file:.ai/repo/adrs/0019-recipe-versus-experiment.md
  - file:.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md
  - file:.ai/repo/adrs/0025-data-driven-quality-with-reasons.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md
  - rule:project.no-fake-science
  - file:src/js/experiments/definition.js
  - file:src/js/experiments/schema.js
  - file:src/js/experiments/hash.js
  - file:src/js/experiments/migrate.js
  - file:src/js/experiments/validate.js
  - file:src/js/experiments/store.js
  - file:src/js/experiments/semantic-diff.js
  - file:src/js/ui/experiments.js
  - file:src/js/ui/measure.js
  - test:tests/unit/v3-experiment-definitions.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/experiments/schema.js
    - file:src/js/ui/measure.js
---

# 43. Runs are executed from a versioned experiment definition

## Context

ADR 0019 separates a recipe (what to do) from an experiment (what was done). In the code as
of v3.7.0, the recipe existed only inside each run:

- A run copied the MEASURE setup into its own `recipe`, in the form the engine played (the
  rate it ran at, the level as a peak, f2 lowered to 0.95 × Nyquist). Nothing named the setup
  the user meant to repeat.
- Repeat loaded a run's played recipe back into the setup. Two runs of "the same" measurement
  could only be matched by comparing their recipes field by field, and a setup edited between
  them looked the same as a deliberate change.
- Compare (ADR 0041) listed recipe differences, but could not say whether two runs were meant
  to be the same measurement, or that the measurement itself had been revised between them.
- The result hash (version 3) covered neither the recipe nor any reference to a setup, so a
  file could be edited to claim another setup without the hash failing.

## Decision

Proposed:

- **A definition entity.** `experiments/definition.js` defines what to measure and how:
  `{ kind: 'oscilla-definition', schemaVersion: 1, id, name, notes, createdAt, versions }`.
  Each version is `{ version, hash, createdAt, execution }`. `execution` holds the recipe
  (the values the user asked for, at no particular rate: `setupRecipe` normalizes the MEASURE
  setup with stimulus.js and sets `sampleRate` to null), the conditions the user declares for
  every run (`conditions.notes`) and an acceptance criterion (`acceptance.minimumQuality`).
  The criterion is the lowest quality.js verdict that meets the definition, or none. It
  compares the stored verdict only, and adds no threshold of its own (ADR 0025).
- **Hash over execution fields only.** `definitionHash` is SHA-256 of the canonical JSON of
  `{ v: 1, recipe, conditions, acceptance }`. The name and notes are metadata, as in ADR 0040.
  A rename never makes a new version.
- **Versions are append-only.** An edit of an execution field appends version n + 1 with its
  hash (`reviseDefinition`). An edit that leaves the hash as it is appends nothing. The store
  (`putDefinition`, a `definitions` object store added by database version 3) refuses a
  changed or dropped stored version with `immutable`, and lets only the name and notes change
  in place.
- **A run records its definition version.** Experiment schema 3 adds the required
  `definition: { id, version, hash, derived, execution }`. The run carries the execution it
  ran, so a file is checked on its own: `validate.js` recomputes the hash over it and requires
  the run's recipe to be what it asks for (`recipeMismatches`). For an authored definition
  that means equal fields, except that a frequency may only be lowered to 0.95 × Nyquist of the
  run's rate, exactly as stimulus.js does, and a playable frequency the run records as
  requested must be the definition's. For a derived definition it means equal fields only, and
  `requested` is not checked. Either failure is `corrupt`. The reference is an execution fact (ADR 0040), so `put` refuses to move
  a stored run to another version.
- **Result hash version 4.** It is version 3 plus the recipe and the definition. New runs are
  stamped with it. Versions 1-3 stay verifiable in their own version.
- **Truth at run start.** "Run this definition" loads a version into MEASURE and starts the
  measurement. The run records that version only when the setup it starts with is exactly that
  version's recipe and the recipe that ran is what the version asks for. Otherwise, and for
  any run started without a definition (and every Studio run), the run carries the definition
  derived from its own recipe, and MEASURE says so before and after the run. The reference is
  taken when the measurement starts, so a later edit of the setup never moves the run.
- **Derived definitions.** `derivedRef(recipe)` builds a definition from a run's own recipe as
  played (at no rate). It does not use `recipe.requested`: a recorded request is the run's
  fact, and an earlier file may hold one that no rate explains (no rate, a request below what
  was played, a rate the clamp does not explain). Built from what was played, a derived
  definition is consistent with its run by construction. It is marked `derived: true`, its id
  is `derived-` plus the first 32 hex digits of its hash (equal recipes derive one
  definition), and it is never presented as authored. The stored list shows only authored
  definitions.
- **Migration 2 → 3.** Every earlier run gets its derived definition. Every schema-valid
  schema-2 file that opened before still opens. Its stored hash and hash version are kept, and
  still verify, because versions 1-3 do not cover the definition. A schema-2 document that
  already has a `definition` field is refused, not trusted.
- **Re-run.** Repeat on a saved run loads that run's definition version. An authored one stays
  loaded, and MEASURE shows it with "Stop using this definition". A derived one only fills the
  setup with the recipe the run played, as Repeat did before, so nothing stays loaded to warn
  about later edits. The new run records the same version (same hash) only when it runs
  exactly that recipe. A setup that cannot represent the recipe (for example a fade other than
  stimulus.js's default) or another rate's clamp records a derived definition instead, and the
  save says which happened. Nothing is claimed before the save.
- **Stored names only for stored versions.** A run shows the stored definition's name, counts
  as a run of it, or is compared as "the same definition" only when the stored definition has
  that version with that hash (`storedMatch`). A run that only shares the id, for example an
  imported run of version 7 or of version 1 with other content, is shown by its id with "does
  not match the stored definition", "not stored in this browser" or "its stored definition
  could not be read". Compare then says "the same definition id, not checked".
- **Failure isolation.** `listDefinitions` lists the readable definitions and names the
  unreadable ones. A damaged definition never fails the list of runs, a save, a rename or a
  delete, and a stored change is never reported as failed because the list could not be read
  again afterwards. A save chooses the run's id and timestamp once per measurement result, so a
  retry writes the same record (a no-op when the first write was stored), never a second copy.
- **Compare.** `semantic-diff.js` adds a `definition` domain, first among the execution
  domains. A derived definition compares as "none": two runs without an authored definition
  differ in their recipes, which the recipe domain lists. When the stored definition holds both
  versions, version n → m is stated plainly as "its execution fields were edited between the
  runs". Different ids are "another definition" or "not run from the same definition".
- **UI.** The Experiments workspace gets a Definitions panel next to the saved runs, under a
  real heading, with each definition's name, version count, latest version and last run. One
  dialog creates a definition from the MEASURE setup, renames it and edits it (a changed
  execution field creates a version). A run's detail names its definition version, the
  declared conditions and whether its stored verdict meets the acceptance criterion.

## Alternatives rejected

- **A reference `{ id, hash }` without the execution.** The file could not be checked on its
  own, and a run imported into another browser would point at nothing.
- **An authored definition recipe in the played form.** The rate and the Nyquist clamp are
  facts of the run, not of what was asked for. The same definition run at 44.1 kHz and at
  48 kHz would otherwise be two definitions. (A derived definition is the played form, because
  it is derived from the run and must agree with it.)
- **A derived definition from `requested`.** The first version of this decision did this, and
  the review found that it turned schema-valid earlier files into "corrupt" ones. It also made
  Repeat of a clamped run play a frequency the run never played.
- **Mutable definitions.** Runs would point at a definition whose execution fields had
  changed since, and "the same definition" would mean nothing.
- **No definition for ad hoc runs.** Every consumer would need two code paths, and a schema-2
  file would migrate into a third shape. A derived definition that says it was derived is
  truthful and uniform.
- **Declared input device and calibration in the definition.** They are conditions of a run
  on a given machine, recorded per run (ADR 0019, ADR 0020). A definition is meant to be run
  again elsewhere.

## Consequences

- A schema-3 file is refused by earlier builds as newer than they support (ADR 0023).
- Editing a run's recipe in a file now needs its definition and both hashes rewritten: the
  definition hash, the consistency check and result hash version 4 each catch a partial edit.
  These hashes detect corruption; they are not signatures.
- The bundle grows by about 6 KB gzip.
- Review findings D1-D4 of #116 are covered by `tests/unit/v3-experiment-definitions-ui.test.mjs`
  and the review tests in `tests/unit/v3-experiment-definitions.test.mjs`.
- Confirmation criteria (`tests/unit/v3-experiment-definitions.test.mjs`, check `definitions`
  in `tests/browser/v3-ui.cjs`): metadata excluded from the hash and every execution field in
  it; an edit appends a version and earlier runs keep theirs; result hash version 4 covers the
  binding; a run whose recipe is not its definition's is refused; a clamped run still belongs
  to its definition; migration 2 → 3 with `derived: true` and a byte-identical round trip;
  stored versions append-only and stored runs immutable; compare naming the version change;
  through the UI in three browsers: create, run twice (same version), edit, run (version 2),
  compare, a changed setup recorded as derived, and the panel at 390 px.
