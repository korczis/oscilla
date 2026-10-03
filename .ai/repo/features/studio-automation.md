---
schema: feature/v1
id: studio-automation
kind: feature
title: 'Automate parameters over time, separately from modulation'
short_title: 'Automation'
headline: 'Planned: draw how a parameter moves over the timeline, while modulation from other nodes adds on top.'
summary: 'Automation lanes of step, linear and exponential points on automatable parameters, compiled to AudioParam schedules on the audio clock; modulation stays a control edge with its own depth.'
status: draft
weight: 430
featured: false
rules: [project.audio-engine-discipline, project.studio-model-is-canonical]
docs: [docs/v31/studio-model.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0037, adr-0036]
claims: [studio-automation-model, studio-typed-connections, studio-transport-audio-clock]
use_cases: [studio-automate-a-parameter, studio-connect-modulation]
related: [studio-timeline, studio-signal-graph]
tags: [planned, v31, studio, automation]
---

## What it does

Automation is the authored base value of a parameter over time; modulation is continuous
control from another node; the actual value is the base plus the modulations within the
parameter's bounds (specification §97-§104, ADR 0037). Lanes accept only parameters the
registry marks automatable, keep points sorted, and refuse exponential ramps through zero;
modulation edges carry depth, polarity, mapping and offset.

Guaranteed now, by `tests/unit/v31-studio-model.test.mjs`: the automation model and the
modulation edge properties.

## What it does not do

The automation compiler (issue V419) and editor (V420) are not built; claim
`studio-transport-audio-clock` is `planned`. Automation never simulates modulation and
modulation never rewrites automation.
