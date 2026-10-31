---
schema: knowledge/v1
id: webgl-in-the-gate-browsers
kind: knowledge
class: fact
title: What WebGL each gate browser gives, and what each CI leg can draw
description: Observed WebGL capabilities, live-context limits and drawable backends of Playwright's Chromium, Firefox and WebKit on darwin-arm64 and linux-x64, from the Y001 spike.
status: verified
epistemics: observed
date: 2026-10-30
tags:
  - webgl
  - charts
  - firefox
  - webkit
  - chromium
provenance:
  origin: authored
  derived_from:
    - commit:d39c6cad0485c0ba92180e09a33bba849d134976
    - file:.ai/repo/adrs/0016-renderer-split.md
---

# What WebGL each gate browser gives, and what each CI leg can draw

Observed on 2026-10-30 by the Y001 spike (branch `spike/gl-views`, never merged, commit
`d39c6cad`), with Playwright 1.63.0 and its Chromium 153.0.8010.12, Firefox 155.0 and WebKit
26.6. The probe was `node spike/gl/probe.cjs` at that commit, on darwin-arm64 headless and
headed, and on linux-x64 headless in `mcr.microsoft.com/playwright:v1.63.0-noble` (amd64
emulated on an arm64 Mac). The full tables, the backend costs and the commands are in the
resolution note "2026-10-30: where WebGL pays" of ADR 0016.

## What each CI leg can draw

CI runs the three browsers headless on linux-x64 (`.github/workflows/ci.yml`). A GL check names
its skips from this table:

| Leg | WebGL 2 | WebGL 1 | Canvas 2D | A GL check there |
| --- | --- | --- | --- | --- |
| linux Chromium headless | yes (ANGLE on SwiftShader, software) | yes | yes | runs; timings are software rendering |
| linux Firefox headless | **no** | **no** | yes | skips every WebGL path; checks the Canvas 2D fallback instead |
| linux WebKit headless | yes | yes | yes | runs; the 17th live context logs a console error |

On linux Firefox headless no context of either version is created, with or without
`failIfMajorPerformanceCaveat`; the console says "AllowWebgl2:false restricts context
creation" and "Exhausted GL driver options (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)". The
spike measured the Playwright image, not the `ubuntu-latest` runner itself; a GL check that
first runs on the runner confirms the table or corrects this record.

On darwin-arm64 every browser, headless and headed, creates webgl2 and webgl, also with
`failIfMajorPerformanceCaveat` (Chromium headless runs on SwiftShader and still passes it).

## Capabilities where WebGL exists

- R8 and LUMINANCE textures upload, take a column `texSubImage2D` and sample everywhere.
- EXT_color_buffer_float (webgl2) and EXT_color_buffer_half_float (webgl1) everywhere;
  EXT_color_buffer_half_float on webgl2 is **missing in Firefox**.
- OES_element_index_uint everywhere (core in webgl2).
- MAX_TEXTURE_SIZE: 8192 in Chromium headless (both OSes) and Firefox, 16384 in Chromium
  headed and WebKit. A 1024 x 512 ring fits every leg.
- MAX_VERTEX_TEXTURE_IMAGE_UNITS: 32 on SwiftShader and linux WebKit, 16 elsewhere.
- The unmasked renderer string is ANGLE SwiftShader in Chromium headless, ANGLE Metal in
  Chromium headed, "Apple M1, or similar" in Firefox, and "Apple GPU" in WebKit on every OS,
  linux included: the debug-renderer extension answers, but with a fixed string that does not
  identify the hardware.

## Live contexts per page

- Chromium and WebKit hold 16 live contexts; creating the 17th loses the oldest at once.
  Chromium logs a console warning, WebKit a console **error**, which a no-console-error check
  counts as a failure.
- Firefox on darwin held all 64 requested, with no console message, and 300 of 512; the 212
  losses arrive later as `webglcontextlost` events, and the console warns "Exceeded 300 live
  WebGL contexts for this principal, losing the least recently used one." The message counts
  the limit per principal (origin), not per page.
- A context budget across the gate browsers is therefore 16 per page.

## Limits of this record

The linux legs ran under amd64 emulation and in the Playwright image: their capability and
context facts stand, their timings do not. The Mac was shared and loaded (1-minute load
6.7–24.5 on 18 cores at the start and end of the probe, bench and uPlot runs), and the linux
runs overlapped the darwin runs; no timing is stated here for that reason. The figures are
from the second of two runs at the same commit; the first, more loaded run is set aside (ADR
0016 note).
