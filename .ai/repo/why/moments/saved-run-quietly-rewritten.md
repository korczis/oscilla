---
schema: moment/v1
id: saved-run-quietly-rewritten
kind: moment
title: 'A saved measurement that was quietly rewritten'
short_title: 'Rewritten record'
hook: 'found that a saved measurement could be changed after the fact and still verify'
summary: 'A stored run can be overwritten, renamed through the same path that rewrites its results, or duplicated as if it were a new run, so the record is no longer evidence of what was measured.'
status: stable
severity: high
frequency: rare
weight: 80
audiences: [researchers, maintainers]
areas: [reproducibility]
lifecycle: [operations, maintenance]
tags: [immutability, experiments, import, hashes]
signals:
  - id: rename-rewrites
    text: 'Renaming a record went through the same code path that could change its results.'
  - id: duplicate-looks-new
    text: 'A copy of a measurement carried a new time, as if it had been measured again.'
  - id: edited-file-imports
    text: 'An edited experiment file imported without complaint.'
examples:
  - id: rename-path
    audience: maintainers
    title: 'Rename was a put'
    before: 'Rename read the record, changed its name and wrote it back by id; nothing compared the new record with the stored one.'
    after: 'A completed run is immutable: writing a different record under its id is refused with the changed paths, and name and notes change through a separate metadata operation.'
  - id: duplicate-run
    audience: researchers
    title: 'A duplicate that claimed another time'
    before: 'Duplicate copied the record under a new id and set its creation time to now.'
    after: 'A duplicate is the same run under a new ID that keeps every execution fact and both hashes and records its source.'
  - id: hostile-import
    audience: researchers
    title: 'A colleague''s file'
    before: 'A file with a length mismatch, an unknown algorithm or a result that no longer matches its hash is stored as if valid.'
    after: 'An imported experiment is untrusted input; a wrong type, a non-finite number, an unknown algorithm ID, a future schema or a result hash mismatch is refused with a reason and nothing is stored.'
claims: [experiment-run-immutable, experiment-import-validated, experiment-round-trip, studio-untrusted-import]
doctrines: [project.no-fake-science]
use_cases: [save-and-reload-an-experiment, export-an-experiment, studio-save-and-load-a-patch]
related: [number-nobody-can-trace-or-repeat, conclusion-recorded-as-a-result]
aliases: ['immutable experiment', 'tampered record', 'result hash mismatch']
---

## The moment

An experiment is renamed, duplicated to keep a copy, then imported on another machine. Somewhere
along the way its results changed, and its hashes still verified.

## Why it happens

Immutability was a convention, not a mechanism. An audit as of v3.5.0 found that the store
overwrote a record by id, that rename and a results rewrite took the same path, that a
duplicate claimed a new time, and that no hash covered the list of runs
([ADR 0040](../../adrs/0040-completed-experiment-run-immutable-metadata-separate.md)).

## What it costs

The record stops being evidence. Every comparison and finding built on it inherits a doubt
nobody can resolve.

## What OSCILLA does

A record whose result hash is stamped is complete, and a write that changes any execution fact
is refused with the changed fields named. Metadata (name and notes) has its own operation and
no hash covers it. A duplicate keeps every execution fact and records `duplicateOf` (claim
`experiment-run-immutable`). Imports of experiments and of Studio files are untrusted input,
validated before anything is stored (claims `experiment-import-validated`,
`studio-untrusted-import`).

## How to verify it

`npm test` runs the experiment store, schema and corrupt-import tests and the Studio import
tests.

## What it does not do

It does not freeze what is not an execution fact: name and notes stay editable, and an
experiment is still deleted when you delete it. What it guarantees is that the store refuses a
changed execution fact and an import refuses a record that fails validation.
