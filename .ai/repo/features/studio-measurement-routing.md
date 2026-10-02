---
schema: feature/v1
id: studio-measurement-routing
kind: feature
title: 'Lay out a measurement as a Studio graph and keep it in experiment provenance'
short_title: 'Measurement routing'
headline: 'Planned: wire stimulus, capture, calibration and analysis visually and record the topology with the experiment it produced.'
summary: 'ANALYSIS ports with reference, observed and result roles; measurement nodes and clips that orchestrate the V3 measurement engine; the Studio schema version, studioHash and topology recorded in the experiment.'
status: draft
weight: 450
featured: false
rules: [project.typed-ports, project.no-fake-science]
docs: [docs/v31/studio-model.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0038, adr-0032]
claims: [studio-measurement-topology, studio-deterministic-hash, studio-experiment-provenance]
use_cases: [studio-define-a-measurement-pipeline, studio-topology-in-experiment-provenance]
related: [studio, studio-signal-graph, studio-timeline]
tags: [planned, v31, studio, measurement]
---

## What it does

Studio represents a measurement as it runs in software: Sweep to Output; the sweep reference
and the calibrated microphone capture into the Transfer Analyzer; its result into a
Measurement Result (specification §106-§110, §191, §258). Measurement nodes and clips
orchestrate the existing V3 measurement pipeline (ADR 0018, ADR 0019, ADR 0038) and add no
DSP; the experiment records the Studio schema version, the `studioHash` and the topology it
ran.

Guaranteed now, by `tests/unit/v31-studio-model.test.mjs`: the typed measurement topology
and the execution-only hash.

## What it does not do

Measurement node adapters, measurement timeline orchestration (issue V424) and provenance
(V425) are not built; claim `studio-experiment-provenance` is `planned`. Studio does not
replace the recipe, does not carry results in its own state, and never presents levels as
calibrated unless a calibration profile applies (ADR 0017).
