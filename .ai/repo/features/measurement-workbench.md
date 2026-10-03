---
schema: feature/v1
id: measurement-workbench
kind: feature
title: 'Run acoustic measurements in a dedicated Measure workspace'
short_title: 'Measure workspace'
headline: 'A guided workspace that takes a measurement from a setup check to a stored, comparable result, and stops cleanly at any moment.'
summary: 'The Measure workspace beside the Playground: a seven-step guided flow with expert settings, a setup check, a live quality bar, stage announcements, output exclusivity and an abort that releases every node, from file:// and from GitHub Pages.'
status: stable
weight: 300
featured: false
rules: [project.no-fake-science, project.audio-engine-discipline, project.single-file-deliverable]
docs: [README.md, docs/v3/architecture.md, docs/v3/measurement-guide.md]
adrs: [adr-0018, adr-0026]
claims: [measurement-workbench, measurement-abort-releases-everything, measure-from-file-and-subpath, analysis-off-main-thread]
use_cases: [measure-a-playback-capture-chain-response, open-measure-from-file]
related: [transfer-function, measurement-quality, reproducible-experiments]
tags: [v3, measurement]
---

## What it does

`src/js/ui/measure.js` binds the pure view models of `src/js/measurement/views/` to the
explicit state machine of `src/js/measurement/state-machine.js`, driven by
`src/js/measurement/engine.js` (no DOM) over the browser io of
`src/js/measurement/capture.js`. The guided flow is input, calibration, noise check,
stimulus, measure, review and save; the preset CHARACTERIZE PLAYBACK CHAIN plays a 20 Hz to
20 kHz log sweep three times at the LOW digital level. Results come from captured PCM
through offline DSP (ADR 0018); capture runs in an AudioWorklet loaded from a data URL, with
a ScriptProcessor fallback (ADR 0026). While a measurement owns the output the instrument
cannot play, and Escape, STOP, page hide or leaving the workspace aborts it with nothing
left running.

## What it does not do

It measures the whole playback and capture chain, never a loudspeaker, a room or a
microphone alone. The automated gate runs it on a TEST CONTEXT digital loopback and a fake
microphone, so no test proves a physical setup. The offline analysis runs on the main
thread, yielding between steps; moving it into a Worker is the planned claim
`analysis-off-main-thread`.
