---
schema: adr/v1
id: adr-0044
kind: adr
title: Evidence on a run is read from stored fields, as a lineage and a checklist, never a score
status: proposed
date: 2026-10-06
tags:
  - measurement
  - experiments
  - provenance
  - v3
related:
  - file:.ai/repo/adrs/0019-recipe-versus-experiment.md
  - file:.ai/repo/adrs/0038-measurement-topology-inside-studio.md
  - file:.ai/repo/adrs/0040-completed-experiment-run-immutable-metadata-separate.md
  - file:.ai/repo/adrs/0041-run-comparison-semantic-execution-vs-presentation.md
  - file:.ai/repo/adrs/0043-runs-executed-from-versioned-experiment-definitions.md
  - rule:project.no-fake-science
  - file:src/js/experiments/evidence.js
  - file:src/js/ui/experiments.js
  - test:tests/unit/v3-run-evidence.test.mjs
provenance:
  origin: authored
  derived_from:
    - file:src/js/experiments/schema.js
    - file:docs/v4/completion-ledger.md
---

# 44. Evidence on a run is read from stored fields, as a lineage and a checklist

## Context

Since v3.5 a stored run carries its recipe, its definition version (ADR 0043), the algorithm
id of every result, the input device and applied constraints, the calibration it applied (ADR
0040, resolution 2026-10-05), its repeats with ids, the build with its digests, a result hash
and, for a Studio run, the Studio block (ADR 0038). The Experiments detail listed these as
provenance rows, one field per row. Two questions were still left to the reader:

- **What produced this value?** A value on the response passes through an analysis, a
  capture, a calibration, a run, a definition version and a build. Nothing tied a value to
  that chain.
- **Can I repeat this?** Some links are often absent: no device label (the browser did not
  expose it), no authored definition (a derived one), no source digest (an unbundled page), no
  raw capture (never stored). Nothing said which are missing.

The owner's scope decision of 2026-10-05 asked for one slice that answers both from stored
fields only, as a checklist and never a score, and rejected a knowledge explorer or a
workspace shell for now. The v4 completion ledger lists this as missing capability 2, and
records two facts it must not contradict: the Studio block hashes the whole graph, including
nodes the measurement did not use (finding D3), and raw captures are not retained (P2-3).

## Decision

Proposed:

- **One pure module.** `src/js/experiments/evidence.js` computes the evidence of a decoded,
  stored experiment, with no DOM, clock or storage. The workspace only renders it. It reads the
  stored record, never the presented copy without a contradicted claim (`presented()`), so
  that it can say what the record claims and what contradicts it.
- **The result point.** The run's main result is its stored response: `results.transfer`, or
  the aggregate centre. The point is the stored grid value nearest a frequency the user enters
  (1 kHz by default, or the grid's geometric centre when 1 kHz is outside it), shown exactly as
  stored: the RAW capture/stimulus ratio in dB re unity digital transfer, with its grid
  frequency, whether it is one repeat or the aggregate centre, and its reliability from the
  stored quality mask. A frequency correction is never stored (an experiment keeps only the
  profile's id and name), so the point is never presented as corrected. The point is taken
  from the stored arrays, not from the chart's readout, because the chart may draw a corrected,
  smoothed or normalized view that the record does not store.
- **The lineage.** An ordered list: result; analysis (each `algorithms` role with its id and
  version); capture (the device label or "not exposed", whether a hashed device id is stored,
  the sample rate, the applied processing flags, the master output gain that every magnitude
  includes, the engine's notes such as the input-processing warning, and a TEST CONTEXT label
  when the run carries one); stimulus (as played, and the digital output level; a recorded
  request that differs from what was played is shown for f1 and f2, and attributed to the
  Nyquist limit only when the request is higher and the played value is exactly stimulus.js
  `safeMaxFrequency` of the stimulus rate, otherwise "the record does not say why");
  calibration as applied (the
  frequency profile's name and id and the algorithm that applied it; the level calibration's
  offset, reference, method and input binding, which applies to levels and not to the ratio;
  or "uncalibrated"); run (id, repeats with their ids and capture length in frames at the
  capture rate, created and started times, repeat and duplicate links); definition (authored or
  derived, id, version, hash and `storedMatch` against this browser's definitions); build
  (version, channel, source digest, artifact SHA-256, commit); and, only for a Studio run, the
  Studio block. A link whose block the record does not store is left out; a field missing
  inside a link reads "not recorded". Nothing is inferred.
- **Truth in three places.** A calibration claim its own results contradict
  (`calibrationClaimFindings`) is presented as the detail and compare present it
  (`withoutContradictedCalibration`): the claims that hold are described (a profile that the
  results confirm stays named beside a contradicted level calibration), a contradicted claim
  that named a calibration reads "uncalibrated (the stored claim is contradicted)" for that
  kind, a claim of none contradicted by corrected results reads "not recorded" for that kind,
  and each finding follows in its own words. When nothing holds and every contradicted claim
  named a calibration, the link starts "uncalibrated (the stored claim is contradicted)". A
  contradicted offset is never shown as applied. The Studio link is "the
  Studio graph the recipe was derived from", with its studioHash and node and edge counts, and
  says that the hash covers nodes the measurement did not use and does not show which of them
  sounded (ledger D3). Times are labelled: `createdAt` and `measurement.startedAt` are wall
  clock; capture lengths are on the audio clock.
- **The checklist.** Nine items, each `recorded`, `partial` or `missing` ("not recorded"),
  with a one-line reason and its state in words, drawn with the existing quality icons (a
  checked circle, a triangle, a crossed circle) beside the words:
  - *Definition authored and stored*: recorded only for an authored definition stored here
    with the same version and hash; partial for an authored one that is not stored, does not
    match or cannot be read (the run still carries its execution), and for a derived one.
  - *Recipe recorded*: partial when this build's engine cannot run its stimulus kind (it runs
    log sweeps only; ledger D4).
  - *Algorithm versions recorded*: partial when a recorded id is not implemented by this build
    or the transfer id is missing; the reason says that no result hash covers the ids.
  - *Calibration identity recorded*: "uncalibrated, stated" is recorded; partial for a
    contradicted claim (the reason names what holds and quotes each finding), a profile
    without its id, or a level calibration not bound to an input (it applies to every input;
    ledger C1).
  - *Input device identity recorded*: recorded with a label and processing flags; partial with
    only a hashed id or without flags; not recorded when the browser exposed neither (or a TEST
    CONTEXT run has no device).
  - *Build identity recorded*: partial for a version alone or a build with uncommitted changes.
  - *Result hash verified*: recomputed over the stored record in its declared version, once
    per record object (`hashVerification`; the store already verifies on read). Equal and
    version 4 is "verified"; equal in an earlier version is partial; unequal is "does not
    verify"; absent is not recorded. The reason names what the version covers (hash.js:
    results; + quality, calibration, input, output; + the measurement block and build; +
    recipe and definition) and what no result hash covers: the algorithm ids, the environment
    notes and the lineage (created time, repeat and duplicate links).
  - *Raw capture retained*: always "not retained (OSCILLA stores the derived result, not the
    raw capture)".
  - *Environment notes recorded*: the notes at measurement time, not a later annotation; the
    TEST CONTEXT label MEASURE appends to them is not counted as a note.
  No item is recorded without the field that records it, and there is no count, percentage or
  overall verdict.
- **Compare.** Comparing runs adds one line, "Checklist differences (states only):", naming
  the checklist items whose state differs with each run's state, or "none". Equal states can
  hide different identities, so the line also names the recorded identities that differ
  (build, definition, calibration as presented without a contradicted claim, input device), or
  says there is no difference in them.
- **UI.** The run detail gets an Evidence section under a real heading (h4), with "What
  produced this value?" and "Can I repeat this?" as h5, a labelled frequency field, an ordered
  list and a checklist list. Each item's icon (the existing quality icons) sits beside its state
  in words; colour is never the only signal. A frequency that is not above 0 Hz is refused:
  the field shows the kept frequency again (so it is never left marked invalid while it holds
  a valid value) and is described by a status region that says why. It uses the existing tokens and fits 390 px.

## Alternatives rejected

- **A reproducibility score or percentage.** It would weigh unlike facts against each other
  (a missing device label against an unverifiable hash) and invite a number to stand for
  evidence the record does not hold.
- **The chart cursor's value as the result point.** The chart may show a view derived at
  display time (a loaded profile's correction, smoothing, normalization); the lineage is of the
  stored value.
- **Presenting the Studio graph as what ran.** Finding D3 is open: the block hashes unconnected
  nodes, so a lineage claiming every node contributed would be false.
- **Storing evidence in the record.** Everything is derived from fields already covered by
  the result hash; a stored copy could disagree with them and would need a schema version.
- **Retaining raw captures to complete the checklist.** It is a storage and privacy decision
  of its own (ledger P2-3); until it is made the checklist states the absence.

## Consequences

- No schema, hash or storage change; a record of any schema version gets its evidence.
- Opening a run recomputes its result hash once per record object (the store already does on
  every read); a rename or another view of the same object reuses the check. The cache relies
  on records never being changed in place (a completed run is immutable, ADR 0040; the store,
  annotate, duplicate and import make new objects); a hit also requires the same stored hash
  and version.
- The bundle grows by about 6.4 KB gzip (zlib level 9).
- Confirmation criteria: `tests/unit/v3-run-evidence.test.mjs` (each lineage link present or
  absent per stored field; checklist states for authored, derived, calibrated, uncalibrated,
  contradicted, Studio, label-less and unverified records; raw capture never retained; no item
  recorded without its field; compare differences; the workspace adapter) and check
  `evidence` in `tests/browser/v3-ui.cjs` (the section, its headings and lists, the states and
  words, the keyboard-reachable frequency field, 390 px, light theme, the contradicted older
  record without "SPL", and the compare line; chromium, firefox and webkit over file:// and
  /oscilla/).

## Resolution notes

Appended; the sections above are left as written on 2026-10-06, and the status stays
`proposed`.

### 2026-10-06: the three ledger caveats this decision named are closed

This decision stated three facts of the ledger it must not contradict. Each was closed on
2026-10-06, and the evidence now says what the record holds:

- **D3, the Studio link.** A Studio block of experiment schema 4 names its measured path (ADR
  0038, resolution 2026-10-06). The Studio link names that path (its nodes, connections,
  measurement clips and hash) beside the whole graph, and says the other nodes were recorded,
  not used by the measurement. For a block that records the whole graph only, it says so and that
  the record does not say which nodes the measurement used. The alternative this decision
  rejected, presenting the Studio graph as what ran, stays rejected.
- **C1, the calibration item.** A level calibration without an input binding no longer
  "applies to every input" (ADR 0017, resolution 2026-10-06). The lineage says the record cannot
  show which input it was taken with, and the item stays partial for it.
- **D4, the recipe item.** It stays partial for a stimulus this build cannot measure and gives
  the reason the import finding gives (ADR 0043, resolution 2026-10-06).
