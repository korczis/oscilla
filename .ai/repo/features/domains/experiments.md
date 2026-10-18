---
schema: domain/v1
id: experiments
kind: domain
title: Experiments
headline: 'Keep every measurement as an immutable, reproducible experiment, compare runs by what actually changed, and export a record a colleague can import and check.'
problem: 'A measurement result nobody can trace to the recipe, algorithm, calibration and build that produced it, or that was rewritten after it was saved.'
status: stable
weight: 40
tags: [experiments, provenance, comparison, v3]
---

# Experiments

The V3 Experiments workspace and its records: the experiment with its recipe kept apart from
its result (ADR 0019), persistence in the browser and export as a file (ADR 0022), the
immutable completed run (ADR 0040), comparison by domain (ADR 0041), definitions, evidence and
findings (ADR 0043, ADR 0044, ADR 0046) and connected records (ADR 0048).

Not in this domain: taking the measurement, which is measurement.
