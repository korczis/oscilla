---
schema: feature/v1
id: transfer-function
kind: feature
title: 'Measure the frequency response of the playback chain'
short_title: 'Transfer function'
headline: 'Planned: play a log sweep, capture it, and see the frequency response of speaker, room and microphone together.'
summary: 'Planned for V3 (milestone M014): a guided log-sweep measurement with noise floor and signal-to-noise checks, raw, calibrated, normalised and smoothed views, reliability masks and a cursor.'
status: draft
weight: 320
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0018, adr-0021, adr-0024]
claims: [transfer-function]
related: [impulse-response, calibration-profiles]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 26 to 36; the response comes from captured PCM through offline DSP
(ADR 0018) by the deconvolution method of ADR 0021, and every stored result names its
algorithm by a versioned ID (ADR 0024).

## What it does not do

Nothing of it is on main.
