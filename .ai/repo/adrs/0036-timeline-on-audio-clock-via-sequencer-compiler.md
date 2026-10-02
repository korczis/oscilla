---
schema: adr/v1
id: adr-0036
kind: adr
title: The Studio timeline runs on the audio clock through the existing sequencer compiler, in absolute seconds
status: proposed
date: 2026-10-02
tags:
  - studio
  - audio
  - timeline
  - v31
related:
  - rule:project.audio-engine-discipline
  - claim:studio-timeline-model
  - claim:studio-transport-audio-clock
  - file:src/js/sequencer/compiler.js
  - file:src/js/studio/schema.js
  - test:tests/unit/v31-studio-model.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:docs/specs/oscilla-v3.1-studio.md
    - file:src/js/sequencer/compiler.js
    - issue:V402
---

# 36. The Studio timeline runs on the audio clock through the existing sequencer compiler, in absolute seconds

## Context

The V2 sequencer compiles a block model into a time-sorted event list applied as AudioParam
automation on the audio clock, with frame-quantised boundaries so live and offline renders
agree (ADR 0015, ADR 0004, `knowledge/curated/web-audio-scheduling-lateness.md`). V3.1 turns
it into a multi-track event and control timeline with transport, loop, markers and
measurement clips (specification §81-§96, §180-§186), and states that AudioContext time is
authoritative and the playhead observes the scheduler (§94). Musical time is optional and
must never infect measurement experiments (§90).

## Decision

Proposed:

- Model times are absolute seconds (`timeMode: 'seconds'` by default). Tempo-linked musical
  time is a conversion applied to clips that ask for it; a measurement clip is always
  absolute. Timeline scale and scroll are view state.
- Clips reuse the sequencer's block semantics: a pattern clip's payload is
  `{ blockType, params }` checked by the sequencer's own `normalizeBlock`; the sequencer
  compiler is extended to compile tracks and clips, not replaced. Existing sequence files
  map onto one event track (KEEP / REFACTOR / MIGRATE, issue V416).
- Transport, clips, loop boundaries and automation (ADR 0037) are scheduled ahead on
  AudioContext time; `requestAnimationFrame` and timers only draw the playhead and top up
  the schedule, never decide when audio happens. Pause exists only if it can resume
  sample-accurately; otherwise there is none.
- Measurement clips (noise check, pre-roll, stimulus, capture, tail, analysis) drive the V3
  measurement state machine rather than scheduling audio themselves (ADR 0038).

## Alternatives rejected

- A new Studio scheduler: discards the proven sequencer compiler and its frame
  quantisation, and needs its own click and lateness work.
- Timer- or rAF-driven clip starts: drift and stall under load, the failure ADR 0004
  removed.
- Musical time as the canonical unit: measurement timing would depend on a tempo field.

## Consequences

- Audio timing stays under rule `project.audio-engine-discipline` v2; no Studio rule
  restates it.
- Edits during playback (§183) are recompiled from the playhead forward and applied through
  the same transaction mechanism as graph edits (ADR 0035).
- Confirmation criteria: the timeline model is built and tested (absolute seconds, block
  payloads checked by the sequencer rules, references validated, exact undo). Not yet
  built: track compilation, transport, loop and playhead (issues V416-V418). Confirmed when
  the timeline test (specification §212) shows clip starts and loop boundaries at the
  scheduled AudioContext times within one render quantum, live and offline renders of one
  timeline agree, and stop and Escape leave zero nodes.
