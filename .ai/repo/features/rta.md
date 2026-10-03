---
schema: feature/v1
id: rta
kind: feature
title: 'Read band levels in octave and third-octave bands'
short_title: 'RTA'
headline: 'Band power in standard octave and third-octave bands, with documented averaging, peak hold and freeze, relative unless calibrated.'
summary: 'Power-integrated octave and one-third-octave bands on the base-10 edges below 0.95 of Nyquist, an averager with instant, fast and slow time constants, peak hold and freeze, and an RTA tab in the Measure workspace.'
status: stable
weight: 340
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md]
adrs: [adr-0017, adr-0018]
claims: [rta-bands, spl-only-with-level-calibration]
use_cases: [run-a-third-octave-rta]
related: [measurement-workbench, calibration-profiles]
tags: [v3, measurement]
---

## What it does

`src/js/measurement/rta.js` lays out the bands, integrates power with fractional edge bins,
flags under-resolved bands and averages frames exponentially in power with constants that do
not depend on the frame rate; levels are on the mean-square scale, so a full-scale sine reads
-3.01 dB in its band. The RTA tab of the Measure workspace draws one-third-octave band power
through `src/js/measurement/views/rta-chart.js`, with peak hold and freeze, in dB relative
unless a valid level calibration applies.

## What it does not do

It claims no IEC 61260-1 filter class and no sound-level-meter conformance; band levels are
experimental, educational measurement estimates. An experiment saved from the Measure
workspace does not store band levels yet (`results.rta` is null), although the schema,
validation and `rtaCsv` support them. The V2 spectrum remains the live feedback view of the
live-analysis feature.
