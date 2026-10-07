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

### 2026-10-06: a level calibration belongs to an input; one without a binding never applies to a known input (ledger C1)

The v4.0 completion ledger (`docs/v4/completion-ledger.md`, finding C1) showed that dB SPL could
appear for an input nobody calibrated. A reading typed by hand before any setup check took the
current input, which was not known yet, so the stored `LevelCalibration` had `input: null`;
`levelCalibrationApplies` answered "applies, not checked" whenever either side had no binding,
so after another microphone was plugged in and checked the indicator still read CALIBRATED and
levels were shown in dB SPL. The workspace said only "entered by hand". A schema-1 calibration
(V3.0, no binding) behaved the same way.

Decided:

- **No calibration without its input.** MEASURE stores a level calibration only when the input
  it belongs to is known. A hand-typed reading is refused while no input has been checked:
  "Run the setup check first: a level calibration is valid only for the input it was taken with,
  and no input has been checked yet, so a reading typed now could not be bound to one." The
  dialog says so before Store is pressed, and once an input is known it says the reading is bound
  to the input checked last. A captured reference whose capture reported nothing about its input
  is refused the same way. Binding at the next measurement instead was rejected: until then the
  calibration would sit in the workspace bound to nothing, and the indicator would have to show
  a third state for it.
- **An unbound calibration never applies to a known input.** `levelCalibrationApplies(cal,
  current)` with a known current input and a calibration without a binding returns `applies:
  false, checked: true` and the reason "UNCALIBRATED: the level calibration is not bound to an
  input (...), so it cannot be shown to apply to this one. Calibrate again for this input."
  Only with no current input at all, which is a stored record read on its own, is nothing
  compared. MEASURE now checks the input before applying any level calibration, bound or not
  (`levelNeedsInputCheck`); the live RTA applies one only once the input is known.
- **Records say "not bound to an input".** A stored experiment keeps what it was measured with
  (ADR 0040), so an earlier record with an unbound calibration still opens and still shows the
  levels it stored. It never implies a checked binding: the summary reads "SPL CALIBRATED (94 dB
  SPL at 1 kHz; not bound to an input)", compare adds "(not bound to an input)", the evidence
  lineage says the record cannot show which input it was taken with, and the checklist item
  "Calibration identity recorded" stays partial for it (ADR 0044). `isBoundLevelCalibration`
  tells the two kinds apart.
- **What a binding still cannot tell.** A browser that does not expose a device id binds the
  calibration to the sample rate and processing flags only, so two such microphones with the same
  settings are not told apart (`deviceId` null on both sides compares equal). A binding never
  covers input gain or microphone position; the conditions field records them in the user's
  words.

Proven by `tests/unit/v4-measurement-truth.test.mjs` (the C1 tests, which failed before the
change) and check `calibration` in `tests/browser/v3-ui.cjs` (refused before any input, stored
and bound after the setup check, void for another input; chromium, firefox and webkit over
file:// and /oscilla/).

Review of #139, same day: the workspace's check alone was not enough. It compares the binding
with the input checked last, and that can be stale: the system default input can change under
"default input" (a microphone plugged in only refreshed the list), and a measurement started
from an engine that is not READY runs its own preflight on whatever input is the default now.
A calibration bound to microphone A was then applied to a run on microphone B, recorded as
applied, and summarized as "SPL CALIBRATED" with no finding. Added:

- **The engine decides.** `measurement/engine.js` applies a level calibration only while
  `levelCalibrationApplies(level, input)` holds for the input the measurement uses: checked
  against the preflight's input and again against the first run capture's own device,
  constraints and rate, whose facts become the record's `input`. When it does not apply, the
  whole measurement is uncalibrated (noise levels, result, quality), and the reason is kept: a
  `LEVEL_CALIBRATION_VOID` preflight warning, `result.calibrated.level.voided`, and the
  `LEVEL_CALIBRATION` quality reason "level calibration not applied (…): uncalibrated, levels are
  dB relative (dBFS-like)". An unbound calibration is never applied to a known input either.
- **Records are cross-checked.** `validate.js` `calibrationClaimFindings` adds a finding at
  `calibration.level.input` (code `calibration-claim-contradicted`) when a bound calibration names
  another input than the record's own `input` and sample rate. As with the other contradicted
  claims, such a record is kept, presented and compared as uncalibrated, and strict validation
  (every record the application writes) refuses it.
- **The indicator waits for the check.** Between an input change and the next setup check, the
  MEASURE level indicator reads "PENDING INPUT CHECK" with the reason, and the setup summary says
  levels are relative until the input is checked; no display applies the calibration then. A
  `devicechange` while the default input is in use makes the checked input unknown again.
- **"As far as the browser reports it."** A binding without a device id (a browser that does
  not expose one) is the sample rate and the processing flags only. MEASURE, the dialog and the
  evidence lineage say so in those words, never implying the identity of the microphone.

Proven by `tests/unit/v4-review-139.test.mjs` (each test failed before) and checks
`level-wrong-input` (a calibration bound to "Mic A" while the run captures from the loopback:
not applied, no "SPL") and `calibration` (the pending state) in `tests/browser/v3-ui.cjs`.

### 2026-10-07: an input, and a calibration, belong to the context that named them (ledger W7f)

Two sequences of `window.OSCILLA.measure` hooks still made the indicator read CALIBRATED for an
input nobody checked: an input named in TEST CONTEXT stayed the current input after the page
left it, and the input of a TEST CONTEXT result shown on the microphone was adopted; a typed
reading then bound to either. MEASURE now keeps which context named the current input and
answers "no input known" when it is not the page's own (`inputKnown()` in `src/js/ui/measure.js`),
and a level calibration made in TEST CONTEXT does not apply on the microphone, nor the reverse.
The rules above are unchanged; this only refuses more. Details: ADR 0052, resolution note of
the same day. Proven by `tests/unit/v4-seam-contract.test.mjs` and check
`calibrated-only-for-a-checked-input` in `tests/browser/app.cjs`.
