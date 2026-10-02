---
schema: feature/v1
id: calibration-profiles
kind: feature
title: 'Correct measurements with calibration profiles'
short_title: 'Calibration'
headline: 'Correct a measurement for a known microphone response, and show sound pressure only when a valid absolute calibration exists.'
summary: 'Frequency-response profiles imported from CSV, TXT or JSON, identified by a SHA-256 of their points and interpolated in log frequency without extrapolation; a separate absolute level calibration from an explicit external reference is the only path to dB SPL.'
status: stable
weight: 310
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md, docs/v3/measurement-guide.md]
adrs: [adr-0017, adr-0020]
claims: [calibration-profiles, spl-only-with-level-calibration]
use_cases: [calibrate-a-microphone-frequency-response]
related: [transfer-function, reproducible-experiments]
tags: [v3, measurement, calibration]
---

## What it does

`src/js/calibration/parse.js` reads a profile with line-numbered errors and warnings,
`profile.js` normalises it and derives its identity from the points, `interpolate.js`
applies it linearly in dB over log frequency between its first and last point and marks
every other frequency uncovered, and `level.js` turns an explicit reference (for example
94 dB SPL at 1 kHz) and the observed relative level into an offset. The two kinds stay
separate (ADR 0020), and the raw response is always kept beside the CALIBRATED one.

## What it does not do

There is no default calibration and no SPL without one (ADR 0017). A level calibration is
valid only for the microphone, gain, browser settings and position it was taken with, which
OSCILLA cannot check. Profiles and level calibrations live in page memory only; an
experiment records the profile name and identity, not its points.
