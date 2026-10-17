---
schema: domain/v1
id: laboratory
kind: domain
title: Laboratory
headline: 'See what is playing and what the microphone picks up, as waveform, spectrum, spectrogram, phase and stereo views, and place a frequency against cited human and animal hearing ranges.'
problem: 'Live sound views that present relative readings as levels, and hearing facts that cite nothing.'
status: stable
weight: 20
tags: [analysis, microphone, bioacoustics, v2]
---

# Laboratory

The V2 views of a signal while it plays: the live analysis, the microphone analyzer and
generator-versus-microphone comparison, phase, Lissajous and stereo correlation, and the
bioacoustics panel. Every level here is relative and uncalibrated, and every hearing range
cites its source (rule `project.no-fake-science`, ADR 0016, ADR 0017).

Not in this domain: a measurement from captured PCM with a quality rating, which is
measurement.
