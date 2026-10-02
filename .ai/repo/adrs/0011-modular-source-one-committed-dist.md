---
schema: adr/v1
id: adr-0011
kind: adr
title: Modular source builds deterministically into one committed dist/index.html, which Pages serves unchanged
status: proposed
date: 2026-10-02
tags:
  - build
  - deployment
  - deliverable
provenance:
  origin: authored
---

# 11. Modular source builds deterministically into one committed dist/index.html, which Pages serves unchanged

## Context

V1 was one hand-edited `index.html` (5 840 lines at `v1.0.0`). V2 adds filters, ADSR,
additive synthesis, stereo, a sequencer, uPlot charts and a spectrogram; parallel agents editing
one file collided (ADR 0008), and pure functions could not be imported by `node --test`. The
person's constraint did not change: a user double-clicks one file, and GitHub Pages serves that
same file. Rule `project.single-file-deliverable` v2 records the requirement; this records why the
mechanism is a committed build output.

## Decision

- Source is plain ES modules and CSS under `src/`. `scripts/build.mjs` bundles `src/js/main.js`
  (IIFE) and `src/styles/main.css` with a pinned esbuild, and `scripts/pack-single-file.mjs`
  assembles `src/index.html`, the CSS, the vendor scripts, the app bundle and the licence notice
  into `dist/index.html` by pure string work.
- The build is deterministic by construction: no timestamps, no absolute paths, sorted notices,
  LF output. `npm run build:check` rebuilds in memory and fails when the committed file differs.
- `dist/index.html` is committed. A clone runs without npm, the pull request diff shows the
  artifact change, and CI (`ci.yml`) and the Pages workflow both run `build:check` and
  `verify-dist` before anything is published.
- `pages.yml` stages the committed `dist/index.html`, plus the two crawler-only share assets the
  rule allows (`site/og-image.png`, `site/apple-touch-icon.png`, never loaded by the page), and
  smoke-tests the live sub-path. Pages does not run its own build.

## Alternatives rejected

- Keep one hand-edited file: no module boundaries, no unit-testable imports, and every parallel
  change conflicts in the same file.
- Build in CI and deploy an uncommitted artifact (or a `gh-pages` branch): a clone would need npm
  to run, and what Pages serves would not be a reviewed, committed file.
- A multi-file `dist/` (separate JS/CSS): a user must keep a folder together instead of one file,
  each sibling file is a path the runtime has to resolve from `file://` and from the Pages
  sub-path, and the single-file rule forbids it.

## Consequences

- Every source change must be followed by `npm run build` and a commit of `dist/index.html`;
  forgetting it fails CI rather than shipping stale code.
- Diffs of `dist/index.html` are large and minified; review happens on `src/`, and identity is
  proven by `build:check`, not by reading the artifact.
- Determinism depends on pinned tool versions (esbuild 0.28.2, Node ≥ 22); upgrading esbuild is a
  deliberate artifact change.
- ADR 0009 (auto-merge behind the `gate` job) still applies; only what Pages publishes changed,
  from the root `index.html` to `dist/index.html`. ADR 0009 is not superseded.
