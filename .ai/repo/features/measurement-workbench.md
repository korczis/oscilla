---
schema: feature/v1
id: measurement-workbench
kind: feature
title: 'Run acoustic measurements in a dedicated Measure workspace'
short_title: 'Measure workspace'
headline: 'Planned: a guided workspace that takes a measurement from preflight to a stored, comparable result.'
summary: 'Planned for V3 (milestones M012 and M019): a Measure workspace beside the Playground with guided and expert modes, preflight, a live quality bar and safe abort.'
status: draft
weight: 300
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0018, adr-0026]
claims: [measurement-workbench]
related: [transfer-function, measurement-quality]
tags: [planned, v3, measurement]
---

## What it does

Specified in the V3 MEASURE specification (sections 12 to 14 and 72 to 74): stimulus,
capture, offline analysis and result layers behind an explicit measurement state machine,
results computed from captured PCM (ADR 0018), on the native graph and main thread unless a
recorded spike justifies AudioWorklet or a Worker (ADR 0026).

## What it does not do

Nothing of it is on main. Its claim is `planned`, with no implementation and no test.
