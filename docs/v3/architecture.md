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
src/js/calibration/   profile.js  parse.js  interpolate.js  level.js
src/js/experiments/   schema.js  migrate.js  validate.js  hash.js  csv.js  store.js  compare.js
tests/unit/v3-*.test.mjs   (picked up by `npm test`)
```

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
  sampleRate, duration /* s */, level /* digital peak 0..1, never SPL */,
  f /* sine */, f1, f2 /* sweep, band */, fade /* s, raised-cosine in and out */, seed }
renderStimulus(spec) -> { spec /* normalized, Nyquist-clamped */, samples: Float32Array,
  clampedTo /* Hz or null */ }
// The sweep inverse is derived from the SAME normalized spec (spec §206):
inverseSweep(spec) -> Float32Array

// capture.js (browser) / capture-checks.js (pure)
Capture = { sampleRate, samples: Float32Array /* mono */, preRoll /* s */, postRoll /* s */,
  startedAt /* AudioContext time */, constraints: { requested, applied /* or null */ },
  device: { label: string|null, id: string|null } }
checkCapture(capture, opts) -> { clipping: { ratio, regions: [{ start, end }] },
  dropouts: [{ start, end }], rms, peak, empty: bool, invalid: bool, reasons: [] }

// align.js
align(reference: Float32Array, captured: Float32Array, sampleRate) ->
  { lagSamples, lagSeconds, peakCorrelation /* 0..1 normalized */ }

// transfer.js — magnitude required, phase only when alignment is robust (spec §26-§27)
TransferResult = { algorithm, sampleRate, frequencies: Float64Array /* Hz */,
  magnitudeDb: Float64Array /* raw, relative */, phaseDeg: Float64Array|null,
  snrDb: Float64Array|null, validRange: [fLo, fHi], requestedRange: [f1, f2], fftSize, binHz }

// impulse-response.js
IrResult = { algorithm, sampleRate, samples: Float32Array /* original scale */,
  peakIndex, peakTimeS, captureOffsetS, noiseFloorDb, window: null|[t0, t1] }

// rta.js
bandCenters('octave'|'third', fMin, fMax) -> [{ nominal, exact, lo, hi }]
bandPowers(powerSpectrum /* linear power per bin */, binHz, bands) -> Float64Array /* dB */

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

// experiments/schema.js — schema versions are independent of the product version (spec §131)
Experiment = { schemaVersion: 1, oscillaVersion, oscillaCommit, experimentId, name,
  recipe: { stimulus, repeats, analysis }, output: { level }, input: { device, constraints },
  calibration: { frequency: { id, name }|null, level: {...}|null },
  environment: { notes }, measurement: { startedAt, sampleRate, runs },
  quality, algorithms, results: { transfer, ir, rta }, provenance: { configHash, createdAt } }
```

## Labels (spec §24, §98)

Every displayed quantity is one of REQUESTED, DIGITAL, OBSERVED, CALIBRATED, ESTIMATED,
NORMALIZED. Levels are "dB relative (dBFS-like)" unless a valid `LevelCalibration` applies, and
only then "dB SPL" with a CALIBRATED indicator. Smoothed and normalized views say so.

## Limits (spec §174)

Sweep 1-30 s; repeats 1-10; capture ≤ 40 s mono per run; calibration ≤ 2000 points; imported
experiment ≤ 32 MiB; stored experiments bounded by quota with explicit delete/export.
