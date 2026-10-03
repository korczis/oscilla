---
schema: adr/v1
id: adr-0038
kind: adr
title: Measurement topology lives inside Studio as orchestration of the V3 measurement engine, and the StudioModel enters experiment provenance
status: proposed
date: 2026-10-02
tags:
  - studio
  - measurement
  - provenance
  - v31
related:
  - rule:project.no-fake-science
  - rule:project.typed-ports
  - claim:studio-measurement-topology
  - claim:studio-deterministic-hash
  - claim:studio-experiment-provenance
  - file:src/js/studio/nodes/measurement.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/studio/nodes/measurement.js
    - issue:V402
---

# 38. Measurement topology lives inside Studio as orchestration of the V3 measurement engine, and the StudioModel enters experiment provenance

## Context

V3.0 measures through one pipeline: stimulus rendered from a canonical specification,
played through the engine, captured as PCM, aligned and analysed offline into a structured
result (ADR 0018), orchestrated by a measurement engine with an explicit state machine, with
a recipe saying what to do and an immutable experiment recording what was done (ADR 0019),
algorithm ids versioned (ADR 0024). V3.1 asks Studio to represent an experiment visually
(LOG SWEEP → OUTPUT; reference → TRANSFER ANALYZER ← observed CALIBRATION ← MICROPHONE),
sequence its phases on the timeline, and preserve the topology as provenance, without
duplicating the measurement engine or creating a competing orchestration schema
(specification §106-§110, §191).

## Decision

Proposed:

- Measurement nodes (Capture, Calibration, Transfer Analyzer, Measurement Result, plus the
  Sweep reference output and the Microphone capture output) are Studio views of the V3
  measurement pipeline. Their compiler adapters call the existing measurement modules
  (`measurement/*.js`, `calibration/*.js`); Studio adds no DSP.
- Measurement routing uses ANALYSIS ports with roles (ADR 0032): the digital stimulus is a
  REFERENCE, a capture is OBSERVED, an analysis output is a RESULT; reference and observed
  cannot be swapped, and a live microphone may feed analyzers but never Master Output.
- Measurement clips on a measurement track (noise check, pre-roll, stimulus, capture, tail,
  analysis) drive the existing measurement state machine; they do not schedule capture
  themselves.
- One orchestration schema: the recipe stays what ADR 0019 says it is. A measurement run
  from Studio derives its recipe from the Studio measurement topology, and the experiment
  records, beside the recipe, the Studio schema version, the `studioHash` (execution state
  only, ADR 0030) and the normalized execution state of the graph and timeline it ran, with
  the algorithm ids of ADR 0024. Studio state never replaces the recipe and never carries
  results.

## Alternatives rejected

- A Studio measurement engine: two pipelines that could disagree about alignment,
  calibration or quality.
- The StudioModel as the recipe: would put editor layout and non-measurement nodes into
  "the same experiment setup" and break recipe hashes for unchanged measurements.
- Provenance that only names a patch id: the patch can change after the run, so the
  experiment would no longer say what ran.

## Consequences

- Experiment schema gains optional Studio fields; that is an experiment schema change with
  its own migration (ADR 0023), not a Studio schema change.
- Level labels stay relative unless calibrated (ADR 0017, rule `project.no-fake-science`);
  a Calibration node does not make an uncalibrated chain look calibrated.
- Confirmation criteria: the model side is built and tested (the §258 measurement topology
  validates, reference and observed cannot be swapped, microphone to Master Output is
  rejected). Not yet built: measurement node adapters and timeline orchestration (issue
  V424) and provenance (V425). Confirmed when the measurement template run from Studio on a
  synthetic system produces the same result and recipe configuration hash as the same
  measurement run from the Measure workspace, and its experiment round-trips with the
  Studio fields intact. Revised if the recipe cannot be derived from the topology without
  loss, in which case the recipe gains an explicit Studio reference instead.

## Open questions

Recorded as a Majordomus question and repeated here: whether AudioWorklet capture loads
from `file://` in Safari (WebKit), which decides whether a Studio Capture node can use the
worklet path of ADR 0026 there or must fall back.
