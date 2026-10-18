---
id: measuring-a-playback-chain-at-home
kind: application
title: 'Measuring a speaker, a room or a microphone at home'
summary: 'Running a sweep measurement through your own speaker and microphone to read the frequency response, the impulse response and the band levels of the whole chain, and comparing one change with another.'
weight: 30
status: active
fits_when:
  - 'The question is how the whole playback and capture chain shapes sound, and one part can be changed at a time and measured again'
  - 'The microphone stays fixed between runs, so a measurement can be repeated up to ten times and aggregated'
  - 'A measurement microphone with a correction file is available, and optionally an acoustic calibrator for an absolute level reference'
  - 'The setup can be checked first: permission, input device, sample rate, input level and background noise'
  - 'A quality status with its reasons is wanted before relying on the result'
does_not_fit_when:
  - 'The loudspeaker''s own response is wanted apart from the room: the result is the response of the whole chain, and OSCILLA cannot separate its parts'
  - 'Levels must be in dB SPL and no external reference is available: without a valid level calibration nothing is labelled SPL, and a frequency profile alone never gives it'
  - 'A certified result is required: OSCILLA is not an IEC 61672 sound level meter and claims no IEC 61260-1 filter class for its bands'
  - 'The browser applies echo cancellation, noise suppression or automatic gain anyway: OSCILLA requests them off but cannot enforce it, and the result says so when the applied settings cannot be confirmed'
  - 'A latency or a time of flight is wanted: the impulse peak time includes unknown device and browser delays'
  - 'The device under test is a pair of headphones on someone''s head: the guide says not to wear headphones during a loudspeaker sweep, and no use case covers a headphone measurement'
  - 'Band levels must be stored with the experiment: a saved experiment''s RTA results are empty in this version'
use_cases: [measure-a-playback-capture-chain-response, measure-an-impulse-response, repeat-a-measurement-five-times, run-a-third-octave-rta, calibrate-a-microphone-frequency-response, compare-two-responses, studio-define-a-measurement-pipeline, open-measure-from-file]
---

# Context

Someone wants to know how their laptop speaker and microphone shape sound, or whether moving a
desk speaker changes its top end. They open Measure, choose CHARACTERIZE PLAYBACK CHAIN, check
the setup, run the sweep three times at a low digital level and read the frequency response,
then the impulse response and the band levels of the background noise. A measurement
microphone with a correction file and a 94 dB SPL calibrator make the curve calibrated and the
level absolute; without them every level is relative and says so. Every V3 check in the
automated tests runs on a TEST CONTEXT digital loopback or a fake microphone, so how a physical
speaker, room or microphone behaves is the user's measurement, not something the tests prove.

The rules it leans on are `project.no-fake-science`, `project.audio-engine-discipline`, `project.single-file-deliverable` (`.ai/repo/rules/project/`).
