---
schema: adr/v1
id: adr-0025
kind: adr
title: Measurement quality is a rule-based status (GOOD, USABLE, POOR, INVALID) computed from named metrics, always with its reasons
status: proposed
date: 2026-10-02
tags:
  - measurement
  - quality
  - scientific-honesty
  - v3
provenance:
  origin: authored
---

# 25. Measurement quality is a rule-based status (GOOD, USABLE, POOR, INVALID) computed from named metrics, always with its reasons

## Context

A measured curve looks equally authoritative whether it was clipped, buried in room noise,
captured with a dropout or measured once. V2's compare already returns a quality flag with
`calibrated: false`; V3 must tell the user how far to trust a result (specification §64-§71,
§109, §156, §199, §220-§221). An unexplained score or a "HIGH CONFIDENCE" label without defined
semantics would itself be a fake-science claim (rule `project.no-fake-science`). Not yet
implemented.

## Decision

Proposed:

- A pure function maps measured metrics to a status. Metrics: clipping ratio and regions
  (threshold plus run length, not only exact ±1), dropouts and empty capture, per-frequency SNR
  against the preflight noise floor, repeatability across runs (median absolute deviation),
  frequency resolution, calibration presence and coverage, valid range against requested range.
- Statuses are GOOD, USABLE, POOR, INVALID with documented rules. INVALID is reserved for
  conditions that make the result meaningless (severe clipping, no signal, capture underrun,
  numerical failure); an INVALID result is not drawn as authoritative.
- Every assessment carries its reasons (`code`, `severity`, text, value, unit, frequency range),
  passing and failing alike. Per-frequency masks (low SNR, uncalibrated) are part of the result
  and are drawn differently, with text and shape, not colour alone.
- Thresholds are named constants with a documented rationale; changing a rule or threshold
  materially mints a new `oscilla.confidence` ID (ADR 0024).

## Alternatives rejected

- A numeric confidence score (0-100 %): implies a calibrated probability no one has defined.
- HIGH/MEDIUM/LOW without rules: the same problem with fewer digits.
- No assessment, metrics only: leaves every user to judge raw SNR and variance figures alone.

## Consequences

- Thresholds are judgment calls; their values are visible and versioned rather than hidden.
- The assessment can be recomputed only with its own algorithm ID; a stored status stays as it
  was assessed.
- Confirmation criteria: synthetic cases (clean repeated, low SNR, clipped, high variance, missing
  calibration, partial coverage) yield the expected status and reasons that name the cause
  (§143); no status is ever shown without at least one reason.
