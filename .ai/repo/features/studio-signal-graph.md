---
schema: feature/v1
id: studio-signal-graph
kind: feature
title: 'Connect typed nodes into a sounding signal graph'
short_title: 'Signal graph'
headline: 'Planned: wire oscillators, modulators, filters, analyzers and outputs with typed cables, and hear exactly the graph on screen.'
summary: 'Typed ports with roles, pure compatibility and cycle checks before any runtime change, a node registry that names the existing engine builders, and a compiler that patches the running Web Audio graph incrementally.'
status: draft
weight: 410
featured: false
rules: [project.typed-ports, project.no-silent-feedback, project.audio-engine-discipline, project.visual-identity-lock]
docs: [docs/v31/studio-model.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0032, adr-0033, adr-0034, adr-0035]
claims: [studio-typed-connections, studio-feedback-rejected, studio-registry-reuses-engine, studio-subgraph-paste, studio-compiled-topology, studio-click-free-live-edit]
use_cases: [studio-build-a-signal-path, studio-connect-modulation, studio-reject-an-invalid-connection, studio-edit-while-playing, studio-copy-and-paste-a-subgraph]
related: [studio, studio-automation, studio-measurement-routing]
tags: [planned, v31, studio, graph]
---

## What it does

Nodes come from one registry (`src/js/studio/registry.js`, `nodes/*.js`): sources,
modulation, processing, analysis, output and measurement types, each declaring typed ports
(AUDIO, CONTROL, TRIGGER, ANALYSIS, with roles), parameters with units and ranges, and the
existing engine export it compiles to (ADR 0032, ADR 0035). `canConnect` decides
compatibility with a readable reason; validation rejects instantaneous audio feedback,
control cycles and analysis cycles (ADR 0033). Modulation depth lives on the control edge
(ADR 0037).

Guaranteed now, by `tests/unit/v31-studio-model.test.mjs`: typed connections with reasons,
cycle rejection, registry keys naming real engine exports, and subgraph copy and paste.

## What it does not do

The graph editor (viewport, nodes, cables, selection, Inspector; issues V409-V413), the
compiler (V414) and incremental runtime patching (V415) are not built; until they are, no
Studio graph sounds and claims `studio-compiled-topology` and `studio-click-free-live-edit`
are `planned`. There are no delay or feedback nodes in 3.1, and no groups or subgraphs until
that open question is answered.
