---
schema: adr/v1
id: adr-0028
kind: adr
title: The committed dist embeds a source digest, and the Pages workflow stamps one metadata region with the deployed commit
status: proposed
date: 2026-10-02
tags:
  - release
  - provenance
  - deployment
provenance:
  origin: authored
---

# 28. The committed dist embeds a source digest, and the Pages workflow stamps one metadata region with the deployed commit

## Context

`dist/index.html` is committed and must equal a deterministic rebuild (ADR 0011). A committed
file cannot contain the SHA of the commit that contains it, which is a fixed-point problem. Yet
the public page must prove which commit, version and inputs it was built from. A separate
`build.json` beside the page would break the single-file rule (`project.single-file-deliverable`).

## Decision

Proposed (designed and being implemented on `release/provenance`, plan M011 R003/R005):

- The deterministic build writes ONE inline JSON metadata region holding `version` and
  `sourceDigest` (SHA-256 of the build inputs), with `commit: null` and `channel: "source"`.
- The Pages workflow stamps only that region with `commit = GITHUB_SHA`, `channel: production`,
  `sourceDate`, and `artifactSha256` of the unstamped dist.
- Post-deploy verification is fatal after bounded retries. The live page, with the region
  normalised, must be byte-equal to the committed dist, and the commit, version and digest must
  match.

## Alternatives rejected

- Embedding the commit at build time: impossible for a committed artifact, or it breaks
  reproducibility.
- A `build.json` endpoint: a second runtime file; `majordomus served observe` probes for one, so
  that probe does not apply here.

## Consequences

- Builds stay reproducible; the deployed page still proves its commit.
- Verification is a strict byte comparison outside one well-defined region, so any other
  difference between the committed dist and the served page fails the deploy.
- Experiments record `BUILD.version` and `BUILD.commit`; a source build reports commit `null`
  honestly instead of inventing one (V3 specification §51, §99).
