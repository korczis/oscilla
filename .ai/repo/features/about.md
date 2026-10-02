---
schema: feature/v1
id: about
kind: feature
title: 'An About workspace in which OSCILLA explains itself'
short_title: 'About'
headline: 'What OSCILLA is, how it was built in one night, and the discipline that kept it from being a throwaway.'
summary: 'The last navigation item opens a full-width view: origin, a commit-timestamped evolution strip, engineering constraints, the AI-assisted method, the role of Majordomus, author, source and links.'
status: stable
weight: 150
featured: false
rules: [project.no-fake-science, project.single-file-deliverable]
docs: [README.md]
claims: [about-is-last-workspace, about-provenance-matches-git]
use_cases: [read-about-oscilla]
related: [offline-single-file-app]
tags: [about, provenance, v2]
---

## What it does

`#osc-view-about` is a workspace like Learn and Presets: `navItem('about')` selects it, the
document title becomes `OSCILLA · About`, and the overflow-menu "About OSCILLA" entry opens
it (the modal About dialog it replaces is gone). The copy is static, semantic HTML; the hero
trace is decorative, drawn once and skipped under reduced motion. Development speed is stated
only as commit timestamps, which `tests/unit/about.test.mjs` checks against git.

## What it does not do

It does not show the deployed commit, build digest or channel: that is build provenance,
peer issue R003. Measure (V3) is shown as in development and Studio as planned, not shipped.
