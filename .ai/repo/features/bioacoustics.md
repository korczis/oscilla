---
schema: feature/v1
id: bioacoustics
kind: feature
title: 'Compare hearing ranges and animal call bands'
short_title: 'Bioacoustics'
headline: 'Place a frequency against the hearing ranges and call bands of people and animals, from cited sources.'
summary: 'Hearing-range and call-example bars for humans and other species, each value taken from a cited publication with its criterion, shown with a disclaimer; choosing one sets the explorer range.'
status: stable
weight: 110
featured: false
rules: [project.no-fake-science]
docs: [README.md]
claims: [bioacoustics-cited]
related: [frequency-sweep]
tags: [content, v2]
---

## What it does

`src/js/data/bioacoustics.js` holds the data, every value with its source; `src/js/labs/bioacoustics.js`
draws it and hands a chosen range to the generator.

## What it does not do

It makes no claim about what an animal hears from your speakers, about inaudibility, or about
any effect of a frequency on an animal (rule `project.no-fake-science`).
