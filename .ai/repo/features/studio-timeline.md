---
schema: feature/v1
id: studio-timeline
kind: feature
title: 'Sequence events and measurement phases on a multi-track timeline'
short_title: 'Studio timeline'
headline: 'Place pattern, event and measurement clips on tracks and play them on the audio clock.'
summary: 'Tracks and clips in absolute seconds reusing the sequencer block semantics, with transport, loop, markers, snapping and a playhead, compiled through the existing sequencer compiler onto AudioContext time.'
status: stable
weight: 420
featured: false
rules: [project.audio-engine-discipline, project.studio-model-is-canonical]
docs: [docs/v31/timeline.md, docs/v31/sequencer-migration.md, docs/v31/user-guide.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0036]
claims: [studio-timeline-model, studio-transport-audio-clock]
use_cases: [studio-sequence-multiple-events]
related: [studio, studio-automation, studio-measurement-routing]
tags: [v31, studio, timeline]
---

## What it does

The timeline (`src/js/studio/timeline.js`, `docs/v31/timeline.md`) holds tracks of clips in
absolute seconds (ADR 0036): pattern clips whose payload is a sequencer block checked by the
sequencer's own rules (tone, sweep, pulse, chirp and the other block types), gate events on
an Envelope, and measurement clips (noise check, pre-roll, stimulus, capture, tail, analysis).
Clips are created, moved, resized, split, duplicated and deleted with snapping to a time grid,
bars and beats, or markers; a loop region and markers complete it, and V2 sequences import
and export exactly (`src/js/studio/sequence-import.js`).

Playback (`src/js/studio/timeline-compiler.js`, `src/js/studio/transport.js`) calls the
existing sequencer compiler once per pattern clip and schedules every item on AudioContext
time with look-ahead, under rule `project.audio-engine-discipline`; the playhead only
observes `transport.playhead()`. Edits during playback reschedule from a safe horizon; STOP
and Escape release every voice. The editor (`src/js/ui/studio/timeline-editor.js`) moves,
resizes, splits, duplicates and deletes a focused clip from the keyboard, and its details
panel edits start, duration and track as numbers.

Proven by `npm test` (`tests/unit/v31-studio-timeline.test.mjs`,
`v31-studio-transport.test.mjs`, `v31-studio-ui-timeline.test.mjs`) and `npm run test:studio`
(`tests/browser/v31-studio-transport.cjs` measures clip starts and ends on the audio clock in
three browsers; `tests/browser/v31-studio-timeline.cjs` drives the editor from `file://` and
the sub-path).

## What it does not do

It is not an audio-file editor and records no input. Dragging several clips at once and pinch
zoom on the timeline are not built. Musical time never applies to measurement clips, and
measurement clips are not rendered offline; they run live.
