---
schema: domain/v1
id: studio
kind: domain
title: Studio
headline: 'Build sound and measurement as a graph of typed nodes with a timeline and automation, edit it while it plays, and hear exactly the graph on screen.'
problem: 'A patching workspace whose screen shows one graph while the audio engine runs another, and whose cables can close loops nobody is told about.'
status: stable
weight: 50
tags: [studio, graph, timeline, v31]
---

# Studio

The V3.1 Studio: the canonical StudioModel and its actions (ADR 0030, ADR 0031), typed ports
and cycle rejection (ADR 0032, ADR 0033), compilation into the existing engine with incremental
patching (ADR 0035), the timeline on the audio clock and automation (ADR 0036, ADR 0037),
projects and patches, and the measurement topology that hands a sweep to the Measure engine
(ADR 0038). Its rules are `project.studio-model-is-canonical`, `project.typed-ports` and
`project.no-silent-feedback`.

Not in this domain: the measurement engine Studio hands its measurement clips to, which is
measurement.
