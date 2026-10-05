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

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: rule `project.no-fake-science` v2 permits dB SPL exactly under this condition

V3 shipped the absolute level calibration (`src/js/calibration/level.js`), so the conflict
the first consequence foresaw existed from V3.0 until this note: v1 said "never dB SPL" while
the product showed SPL under a valid level calibration. Version 2 of the rule
(`.ai/repo/rules/project/no-fake-science.v2.md`) states this decision's condition, and claim
`spl-only-with-level-calibration` names the tests that prove it (the label function in both
states in `tests/unit/v3-calibration.test.mjs`, and check no-spl in `tests/browser/v3-ui.cjs`
for the rendered workspaces).
