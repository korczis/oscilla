---
schema: adr/v1
id: adr-0017
kind: adr
title: Levels are relative to digital full scale (dBFS-like); dB SPL appears only under a valid absolute-level calibration
status: proposed
date: 2026-10-02
tags:
  - measurement
  - units
  - scientific-honesty
provenance:
  origin: authored
---

# 17. Levels are relative to digital full scale (dBFS-like); dB SPL appears only under a valid absolute-level calibration

## Context

A browser knows digital sample values, not sound pressure: output gain, speaker, room,
microphone, ADC and browser input processing are unknown. AnalyserNode readings are dB of a
Blackman-windowed FFT, so a full-scale sine reads about −13.56 dB, a number that looks like a
level but is neither SPL nor dBFS. Rule `project.no-fake-science` v1 forbids calibrated SPL claims.
V3 adds an optional absolute-level calibration (V3 specification §23-§24), which makes a correct
SPL figure possible in one defined case.

## Decision

- Every level in V2 is relative and labelled so: "RELATIVE LEVEL (dBFS-like, uncalibrated)" on
  charts, "not SPL" in descriptions, `calibrated: false` in compare results.
- Where a sinusoid's amplitude is reported (`peak-detector.js` `levelDbfs`), the Blackman
  coherent-gain and one-sided correction (+13.56 dB) is applied so a full-scale sine reads 0 dBFS.
  It is documented as meaningful only for one stationary sinusoid.
- Proposed for V3: "dB SPL" is displayed only when a valid `LevelCalibration` (reference
  frequency, external reference level, observed relative level, derived offset, conditions)
  applies to the result, always with a visible CALIBRATED indicator. Without one the scale reads
  "dB relative (dBFS-like)". There is no default SPL calibration. Measurement output level is a
  digital level, never called SPL (V3 specification §208).

## Alternatives rejected

- Raw analyser dB as "dB": looks absolute, reads −13.56 dB for full scale.
- An assumed microphone sensitivity giving "approximate SPL": invents a calibration.

## Consequences

- Rule `project.no-fake-science` v1 says levels are "never dB SPL". When V3 implements the
  absolute-level calibration, that rule needs a v2 permitting SPL exactly under this condition;
  until then this decision and the rule agree.
- Absolute-level calibration is kept separate from frequency-response calibration (ADR 0020).
- Confirmation for V3: the final science audit (V3 specification §237) finds no "SPL" string
  reachable without a valid level calibration, and a unit test asserts the label function's
  output for both states.
