---
schema: adr/v1
id: adr-0053
kind: adr
title: Stored names decide the vocabulary; a run is one capture, an experiment is the stored record
status: proposed
date: 2026-10-07
tags:
  - vocabulary
  - experiments
  - compatibility
  - findings
related:
  - file:.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md
  - file:.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md
  - file:.ai/repo/adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md
  - rule:project.no-fake-science
  - rule:project.single-file-deliverable
  - file:docs/GLOSSARY.md
  - file:src/js/experiments/schema.js
  - file:src/js/experiments/hash.js
  - file:src/js/measurement/quality.js
  - file:src/js/experiments/csv.js
  - file:tests/unit/vocabulary.test.mjs
provenance:
  origin: extracted
  derived_from:
    - file:docs/v4/completion-ledger.md
    - file:docs/GLOSSARY.md
---

# 53. Stored names decide the vocabulary; a run is one capture, an experiment is the stored record

## Context

Ledger P2 (2026-10-05) says that "run" means both a repeat and a completed experiment, and that
"project" means both a Studio file and OSCILLA. The glossary added by #120 (2026-10-06) records
a recommendation that was never applied: "run" for one execution and its stored record, "repeat"
for one capture inside a measurement. The UI on main used both meanings, sometimes in the same
file: `experiment-summary.js` said "5 runs" for captures and "(the same run, copied)" for the
record. The same stored record was called "experiment" in the tab, in the save, rename and
delete actions and in the notice titles, and "run" in the About timeline, the compare heading
"Changed between runs", the definition dialog and nine save and annotation messages in
`ui/measure.js`.

The persisted formats are not split. A capture is "run" everywhere it is stored or hashed:

- `measurement.runs[]`, `runs[i].id = 'run-<n>'` (`RUN_ID_PATTERN`), `results.aggregate.runs`,
  `results.runTransfers[].run` and `LIMITS.runs`;
- the CSV line `# run: N (one run of a repeated measurement, not the aggregate)` and the
  header "aggregate of N runs";
- the quality reasons written into every record with unit `runs` ("N runs: repeatability
  undefined", `quality.js`). `hash.js` puts quality in the result hash from version 2 on.

The record is "experiment" everywhere it is stored: kind `oscilla-experiment`, the extension
`.oscilla.json`, the IndexedDB `oscilla-experiments` with store `experiments`, `experimentId`,
and the workspace id `m=experiments`.

The #120 recommendation would therefore need one of two things:

- an experiment schema version, result hash v5 and a migration under ADR 0023. Even then
  existing immutable records (ADR 0040), and the CSVs already exported from them, would keep
  saying "runs" for captures;
- a permanent split between the UI and the schema.

It also collides with an existing meaning of "repeat": to execute a stored experiment again as
a new one ("Repeat (new experiment)", `provenance.repeatOf`). The glossary did not mention
that.

Two open PRs were about to make "run = record" persistent. #149 adds `finding.runs`, evidence
kind `'run'` and the issue codes `missing-run`, `unreadable-run` and `different-run`. #151,
which is stacked on #149, adds the URL key `run=`. Neither has shipped.

The owner's steer applies: fewer new nouns, more working verbs, and a meta-layer that does not
grow for its own sake. The owner approved this direction on 2026-10-07; this record stays
`proposed` until the owner accepts it.

## Decision

The names a format already persists decide the word the user sees.

- **Run**: one capture inside one measurement. Its count is stored as `recipe.repeats`, a
  historical name kept as schema. In the noun sense, "run" never names a stored record.
- **Experiment**: the stored, immutable record of a completed measurement.
- **Measurement**: the guided session in the Measure workspace. Once saved, it becomes an
  experiment.
- **Definition** and **definition version** ("definition vN"): what to measure, versioned and
  append-only. The **recipe** is the configuration part inside a version.
- **Project**: a saved Studio document (`oscilla-studio`). A **patch** is its smaller sibling.
- **OSCILLA**: the app. Product text does not call the app "project".
- **Finding**: the #149 entity. Its statuses are values, not nouns.
- **Connected records**: a heading only (#151). Each entry is named by its relation. Record UI
  does not use the bare noun "connection", which in Studio names a graph edge.
- Verbs: **run** (to execute, as in "Run this definition") and **repeat** (to execute a stored
  experiment again as a new experiment). The pattern "Repeats" in the Playground and synth is a
  separate domain, frozen by the V1 golden.

What follows from this:

1. User-visible strings that use "run" for a stored record become "experiment". Strings where
   "project" means OSCILLA become "OSCILLA".
2. Surfaces in #149 and #151 that have not shipped are renamed before merge, which needs no
   migration:
   - `finding.runs` becomes `finding.experiments`;
   - evidence kind `'run'` becomes `'experiment'`;
   - `missing-run`, `unreadable-run` and `different-run` become `missing-experiment`,
     `unreadable-experiment` and `different-experiment`;
   - the URL key `run=` becomes `exp=`.
3. Nothing persisted changes: kinds, extensions, IndexedDB names and stores, localStorage keys,
   URL keys on main (`m`, `mr`, `st`, `sv`), hashed fields, CSV lines and columns, and stored
   quality text. `configHash` and result hashes v1-v4 stay byte-identical.
4. Historical identifiers keep their names, and the glossary maps them: the ADR files 0040,
   0041, 0043 and 0044, the claim ids `experiment-run-immutable`, `semantic-run-comparison` and
   `run-evidence`, the use case `repeat-a-measurement-five-times`, and the prose in docs/v3,
   docs/v31 and docs/specs.
5. Measure and Studio text is not changed by this decision. The Measure group heading "Repeats"
   above the field "Runs" is tied to `recipe.repeats` and stays until a change that is accepted
   with a visual reference update.

## Alternatives rejected

- **Run = stored record, repeat = capture (#120 as recorded).** This needs a schema version,
  hash v5, a migration, new quality text and a new CSV header. Old records would still say
  "runs" for captures, and it collides with "Repeat (new experiment)". Doing it as a word swap
  only would leave the UI and the stored formats disagreeing permanently.
- **"Run" for the record in the UI only, "experiment" in code.** This keeps two nouns for one
  thing in front of anyone who opens an exported `.oscilla.json` or CSV. That is the defect P2
  names.
- **A new noun (trial, take, capture, session) for one capture.** It adds a noun that the stored
  data would contradict (`runs`, `run-<n>`), against "fewer new nouns".
- **Renaming the stored keys to match.** Compatibility churn under ADR 0023 for no user-visible
  gain, and it changes every existing hash.
- **Leaving #149 and #151 as written and fixing them later.** This makes "run = record"
  persistent in finding files and links. After that, the fix needs a findings schema version 2
  with a migration, and a `run=` alias kept forever.
- **"Trace" or "lineage" for record links.** These are taken by ADR 0042 and ADR 0044.

## Consequences

- Readers of the UI, an exported `.oscilla.json`, the CSV and the stored quality text see one
  meaning of "run". The UI and the files agree.
- On main, 27 uses of "run" for the record change in the page, the UI controllers, the record
  views and `evidence.js`, with four About strings; ten test pins move ("Changed between runs"
  ×5, "This run used" ×2, "No execution change between runs" ×1, "the input this run recorded"
  ×2). The dist grew by 189 bytes raw and shrank by 3 bytes gzip. No schema, hash, IndexedDB
  name or visual reference changes.
- Not yet changed, and still saying "run" for the record in text a user can meet: the import
  and validation messages (`validate.js`, for example "this run used ..." and "the run's recipe
  is not what its definition asks for"), the store refusals (`store.js`, "is a completed run
  and cannot be changed"), `semantic-diff.js` ("a run records the whole Studio graph"), the
  derived-definition wording ("derived from the run's own recipe" in `evidence.js`,
  `compare-view.js` and `experiment-summary.js`), "the run is INVALID" and "the run carries
  version" in `evidence.js`, "the saved run" in `ui/measure-experiment.js`, and the lineage
  step labelled "Run", whose text counts "repeats recorded". Each is pinned by tests and some
  sit in files the open PRs change; they follow in their own change. The vocabulary test does
  not refuse them yet.
- #149 does not merge until its renames land. If it merges first, the fallback is a findings
  schema version 2 with a 1->2 migration and test, plus a `run=` alias that refuses links
  naming both `run=` and `exp=`.
- `tests/unit/vocabulary.test.mjs` pins the frozen literals: kinds, extensions, database and
  store names, `runId(0) === 'run-1'`, LIMITS, CSV `# run:`, quality unit `runs`, and the link
  and storage keys. It also refuses the changed phrases in the user-facing sources, comments
  apart, so P2 cannot come back unnoticed. "Gap between runs", a Measure field between
  captures, is required to stay.
- Code names that use "run" for the record (`runFields`, `runChanges`, `runEvidence`, `runText`)
  are not compatibility surfaces. They are renamed only when that code is next changed for
  another reason.
- ADRs 0040-0044 and three claim ids keep saying "run" for an experiment. The glossary dates and
  fences them. Rewriting historical records would grow the meta-layer for no rent.
- The glossary names things and states no reasons. It links here for the reason.
