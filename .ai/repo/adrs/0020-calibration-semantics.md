---
schema: adr/v1
id: adr-0020
kind: adr
title: Frequency-response and absolute-level calibration are separate kinds, interpolated in log frequency and never extrapolated
status: proposed
date: 2026-10-02
tags:
  - calibration
  - measurement
  - v3
provenance:
  origin: authored
---

# 20. Frequency-response and absolute-level calibration are separate kinds, interpolated in log frequency and never extrapolated

## Context

A microphone correction file (frequency, correction in dB) changes the shape of a response; an
absolute calibration against a 94 dB SPL reference changes the scale. Mixing them lets a
frequency profile make an uncalibrated level look like SPL. Correction files are sparse and
irregular (often denser at low frequencies) and rarely cover 20 Hz-20 kHz, and they arrive from
users as CSV with headers, comments, tabs or commas (V3 specification §17-§25, §142, §158, §200).
Not yet implemented.

## Decision

Proposed:

- Two kinds, two types, two switches: a `FrequencyProfile` (sorted unique frequency/correction
  points) and a `LevelCalibration` (reference frequency, reference dB SPL, observed relative
  level, derived offset, conditions). Either can be on without the other; only a valid
  `LevelCalibration` permits "dB SPL" (ADR 0017).
- Between points the correction is interpolated linearly in dB over log₁₀(frequency).
- No extrapolation by default: outside the profile's range the result is uncalibrated, carried as
  a calibration-range mask and shown ("calibrated to 15 kHz"). Holding the end value is not done
  silently.
- A profile's identity is a SHA-256 of its normalized points, not its file name. Results store
  profile ID, kind and on/off state; the raw response is always kept and the corrected one is a
  derived view.
- Import is strict: malformed, non-finite, duplicate-conflicting or oversized (more than 2 000
  points) profiles are rejected with a reason; tolerated formatting (comment lines, header,
  comma/tab/semicolon) is enumerated, not guessed. No manufacturer files ship; examples are
  labelled as examples.

## Alternatives rejected

- One "calibration" object with an optional offset: the conflation the specification forbids.
- Interpolation linear in Hz: across a 20 Hz → 1 kHz segment, 88 % of the change would fall in
  the upper half of the log axis the user sees (141 Hz-1 kHz), shifting every sparse correction
  toward the top of its segment.
- Cubic or spline interpolation: can overshoot between sparse points and invent corrections no
  point states; linear-in-log is predictable and testable.
- Edge-value extrapolation by default: presents unmeasured regions as calibrated.

## Consequences

- Results above or below a profile's coverage show uncalibrated regions, which is honest but looks
  less complete.
- The interpolation method is an algorithm (`oscilla.calibration.log-interp.v1`, ADR 0024);
  changing it changes the ID.
- Confirmation criteria: unit tests for exact point, between points, below and above range,
  unsorted, duplicate, NaN, infinite and huge inputs pass (§142); revise the interpolation only if
  a documented method is shown to be more accurate on real correction files.
