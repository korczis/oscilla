---
schema: adr/v1
id: adr-0022
kind: adr
title: Experiments persist in IndexedDB with an in-memory fallback; file export and import are the durable path
status: proposed
date: 2026-10-02
tags:
  - storage
  - experiments
  - offline
  - v3
provenance:
  origin: authored
---

# 22. Experiments persist in IndexedDB with an in-memory fallback; file export and import are the durable path

## Context

V2 stores presets and history in `localStorage` through `safeStorage`, which never throws and
degrades to no-ops in private mode. An experiment carries numeric arrays (transfer curves, an
impulse response of up to seconds at 48-96 kHz, band levels, optionally raw capture) that strings
in `localStorage` hold poorly: a synchronous API, a small per-origin quota, and text-only values.
The app runs from `file://`, where browsers give an opaque or per-file origin and storage may be
unavailable, partitioned or cleared; the specification forbids a backend (V3 specification
§54-§58, §128, §175, §225-§227). Not yet implemented (issue V353).

## Decision

Proposed:

- A storage layer with one interface and two backends: IndexedDB (structured clone keeps typed
  arrays) when it opens, otherwise an in-memory store for the session. The UI states which one is
  active.
- `.oscilla.json` export and import is the durable, portable path in every browser; local storage
  is a convenience. Measurement never depends on persistence, and Playground never depends on the
  experiment database.
- Quota errors keep the current result in memory and offer export or deletion; deletion is
  explicit only, never a side effect of a migration.
- Imports are untrusted: size-capped (32 MiB), schema-validated with numeric bounds, array sizes
  and known algorithm IDs, parsed as JSON only.
- Presets and history stay in `localStorage` as in V2.

## Alternatives rejected

- `localStorage` for experiments: synchronous, string-only and quota-bound; base64 arrays would
  hit the quota after a few experiments.
- Files only (no local store): every reload loses recent work.
- A server or cloud store: forbidden (no backend, §128), and microphone-derived data stays local
  (§88).

## Consequences

- Behaviour differs by browser under `file://`; the UI must say when experiments are not kept
  beyond the session.
- Two storage mechanisms in the app (`localStorage` for V2 state, IndexedDB for experiments).
- Confirmation criteria: the browser gate opens, writes, reads and deletes an experiment under
  `file://` and under the Pages sub-path in Chromium, Firefox and WebKit, and records per browser
  whether IndexedDB persists; a forced open failure and a forced quota error leave the app usable
  with export. Revise toward export-only on `file://` if IndexedDB proves unreliable there in a
  target browser.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: implemented as decided (V3.0, issue V353)

"Not yet implemented" above is history. `src/js/experiments/store.js` opens the IndexedDB
database `oscilla-experiments` and falls back to an in-memory store that the UI names ("in
memory for this page view"); `validate.js` treats an import as untrusted, capped at 32 MiB.
Since V3.1 the same database, at version 2, also holds Studio projects and patches in the
object stores `studio` and `studioSummaries`; no second persistence layer was added. Since
V3.6 a completed run is immutable in the store (ADR 0040). The confirmation criterion is
check persistence in `tests/browser/v3-ui.cjs`, per browser and origin, which reloads the
page and reads the record back or reports the memory fallback. Proven by claims
`experiment-persistence`, `experiment-import-validated` and `experiment-run-immutable`.
