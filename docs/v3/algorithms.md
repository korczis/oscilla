# OSCILLA V3 measurement algorithms

Specification: `docs/specs/oscilla-v3-measure.md` (§137 algorithm documentation, §186-§187
review and references). Contract: `docs/v3/architecture.md`. Rationale: ADRs 0017-0026 under
`.ai/repo/adrs/`. This document says **how** each algorithm is computed as implemented in
`src/js/`, which tests pin it, and how much margin those tests have. It does not repeat why a
method was chosen; the ADRs do.

Every statement below is traceable to a file and function. Measured margins were taken from
the test diagnostics (`node --test tests/unit/v3-*.test.mjs`) or by re-running the test
computation with the same seeds; they describe the code at `origin/feature/v3` (b650281) and
will drift if the code changes. The integration fixes on top of 88c0daf closed gaps G1-G11 and
G13 and documented G14; sections they changed are marked **Changed (integration)** and give
their own margins. The gap fixes on top of 8628438 closed G12 and G15-G19 (sections marked
**Changed (gaps)**; tests in `tests/unit/v3-gaps.test.mjs` and `tests/unit/v3-golden.test.mjs`). `tests/unit/v3-integration.test.mjs` has one test group per closed gap and
`tests/unit/v3-pipeline.test.mjs` runs the whole chain (stimulus → capture checks → alignment
→ transfer and IR → aggregation → quality → experiment → hashes → JSON → validation) on the
real result objects. Where the code and the specification still disagree, the disagreement is
listed under [Gaps](#gaps), not resolved here.

## Contents

| ID | Module (function) | Section |
| --- | --- | --- |
| (none; recorded through the recipe) | `measurement/stimulus.js` | [Stimuli](#stimuli) |
| `oscilla.window.hann.v1`, `oscilla.window.blackman-harris.v1` | `measurement/spectrum.js` | [Windows, spectra, Welch](#windows) |
| `oscilla.clip.v1`, `oscilla.discontinuity.v1` | `measurement/capture-checks.js` | [Capture checks](#capture-checks) |
| `oscilla.align.xcorr.v1` | `measurement/align.js` | [Alignment](#alignment) |
| `oscilla.transfer.v1` | `measurement/transfer.js` | [Transfer function](#transfer) |
| `oscilla.ir.log-sweep.v1` (spectral), `oscilla.ir.farina-inverse.v1` | `measurement/impulse-response.js` | [Impulse response](#ir) |
| `oscilla.smoothing.fractional-octave.v1`, `oscilla.normalization.v1` | `measurement/smoothing.js` | [Smoothing](#smoothing) |
| `oscilla.rta.v1` | `measurement/rta.js` | [RTA bands](#rta) |
| `oscilla.aggregate.v1` | `measurement/aggregate.js` | [Aggregation of repeats](#aggregate) |
| `oscilla.calibration.log-interp.v1` | `calibration/*.js` | [Frequency calibration](#calibration) |
| (none) | `calibration/level.js` | [Level calibration, SPL](#level) |
| (none) | `measurement/format.js` | [Resolution-aware formatting](#format) |
| (none) | `experiments/*.js` | [Experiment hashing, encoding](#experiments) |
| `oscilla.confidence.v2` (default), `oscilla.confidence.v1` (retained) | `measurement/quality.js` | [Quality](#quality) |
| (all IDs) | `tests/unit/fixtures/v3/*.json` | [Golden outputs per ID](#golden) |

## Conventions

- Signals are `Float32Array` (inputs, stimuli, IR samples); accumulators and derived curves are
  `Float64Array`. No module mutates its inputs; every test file checks this for its module.
- "dB" always means `10·log10(power)` or `20·log10(amplitude)` of a **digital** quantity.
  Nothing in the analysis layer knows sound pressure; see [Level calibration](#level).
- **Power scales — one definition** (`spectrum.js` header, `POWER_SCALES`; Changed
  (integration), was G1). Two scales exist for two purposes and the conversion between them is
  explicit and named:
  - **Tone scale** (`'tone'`, the default of `powerSpectrum`/`welch`): a full-scale sine centred
    on a bin reads power 1, 0 dB (AES17-style dBFS). For reading the amplitude of a tone.
  - **Mean-square scale** (`'mean-square'`): Σ power over all bins equals the signal's mean
    square, so a full-scale sine reads 0.5, −3.01 dB, whatever the window. **Every band level
    is on this scale** (`rta.js`), so a full-scale sine reads −3.01 dB in its band.
  - `toneToMeanSquare(P, window)` converts: × 1/(2·ENBW) for 0 < k < N/2, × 1/ENBW at DC and
    Nyquist. `welch()` and `powerSpectrum()` take `{ scale }`, `welch()` reports the scale it
    used, and `rta.js` accepts a `welch()` result object and converts it by its stated scale,
    so the old error (a bare tone-scale array read as mean-square, +4.77 dB Hann, +6.03 dB
    Blackman-Harris) cannot happen when the result object is passed.
- **Zero power** (Changed (integration), was part of G4): every *stored* result uses
  `ZERO_POWER_DB = −300` dB (`transfer.js`) as the one JSON-safe encoding of zero power —
  `transfer.js` and `impulse-response.js` floor at it, `rta.js` `rtaResult()` maps
  `−Infinity` and anything below −300 dB to it. Intermediate arrays (`spectrum.js` `toDb`,
  `rta.js` `powerToDb`/`bandPowers`/the averager, `aggregate.js`) keep exact `−Infinity`;
  `validate.js` rejects non-finite stored values.
- Uncertainty wording follows the GUM (JCGM 100:2008): values are estimates, tolerances below
  are test acceptance bounds derived from stated error sources, not claimed measurement
  uncertainties of a physical setup.

## Algorithm registry (`measurement/algorithms.js`)

`ALGORITHMS` is a frozen map of role to ID. Grammar: `oscilla.<family>[.<variant>].v<integer>`,
lowercase, `-` inside segments (`ID_PATTERN`). `isKnownAlgorithm(id)` is true only for an exact
ID this build implements. `describeAlgorithm(id)` returns `{ id, family, version }` for any
well-formed ID (so `oscilla.transfer.v2` from a newer build is described, not rejected);
`family` is the `ALGORITHMS` key whose ID has the same stem (`oscilla.confidence.v1` belongs to
family `quality`), else the first name segment.

**Changed (integration)** (was G6, G7). Variant keys name an alternative method of a role
(`VARIANT_OF`): `irFarina` (`oscilla.ir.farina-inverse.v1`, family `ir`) and
`windowBlackmanHarris` (`oscilla.window.blackman-harris.v1`, family `window`). New roles:
`normalization` (`oscilla.normalization.v1`) and `discontinuity` (`oscilla.discontinuity.v1`).
Every result object now carries the IDs it used:

| Result | Field | ID(s) |
| --- | --- | --- |
| `computeTransfer` | `algorithm`; `alignment.algorithm` | transfer; align (when phase used one) |
| `computeImpulseResponse` | `algorithm` (by `method`, `IR_ALGORITHMS`) | ir or irFarina |
| `align` | `algorithm` | align |
| `checkCapture` | `algorithms: { clip, discontinuity }` | clip, discontinuity |
| `windowFn`, `welch` | `algorithm`; `windowAlgorithm` | window or windowBlackmanHarris |
| `bandAnalysis`, `rtaResult` | `algorithm`; `windowAlgorithm` (RtaResult) | rta; window |
| `smoothResponse` | `algorithm` | smoothing |
| `normalizeResponse`, `normalizeIr` | `algorithm` (+ `mode`) | normalization |
| `assessQuality` | `algorithm` | quality (the rule set used: v2 by default, v1 on request) |
| `aggregateRuns`, `aggregateResult` | `algorithm` (+ `method`) | aggregate |
| `applyFrequencyCorrection`, `applyFrequencyCorrectionToBands` | `algorithm` | calibration |

`smoothFractionalOctave` still returns a bare array (used internally by `transfer.js` and
`quality.js`); `smoothResponse` is its labelled, ID-carrying view.

**Changed (gaps)** (G15, G16). `quality` is now `oscilla.confidence.v2`; the superseded
`oscilla.confidence.v1` stays implemented and registered in `RETAINED_ALGORITHMS` (`{ quality:
['oscilla.confidence.v1'] }`, ADR 0024 "old IDs stay in the registry as long as stored data may
carry them"). `isKnownAlgorithm()` is true for current and retained IDs, and
`KNOWN_ALGORITHM_IDS` (both) is the allow-list to pass to `validateExperiment` /
`openExperimentStore` as `knownAlgorithms`: `ALGORITHMS` alone names only the defaults and
would reject a stored v1 assessment. New role `aggregate` (`oscilla.aggregate.v1`): the
aggregate became a stored result, so it carries an ID (`aggregateRuns().algorithm`,
`aggregateResult().algorithm`); mean or median is its recorded `method` parameter.

Tests: `v3-measurement-core.test.mjs` "algorithms: frozen contract IDs ..." (exact equality,
variants report their family); `v3-integration.test.mjs` "G6/G7/G9" pins every ID string and
every result field above.

<a id="stimuli"></a>
## Stimuli (`measurement/stimulus.js`)

No algorithm ID: the stimulus is fully described by its normalized spec, which the recipe
stores (§103), so the spec itself is the record. **Changed (integration)** (was G2): the
recipe stores exactly `renderStimulus(spec).spec`, including `color` and `law`, and checks it
against this module's constants (`DURATION_LIMITS`, `SAMPLE_RATE_LIMITS`, fade ≤ duration/4,
`MIN_FREQUENCY_HZ` ≤ f ≤ `safeMaxFrequency(sampleRate)`); see
[Experiments](#experiments).

### Normalization: `normalizeStimulus(spec) → { spec, clampedTo }`

- Kinds `STIMULUS_KINDS`: `sine`, `log-sweep`, `white`, `pink`, `band-noise`, `chirp`.
- `sampleRate` must lie in `SAMPLE_RATE_LIMITS` = [8000, 384000] Hz.
- `duration` limits `DURATION_LIMITS` (s): sine, white, pink, band-noise 0.05-30; log-sweep
  1-30 (contract limit, §174); chirp 0.005-1.
- `level` is a digital peak in (0, 1], default `0.5`. It is never SPL.
- `fade` (raised cosine in and out) defaults per kind (sine/noise 0.02 s, log-sweep 0.01 s,
  chirp duration/10), capped at duration/4; outside [0, duration/4] it throws.
- Frequencies below `MIN_FREQUENCY_HZ = 1` throw. Frequencies above
  `SAFE_NYQUIST_FRACTION · sampleRate/2` (0.95 × Nyquist) are **clamped** and the clamp is
  reported as `clampedTo` (Hz); the limit is `safeMaxFrequency(sampleRate)`, the one
  expression `schema.js` also uses; everything else invalid throws `StimulusError` with a code
  (`BAD_SPEC`, `UNKNOWN_KIND`, `BAD_SAMPLE_RATE`, `BAD_DURATION`, `BAD_LEVEL`, `BAD_FADE`,
  `BAD_SEED`, `BAD_FREQUENCY`, `BAD_OPTION`). After clamping `f1 < f2` is required.
- Defaults: sine 1 kHz / 1 s; log-sweep 20 Hz-20 kHz / 5 s; band-noise 20 Hz-20 kHz, colour
  `white`; chirp 20 Hz-20 kHz / 50 ms, law `log`; seed 1 (rounded, `>>> 0`).
- The result spec is frozen, carries every field (`null` where unused, e.g. `seed` for tones),
  and normalization is idempotent.

### Rendering: `renderStimulus(spec) → { spec, samples, clampedTo }`

`N = max(2, round(duration · sampleRate))` samples, computed in double precision and returned as
`Float32Array`.

- **Sine**: `x[i] = A·sin(2π·f·i/sr)`.
- **Log sweep** (Farina 2000): `L = T / ln(f2/f1)` (`sweepConstant`),
  `x[i] = A·sin(2π·f1·L·expm1(i/(sr·L)))`; instantaneous frequency `f1·e^(t/L)`
  (`instantaneousFrequency`), equal time per octave, −3 dB/octave power spectrum.
- **Chirp**: law `log` uses the sweep formula; law `linear` uses
  `x(t) = A·sin(2π(f1·t + (f2 − f1)·t²/(2T)))`.
- **White**: V2 `mulberry32(seed)` PRNG through `fillWhite` (uniform in [−1, 1)).
- **Pink**: V2 `fillPink` — Paul Kellet's seven-section filter (pole coefficients 0.99886,
  0.99332, 0.969, 0.8665, 0.55, −0.7616 plus a one-sample term) over the uniform white noise,
  run twice over the same white sequence so the filter state is warm (loop-seamless), then the
  realization's DC is removed. This is an engineering approximation: Kellet's published accuracy
  is about ±0.05 dB of −3 dB/octave above ~10 Hz **at 44.1 kHz**; the coefficients are fixed, so
  at another rate the pole frequencies scale by `sampleRate/44100` (at 96 kHz the pink range
  starts near 22 Hz). The expected spectrum, not one realization, is pink.
- **Band noise**: frequency-domain synthesis of size `nextPow2(N)`. For each bin
  `f1 ≤ f_k ≤ f2` a random phase (seeded PRNG) and magnitude `g` (`white`) or `g/√f_k`
  (`pink`), where `g` is a raised-cosine taper over the outer
  `min(BAND_EDGE_TAPER_OCT, bandOctaves/4)` octaves (`BAND_EDGE_TAPER_OCT = 1/12`); bins
  outside the band are zero; Hermitian spectrum, one inverse FFT, first N samples kept. A band
  with no bin throws.
- Every kind then gets the raised-cosine fade `g = 0.5 − 0.5·cos(π·i/F)` over
  `F = round(fade·sr)` samples at both ends, so the first and last samples are exactly 0.
  Tones have amplitude `level`; the three noises are scaled so their **sample peak** equals
  `level` (`scalePeak`), so their RMS depends on the realization.

### Inverse sweep: `inverseSweep(spec) → Float32Array`

Built from the **same normalized spec** (§206): the rendered sweep (with its fades and any
clamp) reversed in time and weighted by `e^(−i/(sr·L))` (+6 dB/octave across the reversed
sweep), times

```
C = 4·f1·e^((N−1)/(sr·L)) / (sr²·A²·L)
```

derived from the stationary-phase sweep spectrum `|X(f)| ≈ sr·(A/2)·√(L/f)`, so that
`sweep ⊛ inverse` peaks at index N − 1 with unit gain across the band (exactly 1 at
`√(f1·f2)` up to the stationary-phase error). Production deconvolution does not use it (see
[Transfer](#transfer)); it is the Farina oracle and the input of the `farina-inverse` IR method.

### Assumptions and limits

The fades and the clamp change the emitted spectrum near the band edges; the transfer and IR
divide by the spectrum of the exact rendered samples, so this does not bias them. Noise RMS is
not controlled (peak normalization). Pink accuracy outside 44.1 kHz is not separately tested.

### Tests (`v3-measurement-core.test.mjs`)

| Test | Tolerance | Measured |
| --- | --- | --- |
| clamp to 0.95 × Nyquist at 44.1/48/96 kHz, idempotence | exact | exact |
| coded validation errors | exact codes | exact |
| length, fades (first/last = 0), peak ≤ level, determinism | peak ≤ level·(1+1e-6) | pass |
| log-sweep instantaneous frequency, start/middle/end | `2·f·((D/L)²/24 + timing)` | pass |
| sweep ⊛ inverse: peak index | ±1 sample | 0 (44.1, 48 kHz) |
| sweep ⊛ inverse: residue outside ±5 ms | ≤ −40 dB | −60.2 / −60.1 dB |
| sweep ⊛ inverse: gain at √(f1·f2) | ±0.05 dB | −0.00007 / +0.00032 dB |
| pink PSD slope 100 Hz-10 kHz (Welch, 8192) | −3.01 ± 0.5 dB/oct | −3.018, −3.008 |
| white slope | ±0.5 dB/oct | −0.006 |
| band noise in-band vs out-of-band | ≥ 30 dB | 123.4 (white), 122.9 (pink) |
| band pink slope | −3.01 ± 0.5 dB/oct | −2.984 |

<a id="windows"></a>
## Windows, power spectrum and Welch — `oscilla.window.hann.v1`, `oscilla.window.blackman-harris.v1` (`measurement/spectrum.js`)

### Windows: `windowFn(name, n) → { name, algorithm, samples, coherentGain, noisePowerGain, enbwBins }`

Periodic (DFT-even) forms with period N (Harris 1978):

```
hann              w[n] = 0.5 − 0.5·cos(2πn/N)        coherentGain 0.5, noisePowerGain 0.375
blackman-harris   w[n] = a0 − a1·cos(x) + a2·cos(2x) − a3·cos(3x),  x = 2πn/N
                  a = 0.35875, 0.48829, 0.14128, 0.01168 (−92 dB side lobes)
                  coherentGain a0, noisePowerGain a0² + (a1² + a2² + a3²)/2
enbwBins = noisePowerGain / coherentGain²            1.5 (Hann), ≈ 2.0044 (Blackman-Harris)
```

The gains are exact constants (`WINDOW_GAINS`) because the windows are periodic. Each window
result carries its ID (`algorithm`, `WINDOW_ALGORITHMS`, `windowAlgorithm(name)`).

### Power spectrum: `createPowerSpectrumAnalyzer(fftSize, window, { scale })`, `powerSpectrum(samples, opts)`

`fftSize/2 + 1` bins, samples outside the input count as zeros. Tone scaling (default):

```
P[k] = |2·X[k] / (N·coherentGain)|²    0 < k < N/2
P[k] = |X[k] / (N·coherentGain)|²      k = 0, N/2
```

Mean-square scaling (`scale: 'mean-square'`; Changed (integration)):

```
P[k] = 2·|X[k]|² / (N·Σw²)             0 < k < N/2       (N·Σw² = N²·noisePowerGain)
P[k] = |X[k]|² / (N·Σw²)               k = 0, N/2
toneToMeanSquare(P, window) = P / (2·enbwBins)  inside,  P / enbwBins  at k = 0, N/2
```

A full-scale sine centred on a bin reads `P = 1`, 0 dB after `toDb`. Off-centre tones read
lower by the scalloping loss (up to 1.42 dB Hann, 0.83 dB Blackman-Harris). For broadband
signals Σ P over a band overstates the band's tone-scale power by `enbwBins`; dividing by
`2·enbwBins·binHz` gives a density per Hz on the same scale (header comment). `powerSpectrum`'s
default `fftSize` is the largest power of two that fits. `binHz(sr, n) = sr/n`.

### Welch: `welch(samples, { fftSize, overlap = 0.5, window = 'hann', scale = 'tone' })`

Returns `{ power, segments, fftSize, hop, window, scale, windowAlgorithm }` (`scale` and
`windowAlgorithm` added by the integration fixes; `scale` option, default `'tone'`).
`hop = max(1, round(fftSize·(1 − overlap)))`, segments start at 0, hop, 2·hop … while a full
segment fits, and `power` is the mean of the **linear** spectra on the requested scale (Welch
1967). `overlap` must lie in [0, 0.95]; input
shorter than one segment throws instead of zero-padding.

### Assumptions and limits

The transfer function and IR use no analysis window (whole-buffer DFT), so a window ID applies
to Welch/RTA analyses only. Passing a bare tone-scale array (not the `welch()` result) to
`rta.js` still reads 10·log10(2·ENBW) high; pass the result object or convert explicitly.

### Tests (`v3-measurement-core.test.mjs`)

| Test | Tolerance | Measured |
| --- | --- | --- |
| window gains vs Σw/N, Σw²/N; ENBW | 1e-12 (ENBW BH 1e-4) | pass |
| full-scale bin-centred sine, Hann and Blackman-Harris | 0 ± 0.05 dB | −4.3e-9 dB |
| half-bin scalloping (Hann) | −1.4236 ± 0.01 dB | pass |
| −20 dB amplitude at an offset frame | ±0.05 dB | pass |
| Welch equals mean of per-segment spectra | relative 1e-12 | pass |
| white-noise level `4σ²·ENBW/N` | ±0.25 dB | −0.014 dB |
| dB-averaging bias (proves linear averaging) | gap in (1, 4) dB | 2.52 dB |
| (integration) FS sine at the 1 kHz octave/third centre, 44.1/48/96 kHz, Hann and BH, `welch()` result, mean-square `welch()` and `toneToMeanSquare` into `bandPowers` | −3.0103 ± 1e-3 dB | ≤ 2.3e-7 dB |
| (integration) a bare tone-scale array reads 10·log10(2·ENBW) high | ± 1e-3 dB | pass |
| (integration) one mean-square frame of a FS sine sums to 0.5; equals `toneToMeanSquare` | ± 1e-3 dB; 1e-12 rel. | pass |

The ±1e-3 dB bound for the band level covers window leakage beyond 12 bins from the tone (Hann
sidelobes ≈ −72 dB there, Blackman-Harris −92 dB: < 1e-6 of the power), the 2f cross term of a
non-bin-centred tone (< 1e-6) and float32 input rounding (≈ −150 dB).

<a id="capture-checks"></a>
## Capture checks — `oscilla.clip.v1`, `oscilla.discontinuity.v1` (`measurement/capture-checks.js`)

`checkCapture(capture, opts) → { algorithms: { clip, discontinuity }, clipping: { ratio,
regions }, dropouts, discontinuities, rms, peak, empty, invalid, reasons }`. Digital integrity
only; a capture that passes can still be acoustically wrong. Regions are half-open
`[start, end)`.

- **Clipping**: a sample is at the rail when `|x| ≥ CLIP_THRESHOLD = 0.98` (−0.18 dBFS). A
  region is a run of at least `CLIP_MIN_RUN = 3` consecutive rail samples; regions closer than
  `CLIP_MERGE_GAP_S = 0.005` s are merged into one overload event.
  `ratio = rail samples inside regions / total samples`.
- **Dropout**: a run of at least `max(2, ceil(DROPOUT_MIN_S·sr))` samples
  (`DROPOUT_MIN_S = 0.02` s) whose peak-to-peak spread stays within
  `CONSTANT_TOLERANCE = 2^−20` (≈ −120 dBFS), that touches neither the first nor the last
  sample (edge silence is left to alignment) and is not at the rail.
- **Empty**: `20·log10(rms) < EMPTY_RMS_DBFS = −90`.
- **Non-finite** samples are counted and left out of the RMS sum (the mean still divides by
  all samples).
- **Discontinuity** (Changed (integration), was G5; ID `oscilla.discontinuity.v1`): a step
  between consecutive samples far beyond the signal's own local slope. With `d[i] = x[i] −
  x[i−1]`, the boundary between b − 1 and b is flagged when

  ```
  rms_local = RMS of d over [b − W, b + W] without [b − H, b + H]   W = 5 ms, H = 2 samples
  |d[b]| ≥ DISCONTINUITY_RATIO · rms_local          (8)
  |d[b]| ≥ DISCONTINUITY_MIN_JUMP                   (2^−12 ≈ −72 dBFS)
  sign(d[b])·(x[b+w] − x[b−1]) > |d[b]|/2  and  sign(d[b])·(x[b] − x[b−1−w]) > |d[b]|/2,
  w = 1 … H                                        (DISCONTINUITY_HOLD, _HOLD_FRACTION)
  ```

  For any single sinusoid max|d| = √2·rms(d) whatever its frequency, so a full-scale tone just
  below Nyquist (|d| up to 2) is never flagged, while a phase-reversing splice of a 440 Hz tone
  is ≈ 49× its rms(d); Gaussian noise exceeds 8σ_d with probability ≈ 1e-15 per sample. The
  persistence condition separates a step from a 1-2 sample transient (which returns to its old
  level); with ratio 8 a sinusoid's own slope moves the level by at most 2·√2/8 = 0.35·|d[b]|
  within two samples, below the half a step must keep. Steps explained elsewhere are not
  reported again: any rail sample in [b − 1 − H, b + H], a boundary of a reported dropout, the
  onset or end of edge silence. Regions are `[b − 1, b + 1)` (merged when touching) with
  `jump` and `ratio` (null when rms_local is 0). The rolling sums are re-summed exactly every
  1024 samples so they cannot drift (cost O(n): 53 ms for 40 s at 48 kHz, 0.46 s at 384 kHz on
  the test machine). A step smeared over several samples by a filter after the splice is not
  single-sample and may be missed.
- Reason codes: `NO_SAMPLES`, `BAD_SAMPLE_RATE`, `NON_FINITE`, `EMPTY`, `CLIPPING`, `DROPOUT`,
  `DISCONTINUITY`; `invalid` is true exactly when `reasons` is non-empty. All thresholds are
  overridable through `opts`.

Limits: RMS and peak are digital (dBFS), not acoustic. **Changed (gaps)** (was G15):
`quality.js` reads `discontinuities` from `oscilla.confidence.v2` on (inside the sweep window
invalidating, outside warning; see [Quality](#quality)); `oscilla.confidence.v1` does not.

Tests (`v3-measurement-core.test.mjs`, all exact): clipped sine gives one merged region equal to
an independent rail-run reference and the exact ratio; one or two 0.99 samples are not clipping,
three are; 50 ms of zeros inside is a dropout `[20000, 22400)`, 10 ms is not, a frozen non-zero
value is, leading silence is not; silence is `EMPTY` (not a dropout); −100 dBFS RMS noise is
empty, −60 dBFS is not; NaN, empty input and missing sample rate give their codes.
`v3-integration.test.mjs` "G5" (exact): a phase-reversed 440 Hz splice gives one region
`[s − 1, s + 1)` with ratio > 40 and reason `DISCONTINUITY`; a 0.05 DC step under a 100 Hz
tone is found at its sample; a 10 ms zero gap (not a dropout) is reported through its edges;
not flagged: 0.97-amplitude tones at 0.95 × Nyquist (44.1/48/96 kHz), Gaussian noise, pink
noise, a log sweep, 1- and 2-sample spikes, an abrupt onset after edge silence and the edges of
a reported dropout. `v3-pipeline.test.mjs`: three noisy low-pass sweep captures pass.

<a id="alignment"></a>
## Alignment — `oscilla.align.xcorr.v1` (`measurement/align.js`)

`align(reference, captured, sampleRate, { maxLagS, minLagS = 0 }) → { algorithm, lagSamples,
lagSeconds, peakCorrelation, polarity }` (`algorithm` = `ALIGN_ALGORITHM`, added by the
integration fixes).

```
r[l] = Σ_n ref[n]·cap[n + l]      for l in [minLag, maxLag]
```

computed as `IFFT(conj(REF)·CAP)` with both signals zero-padded to
`nextPow2(Nref + min(Ncap, maxLag + Nref) − 1)`, so the circular correlation equals the linear
one for every searched lag. Both real inputs share one complex FFT (`ref + j·cap`, split by
conjugate symmetry). The lag is the argmax of `|r|`; `polarity` is the sign of `r` there (−1
for an inverted chain). A parabola through the three samples around the peak (V2
`parabolicPeak`, offset clipped to ±0.5) refines it to a fractional lag. `minLag` defaults to 0,
`maxLag` to the whole capture.

```
peakCorrelation = |r[l]| / √(Σ ref² · Σ_{n=l}^{l+Nref−1} cap²[n])     (0 … 1, Cauchy-Schwarz)
```

Noise, a non-flat system response, or a capture that ends before the stimulus all lower it.
If either input has no energy, the result is `lagSamples: null, peakCorrelation: 0`.

**What it is not**: the lag is the offset of the stimulus inside this capture buffer. It
includes the browser's and the device's output and input pipeline delays, which are unknown and
cannot be separated from the acoustic path without a loopback reference. It is not acoustic
latency or time of flight (§91, §215), and nothing in the code subtracts a propagation delay.

Tests (`v3-measurement-core.test.mjs`):

| Test | Tolerance | Measured |
| --- | --- | --- |
| delays 0, 123, 4800 samples, clean | ±0.5 sample; ρ > 0.999 | error 0; ρ = 1.0000 |
| same at 0 dB SNR | ±0.5 sample; ρ = 1/√2 ± 0.03 | ≤ 0.0032 sample; ρ − 1/√2 ≤ 0.0011 |
| inverted polarity at 777 samples, scale 0.5 | ±0.5; polarity −1; ρ > 0.999 | pass |
| lag limit below the true delay | lag ≤ 500, ρ < 0.5 | pass |
| silent capture | lag null, ρ 0 | pass |

<a id="transfer"></a>
## Transfer function — `oscilla.transfer.v1` (`measurement/transfer.js`)

`computeTransfer({ stimulus, captured, sampleRate, f1, f2, lagSamples, alignment, noise,
options: { phase = false, pointsPerOctave = 48 } }) → TransferResult` (`alignment`,
`phaseReason` and the result's `alignment` added by the integration fixes). Method: regularized
spectral division (Müller & Massarani 2001, §5; regularization after Kirkeby et al. 1998),
shared with the IR through `spectralDeconvolution`.

### Deconvolution (`spectralDeconvolution`)

```
N      = nextPowerOfTwo(len(x) + len(y))           no circular wrap of any lag
X, Y   = N-point DFTs of x, y (zero padded), from one complex FFT of x + j·y (realPairSpectra)
H[k]   = Y[k]·conj(X[k]) / (|X[k]|² + ε[k])        bins 0 … N/2
```

`ε[k]` (`regularizationProfile`, constants `REGULARIZATION`):

```
P_max  = max |X[k]|² over bins in [f1, min(f2, Nyquist)]
ε_dB   = −60 inside [f1, f2], 0 outside, joined over 1/3 octave beyond each edge by
         ε_dB = −60 + 60·(1 − cos(π·t))/2,  t = log2(f1/f)/(1/3) below, log2(f/f2)/(1/3) above
ε[k]   = P_max · 10^(ε_dB/10)                       (DC: 0 dB)
```

In band the magnitude bias is `−10·log10(1 + ε/|X|²)`: about 0.004-0.006 dB where `|X|²` is
~30 dB below its maximum, as at the top of a 20 Hz-20 kHz exponential sweep. Outside the
excited band the estimate is pulled toward zero instead of dividing by noise. A stimulus with no
energy in [f1, f2] throws.

### Magnitude grid

`frequencies = logGrid(f1, min(f2, Nyquist), pointsPerOctave)`: `f1·2^(i/48)`. Each grid point
owns the bins in `[f·2^(−1/96), f·2^(1/96))`; an empty band uses the nearest bin
(`gridBins`). Then

```
magnitudeDb[i] = 10·log10( mean_{k in band i} |H[k]|² )     (power mean, never a mean of dB)
```

dB relative to a unity digital transfer (0 dB: the capture equals the stimulus), raw: no
smoothing, no calibration (§159). A pure delay does not change it.

### Phase (§27: never faked, only if robust) — Changed (integration), was G8

Reported only when `options.phase === true` **and** an `align()` result is passed as
`alignment` **and** `alignment.peakCorrelation ≥ PHASE_MIN_CORRELATION = 0.5` (with a finite
lag). Otherwise `phaseDeg` is `null` and `phaseReason` is `NOT_REQUESTED`, `NO_ALIGNMENT` or
`ALIGNMENT_NOT_ROBUST` (`PHASE_REASONS`); with a phase, `phaseReason` is `null`. A bare
`lagSamples` (the old call form) is accepted but is not evidence of a robust alignment: it
yields `phaseReason: 'NO_ALIGNMENT'`. The lag removed is `lagSamples` when given, else
`alignment.lagSamples`; each bin is rotated by `e^(+j2πk·lag/N)`, the rotated complex values
are averaged over the grid band, and the angle is reported wrapped to (−180°, 180°]. The
result records `alignment: { algorithm, lagSamples, peakCorrelation, polarity }` (or null).

Why 0.5 — **Changed (gaps)** (was G17): an **engineering choice**, now with the relation it
rests on measured. ρ² is the fraction of the capture's energy in the stimulus window that one
scaled, delayed copy of the stimulus explains. For a flat system in white noise of broadband
SNR s (signal over noise power in the sweep window) Σcap² = (1 + 1/s)·Σsig² and the correlation
peak is Σsig², so

```
ρ = 1 / √(1 + 1/s)        ρ = 0.5  ⇔  s = 1/3 (−4.77 dB)
```

Measured (1 s, 48 kHz, 20 Hz-20 kHz sweep, Gaussian noise, 3 seeds; phase error after removing
the alignment lag, 1/48-octave points in 100 Hz-10 kHz):

| broadband SNR | ρ predicted | ρ measured | max lag error | median / max phase error |
| --- | --- | --- | --- | --- |
| 20 dB | 0.995 | 0.9951 | 0.0003 samples | 0.39° / 2.2° |
| 10 dB | 0.954 | 0.9537 | 0.0009 | 1.2° / 6.7° |
| 0 dB | 0.707 | 0.7092 | 0.0029 | 3.9° / 19.4° |
| −4.77 dB | 0.500 | 0.5035 | 0.005 | 6.8° / 30.6° |
| −10 dB | 0.302 | 0.3058 | 0.0092 | 12.4° / 63.2° |

Without noise, a 2nd-order low-pass lowers ρ by spectral mismatch alone: 0.953 at 8 kHz, 0.80
at 1 kHz, 0.68 at 300 Hz, 0.56 at 100 Hz, 0.46 at 50 Hz (the lag is then the group delay, 200
samples at 50 Hz). So the threshold is not where alignment fails — the lag is accurate to
0.005 samples at ρ = 0.5 for a 1 s sweep — nor a phase-error bound: in noise the phase error is
set by the per-point SNR (`snrDb`), not by ρ. The cut withholds a phase when less than a quarter
of the captured energy is a delayed copy of the stimulus (noise below −4.8 dB broadband SNR, a
system band-limited to well under 100 Hz on a 20 Hz-20 kHz sweep, or mostly reverberant
energy), where the single delay removed from the phase is not a meaningful reference.
`v3-gaps.test.mjs` "G17" pins ρ = 1/√(1 + 1/s) within ±0.01 at 0, −4.77 and −10 dB and the
withheld phase for the noise-free 50 Hz low-pass. No per-point phase uncertainty is reported.

### SNR (when a stimulus-free capture `noise` is given)

For stationary noise of PSD S, the zero-padded DFT of M samples has `E|N[k]|² = M·S(f_k)`. So:

```
Pn(f) = band mean of |N[k]|² · len(y)/len(n)     n padded to the same N (bins coincide);
                                                 at most N samples of n are used
Py(f) = band mean of |Y[k]|²                     signal + noise
snrDb = 10·log10((Py − Pn)/Pn), clamped to [SNR_FLOOR_DB, SNR_CEIL_DB] = [−60, 200]
```

The per-bin SNR of Y equals that of H because dividing by X scales signal and noise alike.

### Valid range

`validRange` is the longest contiguous run of grid points that satisfy both:

1. **Coverage**: `f·P_x(f)` (P_x the band mean of `|X|²`) within `COVERAGE_DB = −20` dB of its
   maximum on the grid. For a log sweep or pink noise this per-relative-bandwidth energy is
   flat, so the test rejects leakage outside the swept band and a Nyquist clamp.
2. **SNR** (only with `noise`): ≥ `VALID_MIN_SNR_DB = 10` dB, with Py and Pn first power-averaged
   over 1/`VALIDITY_SMOOTHING_FRACTION` = 1/6 octave (`smoothFractionalOctave`), because the
   per-point estimate scatters by ≈ 4.34/√K dB for K bins and would fragment the range at the
   first dip. The reported `snrDb` stays per point.

`validRange` is `null` when no point qualifies. `requestedRange` is always `[f1, f2]` as
requested, even above Nyquist; the grid stops at Nyquist (§205). The result also carries
`fftSize` and `binHz = sampleRate/fftSize`.

### Assumptions and limits

x and y share one sample clock and rate, are mono, and the system is linear and time-invariant
apart from additive noise. Harmonic distortion is not separated in the magnitude (for an
exponential sweep it lands at negative time in the IR; see [IR](#ir)). The capture's pre- and
post-roll are part of y; alignment is not needed for the magnitude. Phase is meaningful only
relative to the supplied lag, which includes unknown device latency.

### Tests (`v3-transfer-ir.test.mjs`; 1 s sweeps unless noted, 0.5 s pre-roll, 1.5 s post-roll)

Errors are the maximum over grid points in 50 Hz-15 kHz.

| Test | Tolerance | Measured |
| --- | --- | --- |
| flat 0 dB and −6 dB at 44.1, 48, 96 kHz | ±0.1 dB | 5.74e-3 dB (all six) |
| −6 dB with a 0.3 s pure delay | ±0.1 dB | pass |
| RBJ LP and HP 1 kHz, peaking +6 dB/1 kHz and −9 dB/4 kHz, 3 rates | ±0.5 dB | ≤ 1.97e-2 dB |
| phase of the 1 kHz low-pass with a robust alignment (+ exact lag), 50 Hz-10 kHz | < 2° | pass |
| phase null with its reason: no alignment, bare lag, not requested, ρ just below 0.5, lag null | exact | pass |
| (pipeline) 4 kHz low-pass, 30 dB SNR, aligned: magnitude per point vs analytic, 50 Hz-10 kHz where snrDb ≥ 10 | 20·log10(1 + 3·10^(−snr/20)) | 0.534 dB max, ≤ 62 % of the bound |
| (pipeline) same, phase after removing the residual lag, 50 Hz-5 kHz | 2° + (180/π)·3·10^(−snr/20) | 0.42° max |
| −6 dB with white noise at 30 dB broadband SNR | ±0.3 dB | 0.0871 dB |
| SNR estimate vs stationary-phase prediction (1/3-oct median) | ±1 dB | −0.17, −0.04, −0.07 dB |
| validRange at 10 dB broadband SNR: upper edge vs predicted | within ×/÷ √2 | 987 vs 1162 Hz |
| validRange of a 100 Hz-5 kHz sweep analysed as 20 Hz-20 kHz | edges within 1/3 oct | pass |
| out-of-band magnitude finite and < −20 dB at 15 kHz | — | pass |
| f2 = 24 kHz at 44.1 kHz: grid ≤ Nyquist, requestedRange kept | — | pass |
| regularization profile values (−60 in band, 0 at DC and 10 Hz) | 1e-9 dB | pass |
| realistic 10 s / 48 kHz chain (see below) | ±0.3 dB; < 10 s | 0.0148 dB; 519 ms |

The realistic case is a 20 Hz-20 kHz, 10 s sweep at 48 kHz through a 2nd-order high-pass at
60 Hz, a +4 dB peak at 2.5 kHz (Q 1.5) and a 2nd-order low-pass at 16 kHz, with 2.9 ms delay and
white noise at 40 dB broadband SNR (FFT size 2^21); the time is the analysis wall time of
transfer plus IR on the test machine.

### One deconvolution for transfer and IR — **Changed (gaps)** (performance)

`computeTransferAndIr({ ...computeTransfer args, irLagSamples, method, inverse, fft,
noiseSpectrum }) → { transfer, ir }` (`impulse-response.js`) runs `spectralDeconvolution` once
and derives both results from it (`transferFromDeconvolution`, `irFromDeconvolution`).
`transfer` equals `computeTransfer(...)` and `ir` equals `computeImpulseResponse({ ..., lagSamples:
irLagSamples })` **bit for bit** (default `irLagSamples` = max(0, lag)); the separate functions
are unchanged in output and now share the same code. No ID changes: every output is
bit-identical to 8628438 (checked on 44.1/48/96 kHz sweeps with noise, phase, both IR methods).
Bit-identical savings also in the separate paths:

- the FFT scratch (2·N doubles) is reused for the noise spectrum and the inverse transform
  instead of allocating new 32 MB (2²¹) buffers; the inverse is divided by N only for the kept
  samples;
- `regularizationProfile` computes the in-band and out-of-band ε once (same expression), so
  only transition bins call `10 **`;
- optional `fft` (`fftPlan(size)`) and `noiseSpectrum` (`noiseSpectrum(noise, fftSize)`)
  arguments let a caller reuse the plan and the noise FFT across runs; each is used only when it
  matches (plan size; the very same noise array and FFT size), else recomputed.

`engine.js` uses one plan and one noise spectrum per measurement, `computeTransfer` for the
other runs and `computeTransferAndIr` for the representative run (analysis step
`transfer+impulse-response`); since G21 these calls live in `analysis-task.js`
(`analysisSteps`), unchanged and in the same order. Cost per 2²¹ deconvolution is dominated by the N-point FFTs
(≈ 115-190 ms each in Node 22 here, depending on machine load): one run with noise needed 4
FFTs and 2 plans, now 3 FFTs and 1 plan; each further run 2 FFTs and 1 plan, now 1 FFT.

Measured, Node 22.20, Apple M5 Pro under concurrent load, 10 s / 48 kHz sweep with a noise
capture and phase, 8628438 vs this change alternated in one process (medians):

| Analysis | before | after |
| --- | --- | --- |
| 1 run: transfer + IR | 549 ms (longest block 276) | 358 ms (one block) |
| 1 run, second session (heavier load) | 740 ms (384) | 519 ms |
| 3 runs: 3 transfers + IR | 1171 ms (longest 307) | 701 ms (longest 406) |
| 3 runs, second session | 1560 ms (415) | 914 ms (519) |

The total drops 30-41 %; the longest single main-thread block grows (transfer and IR are now one
step), which matters until the analysis moves to a Worker
([spike](spike-audioworklet-worker.md)). In headless browsers (same machine, 10 s sweep, separate
functions vs combined, both on this code): Chromium 153 ≈ 282 → 200 ms, Firefox 155 ≈ 370 →
262 ms, WebKit 26.6 ≈ 245 → 173 ms.

**Chromium-slow IR step (spike note).** Not reproduced. Standalone in Chromium 153 the spectral
IR of a 2 s sweep (N = 2¹⁸) took 22-36 ms, the same as the transfer (23-46 ms), and of a 10 s
sweep 97-148 ms (transfer 101-143 ms); in `tests/browser/v3-measure.cjs` the longest analysis
step in Chromium is 29-34 ms for 2 s sweeps. The IR path has no non-power-of-two FFT
(`createFft` accepts only powers of two) and no allocation the transfer lacks except the
2·N inverse buffers, which are now reused. The 160-264 ms in the spike were most likely garbage
collection or tier-up during the live loopback; nothing in the pure module explains them.

<a id="ir"></a>
## Impulse response — `oscilla.ir.log-sweep.v1`, `oscilla.ir.farina-inverse.v1` (`measurement/impulse-response.js`)

`computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method, lagSamples })
→ IrResult` with `method` and `fftSize`. **Changed (integration)** (was G3, G9): `algorithm` is
`IR_ALGORITHMS[method]` — `'spectral'` → `oscilla.ir.log-sweep.v1` (`IR_ALGORITHM`),
`'farina-inverse'` → `oscilla.ir.farina-inverse.v1` (`IR_FARINA_ALGORITHM`) — because the two
methods' outputs differ (ADR 0024); validation accepts `method` and `fftSize` and rejects a
`method` that contradicts the ID.

### Methods

- `'spectral'` (default): `h = IDFT(H)` with H from `spectralDeconvolution` — the same estimate
  and regularization as the transfer function, so the IR and the magnitude are one estimate
  seen in two domains. The inverse transform is `Re(DFT(conj(H)))/N` over the Hermitian
  extension (`inverseReal`).
- `'farina-inverse'` (Farina 2000): `h = y ∗ f` for a supplied inverse filter `f` of the stimulus
  length (e.g. `inverseSweep`), as a product of N-point DFTs; the linear IR starts at index
  `len(x) − 1`, which is removed. Scale: divided by `g = median |X[k]·F[k]|` over bins from
  `√2·f1` to `min(f2, Nyquist)/√2` (half an octave inside the band), so a unity system reads
  unity in band whatever constant the inverse was built with.

For an exponential sweep both methods place harmonic-distortion responses at negative time
(Farina 2000, §3), i.e. at the end of the circular buffer, which is not part of `samples`. The
IR is band-limited to [f1, f2]: a unity system gives a pulse of peak ≈ `(f2 − f1)/(fs/2)`, not
a unit sample.

### Time origin and fields (§214)

```
start          = lagSamples given ? clamp(round(lagSamples) − round(IR_PRE_GUARD_S·sr), 0, Ny−1) : 0
                 IR_PRE_GUARD_S = 0.005 s keeps the pulse's precursor
samples[i]     = h[start + i (+ shift)],  i = 0 … len(y) − start − 1   original scale, sign kept
peakIndex      = argmax |samples|;  peakTimeS = peakIndex/sr (relative to samples[0])
captureOffsetS = start/sr;  absolute peak time = captureOffsetS + peakTimeS
noiseFloorDb   = 10·log10( mean h² over the last IR_TAIL_FRACTION (10 %) of the samples after
                 the peak / h_peak² ),  floored at −300 dB
window         = null
```

The full causal length is kept for later ETC, Schroeder, RT60 or EDT work (§90); none of those
are implemented.

### Windowing and normalization (non-destructive, §40-§41)

- `irWindow(ir, t0, t1)` returns a new object `{ ...ir, window: [t0, t1], view: { startIndex,
  endIndex, samples } }`; `samples` stays the same full-length array and the selection is a copy
  in `view.samples`. Indices are `round(t·sr)` clamped to the IR.
- `normalizeIr(ir, 'peak-db')` returns `20·log10(|h|/|h_peak|)` (floored at −300 dB, label
  "NORMALIZED: dB re IR peak (peak = 0 dB)"); `'peak-linear'` returns `h/|h_peak|` (sign kept,
  label "NORMALIZED: relative amplitude (peak = 1.0)"). Both carry `kind: 'normalized'` and the
  reference value; the IR is unchanged.

### Deviation from ADR 0021 (documented, not changed; was G9)

ADR 0021 describes ε as "negligible inside the excited band [f1, f2] and large outside it **and
near the fade-affected edges**", and Farina's inverse as a test oracle. The code differs in two
ways, kept deliberately:

1. ε is −60 dB re max|X|² uniformly across [f1, f2], edges included; it rises only beyond the
   band (1/3-octave raised cosine). No edge ramp is applied because the division is by the
   spectrum of the **exact rendered** stimulus, fades and clamp included, so the edges carry no
   model error to suppress; where the fades leave |X|² small, the in-band bias
   `−10·log10(1 + ε/|X|²)` is 0.004 dB where |X|² is 30 dB below max|X|² and 0.043 dB at
   40 dB below, and the `validRange` coverage test (f·P_x within 20 dB of its maximum) already
   excludes edge points whose stimulus energy is too low to trust. An edge ramp would bias
   exactly those edge points and, by ADR 0024, need a new transfer ID.
2. `farina-inverse` is a selectable production method, not only an oracle. It now has its own
   ID (`oscilla.ir.farina-inverse.v1`), so a stored IR says which method produced it; the
   default stays `spectral` as the ADR decides.

The ADR text is not edited here; revisiting it is a decision for its owner.

### Assumptions and limits

As for the transfer function. `noiseFloorDb` is relative to the peak, not an absolute level. The
peak is the largest absolute sample, which is the direct sound only when nothing arrives
stronger later.

### Tests (`v3-transfer-ir.test.mjs`)

| Test | Tolerance | Measured |
| --- | --- | --- |
| identity at 44.1/48/96 kHz: peak index at the pre-roll | ±1 sample | pass |
| identity: peak value vs `(f2 − f1)/(fs/2)` | ±2 % | pass |
| identity: largest sample beyond ±1 ms | ≤ −40 dB | −45.0, −44.4, −44.0 dB |
| identity: tail noise floor | < −60 dB | −162.2, −161.6, −161.6 dB |
| delayed impulse 0.3 s; with lag: offset `(lag − guard)/sr`, absolute time | ±1 sample | pass |
| echo 0.5 at 12 ms, spectral and farina-inverse: positions | ±1 sample | pass |
| echo ratio | −6.02 ± 0.5 dB | −6.0284, −6.0286 dB |
| farina-inverse vs spectral identity peak scale (44.1 kHz) | < 0.5 dB | pass |
| `irWindow`, `normalizeIr` leave the original untouched; labels say NORMALIZED | exact | pass |
| realistic 10 s case: IR peak within 1 ms after the true arrival | — | pass |
| (pipeline) 4 kHz low-pass at 30 dB SNR, aligned: absolute peak vs the system delay | ±4 samples | pass |
| (integration) spectral and farina-inverse IRs validate and round-trip with their IDs | exact | pass |

<a id="smoothing"></a>
## Smoothing, normalization — `oscilla.smoothing.fractional-octave.v1`, `oscilla.normalization.v1` (`smoothing.js`)

Both are **derived views**: they return new arrays and never modify the raw response (§34, §35,
§159). **Changed (integration)** (was G7): `smoothResponse(frequencies, magnitudeDb, fraction)`
returns the labelled view `{ kind: 'smoothed', algorithm: SMOOTHING_ALGORITHM, fraction,
label, smoothedDb }` ("SMOOTHED: 1/6 octave (power mean)", "RAW: unsmoothed" for 0);
`normalizeResponse` and `impulse-response.js` `normalizeIr` results carry
`algorithm: NORMALIZATION_ALGORITHM` (`oscilla.normalization.v1`) with their `mode`.

### `smoothFractionalOctave(frequencies, magnitudeDb, fraction)`

Rectangular 1/N-octave window (Hatziantoniou & Mourjopoulos 2000, rectangular case), power mean:

```
window_i = [f_i·2^(−1/2N), f_i·2^(+1/2N)]
S_i      = 10·log10( mean_{j: f_j in window_i} 10^(L_j/10) )
```

Each point in the window counts once, so on the log-spaced transfer grid the average is uniform
in log-frequency. At the ends the window is truncated to existing points (no extrapolation). A
window of identical values returns that value exactly; `fraction = 0` returns a copy.
`SMOOTHING_FRACTIONS = [0, 24, 12, 6, 3]` lists the specified choices (§35); any N > 0 is
accepted. Frequencies must be positive and strictly increasing.

### `normalizeResponse(frequencies, magnitudeDb, spec) → { algorithm, mode, normalizedDb, referenceDb, label }`

- `{ mode: 'at-frequency', hz }`: reference is the response at `hz`, linear in dB over
  log-frequency between neighbours (an exact grid point reads itself); outside the range throws.
  Label "NORMALIZED: 0 dB at 1 kHz".
- `{ mode: 'band-mean', lo, hi }`: reference is `10·log10(power mean of points in [lo, hi])`.
  Label "NORMALIZED: 0 dB = power mean …".
- `normalizedDb = magnitudeDb − referenceDb`.

Limits: power-domain smoothing of a symmetric dB ripple lands above its dB mean (intended: it is
an energy average). Smoothing on a non-log grid would weight frequencies by point density.

Tests (`v3-transfer-ir.test.mjs`): flat response unchanged exactly for 1/24 … 1/3; ±3 dB ripple of
period 1/6 octave reduced to < 10 % of its span by 1/3-octave smoothing and every smoothed value
> 0 dB (power mean); fraction 0 is a copy; normalization at 1 kHz reads back 0 dB within 1e-12;
reference equals the analytic filter level within 0.1 dB; band mean `10·log10((1 + 0.1)/2)`
within 1e-12; labels contain NORMALIZED.

<a id="rta"></a>
## RTA bands — `oscilla.rta.v1` (`measurement/rta.js`)

### Band layout: `bandCenters(kind, fMin, fMax, sampleRate) → [{ nominal, exact, lo, hi }]`

IEC 61260-1:2014 §5.2-§5.4 base-10 band-edge mathematics (same definitions as ANSI S1.11):

```
G      = 10^(3/10) ≈ 1.99526                     OCTAVE_RATIO_G
f_r    = 1000 Hz                                 REFERENCE_FREQUENCY_HZ
b      = 1 (octave) or 3 (one-third octave)      BANDS_PER_OCTAVE
exact  = f_r · 10^(3x/(10b))                     = f_r · G^(x/b), x integer
lo, hi = f_r · 10^(3(2x ∓ 1)/(20b))              = exact · G^(∓1/(2b))
```

Edges are computed in the rearranged form so the upper edge of band x and the lower edge of band
x + 1 are the same floating-point expression (bit-identical shared edges). Nominal labels are
the R10 preferred numbers (IEC 61260-1 Annex E, ISO 266): 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5,
6.3, 8 per decade; an octave band is the third-octave band with index 3x. Bands are selected by
**nominal** label in [fMin, fMax], and every band whose upper edge exceeds
`NYQUIST_FRACTION = 0.95` × Nyquist is excluded.

**OSCILLA is not IEC 61260-1 filter-class compliant.** The standard specifies relative
attenuation masks (class 1, class 2) for band filters at every frequency. Summing FFT-bin power
over a band is a rectangular "brick-wall" estimate whose skirts are set by the analysis window
and the bin resolution, not by those masks. Band levels are ESTIMATED and relative unless a level
calibration is applied downstream.

### Band integration: `integrateBands`, `bandPowers`, `bandAnalysis`, `bandBinCounts`

Input contract: one-sided linear power per bin on the **mean-square** scale,
`P[k] = c·|X[k]|² / (N·Σw²)` with c = 2 except c = 1 at DC and Nyquist, so Σ P = mean square.
**Changed (integration)** (was G1): the functions also accept a `spectrum.js` `welch()` result
and convert it by its stated `scale` (`meanSquarePower`: `'tone'` → `toneToMeanSquare`,
`'mean-square'` as is; an object without a known scale throws). A sine of amplitude A reads
10·log10(A²/2) in its band, a full-scale sine −3.01 dB, whatever window produced the
spectrum. `bandAnalysis` results carry `algorithm: 'oscilla.rta.v1'`.
Bin k covers `[(k − ½)·binHz, (k + ½)·binHz]`, power is assumed uniform within a bin, and

```
bandPower = Σ_k P[k]·w[k],  w[k] = overlap of bin k's cell with [lo, hi], in bins (0 … 1)
levelDb   = 10·log10(bandPower)            (−Infinity for zero power; dB never averaged)
```

`bandBinCounts` returns the effective bin count (band width in bins where the spectrum covers it)
and `underResolved = binCount < UNDER_RESOLVED_BINS (2)`: such a band's level is dominated by the
window main lobe and bin placement. `bandAnalysis` returns `{ levelsDb, power, binCounts,
underResolved }`; `bandPowers` returns the dB array only (contract signature).

### Stored result: `rtaResult({ sampleRate, resolution, bands, levelsDb, fftSize, window })`

**New (integration)** (was G4). Builds the `RtaResult` that `validate.js` checks:
`{ algorithm: 'oscilla.rta.v1', sampleRate, resolution, bands: [{ nominal, exact, lo, hi }]
(copies), levelsDb: Float64Array, fftSize, windowAlgorithm }`. `levelsDb` are mean-square band
levels; `−Infinity` and anything below `ZERO_POWER_DB` are stored as −300 dB (zero power);
NaN, +Infinity, a length mismatch or an unknown resolution throw. `window` is the window name
(or `windowFn()` result) whose ID is stored as `windowAlgorithm`, null when unknown.

### Averaging: `createRtaAverager({ mode = 'fast', peakHold = false, size })`

Exponential averaging of **power** per band (or bin):

```
y ← y + α·(p − y),  α = 1 − e^(−Δt/τ)
RTA_MODES: instant (τ = null, α = 1), fast (RTA_TAU_FAST_S = 0.125 s), slow (RTA_TAU_SLOW_S = 1 s)
```

The first frame after construction or `reset()` seeds the average (no ramp from silence).
`levelsDb = 10·log10(y)`; `peakDb` is the running maximum of `levelsDb` when `peakHold`.
`freeze()` discards pushed frames, `unfreeze()` resumes from the frozen state. Buffers are
allocated once and reused (the same result object is returned on every push). FAST and SLOW
follow the IEC 61672-1 §5.8 time weightings in name and time constant only: they act per
analysis frame of a block FFT, not as a continuous detector on the squared signal, and are not
verified against IEC 61672-1.

### Tests (`v3-rta-aggregate.test.mjs`)

| Test | Tolerance | Measured |
| --- | --- | --- |
| octave nominal 31.5 … 16000 at 48 kHz; exact/lo/hi vs `G^(x/b)` | relative 1e-9 | pass |
| third-octave labels equal V2 `THIRD_OCTAVE_FREQUENCIES`; Table E.1 spot values | 5 digits | pass |
| nominal vs exact | < 3 % | pass |
| adjacent edges shared; last band below 0.95 × Nyquist at 44.1/48/96 kHz | ≤ 1 ulp | pass |
| flat spectrum: band power = band width in bins | relative 1e-9 | pass |
| sine at each band centre (3 rates, both kinds): level `10·log10(A²/2)` | ±0.05 dB | ≤ 8.2e-5 dB |
| same: dominance over every other band | ≥ 20 dB | ≥ 55.7 dB |
| two equal tones in one octave band | +3.0103 ± 0.1 dB | 0.0000 dB error |
| tones in different bands read independently | ±0.1 dB | pass |
| white noise, third octaves 100 Hz-10 kHz: level vs theory | 4σ (≥ 0.25 dB) | ≤ 0.48 of tolerance |
| white noise: slope per third-octave band | 1.000 ± 0.05 dB | 0.9964, 0.9962 |
| pink noise: flatness of third-octave bands | ±1 dB | ≤ 0.231 dB |
| step response at one τ (fast, slow) | 63.2 % ± 1e-9 | pass |
| frame-rate independence (two Δt/2 = one Δt) | 1e-9 dB | pass |
| power averaging (17.03 dB, not 10 dB), peak hold, freeze, reset, no allocation | 1e-9 | pass |

The tests above feed `bandPowers` a mean-square Welch spectrum built in the test file; the
`spectrum.js` path is pinned by the integration test in [Windows](#windows) (FS sine
−3.0103 ± 1e-3 dB for Hann and Blackman-Harris at 44.1/48/96 kHz) and by the pipeline's pink
noise (third-octave bands 100 Hz-10 kHz within ±1.5 dB of their median, 3σ of a 3 s
realization). `v3-integration.test.mjs` "G4" pins `rtaResult` (zero-power encoding, copies,
errors, round trip).

<a id="aggregate"></a>
## Aggregation of repeats (`measurement/aggregate.js`)

`aggregateRuns(runs, { method = 'mean' }) → { method, runs, points, centreDb, lowerDb, upperDb,
spreadDb, dispersion, repeatabilityDb }`. `runs[r][i]` is the level in dB of run r at grid
point i; all runs on one grid. `−Infinity` (zero power) is accepted; NaN and `+Infinity` throw.

- `'mean'` (dispersion `'std'`):

  ```
  centreDb[i] = 10·log10( (1/n)·Σ_r 10^(L_ri/10) )          energetic (power) mean
  spreadDb[i] = sqrt( Σ_r (L_ri − mean_r L_ri)² / (n − 1) )   sample std of the dB values
  lower/upper = centreDb ∓ spreadDb
  ```

  The centre is a power mean (a dB mean is biased low by about `σ²·ln(10)/20` dB for log-normal
  scatter of σ dB); the spread is reported in dB because repeatability reads as "± x dB". A
  point where any run is `−Infinity` has a NaN spread.
- `'median'` (dispersion `'p10-p90'`): centre is the median; lower and upper are the 10th and
  90th percentiles (Hyndman & Fan 1996, definition 7: `h = (n − 1)·p`, linear interpolation
  between order statistics, done in dB; interpolation toward a `−Infinity` neighbour stays
  `−Infinity`). Spread is the unscaled median absolute deviation
  `MAD = median_r |L_ri − median_r L_ri|` (× 1.4826 would estimate σ for normal scatter).
- `repeatabilityDb` = median over grid points of the finite `spreadDb` values.
- One run: `centreDb` is a copy; `lowerDb`, `upperDb`, `spreadDb`, `dispersion`,
  `repeatabilityDb` are null.

The envelope is a descriptive dispersion of the runs, not an expanded uncertainty in the GUM
sense (no coverage factor, no Type B components). Sorting is insertion sort, sized for the
1-10 repeat limit. The result carries `algorithm: 'oscilla.aggregate.v1'`.

### Stored form: `aggregateResult(aggregate, frequencies)` — **Changed (gaps)** (was G16)

`AggregateResult = { algorithm, method, dispersion, runs, frequencies, centreDb, lowerDb,
upperDb, spreadDb, repeatabilityDb }` is the optional `results.aggregate` of an experiment:
the `aggregateRuns()` output with its grid (e.g. the runs' `TransferResult.frequencies`, which
must be finite, positive and strictly increasing), new `Float64Array`s, `points` dropped (=
`frequencies.length`), and −Infinity or anything below −300 dB stored as `ZERO_POWER_DB` (as
`rtaResult`). One run: the three envelope arrays, `dispersion` and `repeatabilityDb` are null. A
NaN spread (some runs zero power, others not) has no JSON-safe value and throws; transfer
magnitudes are already floored at −300 dB, so this cannot happen on the engine path.
`assessQuality` accepts the stored form like the in-memory one (identical assessment).
Validation (`validate.js`): exact keys, known method, `dispersion` = `std`/`p10-p90` by method
(null for one run), runs 1-64, envelope arrays null for one run and of the grid's length
otherwise, `spreadDb ≥ 0`, `repeatabilityDb` null or 0-400, and `lowerDb ≤ centreDb ≤ upperDb`
at every point. `results.aggregate` keeps its presence: `createExperiment` leaves it absent, so
files and result hashes without it are unchanged; with it the result hash covers its encoded
arrays. `csv.js` `aggregateCsv` exports frequency_hz, centre_db_relative, lower_db_relative,
upper_db_relative, spread_db (transfer ratios in dB; the spread is a dB difference, labelled
descriptive) with a `# repeatability_db` line. `v3-pipeline.test.mjs` stores the aggregate of
its three runs instead of run 1's TransferResult and round-trips it byte for byte; a flipped
digit in `centreDb` is rejected as corrupt.

### Storage rule for repeated measurements — **Changed (G20)**

The aggregate is the primary response of a repeated measurement. With `runs ≥ 2`:

- `results.aggregate` = `aggregateResult(aggregate, frequencies)` (above);
- `results.transfer` = `transferFromAggregate(stored, transfers)` (`aggregate.js`) or `null`,
  **never one run's transfer**. It is a TransferResult marked `derivedFrom: 'aggregate'`:
  `magnitudeDb` is a copy of `stored.centreDb` (the same bits, on the same grid, so the floor
  at −300 dB is the stored one), `snrDb` the lowest run SNR per point (null unless every run
  has one), `validRange` the intersection of the runs' valid ranges (null if empty), `phaseDeg`
  null with `phaseReason: 'AGGREGATED'` (phases of separate runs are not averaged, §27),
  `alignment` null (each run has its own), the other fields from run 1. Why a marked transfer
  rather than null: the aggregate has no valid range and no SNR, and both are what make its
  centre usable (quality, `responseDelta`); keeping them conservative (worst run, common range)
  never claims more than every run supports;
- `results.runTransfers` (optional) = `[{ run, transfer }]`, individual runs' own
  TransferResults (with their phase), **only when requested**, at most `LIMITS.runTransfers`
  (10, one per repeat), run indices strictly increasing and below `aggregate.runs`, each on the
  aggregate grid and never derived.

A single run stores its own TransferResult as `results.transfer` and no aggregate, exactly as
before G20. `engine.js` `measure()` returns that transfer (`result.transfer`; each run's own in
`result.runs[i].transfer`), and `schema.js` `resultsFromMeasurement(result, { runTransfers })`
(false, true or an array of run indices) turns an engine result into the stored `results`
block (dropping the engine's `ir.run` index). `validate.js` enforces the rule with paths:
a non-derived transfer next to an aggregate of ≥ 2 runs, a `derivedFrom` without such an
aggregate or with another value, a grid or a single centre bit that differs, a phase or an
alignment on the centre, and malformed, unordered, out-of-range, derived, off-grid or too many
run transfers are rejected. The result hash covers `derivedFrom` and `runTransfers` like any
other result field; files without them hash as before. `transferCsv` writes a
`# derived_from: aggregate …` line, a title and column units naming the centre ("lowest of the
runs" for snr_db), and `# run: k` for one run (option `run`). `compare.js` compares the
aggregate when present (`responseOf`): see [Experiments](#experiments).
Tests: `tests/unit/v3-storage.test.mjs` (engine → results → experiment → hash → JSON →
validate byte for byte, every rejection by path, CSV lines, comparisons).

Tests (`v3-rta-aggregate.test.mjs`, all 1e-12 or exact): identical runs give zero spread for both
methods; mean centre of [0, 2, 4] dB is the power mean (> 2 dB), spread 2 dB and √12 dB; median
of [0, 1, 2, 3, 10] gives p10 0.4, p90 7.2, MAD 1, and the outlier widens the mean envelope more
than the robust band; one run gives no envelope; a `−Infinity` run averages in at power 0, its
spread is NaN and it is left out of `repeatabilityDb`.

<a id="calibration"></a>
## Frequency calibration — `oscilla.calibration.log-interp.v1` (`calibration/*.js`)

### Profile and identity (`profile.js`)

A `FrequencyProfile` is `[hz, db]` pairs stating a measuring chain's **deviation from flat**.
`normalizePoints` sorts ascending (stable, with a warning if unsorted), merges exact duplicates
(same Hz and dB, warning), and rejects conflicting duplicates, non-finite values, frequencies
outside 1 Hz-200 kHz, corrections beyond ±60 dB, and fewer than 1 or more than 2000 points
(`PROFILE_LIMITS`). `−0` folds to 0.

```
profileId = SHA-256( JSON.stringify({ schemaVersion: 1, kind: 'frequency',
                     units: { frequency: 'Hz', correction: 'dB' }, points }) )   64 hex digits
```

with fixed key order and ECMAScript shortest round-trip number text, so the ID is stable across
engines. Name, source, notes, file name and import time are excluded: renaming keeps the ID, any
point change alters it (§200). SHA-256 is the synchronous FIPS 180-4 implementation in
`sha256.js` (WebCrypto is asynchronous and unavailable in some file:// contexts). Missing
provenance stays `null`; a missing name becomes `UNNAMED_PROFILE`.

`exportProfile` writes `{ format: 'oscilla.calibration', schemaVersion, kind, id, name,
[source], units, points, notes, importedAt }`; `source` appears only when given.

### Import (`parse.js`): `parseCalibrationText(text, opts)`

Strict and explainable; returns `{ ok, profile, warnings }` or `{ ok: false, errors }` with
1-based line numbers, never throws for bad text. Accepted: two-column delimited text (tab >
semicolon > comma > space, fixed by the first data row), an optional header naming the columns
(more columns only when the header names frequency and correction; named extra columns such as
phase are ignored with a warning), `#`, `;`, `*` comment lines, quoted metadata lines, and JSON
(an OSCILLA export, `[[hz, db]]` or `[{ hz, db }]`). Rejected: unrecognized text rows, unlabeled
extra columns, comma-delimited rows betraying decimal commas, mixed decimal commas and points,
`1,000`-style tokens, NaN/Infinity/overflow, conflicting duplicates, out-of-range points, more
than 2000 points, more than `MAX_IMPORT_BYTES` = 1 MiB. Decimal commas are accepted only where
they cannot be separators, with a warning. A "Sens Factor" line is quoted into the notes with a
warning and **never applied** (it is neither a frequency correction nor an SPL calibration). For
JSON with a stored `id` that does not match the points, the ID is recomputed with a warning.

### Interpolation and application (`interpolate.js`)

Piecewise linear in dB over log10(frequency):

```
t    = (log10 f − log10 f0) / (log10 f1 − log10 f0),   f0 ≤ f ≤ f1 neighbouring points
c(f) = c0 + t·(c1 − c0)                                 exact stored value at a point
```

- **Coverage** (`coverage(profile)`) is [first point, last point]. Outside it the default
  policy `extrapolate: 'none'` gives no correction (`correctionAt` returns null,
  `correctionCurve` gives NaN and `covered = 0`). The opt-in `'hold'` repeats the edge value but
  still marks the point uncovered (`held: true`). 0 Hz and negative frequencies are below every
  profile.
- **Sign convention** (`CORRECTION_SIGN = −1`, `CORRECTION_CONVENTION`): "+2.1 dB at 10 kHz"
  means the microphone reads 2.1 dB high there, as measurement-microphone calibration files are
  distributed, so

  ```
  correctedDb = observedDb − correction       (uncovered points: observedDb unchanged)
  ```

  An EQ-style (inverse) profile must be negated before import; the code never guesses.
- `applyFrequencyCorrection(magnitudeDb, frequencies, profile, opts)` returns
  `{ algorithm, profileId, correctedDb, covered, coverage, extrapolate }`; the input is not
  modified, so raw and corrected curves coexist (§18 overlay).

### RTA bands: `applyFrequencyCorrectionToBands(rta, profile, { power, binHz })` — New (integration), was G11

A band level is a sum of power, so a correction that varies inside the band is applied to the
power before summing, never as one value at the band centre:

```
gain        = Σ_k W_k·10^(−c(f_k)/10) / Σ_k W_k          (CORRECTION_SIGN = −1)
correctedDb = levelDb + 10·log10(gain)
```

- `'spectrum'` weighting, when the band's per-bin spectrum is given (`power`: a mean-square
  array or a `welch()` result, and `binHz`): `W_k = P[k]·w[k]`, w[k] the fraction of bin k in
  the band (the `rta.js` bin cells), f_k the bin centre clamped into the band. A band whose
  power is all zero falls back to flat.
- `'flat'` weighting otherwise: power uniform in Hz across the band, `BAND_CORRECTION_STEPS =
  256` equal sub-bands at their centres (midpoint rule; error ∝ 1/M²: 3.6e-5 dB for 12
  dB/octave across a one-octave band, 5.8e-4 dB if M were 64).
- A band is **covered** only when [lo, hi] lies inside the profile coverage; any other band is
  returned unchanged with `covered = 0` and `correctionDb = NaN` (never extrapolated, whatever
  the overlap). Zero power (≤ −300 dB, −Infinity) stays as it is.

Returns `{ algorithm: CALIBRATION_ALGORITHM, profileId, correctedDb, correctionDb, covered,
coverage, weighting }`; the input is not modified.

Limits: magnitude only (no phase calibration). A single-point profile covers exactly one
frequency. The calibration's own uncertainty is not represented.

### Tests (`v3-calibration.test.mjs`)

Interpolation is compared at 1e-9 dB (double rounding contributes ~1e-15, so only a wrong formula
can fail); exact points and offsets with strict equality.

- SHA-256 against NIST FIPS 180-4 vectors and `node:crypto` at block-boundary lengths and UTF-8.
- Profile shape, object points, ID independent of name/source/notes/importedAt/order, duplicate
  merge vs reject, limits, export without invented fields.
- Parser: CSV header, tabs/semicolons/comments, header-selected columns, commented header
  (warning), sensitivity line (notes, never applied), malformed rows with line numbers, three
  unlabeled columns, decimal-comma ambiguity, NaN/Infinity/overflow, duplicates, unsorted (same
  ID as sorted), out of range, 2001 points and > 1 MiB rejected, JSON forms, export → parse
  round trip keeps the ID.
- `correctionAt` exact at every point; 200 Hz between [100, 0] and [1000, 6] reads
  `6·log10 2` = 1.806 dB (linear-Hz would give 0.667); below/above range null under `'none'`,
  edge value with `held: true` under `'hold'`; `applyFrequencyCorrection` gives
  [−10, −11, −12, −10] for a 100 Hz-15 kHz profile [1, 2] dB on a −10 dB response, coverage mask
  [0, 1, 1, 0].
- `v3-integration.test.mjs` "G11": a constant +2 dB profile lowers every covered band by 2 dB
  (1e-9) under both weightings; all power in one bin gives exactly that bin's correction
  (1e-12); flat weighting agrees with a 200 000-point integral within 1e-4 dB at 12 dB/octave;
  bands not entirely inside the coverage are unchanged and flagged; zero power stays.

<a id="level"></a>
## Level calibration and SPL labelling (`calibration/level.js`)

One explicit reference reading (§23). The user applies a known external reference (typically a
94 dB SPL calibrator at 1 kHz); OSCILLA observes its relative level X; then

```
offsetDb       = referenceDbSpl − observedDbRelative          (createLevelCalibration)
displayed SPL  = R + offsetDb                                 for a later relative reading R
```

- `createLevelCalibration({ referenceHz, referenceDbSpl, observedDbRelative, conditions,
  createdAt })`: `referenceHz` in 20 Hz-20 kHz, `referenceDbSpl` in 40-140 dB, observed finite,
  `createdAt` a caller timestamp (no clock in the module), `conditions` free text ≤ 2000 chars.
- `isValidLevelCalibration(cal)` is true only for the right schema and kind, in-range fields and
  an `offsetDb` that matches `referenceDbSpl − observedDbRelative` within `1e-9` dB (absorbs JSON
  rounding only; a tampered offset fails).
- `levelLabel(cal)` returns `{ unit: 'dB SPL', calibrated: true, indicator: 'CALIBRATED' }` only
  for a valid calibration, otherwise `{ unit: 'dB relative (dBFS-like)', calibrated: false,
  indicator: 'UNCALIBRATED' }`. `toDisplayLevel(R, cal)` adds the offset only under a valid
  calibration. There is no default SPL calibration anywhere.
- **One label for the uncalibrated scale** (Changed (integration), was G10): `RELATIVE_UNIT =
  'dB relative (dBFS-like)'` is the unit after every uncalibrated value and
  `RELATIVE_SCALE_LABEL = 'Relative level · dBFS-like / analyser-relative scale'` (the spec
  §24 wording) names the scale on axes and in file metadata. `format.js` (`DB_KIND_LABELS`),
  `quality.js` (reason units and texts), `experiments/csv.js` (level columns, calibration line)
  and `experiments/schema.js` (`describeCalibration`, `summarizeExperiment`) import them. The
  strings "not SPL" and "SPL UNCALIBRATED" are gone: no uncalibrated output contains "SPL".
  `csv.js` and `describeCalibration` now require `isValidLevelCalibration` (a tampered offset
  or a missing `createdAt` reads uncalibrated) before printing "dB SPL".
- `format.js` `formatDb(value, { kind })` prints "dB SPL" only when the caller passes
  `kind: 'spl'`; an unknown kind throws rather than falling back.

Limits: a single broadband scalar for the whole input chain, valid only for the device, input
gain, browser processing and microphone position it was taken with. X must be read on the same
scale and with the same frequency-correction state as later readings, otherwise the correction
at `referenceHz` (or the tone-scale versus mean-square-scale difference of a sine, 3.01 dB;
see [Conventions](#conventions)) is counted twice. It is independent of, and never derived from,
a frequency profile (§17).

Tests (`v3-calibration.test.mjs`, exact): offset 94 − (−30.5) = 124.5 dB and display 84.5 dB SPL
for −40 dB relative; SPL label only for a valid calibration; `null`, `{}`, a tampered offset, a
wrong kind, an out-of-range reference and a frequency profile all read UNCALIBRATED; invalid
references rejected, bounds 20 Hz/140 dB and 20 kHz/40 dB accepted. `v3-rta-aggregate.test.mjs`
"format: dB labels" checks "relative" never prints SPL. `v3-integration.test.mjs` "G10" scans
every text output of `describeCalibration`, `summarizeExperiment`, the three CSV exports,
quality reasons, `formatDb` and `levelLabel` for no calibration, a tampered one and one
without `createdAt` (no "SPL"; the relative unit and scale label present) and for a valid one
("dB SPL" present); `v3-pipeline.test.mjs` repeats the scan on the pipeline's outputs.

<a id="format"></a>
## Resolution-aware formatting (`measurement/format.js`)

- `binResolutionHz(sr, fftSize) = sr/fftSize` (Δf, §69).
- `formatFrequencyWithResolution(hz, resolutionHz)`: no digit finer than the rounding step
  `10^floor(log10(resolution))` (V2 `displayStepHz`), kHz from 1000 Hz up. 18437.238194 Hz at
  48 kHz/8192 (5.86 Hz) prints "18.437 kHz" (§97).
- `formatEstimate(value, u, unit)`: "≈ v ± u unit (estimate)", u rounded to two significant
  digits and v to the same decimal position (GUM §7.2.6); without a positive finite u it prints
  three significant digits and "(estimate, uncertainty unknown)". Parabolic peak interpolation
  (V2) is to be reported through this as an estimate (§70).
- Negative numbers use U+2212; missing values print "—".

Tests (`v3-rta-aggregate.test.mjs`, exact strings): resolution digits at 44.1/48/96 kHz and
1024-32768 points (no digit finer than Δf, none usable dropped); dB labels; estimate rounding
including the 9.96 → 10 carry.

<a id="experiments"></a>
## Experiment hashing and encoding (`experiments/*.js`)

### Canonical JSON (`canonical-json.js`)

`canonicalJson(value)`: object keys sorted by UTF-16 code units, no whitespace, numbers in
ECMAScript shortest round-trip form, `−0` written as `0`, `undefined` properties omitted, typed
arrays as plain number arrays. NaN, Infinity, functions, symbols, BigInt, `undefined` array
elements, cycles and nesting deeper than 64 throw `TypeError` (never coerced to null).

### Configuration hash (`hash.js`, §100)

```
configHash = SHA-256 hex( canonicalJson({
  v: 1,                                         CONFIG_HASH_VERSION
  recipe,                                       { stimulus, repeats, analysis }
  calibration: { frequency: profile id | null,
                 level: { referenceHz, referenceDbSpl, observedDbRelative, offsetDb } | null },
  sampleRate,                                   measurement.sampleRate
  algorithms,                                   { role: id }
  build: { version, commit }                    oscillaVersion, oscillaCommit
}))
```

It covers what was configured and by which software; it excludes timestamps, name, notes, input
device and constraints, results, quality and UI state. Equal hashes mean the same configuration,
not the same result. `sha256Hex` defaults to `calibration/sha256.js` and may be injected.
`withConfigHash(e, hex)` stamps `provenance.configHash`; `withResults` clears it when
`algorithms` or `sampleRate` change.

### Result hash (`hash.js`, §101) — New (integration), was G13

```
resultHash = SHA-256 hex( canonicalJson({ v: 1,             RESULT_HASH_VERSION
  results: serializeExperiment(results) }) )                 { transfer, ir, rta,
                                                             aggregate? }, typed arrays as
                                                             EncodedArray
```

(`aggregate` only when present: a results block without it hashes as before.)

The typed arrays enter in their encoded form (dtype + little-endian bytes), so the hash covers
the exact stored bits and the dtype; key order does not matter. `withResultHash(e, hex)` stamps
`provenance.resultHash` (`null` from `createExperiment`); `withResults` clears it whenever
`results` change. On import `validateExperiment` recomputes it over the decoded results when
`provenance.resultHash` is a hash and reports a mismatch as `{ path: 'provenance.resultHash',
code: 'corrupt', text: 'corrupt: …' }`; `null` (not stamped) is not verified. It detects
corruption, not tampering (anyone can recompute it). Plain-number arrays in a file are hashed
in their decoded typed form.

### Typed-array encoding (`encode.js`, §56-§57)

`EncodedArray = { dtype: 'f32'|'f64'|'u8', length, encoding: 'base64-le', data }`: elements
written little-endian explicitly through `DataView`, then standard padded base64 (RFC 4648 §4,
implemented locally, no `btoa`/`Buffer`). Decoding is strict: exactly those four keys, known
dtype (optionally restricted), `length ≤ maxLength` checked **before** allocation, base64 text
length equal to `ceil(length·bytes/3)·4`, only the RFC alphabet, padding only at the end, zero
unused bits. `serializeExperiment` turns every typed array into an EncodedArray;
`experimentToJson` writes the `.oscilla.json` text.

### Recipe stimulus (`schema.js`) — Changed (integration), was G2

`checkRecipe` stores the stimulus in `stimulus.js`'s normalized form — `kind, sampleRate,
duration, level, f, f1, f2, fade, seed, color, law`, null where the kind does not use a field —
so `createRecipe({ stimulus: renderStimulus(spec).spec }).stimulus` deep-equals the rendered
spec. Limits are imported, not copied: `DURATION_LIMITS[kind]` (chirp 5 ms-1 s, sweep 1-30 s,
others 50 ms-30 s), `SAMPLE_RATE_LIMITS`, fade in [0, duration/4], level in (0, 1],
`MIN_FREQUENCY_HZ` ≤ f ≤ `safeMaxFrequency(sampleRate)` (0.95 × Nyquist; at the highest
supported rate when the recipe has no sample rate), `color` ∈ {white, pink} for band noise,
`law` ∈ {log, linear} for chirps, both null elsewhere (an omitted value stays null and means
the stimulus default). `LIMITS.sampleRate`, `LIMITS.sweepDurationS` are the stimulus.js
arrays and `LIMITS.stimulusDurationS` is their envelope [0.005, 30].

### Import validation and migration (`validate.js`, `migrate.js`)

`validateExperiment(json, opts)` never throws: size cap `DEFAULT_MAX_BYTES` = 32 MiB measured as
UTF-8 before `JSON.parse`; structural scan (depth ≤ 32, plain objects only, no `__proto__`,
`constructor`, `prototype` keys, finite numbers); schema migration; strict schema check
(unknown fields rejected, numeric bounds from `schema.js` `LIMITS`, string caps, algorithm IDs
against `knownAlgorithms` or the ID pattern, calibration shape, result arrays decoded with
`DEFAULT_MAX_ARRAY` = 4 000 000 elements and plain arrays ≤ 65 536). It returns a normalized deep
copy. **Changed (integration)** (was G3, G4): the accepted result shapes are exactly the
modules' outputs — TransferResult with `validRange: null` and the optional `phaseReason` and
`alignment`; IrResult with the optional `method` (must match the IR ID) and `fftSize`;
RtaResult from `rtaResult()` with the optional `windowAlgorithm` (zero power as −300 dB,
non-finite levels rejected); QualityAssessment from `assessQuality()` with reason `scope` and
the `mask` `{ frequencies f64, reliable u8 (0/1), calibrated u8 (0/1) }` (quality metrics may
hold arrays of up to 1024 elements). Optional fields keep their presence, so a validated
experiment re-exports byte for byte; the result hash is verified as above. `migrateExperiment`
runs registry steps `n − 1 → n` in order (schema 1 is an identity placeholder), rejects newer
schemas with a clear message, and never modifies its input.

`newExperimentId(bytes16)` formats caller-supplied random bytes as a UUIDv4 (version and variant
bits set); the module uses no randomness or clock of its own.

### CSV columns (`csv.js`) — **Changed (gaps)** (was G19)

A transfer magnitude is a ratio (capture / stimulus), never a level. `transferCsv` columns are
frequency_hz, magnitude_db_relative ("dB re unity digital transfer (capture/stimulus ratio),
uncorrected"), **magnitude_db_corrected** (option `correctedDb` =
`applyFrequencyCorrection().correctedDb`, "…, frequency-profile corrected (microphone deviation
removed)"; requires a frequency profile in the metadata), snr_db, reliable. A level
calibration never turns a transfer column into "dB SPL" (with the offset added |H| would be the
SPL a full-scale digital stimulus would produce, which the file does not claim); the old
`calibratedDb`/`calibratedUnit` options throw a TypeError naming the replacement. Absolute
level belongs to level outputs: `rtaCsv` adds level_db_corrected (option `correctedDb`, needs a
frequency profile) and, only under a VALID LevelCalibration, level_db_spl = (corrected or
relative band level) + offset, its unit line naming the base column and the offset; zero power
(−300 dB) has an empty SPL field. `aggregateCsv` is described under [Aggregation](#aggregate).
The specification's column list (§164, "magnitude_db_calibrated") predates this split; it is not
edited here.

### Comparison of repeated measurements (`compare.js`) — **Changed (G20)**

`responseDelta(a, b)` compares *responses* (`responseOf`): for an experiment the aggregate when
`results.aggregate` holds ≥ 2 runs (centre on its grid; valid range from the `derivedFrom`
transfer, else the whole grid), otherwise `results.transfer`; a bare TransferResult (kind
`transfer`, or `aggregate-centre` when derived) or AggregateResult (kind `aggregate`) is
accepted too. The delta is computed as before (log-frequency interpolation over the overlap of
the valid ranges, raw dB) and now also returns `sources`, `equivalent` and `warnings`: a single
run against an aggregate or its centre is **not equivalent** (a single run carries the
run-to-run scatter the aggregate averages out), and neither are aggregates of different
methods. When both responses carry an envelope, `envelope` holds both bounds on the common grid,
`overlap` (1 where the intervals intersect) and `overlapFraction`; envelopes of different
dispersion measures (`std` vs `p10-p90`) are marked `comparable: false` with a warning.
`compareExperiments` adds `results.response` ('single run' | 'aggregate (<method>)', a `warn`
difference), `results.aggregate.runs` (`info`) and `results.aggregate.algorithm`.

<a id="golden"></a>
### Golden outputs per algorithm ID — **New (gaps)** (was G18)

`tests/unit/v3-golden.test.mjs` has one case per ID in `KNOWN_ALGORITHM_IDS` (15: every current
default and the retained `oscilla.confidence.v1`) and one fixture per ID,
`tests/unit/fixtures/v3/<id>.json` (24.5 KB in all): a small deterministic input (8 kHz, 1 s
50 Hz-3 kHz sweep through a one-pole low-pass with mulberry32 noise; a clipped/dropped/stepped
capture; closed-form curves; a fixed profile and level calibration) run through the module, its
output reduced to plain numbers (long arrays to a 12-32-value window plus order-sensitive sums)
and rounded to 10 significant digits. The test fails when an output moves by more than
1e-8·max(1, |value|) (rounding and last-ulp Math differences between engines stay below; the
smallest documented effect, 0.004 dB, is 4·10⁵ times larger), when any reason text, code or
label changes, when a known ID has no fixture, or when the output does not carry the ID it is
filed under. A self-check shows a 0.001 dB shift — inside every analytic tolerance — fails.
Regenerate only after announcing an ID change: `OSCILLA_UPDATE_GOLDEN=1 node --test
tests/unit/v3-golden.test.mjs`.

### Tests (`v3-experiments.test.mjs`)

Encoding round trip is bitwise (including a float32 subnormal and `−0`); base64 matches `Buffer`
and rejects non-canonical input; declared/decoded length mismatches, oversize arrays, wrong
types, NaN/Infinity anywhere, unknown algorithm IDs, malformed calibration, forbidden keys,
oversize files and future schema versions are rejected with paths; a synthetic schema-0 document
migrates; create → encode → JSON → validate is identical (§144); `configHash` is stable under
key reordering, ignores the 12 listed non-configuration fields and changes for the 10 listed
configuration fields, and the bundled SHA-256 equals `node:crypto`. These tests build result
objects by hand; `v3-integration.test.mjs` (G2, G3, G4, G13) and `v3-pipeline.test.mjs` use the
analysis modules' real outputs: every normalized stimulus kind at 44.1/48/96 kHz is a valid
recipe; real transfer, IR (both methods), RTA and quality results validate and round-trip
identically (deep-equal and byte-identical re-export); malformed optional fields are rejected
with paths; the result hash equals node:crypto over the documented canonical form, ignores
non-result fields and key order, changes with one flipped bit or a dtype change, and a
modified result in a stamped file is rejected as `corrupt`.

<a id="quality"></a>
## Measurement quality — `oscilla.confidence.v2`, `oscilla.confidence.v1` (`measurement/quality.js`)

Documented from the code that landed in e89ff9f (was G14). ADR 0025: a pure rule table maps
measured metrics to one of four statuses and always returns the reasons, passing and failing,
each backed by the number it came from. There is no score and no "confidence" percentage.

`assessQuality({ capture, transfer, aggregate, calibration, requestedRange, resolutionHz,
sweepWindow, chainNotes, algorithm }) → { algorithm, status, reasons, metrics, mask }`

**Changed (gaps)** (was G15, G12). Each ID is one rule set (`QUALITY_RULESETS`):
`algorithm` defaults to `QUALITY_ALGORITHM` = `oscilla.confidence.v2`; `QUALITY_ALGORITHM_V1`
reproduces a v1 assessment exactly (verified against the 8628438 implementation in 45 input
combinations, and by its golden fixture) and reads neither discontinuities nor chain notes.
An unknown ID throws. Thresholds are the same object in both. v2 adds four codes, nothing else:

| Code (v2) | Dimension | Rule |
| --- | --- | --- |
| `DISCONTINUITY_IN_SWEEP` | capture | a `checkCapture` discontinuity overlapping the sweep window (every one without a window): fail, invalidating — the samples there are not the system's response |
| `DISCONTINUITY` | capture | discontinuities only outside the window: warn with their count; none in any run: ok (value 0) |
| `DISCONTINUITY_NOT_MEASURED` | capture | a capture check without a `discontinuities` list (pre-`oscilla.discontinuity.v1`): warn, not measured |
| `OUTPUT_CHAIN_DEVIATION` | range | `chainNotes.limiterDeviationAboveHz` = L: every grid point above L is set unreliable; warn "output chain deviates above L in this browser: … marked unreliable" (range = those points) when the grid (or, without a transfer, the requested range) reaches above L, else ok |

`chainNotes` is pure data reported by the platform layer, validated by `normalizeChainNotes`
(plain object, only `limiterDeviationAboveHz`, null or a finite frequency > 0; anything else
throws). quality.js does no browser sniffing. The case it exists for is the G12 measurement:
Firefox 155's DynamicsCompressor in the master chain deviates above 18 kHz at every level
([spike](spike-audioworklet-worker.md)). `engine.js` reads an optional `chainNotes` from the
io's PreflightFacts, warns in preflight (`OUTPUT_CHAIN_DEVIATION`) when the sweep reaches above
it, ignores an invalid note with `CHAIN_NOTES_IGNORED`, records it as `result.chainNotes` and
passes it to `assess` (context `chainNotes`); `assessMeasurement(result, ctx)` (engine.js) is the
standard `assess` — all runs' checks, the combined transfer, the aggregate, the applied
frequency calibration, the context's level calibration, per-run sweep windows from the
alignment lags, and the chain note. `capture.js` does not set the note yet; it is to come from a
measured probe. v2 metrics add `discontinuities` (count, null when no run was checked) after
`dropouts` and `outputChainLimitHz` (null without a note) at the end; v1 metrics are unchanged.

- `capture`: one `checkCapture()` result or one per run; `transfer`: a `computeTransfer()`
  result or null (RTA-only); `aggregate`: an `aggregateRuns()` result or null;
  `calibration`: `{ frequency: applyFrequencyCorrection() result (its `covered` on the
  transfer grid) or { coverage }, level: LevelCalibration }`; `requestedRange` defaults to
  `transfer.requestedRange`, `resolutionHz` to `transfer.binHz`; `sweepWindow` is the
  `[start, end)` sample range of the stimulus in the capture (or one per run).
- `summarizeQuality(assessment)` gives one or two sentences for screen readers (§150).

### Thresholds (`QUALITY_THRESHOLDS`, shared by the v1 and v2 rule sets)

| Name | Value | Rationale (from the code) |
| --- | --- | --- |
| `clipInvalidRatio` | 0.01 | ≥ 1 % rail samples: sustained overload, the response is the clipper's |
| `clipPoorRatio` | 0.001 | a tenth of that is still a sustained overload event (POOR) |
| `snrGoodDb` | 20 | noise ≤ 0.1 × signal bounds the magnitude error to +0.83/−0.92 dB |
| `snrUsableDb` | 10 | +2.4/−3.3 dB; equals `transfer.js` `VALID_MIN_SNR_DB` |
| `reliableMinSnrDb` | 10 | per-point margin of the reliable mask, = `VALID_MIN_SNR_DB` |
| `reliablePoolingFraction` | 6 | 1/6-octave pooling, = `VALIDITY_SMOOTHING_FRACTION` |
| `repeatabilityGoodDb` | 1 | the same ~1 dB bound as `snrGoodDb` |
| `repeatabilityUsableDb` | 3 | beyond ±3 dB a 3 dB feature is indistinguishable from scatter |
| `minRunsForRepeatability` | 2 | fewer runs: repeatability NOT MEASURED |
| `coverageGoodFraction` | 0.9 | octaves of `validRange` / octaves requested; one octave of ten may be lost |
| `coverageUsableFraction` | 0.5 | less than half the requested octaves: POOR |
| `frequencyCalibratedFraction` | 1 | "calibrated" needs the whole reliable range covered |
| `resolutionBandFraction` | 6 | Δf must be finer than 1/6 octave at the lowest reliable frequency |
| `poorWarnCount` | 3 | measured warns in three distinct dimensions compound to POOR |
| `lowSnrBandMinOctaves` | 1/6 | narrowest low-SNR band named as its own reason |
| `maxBandReasons` | 3 | display limit for named low-SNR bands (not a rule) |

### Reasons and rules

Reason: `{ code, scope: 'quality'|'calibration', severity: 'ok'|'warn'|'fail', text, value,
unit, range? }`. `value` is a finite number for every `ok` reason and null only for a quantity
not measured or absent. Only scope `quality` decides the status; `calibration` reasons
(`FREQUENCY_CALIBRATION`, `LEVEL_CALIBRATION`) only say how the numbers may be labelled.

| Code | Dimension | Severity rule |
| --- | --- | --- |
| `CAPTURE_MISSING`, `NO_SAMPLES`, `BAD_SAMPLE_RATE`, `NON_FINITE_CAPTURE`, `NO_SIGNAL` | capture | fail, invalidating (`NO_SIGNAL`: RMS below `EMPTY_RMS_DBFS`) |
| `CLIPPING_SEVERE` / `CLIPPING` | capture | worst run's ratio ≥ 0.01: severe fail (invalidating); ≥ 0.001 fail; any region warn; else ok |
| `DROPOUT_IN_SWEEP` / `DROPOUT` | capture | a dropout inside the sweep window (every interior dropout without a window) fails, invalidating; outside warns; none ok |
| `NON_FINITE_ANALYSIS` | analysis | non-finite grid, magnitude, SNR, phase or aggregate centre: fail, invalidating |
| `NO_VALID_RANGE` | range | `validRange` null: fail, invalidating |
| `SNR_MEDIAN` / `SNR_NOT_MEASURED` | snr | median per-point `snrDb` over the whole grid ≥ 20 ok, ≥ 10 warn, < 10 fail; no noise capture or no transfer: not measured (warn) |
| `LOW_SNR_BAND` | range | each run of 1/6-octave-pooled SNR < 10 dB at least 1/6 octave wide (the 3 widest): warn |
| `COVERAGE` | range | coverage fraction ≥ 0.9 ok, ≥ 0.5 warn, < 0.5 fail; mentions Nyquist when the request exceeds it |
| `REPEATABILITY` / `REPEATABILITY_NOT_MEASURED` | repeatability | `aggregate.repeatabilityDb` ≤ 1 ok, ≤ 3 warn, > 3 fail; < 2 runs or no aggregate: not measured (warn) |
| `RESOLUTION` | resolution | Δf ≤ f_low·(2^(1/12) − 2^(−1/12)) (= 0.1156·f_low) ok, else warn |
| `FREQUENCY_CALIBRATION` | calibration | none: warn; covers the whole reliable range: ok; partly: warn with the range |
| `LEVEL_CALIBRATION` | calibration | valid LevelCalibration: ok, text with its offset and "dB SPL" reference; otherwise warn, "levels are dB relative (dBFS-like)" |

Status (`decideStatus`):

| Status | Rule |
| --- | --- |
| INVALID | any invalidating code of the rule set (always `fail`) |
| POOR | not INVALID, and any other `fail`, or measured warns (not the NOT_MEASURED codes) in ≥ 3 distinct dimensions |
| USABLE | not POOR, and at least one `warn` (NOT_MEASURED included) |
| GOOD | every `quality` reason is `ok` |

GOOD therefore needs positive evidence on every dimension (a noise capture, ≥ 2 runs, coverage,
no clipping, no dropout); a missing measurement caps the status at USABLE without pushing it
to POOR. An INVALID assessment keeps only its `fail` reasons and an all-zero reliable mask.

### Masks and metrics

- `mask.reliable[i]`: with an SNR estimate, the 1/6-octave power mean of the linear per-point
  SNR ≥ 10 dB **and** f ≤ 0.95 × Nyquist; without one, inside `validRange`. A point need not lie
  in `validRange` (the longest run only) to be reliable.
- `mask.calibrated[i]`: the profile's `covered` flag on the same grid, else inside its
  `coverage`; never extrapolated.
- `metrics`: `snrMedianDb`, `snrMinDb` (worst pooled SNR inside `validRange`), `clippingRatio`,
  `clippingRegions`, `dropouts`, `repeatabilityDb`, `runs`, `requestedRange`, `coverage`,
  `coverageFraction`, `reliableRanges`, `unreliableRanges`, `calibratedRange`,
  `frequencyCalibrated`, `levelCalibrated`, `resolutionHz`.
- Text: frequencies through `formatFrequencyWithResolution` at the coarser of Δf and the grid
  step; levels through `formatDb` (`RELATIVE_UNIT` unless a valid level calibration applies);
  SNR and spreads as plain dB, whole dB in passing reasons and one decimal in warn/fail
  reasons; a passing "agree within ±x dB" rounds x up to 0.1 dB. Never "high confidence".

### Assumptions and limits

Thresholds are engineering choices with stated rationale, versioned by the ID (§199): changing
any threshold, rule or invalidating code mints the next ID (v2 did, for the discontinuity rule
and the chain note). SNR, coverage and the masks come from the one `transfer` passed (with
repeats, the caller chooses which run; the aggregate contributes only `repeatabilityDb`). The
chain note caps the reliable mask, not `validRange`/`COVERAGE`. The engine's own capture checks
still stop a run on any `DISCONTINUITY` (stricter than v2's window rule).

### Tests (`v3-quality.test.mjs`)

Fixtures run the real chain (rendered sweep → gain or RBJ low-pass + seeded Gaussian noise →
`checkCapture` → `computeTransfer` with a noise capture → `aggregateRuns`). Assertions are on
the documented rules, so they are exact (status, codes, severities, values equal to the
inputs they came from):

| Test | Checks |
| --- | --- |
| thresholds frozen and consistent | `reliableMinSnrDb` = `VALID_MIN_SNR_DB`, pooling = `VALIDITY_SMOOTHING_FRACTION` |
| clean repeated response (σ = 1e-3, 3 runs) | GOOD with ok reasons for every dimension |
| low SNR (σ = 0.15) | USABLE; the band lost in noise named with its range |
| very low SNR (σ = 0.3) | POOR with a failing `SNR_MEDIAN` |
| severe / mild / sustained clipping | INVALID / warn / POOR with `checkCapture`'s ratio and regions |
| high-variance runs | repeatability warn at ±2 dB, fail at ±4 dB |
| missing / valid / tampered level calibration | never "SPL" unless valid; offset reported when valid |
| calibrated mask (20 Hz-16 kHz profile), partial coverage | mask and `FREQUENCY_CALIBRATION` follow the coverage |
| request above Nyquist | reported in the coverage text, not truncated silently |
| empty capture, silence, missing checks; dropout in/out of the sweep window | INVALID / warn as ruled |
| non-finite analysis output, empty valid range | INVALID |
| no noise capture | `SNR_NOT_MEASURED`; reliability falls back to `validRange` |
| RTA-only (no transfer) | resolution judged against the requested range |
| `maskRuns` / `maskRanges`; reliable mask = pooled SNR test | contiguous inclusive runs; ranges partition the grid |
| inputs not mutated, deterministic output | exact |

`v3-integration.test.mjs` "G4" and `v3-pipeline.test.mjs` check that a real assessment (with
`scope` and `mask`) is stored, validated and re-exported unchanged. `v3-gaps.test.mjs` (exact):
the rule sets (v2 = v1 + four codes, shared thresholds, unknown IDs rejected); a 0.2 step at
75 Hz in the sweep (both edges found by `checkCapture`) is INVALID under v2 and not under v1;
outside the window it warns, without a window it invalidates, per-run windows apply per run, a
clean pair is GOOD under both with identical other reasons; a check without a discontinuity
list caps at USABLE; chain notes at 2 kHz zero every point above it with the documented reason
and range, at 18 kHz (above the grid) give an ok reason and an unchanged mask, RTA-only uses the
requested range, v1 ignores them, invalid notes throw; through the engine a note reaches
preflight, `result.chainNotes`, the assess context and the mask, and an invalid one is ignored
with a warning.

## Measurement state machine (`measurement/state-machine.js`)

Not an analysis algorithm, but it gates when analysis may run. States IDLE, PREFLIGHT,
NOISE_CHECK, READY, ARMED, MEASURING, ANALYZING, and the terminal COMPLETE, INVALID, ABORTED,
ERROR. Every allowed edge is in `TRANSITIONS`; `go()` throws `IllegalTransitionError` for any
other (no self-loops). `abort()` reaches ABORTED from every active state and is a no-op
elsewhere; ERROR leads only back to IDLE. History is bounded (`HISTORY_LIMIT = 256`) and
timestamps come from the caller. Tests check every listed edge, every unlisted edge, abort from
every active state, and bounded history over 256 repeat loops.

## References

- A. Farina, "Simultaneous measurement of impulse response and distortion with a swept-sine
  technique", 108th AES Convention, Paris, 2000, preprint 5093.
- S. Müller, P. Massarani, "Transfer-function measurement with sweeps", J. Audio Eng. Soc.
  49(6), 2001, pp. 443-471.
- O. Kirkeby, P. A. Nelson, H. Hamada, F. Orduña-Bustamante, "Fast deconvolution of multichannel
  systems using regularization", IEEE Trans. Speech Audio Process. 6(2), 1998, pp. 189-194.
- IEC 61260-1:2014, Electroacoustics — Octave-band and fractional-octave-band filters — Part 1:
  Specifications (band-edge mathematics §5; Annex E preferred mid-band frequencies). Used for
  band layout only; OSCILLA does not meet its filter-class requirements.
- IEC 61672-1:2013, Electroacoustics — Sound level meters — Part 1 (time-weighting constants,
  named only).
- F. J. Harris, "On the use of windows for harmonic analysis with the discrete Fourier
  transform", Proc. IEEE 66(1), 1978, pp. 51-83.
- P. D. Welch, "The use of fast Fourier transform for the estimation of power spectra",
  IEEE Trans. Audio Electroacoust. 15(2), 1967, pp. 70-73.
- R. J. Hyndman, Y. Fan, "Sample quantiles in statistical packages", The American Statistician
  50(4), 1996, pp. 361-365.
- P. D. Hatziantoniou, J. N. Mourjopoulos, "Generalized fractional-octave smoothing of audio and
  acoustic responses", J. Audio Eng. Soc. 48(4), 2000.
- JCGM 100:2008, Evaluation of measurement data — Guide to the expression of uncertainty in
  measurement (GUM).
- P. Kellet, pink-noise filter (music-dsp mailing list archive, "Filter to make pink noise from
  white"), used as an engineering approximation, not a standard.
- NIST FIPS 180-4, Secure Hash Standard (SHA-256); RFC 4648, base64.
- R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter coefficients" (test systems
  only).

## Gaps

Differences between the specification, the contract or the ADRs and what the code does.
**Closed** by the integration fixes on top of 88c0daf (sections marked "Changed (integration)"):
G1 power scales, G2 recipe stimulus, G3 IR validation, G4 null valid range / zero-power encoding
/ `rtaResult`, G5 discontinuities, G6 Blackman-Harris ID, G7 IDs stamped, G8 phase robustness,
G9 Farina ID (the ε deviation from ADR 0021 is documented in [Impulse response](#ir)), G10 one
uncalibrated label, G11 calibration of RTA bands, G13 result hash; G14 is documented in
[Quality](#quality). Also closed: `assessQuality()` output was rejected by validation (`mask`,
reason `scope`; found by the pipeline test).

**Closed** by the gap fixes on top of 8628438 (sections marked "Changed (gaps)"):

- **G12 Output limiter (§207).** Decided by the spike: playback always passes the master chain,
  which is part of the measured system. The one measured non-transparency (Firefox above 18 kHz)
  is now expressible as data: `chainNotes.limiterDeviationAboveHz` from the io's preflight facts
  marks the bins above it unreliable with `OUTPUT_CHAIN_DEVIATION` ([Quality](#quality)).
  Open: `capture.js` does not set the note yet (it needs a measured probe, not browser
  sniffing).
- **G15 Quality ignores discontinuities.** `oscilla.confidence.v2` reads them
  (`DISCONTINUITY_IN_SWEEP` invalidating); v1 is retained and reproducible.
- **G16 No stored form for an aggregate.** `aggregateResult()` → optional `results.aggregate`,
  validated, hashed, exported (`aggregateCsv`), ID `oscilla.aggregate.v1`.
- **G17 Phase threshold.** Documented as an engineering choice with the measured relation
  ρ = 1/√(1 + 1/SNR) and phase errors ([Transfer function](#transfer)). Still not reported: a
  per-point phase uncertainty.
- **G18 Fixture per ID.** [Golden outputs per ID](#golden).
- **G19 Calibrated transfer column.** `magnitude_db_corrected` is a ratio; dB SPL only in
  `rtaCsv` level_db_spl under a valid level calibration.

**Closed** on top of d689631:

- **G20 Stored transfer vs aggregate.** The storage rule is in
  [Aggregation](#aggregate) ("Storage rule for repeated measurements"): aggregate primary,
  `results.transfer` the marked centre (`derivedFrom: 'aggregate'`) or null, individual runs
  only on request in `results.runTransfers`; one rule in `engine.js`, `schema.js`
  (`resultsFromMeasurement`), `validate.js`, `hash.js`, `csv.js` and `compare.js`.
- **Capture clock (found while hardening the V3 browser test).** Chromium 153 under CPU load
  reports a stale `currentFrame` in the capture worklet for one render quantum (`F, F, F + 256`
  over three `process()` calls, each with fresh input), which wrote one quantum over the
  previous one and left a 128-frame hole (`FRAMES_MISSING`, sometimes `DISCONTINUITY`): the
  intermittent INVALID loopback in `tests/browser/v3-measure.cjs`. The processor now indexes
  frames by its own quantum count, moved forward to `currentFrame` only when the clock is
  ahead (`capture.js` `CAPTURE_WORKLET_SOURCE`); a pure-gain pre-limiter loopback is
  sample-exact (max |capture − g·stimulus| = 0) including captures that needed a correction,
  and the browser test asserts that.

Remaining:

- **G21 Longest analysis block.** `transfer+impulse-response` is one engine step (≈ 360-520 ms
  in Node for a 10 s sweep at 48 kHz), longer than either step was; the Worker integration of the
  spike is still the remedy. **Prepared (G21):** the whole analysis is one serializable task,
  `measurement/analysis-task.js` `runAnalysis(message) → result` (plain data and transferable
  typed arrays in and out, bit-identical to the previous engine analysis:
  `tests/unit/v3-analysis-task.test.mjs`), which `engine.js` calls through the injected
  `analyze` (default `analyzeInline`, yields between steps as before). Moving it into a
  `data:` Worker needs only the bundled Worker source (a `scripts/build.mjs` sub-build) and an
  `analyze` that posts the message with `analysisTransferList(message, { keepRaw })`.
