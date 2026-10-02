---
schema: feature/v1
id: adsr-envelope
kind: feature
title: 'Shape each note with an ADSR envelope'
short_title: 'Envelope'
headline: 'Give tones an attack, decay, sustain and release, set by fields or by dragging the envelope graph.'
summary: 'An attack-decay-sustain-release envelope applied to the gain of the voice on the audio clock, with a draggable graph and a release that continues from wherever the envelope is.'
status: stable
weight: 80
featured: false
rules: [project.audio-engine-discipline]
docs: [README.md]
adrs: [adr-0001, adr-0015]
claims: [adsr-envelope-semantics]
related: [filter-lab, signal-generator]
tags: [audio, synthesis, v2]
---

## What it does

`src/js/audio/envelope.js` schedules a linear attack, an exponential decay to the sustain
level and an exponential release on the voice's envelope gain, using
`cancelAndHoldAtTime` where the browser has it and an emulation with the same result where
it does not.

## What it does not do

The envelope shapes gain only; it does not modulate frequency or filter cutoff.
