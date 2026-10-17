---
schema: area/v1
id: scientific-honesty
kind: area
title: Units and scientific honesty
summary: 'What a number, a label or a sentence on the page claims to be, and whether the product can know it.'
status: stable
weight: 20
tags: [units, calibration, no-fake-science]
---

# Units and scientific honesty

A browser knows sample values, not sound pressure, and it does not know the speaker, the room
or the microphone. This area covers every place where the page could claim more than that: a
level labelled dB SPL without a level calibration, a frequency profile treated as a level, a
hearing range without its source and criterion, an effect of a frequency on a person or an
animal (rule `project.no-fake-science`, ADR 0017, ADR 0020).

Not in this area: whether one particular measurement is good enough to use, which is
measurement trust.
