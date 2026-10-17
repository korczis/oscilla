---
schema: area/v1
id: delivery
kind: area
title: Release and delivery
summary: 'Whether the page a person opens, from disk or from GitHub Pages, is the released, gated bytes and runs without anything else.'
status: stable
weight: 60
tags: [release, single-file, provenance]
---

# Release and delivery

OSCILLA is one static file. This area covers what that promise needs: a page that loads
nothing at runtime and works from `file://` and the Pages sub-path (ADR 0011, ADR 0012), a
build that is deterministic and states which version and inputs produced it (ADR 0028), and a
release whose published bytes are the ones the gate passed (rules
`project.single-file-deliverable`, `project.release-receipt-binds-gate`,
`project.release-flow-complete`).

Not in this area: what an experiment record says about its own build, which is records and
reproducibility.
