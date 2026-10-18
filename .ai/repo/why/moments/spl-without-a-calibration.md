---
schema: moment/v1
id: spl-without-a-calibration
kind: moment
title: 'A chart that claims SPL without a calibration'
short_title: 'Uncalibrated SPL'
hook: 'read a level as dB SPL from a page that could not know the sound pressure'
summary: 'A browser knows sample values, not sound pressure, so a level labelled dB SPL without an external reference is a number dressed as a measurement.'
status: stable
severity: high
frequency: common
weight: 30
featured: true
audiences: [audio-hobbyists, students, researchers]
areas: [scientific-honesty, measurement-trust]
lifecycle: [operations]
tags: [spl, calibration, units, dbfs]
signals:
  - id: spl-on-a-laptop-mic
    text: 'A level read through a laptop microphone was quoted as dB SPL.'
  - id: profile-as-level
    text: 'A microphone correction file was taken to make the levels absolute.'
  - id: calibration-from-another-input
    text: 'A calibration taken with one microphone was still applied after the input changed.'
examples:
  - id: room-noise-in-spl
    audience: audio-hobbyists
    title: 'Background noise in dB SPL'
    before: 'The band levels of the room noise are read as sound pressure, although nothing on the page knows the microphone, its gain or the browser''s input processing.'
    after: 'Every level is dB relative (dBFS-like) and marked UNCALIBRATED; dB SPL appears only while a valid level calibration with an external reference applies to it, with a CALIBRATED indicator.'
  - id: correction-file
    audience: researchers
    title: 'A correction file is not a calibration of level'
    before: 'Importing the manufacturer''s frequency-response file is assumed to make the readings absolute.'
    after: 'A frequency profile changes a response''s shape, never its scale, applies only between its first and last frequency, and never makes a level SPL.'
  - id: analyser-reading
    audience: students
    title: 'Minus 13.56 dB from a full-scale sine'
    before: 'The analyser reads about -13.56 dB for a full-scale sine and the number is taken for a level.'
    after: 'The spectrum reads a bin-centred full-scale sine at 0 dB relative to full scale, and the page says relative, not SPL.'
  - id: swapped-microphone
    audience: audio-hobbyists
    title: 'Another microphone, the same offset'
    before: 'A calibration taken with the measurement microphone keeps applying after the laptop microphone is selected.'
    after: 'A level calibration is bound to the input it was taken with and stops applying when the input changes; until an input is checked the indicator reads PENDING INPUT CHECK.'
claims: [spl-only-with-level-calibration, level-calibration-bound-to-input, calibration-profiles, spectrum-peak-accuracy, no-fake-science-in-shipped-copy]
doctrines: [project.no-fake-science]
use_cases: [calibrate-a-microphone-frequency-response, run-a-third-octave-rta, analyse-the-microphone]
related: [demo-whose-science-is-invented, room-curve-read-as-the-speaker]
aliases: ['fake dB SPL', 'uncalibrated microphone', 'dBFS versus SPL', 'sound level meter']
---

## The moment

A bar chart of room noise shows a level in dB. Somebody writes it down as dB SPL, compares it
with a limit they know, and draws a conclusion. The number came from a laptop microphone with
unknown gain and browser input processing.

## Why it happens

A browser knows digital sample values. Output gain, speaker, room, microphone, ADC and input
processing are all unknown, and an analyser reading is dB of a windowed FFT, so a full-scale
sine reads about -13.56 dB: a number that looks like a level and is neither SPL nor dBFS
([ADR 0017](../../adrs/0017-relative-levels-spl-only-when-calibrated.md)). A microphone
correction file changes the shape of a response and is easily mistaken for a change of
scale ([ADR 0020](../../adrs/0020-calibration-semantics.md)).

## What it costs

A wrong decision that outlives the measurement: a noise complaint, a speaker judged too quiet,
a hearing-related conclusion, all resting on a level nobody measured.

## What OSCILLA does

Levels are relative to digital full scale and say so. dB SPL appears only under a valid
absolute level calibration that the person supplies from an external reference, bound to the
input it was taken with (claims `spl-only-with-level-calibration`,
`level-calibration-bound-to-input`). A frequency profile and a level calibration are separate
kinds that are never mixed (claim `calibration-profiles`). Rule `project.no-fake-science`
forbids an SPL label anywhere else.

## How to verify it

`npm test` runs the calibration, view and no-fake-science unit tests; `npm run test:measure`
(`tests/browser/v3-ui.cjs`) checks that no "SPL" appears without a level calibration.

## What it does not do

It does not calibrate anything for you: there is no default calibration, a level calibration
is valid only for the microphone, gain, browser settings and position it was taken with, and
OSCILLA is not an IEC 61672 sound level meter.
