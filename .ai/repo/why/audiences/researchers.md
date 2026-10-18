---
schema: audience/v1
id: researchers
kind: audience
title: Experimenters who need a record others can check
short_title: Experimenters
summary: 'Running acoustic measurements whose results have to be repeated, compared and handed to a colleague, with the conclusion kept apart from the data.'
workflow: 'Define a measurement, run it several times, save each run as an experiment, compare runs, record a finding that cites the comparison, and export the record for somebody else to import.'
status: stable
weight: 50
tags: [experiments, provenance, reproducibility]
---

# Experimenters who need a record others can check

## Who this is

Somebody who repeats a measurement five times to see whether it is repeatable
(`repeat-a-measurement-five-times`), sends an experiment to a colleague as a file
(`export-an-experiment`), and a week later needs to know what a saved experiment is connected
to (`follow-an-experiment-to-what-it-is-connected-to`).

## How they work

Over days rather than minutes. Several runs, several setups, a conclusion drawn from the
difference between them, and a colleague who was not there and has only the exported file.

## What goes wrong

A number nobody can trace to the recipe, algorithm, calibration and build that produced it.
A saved run that was edited after the fact. A conclusion typed into a note where it reads like
a result and points at nothing.
