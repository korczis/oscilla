---
schema: feature/v1
id: rta
kind: feature
title: 'Watch a real-time analyzer in FFT, octave and third-octave bands'
short_title: 'RTA'
headline: 'Planned: a real-time analyzer with band power, averaging, peak hold and freeze.'
summary: 'Planned for V3 (milestone M016): FFT, octave and third-octave RTA with power-integrated bands and documented instant, fast and slow averaging.'
status: draft
weight: 340
featured: false
rules: [project.no-fake-science]
docs: [docs/specs/oscilla-v3-measure.md]
adrs: [adr-0017, adr-0018]
claims: [rta-bands]
related: [measurement-workbench]
tags: [planned, v3, measurement]
---

## What it does

Specified in sections 44 to 49: band power is integrated, the averaging constants are
documented, and no IEC conformance is claimed.

## What it does not do

Nothing of it is on main; the V2 spectrum is the live feedback view of the live-analysis
feature.
