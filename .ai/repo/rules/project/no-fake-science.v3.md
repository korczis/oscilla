---
id: project.no-fake-science
version: 3
kind: rule
title: No fake science
description: User-facing content makes no medical, wellness, cognitive, pseudoscientific, animal-effect, audibility, frequency-safety, ultrasound or calibration claim the application cannot support, and labels a level dB SPL only under a valid level calibration.
statement: No text OSCILLA can show claims a therapeutic, medical, sleep, focus, cognitive or animal-specific effect, inaudibility, the safety of a frequency, ultrasound below 20 kHz, certification, or that digital generation implies acoustic reproduction; a level is relative (dBFS-like) and is labelled dB SPL only while a valid absolute level calibration with an explicit external reference applies (ADR 0017, claim spl-only-with-level-calibration).
status: active
class: blocking
depends_on: []
tags: [content, safety]
x-majordomus:
  claims: [no-fake-science-in-shipped-copy, spl-only-with-level-calibration]
  tests: [tests/unit/no-fake-science.test.mjs, tests/unit/v3-calibration.test.mjs, tests/unit/calibration-display.test.mjs]
---

# Rationale

V1 specification sections 24, 37 and 60 and the V3 specification (§23-§24, §188-§189, §208)
forbid these claims: OSCILLA is an educational instrument and a measurement workbench whose
output chain, speaker, room and microphone are unknown unless the user calibrates them.

Version 1 said levels are "never dB SPL". V3 added an absolute level calibration (ADR 0017,
ADR 0020) that makes a correct SPL figure possible in exactly one defined case, and the
product has shipped it since V3.0; ADR 0017 asked for this version. Version 1 also said a
grep enforced it while no test did; this version names the tests that do.

Version 3 keeps every requirement of version 2 and adds how a calibration state is shown now
that the app speaks Czech (Q104): the states stay English as data, because the honesty tests
and stored records rely on them, and the page shows their Czech display forms through one map
(U114 b, oscilla-c3 under Q090, 2026-11-15).

# Required behaviour

- 15.5 kHz is a high-frequency signal, not ultrasound; nominal ultrasound begins above
  about 20 kHz. Generating a frequency digitally does not mean a speaker reproduces it.
- Levels are relative signal levels (dB relative, dBFS-like) and say so. "dB SPL" appears
  on an OSCILLA level only while a valid `LevelCalibration` (reference frequency, external
  reference level, observed relative level, derived offset, conditions) applies to it, with
  a visible CALIBRATED indicator; there is no default SPL calibration, and a measurement's
  output level is a digital level, never SPL. A frequency-response profile never makes a
  level SPL. Cited third-party data (the bioacoustics hearing ranges) may state its own
  published SPL criteria, with the citation.
- No medical, therapeutic, diagnostic, audiometric, sleep, relaxation, focus, cognitive or
  neurological claim, and no pseudoscience (Solfeggio, healing frequencies and the like).
  Binaural content describes the perceptual phenomenon only.
- No claim that a frequency affects, repels or deters an animal, that a frequency is safe or
  inaudible, or that OSCILLA is certified or of a class of a measurement standard.
- Continuous playback is opt-in per session and never persisted to storage or URL state.
- Preferred wording: requested digital frequency, relative signal level, digital Nyquist
  limit, speaker output unknown, approximate wavelength, UNCALIBRATED / CALIBRATED.
- The calibration states are data in English and are shown in Czech (Q104; U114 b, decided by
  oscilla-c3 under Q090). The values `UNCALIBRATED`, `CALIBRATED` and `PENDING INPUT CHECK`
  that level.js, the views' badges, saved experiments, exports and the honesty tests carry
  never change; what the page shows goes through one map, `src/js/calibration/display.js`:

  | Data value | Shown |
  | --- | --- |
  | `UNCALIBRATED` | NEKALIBROVÁNO |
  | `CALIBRATED` | KALIBROVÁNO |
  | `PENDING INPUT CHECK` | ČEKÁ NA KONTROLU VSTUPU |
  | `CALIBRATED (frequency)`, `UNCALIBRATED (frequency)` | KALIBROVÁNO (frekvence), NEKALIBROVÁNO (frekvence) |
  | `none (UNCALIBRATED)` | žádný (NEKALIBROVÁNO) |
  | a reason `UNCALIBRATED: …` | NEKALIBROVÁNO: … (the Czech sentence) |
  | the preset `CHARACTERIZE PLAYBACK CHAIN` (its id unchanged) | PROMĚŘIT ŘETĚZEC PŘEHRÁVÁNÍ |
  | the analyser caption `RELATIVE LEVEL (dBFS-like, uncalibrated)` (ADR 0017; U115) | RELATIVNÍ ÚROVEŇ (obdoba dBFS, nekalibrováno) |

  A shown reason names its state first and is built from the structure (the differences of
  `levelCalibrationApplies`), never parsed out of the English sentence while that structure
  is at hand; a reason the map does not know still reads "NEKALIBROVÁNO: …", so the state is
  never dropped or softened. No Czech display form claims more than its data value: no SPL,
  no certification.

# Failure behaviour

A failing test below fails `npm test`, so CI refuses the pull request; anything the tests
cannot decide is a review rejection.

# Verification

- `tests/unit/no-fake-science.test.mjs` (claim `no-fake-science-in-shipped-copy`) scans what
  a user can be shown: `src/index.html` without its comments and the string literals of
  every module under `src/js/` (concatenated literals joined). It first normalises the text
  (HTML entities decoded, tags as clause boundaries with their attribute text kept,
  whitespace and hand-wrapped lines collapsed), then refuses each banned claim phrase by
  kind. A negation excuses a phrase only when it governs it: a few words before it in its own
  clause ("not ultrasound"), a negated list of claim nouns ("no medical, therapeutic or
  wellness claims"), a negation right after it ("are not affected"), or the same phrase
  negated in its sentence. The test proves its matcher on claims, disclaimers and
  legitimate copy that only looks like a claim ("sleep mode", "cognitive load", "harmless
  default").
- The SPL condition is runtime state, so it is proven by claim
  `spl-only-with-level-calibration`: `tests/unit/v3-calibration.test.mjs` for the label
  function in both states, and check no-spl in `tests/browser/v3-ui.cjs` for the rendered
  workspaces.
- `tests/unit/calibration-display.test.mjs` proves the display: every reason level.js and the
  workspace can give (derived from level.js, one per binding key) is shown in Czech starting
  with its state; an unknown or mutated reason still starts "NEKALIBROVÁNO: "; every shown
  state, badge and title carries no English state word; the Czech forms make no forbidden
  claim; and a census derived from the code (the workspace getters that give a state, the
  `meas.cal` fields filled with a reason, the views' badge lists, the preset title, literals)
  refuses a binding of `src/index.html` that reads one outside `calibrationShown`, proven by
  dropping each wrap in turn. It also refuses a browser check that reads shown text with an
  English state regex, which would pass vacuously on the Czech page. Check calibration-czech in
  `tests/browser/v3-ui.cjs` walks the rendered Measure and Experiments views in those states
  and refuses any English state word shown or in a title.
- Not machine-checked: whether a sentence that passes the scan still implies an
  unsupported effect, and that continuous playback is never persisted. Those stay with the
  reviewer.
