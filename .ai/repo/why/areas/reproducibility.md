---
schema: area/v1
id: reproducibility
kind: area
title: Records and reproducibility
summary: 'What a saved experiment keeps, whether it can be changed afterwards, and how a conclusion stays tied to the evidence it rests on.'
status: stable
weight: 40
tags: [experiments, provenance, findings]
---

# Records and reproducibility

A measurement is only as useful as the record it leaves. This area covers the experiment
record and what is built on it: the recipe kept apart from the result (ADR 0019), the
algorithm that produced each value (ADR 0024), the definition a run was executed from
(ADR 0043), the lineage and reproducibility checklist of a stored value (ADR 0044), a
completed run that cannot be rewritten (ADR 0040), and a finding kept apart from the
measurements it interprets (ADR 0046, ADR 0048).

Not in this area: whether the measurement was good in the first place, which is measurement
trust; and which build of OSCILLA produced it, which is release and delivery.
