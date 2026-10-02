// Resolution-aware formatting of measured quantities (spec §70, §97-§98).
//
// Frequencies: a value read from an FFT is known to its bin resolution, so it is printed with
// no digit finer than the rounding step 10^floor(log10(resolution)) — the same rule as the V2
// displayStepHz() readouts (src/js/analysis/peak-detector.js). At 48 kHz / 8192 points
// (5.86 Hz) 18437.238194 Hz prints as "18.437 kHz"; at 46.9 Hz resolution as "18.44 kHz".
// Values from 1000 Hz up (after rounding) are shown in kHz.
//
// Levels: "dB relative" is the uncalibrated digital level (dBFS-like); "dB SPL" is produced only
// when the CALLER asks for kind 'spl', which it may do only when a valid LevelCalibration
// applies (docs/v3/architecture.md, Labels). This module never infers or upgrades a level kind.
//
// Estimates: "≈ value ± uncertainty unit (estimate)". The uncertainty is rounded to two
// significant digits and the value to the same decimal position (JCGM 100:2008, GUM §7.2.6).
//
// Negative numbers use U+2212 MINUS SIGN, as the V2 readouts do. Missing values print "—".

import { displayStepHz } from '../analysis/peak-detector.js';

const MINUS = '−';
const DASH = '—';

/** Level kinds and the unit label each one prints. */
export const DB_KIND_LABELS = Object.freeze({ relative: 'dB relative', spl: 'dB SPL' });

/** FFT bin spacing in Hz: sampleRate / fftSize. */
export function binResolutionHz(sampleRate, fftSize) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate))
    throw new RangeError(`sample rate must be positive, got ${sampleRate}`);
  if (!Number.isInteger(fftSize) || fftSize < 2)
    throw new RangeError(`FFT size must be an integer ≥ 2, got ${fftSize}`);
  return sampleRate / fftSize;
}

/** Fixed-point text with U+2212 for negatives and no "−0". */
function fixed(value, decimals) {
  const text = value.toFixed(Math.max(0, Math.min(20, decimals)));
  if (Number(text) === 0) return text.replace('-', '');
  return text.replace('-', MINUS);
}

/** Round to a multiple of step (a power of ten) and print with the decimals that step implies. */
function stepText(value, step) {
  const decimals = Math.max(0, -Math.round(Math.log10(step)));
  const rounded = decimals > 0 ? value : Math.round(value / step) * step;
  return fixed(rounded, decimals);
}

/**
 * formatFrequencyWithResolution(hz, resolutionHz) → "440.0 Hz" | "18.437 kHz" | "—"
 * No digit finer than the resolution's power-of-ten step; kHz from 1000 Hz up.
 */
export function formatFrequencyWithResolution(hz, resolutionHz) {
  if (!(resolutionHz > 0) || !Number.isFinite(resolutionHz))
    throw new RangeError(`resolution must be positive, got ${resolutionHz}`);
  if (!Number.isFinite(hz)) return DASH;
  const step = displayStepHz(resolutionHz);
  const roundedHz = Math.round(hz / step) * step;
  if (Math.abs(roundedHz) >= 1000) return `${stepText(hz / 1000, step / 1000)} kHz`;
  return `${stepText(hz, step)} Hz`;
}

/**
 * formatDb(value, { decimals = 1, kind = 'relative' }) → "−12.3 dB relative" | "94.0 dB SPL"
 * kind is decided by the caller (calibration state); an unknown kind is an error, never a
 * fallback to SPL. −Infinity prints "−∞", NaN / missing prints "—".
 */
export function formatDb(value, { decimals = 1, kind = 'relative' } = {}) {
  if (!Object.hasOwn(DB_KIND_LABELS, kind))
    throw new TypeError(`level kind must be relative or spl, got ${kind}`);
  const unit = DB_KIND_LABELS[kind];
  if (value === -Infinity) return `${MINUS}∞ ${unit}`;
  if (!Number.isFinite(value)) return `${DASH} ${unit}`;
  return `${fixed(value, decimals)} ${unit}`;
}

/** Decimal position of the 2nd significant digit of u (may be negative: tens, hundreds). */
function twoSignificantDecimals(u) {
  let d = 1 - Math.floor(Math.log10(u));
  // Rounding can carry into a new leading digit (9.96 → 10): recompute on the rounded value.
  const r = Math.round(u * 10 ** d) / 10 ** d;
  if (r > 0) d = 1 - Math.floor(Math.log10(r));
  return d;
}

function atDecimals(value, d) {
  if (d >= 0) return fixed(value, d);
  const step = 10 ** -d;
  return fixed(Math.round(value / step) * step, 0);
}

/**
 * formatEstimate(value, uncertainty, unit = '') → "≈ 440.0 ± 2.9 Hz (estimate)"
 * Uncertainty to two significant digits, value to the same decimal position. Without a positive
 * finite uncertainty the text says so instead of implying precision.
 */
export function formatEstimate(value, uncertainty, unit = '') {
  const u = unit ? ` ${unit}` : '';
  if (!Number.isFinite(value)) return `${DASH}${u}`;
  if (!(uncertainty > 0) || !Number.isFinite(uncertainty)) {
    // Three significant digits: a display convention, not a claimed precision.
    const decimals = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value) || 1)));
    const text = fixed(Number(value.toPrecision(3)), decimals);
    return `≈ ${text}${u} (estimate, uncertainty unknown)`;
  }
  const d = twoSignificantDecimals(uncertainty);
  return `≈ ${atDecimals(value, d)} ± ${atDecimals(uncertainty, d)}${u} (estimate)`;
}
