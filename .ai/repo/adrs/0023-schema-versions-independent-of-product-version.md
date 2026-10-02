---
schema: adr/v1
id: adr-0023
kind: adr
title: Each persisted format has its own integer schema version, independent of the product version, upgraded by explicit stepwise migrations
status: proposed
date: 2026-10-02
tags:
  - data-model
  - versioning
  - v3
provenance:
  origin: authored
---

# 23. Each persisted format has its own integer schema version, independent of the product version, upgraded by explicit stepwise migrations

## Context

The repository already shows what coupling costs: V1's `APP_VERSION` stays `'1.0.0'` because the
freeze vectors pin it (ADR 0014), so V2 carries its product version separately
(`src/js/ui/version.js`, `2.0.0`) while `package.json` says `2.0.0-dev`. V2 formats are already
versioned on their own: the preset schema (`PRESET_SCHEMA_VERSION` 1, with
`registerPresetMigration`) and the config file (`CONFIG_FILE_VERSION` 1, which rejects any other
version). V3 adds experiments, calibration profiles and the experiment store (specification
§130-§132, §226), whose data outlives releases.

## Decision

Proposed:

- Product version, experiment schema, calibration-profile schema, recipe/config schema and the
  IndexedDB store version are separate integers, each starting at 1 in V3.0. A product release
  changes none of them unless the format changes; none of them is ever `3.0.0`.
- A reader accepts its current version and every older version for which a migration chain
  exists; migrations are pure functions `n → n + 1`, applied in sequence, never in place on
  stored data until the result validates. A newer version than the reader knows is rejected with
  a message, not guessed.
- Migrations never drop results or delete records; anything they cannot carry forward is a
  validation failure reported to the user.

## Alternatives rejected

- Schema version equal to the product version: every release would look like a format change, and
  a format change in a patch release would be invisible.
- No version, detect by shape: ambiguous after the second change.
- Lazy "best effort" readers that ignore unknown fields: silently loses data an older reader cannot
  see.

## Consequences

- Every format change ships with a migration and a test from the previous version and from empty
  (§226).
- Exported files name their schema and version, so a newer file opened in an older build fails
  loudly.
- Confirmation criteria: tests migrate a stored version-1 experiment through each later version
  without loss, and reject a version-from-the-future file.
