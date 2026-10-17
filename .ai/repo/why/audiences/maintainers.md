---
schema: audience/v1
id: maintainers
kind: audience
title: Maintainers and agents working on OSCILLA
short_title: Maintainers
summary: 'Changing the audio engine, the Studio, the measurement code or the release scripts of OSCILLA, often several workers at once, and shipping the result as one page.'
workflow: 'Small pull requests through the CI gate, a merge train to main, release:prepare and release:publish, and a Pages deployment verified against the committed file.'
status: stable
weight: 60
tags: [engineering, release, ci]
---

# Maintainers and agents working on OSCILLA

## Who this is

The owner and the AI workers who change `src/`, the tests, the scripts and the `.ai/` layer,
under the project rules (`.ai/repo/rules/project/`), and who publish `dist/index.html` to
GitHub Pages.

## How they work

Many small pull requests, several sessions on one machine, a release gate that runs the unit,
browser and visual suites, and a release flow whose receipt binds the tree the gate passed.

## What goes wrong

A leak or a click the engine's own counters cannot see. A Studio refactor that leaves two
copies of the graph. A release published on a tree whose tests the gate never ran, or a
deployed page whose bytes differ from the committed file.
