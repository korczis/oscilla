---
schema: feature/v1
id: studio-patches
kind: feature
title: 'Save, load and share Studio patches as validated files'
short_title: 'Patches'
headline: 'Planned: keep a graph as a reusable patch, load it back exactly, and import files from others safely.'
summary: 'Deterministic, versioned Studio serialization with an untrusted-import pipeline and stepwise migrations; patch persistence in the existing local store and JSON export.'
status: draft
weight: 440
featured: false
rules: [project.studio-model-is-canonical, project.typed-ports]
docs: [docs/v31/studio-model.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0030, adr-0032]
claims: [studio-deterministic-hash, studio-untrusted-import, studio-schema-version, studio-patch-round-trip]
use_cases: [studio-save-and-load-a-patch]
related: [studio]
tags: [planned, v31, studio, persistence]
---

## What it does

A Studio file is canonical JSON of the normalized model with its own schema version
(ADR 0030, ADR 0023), imported through one pipeline: size cap, structural scan, depth,
counts, strict schema, normalize, validate, migrate (specification §111-§115, §154-§161).
Nothing is evaluated, and a newer schema is refused.

Guaranteed now, by `tests/unit/v31-studio-model.test.mjs`: deterministic serialization and
hashing, untrusted import, and the independent schema version.

## What it does not do

The patch format, local persistence, replace or insert on load, and export (issue V426) are
not built; claim `studio-patch-round-trip` is `planned`. There is no cloud sync and no
second database layer; the patch file extension is an open question.
