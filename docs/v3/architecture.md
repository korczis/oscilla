# OSCILLA V3 measurement architecture (contract)

Specification: `docs/specs/oscilla-v3-measure.md`. Plan: milestones M012-M020. This document says
*how* the layers fit; the ADRs say *why*. Module names and data shapes below are the contract the
parallel work is built against; change them here first.

```
 Recipe ──► StimulusGenerator ──► PlaybackSession ──► output ─┐
   │            (stimulus.js)                                  │  physical system
   │                                                           ▼  (speaker, room, mic, ADC)
   │        CaptureSession ◄── MediaStream input ◄─────────────┘
   │         (capture.js: bounded PCM, pre/post-roll)
   ▼                │
 MeasurementEngine  ▼
 (state machine) ─► offline analysis (pure, deterministic, on captured PCM)
                    alignment → transfer.js / impulse-response.js / rta.js
                    → calibration (calibration/*.js) → MeasurementResult
                    → quality.js (QualityAssessment with reasons)
                    → Experiment (experiments/*.js: schema, provenance, store, compare)
                    → UI adapters and charts (render result objects; never own data)
```

Rule: **PCM capture → deterministic offline DSP → structured MeasurementResult → quality and
provenance → chart.** The live AnalyserNode is feedback only; no final result depends on a
visible frame (spec §84-§85, §248).

## Layout

```
src/js/measurement/   algorithms.js  state-machine.js  stimulus.js  spectrum.js
                      capture.js  capture-checks.js  align.js  transfer.js
                      impulse-response.js  smoothing.js  rta.js  aggregate.js
                      quality.js  format.js  engine.js (orchestration; no DOM)
src/js/calibration/   profile.js  parse.js  interpolate.js  level.js  sha256.js
src/js/experiments/   schema.js  migrate.js  validate.js  hash.js  csv.js  store.js  compare.js
                      canonical-json.js  encode.js
tests/unit/v3-*.test.mjs   (picked up by `npm test`)
```

Not yet landed: `capture.js`, `engine.js` (being written against the shapes below).
`quality.js` landed in e89ff9f. How each algorithm computes its result, and the remaining
mismatches, are in `docs/v3/algorithms.md` (section "Gaps"); `tests/unit/v3-pipeline.test.mjs`
runs the whole chain on the real result objects and keeps the shapes below consistent.

Every module except `engine.js`, `capture.js` and `store.js` is pure: plain data in, plain data
out, no DOM, no Web Audio, no globals, no `Date.now()` (callers pass timestamps). Arrays are
`Float32Array` for signals, `Float64Array` for accumulators; inputs are never mutated.

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
  device: { label: string|null, id: string|null } }
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
  binHz, phaseReason: null|'NOT_REQUESTED'|'NO_ALIGNMENT'|'ALIGNMENT_NOT_ROBUST',
  alignment: { algorithm, lagSamples, peakCorrelation, polarity }|null }

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
  -> { levelsDb, peakDb|null }, reset, freeze, unfreeze, frozen, frames, mode, tau, peakHold }
rtaResult({ sampleRate, resolution, bands, levelsDb, fftSize = null, window = null })
  -> RtaResult   // the stored form; −Infinity / < −300 dB stored as −300 dB (zero power)
RtaResult = { algorithm, sampleRate, resolution: 'octave'|'third',
  bands: [{ nominal, exact, lo, hi }], levelsDb: Float64Array, fftSize|null,
  windowAlgorithm|null }

// aggregate.js — repeated runs on one frequency grid
aggregateRuns(runs: Float64Array[] /* dB */, { method: 'mean'|'median' }) -> { algorithm,
  method, runs, points, centreDb, lowerDb, upperDb, spreadDb, dispersion: 'std'|'p10-p90'|null,
  repeatabilityDb }   // envelope fields null for one run
aggregateResult(aggregate, frequencies) -> AggregateResult   // the stored results.aggregate
AggregateResult = { algorithm, method, dispersion, runs, frequencies: Float64Array,
  centreDb: Float64Array, lowerDb|null, upperDb|null, spreadDb|null, repeatabilityDb|null }
  // zero power −300 dB; validated lowerDb ≤ centreDb ≤ upperDb

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
    aggregate? /* AggregateResult, optional, presence kept */ },
  provenance: { configHash, resultHash /* SHA-256 of the encoded results, §101 */,
    createdAt, repeatOf /* source experimentId|null */,
    build /* { version, commit, shortCommit, sourceDate, channel, dirty, repository }|null */ } }
// experiments/hash.js
configHash(e) -> hex;  withConfigHash(e, hex);  resultHash(e) -> hex;  withResultHash(e, hex)
// experiments/validate.js verifies resultHash on import: mismatch -> error code 'corrupt'
// In a file, typed arrays are EncodedArray { dtype: 'f32'|'f64'|'u8', length,
// encoding: 'base64-le', data } (experiments/encode.js).
```

The shapes above are what the modules produce and what `validate.js` accepts (the former
mismatches G1-G4 are closed). G12 and G15-G19 are closed as described in
`docs/v3/algorithms.md` ("Gaps"); open there: G20 (storing a repeated measurement: aggregate vs
one run's transfer, `compare.js` reads only `results.transfer`) and G21 (the combined
transfer + IR step is the longest main-thread block until the Worker lands). The engine's
`PreflightFacts` may carry `chainNotes` (pure data, e.g. `{ limiterDeviationAboveHz: 18000 }`),
recorded as `result.chainNotes`; `assessMeasurement(result, ctx)` (engine.js) is the standard
`assess`. CSV transfer columns are ratios (`magnitude_db_relative`, `magnitude_db_corrected`);
`level_db_spl` appears only in RTA CSVs under a valid level calibration.

## Labels (spec §24, §98)

Every displayed quantity is one of REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED,
NORMALIZED. Levels are `RELATIVE_UNIT` "dB relative (dBFS-like)" on the scale
`RELATIVE_SCALE_LABEL` "Relative level · dBFS-like / analyser-relative scale" unless a valid
`LevelCalibration` applies, and only then "dB SPL" with a CALIBRATED indicator; no uncalibrated
output contains "SPL". Smoothed and normalized views say so and carry their algorithm ID.

## Limits (spec §174)

Sweep 1-30 s; repeats 1-10; capture ≤ 40 s mono per run; calibration ≤ 2000 points; imported
experiment ≤ 32 MiB; stored experiments bounded by quota with explicit delete/export.
