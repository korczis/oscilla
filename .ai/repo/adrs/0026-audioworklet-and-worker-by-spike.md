---
schema: adr/v1
id: adr-0026
kind: adr
title: AudioWorklet capture and Worker DSP are adopted only on the evidence of a recorded spike; the native graph and main thread stay the default
status: proposed
date: 2026-10-02
tags:
  - audio
  - performance
  - dsp
  - v3
provenance:
  origin: authored
---

# 26. AudioWorklet capture and Worker DSP are adopted only on the evidence of a recorded spike; the native graph and main thread stay the default

## Context

V3 needs sample-accurate PCM capture of tens of seconds and offline FFT work on arrays of up to
2²¹ points (ADR 0018, ADR 0021). The application has no AudioWorklet or Worker today; the build
already supports embedding one (`?raw` imports) and `verify-dist` allows only `data:` or `blob:`
sources (ADR 0012). Evidence collected so far: Chromium cannot load a worklet module from a
`blob:` URL on a `file://` page while a `data:` URL loads; Firefox delivers empty worklet inputs
while upstream is silent; ScriptProcessor drops buffers in Firefox; the test tap needs zero
filling and frame indexing (ADR 0006, `knowledge/curated/audio-measurement-pitfalls.md`). V3
specification §79-§83, §124 and §170-§171 ask for evaluation, not migration. WASM is out of scope
unless a benchmark demands it.

## Decision

Proposed:

- Spike before adoption (issue V307). For capture, compare an AudioWorklet recorder (frame
  indexed, zero-filled, posting transferable chunks) against ScriptProcessor and MediaRecorder
  (encoded by default, so it needs decoding); for analysis, time the offline DSP on the main
  thread against a Worker.
- Measure and record per browser (Chromium, Firefox, WebKit) under `file://` and the Pages
  sub-path: load success from `data:` and `blob:`; dropped or discontinuous frames over a 40 s
  capture; timing stability; main-thread blocking during analysis of 10 s and 20 s sweeps at
  48 kHz and 96 kHz; added bytes to `dist/index.html`.
- Adopt the worklet for capture if it records 40 s without a discontinuity in every target
  browser under `file://` and the Pages sub-path; otherwise use the candidate that does and record
  why. Adopt a Worker for analysis if main-thread analysis blocks for more than about 200 ms
  (§170) on the benchmark; otherwise keep analysis on the main thread.
- Whatever is adopted is embedded source, loaded from a `data:` URL on `file://`; a `blob:` URL is
  used only where the spike proves it loads on `file://` in every target browser.

## Alternatives rejected

- Migrate the engine to AudioWorklet DSP now: rewrites the verified V1/V2 engine (ADR 0015)
  without evidence of a problem it would solve.
- Rule out worklets and workers: ScriptProcessor is deprecated and lossy in Firefox, and long
  analyses would freeze the UI.

## Consequences

- Until the spike reports, capture and analysis designs keep a seam (capture returns a `Capture`
  object; analysis is pure functions on plain arrays) so either execution context can host them.
- The spike's results are recorded as evidence and knowledge; this ADR is then revised to state
  what was adopted, or rejected, and why.
- If a `blob:` loader is adopted, rule `project.single-file-deliverable` v2 (which says worklets
  use `data:` URLs) needs a new version first.

## Resolution notes

Appended; the sections above are left as written on 2026-10-02, and the status stays
`proposed`.

### 2026-10-04: one copy of the analysis; the Worker runs the page's own analysis script

M10 adopted the Worker for the offline analysis (`docs/v3/spike-audioworklet-worker.md`, "M10")
by embedding a separately bundled copy of the analysis in the app bundle as a string literal
(the define `__OSCILLA_ANALYSIS_WORKER__`) and starting it from a `data:` URL. The analysis was
therefore in `dist/index.html` twice: once in the app bundle (the inline fallback, and the app's
other users of `spectrum.js`, `transfer.js`, `smoothing.js`, ...) and once as that 27 677-byte
string. The decision above stands (a Worker from embedded source on a `data:` URL); only the
packaging changes.

- **Mechanism.** `scripts/build-analysis-worker.mjs` bundles the closure of
  `src/js/measurement/analysis-worker.js` once, as the *analysis library*: a classic IIFE that
  `scripts/pack-single-file.mjs` inlines as its own `<script data-analysis>` between the p5
  block and the app script. It assigns `globalThis.__oscillaAnalysis = { modules, source }`:
  `modules` holds, per library module, the exports the app uses; `source` is
  `document.currentScript.text`, the script's own text, read while it runs (null in a Worker).
  The app is bundled with an esbuild plugin that resolves every import of a library module to
  a virtual module destructuring that module's exports from the global, so the app bundle has
  no analysis code. A first pass with pure marker calls in place of the exports lets esbuild's
  tree shaking report which exports the app uses; the library exposes exactly those and is
  tree-shaken like any bundle. `analysis-runner.js` starts the Worker from
  `data:text/javascript;charset=utf-8,` + the encoded `source`; inside the Worker the same text
  runs, and the entry guard of `analysis-worker.js` (a `WorkerGlobalScope`) serves the
  analysis. The inline fallback and the Worker execute the same code, so their results are
  identical by construction (still asserted byte for byte).
- **Guarantees kept.** Still a `data:` URL (no `blob:`), no `eval`/`new Function`, no
  `import()`, no module script, no second file, and it works from `file://` and the Pages
  sub-path in Chromium, Firefox and WebKit (`tests/browser/analysis-worker.cjs`, on a page laid
  out like dist). `scripts/verify-dist.mjs` is unchanged in substance: the library is a
  first-party script and every forbidden-construct pattern scans it. Rule
  `project.single-file-deliverable` v2 holds as written. Abort, the ready handshake, the
  transfers and the fallback before `ready` are unchanged. The build stays byte-deterministic.
- **Enforcement.** The build fails when a library module is bundled into the app as well
  ("analysis modules bundled twice") or when the app uses an export the library does not
  expose; a page without the library script fails at boot with a clear error instead of
  running without its analysis. `tests/unit/v3-analysis-worker-single-copy.test.mjs` fails if
  distinctive analysis literals appear in dist more than once or in the app bundle at all, and
  `tests/browser/v3-ui.cjs` (loopback-workflow) proves on the built dist that a measurement's
  analysis ran in one Worker started from the page's own `<script data-analysis>` text
  (`ready` ... `result`), not in a silent inline fallback.
- **CSP.** Nothing new in kind. A Content-Security-Policy (dist ships none) must still allow
  `data:` Workers (`worker-src data:`, or its `child-src`/`script-src` fallbacks) or the
  analysis falls back inline as before; the library is one more inline classic script, so a
  hash-based `script-src` needs its hash next to the app script's. No `'unsafe-eval'`.
- **Size.** `dist/index.html` went from 2 620 505 B raw / 753 491 B gzip to 2 595 417 B / 746 238 B
  (−25 088 B raw, −7 253 B gzip; `npm run verify-dist`, gzip level 9). Deleting the Worker
  string outright would save at most 27 673 B raw / 8 640 B gzip, so the single copy keeps
  about 84 % of that bound; the rest is the glue (export names in the library's `modules`
  and the app's destructuring) and the analysis compressing on its own instead of inside the
  app bundle.
- **Rejected: the Worker from the app script's own text** (a `data:` URL of the whole
  `<script data-app>` with a worker-entry guard). The app bundle's top level is not Worker-safe
  (`window.p5`, Alpine, DOM access at module evaluation), so every module would need a guard,
  and each analysis Worker (one per analysis) would parse about 1.2 MB instead of the
  library's 37.7 KiB. **Rejected: evaluating one string twice** (`new Function`/`eval` on the
  page): it needs `'unsafe-eval'` under a CSP; a real `<script>` element needs neither.
