---
schema: moment/v1
id: test-tone-blasts-or-clicks
kind: moment
title: 'A test tone that blasts or clicks the speakers'
short_title: 'Blasting test tone'
hook: 'pressed play on a test tone and got a click, or a level far above what the gain control said'
summary: 'Overlapping voices, hard gain switches and open-ended signals reach the speaker at a level and with steps nobody chose.'
status: stable
severity: high
frequency: occasional
weight: 10
featured: true
audiences: [teachers, students, audio-hobbyists, sound-designers]
areas: [playback-safety]
lifecycle: [operations]
tags: [safety, gain, clicks, output-ceiling]
signals:
  - id: louder-than-the-control
    text: 'A tone came out much louder than the gain control said after several quick presses of play.'
  - id: click-at-start-or-stop
    text: 'You heard a click when a tone started, stopped or changed waveform.'
  - id: tone-ran-past-the-limit
    text: 'A finite or held tone played longer than the safety limit you set.'
examples:
  - id: lecture-room-speakers
    audience: teachers
    title: 'Twenty presses of HOLD in front of a class'
    before: 'Every press starts a voice while the earlier ones are still releasing; twenty presses with a long release sum to far above the documented output cap through the room speakers.'
    after: 'Every new voice fades the earlier ones out first, so voices never overlap, and a waveshaper ceiling after the trim stage bounds anything that still sums above the cap.'
  - id: headphones-on-a-sweep
    audience: students
    title: 'A finite tone on headphones'
    before: 'A finite tone of ten seconds plays for ten seconds whatever the safety limit says, and switching continuous playback off leaves a latched tone running.'
    after: 'Open patterns and the finite tone stop at the limit on the audio clock unless continuous playback is allowed for the session, and revoking the permission fades every voice it lengthened.'
  - id: waveform-switch
    audience: sound-designers
    title: 'Changing the waveform while it plays'
    before: 'Assigning the oscillator type directly makes a one-sample step many times the sine slope: an audible click on every change.'
    after: 'Live changes go through the engine, which never hard-switches gain from nonzero to zero and holds the current value before a release; the browser gate measures the largest one-sample step at release.'
claims: [tone-plays-and-releases, patterns-match-v1, sequencer-safe-automation, adsr-envelope-semantics]
doctrines: [project.audio-engine-discipline, project.no-fake-science]
use_cases: [play-a-440-hz-tone, sweep-20-hz-to-20-khz, play-a-sequence]
related: [sound-keeps-running-after-stop, patch-closes-a-feedback-loop]
aliases: ['speaker blast', 'click on stop', 'output too loud', 'safety limit ignored']
---

## The moment

A reference tone is supposed to be a quiet, steady 440 Hz. Instead it starts with a click, or
several quick presses of play stack voices until the room speakers are much louder than the
control says, or a tone set to stop keeps going.

## Why it happens

Web Audio does exactly what it is told. A voice that is still in its release is still
sounding, so starting a new one adds to it: the case behind ADR 0002 was twenty HOLD presses
100 ms apart with a 3000 ms release, measured at 2.7 times the output cap. Setting a gain or a
waveform directly is a step in the signal, which a speaker reproduces as a click (ADR 0003).
And an open-ended signal has no end unless something schedules one (ADR 0005).

## What it costs

At best a startled class and a lost demonstration. At worst a level on headphones or a small
speaker that nobody chose, which is why the README asks to start quietly and the measurement
guide says not to wear headphones during a loudspeaker sweep.

## What OSCILLA does

The engine owns every node and every scheduled source (rule `project.audio-engine-discipline`).
A new voice fades every earlier one out first, and a waveshaper ceiling backs up the output cap
([ADR 0002](../../adrs/0002-voice-replacement-and-output-ceiling.md)). Live changes are
scheduled on the audio clock rather than assigned
([ADR 0003](../../adrs/0003-live-configuration-changes.md)). A hard safety limit caps open
signals and the finite tone, and continuous playback is opt-in per session and never stored
([ADR 0005](../../adrs/0005-safety-limit-scope.md), rule `project.no-fake-science`). The
sequencer compiles to automation whose gain never reaches zero and whose frequencies stay
inside 20 Hz and the safe maximum (claim `sequencer-safe-automation`).

## How to verify it

`npm test` runs the V1 freeze suite and the sequencer and ADSR tests; `npm run test:engine`
counts live oscillators independently after stop, Escape, safety limit, natural end and mode
switch, and measures the largest one-sample step at release (claims `tone-plays-and-releases`,
`patterns-match-v1`).

## What it does not do

It does not know how loud the speaker is. The cap is a digital level: a small speaker driven
at that level below about 50 Hz can still be overloaded before anything is heard, and
loudness is a poor guide at very low and very high frequencies.
