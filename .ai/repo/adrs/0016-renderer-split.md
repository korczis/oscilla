---
schema: adr/v1
id: adr-0016
kind: adr
title: p5 draws conceptual views, uPlot draws quantitative charts, custom canvas draws the spectrogram and editors, on one frame loop
status: proposed
date: 2026-10-02
tags:
  - visualization
  - charts
  - performance
provenance:
  origin: authored
---

# 16. p5 draws conceptual views, uPlot draws quantitative charts, custom canvas draws the spectrogram and editors, on one frame loop

## Context

V1 drew everything in one p5 sketch, including the spectrum. A p5 spectrum has no real axes,
cursors or tick logic, and every quantitative chart reimplemented them. V2 adds a filter-response
chart, a dual microphone/generator spectrum with peak hold, a scrolling spectrogram, and
interactive envelope and additive editors. A history-scrolling spectrogram redrawn as shapes each
frame is too slow at desktop sizes.

## Decision

- p5.js (instance mode, `visualization/p5-host.js`) keeps the conceptual, animated views ported
  from V1: waveform, signal path, interference/phase. They read engine state only through the
  visualization bridge and `engine.snapshot()`, reuse buffers and touch no DOM per frame.
- uPlot draws quantitative x/y charts with real axes and log-frequency scales: the live spectrum
  (one point per pixel column) and the filter response. Levels are labelled relative (ADR 0017).
- Custom canvas code draws the spectrogram (`analysis/spectrogram.js`: a ring buffer written one
  column per frame into an OffscreenCanvas and composed with two blits) and the interactive
  editors (envelope, additive, bioacoustic ranges).
- Every live renderer subscribes to one `requestAnimationFrame` loop (`charts/frame-loop.js`)
  that pauses while the page is hidden; a subscriber that throws is removed so it cannot stop the
  others. Audio scheduling never depends on it.

## Alternatives rejected

- Everything in p5: no axes or cursors, and a slow spectrogram.
- Chart.js or another general chart library: heavier than uPlot for streaming data, and the V3
  specification §119 excludes it.
- Everything on hand-written canvas: reimplements axes, scales, cursors and legends uPlot
  already provides.

## Consequences

- Three rendering models to know, kept in separate directories (`visualization/`, `charts/`).
- uPlot charts resized while hidden need an explicit rebuild (workaround in `main.js`).
- V3 result charts (frequency response, impulse response, RTA) extend this split: uPlot for
  response and IR curves, custom bars or uPlot for bands; charts render result objects and never
  own measurement data (ADR 0018).

## Resolution notes

### 2026-10-18: accepted by the owner

Accepted by the owner (explicit instruction in the session of 2026-10-18, applied by the
coordinating Claude session) — implemented as described; evidence: claims `spectrogram-mapping`
and `phase-and-lissajous-model`; `src/js/visualization/p5-host.js`, the uPlot charts under
`src/js/charts/`, the OffscreenCanvas ring of `src/js/analysis/spectrogram.js` and the one loop
of `src/js/charts/frame-loop.js`.

### 2026-10-18: acceptance withdrawn

The independent review of the acceptance (pull request #198, finding R-1) showed the decision
is not implemented as written: not every live renderer subscribes to the one loop of
`src/js/charts/frame-loop.js` — p5 runs its own draw loop (`src/js/visualization/visualization-bridge.js`)
and the Studio playhead and graph editor run their own requestAnimationFrame chains
(`src/js/ui/studio/workspace.js`, `src/js/ui/studio/graph-editor.js`). The status returns to
`proposed` until the decision is scoped to what it covers or the renderers follow it; the note
above is kept as history.

### 2026-10-30: where WebGL pays

The measurement spike of plan issue Y001, recorded for Q050; **nothing here is adopted**, the
decision above and its status are unchanged, and Q050 decides the GL backend from these
numbers. The spike lives only on the branch `spike/gl-views` (never opened for merge) at commit
`d39c6cad0485c0ba92180e09a33bba849d134976`; every figure below ran at that commit, and every
result file it wrote carries that commit. Versions: Playwright 1.63.0 with its Chromium
153.0.8010.12, Firefox 155.0 and WebKit 26.6; p5 1.11.3; uPlot 1.6.32; esbuild 0.28.2. The raw
JSON is not committed; the commands reproduce it, run from a checkout of that commit with
`--out <dir>` (the container of P3 and B3 has no git, so those two also name the commit with
`--commit`):

| Id | Command (at `d39c6cad`) | Legs |
| --- | --- | --- |
| P1 | `node spike/gl/probe.cjs --browsers chromium,firefox,webkit --modes headless,headed` | darwin-arm64 |
| P2 | `node spike/gl/probe.cjs --browsers firefox --modes headless,headed --max-contexts 512` | darwin-arm64 |
| P3 | `node spike/gl/probe.cjs --browsers chromium,firefox,webkit --out /out --commit d39c6cad0485c0ba92180e09a33bba849d134976` in `mcr.microsoft.com/playwright:v1.63.0-noble` (`--platform linux/amd64`, the image's own browsers; recipe in `spike/gl/README.md`) | linux-x64, headless |
| B1 | `node spike/gl/bench.cjs --browsers chromium,firefox,webkit --modes headless` | darwin-arm64 |
| B2 | `node spike/gl/bench.cjs --browsers chromium --modes headed` | darwin-arm64 |
| B3 | `node spike/gl/bench.cjs --browsers chromium,firefox,webkit --out /out --commit d39c6cad0485c0ba92180e09a33bba849d134976` in the same image as P3 | linux-x64, headless |
| U1 | `node spike/gl/uplot-spectrum.cjs --browsers chromium,firefox,webkit --dpr 1,2` | darwin-arm64, headless |
| G1 | `node spike/gl/gzip.cjs` | build only |

Bench defaults: `--frames 300 --warm 60 --scenes ring,xy --backends raw-gl,p5gl,canvas2d
--sampling-interval 1024`. The ring is a 1024 x 512 level ring (the K033 storage) written one
column per frame; the XY trace is 2048 samples.

**Load caveat.** These ran on the shared Mac (18 cores) while other sessions worked, so the
timings are likely inflated; they are not proven upper bounds. The host's 1-minute load
(`sysctl -n vm.loadavg`) at the start and end of each run: P1 11.43 → 10.07, P2 9.74 → 8.70,
B1 8.70 → 6.78, B2 6.74 → 10.90, U1 10.35 → 24.48, P3 10.92 → 9.74, B3 9.16 → 12.61. The
linux runs overlapped the darwin runs: B3 (18:28:49Z–18:34:55Z) ran alongside all of B1
(18:29:03Z–18:33:42Z) and the first 66 s of B2 (18:33:49Z–18:35:08Z), so the headless and the
headed Chromium timings shared the CPU with the qemu emulation; P3 (18:28:19Z–18:28:42Z)
overlapped P1 (18:28:15Z–18:28:34Z) and the start of P2 (18:28:41Z), which matters less for
capability figures. That broke item 2 of `project.shared-machine-discipline` (heavy browser
suites one at a time). The linux-x64 legs are amd64 emulated on an arm64 Mac: their capability
and context figures stand, their timings are not representative and are not quoted. They also
ran in the Playwright image, not on the `ubuntu-latest` runner `ci.yml` uses.

**An earlier run is set aside.** A first run of the same scripts at the same commit
(18:09Z–18:27Z, its result files also stamped `d39c6cad`) started each step at a 1-minute load
of 12.3–17.2, against 6.7–11.4 for the probe, bench and uPlot steps quoted here; its figures
differ (for example the uPlot Chromium DPR 1 total median is 0.165 ms there against 0.115 ms
here). This note quotes only the second run. The first run also benched Firefox and WebKit headed, which the second
did not repeat, so the only headed timings quoted here are Chromium's.

#### Capabilities (P1, P3)

webgl2 and webgl were each requested plain and with `failIfMajorPerformanceCaveat: true`.
"R8 / LUMINANCE" means the upload, a column `texSubImage2D` and sampling all worked.

| OS, browser, mode | webgl2 / webgl (both ways) | Renderer (unmasked) | MAX_TEXTURE_SIZE | MAX_VERTEX_TEXTURE_IMAGE_UNITS | webgl2: EXT_color_buffer_float / _half_float | webgl1: EXT_color_buffer_half_float | OES_element_index_uint | R8 / LUMINANCE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| darwin Chromium headless | ok / ok | ANGLE on SwiftShader (Vulkan 1.3.0) | 8192 | 32 | yes / yes | yes | core / yes | ok |
| darwin Chromium headed | ok / ok | ANGLE Metal, Apple M5 Pro | 16384 | 16 | yes / yes | yes | core / yes | ok |
| darwin Firefox headless | ok / ok | "Apple M1, or similar" | 8192 | 16 | yes / **no** | yes | core / yes | ok |
| darwin Firefox headed | ok / ok | "Apple M1, or similar" | 8192 | 16 | yes / **no** | yes | core / yes | ok |
| darwin WebKit headless | ok / ok | "Apple GPU" | 16384 | 16 | yes / yes | yes | core / yes | ok |
| darwin WebKit headed | ok / ok | "Apple GPU" | 16384 | 16 | yes / yes | yes | core / yes | ok |
| linux Chromium headless | ok / ok | ANGLE, SwiftShader (Subzero), Vulkan 1.3.0 | 8192 | 32 | yes / yes | yes | core / yes | ok |
| linux Firefox headless | **no / no** | none | - | - | - | - | - | - |
| linux WebKit headless | ok / ok | "Apple GPU" (a fixed string, on linux) | 16384 | 32 | yes / yes | yes | core / yes | ok |

Linux Firefox headless creates no WebGL context of either version, with or without the caveat
flag; it logs "AllowWebgl2:false restricts context creation" and "Exhausted GL driver options
(FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)". On that leg only Canvas 2D draws (B3: raw-gl
"no WebGL context", p5gl "Error creating webgl context").

#### Live contexts per page (P1, P2, P3)

64 contexts requested per kind (webgl and webgl2 alike); P2 requested 512 in Firefox.

| Browser | Live contexts | When the next one is created | Console |
| --- | --- | --- | --- |
| Chromium (darwin both modes, linux) | 16 | the 17th loses the oldest (index 0) at once; 48 loss events per 64 | warning "Too many active WebGL contexts" |
| WebKit (darwin both modes, linux) | 16 | same as Chromium | **error** "too many active WebGL contexts", which trips a no-console-error check |
| Firefox darwin (both modes) | 64 of 64 alive; of 512, 300 alive | the losses (212) arrive later as events | none at 64; at 512 the warning "Exceeded 300 live WebGL contexts for this principal, losing the least recently used one." |
| Firefox linux | 0 | creation fails at the first context | the messages above |

Firefox's message says its limit of 300 counts per principal (origin), not per page. The
context budget Y002 takes is therefore 16 per page, set by Chromium and WebKit.

#### Per-frame cost of the three backends (B1, B2)

Median / p95 in ms over 300 frames after 60 warm-up frames. "Main" is main-thread time around
the draw. "Synced" adds a 1-pixel readback after each draw, so GPU and raster work count;
main-thread time alone leaves that work out for both WebGL and Canvas 2D, and in Chromium the
repeated `getImageData` may move a 2D canvas to a slower CPU path, so the Canvas 2D synced
figures are the least reliable. "Alloc" is bytes allocated per frame by CDP HeapProfiler
sampling at 1024 B (objects collected by GC included, the bench page's own allocation
excluded), Chromium only. Timer granularity: 0.005 ms in Chromium, 0.02 ms in Firefox and
WebKit; every run was `crossOriginIsolated`.

| Backend, scene | Draw calls per frame | Alloc B/frame (Chromium headless / headed) | Main, Chromium headless | Main, Firefox headless | Main, WebKit headless | Main, Chromium headed (120 Hz) | Synced, Chromium headless |
| --- | --- | --- | --- | --- | --- | --- | --- |
| raw-gl ring | 1 drawArrays, 1 texSubImage2D | 338 / 351 | 0.02 / 0.025 | 0.02 / 0.04 | 0.02 / 0.02 | 0.01 / 0.02 | 1.295 / 1.645 |
| raw-gl xy | 1 clear, 1 bufferSubData, 1 drawArrays | 334 / 304 | 0.01 / 0.02 | 0.02 / 0.04 | 0.02 / 0.02 | 0.01 / 0.015 | 0.60 / 0.81 |
| p5gl ring | 1 putImageData, 1 full texImage2D, 4 bufferData, 2 clear, 1 drawArrays | 25 169 / 25 544 | 0.455 / 0.52 | 0.56 / 0.74 | 1.36 / 1.68 | 0.195 / 0.265 | 8.82 / 9.905 |
| p5gl xy | 5 bufferData, 2 clear, 1 drawArrays | **29 135 202 / 29 124 215** | 5.58 / 6.43 | 7.02 / 9.50 | 5.22 / 5.40 | 5.24 / 9.55 | 11.44 / 14.40 |
| canvas2d ring | 1 putImageData, 2 drawImage | 377 / 367 | 0.025 / 0.03 | 0.22 / 0.30 | 0.04 / 0.04 | 0.015 / 0.025 | 0.24 / 0.265 |
| canvas2d xy | 1 fillRect, 1 stroke | 319 / 340 | 0.025 / 0.03 | 0.12 / 0.24 | 0.10 / 0.14 | 0.02 / 0.025 | 0.13 / 0.14 |

Synced in Firefox / WebKit headless: raw-gl ring 0.96 / 0.78, raw-gl xy 1.00 / 0.68, p5gl ring
1.82 / 2.30, p5gl xy 8.42 / 5.68, canvas2d ring 0.24 / 0.76, canvas2d xy 0.14 / 1.06 (medians).
The 300–380 B/frame of raw-gl and Canvas 2D is a baseline the browser allocates whatever the
backend draws. p5's WEBGL renderer allocates about 25 KB per ring frame and about 29 MB per XY
frame, almost all inside `p5.min.js` (28.7 MB of the 29.1 MB), and re-uploads the whole ring
texture each frame. The p5 backend ran on `RendererGL` with webgl2 in every leg. In the
emulated linux Chromium leg (B3) the draw-call counts repeat exactly; the allocation figures
do not (linux against darwin headless, B/frame: raw-gl ring 322 / 338, raw-gl xy 356 / 334,
p5gl ring 24 956 / 25 169, p5gl xy 29 109 132 / 29 135 202, canvas2d ring 350 / 377, canvas2d
xy 386 / 319): p5's figures agree within about 1 %, the ~300 B baseline within about 21 %.
Timer granularity bounds the small figures: in Firefox and WebKit a median of 0.02–0.04 ms is
one or two ticks of the 0.02 ms timer, so a ranking at that size means little.

#### Gzip cost (G1)

esbuild 0.28.2 minified, gzip level 9 (node:zlib; `gzip -9` on the command line gives 1337,
596 and 873 B alone). This is not `npm run build`: G1 inserts the minified module before the
last `</script>` of the committed `dist/index.html` and compares the gzip -9 sizes, so "added
inside dist" (the growth over 823 390 B) approximates what a real build would add.

| Module | Minified B | Gzip -9 alone B | Added inside dist B |
| --- | --- | --- | --- |
| raw-gl (ring and xy) | 3469 | 1348 | 1236 |
| canvas2d (ring and xy) | 1087 | 599 | 473 |
| p5gl glue | 1885 | 878 | 742 |

The p5 1.11.3 min build and dist (searched whole, not only its p5 block) both contain
`RendererGL`, `WEBGL` and `webgl2`; since `src` contains no `webgl` or `RendererGL` text
(case-insensitive), those strings in dist come from p5, so p5's GL renderer itself costs no
bytes; only its glue does.

#### The uPlot live spectrum (U1)

The shipped spectrum chart in dist (v3.14.0), served `crossOriginIsolated` with a tone
sounding, 300 frames after 60 warm-up frames, headless. "Sync" is the chart's own
`u.setData` + `u.redraw`; "paint" runs from uPlot's `drawClear` hook to its last `draw` hook;
both are main-thread time.

| Browser | DPR | Total median / p95 ms | Sync | Paint | Points | Load start → end |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium | 1 | 0.115 / 0.185 | 0.005 / 0.015 | 0.11 / 0.18 | 566 | 10.35 → 9.68 |
| Chromium | 2 | 0.115 / 0.185 | 0.005 / 0.01 | 0.11 / 0.18 | 1132 | 9.68 → 8.98 |
| Firefox | 1 | 0.28 / 0.52 | 0.02 / 0.04 | 0.26 / 0.48 | 566 | 9.06 → 8.82 |
| Firefox | 2 | 0.32 / 6.46 | 0.02 / 0.40 | 0.28 / 5.70 | 566 | 8.82 → 16.85 |
| WebKit | 1 | 0.20 / 0.62 | 0 / 0.02 | 0.20 / 0.60 | 566 | 19.35 → 19.24 |
| WebKit | 2 | 0.26 / 0.80 | 0 / 0.02 | 0.26 / 0.80 | 1132 | 19.24 → 24.48 |

The Firefox DPR 2 p95 and both WebKit rows ran while the host load rose to 17–24 and are not to
be quoted as p95 until re-run on a quiet machine; Firefox ignored `deviceScaleFactor` 2 (its
canvas stayed 617 x 170). The point count follows device pixels in Chromium and WebKit because
`spectrum-chart.js` reads `u.pxRatio`, which uPlot 1.6.32 does not define.

**Would a GL spectrum line save anything measurable on the main thread? No.** The whole uPlot
spectrum costs 0.115–0.32 ms of main thread per frame at the median (0.7–1.9 % of a 16.67 ms
frame), almost all of it paint. The GL figure it is compared with is a stand-in, the 2048-sample
raw-gl XY trace of B1, not a 566-point spectrum line: about 0.01–0.02 ms of main thread plus
0.6–1.0 ms synced, and a GL line would also have to redraw the axes, cursor and zoom uPlot
already provides. The main-thread saving is therefore at most about 0.3 ms per frame, under
2 % of a 16.67 ms frame. Two limits: uPlot's raster cost after readback was not measured (U1
has no synced figure, while the GL side is quoted synced), so the comparison covers main-thread
time only; and the frame interval's own spread (B1/B2 rAF interval, p95 minus median) is about
0.2–0.4 ms in Firefox, 1.3–1.5 ms in WebKit and 1.7–1.9 ms in headed Chromium, while headless
Chromium's interval is synthetic (median 16.665, p95 and max 16.67 ms) and says nothing about
jitter. Y006 therefore builds only the density layer and leaves the line to uPlot.

#### What follows, for Q050 to decide

- Raw WebGL has the lowest main-thread time in every leg (0.01–0.02 ms median), but it is not
  the cheapest on every axis. Canvas 2D costs less gzip in dist (473 B against 1236 B), less
  synced time in Chromium headless (0.24 / 0.13 ms against 1.295 / 0.60 ms, ring / xy) and in
  Firefox (0.24 / 0.14 against 0.96 / 1.00), and fewer calls for the XY trace (2 against 3);
  their allocation is the same browser baseline (XY 319 against 334 B, within noise).
- Canvas 2D main-thread time is close to raw WebGL's only in Chromium (0.025 against
  0.01–0.02 ms). In WebKit it is 0.04 (ring) and 0.10 ms (XY) against 0.02 ms, the XY trace
  five times as much; in Firefox it is 0.22 and 0.12 ms against 0.02 ms. Medians of 0.02–0.04 ms
  in Firefox and WebKit are one or two ticks of the 0.02 ms timer. Canvas 2D is the only
  backend that draws on the linux Firefox leg.
- p5's WEBGL renderer costs no library bytes but allocates 25 KB (ring) and 29 MB (XY) per
  frame and spends 5–7 ms of main thread per XY frame, against the no-per-frame-allocation
  requirement of the GL plan.
- A page holds at most 16 live contexts in Chromium and WebKit, and WebKit reports the loss as
  a console error.
