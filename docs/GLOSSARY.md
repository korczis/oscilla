# OSCILLA glossary

The words OSCILLA's code, interface and records use, each with what it names. The names a
format already persists decide the word the user sees (ADR 0053). The reasons are in the ADRs
under `.ai/repo/adrs/`; this page only names things.

## Product

**Studio.** The workspace that edits sound and measurement as a graph of typed nodes with a
timeline and automation (README "The V3.1 Studio"). Its state is one plain, versioned
document, the StudioModel (`src/js/studio/schema.js`, ADR 0030), changed only through the
store's actions (`src/js/studio/actions.js`) and shown by the graph editor, the Inspector, the
timeline and the compact Studio widget on the Playground.

**OSCILLA.** The app. Product text does not call it "the project".

**Project.** A saved Studio document: a StudioModel of kind `oscilla-studio`, exported as a
`.oscilla-studio.json` file ("Export project", "Import project or patch") or kept in the
Studio library of this browser. A **patch** is the smaller sibling: nodes, parameters, inner
cables and their automation lanes, of kind `oscilla-patch` (`.oscilla-patch.json`,
`src/js/studio/patches.js`). The Majordomus "project" (the `project.*` rules,
`.ai/repo/project/`) is repository vocabulary, not the product's.

**Runtime.** The running Web Audio graph compiled from a StudioModel through the existing
engine (`src/js/studio/runtime.js`, ADR 0035). Its truth has three stages (ADR 0039):

- *desired*: the model revision the store holds now, identified by its `studioHash`;
- *planned*: the compiled plan of that model, identified by its `planHash`;
- *applied*: what the runtime last committed, `runtime.applied()` (revision, `studioHash`,
  `planHash`, time), set only when a transaction commits.

`studioDivergence` compares desired with applied and answers `not-applied`, `in-sync`,
`refused` or `behind`; the Studio Inspector shows that verdict.

**Measurement.** One guided session in the Measure workspace: setup check, noise check,
sweep, analysis and review, driven by the measurement engine's state machine
(`src/js/measurement/state-machine.js`, ADR 0018), ending COMPLETE, INVALID, ABORTED or
ERROR. Once saved, a completed measurement is an experiment.

**Run.** One capture of the sweep inside one measurement: `measurement.runs[i]`, identified by
`run-<i + 1>` (`src/js/experiments/schema.js` `runId`, `RUN_ID_PATTERN`). A measurement has
one to ten runs, and with two or more the stored response is their aggregate
(`results.aggregate.runs`, claim `aggregate-primary-response`). The number of runs is stored
as `recipe.repeats`, a historical field name. The Measure field "Runs", the export "Runs CSV",
the CSV line `# run: N` and the quality reasons counted in `runs` all mean this. As a noun,
"run" never names a stored record. As a verb it means to execute ("Run this definition").

**Repeat.** The verb: to execute a stored experiment again as a new experiment ("Repeat (new
experiment)", `provenance.repeatOf`). The Playground pattern setting "Repeats" is a separate
domain, frozen with V1.

**Recipe.** The reusable configuration of a measurement (stimulus, level, runs, timing,
analysis) without any result, calibration or input device (ADR 0019,
`src/js/experiments/schema.js` `createRecipe`). A recipe link carries only this.

**Experiment.** The stored record of a completed measurement (`oscilla-experiment`,
`.oscilla.json`): its recipe, output level, input device and constraints, calibration, sample
rate, runs, quality, algorithm IDs, product version and build, with a configuration hash
and a result hash (claim `reproducible-experiments`). Once its result hash is stamped it is
immutable; only its name and notes change (ADR 0040).

**Measured path.** The part of a Studio graph a measurement run from Studio depended on: the
Sweep wired to a Transfer Analyzer reference, the Sweep's route to the Master Output, the
analyzer's observed chain and the measurement clips, exactly what `recipeFromStudio` reads
(`src/js/studio/provenance.js` `measuredPath`, ADR 0038 resolution 2026-10-06). An experiment's
Studio block records it by id with its own hash beside the whole graph's `studioHash`; a block
from experiment schema 3 or earlier records the whole graph only.

**Experiment definition.** What to measure and how, kept apart from any result (ADR 0043,
`src/js/experiments/definition.js`, kind `oscilla-definition`): a recipe, the conditions
declared for every experiment and an optional acceptance criterion. An experiment records the
definition version it was executed from; one without an authored definition carries a version
derived from its own recipe and marked as derived (claim `experiment-definitions`).
Definitions are stored in the `definitions` object store of the experiments database.

**Definition version.** One append-only version of a definition ("definition v2"), identified
by a hash over its execution fields (recipe, conditions, acceptance), not its name or notes.
The recipe is the configuration part inside a version.

**Evidence.** What a stored experiment's record says about how one of its values was produced
and whether it can be repeated (ADR 0044, `src/js/experiments/evidence.js`): a *lineage* of
one stored result point (analysis, capture, calibration as applied, runs, definition version,
build, Studio graph and its measured path) and a *reproducibility checklist* whose items are
recorded, partial or not recorded. It is derived from stored fields only, never stored itself, and never a score.

**Calibration.** Two separate kinds that are never mixed (ADR 0020, `src/js/calibration/`):

- a *level calibration* (`LevelCalibration`, `level.js`): one reading of an external
  acoustic reference that sets an absolute offset, bound to the input it was taken with; it is
  the only thing that lets a level be labelled dB SPL (ADR 0017), and only while that input is
  in use. One without a binding, from an earlier record, is "not bound to an input";
- a *frequency profile* (`FrequencyProfile`, `profile.js`, `interpolate.js`): a microphone
  correction curve, identified by the SHA-256 of its points, applied between its points and
  never extrapolated by default; it changes a response's shape, never its scale.

Both are kept in page memory only; an experiment records which one applied.

**Trace.** The Studio operation trace (`src/js/core/trace.js`, ADR 0042): every Studio
operation, from the intent through the compiled plan to each value the node adapters report
they wrote, under one correlation id. It is bounded (a ring of 256 steps), in memory only,
covered by no hash, and is not evidence of what sounded.

**Finding.** A user's interpretation, linked to the evidence it rests on (ADR 0046,
`src/js/experiments/findings.js`, kind `oscilla-finding`, the `findings` object store of the
experiments database). It is kept apart from measurement truth:

- a *measurement* is what was observed or computed: a stored experiment, immutable (ADR 0040);
- an *observation* is what the user recorded: a finding with status `observation`, not yet
  interpreted;
- a *finding* is an interpretation linked to evidence: status `hypothesis`, `supported`,
  `contradicted` or `inconclusive`, categorical and never a confidence number.

Its evidence is typed references to experiments (an experiment, a comparison of two experiments, or
the stored value of an experiment at a frequency, ADR 0044's lineage point), and it records each
cited experiment's id with its result hash. A finding never changes an experiment; a reference to a
deleted experiment stays and reads "missing". Two other words are not findings: a measurement's
quality *reasons* (`src/js/measurement/quality.js`) and the Studio's *diagnostics* (ADR 0039). Two
older uses remain with their own meaning: the repository's audits and reviews (for example
`docs/v3/audits-v383.md`) call a defect a reviewer reported a finding, and `validate.js` names a
non-fatal check of a record a finding (`calibrationClaimFindings`, `stimulusFindings`).

**Connected records.** What a stored record is connected to (upstream: what it was made from
or rests on) and what depends on it (downstream: what cites it or was made from it), between
records: experiments, definitions, findings and Studio projects (ADR 0048,
`src/js/experiments/connections.js`). Each entry comes from one field a record stores, and
names it; nothing is inferred from names, recipes or times. Its state is a word: *stored here*
only when the identity verifies (the target is stored, it was read and its result hash
recomputed, and it is the record the field names), else *missing*, *does not match*,
*not verifiable* or *unreadable*. A build and a frequency profile are never stored, so their
entries read *running here* / *not running here* and *loaded here* / *not loaded* instead. It
is computed when shown and never stored. An entry has no
noun of its own in the interface: each row is named by its relation ("A repeat of", "Cited
by"). In Studio, "connection" means a graph edge between two ports, so record text never uses
the bare word. Not to be confused with the two words beside it: the *lineage* of evidence (ADR
0044) traces one value within one experiment, and the Studio operation *trace* (ADR 0042)
follows one Studio operation in memory.

## Repository

**Knowledge.** What the repository knows about itself, outside the code: the claims matrix
`docs/CLAIMS.yaml` (each claim with the file that defines, implements and tests it), the
features and use cases under `.ai/repo/features/` and `.ai/repo/use-cases/`, the rules, the
ADRs, and the curated notes and source declarations under `.ai/repo/knowledge/`.
`majordomus knowledge edges` turns the claims into a graph, and
`tests/unit/knowledge-integrity.test.mjs` checks in CI that what it names exists and runs.

## Historical names

Written before ADR 0053, these say "run" for an experiment and keep their names: ADR files
0040, 0041, 0043 and 0044, the claim ids `experiment-run-immutable`, `semantic-run-comparison`
and `run-evidence`, and the prose under `docs/v3`, `docs/v31` and `docs/specs`. The use case
`repeat-a-measurement-five-times` says "repeat" for a run.
