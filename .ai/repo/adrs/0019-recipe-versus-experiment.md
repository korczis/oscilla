---
schema: adr/v1
id: adr-0019
kind: adr
title: A recipe says what to do and an experiment records what was done; repeating a recipe creates a new experiment
status: proposed
date: 2026-10-02
tags:
  - measurement
  - data-model
  - v3
provenance:
  origin: authored
---

# 19. A recipe says what to do and an experiment records what was done; repeating a recipe creates a new experiment

## Context

V2 has presets and configuration files: settings without results. V3 needs reproducible
experiments (specification §50, §100-§104, §160): what was requested, what the browser actually
applied, which calibration and algorithms were used, the results and their quality. If settings
and results share one mutable object, repeating a measurement overwrites the evidence, and a
URL that carries a result invites forged or stale data.

## Decision

Proposed:

- A **recipe** is the software-controlled setup only: stimulus specification, repeat count,
  analysis parameters, calibration reference. It is small, has no results, may travel in the URL
  hash, and its deterministic configuration hash (SHA-256 over the normalized recipe, not over UI
  state) identifies "the same experiment setup".
- An **experiment** is immutable once complete: the recipe it ran, what was actually applied
  (sample rate, granted input constraints or "unknown", device label or "browser did not expose
  device label"), calibration identity, environment notes typed by the user, runs, results,
  quality, algorithm IDs (ADR 0024), product version and commit, and a wall-clock timestamp.
- REPEAT loads an experiment's recipe and produces a new experiment with a new ID; nothing is
  overwritten silently. Comparison checks recipe hash, sample rate, calibration and algorithm IDs
  and states every difference.

## Alternatives rejected

- Extending the V2 config file with result fields: mixes intent with outcome and breaks the
  config schema's meaning.
- A mutable "measurement" document updated in place by repeats: loses the earlier runs.
- Results in the URL: unbounded size, and a link would present data no one measured in that
  browser.

## Consequences

- Two schemas to version (ADR 0023); the recipe is embedded in the experiment, not referenced.
- Physical conditions (room, distance, microphone position) cannot be reproduced by software; they
  are free-text notes, and the experiment says so.
- Confirmation criteria: export → import round-trips preserve recipe, provenance and results
  unchanged (§144); a repeat produces a second experiment with the same configuration hash and a
  different ID.
