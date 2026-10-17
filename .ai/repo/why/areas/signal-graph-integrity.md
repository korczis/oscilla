---
schema: area/v1
id: signal-graph-integrity
kind: area
title: What plays is what is shown
summary: 'Whether the Studio graph on screen is the graph Web Audio runs, and whether an edit is refused or applied where the person can see it.'
status: stable
weight: 50
tags: [studio, graph, runtime]
---

# What plays is what is shown

A patching workspace can drift from the sound it makes: a second copy of the graph, a cable
Web Audio accepts silently, a loop the browser mutes, an edit that rebuilds everything and
clicks. This area covers the Studio's promise that the screen never shows one topology while
Web Audio runs another (rules `project.studio-model-is-canonical`, `project.typed-ports` and
`project.no-silent-feedback`; ADR 0030, ADR 0032, ADR 0033, ADR 0035, ADR 0039).

Not in this area: the level and click discipline of the engine underneath, which is playback
safety.
