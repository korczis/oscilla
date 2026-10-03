---
schema: feature/v1
id: measurement-quality
kind: feature
title: 'Rate the quality of every measurement, with reasons'
short_title: 'Measurement quality'
headline: 'Every measurement says whether it can be trusted, and why.'
summary: 'A rule-based GOOD, USABLE, POOR or INVALID status from named metrics (signal-to-noise, clipping, dropouts, discontinuities, coverage, repeatability, calibration), with its reasons, reliability and calibration masks, and a live quality bar during the run.'
status: stable
weight: 370
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md, docs/v3/measurement-guide.md]
adrs: [adr-0025]
claims: [measurement-quality]
use_cases: [measure-a-playback-capture-chain-response, repeat-a-measurement-five-times]
related: [measurement-comparison, measurement-workbench]
tags: [v3, measurement]
---

## What it does

`src/js/measurement/quality.js` computes the status from data under the versioned rule set
`oscilla.confidence.v2` (v1 retained), each reason with its code, severity, value and unit,
together with frequency masks of reliable and calibrated bins (ADR 0025).
`src/js/measurement/capture-checks.js` detects clipping, dropouts and discontinuities. The
response chart draws unreliable stretches dashed and faded, and the quality panel shows
text, a glyph and a shape, never colour alone.

## What it does not do

GOOD means the digital data passes the rules; it does not certify the physical setup. A
check that was not made reads NOT MEASURED, which caps the status.
