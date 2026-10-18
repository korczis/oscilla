---
schema: moment/v1
id: bad-measurement-looks-like-a-good-one
kind: moment
title: 'A clipped or noisy measurement that looks as good as a clean one'
short_title: 'Untrustworthy curve'
hook: 'trusted a smooth response curve that came from a clipped, noisy or single run'
summary: 'A measured curve looks equally authoritative whether it was clipped, buried in room noise, captured with a dropout or measured once, so the person cannot tell how far to trust it.'
status: stable
severity: high
frequency: common
weight: 50
audiences: [audio-hobbyists, researchers, students]
areas: [measurement-trust]
lifecycle: [operations, review]
tags: [quality, clipping, noise, repeatability]
signals:
  - id: no-quality-statement
    text: 'A frequency response was used without anything saying whether the capture clipped or the noise was too high.'
  - id: one-run-only
    text: 'A conclusion rested on a single sweep, with no idea whether a second would agree.'
  - id: range-beyond-signal
    text: 'A curve was read at frequencies where the sweep had no energy or the signal was close to the background noise.'
examples:
  - id: clipped-sweep
    audience: audio-hobbyists
    title: 'Too loud a sweep'
    before: 'The input clips during the sweep and the curve is read anyway; it looks smooth.'
    after: 'Every measurement is rated GOOD, USABLE, POOR or INVALID by a versioned rule set from named metrics, with its reasons; severe clipping, an empty capture, or a dropout inside the sweep makes a run INVALID.'
  - id: repeatability
    audience: researchers
    title: 'Is it repeatable?'
    before: 'One run is taken as the response, and nobody knows whether the next run would agree.'
    after: 'Runs set to five produce one stored aggregate response, and repeatability is one of the named metrics the rating reasons about.'
  - id: noise-floor
    audience: students
    title: 'Reading the curve in the noise'
    before: 'The low end of the curve is read as the speaker''s bass, although the signal there was barely above the room noise.'
    after: 'The valid range ends where the sweep has no energy or the signal is less than 10 dB above the background noise; stretches outside it are drawn dashed and faded.'
claims: [measurement-quality, aggregate-primary-response, transfer-function, measurement-workbench]
doctrines: [project.no-fake-science]
use_cases: [measure-a-playback-capture-chain-response, repeat-a-measurement-five-times]
related: [room-curve-read-as-the-speaker, number-nobody-can-trace-or-repeat]
aliases: ['measurement confidence', 'clipped capture', 'signal to noise', 'quality rating']
---

## The moment

Two response curves are compared, and one shows a dip the other does not. The dip is a
clipped capture; the other curve was a single run in a noisy room. Both looked equally clean
on the screen.

## Why it happens

A chart draws whatever it is given with the same line. The things that decide whether a
measurement can be trusted, clipping, noise, dropouts, coverage, repeatability, calibration,
are not visible in the curve itself, and an unexplained score would be a claim of its own
([ADR 0025](../../adrs/0025-data-driven-quality-with-reasons.md)).

## What it costs

A wrong conclusion about a speaker, a room treatment or a microphone, and the time spent
chasing a feature of the measurement rather than of the system.

## What OSCILLA does

The setup check stops on a blocker before anything plays. Every result comes from captured PCM
through deterministic offline DSP, with the live analyser as feedback only
([ADR 0018](../../adrs/0018-measurement-from-captured-pcm-offline-dsp.md)). Every measurement
carries a rule-based status with its reasons, each with its value and unit, and a check that
was not made reads NOT MEASURED (claim `measurement-quality`). The transfer function shows the
range it can be trusted in (claim `transfer-function`).

## How to verify it

`npm test` runs the V3 quality, transfer and aggregation unit tests on synthetic systems with
known answers; `npm run test:measure` runs the measurement engine on real Web Audio over a
TEST CONTEXT digital loopback.

## What it does not do

A GOOD rating says the capture met the named criteria. It does not say the result describes the
speaker alone, and no automated test proves how a physical speaker, room or microphone
behaves.
