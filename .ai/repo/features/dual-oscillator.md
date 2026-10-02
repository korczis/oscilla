---
schema: feature/v1
id: dual-oscillator
kind: feature
title: 'Play two oscillators together, mixed or split to stereo'
short_title: 'Dual oscillator'
headline: 'Put two tones side by side to hear beating, intervals and stereo separation.'
summary: 'Two oscillators A and B with their own frequency, waveform, gain and detune, mixed to mono or split left and right; the defaults (440 Hz and 442 Hz) demonstrate beating.'
status: stable
weight: 30
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0015]
claims: [dual-oscillator-beats]
use_cases: [hear-440-and-442-hz-beating]
related: [phase-stereo-lissajous, signal-generator]
tags: [audio, v2]
---

## What it does

The dual graph in `src/js/audio/modulation.js` builds both oscillators from one plan that
carries their sounding frequencies; the stereo router sends A left and B right. The engine
suite measures the beat envelope of 440 Hz against 442 Hz at 2 Hz.

## What it does not do

Detune is never automated, and both oscillators pass through the same output cap.
