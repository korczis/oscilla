---
schema: feature/v1
id: studio-patches
kind: feature
title: 'Save, load and share Studio projects and patches as validated files'
short_title: 'Patches'
headline: 'Keep a Studio as a project or a graph fragment as a reusable patch, load it back exactly, and import files from others safely.'
summary: 'Deterministic, versioned Studio and patch serialization with an untrusted-import pipeline and stepwise migrations; local persistence in the experiment database with a memory fallback, explicit insert or replace, and JSON export and import.'
status: stable
weight: 440
featured: false
rules: [project.studio-model-is-canonical, project.typed-ports]
docs: [docs/v31/patches-and-provenance.md, docs/v31/studio-model.md, docs/v31/user-guide.md, docs/specs/oscilla-v3.1-studio.md]
adrs: [adr-0030, adr-0032]
claims: [studio-deterministic-hash, studio-untrusted-import, studio-schema-version, studio-patch-round-trip]
use_cases: [studio-save-and-load-a-patch]
related: [studio]
tags: [v31, studio, persistence]
---

## What it does

A Studio file is canonical JSON of the normalized model with its own schema version
(ADR 0030, ADR 0023), imported through one pipeline: size cap, structural scan, depth,
counts, strict schema, normalize, validate, migrate (`src/js/studio/migrate.js`). A patch
(`src/js/studio/patches.js`) is a graph fragment with its own kind and version: nodes,
parameters, internal cables and their automation lanes. Projects and patches are saved in
the Studio partition of the experiment database (`DB_VERSION` 2, which adds stores and
deletes nothing; `src/js/studio/library.js`), exported as `.oscilla-studio.json` and imported
back. Opening a project replaces the document; inserting a patch adds it with new ids as one
undo step; nothing saved is overwritten silently, and a malformed, hostile or newer-schema
file is refused with the reason. Dirty state follows semantic content only. Six templates
(Basic Tone, Subtractive Synth, Sweep Sequence, Filter Automation, Stereo Beat, Measurement
Sweep) start a document, each pinned by its hash.

Proven by `npm test` (`tests/unit/v31-studio-patches.test.mjs`,
`v31-studio-model.test.mjs`, `v31-studio-templates.test.mjs`) and `npm run test:studio`
(`tests/browser/v31-studio-graph.cjs` checks patches-files and templates in three browsers).

## What it does not do

A patch carries no tracks, clips or markers; the timeline travels in a project. There is no
cloud sync, no second database, and no autosave or crash recovery. From `file://` the
browser's storage may be unavailable; the library then keeps projects and patches in memory
for the page view and says so.
