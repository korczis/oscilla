---
schema: feature/v1
id: impulse-response
kind: feature
title: 'Recover the impulse response from a sweep'
short_title: 'Impulse response'
headline: 'Planned: recover the impulse response of the chain from the same sweep, with windowing that never destroys the original.'
summary: 'Planned for V3 (milestone M015): log-sweep deconvolution with band-limited regularisation, metadata, non-destructive windowing and labelled normalisation.'
status: draft
weight: 330
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0021, adr-0024]
claims: [impulse-response]
related: [transfer-function]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 37 to 43: division by the spectrum of the rendered canonical sweep
with band-limited regularisation, Farina's inverse filter as the test oracle (ADR 0021).

## What it does not do

Nothing of it is on main. Room-acoustics figures (RT60, EDT, T20, T30) are V3.1 and out of
V3.0 scope.
