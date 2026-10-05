---
schema: adr/v1
id: adr-0012
kind: adr
title: The runtime is self-contained: pinned dependencies are inlined and nothing is fetched, imported or loaded from a path
status: proposed
date: 2026-10-02
tags:
  - deliverable
  - dependencies
  - offline
provenance:
  origin: authored
---

# 12. The runtime is self-contained: pinned dependencies are inlined and nothing is fetched, imported or loaded from a path

## Context

V1 loaded Tailwind (Play CDN, compiled in the browser), Flowbite, p5.js and Alpine.js from three
CDNs. Opened from `file://` it still needed a network, and its behaviour depended on what the
CDNs served that day. A `file://` document has an opaque origin: module
scripts, `fetch` of sibling files and, in Chromium, AudioWorklet modules from `blob:` URLs fail
there (`knowledge/curated/audio-measurement-pitfalls.md`).

## Decision

- Dependencies are npm packages pinned in `package.json` (Alpine.js 3.14.9, uPlot 1.6.32,
  p5.js 1.11.3; Lucide icons at build time) and inlined into `dist/index.html`. Alpine and uPlot
  are bundled into the app script; p5 is a verbatim block (ADR 0013).
- Tailwind and Flowbite are dropped for plain, token-based CSS (`src/styles/tokens.css` and
  siblings), compiled into one `<style>`. The Play CDN cannot be inlined deterministically.
- Every script is a classic script. At runtime there is no `fetch`/`XMLHttpRequest`, dynamic
  `import()`, `import.meta`, module script, service worker, `importScripts`, WebSocket or
  EventSource, remote font, or root-relative asset. A worklet or worker is created from source
  text embedded in the bundle (`?raw` imports in `build.mjs`) and loaded from a `data:` URL,
  because `blob:` worklet modules fail in Chromium on `file://`.
- `scripts/verify-dist.mjs` enforces this statically on the built file (URL attributes, CSS
  `url()`/`@import`, forbidden first-party script constructs, vendor byte identity, notices,
  size budget 2 000 000 B raw / 560 000 B gzip). The browser gate loads the file from `file://`
  and from a sub-path with zero console errors.

## Alternatives rejected

- CDN scripts with Subresource Integrity: still needs a network, and fails offline.
- A runtime Tailwind (Play CDN) inlined: compiles in the browser on every load and is not meant
  for production; a build-time Tailwind adds a toolchain for a design that is token-driven anyway.
- A worklet from a `blob:` URL only: works over http(s) but not from `file://` in Chromium.

## Consequences

- The artifact is large (dist at 1 657 434 B raw, about 434 KiB gzip at this commit; p5 alone is
  about 1.03 MiB raw). Any new dependency is weighed against the budget, a licence audit and
  `file://` behaviour (V3 specification §127).
- V3 measurement code must follow the same rule: an AudioWorklet or Worker (ADR 0026) is embedded
  source loaded from `data:` (or `blob:` where proven to work on `file://` in every target
  browser). The V3 specification §81 suggests a Blob URL; on `file://` that needs the evidence
  the spike collects before the rule's `data:` requirement changes.
- p5 contains `fetch` for `loadJSON`/`httpDo`; vendor code is verified by identity, not by
  pattern scan, and those functions are not called.

## Resolution notes

Appended; the sections above are left as written, and the status stays `proposed`.

### 2026-10-05: the size budget is 1 000 000 B gzip / 3 500 000 B raw

The budget in the decision (2 000 000 B raw / 560 000 B gzip) has been raised three times,
each recorded in `scripts/build-config.mjs` (`BUDGET`): V3 to 2 250 000 / 630 000 and V3.1 to
2 700 000 / 760 000, each after measuring the contributors, and on 2026-10-05 to 3 500 000 /
1 000 000 by owner decision (#114, f8515f7), as a stopgap: v3.7.0 measured 751 494 B of the
760 000 B gzip budget. Raw follows gzip at the measured ratio (3.47), so gzip stays the binding
limit. Replacing p5 (about 245 KB of the gzip, about 28 of its drawing functions in use) is
the deferred alternative; see the note on ADR 0013. The rest of this decision stands.
