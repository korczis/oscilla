// OSCILLA calibration — the reference reading of a level calibration (spec §22-§24). Pure.
//
// measureReferenceLevel(capture, { referenceHz }) reads the observed level X of an external
// reference (a calibrator on the microphone) from a stimulus-free capture of the SAME capture io
// MEASURE uses (capture.js io.captureNoise), on the SAME scale as the MEASURE noise and RTA band
// levels (level.js LEVEL_SCALE):
//   Welch power spectrum (Hann, REFERENCE_FFT = 8192 points, 50 % overlap, spectrum.js welch),
//   converted to the mean-square scale and integrated over the one-third-octave band that
//   contains referenceHz (rta.js bandCenters / integrateBands: the base-ten band edges of
//   IEC 61260-1, fractional bin weights). X = 10·log10(band power), dB re digital full scale on
//   the mean-square scale, so a full-scale sine at 1 kHz reads −3.01 dB and a sine of peak A reads
//   20·log10(A) − 3.01 dB (within the band leakage of a Hann window, < 0.01 dB for a tone at the
//   band centre).
// It also reports how much of the captured power lies in that band (bandFraction): a calibrator
// tone dominates its band, so a low fraction means the calibrator is off, unseated or masked by
// noise, and the reading is refused below REFERENCE_MIN_BAND_FRACTION (warned below
// REFERENCE_WARN_BAND_FRACTION). A clipped capture (|x| ≥ capture-checks.js CLIP_THRESHOLD) is
// refused: its level is not the calibrator's.
//
// Result: { ok, observedDbRelative, scale, band: { nominal, lo, hi }, broadbandDb, bandFraction,
//   peak, durationS, sampleRate, errors: [text], warnings: [text] }; ok false (errors say why)
// leaves observedDbRelative null. Never throws for a well-formed capture; throws TypeError for a
// malformed one.

import { welch } from '../measurement/spectrum.js';
import { bandCenters, integrateBands } from '../measurement/rta.js';
import { CLIP_THRESHOLD } from '../measurement/capture-checks.js';
import { LEVEL_SCALE } from './level.js';

export const REFERENCE_FFT = 8192;
/** Default capture length of the reference reading (s). */
export const REFERENCE_CAPTURE_S = 3;
/** Refuse the reading when the reference band holds less of the captured power than this. */
export const REFERENCE_MIN_BAND_FRACTION = 0.25;
/** Warn when the reference band holds less of the captured power than this. */
export const REFERENCE_WARN_BAND_FRACTION = 0.8;

/** The one-third-octave band (rta.js) that contains hz at sampleRate, or null. */
export function referenceBand(hz, sampleRate) {
  const bands = bandCenters('third', 20, 20000, sampleRate);
  return bands.find((b) => hz >= b.lo && hz < b.hi) || null;
}

const pct = (x) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)} %`;

/** Observed reference level (see the header). */
export function measureReferenceLevel(capture, { referenceHz = 1000 } = {}) {
  if (!capture || !(capture.samples instanceof Float32Array || capture.samples instanceof
    Float64Array) || !(capture.sampleRate > 0)) {
    throw new TypeError('measureReferenceLevel needs a capture { sampleRate, samples }');
  }
  const x = capture.samples;
  const sr = capture.sampleRate;
  const errors = [];
  const warnings = [];
  const out = {
    ok: false, observedDbRelative: null, scale: LEVEL_SCALE.id, band: null, broadbandDb: null,
    bandFraction: null, peak: 0, durationS: x.length / sr, sampleRate: sr, errors, warnings,
  };
  const band = referenceBand(referenceHz, sr);
  if (!band) {
    errors.push(`${referenceHz} Hz is outside the one-third-octave bands of a ${sr} Hz input`);
    return out;
  }
  out.band = { nominal: band.nominal, lo: band.lo, hi: band.hi };
  if (x.length < REFERENCE_FFT) {
    errors.push(`the reference capture is too short (${x.length} samples; at least `
      + `${REFERENCE_FFT} are needed)`);
    return out;
  }
  let ms = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    ms += x[i] * x[i];
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  ms /= x.length;
  out.peak = peak;
  out.broadbandDb = ms > 0 ? 10 * Math.log10(ms) : -Infinity;
  if (peak >= CLIP_THRESHOLD) {
    errors.push(`the capture reaches ${peak.toFixed(3)} of full scale (clipped): lower the input `
      + 'gain and capture again');
  }
  const w = welch(x, { fftSize: REFERENCE_FFT, overlap: 0.5, window: 'hann' });
  const p = integrateBands(w, sr / REFERENCE_FFT, [band])[0];
  if (!(p > 0) || !(ms > 0)) {
    errors.push('no signal in the reference band: is the calibrator on the microphone and on?');
    return out;
  }
  out.bandFraction = Math.min(1, p / ms);
  const where = `the ${band.nominal} Hz one-third-octave band`;
  if (out.bandFraction < REFERENCE_MIN_BAND_FRACTION) {
    errors.push(`${where} holds only ${pct(out.bandFraction)} of the captured power: this is `
      + 'not a reference tone at that frequency (calibrator off, unseated or masked by noise)');
  } else if (out.bandFraction < REFERENCE_WARN_BAND_FRACTION) {
    warnings.push(`${where} holds ${pct(out.bandFraction)} of the captured power: background `
      + 'noise or another sound contributes; the reading may be high');
  }
  out.observedDbRelative = 10 * Math.log10(p);
  out.ok = errors.length === 0;
  if (!out.ok) out.observedDbRelative = null;
  return out;
}
