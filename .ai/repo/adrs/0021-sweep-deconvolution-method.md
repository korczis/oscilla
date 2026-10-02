---
schema: adr/v1
id: adr-0021
kind: adr
title: Sweep deconvolution divides by the spectrum of the rendered canonical sweep with band-limited regularization; Farina's inverse filter is the test oracle
status: proposed
date: 2026-10-02
tags:
  - dsp
  - impulse-response
  - transfer-function
  - v3
provenance:
  origin: authored
---

# 21. Sweep deconvolution divides by the spectrum of the rendered canonical sweep with band-limited regularization; Farina's inverse filter is the test oracle

## Context

V3 must recover the impulse response and the magnitude response of the playback/capture chain
from an exponential (logarithmic) sine sweep (specification §26-§28, §37-§38, §206). Two
established methods exist:

- Farina's inverse filter (A. Farina, "Simultaneous measurement of impulse response and
  distortion with a swept-sine technique", AES 108th Convention, 2000, preprint 5093): convolve
  the capture with the time-reversed sweep, amplitude-weighted to compensate the sweep's
  falling energy per hertz. Harmonic distortion products land before the linear response and can
  be windowed out.
- Spectral division (discussed with sweep generation and deconvolution in S. Müller and
  P. Massarani, "Transfer-function measurement with sweeps", J. Audio Eng. Soc. 49(6), 2001):
  H(f) = Y(f)·X*(f) / (|X(f)|² + ε(f)), with X the spectrum of the emitted stimulus.

The analytic inverse filter describes the ideal sweep; the emitted sweep has fades, a clamped end
frequency and a digital level, so its band edges and gain differ from the analytic model.
Specification §206 requires the inverse to match the emitted digital stimulus. Not yet
implemented (issue V331).

## Decision

Proposed:

- Deconvolve by regularized spectral division against X, the FFT of the exact rendered stimulus
  (`renderStimulus` from the canonical spec), zero-padded with the aligned capture to a power of
  two at least as long as their linear convolution, so no circular wrap reaches the response.
- ε(f) is negligible inside the excited band [f1, f2] and large outside it and near the
  fade-affected edges, so out-of-band noise is not amplified. Its profile is a named,
  documented parameter of `oscilla.ir.log-sweep.v1`.
- One deconvolution gives both views: H(f) inside the valid band is the transfer magnitude
  (`oscilla.transfer.v1`), and its inverse FFT is the impulse response, kept at original scale
  with the direct-peak index and the absolute capture offset. Distortion products remain at
  negative time (the end of the circular buffer) for an exponential sweep and are excluded by the
  IR window, not deleted.
- Farina's analytic inverse filter is implemented in the tests as an independent oracle: both
  methods must locate the same peaks of synthetic delayed-impulse and echo systems.

## Alternatives rejected

- Farina's analytic inverse as the production method: simple and well known, but it ignores the
  emitted fades and clamped range, so band edges and absolute gain carry a model error that the
  exact spectrum does not.
- Unregularized division: divides by near-zero energy outside the swept band and amplifies noise
  without bound.
- MLS or noise excitation for the primary IR: lower immunity to the chain's nonlinearity and
  time variance; noise remains a stimulus for RTA, not for the V3.0 IR.

## Consequences

- FFT size grows with sweep plus capture: a 20 s sweep with 2.5 s of pre- and post-roll at 48 kHz
  needs 2²¹ points, about 32 MiB per complex Float64 array (2²² at the 30 s sweep cap). This
  bounds memory and favours a Worker (ADR 0026).
- The regularization profile shapes the band edges; it is recorded in results through the
  algorithm ID, and a change is a new ID (ADR 0024).
- Confirmation criteria: flat, −6 dB, low-pass, high-pass and known-EQ systems are recovered
  within tolerances derived from ε and window leakage (§138); impulse, delayed impulse and echo
  peaks are located to the sample (§139); 44.1, 48 and 96 kHz pass (§204); the cross-model DSP
  review (§186) finds no scaling error. Revise toward the Farina inverse filter if those tests or
  the review show spectral division is worse at band edges or under noise, or if the benchmark
  (§171) shows it does not fit the time budget.
