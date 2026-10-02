---
schema: adr/v1
id: adr-0007
kind: adr
title: Spec sections are verified by batched audits against the original text plus section-labelled browser tests
status: proposed
date: 2026-10-02
tags:
  - verification
  - process
provenance:
  origin: authored
---

# 7. Spec sections are verified by batched audits against the original text plus section-labelled browser tests

## Context

Sections 1-63 were implemented in one large commit before any per-section verification. The
issue YAMLs hold distilled acceptance criteria, not the specification text, and an
implementation-first codebase hides gaps that a summary criterion does not name.

## Decision

- Verify against the original specification text (recovered from the person's captured
  prompt), not only the issue YAMLs.
- Audit in batches by milestone (instrument core, visualization, modes and content, quality
  and accessibility) with independent reviewers, then fix the findings in parallel agents that
  each own one region of `index.html` (engine, visualization, accessibility, content).
- Every section is backed by executable evidence: `tests/spec.cjs` (checks labelled by
  section), `tests/smoke.cjs` and `tests/engine.cjs`, run over file:// in Chromium, Firefox
  and WebKit, and over the live Pages URL.
- A section is marked done in the Majordomus plan only with that evidence recorded at the
  final commit.

## Consequences

- The audits found and fixed defects the first smoke test could not see (release clicks,
  voice stacking, draw-loop DOM access, stale panels, focus traps, truncated text).
- Test checks quote spec sentences verbatim; editing user-facing wording can fail a check on
  purpose until it is reviewed.
