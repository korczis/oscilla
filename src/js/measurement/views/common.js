// Shared vocabulary of the V3 MEASURE / EXPERIMENTS view models (spec §96-§98, §117-§118,
// §156; docs/v3/ui-integration.md). Pure: plain data in, plain data out, no DOM, no uPlot, no
// globals, no clock. The view modules next to this one turn engine events and result objects
// into descriptors that the DOM/Alpine layer and the existing chart code (src/js/charts) render
// without computing anything themselves.
//
// Colour is never the only carrier of meaning (§118): every status has a text, a glyph, an icon
// id (a lucide-static name, inlined by scripts/pack-single-file.mjs as `@icon:<name>`) and a
// shape class. Colours are ROLES that name existing design tokens (src/styles/tokens.css) by
// their chart-theme key (src/js/ui/theme.js TOKEN_KEYS) and CSS custom property; no view module
// carries a colour value.

import { formatFrequencyWithResolution } from '../format.js';
import { ZERO_POWER_DB } from '../transfer.js';
import {
  RELATIVE_SCALE_LABEL, RELATIVE_UNIT, SPL_UNIT, levelLabel,
} from '../../calibration/level.js';
import { linearTicks, logTicks, formatHzTick } from '../../charts/axes.js';

export const MINUS = '−';
export const DASH = '—';

/** What a displayed quantity is (spec §98); every series and readout names one. */
export const QUANTITY_KINDS = Object.freeze({
  REQUESTED: 'REQUESTED',
  DIGITAL: 'DIGITAL',
  OBSERVED: 'OBSERVED',
  CALIBRATED: 'CALIBRATED',
  ESTIMATED: 'ESTIMATED',
  NORMALIZED: 'NORMALIZED',
  SMOOTHED: 'SMOOTHED',
  DELTA: 'DELTA',
});

/** Words for data that does not exist (spec §249); never a plausible number. */
export const UNAVAILABLE = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  NOT_MEASURED: 'NOT MEASURED',
  UNCALIBRATED: 'UNCALIBRATED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_ASSESSED: 'NOT ASSESSED',
});

/**
 * Measurement colour roles (spec §117) mapped onto EXISTING semantic tokens. `token` is the key
 * of readChartTheme()/chartTheme() (src/js/ui/theme.js, src/js/charts/chart-theme.js), `cssVar`
 * the custom property for HTML. Every token has a light-theme value in tokens.css except
 * orange and red, which are used as strokes/icons only (text on them is --osc-text on
 * --osc-warn-bg), see docs/v3/ui-integration.md.
 */
export const MEASUREMENT_ROLES = Object.freeze({
  requested: Object.freeze({ token: 'trace', cssVar: '--osc-blue-trace',
    meaning: 'REQUESTED / generator (V2 "Generator (target)")' }),
  observed: Object.freeze({ token: 'green', cssVar: '--osc-green',
    meaning: 'OBSERVED capture (V2 "Microphone (live)")' }),
  calibrated: Object.freeze({ token: 'purple', cssVar: '--osc-purple',
    meaning: 'CALIBRATED (frequency profile applied)' }),
  derived: Object.freeze({ token: 'cyan', cssVar: '--osc-cyan',
    meaning: 'derived view (comparison delta)' }),
  warning: Object.freeze({ token: 'orange', cssVar: '--osc-orange',
    meaning: 'warning (with --osc-warn-bg / --osc-warn-border panels)' }),
  invalid: Object.freeze({ token: 'red', cssVar: '--osc-red', meaning: 'invalid / fail' }),
  neutral: Object.freeze({ token: 'textMuted', cssVar: '--osc-text-muted',
    meaning: 'markers, not-assessed data' }),
  info: Object.freeze({ token: null, cssVar: '--osc-info-icon',
    meaning: 'information, HTML only (with --osc-info-bg / --osc-info-border panels)' }),
});

/** Overlay roles for compared experiments A, B, C … (existing accents, distinct hues). */
export const COMPARE_ROLES = Object.freeze(['observed', 'requested', 'calibrated', 'warning']);

/**
 * Line styles. An UNRELIABLE stretch keeps its role colour at UNRELIABLE_ALPHA (the V2
 * BYPASSED convention in filter-chart.js) and is dashed, so it differs by shape and by
 * contrast, never by hue alone (§156, §118). Context series (raw behind a derived view) are
 * faded the same way but solid.
 */
export const LINE_STYLES = Object.freeze({
  primary: Object.freeze({ width: 1.5, dash: null, alpha: 1 }),
  unreliable: Object.freeze({ width: 1.25, dash: Object.freeze([4, 4]), alpha: 0.45 }),
  context: Object.freeze({ width: 1, dash: null, alpha: 0.45 }),
  envelope: Object.freeze({ width: 0, dash: null, alpha: 0.12 }),
  marker: Object.freeze({ width: 1, dash: Object.freeze([3, 3]), alpha: 0.8 }),
  peakHold: Object.freeze({ width: 1, dash: Object.freeze([3, 3]), alpha: 0.8 }),
});

/**
 * Status presentation (no colour-only meaning, §118): glyph for text, lucide icon id, shape
 * class, colour role. Severity words follow quality.js reasons ('ok' | 'warn' | 'fail').
 */
export const STATUS_PRESENTATION = Object.freeze({
  ok: Object.freeze({ glyph: '✓', glyphId: 'ok', icon: 'circle-check', shape: 'osc-q-shape--circle',
    className: 'osc-q--ok', role: 'observed' }),
  warn: Object.freeze({ glyph: '!', glyphId: 'warn', icon: 'triangle-alert',
    shape: 'osc-q-shape--triangle', className: 'osc-q--warn', role: 'warning' }),
  fail: Object.freeze({ glyph: '✗', glyphId: 'fail', icon: 'circle-x',
    shape: 'osc-q-shape--octagon',
    className: 'osc-q--fail', role: 'invalid' }),
  pending: Object.freeze({ glyph: '…', glyphId: 'pending', icon: 'loader-circle',
    shape: 'osc-q-shape--ring', className: 'osc-q--pending', role: 'neutral' }),
  unknown: Object.freeze({ glyph: '?', glyphId: 'unknown', icon: 'circle-dashed',
    shape: 'osc-q-shape--dashed', className: 'osc-q--unknown', role: 'neutral' }),
  info: Object.freeze({ glyph: 'i', glyphId: 'info', icon: 'info', shape: 'osc-q-shape--square',
    className: 'osc-q--info', role: 'info' }),
});

/** Quality status → presentation (spec §65). NOT ASSESSED is not a quality.js status. */
export const QUALITY_STATUS_PRESENTATION = Object.freeze({
  GOOD: Object.freeze({ text: 'GOOD', word: 'good', severity: 'ok' }),
  USABLE: Object.freeze({ text: 'USABLE', word: 'usable', severity: 'ok' }),
  POOR: Object.freeze({ text: 'POOR', word: 'poor', severity: 'warn' }),
  INVALID: Object.freeze({ text: 'INVALID', word: 'invalid', severity: 'fail' }),
  NOT_ASSESSED: Object.freeze({ text: UNAVAILABLE.NOT_ASSESSED, word: 'not assessed',
    severity: 'unknown' }),
});

/** { text, word, severity, glyph, icon, shape, className, role } of a quality status. */
export function qualityStatusPresentation(status) {
  const q = QUALITY_STATUS_PRESENTATION[status] || QUALITY_STATUS_PRESENTATION.NOT_ASSESSED;
  return { ...q, ...STATUS_PRESENTATION[q.severity] };
}

// ----------------------------------------------------------------------------- numbers

/** Fixed-point text, U+2212 for negatives, no "−0". */
export function fixedText(value, decimals = 1) {
  const text = value.toFixed(Math.max(0, Math.min(20, decimals)));
  if (Number(text) === 0) return text.replace('-', '');
  return text.replace('-', MINUS);
}

/**
 * A dB RATIO (transfer magnitude, delta, spread): "+3.2 dB", "−11.4 dB", "0.0 dB", "—".
 * Ratios are not levels, so no level unit (and never SPL) is attached.
 */
export function ratioDbText(value, { decimals = 1, sign = true, unit = 'dB' } = {}) {
  if (value === -Infinity) return `${MINUS}∞ ${unit}`;
  if (!Number.isFinite(value)) return DASH;
  const t = fixedText(value, decimals);
  const plus = sign && Number(t.replace(MINUS, '-')) > 0 ? '+' : '';
  return `${plus}${t} ${unit}`;
}

/**
 * Local frequency resolution of a grid point (Hz): the coarser of the FFT bin spacing and the
 * spacing to the neighbouring grid point — a grid point stands for a band, so it is known to
 * no finer than that (same rule as quality.js frequencyFormatter, spec §69, §97).
 */
export function gridResolutionHz(frequencies, index, binHz = null) {
  const n = frequencies.length;
  let step = 0;
  if (n > 1) {
    const i = Math.max(0, Math.min(n - 1, index));
    const a = frequencies[Math.max(0, i - 1)];
    const b = frequencies[Math.min(n - 1, i + 1)];
    const span = i > 0 && i < n - 1 ? (b - a) / 2 : Math.abs(b - a);
    step = Number.isFinite(span) ? span : 0;
  }
  const bin = binHz > 0 && Number.isFinite(binHz) ? binHz : 0;
  const r = Math.max(step, bin);
  return r > 0 ? r : 1;
}

/** Resolution-aware frequency text of grid point `index` (format.js rule). */
export function gridFrequencyText(frequencies, index, binHz = null) {
  return formatFrequencyWithResolution(frequencies[index],
    gridResolutionHz(frequencies, index, binHz));
}

/** Frequency range text "40 Hz–15.2 kHz" at the grid's resolution at each edge. */
export function rangeText(frequencies, lo, hi, binHz = null) {
  const at = (hz) => {
    const i = nearestIndex(frequencies, hz);
    return i < 0 ? formatFrequencyWithResolution(hz, Math.max(1, binHz || 1))
      : formatFrequencyWithResolution(hz, gridResolutionHz(frequencies, i, binHz));
  };
  return `${at(lo)}–${at(hi)}`;
}

/** Index of the grid point nearest to hz in log-frequency (−1 for an empty grid). */
export function nearestIndex(frequencies, hz) {
  const n = frequencies ? frequencies.length : 0;
  if (!n || !(hz > 0)) return n ? 0 : -1;
  let lo = 0;
  let hi = n - 1;
  if (hz <= frequencies[0]) return 0;
  if (hz >= frequencies[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frequencies[mid] <= hz) lo = mid; else hi = mid;
  }
  return Math.log(hz / frequencies[lo]) <= Math.log(frequencies[hi] / hz) ? lo : hi;
}

/** Time text at a resolution in ms (no digit finer than its power-of-ten step). */
export function msText(ms, resolutionMs) {
  if (!Number.isFinite(ms)) return DASH;
  const step = resolutionMs > 0 ? 10 ** Math.floor(Math.log10(resolutionMs)) : 1;
  const decimals = Math.max(0, -Math.round(Math.log10(step)));
  const rounded = Math.round(ms / step) * step;
  return `${fixedText(rounded, decimals)} ms`;
}

// ----------------------------------------------------------------------------- plot data

/** True for a finite level above the zero-power sentinel (−300 dB). */
export const isDrawable = (v) => Number.isFinite(v) && v > ZERO_POWER_DB;

/**
 * Plot array for uPlot: a plain Array where every non-drawable value (NaN, ±∞, zero power,
 * or a point the caller excludes) is null, which uPlot draws as a gap.
 */
export function toPlotArray(values, include = null, offset = 0) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = isDrawable(v) && (!include || include(i)) ? v + offset : null;
  }
  return out;
}

/**
 * Split one curve at the edges of a reliability mask (spec §156, §221):
 *   reliable[i]   = v where mask[i] = 1, else null
 *   unreliable[i] = v where mask[i] = 0, AND at a reliable point directly next to an
 *                   unreliable one, so the dashed stretch joins the solid one without a gap
 *                   (the interval between the two points is partly unreliable: dashed)
 * segments: [{ from, to, reliable }] maximal index runs of the mask (inclusive).
 * A missing mask (null) makes every point unreliable: reliability is NOT ASSESSED.
 */
export function splitByMask(values, mask, offset = 0) {
  const n = values.length;
  const ok = (i) => (mask ? mask[i] === 1 || mask[i] === true : false);
  const reliable = new Array(n).fill(null);
  const unreliable = new Array(n).fill(null);
  const segments = [];
  for (let i = 0; i < n; i++) {
    const v = isDrawable(values[i]) ? values[i] + offset : null;
    const r = ok(i);
    if (r) {
      reliable[i] = v;
      if ((i > 0 && !ok(i - 1)) || (i < n - 1 && !ok(i + 1))) unreliable[i] = v;
    } else {
      unreliable[i] = v;
    }
    const last = segments[segments.length - 1];
    if (last && last.reliable === r) last.to = i;
    else segments.push({ from: i, to: i, reliable: r });
  }
  return { reliable, unreliable, segments };
}

/** Finite min / max of several plot arrays (nulls skipped); null when there is no value. */
export function extent(arrays) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v === null || !Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * A dB axis range covering [lo, hi] on multiples of `step` with at least `minSpan` dB, and its
 * ticks; null data gives [−60, 0] (an empty frame, labelled by the caller as NOT MEASURED).
 */
export function dbAxisRange(ext, { step = 6, minSpan = 24, pad = 1 } = {}) {
  let lo = ext ? ext[0] - pad : -60;
  let hi = ext ? ext[1] + pad : 0;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const range = [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  return { range, ticks: linearTicks(range[0], range[1], { step: niceDbStep(range) }) };
}

function niceDbStep([lo, hi]) {
  const span = hi - lo;
  for (const s of [3, 6, 10, 12, 20, 30, 60]) if (span / s <= 8) return s;
  return 120;
}

/** Log-frequency axis descriptor (uPlot scale distr 3, log 10) with 1-2-5 ticks. */
export function frequencyAxis(lo, hi, label = 'Frequency') {
  const range = [lo, hi];
  const ticks = logTicks(lo, hi);
  return {
    label,
    unit: 'Hz',
    scale: 'log',
    uplot: { distr: 3, log: 10 },
    range,
    ticks,
    tickLabels: ticks.map(formatHzTick),
  };
}

/**
 * The LEVEL axis label (spec §24): "dB SPL" with a CALIBRATED indicator only under a valid
 * LevelCalibration (calibration/level.js), otherwise the one relative scale. Only LEVELS use
 * it; transfer magnitudes are ratios and never become dB SPL (experiments/csv.js, G19).
 */
export function levelAxis(levelCalibration) {
  const l = levelLabel(levelCalibration);
  return l.calibrated
    ? { label: `Level · ${SPL_UNIT}`, unit: SPL_UNIT, calibrated: true, indicator: l.indicator,
      kind: QUANTITY_KINDS.CALIBRATED }
    : { label: RELATIVE_SCALE_LABEL, unit: RELATIVE_UNIT, calibrated: false,
      indicator: l.indicator, kind: QUANTITY_KINDS.DIGITAL };
}

/** Linear dB interpolation over log-frequency inside the grid; null outside it. */
export function interpLogF(frequencies, db, f) {
  const n = frequencies.length;
  if (n === 0 || !(f >= frequencies[0] && f <= frequencies[n - 1])) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frequencies[mid] <= f) lo = mid; else hi = mid;
  }
  const f0 = frequencies[lo];
  const f1 = frequencies[hi];
  const a = db[lo];
  const b = db[hi];
  if (!isDrawable(a) || !isDrawable(b)) return null;
  if (f1 === f0) return a;
  const t = Math.log(f / f0) / Math.log(f1 / f0);
  return a + (b - a) * t;
}

/** Plain-object copy of a mask-ish value as Uint8Array (null when absent or wrong length). */
export function maskOn(mask, n) {
  if (!mask || typeof mask.length !== 'number' || mask.length !== n) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = mask[i] ? 1 : 0;
  return out;
}
