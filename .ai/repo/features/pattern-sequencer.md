---
schema: feature/v1
id: pattern-sequencer
kind: feature
title: 'Compose block sequences on a timeline'
short_title: 'Sequencer'
headline: 'Arrange tones, sweeps, modulated blocks and silences on a timeline and play them back exactly.'
summary: 'A block timeline with a ruler, playhead and per-block editors, compiled into Web Audio automation on the audio clock and renderable offline for WAV export.'
status: stable
weight: 60
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0001, adr-0015]
claims: [sequencer-safe-automation]
use_cases: [play-a-sequence]
related: [export]
tags: [audio, sequencer, v2]
---

## What it does

`src/js/sequencer/` holds the model, the editor, the timeline layout and the compiler. Every
block resolves into one of the V1 plan topologies; the compiled events are sorted, gain never
reaches zero, frequencies stay between 20 Hz and the safe maximum, and edges are short
click-free ramps.

## What it does not do

It is not a DAW: there are no tracks, no MIDI and no recording of input.
