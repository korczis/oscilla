---
schema: adr/v1
id: adr-0027
kind: adr
title: package.json "version" is the only source of the product version; schema versions and the frozen V1 stamp are separate
status: proposed
date: 2026-10-02
tags:
  - release
  - versioning
  - provenance
provenance:
  origin: authored
---

# 27. package.json "version" is the only source of the product version; schema versions and the frozen V1 stamp are separate

## Context

The repository showed three product-version strings at once (`1.0.0` in the V1 stamp,
`2.0.0` in the UI, `2.0.0-dev` in package.json). There were no v2 tags or GitHub releases, so
nothing said which build was public. Persisted formats already carry their own integer schema
versions (config 1, presets 1, URL `v=1`, sequence 1; ADR 0023), and V1's `APP_VERSION = '1.0.0'`
is pinned by the freeze golden (ADR 0014).

## Decision

Proposed (designed and being implemented on `release/provenance`, plan M011 R002):

- `package.json` `version` is the only product-version source. The runtime, the UI,
  `config.oscillaVersion`, `window.OSCILLA.version` and the tests derive it through the build
  (esbuild `define`, exposed by `src/js/core/build-info.js` as `BUILD.version`); a structural
  test forbids a second literal.
- Schema versions stay independent integers; `APP_VERSION '1.0.0'` stays the frozen V1 schema
  stamp and is never bumped.
- The first formal release is `v2.0.0`, because the public UI already says 2.0.0 and no v2 tag
  exists. Bumps happen only in `release:prepare`.

## Alternatives rejected

- A version constant in source: drifts from the package and from tags, as it already had.
- One version for product and formats: a release would rename formats that did not change.

## Consequences

- Release tooling reads one file; a bump is one reviewed diff.
- V3 shows `OSCILLA v3.0.0` from the same source, never hard-coded (V3 specification §130,
  §179).
- Confirmation criteria: the duplicate-literal test fails on a second product-version string; the
  public page's version matches the release tag.
