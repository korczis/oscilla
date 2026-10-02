---
schema: feature/v1
id: export
kind: feature
title: 'Export WAV audio, PNG screenshots and configuration files'
short_title: 'Export'
headline: 'Take what you made with you: the sound as a WAV file, the view as an image, the setup as a file you can import again.'
summary: 'WAV export rendered offline through the same engine as live playback, PNG screenshots of the canvases, and a JSON configuration file that imports back through the validated path.'
status: stable
weight: 130
featured: false
rules: [project.single-file-deliverable]
docs: [README.md]
adrs: [adr-0015, adr-0023]
claims: [wav-export-valid, config-file-round-trip]
use_cases: [export-a-wav-file, round-trip-a-configuration]
related: [presets-and-links, pattern-sequencer]
tags: [export, v2]
---

## What it does

`src/js/ui/exporters.js` renders the current plan on an OfflineAudioContext through a second
engine with the same play options, so the file is what the instrument plays, and encodes it
with `src/js/audio/wav.js`. `src/js/ui/config-file.js` builds and validates the configuration
document. Everything happens in the page.

## What it does not do

PNG screenshot export is implemented and has no claim or test of its own yet. Nothing is
uploaded anywhere.
