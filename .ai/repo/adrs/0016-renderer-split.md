---
schema: adr/v1
id: adr-0016
kind: adr
title: p5 draws conceptual views, uPlot draws quantitative charts, custom canvas draws the spectrogram and editors, on one frame loop
status: proposed
date: 2026-10-02
tags:
  - visualization
  - charts
  - performance
provenance:
  origin: authored
---

# 16. p5 draws conceptual views, uPlot draws quantitative charts, custom canvas draws the spectrogram and editors, on one frame loop

## Context

V1 drew everything in one p5 sketch, including the spectrum. A p5 spectrum has no real axes,
cursors or tick logic, and every quantitative chart reimplemented them. V2 adds a filter-response
chart, a dual microphone/generator spectrum with peak hold, a scrolling spectrogram, and
interactive envelope and additive editors. A history-scrolling spectrogram redrawn as shapes each
frame is too slow at desktop sizes.

## Decision

- p5.js (instance mode, `visualization/p5-host.js`) keeps the conceptual, animated views ported
  from V1: waveform, signal path, interference/phase. They read engine state only through the
  visualization bridge and `engine.snapshot()`, reuse buffers and touch no DOM per frame.
- uPlot draws quantitative x/y charts with real axes and log-frequency scales: the live spectrum
  (one point per pixel column) and the filter response. Levels are labelled relative (ADR 0017).
- Custom canvas code draws the spectrogram (`analysis/spectrogram.js`: a ring buffer written one
  column per frame into an OffscreenCanvas and composed with two blits) and the interactive
  editors (envelope, additive, bioacoustic ranges).
- Every live renderer subscribes to one `requestAnimationFrame` loop (`charts/frame-loop.js`)
  that pauses while the page is hidden; a subscriber that throws is removed so it cannot stop the
  others. Audio scheduling never depends on it.

## Alternatives rejected

- Everything in p5: no axes or cursors, and a slow spectrogram.
- Chart.js or another general chart library: heavier than uPlot for streaming data, and the V3
  specification §119 excludes it.
- Everything on hand-written canvas: reimplements axes, scales, cursors and legends uPlot
  already provides.

## Consequences

- Three rendering models to know, kept in separate directories (`visualization/`, `charts/`).
- uPlot charts resized while hidden need an explicit rebuild (workaround in `main.js`).
- V3 result charts (frequency response, impulse response, RTA) extend this split: uPlot for
  response and IR curves, custom bars or uPlot for bands; charts render result objects and never
  own measurement data (ADR 0018).
