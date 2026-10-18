---
id: sound-design-in-the-studio
kind: application
title: 'Sound design and patching in the Studio'
summary: 'Building sound as a graph of typed nodes, sequencing clips on a timeline, automating parameters and editing while it plays, with every edit undoable and the result kept as a project or a patch.'
weight: 50
status: active
fits_when:
  - 'The sound is built from oscillators, envelopes, filters, LFOs and gains wired with typed cables, and changed while it plays'
  - 'Events are placed as clips on tracks and parameters automated in lanes, played on the audio clock'
  - 'The graph should be the one that sounds, with refused edits explained in words and the Runtime section saying what is applied'
  - 'Work is kept as a project or as a reusable patch, exported to a file and imported by somebody else safely'
  - 'Editing has to work without a mouse: a connection dialog, a details panel and arrow-key nudges, announced to screen readers'
does_not_fit_when:
  - 'The patch needs a feedback loop or a delay network: every cycle is refused, and a safe delay or feedback node does not exist yet'
  - 'A live microphone has to be processed and heard: a live input with an audio path to the output is refused, and Render WAV refuses a live input'
  - 'The output must go beyond the engine''s master safety chain and limiter: Studio is no second engine, and its limits apply'
  - 'The work needs a minimap, node groups, dragging several clips at once or pinch zoom on the timeline: none is built yet'
  - 'The graph is much larger than about 100 nodes and 200 connections, the size the performance budgets are measured at'
  - 'Studio and the Playground or a measurement must sound at the same time: starting one stops the other'
use_cases: [studio-build-a-signal-path, studio-connect-modulation, studio-reject-an-invalid-connection, studio-edit-while-playing, studio-copy-and-paste-a-subgraph, studio-undo-and-redo, studio-save-and-load-a-patch, studio-sequence-multiple-events, studio-automate-a-parameter, studio-compact-full-sync, studio-operate-without-dragging, studio-open-from-file]
---

# Context

Someone opens Studio and builds Oscillator, Envelope, Filter and Master Output, drags an LFO
onto the cutoff, and while the patch plays inserts a Gain node, removes the LFO and changes the
filter type. They automate the cutoff from 500 Hz to 8 kHz over three seconds, save the project,
keep three nodes as a patch, and later import a file somebody sent them. What they need is that
the graph on screen is the graph that plays, that an edit during playback does not click, that a
cable which would close a loop is refused with a sentence, and that an imported file never
overwrites their work silently.

The rules it leans on are `project.studio-model-is-canonical`, `project.typed-ports`, `project.no-silent-feedback`, `project.audio-engine-discipline` (`.ai/repo/rules/project/`).
