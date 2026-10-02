---
schema: feature/v1
id: additive-synthesis
kind: feature
title: 'Build tones from harmonics'
short_title: 'Additive synthesis'
headline: 'Build a tone harmonic by harmonic and hear exactly the spectrum you drew.'
summary: 'Harmonic tables (square, saw, triangle approximations and custom) with per-harmonic gain and phase, played as a PeriodicWave whose coefficients are the ones the bars show.'
status: stable
weight: 90
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0015]
claims: [additive-coefficients-play]
use_cases: [build-a-tone-from-harmonics]
related: [filter-lab]
tags: [audio, synthesis, v2]
---

## What it does

`src/js/audio/additive.js` turns the partials into PeriodicWave arrays and normalises the
peak, Gibbs overshoot included; `src/js/labs/additive.js` draws the bars from the same table
and scale, so what is drawn is what plays.

## What it does not do

The harmonics are fixed per tone; there is no per-harmonic envelope or resynthesis of a
recorded sound.
