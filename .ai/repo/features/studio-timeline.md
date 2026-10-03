---
schema: feature/v1
id: studio-timeline
kind: feature
title: 'Sequence events and measurement phases on a multi-track timeline'
short_title: 'Studio timeline'
headline: 'Planned: place pattern, event and measurement clips on tracks and play them on the audio clock.'
summary: 'Tracks and clips in absolute seconds reusing the sequencer block semantics, with transport, loop and markers, compiled through the existing sequencer compiler onto AudioContext time.'
status: draft
weight: 420
featured: false
rules: [project.audio-engine-discipline, project.studio-model-is-canonical]
docs: [docs/v31/studio-model.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0036]
claims: [studio-timeline-model, studio-transport-audio-clock]
use_cases: [studio-sequence-multiple-events]
related: [studio, studio-automation, studio-measurement-routing]
tags: [planned, v31, studio, timeline]
---

## What it does

The V2 block sequencer becomes one part of Studio (specification §81-§96): event and
measurement tracks, pattern clips whose payload is a sequencer block checked by the
sequencer's own rules, measurement clips (noise check, pre-roll, stimulus, capture, tail,
analysis), markers and a loop region, all in absolute seconds (ADR 0036). Playback extends
the existing sequencer compiler, so timing stays on AudioContext time under rule
`project.audio-engine-discipline`.

Guaranteed now, by `tests/unit/v31-studio-model.test.mjs`: the timeline model (claim
`studio-timeline-model`).

## What it does not do

Track compilation, transport, playhead and loop playback (issues V416, V418) and the
timeline editor (V417) are not built; claim `studio-transport-audio-clock` is `planned`. It
is not an audio-file editor, has no recording of input, and musical time never applies to
measurement clips.
