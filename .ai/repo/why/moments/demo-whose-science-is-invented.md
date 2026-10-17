---
schema: moment/v1
id: demo-whose-science-is-invented
kind: moment
title: 'A demo whose science is invented'
short_title: 'Invented science'
hook: 'found a claim about what a frequency does that no source supports'
summary: 'Sound pages attract claims of healing frequencies, animal repellents, safe or inaudible tones and certification, and a single one of them discredits every honest number beside it.'
status: stable
severity: high
frequency: common
weight: 40
featured: true
audiences: [teachers, students, researchers]
areas: [scientific-honesty]
lifecycle: [implementation, review, operations]
tags: [no-fake-science, bioacoustics, citations]
signals:
  - id: effect-claim
    text: 'A page told you what a frequency does to your body, your mind, your sleep or an animal.'
  - id: range-without-source
    text: 'A hearing range was given with no publication and no threshold criterion.'
  - id: ultrasound-at-15-khz
    text: 'A high audible tone was called ultrasound, or a tone was called inaudible or safe.'
examples:
  - id: dog-whistle-lesson
    audience: teachers
    title: 'Could a dog hear it?'
    before: 'A lesson quotes a hearing range for dogs from an unnamed web page, with no level criterion, and adds that the tone keeps dogs away.'
    after: 'Every hearing range and call band comes from a cited publication, carries its criterion, and is shown with the disclaimer that ranges vary by source and individual; nothing says what a frequency does to an animal.'
  - id: healing-frequency
    audience: students
    title: 'A healing frequency preset'
    before: 'A preset is described as relaxing or as improving focus, and the description is taken as a property of the frequency.'
    after: 'No shipped text claims a medical, wellness, cognitive or pseudoscientific effect; binaural content describes the perceptual phenomenon only.'
  - id: certified-meter
    audience: researchers
    title: 'Band levels quoted as a class of standard'
    before: 'Third-octave bands are presented as if they met a filter class of a measurement standard.'
    after: 'No IEC 61260-1 filter class is claimed, band levels are labelled experimental and educational estimates, and the page says it is not audiometry and not an IEC 61672 sound level meter.'
claims: [no-fake-science-in-shipped-copy, bioacoustics-cited, rta-bands]
doctrines: [project.no-fake-science]
use_cases: [compare-a-frequency-with-animal-hearing, sweep-20-hz-to-20-khz]
related: [spl-without-a-calibration]
aliases: ['pseudoscience', 'healing frequencies', 'animal repellent tone', 'ultrasound claim']
---

## The moment

A sound demo is shared because it is impressive, and somebody notices a sentence in it: a
frequency that heals, a tone that repels mosquitoes, a 15.5 kHz signal called ultrasound. From
then on nobody trusts the spectrum beside it either.

## Why it happens

Copy is written faster than it is checked, and the claims are the ones readers expect to see.
A digital frequency also feels like a physical fact: generating 25 kHz does not mean a speaker
reproduces it, and a hearing range means little without the level its limits were taken at.

## What it costs

The credibility of everything else on the page, and for a teacher, a lesson that taught a
falsehood with the authority of an instrument.

## What OSCILLA does

Rule `project.no-fake-science` lists the forbidden claims and the preferred wording (requested
digital frequency, relative signal level, speaker output unknown, UNCALIBRATED / CALIBRATED).
A unit test scans every text the page and its modules can show (claim
`no-fake-science-in-shipped-copy`). The bioacoustics data cites a full source for every value
and states each range's criterion (claim `bioacoustics-cited`).

## How to verify it

`npm test` runs `tests/unit/no-fake-science.test.mjs` and `tests/unit/bioacoustics.test.mjs`.

## What it does not do

The tests prove that every value cites a source and that no forbidden claim is shipped. Whether
each value is the one its source gives is reviewed against the sources, not tested.
