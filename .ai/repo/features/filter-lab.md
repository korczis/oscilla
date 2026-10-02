---
schema: feature/v1
id: filter-lab
kind: feature
title: 'Shape the signal with biquad filters'
short_title: 'Filter Lab'
headline: 'Put a low-pass, high-pass, band-pass, notch or peaking filter on the signal and see its response curve.'
summary: 'A Filter Lab stage of BiquadFilterNodes (low-pass, high-pass, band-pass, notch, peaking) with a click-free bypass, white and pink noise as test input, and a response chart drawn from the frequency response of the filter itself.'
status: stable
weight: 70
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0015]
claims: [lowpass-attenuates]
use_cases: [low-pass-a-tone]
related: [adsr-envelope, additive-synthesis]
tags: [audio, synthesis, v2]
---

## What it does

`src/js/audio/filters.js` builds the stage as an engine insert with dry and wet paths;
`src/js/audio/noise.js` provides seeded white and pink noise. The chart is drawn from
`getFrequencyResponse`, so it shows the filter that is playing.

## What it does not do

The response curve is the digital filter's, not the room's or the speaker's.
