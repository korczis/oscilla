---
schema: feature/v1
id: frequency-sweep
kind: feature
title: 'Sweep a frequency range on a log or linear curve'
short_title: 'Sweep'
headline: 'Sweep the whole audible range, or any part of it, up, down or back and forth, once or until stopped.'
summary: 'Sweep up, sweep down and ping-pong patterns over a chosen range, duration and curve (default 20 Hz to 20 kHz, log, 10 s), with continuous repeat scheduled ahead and topped up.'
status: stable
weight: 20
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0001, adr-0004, adr-0005]
claims: [sweep-rises-through-range]
use_cases: [sweep-20-hz-to-20-khz]
related: [signal-generator, live-analysis]
tags: [audio, v2]
---

## What it does

Sweeps are frequency ramps planned in `src/js/audio/patterns.js` (`sweepSegments`) and
automated in `src/js/audio/scheduler.js`. Continuous repeat is its own plan kind, scheduled
about ten seconds ahead and topped up while it plays (ADR 0004), so stopping is immediate
and the main thread is not flooded with events.

## What it does not do

A sweep here is a listening and teaching signal. It is not the measurement sweep of the
transfer-function feature, which renders its own canonical sweep, captures it and
deconvolves it in the Measure workspace (ADR 0021).
