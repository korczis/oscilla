---
id: hearing-ranges-and-bioacoustics
kind: application
title: 'Learning where a frequency falls in human and animal hearing'
summary: 'Placing a tone against cited hearing ranges and call bands of people and animals, and hearing where the speakers or the listener stop.'
weight: 20
status: active
fits_when:
  - 'The question is where a frequency falls against published hearing ranges and call bands, each with its source and threshold criterion'
  - 'The answer may be approximate, with the range varying by source and individual, and the citation is part of the answer'
  - 'A sweep through 20 Hz-20 kHz is used to hear where the speakers or the listener stop, as a listening exercise'
does_not_fit_when:
  - 'The aim is to find out what an animal hears from these speakers, or to affect, repel or deter one: OSCILLA makes no such claim, and speaker output above the audible range is unknown'
  - 'A frequency must be shown to be safe or inaudible: the rule against fake science forbids the claim'
  - 'The tone has to exceed the digital Nyquist limit of the running audio context: nothing is scheduled at or above 95 % of half the sample rate'
  - 'A hearing threshold of a particular person is wanted: this is not audiometry, and levels are relative'
use_cases: [compare-a-frequency-with-animal-hearing, sweep-20-hz-to-20-khz]
---

# Context

Someone wants to know whether a dog or a bat could hear the 25 kHz tone they are about to play.
They compare the tone with the hearing-range and call bars of the bioacoustics panel and follow
a bar to the publication it comes from. What they need is a range they can trace to its source
and its criterion, a plain statement that ranges vary, and no sentence anywhere promising what a
frequency does to a person or an animal. A sweep shows the other half of the answer: where the
speakers, or the listener's ears, stop.

The rules it leans on are `project.no-fake-science`, `project.audio-engine-discipline` (`.ai/repo/rules/project/`).
