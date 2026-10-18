---
schema: domain/v1
id: measurement
kind: domain
title: Measurement
headline: 'Take a guided sweep measurement of the playback and capture chain and get its frequency response, impulse response and band levels, with a quality rating and its reasons, calibrated only when you supply the calibration.'
problem: 'A response curve that looks equally authoritative whether it was clipped, noisy or uncalibrated, and that is read as the response of one part of the chain.'
status: stable
weight: 30
tags: [measure, calibration, transfer-function, v3]
---

# Measurement

The V3 Measure workspace: the guided flow and its state machine, the setup check, capture,
calibration profiles and the level calibration, the transfer function, the impulse response,
the RTA and the measurement quality rules. Results come from captured PCM through deterministic
offline DSP (ADR 0018), each named by a versioned algorithm ID (ADR 0024), and dB SPL appears
only under a valid level calibration (ADR 0017, ADR 0020).

Not in this domain: keeping, comparing and interpreting measurements once saved, which is
experiments.
