---
schema: feature/v1
id: studio-measurement-routing
kind: feature
title: 'Lay out a measurement as a Studio graph and keep it in experiment provenance'
short_title: 'Measurement routing'
headline: 'Wire stimulus, capture, calibration and analysis visually, run them through the Measure engine, and record the topology with the experiment it produced.'
summary: 'ANALYSIS ports with reference, observed and result roles; measurement clips that hand a recipe derived from the graph to the V3 measurement engine; the Studio schema version, studioHash and execution state recorded in the experiment.'
status: stable
weight: 450
featured: false
rules: [project.typed-ports, project.no-fake-science]
docs: [docs/v31/patches-and-provenance.md, docs/v31/timeline.md, docs/v31/user-guide.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0038, adr-0032]
claims: [studio-measurement-topology, studio-deterministic-hash, studio-experiment-provenance]
use_cases: [studio-define-a-measurement-pipeline, studio-topology-in-experiment-provenance]
related: [studio, studio-signal-graph, studio-timeline]
tags: [v31, studio, measurement]
---

## What it does

The **Measurement Sweep** template draws a transfer measurement as it runs in software: Sweep
to Master Output; the sweep's digital reference and the Microphone through Calibration into
the Transfer Analyzer's REFERENCE and OBSERVED ports, which cannot be swapped; its result into
a Measurement Result (`src/js/studio/nodes/measurement.js`). A microphone can never reach
Master Output. On PLAY, the first measurement clip of a pass hands a recipe derived from the
graph and the clips (`src/js/studio/measurement-run.js`, `provenance.js` `recipeFromStudio`)
to the Measure workspace's MeasurementEngine, which runs its own state machine, capture,
calibration and abort paths (ADR 0038). The saved experiment carries a Studio block: the
Studio schema version, the `studioHash` and the execution state that ran, verified on import
and kept out of `configHash`, so the recipe stays authoritative (ADR 0019).

Proven by `npm test` (`tests/unit/v31-studio-provenance.test.mjs`,
`v31-studio-gaps.test.mjs` with a real MeasurementEngine, `v31-studio-model.test.mjs`) and
`npm run test:studio` (`tests/browser/v31-studio-workflows.cjs` check measure-from-studio on
the TEST CONTEXT loopback in three browsers).

## What it does not do

Studio adds no DSP and no second measurement pipeline, does not carry results in its own
state, and never presents levels as calibrated unless a calibration profile applies
(ADR 0017). Measurement clips are not rendered offline. The browser checks run on a digital
loopback; no automated test proves how a physical speaker, room or microphone behaves.
