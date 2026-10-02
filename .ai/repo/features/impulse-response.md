---
schema: feature/v1
id: impulse-response
kind: feature
title: 'Recover the impulse response from a sweep'
short_title: 'Impulse response'
headline: 'Recover the impulse response of the chain from the same sweep, with windowing that never destroys the original.'
summary: 'Log-sweep deconvolution with band-limited regularisation from the same spectral division as the transfer function, time in ms from the direct peak with the absolute offset kept, non-destructive windowing and labelled normalisation.'
status: stable
weight: 330
featured: false
rules: [project.no-fake-science]
docs: [docs/v3/algorithms.md]
adrs: [adr-0021, adr-0024]
claims: [impulse-response]
use_cases: [measure-an-impulse-response]
related: [transfer-function]
tags: [v3, measurement]
---

## What it does

`src/js/measurement/impulse-response.js` returns the impulse response at its original scale
with its peak, the capture offset and a noise-floor estimate, under
`oscilla.ir.log-sweep.v1`; Farina's inverse filter (`oscilla.ir.farina-inverse.v1`) is the
test oracle (ADR 0021). `irWindow` and `normalizeIr` return new objects, so a window or a
dB-re-peak view never changes the stored response. The Impulse response tab of the Measure
workspace zooms to the direct sound, the early part or the whole response.

## What it does not do

The time of the peak is where the sweep starts in the recording, including unknown device
and browser delays: it is not a time of flight and not a latency. RT60, EDT, T20 and T30
belong to V3.1 and are not computed.
