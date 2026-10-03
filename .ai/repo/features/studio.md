---
schema: feature/v1
id: studio
kind: feature
title: 'Program sound and measurement as an editable signal graph with a timeline'
short_title: 'Studio'
headline: 'Planned: build sound and measurement graphs, sequence and automate them, and keep the whole setup as reproducible state.'
summary: 'Planned for V3.1 (milestones M021-M033): one canonical StudioModel projected into a compact widget and a full workspace, edited through an undoable action layer and compiled into the existing audio and measurement engines.'
status: draft
weight: 400
featured: false
rules: [project.studio-model-is-canonical, project.visual-identity-lock, project.single-file-deliverable]
docs: [docs/specs/oscilla-v3.1-studio.md, docs/v31/studio-model.md]
adrs: [adr-0030, adr-0031, adr-0034]
claims: [studio-model-plain-data, studio-exact-undo-redo, studio-one-store-projections, studio-non-drag-operation, studio-file-protocol]
use_cases: [studio-compact-full-sync, studio-undo-and-redo, studio-copy-and-paste-a-subgraph, studio-operate-without-dragging, studio-open-from-file]
related: [studio-signal-graph, studio-timeline, studio-automation, studio-patches, studio-measurement-routing]
tags: [planned, v31, studio]
---

## What it does

OSCILLA Studio turns the passive Signal Path into an editable, executable model (V3.1
specification §0-§2): a signal graph, a multi-track timeline, automation and measurement
routing, all held in one canonical StudioModel (ADR 0030) that every view projects and that
changes only through dispatched, undoable actions (ADR 0031). The editor is OSCILLA's own
HTML nodes over SVG cables, in the locked visual identity, inside the single
`dist/index.html` (ADR 0034).

Built on `feature/v31-studio`: the model core in `src/js/studio/` (schema, ports, node
registry with the 25-type library, validation, actions, history, migrations), described in
`docs/v31/studio-model.md` and proven by `tests/unit/v31-studio-model.test.mjs`. The claims
`studio-model-plain-data` and `studio-exact-undo-redo` are guaranteed by that test.

## What it does not do

Nothing of Studio is in the shipped product yet: no editor, compact widget, full workspace,
compiler or timeline playback exists, so the feature is `draft` and its user-facing claims
are `planned`. Studio is not a DAW or an audio-file editor, adds no second audio engine, and
does not replace the Playground or the Measure workspace; it orchestrates them.
