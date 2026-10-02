// Frequency maths: log mapping, parsing, formatting, region mapping and the digital limits.
// Extracted from V1 (index.html@a7b7a23, sections 1 and 3, plus the numeric parts of the
// component getters provisional/effectiveSampleRate/nyquist/safeMax/rangeMin/rangeMax and the
// frequency map geometry). Moved bodies are unchanged.

import {
  MIN_FREQUENCY, PROVISIONAL_SAMPLE_RATE, SAFE_NYQUIST_FACTOR, SPEED_OF_SOUND,
} from './constants.js';
import { clamp, isNum, round, sig } from './math.js';

// V1: FREQUENCY_REGIONS (index.html@a7b7a23)

// Approximate educational categories, not biological thresholds.
export const FREQUENCY_REGIONS = [
  { min: 0, max: 20, label: 'BELOW NOMINAL HEARING RANGE', short: 'INFRA' },
  { min: 20, max: 60, label: 'SUB-BASS', short: 'SUB' },
  { min: 60, max: 250, label: 'BASS', short: 'BASS' },
  { min: 250, max: 500, label: 'LOW MIDS', short: 'LOW MID' },
  { min: 500, max: 2000, label: 'MIDRANGE', short: 'MID' },
  { min: 2000, max: 4000, label: 'UPPER MIDS', short: 'UP MID' },
  { min: 4000, max: 6000, label: 'PRESENCE', short: 'PRES' },
  { min: 6000, max: 12000, label: 'BRILLIANCE', short: 'BRIL' },
  { min: 12000, max: 16000, label: 'VERY HIGH FREQUENCY', short: 'V.HIGH' },
  { min: 16000, max: 20000, label: 'UPPER HEARING RANGE', short: 'UPPER', closed: true }, // includes 20 kHz
  { min: 20000, max: Infinity, label: 'NOMINAL ULTRASONIC REGION', short: 'ULTRA' },
];

// V1: frequencyToNormalized, normalizedToFrequency, parseFrequency, parseFrequencyList,
// formatFrequency, formatFrequencyShort, formatPeriod, formatWavelength, formatMs, regionFor
// (index.html@a7b7a23)
export function frequencyToNormalized(freq, min, max) {
  if (!(freq > 0 && min > 0 && max > min)) return 0;
  return clamp(Math.log(freq / min) / Math.log(max / min), 0, 1);
}
export function normalizedToFrequency(value, min, max) {
  if (!(min > 0 && max > min) || !isNum(value)) return min > 0 ? min : MIN_FREQUENCY;
  return min * Math.pow(max / min, clamp(value, 0, 1));
}

/**
 * Parse human-friendly frequency text: 440, 440hz, 1k, 1khz, 15.5k, 15500, 20 kHz.
 * Returns { ok: true, value } in Hz or { ok: false, error } — never NaN.
 */
export function parseFrequency(input) {
  if (typeof input === 'number') {
    return isNum(input) && input > 0 ? { ok: true, value: input } : { ok: false, error: 'Frequency must be a positive number.' };
  }
  if (typeof input !== 'string') return { ok: false, error: 'Enter a frequency, e.g. 440, 1k or 15.5 kHz.' };
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return { ok: false, error: 'Enter a frequency, e.g. 440, 1k or 15.5 kHz.' };
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(k|khz|kilohertz|hz|hertz)?$/);
  if (!m) {
    const shown = input.trim().slice(0, 24);
    return { ok: false, error: `“${shown}” is not a frequency. Try 440, 440 Hz, 1k or 15.5 kHz.` };
  }
  let value = parseFloat(m[1]);
  if (m[2] && m[2][0] === 'k') value *= 1000;
  if (!isNum(value) || value <= 0) return { ok: false, error: 'Frequency must be greater than 0 Hz.' };
  return { ok: true, value };
}

/** Parse a comma/space/semicolon separated list; reports every invalid entry. */
export function parseFrequencyList(text) {
  const parts = String(text || '').split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const values = [];
  const invalid = [];
  for (const p of parts) {
    const r = parseFrequency(p);
    if (r.ok) values.push(r.value); else invalid.push(p);
  }
  return { values, invalid };
}

export function formatFrequency(f, precise = false) {
  if (!isNum(f)) return '—';
  const r = round(f, 2);
  if (r >= 1000) return `${round(f / 1000, 2).toFixed(2)} kHz`;
  if (precise || !Number.isInteger(r)) return `${r.toFixed(2)} Hz`;
  return `${r} Hz`;
}
/** Compact axis label: 20, 500, 1k, 15.5k. */
export function formatFrequencyShort(f) {
  if (!isNum(f)) return '';
  return f >= 1000 ? `${sig(f / 1000, 3)}k` : sig(f, 3);
}
export function formatPeriod(f) {
  if (!(f > 0)) return '—';
  const p = 1 / f;
  if (p >= 1) return `${sig(p)} s`;
  if (p >= 1e-3) return `${sig(p * 1e3)} ms`;
  return `${sig(p * 1e6)} µs`;
}
export function formatWavelength(f) {
  if (!(f > 0)) return '—';
  const m = SPEED_OF_SOUND / f;
  if (m >= 0.5) return `${round(m, 2).toFixed(2)} m`;
  const cm = m * 100;
  if (cm >= 10) return `${round(cm, 1).toFixed(1)} cm`;
  if (cm >= 1) return `${round(cm, 2).toFixed(2)} cm`;
  return `${round(m * 1000, 2).toFixed(2)} mm`;
}
export function formatMs(ms) {
  if (!isNum(ms)) return '—';
  return ms >= 1000 ? `${sig(ms / 1000, 3)} s` : `${sig(ms, 3)} ms`;
}
export function regionFor(f) {
  // Nominal ultrasound begins *above* about 20 kHz, so 20 kHz itself is still upper hearing range.
  return FREQUENCY_REGIONS.find((r) => f >= r.min && (f < r.max || (r.closed && f === r.max))) || FREQUENCY_REGIONS[0];
}

// ---------------------------------------------------------------- digital limits

/**
 * The sample-rate dependent limits, exactly as the V1 component getters compute them.
 * sampleRate null/undefined means "no AudioContext yet": the provisional 44.1 kHz applies.
 * Returns { provisional, effectiveSampleRate, nyquist, safeMax }.
 */
export function limitsFor(sampleRate) {
  // V1: oscillaApp getters provisional, effectiveSampleRate, nyquist, safeMax (index.html@a7b7a23)
  const provisional = sampleRate == null;
  const effectiveSampleRate = sampleRate || PROVISIONAL_SAMPLE_RATE;
  const nyquist = effectiveSampleRate / 2;
  return { provisional, effectiveSampleRate, nyquist, safeMax: nyquist * SAFE_NYQUIST_FACTOR };
}

/** The 95 % digital limit for a sample rate (null when the rate is unknown). */
export function safeMaxFor(sampleRate) {
  return sampleRate > 0 ? (sampleRate / 2) * SAFE_NYQUIST_FACTOR : null;
}

/**
 * Bounds of a frequency range mode: { min, max } in Hz.
 * range: { rangeMode, customMin, customMax } (instrument state fields).
 */
export function rangeBounds(range, safeMax) {
  // V1: oscillaApp getters rangeMin, rangeMax (index.html@a7b7a23)
  let min = 20;
  if (range.rangeMode === 'high') min = Math.min(8000, safeMax / 2);
  else if (range.rangeMode === 'advanced') min = MIN_FREQUENCY;
  else if (range.rangeMode === 'custom') min = clamp(range.customMin, MIN_FREQUENCY, safeMax / 2);
  let max = safeMax;
  if (range.rangeMode === 'human') max = Math.min(20000, safeMax);
  else if (range.rangeMode === 'custom') max = clamp(range.customMax, min * 2, safeMax);
  return { min, max };
}

/**
 * The narrowest standard range mode that contains [lo, hi], or null when the current bounds
 * already contain it (V1 fitRange leaves the mode unchanged then).
 */
export function fitRangeMode(lo, hi, bounds, safeMax) {
  // V1: oscillaApp.fitRange (index.html@a7b7a23)
  if (lo >= bounds.min && hi <= bounds.max) return null;
  const safe = safeMax;
  if (lo >= 20 && hi <= Math.min(20000, safe)) return 'human';
  if (lo >= 8000 && hi <= safe) return 'high';
  return 'advanced';
}

// ---------------------------------------------------------------- frequency map geometry

/** Region bands of the logarithmic frequency map between lo and hi (percent positions). */
export function mapRegions(lo, hi) {
  // V1: oscillaApp getter mapRegions (index.html@a7b7a23)
  return FREQUENCY_REGIONS.filter((r) => r.max > lo && r.min < hi).map((r, i) => {
    const a = frequencyToNormalized(Math.max(r.min, lo), lo, hi);
    const b = frequencyToNormalized(Math.min(r.max, hi), lo, hi);
    return { key: r.label, short: r.short, left: a * 100, width: (b - a) * 100, odd: i % 2 === 1 };
  });
}

/** Tick marks of the logarithmic frequency map between lo and hi. */
export function mapTicks(lo, hi) {
  // V1: oscillaApp getter mapTicks (index.html@a7b7a23)
  const cands = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  return cands.filter((f) => f >= lo && f <= hi).map((f) => ({
    f, label: formatFrequencyShort(f), pct: frequencyToNormalized(f, lo, hi) * 100,
    major: [1, 10, 100, 1000, 10000].includes(f) || [20, 20000].includes(f),
  }));
}
