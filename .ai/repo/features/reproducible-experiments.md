---
schema: feature/v1
id: reproducible-experiments
kind: feature
title: 'Record every measurement as a reproducible experiment'
short_title: 'Experiments'
headline: 'Planned: every measurement is kept with everything needed to reproduce it, and can be exported and imported.'
summary: 'Planned for V3 (milestone M017): versioned experiments with stimulus, calibration, device, environment, algorithm IDs and product version, persisted locally and exported as files and CSV.'
status: draft
weight: 350
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0019, adr-0022, adr-0023, adr-0024, adr-0027]
claims: [reproducible-experiments]
related: [measurement-comparison, calibration-profiles]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 50 to 58: a recipe says what to do and an experiment records what was
done (ADR 0019); experiments persist in IndexedDB with an in-memory fallback under file://,
and file export and import are the durable path (ADR 0022); each format has its own schema
version (ADR 0023) and the product version comes from package.json (ADR 0027).

## What it does not do

Nothing of it is on main.
