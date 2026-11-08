---
schema: feature/v1
id: offline-single-file-app
kind: feature
title: 'One self-contained page that runs from file:// and from GitHub Pages'
short_title: 'Single file'
headline: 'Open one file, offline, with nothing to install and nothing fetched, or visit the same file on the web.'
summary: 'The modular source builds deterministically into one committed dist/index.html with every dependency inlined; it runs from file:// and from the /oscilla/ sub-path GitHub Pages serves.'
status: stable
weight: 140
featured: true
domain: delivery
rules: [project.single-file-deliverable]
docs: [README.md]
adrs: [adr-0011, adr-0012, adr-0013]
claims: [single-file-build, dist-self-contained, opens-from-file-and-subpath]
use_cases: [open-from-file, open-under-the-oscilla-sub-path, open-measure-from-file]
tags: [delivery, v2]
---

## What it does

`scripts/build.mjs` bundles `src/` with esbuild and `scripts/pack-single-file.mjs` packs
styles, vendor scripts and the application into `dist/index.html` as classic scripts,
deterministically (ADR 0011). `scripts/verify-dist.mjs` refuses module scripts, import maps,
external scripts and runtime loading (ADR 0012); p5.js ships as an unmodified, separately
identifiable block with its licence notice (ADR 0013). The browser gate runs every check
from file:// and from a local `/oscilla/` sub-path.

## What it does not do

Which version and commit the public page serves is answered by its build-metadata region
(ADR 0028, R003) and checked by `scripts/verify-deploy.mjs` against the release (R005); each
release's record is `.ai/repo/releases/v<version>.yaml`.
