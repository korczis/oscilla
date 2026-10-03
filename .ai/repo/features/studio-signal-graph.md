---
schema: feature/v1
id: studio-signal-graph
kind: feature
title: 'Connect typed nodes into a sounding signal graph'
short_title: 'Signal graph'
headline: 'Wire oscillators, modulators, filters, analyzers and outputs with typed cables, and hear exactly the graph on screen.'
summary: 'Typed ports with roles, pure compatibility and cycle checks before any runtime change, a node registry that names the existing engine builders, and a compiler and runtime that patch the running Web Audio graph incrementally with crossfades.'
status: stable
weight: 410
featured: false
rules: [project.typed-ports, project.no-silent-feedback, project.audio-engine-discipline, project.visual-identity-lock]
docs: [docs/v31/compiler.md, docs/v31/studio-model.md, docs/v31/user-guide.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0032, adr-0033, adr-0034, adr-0035]
claims: [studio-typed-connections, studio-feedback-rejected, studio-registry-reuses-engine, studio-subgraph-paste, studio-compiled-topology, studio-click-free-live-edit]
use_cases: [studio-build-a-signal-path, studio-connect-modulation, studio-reject-an-invalid-connection, studio-edit-while-playing, studio-copy-and-paste-a-subgraph]
related: [studio, studio-automation, studio-measurement-routing]
tags: [v31, studio, graph]
---

## What it does

Nodes come from one registry (`src/js/studio/registry.js`, `nodes/*.js`): sources,
modulation, processing, analysis, output and measurement types, each declaring typed ports
(AUDIO, CONTROL, TRIGGER, ANALYSIS, with roles), parameters with units and ranges, and the
existing engine builder it compiles to (ADR 0032, ADR 0035). `canConnect`
(`src/js/studio/ports.js`) decides compatibility with a readable reason; validation
(`src/js/studio/validate.js`) rejects instantaneous audio feedback, control cycles and
analysis cycles before anything reaches Web Audio (ADR 0033). Modulation depth, polarity,
mapping and offset live on the control edge (ADR 0037).

The graph editor (`src/js/ui/studio/graph-editor.js`) offers a node library and a searchable
picker, cable drag with compatible inputs emphasised, a cable dropped on blank canvas to add
an accepting node, rectangle selection, copy, paste, duplicate and delete, pan, zoom and
frame, `/` search, and an Inspector generated from each node's parameter schema. The
compiler (`src/js/studio/compiler.js`) builds the plan from the model through the one
AudioEngine, with Master Output feeding only the engine's safety chain; the runtime
(`src/js/studio/runtime.js`) diffs each model change and patches the running graph in
transactions with crossfaded routes, and STOP leaves no node.

Proven by `npm test` (`tests/unit/v31-studio-model.test.mjs`,
`v31-studio-compiler.test.mjs`, `v31-studio-ui-graph-*.test.mjs`) and `npm run test:studio`
(`tests/browser/v31-studio-graph.cjs`; `tests/browser/v31-studio-audio.cjs` measures the
filtered and modulated signal against the browser's own biquad response, the click ratio of
live edits and the node counts after stop).

## What it does not do

There are no delay or feedback nodes in 3.1, no node groups or subgraphs, and no minimap.
`engine.stopAll()` does not reach the Studio graph; Studio STOP and Escape do
(`docs/v31/compiler.md`, "Known limitations"). Microphone input never reaches Master Output.
