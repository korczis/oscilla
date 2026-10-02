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

Not yet landed (feature/v3 at b650281): `capture.js`, `quality.js`, `engine.js`. Their shapes
below are still the contract they are built against. How each algorithm computes its result,
and the known mismatches between modules, are in `docs/v3/algorithms.md` (section "Gaps").

Every module except `engine.js`, `capture.js` and `store.js` is pure: plain data in, plain data
out, no DOM, no Web Audio, no globals, no `Date.now()` (callers pass timestamps). Arrays are
`Float32Array` for signals, `Float64Array` for accumulators; inputs are never mutated.

## Shared shapes

```js
// algorithms.js — stable IDs persisted in results (spec §43, §199)
ALGORITHMS = { transfer: 'oscilla.transfer.v1', ir: 'oscilla.ir.log-sweep.v1',
  rta: 'oscilla.rta.v1', smoothing: 'oscilla.smoothing.fractional-octave.v1',
  align: 'oscilla.align.xcorr.v1', clip: 'oscilla.clip.v1', quality: 'oscilla.confidence.v1',
  calibration: 'oscilla.calibration.log-interp.v1', window: 'oscilla.window.hann.v1' }

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

// spectrum.js — tone scaling: a full-scale bin-centred sine reads 1 (0 dB)
windowFn('hann'|'blackman-harris', n) -> { name, samples: Float64Array, coherentGain,
  noisePowerGain, enbwBins }
powerSpectrum(samples, { fftSize, window, offset }) -> Float64Array /* fftSize/2 + 1 */
welch(samples, { fftSize, overlap = 0.5, window = 'hann' }) -> { power: Float64Array,
  segments, fftSize, hop, window }

// capture.js (browser) / capture-checks.js (pure)
Capture = { sampleRate, samples: Float32Array /* mono */, preRoll /* s */, postRoll /* s */,
  startedAt /* AudioContext time */, constraints: { requested, applied /* or null */ },
  device: { label: string|null, id: string|null } }
checkCapture(capture, opts) -> { clipping: { ratio, regions: [{ start, end }] },
  dropouts: [{ start, end }], rms, peak, empty: bool, invalid: bool,
  reasons: [{ code /* NO_SAMPLES|BAD_SAMPLE_RATE|NON_FINITE|EMPTY|CLIPPING|DROPOUT */, text }] }

// align.js
align(reference: Float32Array, captured: Float32Array, sampleRate, { maxLagS, minLagS = 0 }) ->
  { lagSamples /* fractional, null if no energy */, lagSeconds,
    peakCorrelation /* 0..1 normalized */, polarity /* 1|-1|null */ }

// transfer.js — magnitude required, phase only when alignment is robust (spec §26-§27)
computeTransfer({ stimulus, captured, sampleRate, f1, f2, lagSamples, noise,
  options: { phase = false, pointsPerOctave = 48 } }) -> TransferResult
TransferResult = { algorithm, sampleRate, frequencies: Float64Array /* Hz */,
  magnitudeDb: Float64Array /* raw, relative */, phaseDeg: Float64Array|null,
  snrDb: Float64Array|null, validRange: [fLo, fHi]|null, requestedRange: [f1, f2], fftSize,
  binHz }

// impulse-response.js
computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method,
  lagSamples }) -> IrResult
IrResult = { algorithm, method: 'spectral'|'farina-inverse', sampleRate,
  samples: Float32Array /* original scale */, peakIndex, peakTimeS, captureOffsetS,
  noiseFloorDb, window: null|[t0, t1], fftSize }
irWindow(ir, t0, t1) -> { ...ir, window: [t0, t1], view: { startIndex, endIndex, samples } }
normalizeIr(ir, 'peak-db'|'peak-linear') -> { kind: 'normalized', mode, label, unit,
  referenceValue, values: Float64Array }

// smoothing.js — derived views; the raw response is never modified
smoothFractionalOctave(frequencies, magnitudeDb, fraction /* 0 = none, N = 1/N octave */)
  -> Float64Array
normalizeResponse(frequencies, magnitudeDb, { mode: 'at-frequency', hz }
  | { mode: 'band-mean', lo, hi }) -> { mode, normalizedDb, referenceDb, label }

// rta.js — input power on the mean-square scale (Σ power = mean square), not spectrum.js's
bandCenters('octave'|'third', fMin, fMax, sampleRate) -> [{ nominal, exact, lo, hi }]
  // selected by nominal label; bands with hi > 0.95 × Nyquist excluded
integrateBands(power, binHz, bands, out?) -> Float64Array /* linear band power */
bandPowers(power /* linear power per bin */, binHz, bands) -> Float64Array /* dB */
bandBinCounts(binHz, bands, binCount?) -> { binCounts: Float64Array, underResolved: bool[] }
bandAnalysis(power, binHz, bands) -> { levelsDb, power, binCounts, underResolved }
createRtaAverager({ mode: 'instant'|'fast'|'slow', peakHold, size }) -> { push(power, dt)
  -> { levelsDb, peakDb|null }, reset, freeze, unfreeze, frozen, frames, mode, tau, peakHold }
RtaResult /* as stored in an experiment; assembled by the caller */ = { algorithm, sampleRate,
  resolution: 'octave'|'third', bands: [{ nominal, exact, lo, hi }], levelsDb: Float64Array,
  fftSize|null }

// aggregate.js — repeated runs on one frequency grid
aggregateRuns(runs: Float64Array[] /* dB */, { method: 'mean'|'median' }) -> { method, runs,
  points, centreDb, lowerDb, upperDb, spreadDb, dispersion: 'std'|'p10-p90'|null,
  repeatabilityDb }   // envelope fields null for one run

// quality.js
QualityAssessment = { algorithm, status: 'GOOD'|'USABLE'|'POOR'|'INVALID',
  reasons: [{ code, severity: 'ok'|'warn'|'fail', text, value, unit, range? }],
  metrics: { snrMedianDb, clippingRatio, repeatabilityDb, coverage: [fLo, fHi], ... } }

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
// calibration/level.js
levelLabel(levelCalibration) -> { unit: 'dB SPL'|'dB relative (dBFS-like)', calibrated,
  indicator: 'CALIBRATED'|'UNCALIBRATED' }

// experiments/schema.js — schema versions are independent of the product version (spec §131)
Experiment = { kind: 'oscilla-experiment', schemaVersion: 1, oscillaVersion, oscillaCommit,
  experimentId, name, recipe: { stimulus, repeats, analysis }, output: { level },
  input: { device: { label, id }, constraints: { requested, applied } },
  calibration: { frequency: { id, name }|null, level: {...}|null },
  environment: { notes }, measurement: { startedAt, sampleRate, runs },
  quality, algorithms: { role: id }, results: { transfer, ir, rta /* RtaResult */ },
  provenance: { configHash, createdAt, repeatOf /* source experimentId|null */,
    build /* { version, commit, shortCommit, sourceDate, channel, dirty, repository }|null */ } }
// In a file, typed arrays are EncodedArray { dtype: 'f32'|'f64'|'u8', length,
// encoding: 'base64-le', data } (experiments/encode.js).
```

Known mismatches between these shapes as implemented (details in `docs/v3/algorithms.md`,
"Gaps"): the recipe schema does not accept `color` and `law`, so a rendered `StimulusSpec`
cannot be stored as is (G2); validation rejects an `IrResult` carrying `method` and `fftSize`
(G3), a `validRange` of null and non-finite `levelsDb` (G4); `spectrum.js` and `rta.js` use
different power scales (G1).

## Labels (spec §24, §98)

Every displayed quantity is one of REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED,
NORMALIZED. Levels are "dB relative (dBFS-like)" unless a valid `LevelCalibration` applies, and
only then "dB SPL" with a CALIBRATED indicator. Smoothed and normalized views say so.

## Limits (spec §174)

Sweep 1-30 s; repeats 1-10; capture ≤ 40 s mono per run; calibration ≤ 2000 points; imported
experiment ≤ 32 MiB; stored experiments bounded by quota with explicit delete/export.
