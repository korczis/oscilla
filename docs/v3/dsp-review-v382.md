# V382 — independent DSP review (spec §186, §235)

Three independent Claude reviewers, none of whom wrote the code, each critiqued one area at main
95f7b97. Every claimed defect had to come with a synthetic proof run through the real functions;
each fix landed with a test that fails on the old method. Changed results mint new algorithm IDs
and keep the old ones reproducible (ADR 0024). This file is the record the issue asked for.

## Defects found and fixed

| Area | Defect (measured) | Fix | PR |
|---|---|---|---|
| Live RTA | FFT mode applied a 'correction' profile with the deviation sign (12 dB disagreement with band mode) | `conventionSign(profile)` | #51 |
| Level calibration | Profile correction at the reference frequency counted twice: a 94 dB calibrator read 92.0 dB SPL, CALIBRATED | `levelOffsetWithProfile` | #52 |
| Transfer | Unity system read −0.55 to −0.99 dB inside a v2 `validRange` near f2 | `transfer.v3` bias condition ≤ 0.1 dB | #57 |
| Impulse response | 5 ms pre-guard cut the band-limit ringing: −1.22 dB at 30 Hz | `ir.v3` guard max(5 ms, 5/f1) | #57 |
| Docs | Regularization bias is −20·log10(1+ε/\|X\|²), not −10·; Farina inverse unity only at √(f1·f2); harmonics inside `samples` without a lag | corrected | #57 |
| Capture checks | 1 dB overload of a tone above 5 kHz: 5.1 % rail samples, no clip region, USABLE | `clip.v2` (3 rail samples within 1 ms) | #55 |
| RTA | 2-bin under-resolution limit: unflagged bands read up to 1.57 dB low | `rta.v2` (6 bins Hann, 8 Blackman-Harris) | #58 |
| Smoothing | Window edges decided by rounding: ramp offset varied by 0.12 dB | `smoothing.v2` (edge tolerance) | #58 |
| Quality | Unscaled MAD against the SD threshold; empty grid rated GOOD; NaN pooled SNR threw | `confidence.v4` | #59 |
| Alignment | Parabolic sub-sample fit biased up to 0.061 samples (−9.9° phase at 19 kHz) | `align.v2` (windowed-sinc peak) | #60 |

## Verified correct (with numbers, not changed)

- FFT against a naive DFT within 7.4e-13; bin-to-Hz mapping and phase sign correct.
- ESS formula, L = T/ln(f2/f1), the e^(−t/L) inverse envelope; inverse gain at √(f1·f2)
  within 0.0007 dB.
- Known FIRs through transfer + alignment: magnitude ≤ 0.009 dB, phase ≤ 0.007°.
- Window coherent gain / ENBW to 8e-16; full-scale sine 0 dB (tone scale) and −3.0103 dB
  (mean-square) at every N and rate; Parseval to 2e-15.
- Band edges per IEC 61260-1 base 10; band power sums bin powers; averaging in the power domain.
- Calibration sign conventions, log-frequency interpolation, UMIK sensitivity lines kept and not
  applied, "dB SPL" only under a valid calibration, no hidden A-weighting.
- 44.1 and 48 kHz equivalent in every probe.

## Release readiness

`npm run release-gate` passed on the fix branches (exit 0), and CI runs every suite in three
browsers on each PR. Open, not defects: no confidence figure is shown for averaged RTA levels
(overlapping frames), and a −300 dB (zero-power) run makes the aggregate spread meaningless at
that point; both are recorded for a later version.
