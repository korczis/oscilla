---
schema: feature/v1
id: signal-generator
kind: feature
title: 'Generate tones and signal patterns'
short_title: 'Signal generator'
headline: 'Hold a key or a button and hear a clean tone, or start a pattern of pulses, bursts, chirps, sirens and modulated signals, all starting and stopping without clicks.'
summary: 'Sine, square, triangle and sawtooth tones at a chosen frequency and relative gain, and the V1 signal patterns (pulse, burst, chirp, siren, alternating, wobble, AM, FM, random, octave, sequence), scheduled on the audio clock behind an output cap.'
status: stable
weight: 10
featured: true
rules: [project.audio-engine-discipline, project.no-fake-science]
docs: [README.md]
adrs: [adr-0002, adr-0003, adr-0005, adr-0006, adr-0014, adr-0015]
claims: [tone-plays-and-releases, patterns-match-v1]
use_cases: [play-a-440-hz-tone]
related: [frequency-sweep, dual-oscillator]
tags: [audio, v2]
---

## What it does

The generator plays one voice at a time from a plan built by `src/js/audio/patterns.js`
and scheduled by the engine in `src/js/audio/audio-engine.js`: every gain and frequency
change is recorded automation on the audio clock, a new voice fades the previous one out
first, and a waveshaper ceiling backs up the output cap (ADR 0002). A change made while
playing glides, dips or restarts and never extends playback (ADR 0003). The V1 patterns
are frozen: golden vectors taken from the V1 file are replayed against the V2 modules
(ADR 0014).

## What it does not do

It does not state a sound pressure level, and it does not claim the speakers reproduce the
requested frequency. Open signals are capped by the hard safety limit; only finite patterns
are exempt, up to 30 s (ADR 0005).
