# OSCILLA V3 measurement algorithms

Specification: `docs/specs/oscilla-v3-measure.md` (§137 algorithm documentation, §186-§187
review and references). Contract: `docs/v3/architecture.md`. Rationale: ADRs 0017-0026 under
`.ai/repo/adrs/`. This document says **how** each algorithm is computed as implemented in
`src/js/`, which tests pin it, and how much margin those tests have. It does not repeat why a
method was chosen; the ADRs do.

Every statement below is traceable to a file and function. Measured margins were taken from
the test diagnostics (`node --test tests/unit/v3-*.test.mjs`) or by re-running the test
computation with the same seeds; they describe the current code at `origin/feature/v3`
(b650281) and will drift if the code changes. Where the code and the specification disagree,
the disagreement is listed under [Gaps](#gaps), not resolved here.

## Contents

| ID | Module (function) | Section |
| --- | --- | --- |
| (none; recorded through the recipe) | `measurement/stimulus.js` | [Stimuli](#stimuli) |
| `oscilla.window.hann.v1` | `measurement/spectrum.js` | [Windows, spectra, Welch](#windows) |
| `oscilla.clip.v1` | `measurement/capture-checks.js` | [Capture checks](#capture-checks) |
| `oscilla.align.xcorr.v1` | `measurement/align.js` | [Alignment](#alignment) |
| `oscilla.transfer.v1` | `measurement/transfer.js` | [Transfer function](#transfer) |
| `oscilla.ir.log-sweep.v1` | `measurement/impulse-response.js` | [Impulse response](#ir) |
| `oscilla.smoothing.fractional-octave.v1` | `measurement/smoothing.js` | [Smoothing](#smoothing) |
| `oscilla.rta.v1` | `measurement/rta.js` | [RTA bands](#rta) |
| (none) | `measurement/aggregate.js` | [Aggregation of repeats](#aggregate) |
| `oscilla.calibration.log-interp.v1` | `calibration/*.js` | [Frequency calibration](#calibration) |
| (none) | `calibration/level.js` | [Level calibration, SPL](#level) |
| (none) | `measurement/format.js` | [Resolution-aware formatting](#format) |
| (none) | `experiments/*.js` | [Experiment hashing, encoding](#experiments) |
| `oscilla.confidence.v1` | `measurement/quality.js` (not yet landed) | [Quality](#quality) |

## Conventions

- Signals are `Float32Array` (inputs, stimuli, IR samples); accumulators and derived curves are
  `Float64Array`. No module mutates its inputs; every test file checks this for its module.
- "dB" always means `10·log10(power)` or `20·log10(amplitude)` of a **digital** quantity.
  Nothing in the analysis layer knows sound pressure; see [Level calibration](#level).
- Two power scales exist in the code and must not be confused (see [Gaps](#gaps), G1):
  - **Tone scale** (`spectrum.js`): a full-scale sine centred on a bin reads power 1, 0 dB
    (AES17-style dBFS).
  - **Mean-square scale** (`rta.js` input contract): Σ power over all bins equals the signal's
    mean square, so a full-scale sine reads 0.5, −3.01 dB.
- Zero power: `transfer.js` and `impulse-response.js` floor dB at `ZERO_POWER_DB = −300` so
  results stay finite and JSON-safe; `spectrum.js` `toDb` and `rta.js` `powerToDb` return
  `−Infinity`.
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

Which modules stamp their ID into their result: `transfer.js` (`TRANSFER_ALGORITHM`),
`impulse-response.js` (`IR_ALGORITHM`), `interpolate.js` (`CALIBRATION_ALGORITHM` in the
`applyFrequencyCorrection` result). `smoothing.js` exports `SMOOTHING_ALGORITHM` but its
functions return plain arrays. `align.js`, `capture-checks.js`, `spectrum.js` and `rta.js` do
not reference their IDs; the caller must record them (G7).

Test: `v3-measurement-core.test.mjs` "algorithms: frozen contract IDs ..." (exact equality).

<a id="stimuli"></a>
## Stimuli (`measurement/stimulus.js`)

No algorithm ID: the stimulus is fully described by its normalized spec, which the recipe
stores (§103), so the spec itself is the record.

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
  reported as `clampedTo` (Hz); everything else invalid throws `StimulusError` with a code
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
## Windows, power spectrum and Welch — `oscilla.window.hann.v1` (`measurement/spectrum.js`)

### Windows: `windowFn(name, n) → { name, samples, coherentGain, noisePowerGain, enbwBins }`

Periodic (DFT-even) forms with period N (Harris 1978):

```
hann              w[n] = 0.5 − 0.5·cos(2πn/N)        coherentGain 0.5, noisePowerGain 0.375
blackman-harris   w[n] = a0 − a1·cos(x) + a2·cos(2x) − a3·cos(3x),  x = 2πn/N
                  a = 0.35875, 0.48829, 0.14128, 0.01168 (−92 dB side lobes)
                  coherentGain a0, noisePowerGain a0² + (a1² + a2² + a3²)/2
enbwBins = noisePowerGain / coherentGain²            1.5 (Hann), ≈ 2.0044 (Blackman-Harris)
```

The gains are exact constants (`WINDOW_GAINS`) because the windows are periodic.

### Power spectrum: `createPowerSpectrumAnalyzer(fftSize, window)`, `powerSpectrum(samples, opts)`

Tone scaling, `fftSize/2 + 1` bins, samples outside the input count as zeros:

```
P[k] = |2·X[k] / (N·coherentGain)|²    0 < k < N/2
P[k] = |X[k] / (N·coherentGain)|²      k = 0, N/2
```

A full-scale sine centred on a bin reads `P = 1`, 0 dB after `toDb`. Off-centre tones read
lower by the scalloping loss (up to 1.42 dB Hann, 0.83 dB Blackman-Harris). For broadband
signals Σ P over a band overstates the band's tone-scale power by `enbwBins`; dividing by
`2·enbwBins·binHz` gives a density per Hz on the same scale (header comment). `powerSpectrum`'s
default `fftSize` is the largest power of two that fits. `binHz(sr, n) = sr/n`.

### Welch: `welch(samples, { fftSize, overlap = 0.5, window = 'hann' })`

Returns `{ power, segments, fftSize, hop, window }`. `hop = max(1, round(fftSize·(1 −
overlap)))`, segments start at 0, hop, 2·hop … while a full segment fits, and `power` is the
mean of the **linear** tone-scaled spectra (Welch 1967). `overlap` must lie in [0, 0.95]; input
shorter than one segment throws instead of zero-padding.

### Assumptions and limits

Only the Hann window has an algorithm ID; a Blackman-Harris analysis cannot be recorded
distinctly (G6). The tone scale is not the scale `rta.js` expects (G1).

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

<a id="capture-checks"></a>
## Capture checks — `oscilla.clip.v1` (`measurement/capture-checks.js`)

`checkCapture(capture, opts) → { clipping: { ratio, regions }, dropouts, rms, peak, empty,
invalid, reasons }`. Digital integrity only; a capture that passes can still be acoustically
wrong. Regions are half-open `[start, end)`.

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
- Reason codes: `NO_SAMPLES`, `BAD_SAMPLE_RATE`, `NON_FINITE`, `EMPTY`, `CLIPPING`, `DROPOUT`;
  `invalid` is true exactly when `reasons` is non-empty. All thresholds are overridable through
  `opts`.

Limits: discontinuities (steps without a constant run) are not detected (G5). RMS and peak are
digital (dBFS), not acoustic.

Tests (`v3-measurement-core.test.mjs`, all exact): clipped sine gives one merged region equal to
an independent rail-run reference and the exact ratio; one or two 0.99 samples are not clipping,
three are; 50 ms of zeros inside is a dropout `[20000, 22400)`, 10 ms is not, a frozen non-zero
value is, leading silence is not; silence is `EMPTY` (not a dropout); −100 dBFS RMS noise is
empty, −60 dBFS is not; NaN, empty input and missing sample rate give their codes.

<a id="alignment"></a>
## Alignment — `oscilla.align.xcorr.v1` (`measurement/align.js`)

`align(reference, captured, sampleRate, { maxLagS, minLagS = 0 }) → { lagSamples, lagSeconds,
peakCorrelation, polarity }`.

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

`computeTransfer({ stimulus, captured, sampleRate, f1, f2, lagSamples, noise, options:
{ phase = false, pointsPerOctave = 48 } }) → TransferResult`. Method: regularized spectral
division (Müller & Massarani 2001, §5; regularization after Kirkeby et al. 1998), shared with the
IR through `spectralDeconvolution`.

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

### Phase (§27: never faked)

Only when `options.phase === true` **and** `lagSamples` is supplied; otherwise `phaseDeg` is
`null`. Each bin is rotated by `e^(+j2πk·lag/N)` to remove the aligned delay, the rotated
complex values are averaged over the grid band, and the angle is reported wrapped to
(−180°, 180°]. The module does not judge whether the alignment is robust; the caller does (G8).

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
| phase of the 1 kHz low-pass with lag, 50 Hz-10 kHz | < 2° | pass |
| phase null without lag or without `phase: true` | exact | pass |
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

<a id="ir"></a>
## Impulse response — `oscilla.ir.log-sweep.v1` (`measurement/impulse-response.js`)

`computeImpulseResponse({ stimulus, captured, sampleRate, f1, f2, inverse, method, lagSamples })
→ IrResult` plus `method` and `fftSize`.

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

### Assumptions and limits

As for the transfer function. `noiseFloorDb` is relative to the peak, not an absolute level. The
peak is the largest absolute sample, which is the direct sound only when nothing arrives
stronger later. The IR result shape carries `method` and `fftSize`, which experiment validation
does not yet accept (G3).

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

<a id="smoothing"></a>
## Smoothing, normalization — `oscilla.smoothing.fractional-octave.v1` (`smoothing.js`)

Both are **derived views**: they return new arrays and never modify the raw response (§34, §35,
§159).

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

### `normalizeResponse(frequencies, magnitudeDb, spec) → { mode, normalizedDb, referenceDb, label }`

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
Bin k covers `[(k − ½)·binHz, (k + ½)·binHz]`, power is assumed uniform within a bin, and

```
bandPower = Σ_k P[k]·w[k],  w[k] = overlap of bin k's cell with [lo, hi], in bins (0 … 1)
levelDb   = 10·log10(bandPower)            (−Infinity for zero power; dB never averaged)
```

`bandBinCounts` returns the effective bin count (band width in bins where the spectrum covers it)
and `underResolved = binCount < UNDER_RESOLVED_BINS (2)`: such a band's level is dominated by the
window main lobe and bin placement. `bandAnalysis` returns `{ levelsDb, power, binCounts,
underResolved }`; `bandPowers` returns the dB array only (contract signature).

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

The tests feed `bandPowers` a mean-square-scaled Welch spectrum built in the test file, not
`spectrum.js` output (see G1).

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
1-10 repeat limit.

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
- `format.js` `formatDb(value, { kind })` prints "dB SPL" only when the caller passes
  `kind: 'spl'`; an unknown kind throws rather than falling back.

Limits: a single broadband scalar for the whole input chain, valid only for the device, input
gain, browser processing and microphone position it was taken with. X must be read on the same
scale and with the same frequency-correction state as later readings, otherwise the correction
at `referenceHz` (or the 3 dB tone-scale versus mean-square-scale difference, G1) is counted
twice. It is independent of, and never derived from, a frequency profile (§17).

Tests (`v3-calibration.test.mjs`, exact): offset 94 − (−30.5) = 124.5 dB and display 84.5 dB SPL
for −40 dB relative; SPL label only for a valid calibration; `null`, `{}`, a tampered offset, a
wrong kind, an out-of-range reference and a frequency profile all read UNCALIBRATED; invalid
references rejected, bounds 20 Hz/140 dB and 20 kHz/40 dB accepted. `v3-rta-aggregate.test.mjs`
"format: dB labels" checks "relative" never prints SPL.

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
`algorithms` or `sampleRate` change. No result hash (§101) is implemented.

### Typed-array encoding (`encode.js`, §56-§57)

`EncodedArray = { dtype: 'f32'|'f64'|'u8', length, encoding: 'base64-le', data }`: elements
written little-endian explicitly through `DataView`, then standard padded base64 (RFC 4648 §4,
implemented locally, no `btoa`/`Buffer`). Decoding is strict: exactly those four keys, known
dtype (optionally restricted), `length ≤ maxLength` checked **before** allocation, base64 text
length equal to `ceil(length·bytes/3)·4`, only the RFC alphabet, padding only at the end, zero
unused bits. `serializeExperiment` turns every typed array into an EncodedArray;
`experimentToJson` writes the `.oscilla.json` text.

### Import validation and migration (`validate.js`, `migrate.js`)

`validateExperiment(json, opts)` never throws: size cap `DEFAULT_MAX_BYTES` = 32 MiB measured as
UTF-8 before `JSON.parse`; structural scan (depth ≤ 32, plain objects only, no `__proto__`,
`constructor`, `prototype` keys, finite numbers); schema migration; strict schema check
(unknown fields rejected, numeric bounds from `schema.js` `LIMITS`, string caps, algorithm IDs
against `knownAlgorithms` or the ID pattern, calibration shape, result arrays decoded with
`DEFAULT_MAX_ARRAY` = 4 000 000 elements and plain arrays ≤ 65 536). It returns a normalized deep
copy. `migrateExperiment` runs registry steps `n − 1 → n` in order (schema 1 is an identity
placeholder), rejects newer schemas with a clear message, and never modifies its input.

`newExperimentId(bytes16)` formats caller-supplied random bytes as a UUIDv4 (version and variant
bits set); the module uses no randomness or clock of its own.

### Tests (`v3-experiments.test.mjs`)

Encoding round trip is bitwise (including a float32 subnormal and `−0`); base64 matches `Buffer`
and rejects non-canonical input; declared/decoded length mismatches, oversize arrays, wrong
types, NaN/Infinity anywhere, unknown algorithm IDs, malformed calibration, forbidden keys,
oversize files and future schema versions are rejected with paths; a synthetic schema-0 document
migrates; create → encode → JSON → validate is identical (§144); `configHash` is stable under
key reordering, ignores the 12 listed non-configuration fields and changes for the 10 listed
configuration fields, and the bundled SHA-256 equals `node:crypto`. These tests build result
objects by hand rather than from the analysis modules, which is why G2-G4 are not caught.

<a id="quality"></a>
## Measurement quality — `oscilla.confidence.v1` (placeholder)

**Not yet documented.** `src/js/measurement/quality.js` has not landed on `feature/v3`
(b650281); it is being written now. This section will be completed from the code when it lands:
the metrics, the named thresholds, the exact GOOD / USABLE / POOR / INVALID rules, the reason
codes, and the tests that pin them. Until then nothing in this document describes how quality is
assessed. Inputs it is expected to consume already exist: `checkCapture` reasons, per-point
`snrDb` and `validRange` from the transfer, `repeatabilityDb` from aggregation, calibration
`coverage`, and `binHz`.

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

Differences between the specification, the contract or the ADRs and what the code does at
b650281. Each is stated, not fixed here.

- **G1 Two power scales.** `spectrum.js` (`powerSpectrum`, `welch`) uses the tone scale
  (full-scale sine = 0 dB); `rta.js` requires the mean-square scale (full-scale sine = −3.01 dB).
  No exported function converts between them. Feeding `welch().power` into `bandPowers` reads
  every band `10·log10(2·enbwBins)` too high: +4.77 dB with Hann, +6.03 dB with Blackman-Harris
  (bins other than DC and Nyquist; measured +4.78 dB on white noise). The RTA tests avoid this by
  building their own mean-square spectrum. Both scales are labelled "dB relative".
- **G2 Recipe cannot hold a rendered stimulus spec.** `schema.js` `STIMULUS_FIELDS` lacks
  `color` and `law`, which `normalizeStimulus` always emits, so
  `createRecipe({ stimulus: renderStimulus(spec).spec })` throws ("unknown field"), contrary to
  the `createRecipe` doc comment. Band-noise colour and chirp law are therefore not recordable,
  and the experiment cannot reproduce such a stimulus. The schema also allows durations from
  0.01 s (chirp minimum is 0.005 s), fades up to duration/2 (stimulus caps at duration/4), and
  frequencies up to Nyquist (stimulus clamps at 0.95 × Nyquist).
- **G3 IR result rejected by validation.** `computeImpulseResponse` returns `method` and
  `fftSize`; `validate.js` `checkIr` treats both as unknown fields, so a real IR result cannot be
  stored or exported unchanged (verified).
- **G4 Null valid range and −Infinity levels rejected.** `computeTransfer` may return
  `validRange: null`, but `checkTransfer` requires a pair. `bandPowers`/`bandAnalysis` return
  `−Infinity` for a band with no power, but `checkRta` requires finite levels. No module builds
  the `RtaResult` object (`{ algorithm, sampleRate, resolution, bands, levelsDb, fftSize }`)
  that validation expects.
- **G5 Discontinuity detection (§68).** The specification asks for detection of
  discontinuities; `checkCapture` detects constant runs (stalls, zeros), empty and non-finite
  captures only.
- **G6 Window choice not recordable (§86).** `ALGORITHMS.window` is `oscilla.window.hann.v1`
  only; `spectrum.js` also offers Blackman-Harris, which has no ID. The transfer and IR use no
  analysis window at all (whole-buffer DFT), so the window ID applies to Welch/RTA only.
- **G7 IDs not stamped.** `align.js`, `capture-checks.js`, `spectrum.js` and `rta.js` do not
  attach `oscilla.align.xcorr.v1`, `oscilla.clip.v1`, `oscilla.window.hann.v1` or
  `oscilla.rta.v1` to their results; `smoothing.js` exports its ID but its outputs do not carry
  it. The orchestration layer (`engine.js`, not yet written) must record them (§43).
- **G8 Phase robustness criterion (§27).** `computeTransfer` reports phase for any supplied lag
  when asked; no threshold on `peakCorrelation` (or any other robustness test) is defined in the
  code. It is left to the caller or `quality.js`.
- **G9 ADR 0021 vs code.** ADR 0021 describes ε as large "near the fade-affected edges" and
  Farina's inverse as a test oracle. The code applies −60 dB uniformly across [f1, f2] (edges
  included) and ships `farina-inverse` as a selectable production method under the same IR
  algorithm ID; a result's `method` field (rejected by validation, G3) is the only distinction.
- **G10 Label wording.** The same uncalibrated scale is written three ways: `level.js`
  "dB relative (dBFS-like)", `format.js` "dB relative", `csv.js` "dB relative (dBFS-like), not
  SPL"; the specification (§24) asks for "Relative level, dBFS-like / analyser-relative scale".
- **G11 Calibration not wired to RTA (§45).** No code applies a frequency profile to RTA bands;
  `applyFrequencyCorrection` works on any frequency/dB pair and could be applied at band centres,
  which ignores the correction's variation inside a band.
- **G12 Output limiter (§207).** Whether measurement playback passes through the V2 master
  limiter/ceiling is decided by the not-yet-written engine; if it does, the limiter is part of the
  measured chain and is not compensated.
- **G13 Result hash (§101)** is not implemented (the specification marks it optional).
- **G14 Quality (§64-§66, §143, §199, §220-§221)** is not implemented on this commit; see
  [Quality](#quality).
