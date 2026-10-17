---
schema: moment/v1
id: number-nobody-can-trace-or-repeat
kind: moment
title: 'A measurement number nobody can trace or repeat'
short_title: 'Untraceable result'
hook: 'had a saved response curve and could not say which settings, algorithm, calibration or build produced it'
summary: 'A result is kept without the recipe, algorithm, calibration, definition and build that produced it, so it cannot be repeated, compared or audited.'
status: stable
severity: high
frequency: common
weight: 70
featured: true
audiences: [researchers, audio-hobbyists, students]
areas: [reproducibility]
lifecycle: [operations, review]
tags: [provenance, experiments, algorithm-ids, definitions]
signals:
  - id: screenshot-as-record
    text: 'The only record of a measurement was a screenshot or a number copied by hand.'
  - id: same-measurement-unclear
    text: 'You could not tell whether two runs were meant to be the same measurement or a deliberate change.'
  - id: newer-code-older-result
    text: 'A stored result was re-rendered by a newer version and nobody could say whether it still meant the same thing.'
examples:
  - id: live-analyser-value
    audience: students
    title: 'The value that was on the screen'
    before: 'A polled analyser frame is drawn and gone; the value depends on which frame happened to be visible, and nothing can be recomputed.'
    after: 'Every result comes from captured PCM through deterministic offline DSP, and every stored result names its algorithm by a versioned ID.'
  - id: repeat-a-setup
    audience: researchers
    title: 'Run the same measurement again'
    before: 'Repeat loads one run''s played recipe back into the setup, and two runs of the same measurement can only be matched field by field.'
    after: 'A run records the version of the experiment definition it was executed from, and a definition''s hash covers its recipe, declared conditions and acceptance criterion.'
  - id: what-produced-this-value
    audience: audio-hobbyists
    title: 'Where did this point come from?'
    before: 'An experiment lists provenance rows one field per row, and nothing ties a value on the curve to the chain that produced it or says which links are missing.'
    after: 'The detail traces one stored point through analysis, capture, calibration as applied, run, definition version, build and Studio graph, with a reproducibility checklist of recorded, partial or not recorded.'
claims: [reproducible-experiments, algorithm-ids-on-results, experiment-definitions, run-evidence, experiment-calibration-as-measured, studio-experiment-provenance]
doctrines: [project.no-fake-science]
use_cases: [save-and-reload-an-experiment, export-an-experiment, repeat-a-measurement-five-times, studio-topology-in-experiment-provenance]
related: [saved-run-quietly-rewritten, conclusion-recorded-as-a-result, bad-measurement-looks-like-a-good-one]
aliases: ['irreproducible measurement', 'no provenance', 'which settings', 'experiment record']
---

## The moment

A response curve from last month is the basis of a decision. Somebody asks how it was made:
which sweep, how many runs, which calibration, which version of the analysis. The answer is a
screenshot and a memory.

## Why it happens

Settings and results are easy to keep in one mutable object, and then repeating a measurement
overwrites the evidence ([ADR 0019](../../adrs/0019-recipe-versus-experiment.md)). A live
analyser value is gone the moment it is drawn
([ADR 0018](../../adrs/0018-measurement-from-captured-pcm-offline-dsp.md)). The product
version identifies the code but not which part of the analysis changed
([ADR 0024](../../adrs/0024-versioned-algorithm-ids.md)). And the setup a person meant to
repeat existed only inside each run
([ADR 0043](../../adrs/0043-runs-executed-from-versioned-experiment-definitions.md)).

## What it costs

A result that cannot be defended or repeated, and a comparison between two results that may
be comparing two different analyses.

## What OSCILLA does

Every saved measurement is an experiment that records its recipe, output level, input device
and constraints, calibration as applied, sample rate, runs, quality, algorithm IDs, product
version and build, with a configuration hash and a result hash (claims
`reproducible-experiments`, `experiment-calibration-as-measured`). A run records the
definition version it was executed from (claim `experiment-definitions`). The experiment
detail answers "what produced this value" and "can I repeat this" from stored fields only, as a
checklist and never a score
([ADR 0044](../../adrs/0044-evidence-on-a-run-lineage-and-reproducibility-checklist.md), claim
`run-evidence`).

## How to verify it

`npm test` runs the experiment schema, round-trip, golden-per-algorithm-ID, definition and
evidence unit tests (`tests/unit/v3-*.test.mjs`).

## What it does not do

It does not keep the raw recording: a saved experiment holds derived results, so a value can be
traced but the capture it came from cannot be re-analysed
([ADR 0049](../../adrs/0049-raw-capture-retention.md)). A checklist item reads not recorded
when the browser did not expose it.
