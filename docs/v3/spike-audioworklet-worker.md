# V307 spike: AudioWorklet capture and Worker analysis

Spike for ADR 0026 (AudioWorklet and Worker are adopted only on recorded evidence), spec §79-§83,
§123-§124, §170-§172. It also settles gap G12 of `docs/v3/algorithms.md` (output limiter in the
measured chain, spec §207). Everything below was measured by `tests/browser/v3-measure.cjs`.
No number here is an estimate.

## Method

- **Code under test**: `src/js/measurement/capture.js` (browser io: AudioWorklet recorder loaded
  from a `data:` URL, ScriptProcessor fallback, stimulus through the V2 master chain) driven by
  `src/js/measurement/engine.js`. The fixture is one HTML file with one inline classic script, the
  same constraints as `dist/index.html`. It is opened from `file://` and from
  `http://127.0.0.1:<port>/oscilla/`, a stand-in for the Pages sub-path.
- **Loopback (TEST CONTEXT)**: `createLoopbackIo` feeds the end of the master chain
  (`engine.analyser`) through a known BiquadFilterNode (low-pass 1 kHz, Q √½) into the recorder.
  No microphone and no acoustic path are involved. A second tap after the master gain only
  (`tap: 'pre-limiter'`) isolates the limiter/ceiling.
- **Stimulus**: 2 s exponential sweep from 20 Hz to 20 kHz at 48 kHz. Digital level 0.25, master
  gain 0.08 unless stated. Pre-roll 0.25 s, post-roll 0.5 s, 3 repeats with 0.2 s gaps.
- **Runs**:
  ```
  node tests/browser/v3-measure.cjs --browsers <b> --spike --json out.json
  ```
  One run per browser, each covering both origins.
- **Environment**: Apple M5 Pro (18 cores), macOS 26.5.1, Node 22.20.0, Playwright 1.63.0 with
  Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6, all headless.

## Results

### Loading from `file://` and from http

Module loading, as measured by `T.loaders()` (an OfflineAudioContext for worklets, a dedicated
Worker that echoes a message):

| Browser | origin | worklet `data:` | worklet `blob:` | Worker `data:` | Worker `blob:` |
| --- | --- | --- | --- | --- | --- |
| Chromium 153 | file:// | ok | **AbortError** | ok | ok |
| Chromium 153 | http | ok | ok | ok | ok |
| Firefox 155 | file:// | ok | ok | ok | ok |
| Firefox 155 | http | ok | ok | ok | ok |
| WebKit 26.6 | file:// | ok | **AbortError** | ok | ok |
| WebKit 26.6 | http | ok | ok | ok | ok |

- A worklet from a `data:` URL loads everywhere.
- A `blob:` worklet fails on `file://` in Chromium **and WebKit**. Rule
  `project.single-file-deliverable` v2 (`data:` worklets) therefore stays as it is.
- Workers load from both `data:` and `blob:` on both origins in all three engines.
- Every page was a secure context, so `AudioWorkletNode` is available on `file://` too.

### Capture timing and buffer access (AudioWorklet)

- **Alignment lag across runs.** The lag is the offset between the scheduled stimulus start and
  where alignment found it in the capture, in frames at 48 kHz.
  - Chromium: 298.1146 in all 6 runs, sd 0.
  - WebKit: 298.1146 in all 9 runs, sd 0.
  - Firefox: 298.1147 over 9 runs, sd 0.0004 frames (max − min = 0.0013 frames).

  The lag is fully explained by the chain: the pre-limiter tap shows 0.0 frames, the post-chain
  tap 288.0 frames (the compressor's 6 ms look-ahead), and the 1 kHz low-pass group delay adds
  10.1 frames. **Capture start relative to the scheduled stimulus is therefore sample-exact and
  identical from run to run in every engine.** The recorder arms `[startFrame, endFrame)` on
  `currentFrame`; no timer is involved.
- **Stale `currentFrame` under load (found later, fixed in `capture.js`).** Chromium 153 with
  the machine under heavy CPU load (three copies of `tests/browser/v3-measure.cjs` at once)
  occasionally reports the previous quantum's `currentFrame` in `process()`: the processor saw
  `F, F, F + 256` over three calls, each with fresh input. Indexed by the raw value, the second
  quantum overwrote the first and left a 128-frame hole: the run was INVALID with
  `FRAMES_MISSING` ("128 frames missing, 2 discontinuities"; once also `DISCONTINUITY`), 6 of 12
  stressed page runs failed this way (the capture had been armed on time:
  `armedAtFrame = scheduledAtFrame`, start 4864 frames later). The processor now counts its own
  quanta and only moves forward to `currentFrame` when the clock is ahead (a quantum it did not
  process stays a reported gap). After the change: 0 failures in 14 stressed page runs (3 and
  4 concurrent copies) and one unstressed three-browser run; corrections did occur (reported
  306560, expected 306688; 846208 → 846336 in the G12 transparent-limit pre-limiter capture)
  and those captures were sample-exact against gain × stimulus (max error 0).
- **Frame integrity.** Every frame is counted against its index.
  - 3 × 132 032 frames per sweep measurement: 0 missing, 0 discontinuities in every browser
    and origin.
  - **40 s capture** (1 920 000 frames, 938 chunks of 2048 frames): 0 missing, 0
    discontinuities in all six browser and origin combinations. Wall time was 40.50-40.51 s.
- **Buffer access.** The worklet posts transferable 2048-frame chunks. The main thread writes
  each chunk at its frame offset into one preallocated Float32Array per capture:
  - 7.68 MB for 40 s at 48 kHz, the only allocation that grows with capture length.
  - Progress events arrive at the chunk cadence of about 23 per second.
- **Recovered response.** Measured magnitude minus (20·log10(master gain) + the filter's own
  `getFrequencyResponse()`), 100 Hz-10 kHz, 319 grid points:
  - worst −0.0040 dB in Chromium and WebKit;
  - worst −0.0158 dB at 101 Hz in Firefox;
  - mean −0.0009 dB everywhere.

  The test asserts ±0.1 dB; the justification is in the test header.

### ScriptProcessor comparison (fallback)

| Browser | origin | sweep result | lag (frames) | 20 s capture |
| --- | --- | --- | --- | --- |
| Chromium | both | COMPLETE, worst −0.0040 dB | 2346.1 (= 298.1 + 2048) | 0 missing |
| Firefox | both | COMPLETE, worst −0.0040 dB | 298.1 | 0 missing |
| WebKit | http | COMPLETE, worst −0.0040 dB | 2346.1 | 0 missing |
| WebKit | file:// | **INVALID** (capture checks) | — | **256 frames missing, 4 discontinuities** |

- **Block placement differs by engine.** Chromium and WebKit hand over the input block one
  buffer (2048 frames) earlier than the placement `round(playbackTime·sr) − bufferSize`.
  Firefox matches that placement exactly. The pre-roll covers the difference and alignment
  absorbs it.
- **Blocks get lost.** WebKit on `file://` dropped blocks in an idle headless page.
  ScriptProcessor is a fallback only.

### Main-thread cost of the analysis (10 s and 20 s sweeps, 48 kHz)

The analysis is align + transfer + impulse response (spectral) on a synthetic capture: 0.5 s
pre-roll + sweep + 1.5 s post-roll. Times are in ms from one run each.

- The capture is 11 s for a 10 s sweep and 22 s for a 20 s sweep. Both need a 2²¹-point FFT
  (stimulus + capture ≤ 2 097 152 samples), so **10 s and 20 s cost about the same**.
- "Longest step" is the longest single block, since the engine yields between steps.

| Where | 10 s total | 10 s longest step | 20 s total | 20 s longest step |
| --- | --- | --- | --- | --- |
| Node 22 | 1418 | 542 (IR) | 1417 | 564 (IR) |
| Chromium file:// | 1152 | 671 (IR) | 1158 | 656 (IR) |
| Chromium http | 1898 | 1037 (IR) | 1863 | 1024 (IR) |
| Firefox file:// | 903 | 356 (IR) | 845 | 350 (IR) |
| Firefox http | 884 | 342 (align) | 865 | 367 (IR) |
| WebKit file:// | 572 | 224 (align) | 511 | 212 (align) |
| WebKit http | 932 | 358 (IR) | 828 | 330 (align) |

- **Node at 96 kHz**: 10 s 2958 ms (longest 1134), 20 s 2558 ms (longest 979). The FFT is
  2²² points.
- **Same analysis in a Worker** loaded from a `data:` URL, with the arrays transferred:
  - Worker compute time: Chromium 1449-2390 ms, Firefox 850-909 ms, WebKit 652-1059 ms.
  - Largest gap between main-thread MessageChannel heartbeats during the whole analysis:
    **1.0-4.0 ms** in every browser and origin. Without the Worker, the main thread blocks for
    the full totals above.
- **Short sweeps also block in Chromium.** In the 2 s loopback measurement, the
  impulse-response step took 160-264 ms in Chromium and 17-46 ms in Firefox and WebKit. The
  transfer steps took 16-53 ms everywhere. Chromium is slow on the IR path (its inverse FFT and
  copy). This is noted for the owner of the pure module.

### Build size

The comparison is `src/js/main.js` minified (vendor packages external) with and without
`engine.js` + `capture.js` and every measurement module they import:

- +70 722 B raw and +26 629 B gzip. The capture worklet source accounts for about 2 KB of that.
- `dist/index.html` is 1 664 892 B raw and 448 781 B gzip. With the delta it would be about
  1.74 MB raw and 475 KB gzip, inside the 2 000 000 / 560 000 B budget.
- The bundled modules pass `verifyHtml` (scripts/verify-dist.mjs), both minified and plain. The
  worklet is loaded with `addModule(workletDataUrl())`, never from a path.

### G12: output limiter in the measured chain (spec §207)

Post-chain tap minus pre-limiter tap, same 2 s sweep, gain-1 system:

| Effective output peak | Chromium 153 / WebKit 26.6 | Firefox 155 (20 Hz-18 kHz) | Firefox 155 (18-20 kHz) |
| --- | --- | --- | --- |
| 0.02 (default: 0.25 × 0.08) | ≤ 0.00014 dB | 0.0027 dB | +5.83 dB at 19.9 kHz |
| 0.10 (0.4 × 0.25) | ≤ 0.00013 dB | 0.0027 dB | +5.83 dB at 19.9 kHz |
| 0.25 (1 × 0.25, loudest allowed) | ≤ 0.00013 dB | **−4.73 dB** at 18.0 kHz | −5.23 dB at 19.6 kHz |

Offline sine probes in Firefox (`OfflineAudioContext`, compressor + trim only):

- Gain is −0.0001 dB at every frequency for peaks ≤ 0.1.
- At a 0.25 peak: −2.66 dB at 10 kHz, −4.29 dB at 15 kHz and −4.90 dB at 19.9 kHz, while
  1-5 kHz stay at −0.0001 dB.
- A 2 s sweep through the compressor alone deviates from the no-compressor path by −3.8 dB at
  19.5 kHz even at a 0.02 peak.

Firefox's DynamicsCompressor reacts to high frequencies below its −3 dB threshold, and its
response near Nyquist is not flat. Chromium and WebKit stay transparent to within 0.00014 dB
below threshold. The WaveShaper ceiling is exact (identity) in all three engines below ±0.25.

**Changed (V3 pre-release)**: the Firefox 18-20 kHz deviation at peaks ≤ 0.1 and the offline
sweep's −3.8 dB were not a frequency response of the compressor. Gecko's DynamicsCompressor
returns silence for a silent (null) input block without advancing its 6 ms look-ahead line, so
the last 288 frames of every sound stay in the line and come out when the next sound starts.
Offline, a sweep through the compressor alone ends at frame 95 999 instead of 96 286 (Chromium:
96 286), and its last 600 frames read −0.46 dB instead of −0.014 dB. In the realtime loopback
each run started with the previous run's 20 kHz fade-out tail (peak 0.013 at the scheduled
onset), and after an aborted run with the abort fade's tail, which made the next run INVALID
(DISCONTINUITY at the onset). `audio-engine.js` now feeds the limiter a constant 0
(`feedLimiter`), so the line always advances. Re-measured in Firefox 155 (v3-measure.cjs,
file://): 18-20 kHz worst −0.000 dB at peaks 0.02 and 0.1, 20 Hz-18 kHz worst −0.00014 dB. The
0.25-peak compression is unchanged (−4.73 dB at 18.0 kHz, −4.84 dB at 18.8 kHz), so
`LIMITER_RANGE` and its 0.1 threshold stay. The last bullet below no longer applies to peaks
≤ 0.1.

**Decision**:

- Measurement playback always passes the master chain (master gain → limiter → trim →
  ceiling). It is never bypassed, and the chain is part of the measured system, not
  compensated.
- The chain is transparent within 0.003 dB over 20 Hz-18 kHz in every target browser up to an
  effective output peak of 0.1 (−20 dBFS).
- The engine warns with `LIMITER_RANGE` above that peak (`PREFLIGHT_THRESHOLDS.
  limiterTransparentPeak`). The default measurement level gives a 0.02 peak.
- Above 18 kHz, Firefox's compressor makes the measured response unreliable at any level. That
  is a known limitation of the browser, documented here and in `capture.js`. A quality rule
  (quality.js) can cap the valid range at 18 kHz when a result was produced in such an engine.
  The engine does no browser sniffing.

## Conclusion (ADR 0026 criteria)

- **Capture: adopt AudioWorklet.** The criterion was 40 s without a discontinuity in every
  target browser under `file://` and the Pages-like sub-path. It is met in 6 of 6 combinations
  (1 920 000 of 1 920 000 frames, 0 discontinuities). Capture start is sample-exact relative to
  the scheduled stimulus (lag sd 0 in Chromium and WebKit, 0.0004 frames in Firefox).
- **Capture fallback.** ScriptProcessor stays as the fallback for engines without AudioWorklet.
  It is lossy (WebKit on `file://`) and its block timing is engine-specific (± 1 block).
- **Worklet loading.** Worklets load from `data:` only. `blob:` fails on `file://` in Chromium
  and WebKit.
- **Analysis: adopt a Worker.** The criterion was a main-thread block above about 200 ms (§170).
  It is exceeded in every engine for 10 s and 20 s sweeps at 48 kHz:
  - longest single step 212-1037 ms;
  - whole analysis 511-1898 ms per run;
  - about twice that at 96 kHz.

  In a Worker the main thread stays responsive (largest heartbeat gap ≤ 4 ms) at a 1.0-1.3×
  compute-time cost. `data:` and `blob:` Workers both load on `file://` and http in all three
  engines.
- **Worker integration is not done in this change.** The engine's analysis is pure functions
  on plain arrays, separated by `io.yield()`. The Worker bundle must be embedded source (like
  the worklet) and loaded from a `data:` URL. That requires a build step that bundles the
  analysis modules into a string: an esbuild sub-build or a `?raw` import of a pre-bundled
  file, which is a `scripts/build.mjs` change. Until then, analysis runs on the main thread
  with yields between steps, and the UI should show progress (§170). Since G21 the boundary
  exists: `measurement/analysis-task.js` `runAnalysis(message)` is the whole analysis as one
  structured-cloneable task, called by the engine through its injected `analyze`, so the
  Worker is that module's bundle plus an `analyze` that posts the message.
- **WASM: not needed.** In the slowest engine, a full 2²¹-point analysis takes 1.0 s off the
  main thread (§83).
