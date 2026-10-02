# OSCILLA V3 measurement architecture

Specification: `docs/specs/oscilla-v3-measure.md` (milestones M012-M020). This document says
*how* the measurement layers fit together in the code on this branch. The reasons for each
choice are in the ADRs it names, and they are not repeated here. The way each algorithm
computes its result, and which tests pin it, is in `docs/v3/algorithms.md`. The UI binding is
in `docs/v3/ui-integration.md`. The module names and data shapes below are what the modules
produce and what `experiments/validate.js` accepts. `tests/unit/v3-pipeline.test.mjs` runs
the whole chain on the real result objects, so a shape that drifts fails a test. When a shape
changes, change it here in the same commit.

## The layers

```
 Recipe: stimulus spec, repeats, analysis settings (recorded in the experiment)
   │
   ▼
 STIMULUS     measurement/stimulus.js   renderStimulus(spec) → samples   inverseSweep(spec)
   │
   ▼
 CAPTURE      measurement/engine.js (state machine, no DOM) ── io ──► measurement/capture.js
                playback  source → fade → master → limiter → trim → ceiling → output ──┐
                                                                                       │
                          physical chain: DAC, amplifier, speaker, room, microphone,   │
                          preamplifier, ADC, browser input processing                  │
                                                                                       │
                capture   getUserMedia → AudioWorklet from a data: URL ◄───────────────┘
                          (ScriptProcessor fallback) → Capture per run: Float32Array,
                          pre-roll, post-roll, device, constraints, integrity; no overlap
   │
   ▼
 ANALYSIS     capture-checks.js per run (clipping, dropouts, discontinuities), then
              measurement/analysis-task.js runAnalysis (pure, offline, on captured PCM):
                align → transfer + impulse response (one spectral division per run)
                → aggregate (two or more runs)
              noise check (engine.js summarizeNoise) → spectrum.js welch → rta.js
                one-third-octave band power, level, per-frequency noise for the SNR
   │
   ▼
 CALIBRATION  calibration/interpolate.js   frequency profile → separate CALIBRATED curve
              calibration/level.js         level calibration → the only path to dB SPL
   │
   ▼
 RESULT       measure() result: recipe, input, runs, transfer, ir, aggregate, calibrated,
              captureChecks, noise, notes, algorithms (raw PCM dropped by default)
   │
   ▼
 QUALITY      measurement/quality.js assessQuality → status, reasons, metrics, masks
   │
   ▼
 EXPERIMENT   ui/measure-experiment.js → experiments/schema.js → hash.js → encode.js
              → store.js (IndexedDB oscilla-experiments, or memory)
              ⇄ export / import (validate.js, migrate.js) → compare.js, csv.js

 UI adapters  ui/measure.js, ui/experiments.js: engine events and results → the pure
              reducers and view builders of measurement/views/ → charts/measure-charts.js.
              They render view models and compute nothing.
```

Rule: data flows one way, **PCM capture → deterministic offline DSP → structured result → quality
and provenance → experiment → chart.** The live AnalyserNode of the V2 engine is feedback
only. No stored or displayed result depends on a visible frame. Why: ADR 0018.

### 1. Stimulus

`measurement/stimulus.js` normalises a `StimulusSpec`, clamps frequencies to 0.95 of Nyquist
and renders it deterministically. The kinds are sine, log sweep, white, pink, band noise and
chirp. The inverse sweep is derived from the same normalised spec that was played. The engine
renders the stimulus at the running context's sample rate. The recipe stores the normalised
spec, so a repeat plays the same samples.

### 2. Capture

`measurement/engine.js` never touches Web Audio. Everything platform-specific sits behind the
injected `io` (`preflight`, `captureNoise`, `runStimulus`, `cancel`, `dispose`, `now`,
`yield`, `onInterrupt`). `measurement/capture.js` implements `createCaptureIo` on the V2
`AudioEngine`, and `createLoopbackIo`, the TEST CONTEXT of a known synthetic system. Playback
passes the whole master safety chain, and that chain is part of the measured system. Capture
start and stop are frame counts on the audio clock, not timers, and runs never overlap. When
any stage is cancelled, the stimulus fades over 10 ms, the capture is rejected, the worklet
port is closed and every node and track is released. The same cleanup runs on engine abort,
error and completion, on Escape, on a hidden page and on a context that closes. Why
AudioWorklet with a ScriptProcessor fallback and no Worker yet: ADR 0026 and
`docs/v3/spike-audioworklet-worker.md`.

### 3. Analysis

The engine runs `measurement/capture-checks.js` (clipping, dropouts, discontinuities) on each
capture as it returns; a failing capture ends the measurement INVALID before any DSP.
`measurement/analysis-task.js` then packs the offline analysis into one serializable message
(stimulus, captures, noise, f1, f2, phase, aggregation). `runAnalysis` turns it into one
result, in steps that can yield: alignment per run, one spectral division per run for the
transfer and the impulse response, and aggregation over runs. The engine calls
it through its injected `analyze`. The default, `analyzeInline`, runs on the main thread and
yields between steps, so an abort can land between them. A Worker-backed `analyze` would post
the same message (claim `analysis-off-main-thread`, planned). The noise check produces
Welch power and one-third-octave band power through `spectrum.js` and `rta.js`. Why the
sweep deconvolution method: ADR 0021.

### Live RTA

`measurement/live-rta.js` is the real-time analyzer: FFT, octave and one-third-octave bands of
the live input on the same mean-square scale as `spectrum.js`, averaged by `createRtaAverager`
(instant, fast, slow), with peak hold and freeze, frequency calibration on bands and bins and a
level offset only under a valid level calibration. Its samples come from the capture io's
`openLiveTap()` (one AnalyserNode on the measurement input, refused while a capture runs, closed
by every release path). It is feedback in the sense of the rule above: only its explicit
`snapshot()` (an `RtaResult` with algorithm and window IDs) could ever be stored.

### 4. Calibration

`calibration/parse.js` reads CSV, TXT and JSON profiles. `profile.js` normalises a profile and
identifies it by the SHA-256 of its points (`sha256.js`, so it works without
`crypto.subtle` on `file://`). `interpolate.js` applies a profile to a transfer grid or to RTA
bands inside its coverage only, and `level.js` holds the one rule for labelling a level dB
SPL. The engine applies the frequency profile after the analysis into a separate `calibrated`
curve, and the raw curve is never modified. Why two separate kinds: ADR 0020. Why SPL only
under a level calibration: ADR 0017.

### 5. Result

`measure()` resolves with a plain result object that carries no DOM, node or engine
reference: the recipe, the rendered stimulus spec, the input device and its constraints, one
entry per run, `transfer`, `ir`, `aggregate`, `calibrated`, `captureChecks`, `noise`,
`notes`, `timeline` and the `algorithms` used. Raw PCM is dropped unless
`measure(..., { keepRaw: true })` is called, and the UI never calls it that way. Every result
object names its algorithm ID from `measurement/algorithms.js`. Why versioned IDs: ADR 0024.

### 6. Quality

`assessMeasurement(result, ctx)` (engine.js) calls `measurement/quality.js` `assessQuality`
with every run's capture checks, the transfer, the aggregate, the calibration and each run's
sweep window. The output is a `QualityAssessment` with its status, reasons, metrics and
frequency masks. An INVALID assessment ends the measurement INVALID with its failing reasons.
The view models draw the masks: unreliable stretches are dashed and faded, uncalibrated spans
are hatched. Why rules with reasons: ADR 0025.

### 7. Experiment

`ui/measure-experiment.js` `experimentFromResult` is pure. It builds the `Experiment` from a
result, stores the frequency profile by name and identity only, and marks a TEST CONTEXT
capture in every run and in the notes. It then stamps the configuration hash and the result
hash. With two or more runs, `schema.js` `resultsFromMeasurement` stores the aggregate as the
primary response and the transfer as its marked centre (the G20 rule, enforced again by
`validate.js`). `store.js` serialises the experiment to the file form, validates it on every
put and get, and keeps it in the IndexedDB database `oscilla-experiments` (object stores
`experiments` and `summaries`). When that database cannot be opened, it falls back to a memory
store and says so. Export writes the same file form. Import goes through `validate.js` (an
untrusted input with size, type, finiteness, algorithm-ID and hash checks) and `migrate.js`.
Why a recipe and an experiment are separate: ADR 0019. Why IndexedDB with export as the
durable path: ADR 0022. Why schema versions are independent integers: ADR 0023.

### The UI adapters

`src/js/ui/measure.js` and `src/js/ui/experiments.js` are composed into the one Alpine
component. They keep the measurement engine, its io, results with typed arrays, calibration
objects and chart instances in a closure, never in Alpine's reactive state. Engine events go
through the pure reducers of `measurement/views/` (`quality-bar.js`, `announcements.js`), and
results go through the pure view builders (`measure-flow.js`, `response-chart.js`,
`ir-chart.js`, `rta-chart.js`, `experiment-summary.js`, `compare-view.js`).
`charts/measure-charts.js` draws the descriptors with uPlot. The UI computes no level, mask,
range or label. While a measurement is active the instrument cannot play, and leaving the
Measure workspace aborts it.

## Layout

```
src/js/measurement/   algorithms.js  state-machine.js  stimulus.js  spectrum.js
                      capture.js (browser io)  capture-checks.js  align.js  transfer.js
                      impulse-response.js  smoothing.js  rta.js  aggregate.js
                      analysis-task.js  quality.js  format.js  engine.js (orchestration; no DOM)
src/js/measurement/views/   common.js  measure-flow.js  quality-bar.js  response-chart.js
                      ir-chart.js  rta-chart.js  experiment-summary.js  compare-view.js
                      announcements.js
src/js/calibration/   profile.js  parse.js  interpolate.js  level.js  sha256.js
src/js/experiments/   schema.js  migrate.js  validate.js  hash.js  csv.js  store.js  compare.js
                      canonical-json.js  encode.js
src/js/ui/            measure.js  measure-experiment.js  experiments.js
src/js/charts/        measure-charts.js
tests/unit/v3-*.test.mjs        (npm test)
tests/browser/v3-measure.cjs, tests/browser/v3-ui.cjs   (npm run test:measure)
scripts/visual-measure.mjs, tests/visual/measure/       (npm run test:visual)
```

Every module under `measurement/`, `calibration/` and `experiments/` except `engine.js`,
`capture.js` and `store.js` is pure: plain data in, plain data out, no DOM, no Web Audio, no
globals and no `Date.now()` (callers pass timestamps). `engine.js` is DOM-free but owns the
session state. `capture.js` and `store.js` talk to the platform, and `store.js` takes
IndexedDB as an injected dependency. Signals are `Float32Array` and accumulators
`Float64Array`, and inputs are never mutated.

## Shared shapes

```js
// algorithms.js — stable IDs persisted in results (spec §43, §199); every result object
// carries the IDs it used (docs/v3/algorithms.md, "Algorithm registry")
ALGORITHMS = { transfer: 'oscilla.transfer.v1', ir: 'oscilla.ir.log-sweep.v1',
  irFarina: 'oscilla.ir.farina-inverse.v1', rta: 'oscilla.rta.v1',
  smoothing: 'oscilla.smoothing.fractional-octave.v1', normalization: 'oscilla.normalization.v1',
  align: 'oscilla.align.xcorr.v1', clip: 'oscilla.clip.v1',
  discontinuity: 'oscilla.discontinuity.v1', quality: 'oscilla.confidence.v2',
  calibration: 'oscilla.calibration.log-interp.v1', window: 'oscilla.window.hann.v1',
  windowBlackmanHarris: 'oscilla.window.blackman-harris.v1', aggregate: 'oscilla.aggregate.v1' }
VARIANT_OF = { irFarina: 'ir', windowBlackmanHarris: 'window' }   // describeAlgorithm family
RETAINED_ALGORITHMS = { quality: ['oscilla.confidence.v1'] }      // superseded, still implemented
KNOWN_ALGORITHM_IDS = [...ALGORITHMS values, ...retained]         // the import allow-list

// stimulus.js
StimulusSpec = { kind: 'sine'|'log-sweep'|'white'|'pink'|'band-noise'|'chirp',
  sampleRate, duration /* s */, level /* digital peak (0, 1], never SPL */,
  f /* sine */, f1, f2 /* sweep, band, chirp */, fade /* s, raised-cosine in and out */,
  seed /* noises */, color /* band-noise: 'white'|'pink' */, law /* chirp: 'log'|'linear' */ }
  // normalized: every field present, null where the kind does not use it; frozen
normalizeStimulus(spec) -> { spec /* normalized, Nyquist-clamped */, clampedTo /* Hz|null */ }
renderStimulus(spec) -> { spec /* normalized, Nyquist-clamped */, samples: Float32Array,
  clampedTo /* Hz or null */ }
// The sweep inverse is derived from the SAME normalized spec (spec §206):
inverseSweep(spec) -> Float32Array
safeMaxFrequency(sampleRate) -> 0.95 × Nyquist   // the clamp; schema.js uses the same

// spectrum.js — scale 'tone' (default): a full-scale bin-centred sine reads 1 (0 dB);
// scale 'mean-square': Σ P = mean square (FS sine 0.5, −3.01 dB) = the band-level scale
windowFn('hann'|'blackman-harris', n) -> { name, algorithm, samples: Float64Array,
  coherentGain, noisePowerGain, enbwBins }
powerSpectrum(samples, { fftSize, window, offset, scale = 'tone' }) -> Float64Array /* N/2+1 */
welch(samples, { fftSize, overlap = 0.5, window = 'hann', scale = 'tone' }) -> { power:
  Float64Array, segments, fftSize, hop, window, scale, windowAlgorithm }
toneToMeanSquare(power, window) -> Float64Array  // ×1/(2·ENBW) inside, ×1/ENBW at DC, Nyquist
windowAlgorithm(name) -> id;  WINDOW_ALGORITHMS = { hann, 'blackman-harris' }

// capture.js (browser) / capture-checks.js (pure)
Capture = { sampleRate, samples: Float32Array /* mono */, preRoll /* s */, postRoll /* s */,
  startedAt /* AudioContext time */, constraints: { requested, applied /* or null */ },
  device: { label: string|null, id: string|null },
  integrity? /* browser io: { expectedFrames, receivedFrames, discontinuities, timing:
    { scheduledAtFrame, startFrame, armedAtFrame, firstFrame, clockCorrections, gaps } } */ }
  // capture.js frames are the worklet's own quantum count (a stale currentFrame is corrected
  // forward-only; clockCorrections counts them); io.diagnostics() lists the last windows
checkCapture(capture, opts) -> { algorithms: { clip, discontinuity },
  clipping: { ratio, regions: [{ start, end }] }, dropouts: [{ start, end }],
  discontinuities: [{ start, end, jump, ratio|null }], rms, peak, empty: bool, invalid: bool,
  reasons: [{ code /* NO_SAMPLES|BAD_SAMPLE_RATE|NON_FINITE|EMPTY|CLIPPING|DROPOUT|
    DISCONTINUITY */, text }] }

// align.js
align(reference: Float32Array, captured: Float32Array, sampleRate, { maxLagS, minLagS = 0 }) ->
  { algorithm, lagSamples /* fractional, null if no energy */, lagSeconds,
    peakCorrelation /* 0..1 normalized */, polarity /* 1|-1|null */ }

// transfer.js — magnitude required, phase only when alignment is robust (spec §26-§27):
// phase needs options.phase, an align() result and peakCorrelation ≥ PHASE_MIN_CORRELATION
// (0.5); a bare lagSamples gives phaseDeg null with phaseReason 'NO_ALIGNMENT'
computeTransfer({ stimulus, captured, sampleRate, f1, f2, alignment, lagSamples /* default
  alignment.lagSamples */, noise, options: { phase = false, pointsPerOctave = 48 } })
  -> TransferResult
TransferResult = { algorithm, sampleRate, frequencies: Float64Array /* Hz */,
  magnitudeDb: Float64Array /* raw, relative; zero power −300 */, phaseDeg: Float64Array|null,
  snrDb: Float64Array|null, validRange: [fLo, fHi]|null, requestedRange: [f1, f2], fftSize,
  binHz, phaseReason: null|'NOT_REQUESTED'|'NO_ALIGNMENT'|'ALIGNMENT_NOT_ROBUST'|'AGGREGATED',
  alignment: { algorithm, lagSamples, peakCorrelation, polarity }|null,
  derivedFrom? /* 'aggregate': the centre of repeated runs (G20), aggregate.js */ }

// impulse-response.js
computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method,
  lagSamples }) -> IrResult
IrResult = { algorithm /* IR_ALGORITHMS[method]: spectral 'oscilla.ir.log-sweep.v1',
  farina-inverse 'oscilla.ir.farina-inverse.v1' */, method: 'spectral'|'farina-inverse',
  sampleRate, samples: Float32Array /* original scale */, peakIndex, peakTimeS,
  captureOffsetS, noiseFloorDb, window: null|[t0, t1], fftSize }
irWindow(ir, t0, t1) -> { ...ir, window: [t0, t1], view: { startIndex, endIndex, samples } }
normalizeIr(ir, 'peak-db'|'peak-linear') -> { kind: 'normalized', algorithm /* normalization */,
  mode, label, unit, referenceValue, values: Float64Array }
// one spectral division for both (bit-identical to the two calls); fft / noiseSpectrum reuse
computeTransferAndIr({ ...computeTransfer args, irLagSamples, method, inverse, fft,
  noiseSpectrum }) -> { transfer: TransferResult, ir: IrResult }

// smoothing.js — derived views; the raw response is never modified
smoothFractionalOctave(frequencies, magnitudeDb, fraction /* 0 = none, N = 1/N octave */)
  -> Float64Array
smoothResponse(frequencies, magnitudeDb, fraction) -> { kind: 'smoothed', algorithm, fraction,
  label, smoothedDb }
normalizeResponse(frequencies, magnitudeDb, { mode: 'at-frequency', hz }
  | { mode: 'band-mean', lo, hi }) -> { algorithm, mode, normalizedDb, referenceDb, label }

// rta.js — band levels on the mean-square scale (FS sine −3.01 dB); `power` is a mean-square
// array or a spectrum.js welch() result, converted by its stated scale (meanSquarePower)
bandCenters('octave'|'third', fMin, fMax, sampleRate) -> [{ nominal, exact, lo, hi }]
  // selected by nominal label; bands with hi > 0.95 × Nyquist excluded
integrateBands(power, binHz, bands, out?) -> Float64Array /* linear band power */
bandPowers(power, binHz, bands) -> Float64Array /* dB, −Infinity for zero power */
bandBinCounts(binHz, bands, binCount?) -> { binCounts: Float64Array, underResolved: bool[] }
bandAnalysis(power, binHz, bands) -> { algorithm, levelsDb, power, binCounts, underResolved }
createRtaAverager({ mode: 'instant'|'fast'|'slow', peakHold, size }) -> { push(power, dt)
  -> { levelsDb, peakDb|null }, reset, resetPeaks, freeze, unfreeze, frozen, frames, mode, tau,
  peakHold }
rtaResult({ sampleRate, resolution, bands, levelsDb, fftSize = null, window = null })
  -> RtaResult   // the stored form; −Infinity / < −300 dB stored as −300 dB (zero power)
RtaResult = { algorithm, sampleRate, resolution: 'octave'|'third',
  bands: [{ nominal, exact, lo, hi }], levelsDb: Float64Array, fftSize|null,
  windowAlgorithm|null }

// live-rta.js — the live input analysis (feedback, never a stored result): frames of the input
// tap's time-domain samples on the same mean-square scale; push() allocates nothing
createLiveRta({ sampleRate, fftSize = 8192, window = 'hann', mode: 'fft'|'octave'|'third',
  averaging: 'instant'|'fast'|'slow', profile, levelCalibration }) -> { push(samples, dt)
  -> frame { mode, count, values, peaks, frequencies|null, bands|null, covered|null,
  underResolved|null, calibrated, levelOffsetDb, frames, frozen }, setMode, setAveraging,
  setCalibration, freeze, unfreeze, reset, resetPeaks, viewInput(), snapshot() -> RtaResult|null }
// capture.js io — the live input tap on the measurement input (exclusive with a capture)
io.openLiveTap({ fftSize, onClosed(reason) }) -> { analyser, sampleRate, close() }
io.closeLiveTap(); io.liveTapOpen

// aggregate.js — repeated runs on one frequency grid
aggregateRuns(runs: Float64Array[] /* dB */, { method: 'mean'|'median' }) -> { algorithm,
  method, runs, points, centreDb, lowerDb, upperDb, spreadDb, dispersion: 'std'|'p10-p90'|null,
  repeatabilityDb }   // envelope fields null for one run
aggregateResult(aggregate, frequencies) -> AggregateResult   // the stored results.aggregate
AggregateResult = { algorithm, method, dispersion, runs, frequencies: Float64Array,
  centreDb: Float64Array, lowerDb|null, upperDb|null, spreadDb|null, repeatabilityDb|null }
  // zero power −300 dB; validated lowerDb ≤ centreDb ≤ upperDb
// G20 storage rule: with ≥ 2 runs the aggregate is the primary response and the transfer is
transferFromAggregate(stored /* AggregateResult, runs ≥ 2 */, transfers) -> TransferResult
  // magnitudeDb = stored.centreDb (same bits), lowest run snrDb, common validRange, phaseDeg
  // null + phaseReason 'AGGREGATED', alignment null, derivedFrom: 'aggregate'

// analysis-task.js — the offline analysis as ONE serializable task (G21 boundary)
AnalysisMessage = { type: 'oscilla.analysis-task', version: 1, stimulus: Float32Array,
  sampleRate, f1, f2, captures: Float32Array[] /* run order */, noise: Float32Array|null,
  phase: bool, aggregation: 'mean'|'median' }
runAnalysis(message, { now? }) -> AnalysisResult   // pure, structured-cloneable in and out
AnalysisResult = { type: 'oscilla.analysis-result', version: 1, invalid, reasons,
  alignments: [align() per run], transfers: [TransferResult]|null, best: run|null,
  ir: IrResult|null, aggregate: aggregateRuns()|null, steps: [{ name, run, ms|null }] }
analysisSteps(message, { now }) /* generator, one step per next() */;
analyzeInline(message, { now, yield, onStep }) -> Promise<AnalysisResult>  // engine default
analysisTransferList(message, { keepRaw }) / analysisResultTransferList(result) -> buffers
// engine.js: createMeasurementEngine({ ..., analyze /* (message, { now, yield, onStep,
// keepRaw }) -> Promise<AnalysisResult>, default analyzeInline */ })

// quality.js
assessQuality({ capture, transfer, aggregate /* aggregateRuns() or AggregateResult */,
  calibration, requestedRange, resolutionHz, sweepWindow,
  chainNotes /* v2: { limiterDeviationAboveHz }|null */,
  algorithm /* 'oscilla.confidence.v2' (default) | 'oscilla.confidence.v1' */ })
  -> QualityAssessment
QualityAssessment = { algorithm, status: 'GOOD'|'USABLE'|'POOR'|'INVALID',
  reasons: [{ code, scope: 'quality'|'calibration', severity: 'ok'|'warn'|'fail', text, value,
    unit, range? }],
  metrics: { snrMedianDb, snrMinDb, clippingRatio, clippingRegions, dropouts,
    repeatabilityDb, runs, requestedRange, coverage: [fLo, fHi]|null, coverageFraction,
    reliableRanges, unreliableRanges, calibratedRange, frequencyCalibrated, levelCalibrated,
    resolutionHz /* v2 also: discontinuities, outputChainLimitHz */ },
  mask: { frequencies: Float64Array, reliable: Uint8Array, calibrated: Uint8Array } }

// calibration/profile.js — two kinds, never conflated (spec §17)
FrequencyProfile = { schemaVersion: 1, kind: 'frequency', id /* sha-256 of normalized points */,
  name, source: string|null, notes: string|null, units: { frequency: 'Hz', correction: 'dB' },
  points: [[hz, db], ...] /* sorted, unique */, importedAt: string|null }
LevelCalibration = { schemaVersion: 1, kind: 'level', referenceHz, referenceDbSpl,
  observedDbRelative, offsetDb, conditions: string|null, createdAt }
exportProfile(profile) -> { format: 'oscilla.calibration', schemaVersion, kind, id, name,
  source? /* only when given */, units, points, notes, importedAt }
// calibration/interpolate.js
applyFrequencyCorrection(magnitudeDb, frequencies, profile, { extrapolate: 'none'|'hold' })
  -> { algorithm, profileId, correctedDb: Float64Array, covered: Uint8Array,
       coverage: [fLo, fHi], extrapolate }
applyFrequencyCorrectionToBands(rta /* { bands, levelsDb } */, profile, { power, binHz })
  -> { algorithm, profileId, correctedDb, correctionDb /* NaN uncovered */, covered,
       coverage, weighting: 'spectrum'|'flat' }   // power-weighted per band, no extrapolation
// calibration/level.js — the one uncalibrated label (spec §24)
RELATIVE_UNIT = 'dB relative (dBFS-like)'
RELATIVE_SCALE_LABEL = 'Relative level · dBFS-like / analyser-relative scale'
levelLabel(levelCalibration) -> { unit: 'dB SPL'|RELATIVE_UNIT, calibrated,
  indicator: 'CALIBRATED'|'UNCALIBRATED' }

// experiments/schema.js — schema versions are independent of the product version (spec §131)
Experiment = { kind: 'oscilla-experiment', schemaVersion: 1, oscillaVersion, oscillaCommit,
  experimentId, name, recipe: { stimulus /* = renderStimulus(spec).spec, incl. color, law */,
  repeats, analysis }, output: { level },
  input: { device: { label, id }, constraints: { requested, applied } },
  calibration: { frequency: { id, name }|null, level: {...}|null },
  environment: { notes }, measurement: { startedAt, sampleRate, runs },
  quality, algorithms: { role: id }, results: { transfer, ir, rta /* RtaResult */,
    aggregate? /* AggregateResult, optional, presence kept */,
    runTransfers? /* [{ run, transfer }] ≤ LIMITS.runTransfers, only on request (G20) */ },
  provenance: { configHash, resultHash /* SHA-256 of the encoded results, §101 */,
    createdAt, repeatOf /* source experimentId|null */,
    build /* { version, commit, shortCommit, sourceDate, channel, dirty, repository }|null */ } }
// G20: with an aggregate of ≥ 2 runs, results.transfer is its derivedFrom 'aggregate' centre
// or null (never one run's transfer); validate.js enforces it
resultsFromMeasurement(engineResult, { runTransfers: false|true|[run indices] })
  -> { transfer, ir, rta: null, aggregate?, runTransfers? }   // schema.js
// experiments/compare.js
responseOf(experiment|TransferResult|AggregateResult) -> { kind: 'transfer'|'aggregate'|
  'aggregate-centre', frequencies, magnitudeDb, validRange, lowerDb, upperDb, dispersion,
  runs, method }|null          // the aggregate when present (≥ 2 runs), else the transfer
responseDelta(a, b, { pointsPerOctave }) -> { ok, frequencies, aDb, bDb, deltaDb, range,
  pointsPerOctave, label, sources, equivalent /* false: single run vs aggregate */, warnings,
  envelope /* both bounds, overlap, overlapFraction, dispersion, comparable */|null }
// experiments/hash.js
configHash(e) -> hex;  withConfigHash(e, hex);  resultHash(e) -> hex;  withResultHash(e, hex)
// experiments/validate.js verifies resultHash on import: mismatch -> error code 'corrupt'
// In a file, typed arrays are EncodedArray { dtype: 'f32'|'f64'|'u8', length,
// encoding: 'base64-le', data } (experiments/encode.js).
```

Notes on the shapes:

- **Repeated runs (G20).** A repeated measurement stores the aggregate as its primary
  response. `results.transfer` is the aggregate's centre, marked `derivedFrom: 'aggregate'`,
  or null. Individual runs are stored only on request, in `results.runTransfers`.
  `compare.js` compares the aggregate and flags single run vs aggregate.
- **Chain notes.** The engine's `PreflightFacts` may carry `chainNotes`, which are pure data
  (for example `{ limiterDeviationAboveHz: 18000 }`). They are recorded as
  `result.chainNotes` and passed to `assess`. `capture.js` does not set them yet (open in G12).
- **RTA in experiments.** An experiment built by the Measure workspace has `results.rta`
  null. The noise check's band power is shown in the RTA tab but not stored.
- **CSV.** Transfer columns are ratios (`magnitude_db_relative`, `magnitude_db_corrected`).
  `level_db_spl` appears only in RTA CSVs under a valid level calibration.
- **Open: G21.** The combined transfer and IR step is the longest main-thread block. The
  analysis is already one serializable task behind the engine's injected `analyze`, so moving
  it into a `data:` Worker is a build change (planned claim `analysis-off-main-thread`).

The remaining differences between the specification and the code are listed under "Gaps" in
`docs/v3/algorithms.md`.

## Labels (spec §24, §98)

Every displayed quantity is one of REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED,
NORMALIZED. Levels are `RELATIVE_UNIT` "dB relative (dBFS-like)" on the scale
`RELATIVE_SCALE_LABEL` "Relative level · dBFS-like / analyser-relative scale" unless a valid
`LevelCalibration` applies, and only then "dB SPL" with a CALIBRATED indicator; no uncalibrated
output contains "SPL". Smoothed and normalized views say so and carry their algorithm ID.

## Limits (spec §174)

Sweep 1-30 s; repeats 1-10; capture ≤ 40 s mono per run; calibration ≤ 2000 points; imported
experiment ≤ 32 MiB; stored experiments bounded by quota with explicit delete/export.
