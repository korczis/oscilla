---
schema: adr/v1
id: adr-0024
kind: adr
title: Every stored result names the algorithm that produced it by a stable versioned ID; a material change mints a new ID
status: proposed
date: 2026-10-02
tags:
  - dsp
  - provenance
  - versioning
  - v3
provenance:
  origin: authored
---

# 24. Every stored result names the algorithm that produced it by a stable versioned ID; a material change mints a new ID

## Context

A saved transfer curve means something only together with how it was computed: window,
regularization, smoothing, band edges, alignment, quality thresholds. The product version and
commit (ADR 0019) identify the code but not which part changed, so two experiments from adjacent
releases cannot be judged comparable or not, and a stored result would silently mean something
else when re-rendered by newer code (V3 specification §43, §99, §199). Not yet implemented; the
contract lists IDs such as `oscilla.transfer.v1`, `oscilla.ir.log-sweep.v1`, `oscilla.rta.v1`,
`oscilla.confidence.v1`.

## Decision

Proposed:

- `src/js/measurement/algorithms.js` is the single registry of algorithm IDs. Each result and
  each quality assessment stores the IDs it used, plus their parameters where the ID allows a
  range (FFT size, window, smoothing fraction).
- A change that can alter a stored or displayed number (formula, default parameter, threshold,
  window, band-edge definition) mints the next ID (`…v2`). Refactors that are bit-identical on the
  test fixtures keep the ID.
- Stored results are never recomputed silently by newer code. Import accepts only registered IDs;
  comparison of results with different IDs is allowed but labelled as non-equivalent.

## Alternatives rejected

- Product version and commit only: too coarse to decide comparability, and a commit is not
  meaningful to a user.
- Recompute stored results on load with current code: the stored evidence would change without a
  new measurement.

## Consequences

- Old IDs stay in the registry as long as stored data may carry them; their descriptions remain
  documented even after the code moves on.
- DSP pull requests must state whether an ID changes; tests pin each ID to fixtures so an
  unannounced numeric change fails.
- Confirmation criteria: a fixture test fails when an algorithm's output changes while its ID does
  not; an import with an unknown ID is rejected (§145).

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: implemented as decided (V3.0, 14c7d5f, #29)

"Not yet implemented" above is history. `src/js/measurement/algorithms.js` is the registry:
the current ID of each family (`ALGORITHMS`), the retained older IDs that still reproduce
stored results (`RETAINED_ALGORITHMS`, e.g. `oscilla.confidence.v1` to `v3` beside the
current `v4`), and the import allow-list (`KNOWN_ALGORITHM_IDS`). Several IDs have since been
minted anew for material changes, as decided (V382 among them). Golden fixtures under
`tests/unit/fixtures/v3/` pin each ID's output (`tests/unit/v3-golden.test.mjs`), and an
unknown ID is refused on import. Proven by claim `algorithm-ids-on-results`.
