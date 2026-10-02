---
schema: feature/v1
id: phase-stereo-lissajous
kind: feature
title: 'Explore phase, Lissajous figures and stereo correlation'
short_title: 'Phase and stereo'
headline: 'See how two signals relate: their phase, their Lissajous figure and how correlated the two channels are.'
summary: 'A phase view and a Lissajous figure of oscillators A and B, stereo panning and mono or stereo output, and a correlation meter from left and right analysers.'
status: stable
weight: 100
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0015, adr-0016]
claims: [phase-and-lissajous-model, stereo-correlation-meter]
related: [dual-oscillator]
tags: [analysis, stereo, v2]
---

## What it does

`src/js/audio/stereo.js` routes the two sources with their own left and right analysers;
`src/js/analysis/correlation.js` computes a smoothed Pearson correlation;
`src/js/charts/phase-model.js` and `src/js/charts/lissajous.js` compute the views p5 draws.

## What it does not do

The binaural option is off by default and carries no wellness claim (rule
`project.no-fake-science`).
