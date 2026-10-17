---
schema: audience/v1
id: sound-designers
kind: audience
title: Sound designers patching in the Studio
short_title: Sound designers
summary: 'Building and editing sound as a graph of oscillators, envelopes, filters and modulators, sequenced and automated on a timeline, while it plays.'
workflow: 'Build a chain from a template or the node library, connect modulation, edit while it plays, automate parameters on the timeline, save a project or a patch, and render a WAV.'
status: stable
weight: 40
tags: [studio, patching, synthesis]
---

# Sound designers patching in the Studio

## Who this is

Somebody who builds Oscillator, Envelope, Filter and Master Output in the Studio
(`studio-build-a-signal-path`), drags an LFO onto the cutoff (`studio-connect-modulation`),
inserts a Gain node while the patch plays (`studio-edit-while-playing`) and keeps the result as
a project or a reusable patch (`studio-save-and-load-a-patch`).

## How they work

Iteratively and by ear, many edits a minute, with sound running. They judge the patch by what
they hear and trust the graph on screen to be what they are hearing.

## What goes wrong

An edit that clicks or restarts every envelope. A cable that closes a feedback loop the
browser mutes or lets run away. A graph on screen that is not the graph that plays. A patch
from somebody else that silently overwrites their work.
