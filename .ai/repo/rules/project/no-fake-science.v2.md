---
id: project.no-fake-science
version: 2
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
  tests: [tests/unit/no-fake-science.test.mjs, tests/unit/v3-calibration.test.mjs]
---

# Rationale

V1 specification sections 24, 37 and 60 and the V3 specification (§23-§24, §188-§189, §208)
forbid these claims: OSCILLA is an educational instrument and a measurement workbench whose
output chain, speaker, room and microphone are unknown unless the user calibrates them.

Version 1 said levels are "never dB SPL". V3 added an absolute level calibration (ADR 0017,
ADR 0020) that makes a correct SPL figure possible in exactly one defined case, and the
product has shipped it since V3.0; ADR 0017 asked for this version. Version 1 also said a
grep enforced it while no test did; this version names the tests that do.

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

# Failure behaviour

A failing test below fails `npm test`, so CI refuses the pull request; anything the tests
cannot decide is a review rejection.

# Verification

- `tests/unit/no-fake-science.test.mjs` (claim `no-fake-science-in-shipped-copy`) scans what
  a user can be shown: `src/index.html` without its comments and the string literals of
  every module under `src/js/`. It refuses each banned claim phrase by kind; a negation
  excuses a phrase only within its own clause, a few words before it ("not ultrasound"). The
  test proves its matcher on claims, disclaimers and legitimate copy that only looks like a
  claim ("sleep mode", "cognitive load", "harmless default").
- The SPL condition is runtime state, so it is proven by claim
  `spl-only-with-level-calibration`: `tests/unit/v3-calibration.test.mjs` for the label
  function in both states, and check no-spl in `tests/browser/v3-ui.cjs` for the rendered
  workspaces.
- Not machine-checked: whether a sentence that passes the scan still implies an
  unsupported effect, and that continuous playback is never persisted. Those stay with the
  reviewer.
