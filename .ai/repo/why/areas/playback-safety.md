---
schema: area/v1
id: playback-safety
kind: area
title: Playback safety
summary: 'What reaches the speakers and the ears: the output level, clicks at a start or a stop, and sound that keeps running after Stop.'
status: stable
weight: 10
tags: [safety, audio-engine, playback]
---

# Playback safety

A browser can drive a speaker or a pair of headphones with no idea how loud the result is.
This area covers what the audio engine owes the person in front of it: an output ceiling that
holds however many voices are started, tones that start and stop without a step, a hard limit
on open-ended signals unless continuous playback is allowed for the session, and silence once
Stop, Escape or a measurement abort has been pressed (rule `project.audio-engine-discipline`,
ADR 0002, ADR 0003, ADR 0005).

Not in this area: whether a level is labelled correctly, which is scientific honesty; and what
a measurement sweep records, which is measurement trust.
