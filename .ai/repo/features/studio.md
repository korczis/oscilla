---
schema: feature/v1
id: studio
kind: feature
title: 'Program sound and measurement as an editable signal graph with a timeline'
short_title: 'Studio'
headline: 'Build sound and measurement graphs, sequence and automate them, and keep the whole setup as reproducible state.'
summary: 'The Studio workspace (V3.1): one canonical StudioModel edited through an undoable action layer, projected into a graph editor, Inspector, timeline and a compact Playground widget, and compiled into the existing audio and measurement engines.'
status: stable
weight: 400
featured: false
rules: [project.studio-model-is-canonical, project.visual-identity-lock, project.single-file-deliverable]
docs: [docs/v31/user-guide.md, docs/v31/studio-model.md, docs/v31/compiler.md, docs/v31/timeline.md, docs/v31/patches-and-provenance.md, docs/v31/performance.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0030, adr-0031, adr-0034]
claims: [studio-model-plain-data, studio-exact-undo-redo, studio-one-store-projections, studio-non-drag-operation, studio-file-protocol]
use_cases: [studio-compact-full-sync, studio-undo-and-redo, studio-copy-and-paste-a-subgraph, studio-operate-without-dragging, studio-open-from-file]
related: [studio-signal-graph, studio-timeline, studio-automation, studio-patches, studio-measurement-routing]
tags: [v31, studio]
---

## What it does

**Studio** is the workspace after Experiments and before About (README "The V3.1 Studio",
`docs/v31/user-guide.md`). A Studio document is one plain, versioned StudioModel (ADR 0030):
a graph of typed nodes and ports, a timeline of tracks and clips, automation lanes and
transport settings. It changes only through dispatched actions of the one store
(`src/js/studio/actions.js`), each undoable with exact snapshots (`src/js/studio/history.js`,
ADR 0031). The graph editor, the Inspector, the timeline and the compact Studio widget on
the Playground are projections of that store (`src/js/ui/studio/workspace.js`); an edit in
one is what the others show. The editor is OSCILLA's own HTML nodes over SVG cables in the
locked visual identity (ADR 0034), shipped inside the single `dist/index.html` and running
from `file://` and the Pages sub-path.

Every editor has a keyboard path: a Connect… list instead of dragging a cable, a details
panel instead of dragging a clip, arrow-key nudges, screen-reader announcements, and tap to
connect on touch, with a split Graph / Timeline / Inspector view below 768 px. Studio output
and Playground output are exclusive, and a measurement stops the Studio. It stays responsive
at about 100 nodes and 200 connections (`docs/v31/performance.md`).

Proven by `npm test` (`tests/unit/v31-studio-*.test.mjs`) and `npm run test:studio`
(`tests/browser/v31-studio-graph.cjs`, `v31-studio-timeline.cjs`, `v31-studio-workflows.cjs`
in Chromium, Firefox and WebKit), both in the release gate.

## What it does not do

Not built: browser fullscreen for Studio, deep links, a minimap, node groups, dragging
several clips at once, pinch zoom on the timeline, autosave and crash recovery. The
Playground's V2 Signal Path view is not drawn from the Studio graph; the compact widget is.
Studio is not a DAW or an audio-file editor, adds no second audio engine, and does not
replace the Playground or the Measure workspace; it orchestrates them.
