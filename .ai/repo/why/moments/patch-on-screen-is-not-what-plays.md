---
schema: moment/v1
id: patch-on-screen-is-not-what-plays
kind: moment
title: 'The patch on screen is not the one that plays'
short_title: 'Screen versus sound'
hook: 'edited a patch and could not tell whether the sound you heard was the graph you were looking at'
summary: 'A second copy of the graph, an edit that was refused or not applied, or a runtime that kept an older configuration makes the screen show one topology while Web Audio runs another.'
status: stable
severity: medium
frequency: occasional
weight: 100
audiences: [sound-designers, maintainers, teachers]
areas: [signal-graph-integrity]
lifecycle: [implementation, operations]
tags: [studio, runtime, compiler, trace]
signals:
  - id: edit-not-heard
    text: 'You changed a parameter or a cable and could not tell whether the running sound took it.'
  - id: two-views-disagree
    text: 'The compact Studio widget and the full Studio showed different graphs.'
  - id: edit-clicks-or-restarts
    text: 'An edit during playback clicked or restarted every envelope.'
examples:
  - id: compact-and-full
    audience: sound-designers
    title: 'Edit in the widget, edit in the workspace'
    before: 'A compact copy and a full copy of the graph are kept in sync by hand, and drift.'
    after: 'One StudioModel owned by one store; the compact widget, graph editor, Inspector and timeline are projections of it.'
  - id: was-it-applied
    audience: maintainers
    title: 'Was the plan applied?'
    before: 'Divergence between store and runtime was detected by object identity, the compiled plan had no identity, and the runtime did not record what it had committed.'
    after: 'The plan has a hash, the runtime records what it applied, and the Inspector says running, not applied, a previous configuration still running, refused or failed, with diagnostic codes.'
  - id: live-demo-edit
    audience: teachers
    title: 'Changing the filter during a demonstration'
    before: 'Tearing down and rebuilding the whole graph on each edit clicks, restarts envelopes and loses phase in front of the class.'
    after: 'The graph is compiled into the existing engine and patched in place with crossfades, keeping the click ratio below a fixed threshold.'
claims: [studio-compiled-topology, studio-one-store-projections, studio-model-plain-data, studio-operation-trace, studio-click-free-live-edit, studio-registry-reuses-engine]
doctrines: [project.studio-model-is-canonical, project.typed-ports, project.audio-engine-discipline]
use_cases: [studio-build-a-signal-path, studio-edit-while-playing, studio-compact-full-sync, studio-undo-and-redo]
related: [patch-closes-a-feedback-loop, sound-keeps-running-after-stop]
aliases: ['runtime divergence', 'graph out of sync', 'not applied', 'Studio trace']
---

## The moment

A cable is moved and the sound does not change, or changes in a way the graph does not explain.
Is the edit waiting, refused, or applied to a graph that is no longer the one on screen?

## Why it happens

Two synchronized copies of a graph drift, and a model that holds runtime objects cannot be
diffed or undone (rule `project.studio-model-is-canonical`). Web Audio accepts nearly any
`connect()` call and fails silently when the topology is wrong (rule `project.typed-ports`).
And an audit as of v3.4.0 found the repository could not state, as data, whether the running
graph was the one in the store
([ADR 0039](../../adrs/0039-studio-runtime-truth-plan-identity-applied-record-divergence.md)).

## What it costs

A sound designer who stops trusting the editor and starts rebuilding patches from scratch; a
maintainer who cannot tell a compiler bug from a display bug.

## What OSCILLA does

The StudioModel is the one canonical state
([ADR 0030](../../adrs/0030-studio-model-canonical-separate-from-runtime.md)). It is compiled
into the existing audio engine and patched in place, never a second engine
([ADR 0035](../../adrs/0035-compiled-into-existing-engine-incremental-patching.md)). The
runtime records what it applied, and the Inspector's Runtime section says whether the graph on
screen is the one that plays. The Trace section follows each edit under one operation id from
the action through the compiled plan to each value the nodes report they were given
([ADR 0042](../../adrs/0042-studio-operation-trace-one-correlation-id-bounded-not-evidence.md)).

## How to verify it

`npm test` runs the Studio model, compiler and runtime unit tests; `npm run test:studio` runs
the compiler and runtime on the real engine and the Inspector's Runtime and Trace sections
(`tests/browser/v31-studio-runtime.cjs`).

## What it does not do

The trace is bounded, kept in memory for the session, covered by no hash and is not evidence of
what sounded: it shows what the nodes report they were given, not what came out of the
speaker.
