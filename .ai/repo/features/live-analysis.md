---
schema: feature/v1
id: live-analysis
kind: feature
title: 'See the signal as waveform, spectrum and spectrogram'
short_title: 'Live analysis'
headline: 'Watch what is playing as a waveform, a live spectrum with its peak, and a scrolling spectrogram.'
summary: 'An oscilloscope-style waveform, an FFT spectrum with peak detection and a requested-frequency marker on log or linear axes, and a canvas spectrogram with freeze, all relative to digital full scale.'
status: stable
weight: 40
featured: true
domain: laboratory
rules: [project.no-fake-science]
docs: [README.md]
adrs: [adr-0016, adr-0017, adr-0018]
claims: [spectrum-peak-accuracy, spectrogram-mapping]
related: [microphone-analyzer, frequency-sweep]
tags: [analysis, v2]
---

## What it does

The live analyser output is read through `src/js/analysis/`: an FFT with the Web Audio
Blackman window, parabolic peak interpolation in dB, and a spectrogram ring buffer coloured
through a 256-entry lookup table. p5 draws the conceptual views, uPlot the quantitative
charts and a custom canvas the spectrogram, on one frame loop (ADR 0016). Hovering the
spectrogram (`src/js/charts/spectrogram-view.js`, K015, #263) draws a cursor line and reads the
newest column at that row: the bin, its frequency at bin resolution and its level in dB
relative to full scale, never calibrated. The view also has an unsmoothed feed, built from the
time-domain buffer, beside the default analyser feed with the node's smoothing; no workspace
offers a choice between the two yet.

## What it does not do

Levels are relative to digital full scale, never dB SPL (ADR 0017). The live analyser is
feedback, not measurement: measurement results come from captured PCM through offline DSP
(ADR 0018) in the V3 Measure workspace (feature measurement-workbench).
