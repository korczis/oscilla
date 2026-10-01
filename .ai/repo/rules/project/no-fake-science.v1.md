---
id: project.no-fake-science
version: 1
kind: rule
title: No fake science
description: User-facing content makes no wellness, audibility, ultrasound or calibration claims the application cannot support.
statement: No text claims therapeutic, cognitive, sleep, focus or animal-specific effects, inaudibility, safety of a frequency, calibrated SPL, or that digital generation implies acoustic reproduction.
status: active
class: blocking
depends_on: []
tags: [content, safety]
---

# Rationale

Specification sections 24, 37 and 60 forbid these claims; the application is an uncalibrated
educational instrument.

# Required behaviour

- 15.5 kHz is a high-frequency signal, not ultrasound; nominal ultrasound begins above ~20 kHz.
- Levels are relative signal levels, never dB SPL. No preset claims calibration.
- Binaural content describes the perceptual phenomenon only — no focus, sleep, therapy,
  meditation or neurological benefit.
- Continuous playback is opt-in per session and never persisted to storage or URL state.
- Preferred wording: requested digital frequency, relative signal level, digital Nyquist limit,
  speaker output unknown, approximate wavelength.

# Failure behaviour

A review rejection.

# Verification

A grep for the banned phrases in index.html returns nothing outside the code that lists them.
