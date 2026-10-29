---
schema: adr/v1
id: adr-0063
kind: adr
title: "One output owner at a time; every view names the class and subject of what it shows; every save path states its scope"
status: proposed
date: 2026-10-29
tags:
  - audio
  - state
  - science
  - persistence
related:
  - file:.ai/repo/adrs/0002-voice-replacement-and-output-ceiling.md
  - file:.ai/repo/adrs/0004-continuous-repeat-schedule-window.md
  - file:.ai/repo/adrs/0005-safety-limit-scope.md
  - file:.ai/repo/adrs/0017-relative-levels-spl-only-when-calibrated.md
  - file:.ai/repo/adrs/0023-schema-versions-independent-of-product-version.md
  - file:.ai/repo/adrs/0035-compiled-into-existing-engine-incremental-patching.md
  - rule:project.audio-engine-discipline
  - rule:project.no-fake-science
  - file:.ai/repo/project/issues/H002.yaml
  - file:.ai/repo/project/issues/H006.yaml
  - file:.ai/repo/project/issues/T026.yaml
provenance:
  origin: authored
---

# 63. One output owner at a time; every view names the class and subject of what it shows; every save path states its scope

## Context

At v3.13.0 (main b67d1e58; product code unchanged at cdda563c) four players can sound through
`engine.master`: the instrument (`engine.play`), the V2 sequencer (`compileSequence` on
`engine.master`, `src/js/sequencer/editor.js:317`), the Studio transport and a MEASURE run.

A partial claim mechanism exists. `engine.play` refuses during a measurement
(`src/js/main.js:203-211`). The Studio transport's `onClaimOutput` hook refuses while
`measureOwnsOutput()` is true and otherwise calls `stopPlayback(cmp)`
(`src/js/ui/studio/workspace.js:785-793`); `studioPlay` refuses during a measurement
(`workspace.js:1196-1203`); running an experiment definition refuses during a measurement
(`src/js/ui/experiments.js:979-981`). `stopPlayback(cmp)` stops the sequencer, the instrument and
a playing Studio (`main.js:218-222`), and MEASURE calls it before a run (`src/js/ui/measure.js:1342`,
`:1442`). `measureOwnsOutput()` (`measure.js:1660-1662`) and `studioOwnsOutput()`
(`workspace.js:1192-1194`) are the owner predicates. The loopback TEST CONTEXT deliberately does
not stop the instrument, which is its reference (`measure.js:1340-1342`).

The V2 sequencer's start path uses none of these, and neither does the instrument against a
playing Studio. The sequencer's state reaches the shell through a 150 ms poll (`main.js:464`).
The G1 coherence audit of 2026-10-29 reproduced the consequences: instrument and sequencer sum,
the sequencer starts during a measurement, Studio and sequencer overlap, Escape misses a
sequencer started under 150 ms ago, and the status-bar stop key starts the instrument
(coupling-1, -2, -3, -6, engine-sync-8, dead-controls-6).

Views describe the instrument's setpoints while another player sounds, and the Signal Path is
captioned "Active Web Audio processing graph" (`src/js/core/instrument.js:1089`) while it shows
the configured graph (vis-divergence-1, -4, -5). Rule `project.no-fake-science` v2 forbids
claiming more than the signal shows, but no decision names the classes a value can have.

Four save paths exist with different scopes (config link, preset, History: instrument keys
only; config file: every lab and the sequence). The link toast says "The link restores these
settings" (`instrument.js:968`), config import says "All settings were restored." after
clamping (persist-3, persist-4), and a saved continuous repeat restores as once without a word
(persist-2, H002).

The open plan pull request #280 (intent `coherent-state`, M090, C001-C022) states the invariants
and schedules most of the fixes. The arbitration rule, the value classes and the save-path
scopes cut across ADRs 0002-0005, 0017, 0018, 0023, 0045 and 0050, so they are recorded once
here rather than in each issue.

## Decision

1. **One output owner, by generalising the claim that exists.** The `onClaimOutput` hook,
   `stopPlayback` and the `*OwnsOutput` predicates become the one claim every player makes
   before it schedules anything: the instrument, the V2 sequencer, the Studio transport and a
   measurement. No second mechanism is built beside them. A claim while a measurement is in
   progress is refused with the existing "Measurement in progress" sentence. Any other claim
   stops the current owner first through `stopPlayback` (its release per ADR 0002 and 0003) and
   then grants the new one: the newest user action wins. Escape, page hide, a stop control and a
   context discard end the current claim in the same event, reading the owner predicates live,
   never a polled copy. One exception is stated and kept: the loopback TEST CONTEXT plays the
   instrument as its reference while the measurement owns the capture, so a measurement in that
   context does not stop the instrument (`measure.js:1340-1342`). Every node an owner plays is
   counted by the engine, and the census is 0 after every stop (`project.audio-engine-discipline`
   v2). The safety limit and the continuous-playback permission (ADR 0005, the repeat window of ADR
   0004) apply to every owner that plays an open signal. A held key or MIDI note follows the amendment of ADR 0005 that K026
   records, once that amendment is accepted.
2. **Value classes.** Every number, curve or state a view shows is one of: *setpoint* (requested
   by the user), *computed* (closed form from a setpoint or plan), *observed, digital output*
   (read from `engine.analyser`), *observed, acoustic input* (read from a microphone),
   *estimate* (a stated method whose error the signal does not bound), *calibrated* (under a
   calibration that covers the point shown, ADR 0017 and 0020). A view names its class and its
   subject (the output owner, or "instrument setpoint"); a view whose subject is silent says so
   and draws no model trace as if live. A value of one class is never labelled as another; that
   is a `project.no-fake-science` defect. The readout truth table of T026 is the register of
   every readout's class.
3. **Save-path scope.** Every save path declares its scope, and its restore returns what it
   applied, what it limited and what it dropped; the user sees the last two lists. "Restored"
   without qualification is shown only when both are empty. A path whose scope excludes a lab
   either carries it (C018) or says "instrument settings only"; the rule-mandated drops
   (continuous permission, binaural confirmation, gain cap; `url-state.js:5-6`) are named on
   restore, not silent (H002). Versioning stays ADR 0023's.
4. **Event order.** A user action is validated, then committed in its owner, then applied to
   audio in the same event, then reflected in readouts read from the owner. An exception
   (per-note envelope options, sequencer next-pass edits, Studio `admit`, MEASURE's own capture
   graph) is stated where the control is.

## Alternatives rejected

- **A new engine arbiter built from nothing.** Main already has the claim hook, the stop and
  the owner predicates; a second mechanism beside them would be two owners of one question.
  Generalising them reaches the V2 sequencer and the instrument with the smallest change.
- **A global reactive store for all state.** The owner's evolution pack forbids a
  general-purpose reactive state framework, and `project.audio-engine-discipline` keeps engine
  objects out of Alpine; the configuration owners are legitimate. This decision generalises one
  claim, not a store.
- **A strict exclusive machine with no exception.** It would break the loopback reference
  capture, whose reference is the instrument.
- **Mixing players by design.** Summing the instrument and the sequencer breaks the engine's
  single-voice level intent and the output ceiling's meaning; MEASURE already depends on
  exclusive output.
- **First claimant wins.** A user who presses Play on another surface expects it to sound; the
  measurement is the only owner whose interruption destroys work, so it alone refuses.
- **One save format for every path.** The URL carries a bounded instrument state by rule; the
  config file is the complete path. Declared scopes keep both honest without growing the link.
- **Labelling only in documentation.** The truth table is enforced by T026's test; a sentence
  in the docs is not enforcement (`project.rules-name-their-enforcement`).

## Consequences

- C001, C002, C003, C011, C013 and C016 (M090, #280) implement decision 1; C008, C013, C014, C015
  and the T issues of M073 decision 2; C017, C018, C019 and H002 decision 3.
- `README.md:476` ("Studio output and Playground output are exclusive") becomes true and is
  restated as "one output owner at a time"; until then H006 states the current behaviour.
- ADR 0050 keeps Space's per-workspace owner; Space on a playing owner is decided by C002 in ADR
  0050, not here.
- A new player (the steps clip, the Keys node and the drum voices of intent
  `connected-instrument`) claims the output through the Studio transport and inherits all four
  decisions.
- Tests: the journeys of C021 (J1 start, J2 live change, J3 synchronized views, J4 stop and
  restart, J5 save-restore-compare, J6 honest refusals) are this decision's evidence, with a
  unit test of the claim's transitions, the loopback exception included, that fails on the
  merge base (`project.fail-first`).

## Open questions for the owner

- Q-a: Does the newest action win (recommended), or is a second Play refused while something
  sounds?
- Q-b: Do presets and History carry the lab settings (C018), or do they say "instrument
  settings only"?

## Resolution notes

(none)
