---
schema: moment/v1
id: room-curve-read-as-the-speaker
kind: moment
title: 'A room measurement presented as the speaker''s response'
short_title: 'Chain read as a part'
hook: 'read a frequency response as the speaker''s when it was the speaker, room and microphone together'
summary: 'A sweep measures the whole playback and capture chain, and the result is quoted as the response of one part of it.'
status: stable
severity: medium
frequency: common
weight: 60
audiences: [audio-hobbyists, students, researchers]
areas: [measurement-trust, scientific-honesty]
lifecycle: [operations, review]
tags: [transfer-function, impulse-response, playback-chain]
signals:
  - id: speaker-response-from-a-room
    text: 'A curve measured in a room was described as the loudspeaker''s frequency response.'
  - id: peak-time-as-latency
    text: 'The time of the impulse response peak was read as a latency or a distance.'
  - id: phase-guessed
    text: 'A phase curve was shown although the alignment it depends on was not robust.'
examples:
  - id: desk-speaker
    audience: audio-hobbyists
    title: 'My speaker has a dip'
    before: 'A dip from a desk reflection is attributed to the loudspeaker and the speaker is blamed.'
    after: 'The result is labelled as the observed response of the whole chain; the guide says to change one part at a time and compare.'
  - id: time-of-flight
    audience: students
    title: 'Distance from the impulse peak'
    before: 'The peak time of the impulse response is converted to a distance between speaker and microphone.'
    after: 'Time is shown from the direct peak; the peak time includes unknown device and browser delays and is stated not to be a time of flight or a latency.'
  - id: phase-on-request
    audience: researchers
    title: 'Phase only when it is known'
    before: 'A phase curve is drawn for every measurement, including those whose alignment failed.'
    after: 'Phase is shown only when requested and when the alignment is robust; otherwise it is absent, not guessed.'
claims: [transfer-function, impulse-response, measurement-workbench]
doctrines: [project.no-fake-science]
use_cases: [measure-a-playback-capture-chain-response, measure-an-impulse-response, compare-two-responses]
related: [bad-measurement-looks-like-a-good-one, spl-without-a-calibration]
aliases: ['speaker response', 'room response', 'latency from impulse response', 'whole chain']
---

## The moment

A home measurement shows a peak and a dip, and the conclusion is about the loudspeaker. The
same sweep also went through the operating system, the amplifier, the room, the microphone
position, the microphone and the browser's input path.

## Why it happens

The measurement has one input and one output, so it is natural to name it after the part one
cares about. Nothing in a browser can separate the parts of the chain: the room, the position
and the microphone are in every result (`docs/v3/measurement-guide.md`, "What you are
measuring").

## What it costs

A speaker replaced, a room treated or a microphone blamed for something another part of the
chain did.

## What OSCILLA does

The Measure workspace calls the result the response of the playback and capture chain, keeps
the raw curve beside every derived view, and labels every derived view. The impulse response
shows time from the direct peak and keeps the absolute offset; windows and normalised views are
derived objects, so the stored response never changes (claims `transfer-function`,
`impulse-response`; [ADR 0021](../../adrs/0021-sweep-deconvolution-method.md)). Comparing two
saved experiments shows what differed between them, so one change can be isolated.

## How to verify it

`npm test` runs the transfer and impulse-response tests on synthetic systems with known
answers (`tests/unit/v3-*.test.mjs`).

## What it does not do

It does not remove the room or the microphone from the result, and it cannot: OSCILLA cannot
separate the parts of the chain, only compare one change at a time, and a microphone
correction profile corrects only the microphone, only inside its range.
