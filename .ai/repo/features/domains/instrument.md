---
schema: domain/v1
id: instrument
kind: domain
title: Instrument
headline: 'Generate tones, sweeps, patterns and sequences, shape them with filters, envelopes and harmonics, and take them away as files, links and presets, all starting and stopping without clicks.'
problem: 'A browser tone generator that clicks, stacks voices above its output cap or keeps sounding after Stop, and whose setups cannot be brought back.'
status: stable
weight: 10
tags: [generator, synthesis, export, v2]
---

# Instrument

The sound OSCILLA makes outside the Studio: the signal generator and its patterns, the sweep,
the dual oscillator, the pattern sequencer, the filter lab, the ADSR envelope and additive
synthesis, all running inside the one audio engine (rule `project.audio-engine-discipline`,
ADR 0015), and what leaves the page with them: WAV export rendered through the same chain,
configuration files, links and presets.

Not in this domain: what is drawn from the signal, which is the laboratory; and graph-based
patching, which is the Studio.
