---
schema: feature/v1
id: measurement-comparison
kind: feature
title: 'Compare measurements and aggregate repeats'
short_title: 'Comparison'
headline: 'Put measurements side by side, see how repeatable they are, and get a difference only when the comparison is meaningful.'
summary: 'Repeated runs aggregated with their dispersion and a repeatability figure as the primary stored response, and a comparison of experiments that names every difference in calibration, sample rate, stimulus and algorithm before it shows A minus B.'
status: stable
weight: 360
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md, docs/v3/measurement-guide.md]
adrs: [adr-0019, adr-0022]
claims: [measurement-comparison, aggregate-primary-response]
use_cases: [compare-two-responses, repeat-a-measurement-five-times]
related: [reproducible-experiments, measurement-quality]
tags: [v3, measurement]
---

## What it does

`src/js/measurement/aggregate.js` combines runs on one grid as a power mean with a dB
standard-deviation envelope, or as a median with its 10th to 90th percentile band;
`aggregateResult` is its stored form under `oscilla.aggregate.v1`. With two or more runs the
aggregate is the primary response and the stored transfer is its marked centre.
`src/js/experiments/compare.js` reports the common configuration and every difference,
overlays the responses and gives A minus B over the overlapping valid range of equivalent
experiments only.

## What it does not do

A difference between non-equivalent experiments is refused with the reason, and a single
run against an aggregate is flagged as not equivalent. Curves are never normalised for the
comparison.
