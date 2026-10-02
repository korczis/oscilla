---
schema: feature/v1
id: calibration-profiles
kind: feature
title: 'Correct measurements with calibration profiles'
short_title: 'Calibration'
headline: 'Planned: correct a measurement for a known microphone response, and show sound pressure only when a valid absolute calibration exists.'
summary: 'Planned for V3 (milestone M013): separate frequency-response and absolute-level calibration profiles, imported, exported, hashed for provenance and interpolated in log frequency.'
status: draft
weight: 310
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0017, adr-0020]
claims: [calibration-profiles]
related: [transfer-function, reproducible-experiments]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 17 to 25: the two calibration kinds are separate (ADR 0020),
interpolated in log frequency and never extrapolated, and dB SPL appears only under a valid
absolute-level calibration (ADR 0017).

## What it does not do

Nothing of it is on main; every level OSCILLA shows today is relative.
