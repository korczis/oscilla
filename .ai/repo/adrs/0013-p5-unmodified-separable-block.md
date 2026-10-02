---
schema: adr/v1
id: adr-0013
kind: adr
title: p5.js (LGPL-2.1) ships as an unmodified, separately identifiable script block with its licence notice
status: proposed
date: 2026-10-02
tags:
  - dependencies
  - licensing
  - build
provenance:
  origin: authored
---

# 13. p5.js (LGPL-2.1) ships as an unmodified, separately identifiable script block with its licence notice

## Context

The conceptual views (waveform, signal path, interference) are p5.js sketches carried over from
V1. p5.js is LGPL-2.1; Alpine.js and uPlot are MIT, Lucide is ISC. Bundling p5 into the minified
app script would merge it with first-party code, so a recipient could not identify or replace the
library, which the LGPL requires to remain possible for a combined work. A single-file artifact
(ADR 0011, ADR 0012) has no separate `.js` file to point at.

## Decision

- `scripts/build-config.mjs` lists p5 in `VENDOR_SCRIPTS`: its official `p5/lib/p5.min.js` is
  emitted byte-for-byte as its own classic `<script data-vendor="p5@1.11.3" data-sha256="…">`,
  before the app script, and the app reaches it through `window.p5` (the `vendor-globals` esbuild
  plugin), never through a bundled copy.
- The third-party notice, an HTML comment after the doctype, carries every contained package's
  name, version, licence and full licence text; for p5 it states that the block is unmodified,
  may be replaced by any compatible build, and where its source is. Packages that ship no licence
  file (alpinejs) take the upstream text from `licenses/`.
- `verify-dist` fails when the vendor block is not byte-identical to the pinned package file or
  when a notice is missing.

## Alternatives rejected

- Bundle and minify p5 with the app: smaller by little, and the library becomes neither
  identifiable nor replaceable.
- Drop p5 and redraw the conceptual views on raw canvas: a rewrite of working V1 drawing code for
  no user-visible gain (renderer split in ADR 0016).
- Load p5 from a CDN: violates ADR 0012.

## Consequences

- p5 is the largest single contributor to the artifact (about 1.03 MiB raw, 244 KiB gzip).
- Upgrading p5 is a version bump in `package.json`; the build re-derives the block, hash and
  notice. Patching p5 in place is not possible without abandoning this decision.
- New vendor libraries with copyleft licences follow the same pattern; permissive ones are
  bundled.
