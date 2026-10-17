---
schema: area/v1
id: measurement-trust
kind: area
title: Measurement trust
summary: 'Whether a measured curve can be trusted, how far, and what it is actually a curve of.'
status: stable
weight: 30
tags: [measurement, quality, transfer-function]
---

# Measurement trust

A clipped sweep, a capture with a dropout and a clean repeated measurement can all draw a
smooth curve. This area covers what the Measure workspace says about a result before anyone
relies on it: a quality status with its reasons, a valid range, a repeatability figure, and a
plain statement that the result is the response of the whole playback and capture chain
(ADR 0018, ADR 0021, ADR 0025).

Not in this area: what a stored record keeps so that the result can be repeated later, which
is records and reproducibility.
