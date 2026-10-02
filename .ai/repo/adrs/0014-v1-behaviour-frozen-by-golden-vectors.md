---
schema: adr/v1
id: adr-0014
kind: adr
title: V1 behaviour is frozen as golden vectors from the V1 file and replayed against the V2 modules
status: proposed
date: 2026-10-02
tags:
  - testing
  - refactor
  - v2
provenance:
  origin: authored
---

# 14. V1 behaviour is frozen as golden vectors from the V1 file and replayed against the V2 modules

## Context

V2 splits the verified V1 file (ADR 0007, ADR 0010) into 80 modules under `src/js/`. The V2 mission
required V1 behaviour to survive the split. Browser tests (ADR 0006) prove audible behaviour but
are slow and do not cover parsers, formatters, presets, URL state, the Nyquist rules or the exact
automation schedule an engine call produces.

## Decision

- Before the refactor, `tests/freeze/extract.cjs` loads V1 `index.html`, evaluates its script
  sections in a `node:vm` context with fixed `Date.now`, seeded `Math.random`, recorded timers and
  a recording mock AudioContext, and `tests/freeze/vectors.cjs` computes 1 083 cases in 22 groups
  (parsing, formatting, log mapping, music, regions, Nyquist, presets, URL state, storage
  migration, engine schedules). The outputs are `tests/freeze/golden-a7b7a23.json`, pinned to the
  V1 commit by name and by SHA-256.
- `tests/unit/freeze.test.mjs` replaces the V1 loader with an adapter over the V2 modules and
  runs the same vectors unchanged in `npm test`, on every pull request.
- The suite was mutation-checked against V1 (Nyquist factor, kHz threshold, URL merge, node leak:
  each killed). A V1 fix ported to V2 regenerates the golden from V1 at the new V1 commit, never
  from V2.
- V2 does not edit frozen constants: `APP_VERSION` stays `'1.0.0'` (the vectors pin it) and the
  product version lives in `src/js/ui/version.js`.

## Alternatives rejected

- Rewrite against the specification and rely on the browser gate: the gate cannot see a changed
  rounding rule, preset field or schedule offset.
- Snapshot V2 output after the refactor: freezes whatever V2 does, including regressions.

## Consequences

- Intentional V1 behaviour changes in V2 must be expressed as V2 options whose defaults reproduce
  V1 (the engine's extension points, ADR 0015), or as a deliberate golden regeneration recorded
  in the commit.
- The golden file is large (about 1.25 MB) and changes only with V1.
- `npm test` runs the freeze in well under a second; it is part of the CI `gate` job.
