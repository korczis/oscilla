---
schema: moment/v1
id: conclusion-recorded-as-a-result
kind: moment
title: 'A conclusion recorded as if it were a measurement'
short_title: 'Opinion as result'
hook: 'wrote down what a comparison seemed to show, and later could not tell the note from the data'
summary: 'An interpretation is typed into one experiment''s notes, where it carries no status, points at nothing and reads like part of the result.'
status: stable
severity: medium
frequency: occasional
weight: 90
audiences: [researchers, audio-hobbyists, students]
areas: [reproducibility]
lifecycle: [operations, review]
tags: [findings, evidence, comparison, connected-records]
signals:
  - id: conclusion-in-notes
    text: 'A conclusion from comparing two measurements lived in the notes of one of them.'
  - id: evidence-gone
    text: 'A measurement a conclusion rested on had been deleted and nothing said so.'
  - id: what-depends-on-this
    text: 'You could not tell, from a saved measurement, which projects and conclusions depended on it.'
examples:
  - id: foam-pad
    audience: audio-hobbyists
    title: 'The foam pad lowers the top end'
    before: 'After comparing two measurements of a desk speaker, the conclusion is typed into the first experiment''s notes, tied to that one record, with no status.'
    after: 'A finding is stored apart from the experiments it cites, with a categorical status and typed references to the experiments, the comparison or a stored value, each with its result hash.'
  - id: deleted-evidence
    audience: researchers
    title: 'A cited experiment was deleted'
    before: 'A conclusion still reads as supported after one of its measurements was deleted.'
    after: 'A reference to a deleted experiment stays and reads missing; a finding never changes an experiment.'
  - id: connected-records
    audience: students
    title: 'What is this connected to?'
    before: 'A week later nobody can tell which Studio project produced an experiment or which findings cite it, except by guessing from names and times.'
    after: 'Connected records lists what an experiment, definition, finding or Studio project is connected to and what depends on it, each entry from one stored field it names.'
claims: [findings-linked-to-evidence, connected-records, semantic-run-comparison, measurement-comparison]
doctrines: [project.no-fake-science]
use_cases: [record-a-finding-linked-to-evidence, follow-an-experiment-to-what-it-is-connected-to, compare-two-responses]
related: [number-nobody-can-trace-or-repeat, saved-run-quietly-rewritten]
aliases: ['findings', 'interpretation versus measurement', 'lab notebook', 'hypothesis']
---

## The moment

Two measurements differ above some frequency, and the person concludes why. The conclusion is
written into the notes of one of them. Months later it reads like part of that measurement,
and nobody can tell which comparison it came from.

## Why it happens

Until findings existed, the only place for a conclusion was an experiment's annotation notes:
tied to one experiment, carrying no status and pointing at nothing
([ADR 0046](../../adrs/0046-findings-interpretation-linked-to-evidence.md)). Relationships
between records were left to names, recipes and times, which are guesses
([ADR 0048](../../adrs/0048-connected-records-over-stored-fields.md)).

## What it costs

An opinion presented as a result, which rule `project.no-fake-science` forbids in spirit, and
a body of work whose conclusions cannot be checked against what they rest on.

## What OSCILLA does

A measurement is what was observed, an observation is what the person recorded, and a finding
is an interpretation linked to evidence, with a status of hypothesis, supported, contradicted
or inconclusive and never a confidence number (claim `findings-linked-to-evidence`). Comparing
runs lists what changed by domain, with units (claim `semantic-run-comparison`). Connected
records are derived from stored fields only (claim `connected-records`).

## How to verify it

`npm test` runs the findings, comparison and connected-records unit tests.

## What it does not do

It does not judge whether a finding is right. The status is the person's; OSCILLA keeps it apart
from the measurement and tied to the evidence it names.
