---
id: reproducible-experiment-record
kind: application
title: 'A reproducible record of an acoustic experiment'
summary: 'Keeping each measurement as an immutable experiment with its recipe, calibration, algorithms and build, comparing runs, recording findings that cite them, and handing the record to a colleague as a file.'
weight: 40
status: active
fits_when:
  - 'Results have to be repeated, compared and defended later, by the author or by a colleague who has only the exported file'
  - 'Runs are executed from a versioned definition, so two runs can be known to be the same measurement or a deliberate change'
  - 'A conclusion should be stored apart from the measurements it rests on, with a status and typed references to them'
  - 'A measurement made from a Studio graph should record that graph and the measured path beside its recipe'
does_not_fit_when:
  - 'The raw recording must be kept for re-analysis: OSCILLA stores the derived result and offers no option to keep the capture'
  - 'The record is shared without review: an exported experiment contains the impulse response, from which other sound the microphone picked up can be recovered, the input device''s label, a hash of its device ID and your notes'
  - 'Several people need one shared store: there is no server and no account, records live in this browser''s storage, and sharing is by exported file'
  - 'The calibration has to be stored for reuse: profiles and level calibrations are kept in page memory only, and an experiment records only which one applied'
  - 'The stimulus is anything but a log sweep: Repeat and "Run this definition" refuse a record whose stimulus this build cannot measure'
use_cases: [save-and-reload-an-experiment, export-an-experiment, compare-two-responses, record-a-finding-linked-to-evidence, follow-an-experiment-to-what-it-is-connected-to, repeat-a-measurement-five-times, studio-topology-in-experiment-provenance]
---

# Context

Someone measured a desk speaker twice, once with a foam pad under it, and thinks the pad lowers
the level above 6 kHz. They compare the two experiments, record a finding that cites the
comparison, and export the experiments for a colleague who imports them. A week later they open
one and see what it is connected to: the Studio project it was measured from, the duplicate,
the finding. What the record needs is to be the same record it was on the day: a completed run
that cannot be rewritten, every stored value traceable to the analysis, capture, calibration,
definition version and build that produced it, and a checklist that says which of those links
are missing.

The rule it leans on is `project.no-fake-science` (`.ai/repo/rules/project/`).
