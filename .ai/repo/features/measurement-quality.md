---
schema: feature/v1
id: measurement-quality
kind: feature
title: 'Rate the quality of every measurement, with reasons'
short_title: 'Measurement quality'
headline: 'Planned: every measurement says whether it can be trusted, and why.'
summary: 'Planned for V3 (milestone M018): a rule-based GOOD, USABLE, POOR or INVALID status from named metrics (clipping, dropouts, noise floor, resolution, repeatability), always with its reasons.'
status: draft
weight: 370
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0025]
claims: [measurement-quality]
related: [measurement-comparison, measurement-workbench]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 64 to 71: the status is computed from data with its reasons, never
asserted (ADR 0025).

## What it does not do

Nothing of it is on main.
