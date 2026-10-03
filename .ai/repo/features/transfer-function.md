---
schema: feature/v1
id: transfer-function
kind: feature
title: 'Measure the frequency response of the playback chain'
short_title: 'Transfer function'
headline: 'Play a log sweep, capture it, and see the frequency response of speaker, room and microphone together, with the range it can be trusted in.'
summary: 'A log-sweep transfer function from captured PCM: noise check and per-frequency signal-to-noise, a valid range, phase only under a robust alignment, raw, calibrated, smoothed and normalised views and a resolution-aware cursor.'
status: stable
weight: 320
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md, docs/v3/measurement-guide.md]
adrs: [adr-0018, adr-0021, adr-0024]
claims: [transfer-function]
use_cases: [measure-a-playback-capture-chain-response]
related: [impulse-response, calibration-profiles, measurement-quality]
tags: [v3, measurement]
---

## What it does

`src/js/measurement/transfer.js` divides the spectrum of the capture by the spectrum of the
rendered canonical sweep with band-limited regularisation (ADR 0021) and resamples the
result onto a log-frequency grid. `align.js` finds the lag by cross-correlation,
`smoothing.js` derives fractional-octave and normalised views without touching the raw
curve, and every result carries `oscilla.transfer.v1` (ADR 0024). The valid range ends where
the stimulus has no energy or, with a noise check, where the signal is less than 10 dB above
the noise.

## What it does not do

The result is the observed response of the whole chain, never the loudspeaker alone, and
its levels are ratios, never dB SPL. Phase is absent rather than guessed when the alignment
is weak or the runs are aggregated. THD, latency and room-acoustics figures are not part of
V3.0.
