---
schema: moment/v1
id: sound-keeps-running-after-stop
kind: moment
title: 'A sound that keeps running after Stop'
short_title: 'Sound after Stop'
hook: 'pressed Stop and something kept playing, or kept the microphone open'
summary: 'An oscillator, a scheduled source or an input track outlives the action that should have ended it, and nothing on the page knows it is there.'
status: stable
severity: medium
frequency: occasional
weight: 20
audiences: [teachers, sound-designers, audio-hobbyists, maintainers]
areas: [playback-safety]
lifecycle: [operations, maintenance]
tags: [leaks, stop, abort, audio-nodes]
signals:
  - id: tone-after-mode-switch
    text: 'A tone kept sounding after you switched to another mode or pattern.'
  - id: microphone-still-open
    text: 'The browser still showed the microphone in use after a measurement ended or was aborted.'
  - id: counters-say-zero
    text: 'A test said zero nodes were left while something was still audible.'
examples:
  - id: latched-tone
    audience: teachers
    title: 'A latched tone after switching to DUAL'
    before: 'A latched 440 Hz tone keeps sounding after switching to the dual oscillator, because the live update for a different plan type returned false and the caller ignored it.'
    after: 'A change the running voice cannot take is applied by the engine, and Stop and Escape cut every voice, including those already in their release.'
  - id: aborted-measurement
    audience: audio-hobbyists
    title: 'Escape in the middle of a sweep'
    before: 'A measurement aborted halfway leaves the capture worklet, the stimulus source or the input track running.'
    after: 'Aborting in any stage, by Escape, STOP, hiding the page or leaving the workspace, ends the measurement ABORTED with no node, source, capture, worklet port or input track left.'
  - id: invisible-leak
    audience: maintainers
    title: 'A leak the engine cannot count'
    before: 'The smoke test asserted on the engine''s own node counter, which cannot see a node the engine does not know about.'
    after: 'The browser gate counts live oscillators independently of the engine, on an output tap, after every way playback can end.'
  - id: studio-stop
    audience: sound-designers
    title: 'Stop after editing a live patch'
    before: 'Nodes inserted and removed while a patch played are left connected after Stop.'
    after: 'Editing while playing patches the running graph in transactions and leaves no node, source or connection behind after stop.'
claims: [tone-plays-and-releases, measurement-abort-releases-everything, microphone-analysis-only, studio-click-free-live-edit]
doctrines: [project.audio-engine-discipline]
use_cases: [play-a-440-hz-tone, measure-a-playback-capture-chain-response, analyse-the-microphone, studio-edit-while-playing]
related: [test-tone-blasts-or-clicks]
aliases: ['leaked oscillator', 'microphone left on', 'stop does not stop']
---

## The moment

Stop was pressed. The tone is still there, faintly, or the browser's microphone indicator is
still on after the measurement was aborted, or a test passes while something is still
audible.

## Why it happens

A Web Audio node runs until it is stopped and disconnected, and nothing collects it because
the page lost its reference. A live change that the running voice could not take was ignored
rather than applied ([ADR 0003](../../adrs/0003-live-configuration-changes.md)). And the
engine's own counters cannot reveal a node the engine does not know about
([ADR 0006](../../adrs/0006-engine-verification-on-an-output-tap.md)).

## What it costs

A demonstration that cannot be ended cleanly; a microphone that stays open after the person
thought it was closed; and for maintainers, a test suite that reports success while the leak
it was written to catch is still there.

## What OSCILLA does

`stop()` ramps down, cancels future automation, stops and disconnects every node and clears
references; PLAY, STOP, PLAY works indefinitely (rule `project.audio-engine-discipline`).
Verification counts oscillators on an output tap rather than trusting the engine
([ADR 0006](../../adrs/0006-engine-verification-on-an-output-tap.md)). A measurement abort
releases everything in every stage, and stopping the microphone ends every track.

## How to verify it

`npm run test:engine` (`tests/browser/engine-v1port.cjs`) counts live oscillators after stop,
Escape, safety limit, natural end and mode switch; `npm run test:measure` checks zero nodes
after finish and abort; `npm run test:studio` checks the live-edit transactions (claims
`tone-plays-and-releases`, `measurement-abort-releases-everything`,
`studio-click-free-live-edit`).

## What it does not do

It cannot stop sound the operating system or another tab is making, and it does not prove how
a particular browser releases its audio device after the page has let go of it.
