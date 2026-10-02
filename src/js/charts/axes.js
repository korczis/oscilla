// Pure axis helpers shared by every OSCILLA chart: tick generation, value <-> pixel mapping and
// the label formats used in the reference (20, 50, 100 … 1k, 10k, 20k; "0 dB", -20 …).
// No DOM, no Web Audio: unit-tested in tests/unit/charts.test.mjs.

export const LOG_MANTISSAS = Object.freeze([1, 2, 5]);

const EPS = 1e-9;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 1-2-5 ticks on a logarithmic axis: logTicks(20, 20000) → [20, 50, 100, 200, …, 10000, 20000].
 * Values are exact decimal multiples (no floating-point drift such as 199.99999).
 */
export function logTicks(min, max, mantissas = LOG_MANTISSAS) {
  if (!(min > 0) || !(max > min)) return [];
  const out = [];
  const e0 = Math.floor(Math.log10(min));
  const e1 = Math.ceil(Math.log10(max));
  for (let e = e0; e <= e1; e++) {
    for (const m of mantissas) {
      const v = e >= 0 ? m * 10 ** e : m / 10 ** -e;
      if (v >= min * (1 - EPS) && v <= max * (1 + EPS)) out.push(v);
    }
  }
  return out;
}

/** "Nice" step (1, 2, 2.5, 5 × 10^n) giving about `count` intervals over `span`. */
export function niceStep(span, count = 5) {
  if (!(span > 0) || !(count > 0)) return 1;
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * p;
}

/** Ticks at multiples of `step` (or a nice step for ~count intervals) inside [min, max]. */
export function linearTicks(min, max, { step, count = 5 } = {}) {
  if (!(max > min)) return [];
  const s = step > 0 ? step : niceStep(max - min, count);
  const first = Math.ceil(min / s - EPS);
  const last = Math.floor(max / s + EPS);
  const out = [];
  for (let i = first; i <= last; i++) out.push(Math.round(i * s * 1e9) / 1e9 || 0); // no -0
  return out;
}

/** Fraction 0…1 of v on an axis [min, max] ('log' or 'linear'), unclamped. */
export function axisFraction(v, min, max, scale = 'log') {
  if (scale === 'log') return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

/** Inverse of axisFraction. */
export function axisValue(u, min, max, scale = 'log') {
  if (scale === 'log') return min * (max / min) ** u;
  return min + u * (max - min);
}

/**
 * Value <-> pixel mapping for one axis. px0 maps to min, px1 to max (px1 < px0 for a y axis
 * whose maximum is at the top).
 */
export function createAxisScale({ min, max, px0, px1, scale = 'linear' }) {
  const span = px1 - px0;
  return {
    min,
    max,
    scale,
    toPx: (v) => px0 + axisFraction(v, min, max, scale) * span,
    fromPx: (px) => axisValue((px - px0) / span, min, max, scale),
  };
}

function trimNumber(v, digits) {
  const s = v.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Tick label for a frequency: 20, 500, 1k, 1.5k, 10k, 20k (reference style). */
export function formatHzTick(f) {
  if (!Number.isFinite(f)) return '';
  if (Math.abs(f) >= 1000) return `${trimNumber(f / 1000, 2)}k`;
  return trimNumber(f, 2);
}

/** Compact frequency with unit, 3 significant digits: "15.5 kHz", "440 Hz", "120 kHz". */
export function formatHz(f, sigDigits = 3) {
  if (!Number.isFinite(f)) return '—';
  const abs = Math.abs(f);
  const [v, unit] = abs >= 1000 ? [f / 1000, 'kHz'] : [f, 'Hz'];
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? Math.max(0, sigDigits - 2) : Math.max(0, sigDigits - 1);
  return `${trimNumber(v, digits)} ${unit}`;
}

/** Hz with thousands separators: 48000 → "48,000 Hz". */
export function formatHzGrouped(f) {
  if (!Number.isFinite(f)) return '—';
  return `${Math.round(f).toLocaleString('en-US')} Hz`;
}

/**
 * Frequency rounded to a display step (e.g. displayStepHz(uncertainty)), never shown with more
 * precision than the step: (15498.37, 1) → "15.498 kHz"; (440.2, 0.1) → "440.2 Hz".
 */
export function formatHzStep(f, stepHz = 1) {
  if (!Number.isFinite(f)) return '—';
  const step = stepHz > 0 ? stepHz : 1;
  const r = Math.round(f / step) * step;
  const dec = -Math.floor(Math.log10(step) + EPS); // may be negative (10 Hz step → -1)
  if (Math.abs(r) >= 1000) return `${(r / 1000).toFixed(clamp(dec + 3, 0, 6))} kHz`;
  return `${r.toFixed(clamp(dec, 0, 6))} Hz`;
}

/** Uncertainty as "± 3 Hz" / "± 0.4 Hz" with one significant digit. */
export function formatUncertainty(u) {
  if (!(u > 0)) return '';
  const p = 10 ** Math.floor(Math.log10(u));
  const v = Math.ceil(u / p - EPS) * p;
  return `± ${v >= 1000 ? `${trimNumber(v / 1000, 3)} kHz` : `${trimNumber(v, 6)} Hz`}`;
}

/**
 * dB tick label. style 'top' labels only the 0 dB tick with its unit ("0 dB", -20, -40 …,
 * spectrum/mic reference); 'all' adds the unit to every tick with an explicit sign
 * ("+12 dB", "0 dB", "-12 dB"; filter reference); 'plain' gives bare numbers ("0", "-20").
 */
export function formatDbTick(v, style = 'top') {
  if (!Number.isFinite(v)) return '';
  const n = Math.round(v * 10) / 10;
  const s = n === 0 ? '0' : String(n);
  if (style === 'plain') return s;
  if (style === 'all') return `${n > 0 ? '+' : ''}${s} dB`;
  return n === 0 ? '0 dB' : s;
}

/** Seconds tick label: 0s, 1s, 2.5s. */
export function formatSecondsTick(t) {
  if (!Number.isFinite(t)) return '';
  return `${trimNumber(t, 2)}s`;
}

/** Time-axis step for a span in seconds: 5 s → 1, 10 s → 1, 20 s → 2, 60 s → 10. */
export function timeTickStep(spanS, maxTicks = 11) {
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]) {
    if (spanS / s <= maxTicks - 1 + EPS) return s;
  }
  return 60;
}

/** Frequency ticks for a spectrogram/spectrum y or x axis (log 1-2-5, linear nice steps). */
export function frequencyTicks(min, max, scale = 'log') {
  if (scale === 'log') return logTicks(min, max);
  const ticks = linearTicks(0, max, { count: 4 });
  return ticks.filter((v) => v >= min - EPS);
}

/** Parse a user frequency: "2.5 kHz", "2500", "2.5k", "880 Hz" → Hz, or null. */
export function parseFrequency(text) {
  const m = /^\s*([+-]?\d*[.,]?\d+(?:e[+-]?\d+)?)\s*(k|khz|hz)?\s*$/i.exec(String(text));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] || '').toLowerCase();
  return unit === 'k' || unit === 'khz' ? v * 1000 : v;
}

/** Parse a duration: "10 ms", "0.3 s", "300" (ms) → seconds, or null. */
export function parseDurationS(text) {
  const m = /^\s*(\d*[.,]?\d+)\s*(ms|s)?\s*$/i.exec(String(text));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  return (m[2] || 'ms').toLowerCase() === 's' ? v : v / 1000;
}

/** Duration label: 0.01 → "10 ms", 1.5 → "1.5 s". */
export function formatDuration(s) {
  if (!Number.isFinite(s)) return '—';
  if (s >= 1) return `${trimNumber(s, 2)} s`;
  const ms = s * 1000;
  return `${trimNumber(ms, ms < 10 ? 1 : 0)} ms`;
}

/** Parse a number with an optional unit suffix ("-6 dB", "0.707", "45°") → number or null. */
export function parseNumber(text) {
  const m = /^\s*([+-]?\d*[.,]?\d+)/.exec(String(text));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Map a 0…sliderMax position to a log range and back (log sliders of the shell). */
export function logSliderToValue(pos, min, max, sliderMax = 1000) {
  return axisValue(clamp(pos / sliderMax, 0, 1), min, max, 'log');
}

export function valueToLogSlider(v, min, max, sliderMax = 1000) {
  return Math.round(clamp(axisFraction(v, min, max, 'log'), 0, 1) * sliderMax);
}
