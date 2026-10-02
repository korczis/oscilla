---
schema: adr/v1
id: adr-0029
kind: adr
title: The release gate includes a visual regression check with per-region thresholds measured from run-to-run variance
status: proposed
date: 2026-10-02
tags:
  - release
  - testing
  - visual
provenance:
  origin: authored
---

# 29. The release gate includes a visual regression check with per-region thresholds measured from run-to-run variance

## Context

V2 is a dense visual cockpit accepted against a 1536x1024 reference (plan M009). Functional
browser checks do not see layout or drawing regressions. A single global pixel threshold either
fails on live data regions or hides changes to static chrome.

## Decision

Proposed (being implemented, plan M011 R006):

- The release gate renders deterministic reference states and compares them per named region
  (`tests/visual/regions.json`).
- Each region's threshold comes from measured run-to-run variance: static chrome 0.00, regions
  with live phase data about 3-3.5 %.
- Thresholds change only with a recorded remeasurement, not to make a failing gate pass.

## Alternatives rejected

- A global threshold: too loose for chrome or too strict for data.
- No visual gate: layout regressions reached the live site before (V2 panels collapsing below
  1280 px, fixed in PR #8).

## Consequences

- Intentional visual changes update the reference in the same pull request, together with the
  social preview image when the desktop look changes (ADR 0011's share-asset exception).
- V3 adds a deterministic MEASURE reference rendered from synthetic data, never from a real
  microphone (V3 specification §148).
