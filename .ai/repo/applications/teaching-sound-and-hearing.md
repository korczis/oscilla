---
id: teaching-sound-and-hearing
kind: application
title: 'A lesson or lecture demonstration of sound'
summary: 'Showing a class what a frequency, beating, a harmonic series, a filter or a sweep sounds and looks like, live, with the waveform, spectrum and spectrogram on the screen.'
weight: 10
status: active
fits_when:
  - 'The point is a physical effect people can hear and see at once: beating between 440 Hz and 442 Hz, a square wave built from odd harmonics, a low-pass filter a decade below a tone, a 20 Hz-20 kHz sweep'
  - 'The demonstration is prepared in advance and has to come back the next day, as a configuration file, a link or a named preset'
  - 'A tone, pattern or sequence is needed as a WAV file for a lesson, rendered through the same signal chain as live playback'
  - 'The comparison is relative: what the microphone picks up against what was requested, one setting against another'
does_not_fit_when:
  - 'The lesson needs a sound pressure level: every level is relative to digital full scale and labelled uncalibrated, and dB SPL exists only in Measure with a level calibration from an external reference'
  - 'It is a hearing test: OSCILLA is not audiometry, and the room speakers and the listener''s hearing are unknown to it'
  - 'The demonstration depends on what the room speakers reproduce: speaker output is unknown, small speakers can be overloaded below about 50 Hz before anything is heard, and generating a frequency digitally does not mean the hardware reproduces it'
  - 'A tone has to run open-ended without anyone present: open patterns stop at the hard safety limit unless continuous playback is allowed, and that permission is per session and never stored'
  - 'The microphone readings are meant as measurements: the microphone, its processing and the room are unknown, so readings are only comparisons'
use_cases: [play-a-440-hz-tone, hear-440-and-442-hz-beating, sweep-20-hz-to-20-khz, low-pass-a-tone, build-a-tone-from-harmonics, play-a-sequence, analyse-the-microphone, round-trip-a-configuration, export-a-wav-file]
---

# Context

A teacher demonstrates beating with two tones 2 Hz apart, a student watches what a low-pass
filter does to a tone a decade above its cutoff, and the class hears a sweep climb through the
audible range while the spectrum peak follows it. The demonstration is on a lecture-room
computer and its speakers, set up the day before and brought back as a file, a link or a
preset. What the room needs from the tool is a tone that starts and stops without a click, at
the level the control says, that is silent after Stop, with every number on the screen saying
what it is relative to.

The rules it leans on are `project.audio-engine-discipline`, `project.no-fake-science`, `project.single-file-deliverable` (`.ai/repo/rules/project/`).
