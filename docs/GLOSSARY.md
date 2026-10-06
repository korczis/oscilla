# OSCILLA glossary

The words OSCILLA's code, interface and records use, each with what it names today. Where a
word has two meanings, both are given with the places that use each, and the term to prefer.
The reasons are in the ADRs under `.ai/repo/adrs/`; this page only names things.

## Product

**Studio.** The workspace that edits sound and measurement as a graph of typed nodes with a
timeline and automation (README "The V3.1 Studio"). Its state is one plain, versioned
document, the StudioModel (`src/js/studio/schema.js`, ADR 0030), changed only through the
store's actions (`src/js/studio/actions.js`) and shown by the graph editor, the Inspector, the
timeline and the compact Studio widget on the Playground.

**Project.** Today a saved Studio document: a StudioModel of kind `oscilla-studio`, exported
as a `.oscilla-studio.json` file ("Export project", "Import project or patch") or kept in the
Studio library of this browser. A **patch** is the smaller sibling: nodes, parameters, inner
cables and their automation lanes, of kind `oscilla-patch` (`.oscilla-patch.json`,
`src/js/studio/patches.js`). OSCILLA uses "project" for nothing else in the product. Outside
it, "the project" in the About view and the README means OSCILLA itself, and the Majordomus
"project" (`.ai/repo/project/`) is the plan of milestones and issues.

**Runtime.** The running Web Audio graph compiled from a StudioModel through the existing
engine (`src/js/studio/runtime.js`, ADR 0035). Its truth has three stages (ADR 0039):

- *desired*: the model revision the store holds now, identified by its `studioHash`;
- *planned*: the compiled plan of that model, identified by its `planHash`;
- *applied*: what the runtime last committed, `runtime.applied()` (revision, `studioHash`,
  `planHash`, time), set only when a transaction commits.

`studioDivergence` compares desired with applied and answers `not-applied`, `in-sync`,
`refused` or `behind`; the Studio Inspector shows that verdict.

**Measurement.** One guided session in the Measure workspace: setup check, noise check,
sweep, analysis and review, run by the measurement engine's state machine
(`src/js/measurement/state-machine.js`, ADR 0018), ending COMPLETE, INVALID, ABORTED or
ERROR. A completed measurement is saved as an experiment.

**Recipe.** The reusable configuration of a measurement (stimulus, level, repeats, timing,
analysis) without any result, calibration or input device (ADR 0019,
`src/js/experiments/schema.js` `createRecipe`). A recipe link carries only this.

**Experiment.** The stored record of a completed measurement (`oscilla-experiment`,
`.oscilla.json`): its recipe, output level, input device and constraints, calibration, sample
rate, repeats, quality, algorithm IDs, product version and build, with a configuration hash
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
declared for every run and an optional acceptance criterion, with append-only versions,
each identified by a hash over those execution fields (not the name or notes). A run records
the definition version it was executed from; a run without an authored definition carries
one derived from its own recipe and marked as derived (claim `experiment-definitions`).
Definitions are stored in the `definitions` object store of the experiments database.

**Evidence.** What a stored run's record says about how one of its values was produced and
whether the run can be repeated (ADR 0044, `src/js/experiments/evidence.js`): a *lineage* of
one stored result point (analysis, capture, calibration as applied, run, definition version,
build, Studio graph and its measured path) and a *reproducibility checklist* whose items are
recorded, partial or not recorded. It is derived from stored fields only, never stored itself, and never a score.

**Run** and **repeat.** See "One word, two meanings" below.

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

**Finding.** Not a product entity. OSCILLA has no finding object: a measurement has quality
*reasons* (`src/js/measurement/quality.js`) and the Studio has *diagnostics* (ADR 0039).
"Finding" appears only in the repository's audits and reviews (for example
`docs/v3/audits-v383.md`), for a defect a reviewer reported.

## Repository

**Knowledge.** What the repository knows about itself, outside the code: the claims matrix
`docs/CLAIMS.yaml` (each claim with the file that defines, implements and tests it), the
features and use cases under `.ai/repo/features/` and `.ai/repo/use-cases/`, the rules, the
ADRs, and the curated notes and source declarations under `.ai/repo/knowledge/`.
`majordomus knowledge edges` turns the claims into a graph, and
`tests/unit/knowledge-integrity.test.mjs` checks in CI that what it names exists and runs.

## One word, two meanings: run

"Run" names two different things today.

1. **A repeat inside one measurement.** A measurement can capture the sweep up to ten times;
   each capture is `measurement.runs[i]`, identified by `run-<i + 1>`, and the aggregate of
   all of them is the stored response. Used by:
   - `src/js/experiments/schema.js` (`measurement.runs[i]`, `runId`, `RUN_ID_PATTERN`) and
     `src/js/measurement/aggregate.js` (`runs[r]`);
   - the recipe and engine field `repeats` (`src/js/measurement/engine.js`), which already
     says "repeat";
   - the Measure setup metric "Runs" and the Experiments export "Runs CSV" (`src/index.html`);
   - claim `aggregate-primary-response`, ADR 0040 "Run identity", and the use case
     `repeat-a-measurement-five-times`.
2. **A completed experiment.** One stored execution, compared with another. Used by:
   - ADR 0040's title and decision ("a completed run is immutable", "duplicate is the same
     run") and claim `experiment-run-immutable`;
   - ADR 0041 ("run comparison"), claim `semantic-run-comparison`, the Experiments heading
     "Changed between runs" (`src/index.html`,
     `src/js/measurement/views/compare-view.js`) and the About timeline's Comparison step;
   - ADR 0043 and claim `experiment-definitions` ("a run records the version of the
     experiment definition it was executed from").

Recommended canonical terms: **run** for meaning 2, one execution of an experiment and its
stored record, which is how ADR 0043 uses the word; **repeat** for meaning 1, one capture
inside a measurement, which is what the recipe field `repeats` already calls it. Decision
recorded here, not yet applied: this change renames no interface copy, and the stored field
`measurement.runs` and the id `run-<n>` are schema and would change only with a schema
version (ADR 0023).
