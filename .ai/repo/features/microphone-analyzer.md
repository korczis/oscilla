---
schema: feature/v1
id: microphone-analyzer
kind: feature
title: 'Analyse the microphone and compare it with the generator'
short_title: 'Microphone analyzer'
headline: 'Hear what your room and microphone actually pick up, and see how far it is from what was requested.'
summary: 'An opt-in microphone input with its own spectrum and peak, and a generator-versus-microphone comparison in hertz and cents with a plain quality flag; nothing is recorded or sent anywhere.'
status: stable
weight: 50
featured: true
rules: [project.no-fake-science]
docs: [README.md]
adrs: [adr-0017]
claims: [microphone-analysis-only, generator-mic-compare]
use_cases: [analyse-the-microphone]
related: [live-analysis]
tags: [analysis, microphone, v2]
---

## What it does

`src/js/audio/microphone.js` requests audio only when the person presses "Use
microphone", with echo cancellation, noise suppression and automatic gain control off, and
connects it to its own analyser and never to the output. `src/js/analysis/compare.js`
compares the requested frequency with the observed peak and reports match, close, harmonic,
mismatch, no signal or out of range.

## What it does not do

The microphone is uncalibrated: readings are relative, and the comparison says nothing about
sound pressure or about the microphone's own frequency response. Calibration profiles belong
to the V3 Measure workspace (feature calibration-profiles) and do not apply here.
