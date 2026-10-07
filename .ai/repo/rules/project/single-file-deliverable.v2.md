---
id: project.single-file-deliverable
version: 2
kind: rule
title: Single-file deliverable
description: Modular source builds into one static dist/index.html that runs from file:// and from GitHub Pages with nothing fetched at runtime.
statement: The runtime is exactly one self-contained dist/index.html built deterministically from src/ by npm run build; it loads no local file, needs no server, and the same artifact is committed and deployed, the deployed copy differing only in its stamped build-metadata region.
status: active
class: blocking
depends_on: []
tags: [deliverable, deployment, build]
---

# Rationale

V2 outgrew a hand-edited single file (V2 specification §6-§12), but users must still be able
to double-click one file, and GitHub Pages must serve that same file. Source may be modular;
the runtime may not.

# Required behaviour

- Source lives in `src/` (ES modules, plain CSS). `npm ci && npm run build` produces
  `dist/index.html` with all CSS, application JS and dependency JS inlined (Alpine.js, p5.js,
  uPlot) plus the licence notices their licences require. p5.js (LGPL-2.1) stays an unmodified,
  separately identifiable block.
- The build is deterministic: identical bytes for identical inputs. `dist/index.html` is
  committed so a clone runs without npm, and `npm run build:check` proves it matches a rebuild.
- Build metadata: `dist/index.html` starts with the banner comment `OSCILLA v<version> —
  generated from src/, do not edit` and carries exactly one inert inline region
  `<script type="application/json" id="oscilla-build">` (version from package.json, source
  digest of the build inputs, channel `source`, commit `null`; no clock, no git state). The
  Pages workflow stamps ONLY that region with the commit, channel `production`, the commit
  date and the sha256 of the committed file (`scripts/stamp-build.mjs`); every other byte of
  the deployed page is the committed file, which `scripts/verify-deploy.mjs` proves by
  reversing the stamp and comparing bytes.
- At runtime there is no `fetch` of project files, no dynamic `import()`, no module script, no
  service worker, no worker or worklet loaded from a path (worklets use `data:` URLs), no
  remote fonts and no root-relative asset paths.
- GitHub Pages deploys `dist/` only. Repository tooling (`.ai/`, `.claude/`, `src/`, `tests/`,
  Markdown) is never published.
- Exception, crawler-only share assets: the Pages workflow also publishes `site/og-image.png`
  (the 1200x630 link preview that `og:image` and `twitter:image` must reference by absolute
  URL) and `site/apple-touch-icon.png`. The page never loads them, works identically without
  them from `file://`, and carries its own favicon and touch icon inline as `data:` URLs.
  `npm run social` regenerates them from the built app; `dist/` still holds only `index.html`.

# Failure behaviour

A second runtime file, a runtime fetch of a project resource, a non-deterministic build, or a
committed `dist/index.html` that differs from a rebuild is a review rejection and fails CI.

# Verification

`npm run verify-dist` (`scripts/verify-dist.mjs`) rejects banned constructs and missing notices; the browser gate loads
`dist/index.html` from `file://` and from a sub-path in Chromium, Firefox and WebKit with zero
console errors; after every Pages deployment `scripts/verify-deploy.mjs` fails the workflow
unless the live page, with its region normalised back, is byte-equal to the committed dist and
its region names the deployed commit, the package.json version and the recomputed digest.
