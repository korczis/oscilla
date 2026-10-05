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
  the run's recipe to be what it asks for (`recipeMismatches`: equal fields, and a frequency
  may only be lowered to 0.95 × Nyquist of the run's rate, exactly as stimulus.js does). Either
  failure is `corrupt`. The reference is an execution fact (ADR 0040), so `put` refuses to move
  a stored run to another version.
- **Result hash version 4.** It is version 3 plus the recipe and the definition. New runs are
  stamped with it. Versions 1-3 stay verifiable in their own version.
- **Truth at run start.** "Run this definition" loads a version into MEASURE and starts the
  measurement. The run records that version only when the setup it starts with is exactly that
  version's recipe and the recipe that ran is what the version asks for. Otherwise, and for
  any run started without a definition (and every Studio run), the run carries the definition
  derived from its own recipe, and MEASURE says so before and after the run. The reference is
  taken when the measurement starts, so a later edit of the setup never moves the run.
- **Derived definitions.** `derivedRef(recipe)` builds a definition from a run's own recipe,
  with the frequencies the user asked for (`recipe.requested`) where they are playable. It is
  marked `derived: true`, its id is `derived-` plus the first 32 hex digits of its hash (equal
  recipes derive one definition), and it is never presented as authored. The stored list
  shows only authored definitions.
- **Migration 2 → 3.** Every earlier run gets its derived definition. The stored hash and its
  version are kept, and still verify, because versions 1-3 do not cover the definition. A
  schema-2 document that already has a `definition` field is refused, not trusted.
- **Re-run.** Repeat on a saved run loads that run's definition version, authored or
  derived, so the new run is provably from the same version (same hash).
- **Compare.** `semantic-diff.js` adds a `definition` domain, first among the execution
  domains. A derived definition compares as "none": two runs without an authored definition
  differ in their recipes, which the recipe domain lists. Version n → m of the same id is
  stated plainly as "its execution fields were edited between the runs"; different ids as
  "another definition" or "not run from the same definition".
- **UI.** The Experiments workspace gets a Definitions panel next to the saved runs, under a
  real heading, with each definition's name, version count, latest version and last run. One
  dialog creates a definition from the MEASURE setup, renames it and edits it (a changed
  execution field creates a version). A run's detail names its definition version, the
  declared conditions and whether its stored verdict meets the acceptance criterion.

## Alternatives rejected

- **A reference `{ id, hash }` without the execution.** The file could not be checked on its
  own, and a run imported into another browser would point at nothing.
- **The definition recipe in the played form.** The rate and the Nyquist clamp are facts of
  the run, not of what was asked for. The same definition run at 44.1 kHz and at 48 kHz would
  otherwise be two definitions.
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
- Confirmation criteria (`tests/unit/v3-experiment-definitions.test.mjs`, check `definitions`
  in `tests/browser/v3-ui.cjs`): metadata excluded from the hash and every execution field in
  it; an edit appends a version and earlier runs keep theirs; result hash version 4 covers the
  binding; a run whose recipe is not its definition's is refused; a clamped run still belongs
  to its definition; migration 2 → 3 with `derived: true` and a byte-identical round trip;
  stored versions append-only and stored runs immutable; compare naming the version change;
  through the UI in three browsers: create, run twice (same version), edit, run (version 2),
  compare, a changed setup recorded as derived, and the panel at 390 px.
