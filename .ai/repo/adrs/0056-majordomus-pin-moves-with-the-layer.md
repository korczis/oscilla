---
schema: adr/v1
id: adr-0056
kind: adr
title: The Majordomus CI pin moves with the layer when the pinned version cannot read it
status: proposed
date: 2026-10-17
tags:
  - process
  - majordomus
related:
  - rule:project.majordomus-layer-current
  - file:scripts/majordomus-pin-check.mjs
  - file:tests/unit/majordomus-pin.test.mjs
  - file:.github/workflows/ci.yml
provenance:
  origin: extracted
  derived_from:
    - issue:178
    - file:scripts/majordomus-pin-check.mjs
---

# 56. The Majordomus CI pin moves with the layer when the pinned version cannot read it

## Context

The CI `knowledge` job runs the Majordomus version pinned as `MJ_VERSION` and `MJ_SHA256` in
`.github/workflows/ci.yml`. The git hooks and `npm run verify` run whatever `majordomus` is on
PATH. `scripts/majordomus-pin-check.mjs` refuses when the two differ and prints a four-step
procedure: (1) migrate the layer on a branch until `doctor` reports 0 failures under BOTH the
pinned and the new version, (2) land it, (3) move the pin by its own PR, (4) the owner flips the
launcher. The procedure assumes that a layer both versions accept exists. Migrations to 0.13.2,
0.14.0, 0.20.0 and 0.23.0 followed it.

The migration from 0.20.0 to 0.29.0 (#178) had no such layer. 0.29.0 requires
`session.retention_max_files` and vendors two rules (`majordomus.knowledge-graph`,
`majordomus.task-on-the-mesh`) whose validators it ships, and without them it reports 3
failures. 0.20.0 rejects those policy keys as unknown and defines neither validator, and with
them it reports 4. Every released Majordomus refuses an unknown key, so this recurs whenever a
release adds a required key.

## Decision

When no layer reaches 0 failures under both versions, steps 1 to 3 land as **one** pull request:
the migrated layer and the moved pin (`MJ_VERSION` and `MJ_SHA256` together, the digest taken
from `https://majordomus.dev/releases/v<new>.json` and checked against the downloaded asset).
CI then judges the new layer with the new tool in the same change. The PR body shows both
versions' doctor output, so a reviewer sees why the steps were not split. The procedure printed
by `scripts/majordomus-pin-check.mjs` says so, and `tests/unit/majordomus-pin.test.mjs` requires
it to.

## Alternatives rejected

- **Splitting anyway.** Either the layer PR fails CI's pinned doctor, or the pin PR fails it on
  the old layer. Neither can land green.
- **Migrating through every intermediate release** (0.20 → 0.23 → … → 0.29). It is more PRs and
  more CI rounds, and an intermediate pair can have the same incompatibility.
- **Excusing doctor's failures in CI for the transition.** It would weaken the verdict
  (`.github/doctor-verdict.jq`) that `project.majordomus-layer-current` rests on.

## Consequences

- The combined PR touches `.github/`, so `project.review-verdict` needs a reviewer's verdict for
  it, as it would for the separate pin PR.
- When a combined PR is open, a superseded pin PR (here #177, to 0.23.0) is closed by the owner.
- Step 4 is unchanged: the owner flips the launcher. In #178's case the launcher already ran
  0.29.0, which is why every pre-commit doctor on a 0.23 layer failed until the migration
  landed.
