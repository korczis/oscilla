---
id: calibrate-a-microphone-frequency-response
kind: use-case
title: 'Calibrate a microphone frequency response'
summary: 'Import the correction file of a measurement microphone, see where it applies, and add an absolute level calibration from an external reference.'
category: measure
status: active
target: advisory
weight: 130
difficulty: intermediate
commands: [knowledge]
claims: [calibration-profiles, spl-only-with-level-calibration]
tags: [oscilla, product-acceptance, v3]
---

# Situation

Someone has a measurement microphone with a manufacturer correction file (frequency and
correction in dB) and, separately, a 94 dB SPL calibrator at 1 kHz. In the Measure workspace
they import the file, then open the level calibration dialog and enter the reference and the
level OSCILLA observed.

# What proves it

The behaviour is proven by the OSCILLA test named in each claim of `docs/CLAIMS.yaml`, run
by:

- `npm test` (tests/unit/v3-calibration.test.mjs: parsing, profile identity, interpolation, coverage, level offset, SPL label only with a valid calibration)
- `npm run test:measure` (tests/browser/v3-ui.cjs, checks calibration and no-spl, in Chromium, Firefox and WebKit from file:// and /oscilla/)

A use-case/v1 scenario can only invoke `bin/majordomus`, and a live one only its read-only
commands, so the scenario below does not play or capture audio. It proves the traceability
instead: each claim's implementation and test are tracked files wired to the claim in the
knowledge graph, so a renamed or deleted test breaks this use case rather than silently
orphaning the claim.

# What it cannot prove

The tests use synthetic profiles and entered values. Whether a level calibration still
holds after the gain, the browser settings or the microphone position change cannot be
checked by OSCILLA or by any test.

# Scenario

```yaml
mode: live
steps:
  - id: calibration-profiles-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim calibration-profiles is implemented by src/js/calibration/interpolate.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:calibration-profiles +implementation:src/js/calibration/interpolate\.js']
  - id: calibration-profiles-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim calibration-profiles is proven by tests/unit/v3-calibration.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:calibration-profiles +test:tests/unit/v3-calibration\.test\.mjs']
  - id: spl-only-with-level-calibration-implemented
    run: ['knowledge', 'edges', '--type', 'implemented_by']
    note: 'claim spl-only-with-level-calibration is implemented by src/js/calibration/level.js, a tracked file'
    expect:
      exit: 0
      stdout_contains: ['claim:spl-only-with-level-calibration +implementation:src/js/calibration/level\.js']
  - id: spl-only-with-level-calibration-tested
    run: ['knowledge', 'edges', '--type', 'tested_by']
    note: 'claim spl-only-with-level-calibration is proven by tests/unit/v3-calibration.test.mjs'
    expect:
      exit: 0
      stdout_contains: ['claim:spl-only-with-level-calibration +test:tests/unit/v3-calibration\.test\.mjs']
then:
  - 'every claim this use case names resolves to a tracked implementation and a tracked test'
```

# Outcome

The profile is accepted with its warnings, or refused with the offending line numbers. It
corrects the response only between its first and last frequency; outside that range the
curve stays uncorrected and is marked uncalibrated, and the raw curve is always kept. With a
valid level calibration the level indicator reads CALIBRATED and dB SPL may appear; without
one every level is dB relative (dBFS-like). A frequency profile alone never gives dB SPL.
