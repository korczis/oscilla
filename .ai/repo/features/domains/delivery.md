---
schema: domain/v1
id: delivery
kind: domain
title: Delivery
headline: 'Open one self-contained file, offline or on GitHub Pages, that says which release and build it is and how it was made.'
problem: 'A lab page that needs a network or a server it does not have, and a published page nobody can tie to the commit and gate it came from.'
status: stable
weight: 60
tags: [single-file, release, provenance, about]
---

# Delivery

How OSCILLA reaches a person: one deterministic `dist/index.html` that loads nothing at
runtime and runs from `file://` and the `/oscilla/` sub-path (ADR 0011, ADR 0012, rule
`project.single-file-deliverable`), its build provenance (ADR 0028), and the About workspace
that names the current release and the commit times of its history (rule
`project.about-names-current-release`).

Not in this domain: the files a person exports from the page, which belong to the domain of
what they exported.
