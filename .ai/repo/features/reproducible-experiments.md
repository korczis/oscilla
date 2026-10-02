---
schema: feature/v1
id: reproducible-experiments
kind: feature
title: 'Record every measurement as a reproducible experiment'
short_title: 'Experiments'
headline: 'Every measurement is kept with everything needed to reproduce it, stored in the browser, and exported and imported as a file.'
summary: 'Versioned experiments with recipe, output level, device and constraints, calibration, runs, quality, algorithm IDs, product version and build, hashed, stored in IndexedDB with a memory fallback, exported as JSON and CSV and validated on import.'
status: stable
weight: 350
featured: false
rules: [project.no-fake-science]
docs: [README.md, docs/v3/algorithms.md, docs/v3/architecture.md]
adrs: [adr-0019, adr-0022, adr-0023, adr-0024, adr-0027]
claims: [reproducible-experiments, experiment-round-trip, experiment-import-validated, experiment-persistence, algorithm-ids-on-results]
use_cases: [save-and-reload-an-experiment, export-an-experiment]
related: [measurement-comparison, calibration-profiles]
tags: [v3, measurement]
---

## What it does

`src/js/experiments/schema.js` builds the experiment (a recipe says what to do, an
experiment records what was done, ADR 0019), `hash.js` stamps a configuration hash and a
result hash over canonical JSON, `encode.js` writes typed arrays as little-endian base64,
`validate.js` treats every import as untrusted and `migrate.js` upgrades older schema
versions step by step (ADR 0023). `store.js` keeps experiments in the IndexedDB database
`oscilla-experiments` and falls back to memory, saying so, when IndexedDB is unavailable
(ADR 0022). The Experiments workspace lists, opens, renames, duplicates, exports (JSON and
CSV), imports and deletes them, and shows one in the Measure workspace.

## What it does not do

Raw audio is not stored. Browser storage is not durable: the exported file is what survives
clearing site data, a private window or a move to another machine. Calibration profile
points are not embedded, only the profile name and identity.
