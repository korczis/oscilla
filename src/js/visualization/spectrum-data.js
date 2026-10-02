// Data preparation for the output/microphone spectrum chart (rendered with uPlot in V2): the
// frequency axis, the column -> FFT-bin max aggregation, overlay bands and markers, and the
// chart's fixed labels. Extracted from V1 createSketch updateSpectrumAxis/freqToX/
// rebuildColumns/plotSpectrum/drawSpectrum (index.html@a7b7a23, section 9); the maths are
// unchanged, the p5 drawing is not carried over. Levels are relative dB, uncalibrated.

import {
  FREQUENCY_REGIONS, formatFrequencyShort, frequencyToNormalized, normalizedToFrequency,
} from '../core/frequency.js';
import { clamp, isNum } from '../core/math.js';
import {
  SAFE_NYQUIST_FACTOR, SPECTRUM_MARKERS, THIRD_OCTAVE_FREQUENCIES,
} from '../core/constants.js';
import { midiToFrequency } from '../core/music.js';

// V1: spectrum chart labels (index.html@a7b7a23)
export const SPECTRUM_DB_GRID = [0, -20, -40, -60, -80, -100, -120, -140];
export const SPECTRUM_DB_LABELS = SPECTRUM_DB_GRID.map(String);
export const SPECTRUM_MARKER_LABELS = SPECTRUM_MARKERS.map(formatFrequencyShort);
export const LINEAR_TICKS = [0, 2000, 5000, 10000, 15000, 20000, 25000, 30000, 40000];
export const LINEAR_TICK_LABELS = LINEAR_TICKS.map(formatFrequencyShort);
export const OCTAVE_C_LABELS = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'];
export const THIRD_OCTAVE_HALF_BAND = 2 ** (1 / 6);
export const MIC_LEGENDS = ['● microphone (relative)', '● mic'];
export const DIGITAL_LIMIT_LABEL = 'digital limit 95 %';
export const SPECTRUM_IDLE_NOTES = ['The measured spectrum appears once audio starts — press HOLD TO PLAY.', 'Spectrum appears once audio starts.', 'press HOLD TO PLAY'];

export const SPECTRUM_TITLE = 'RELATIVE LEVEL (dB, uncalibrated)';
export const SPECTRUM_DB_MIN = -140;
export const SPECTRUM_DB_MAX = 0;

/**
 * The spectrum's frequency axis: { log, fmin, fmax }. Log axes start at 20 Hz (5 Hz for ranges
 * below 20 Hz); fmax is the running Nyquist (sampleRate / 2) or the provisional one.
 * st: bridge state ({ spectrumScale, rangeMin, nyquist, live: { sampleRate } }).
 * V1: createSketch.updateSpectrumAxis (index.html@a7b7a23)
 */
export function spectrumAxis(st) {
  const log = st.spectrumScale === 'log';
  const fmin = log ? (st.rangeMin < 20 ? 5 : 20) : 0;
  const fmax = st.live.sampleRate > 0 ? st.live.sampleRate / 2 : st.nyquist;
  return { log, fmin, fmax };
}

/** Position of f on the axis as 0..1 (V1 createSketch.freqToX without the pixel mapping). */
export function freqToUnit(f, axis) {
  if (axis.log) return frequencyToNormalized(Math.max(f, axis.fmin), axis.fmin, axis.fmax);
  return f / axis.fmax;
}

/** Frequency at axis position u (0..1). */
export function unitToFreq(u, axis) {
  return axis.log ? normalizedToFrequency(u, axis.fmin, axis.fmax) : u * axis.fmax;
}

/**
 * Column -> FFT-bin lookup for `cols` display columns over `bins` bins: { cols, lo, hi }
 * (Int32Arrays). Bin k is centred on k · binHz. A column spanning [fa, fb) takes the bins whose
 * centres fall inside it; a column narrower than a bin takes the bin nearest its centre. Both keep
 * a pure tone's peak on the column of its frequency marker. Rebuild only when cols, bins or the
 * axis change. V1: createSketch.rebuildColumns (index.html@a7b7a23)
 */
export function buildColumnMap(bins, cols, axis) {
  cols = Math.max(1, Math.floor(cols));
  const binHz = axis.fmax / bins;
  const at = (u) => unitToFreq(u, axis);
  const colLo = new Int32Array(cols);
  const colHi = new Int32Array(cols);
  for (let c = 0; c < cols; c++) {
    let lo = Math.ceil(at(c / cols) / binHz - 1e-9);
    let hi = Math.ceil(at((c + 1) / cols) / binHz - 1e-9) - 1;
    if (hi < lo) { lo = Math.round(at((c + 0.5) / cols) / binHz); hi = lo; }
    colLo[c] = clamp(lo, 0, bins - 1);
    colHi[c] = clamp(hi, colLo[c], bins - 1);
  }
  return { cols, bins, log: axis.log, fmin: axis.fmin, fmax: axis.fmax, lo: colLo, hi: colHi };
}

/** True when a column map no longer matches (bins, cols, axis). */
export function columnMapStale(map, bins, cols, axis) {
  return !map || map.cols !== Math.max(1, Math.floor(cols)) || map.bins !== bins
    || map.log !== axis.log || map.fmin !== axis.fmin || map.fmax !== axis.fmax;
}

/**
 * Max-aggregate dB data (Float32Array from AnalyserNode.getFloatFrequencyData) per column into
 * `out` (Float32Array of map.cols, reused), clamped to [dbMin, dbMax]; -Infinity becomes dbMin.
 * V1: createSketch.plotSpectrum, value part (index.html@a7b7a23)
 */
export function aggregateColumns(data, map, out, dbMin = SPECTRUM_DB_MIN, dbMax = SPECTRUM_DB_MAX) {
  const res = out && out.length === map.cols ? out : new Float32Array(map.cols);
  for (let c = 0; c < map.cols; c++) {
    let v = -Infinity;
    const hi = Math.min(map.hi[c], data.length - 1);
    for (let b = map.lo[c]; b <= hi; b++) if (data[b] > v) v = data[b];
    if (!Number.isFinite(v)) v = dbMin;
    res[c] = clamp(v, dbMin, dbMax);
  }
  return res;
}

/** Centre frequency of every column (x values for the chart), into `out` when it fits. */
export function columnFrequencies(map, out) {
  const res = out && out.length === map.cols ? out : new Float64Array(map.cols);
  for (let c = 0; c < map.cols; c++) res[c] = unitToFreq((c + 0.5) / map.cols, map);
  return res;
}

/** Region bands within the axis: [{ label, short, f0, f1, odd }]. V1 drawSpectrum regions. */
export function regionBands(axis) {
  const out = [];
  for (let i = 0; i < FREQUENCY_REGIONS.length; i++) {
    const r = FREQUENCY_REGIONS[i];
    if (r.max <= axis.fmin || r.min >= axis.fmax) continue;
    const f0 = Math.max(r.min, axis.fmin || 1);
    const f1 = Math.min(r.max, axis.fmax);
    out.push({ label: r.label, short: r.short, f0, f1, odd: i % 2 === 1 });
  }
  return out;
}

/** Alternate third-octave bands f·2^(-1/6) … f·2^(1/6) within the axis. V1 drawSpectrum. */
export function thirdOctaveBands(axis) {
  const out = [];
  for (let i = 0; i < THIRD_OCTAVE_FREQUENCIES.length; i += 2) {
    const fc = THIRD_OCTAVE_FREQUENCIES[i];
    const lo = Math.max(fc / THIRD_OCTAVE_HALF_BAND, axis.fmin);
    const hi = Math.min(fc * THIRD_OCTAVE_HALF_BAND, axis.fmax);
    if (hi <= lo) continue;
    out.push({ fc, f0: lo, f1: hi });
  }
  return out;
}

/** C-note markers C0…C10 at tuning a4 within the axis: [{ label, f }]. V1 drawSpectrum notes. */
export function octaveCMarkers(a4, axis) {
  const out = [];
  for (let oct = 0; oct <= 10; oct++) {
    const f = midiToFrequency((oct + 1) * 12, a4);
    if (f < Math.max(axis.fmin, 1) || f > axis.fmax) continue;
    out.push({ label: OCTAVE_C_LABELS[oct], f });
  }
  return out;
}

/**
 * Label placement for vertical marker lines (octave Cs): each label sits right of its line, or
 * left of it where the plot's right edge (plotRight) would clip it, and is hidden when it would
 * overlap the previous shown label. xOf(f) -> px, widthOf(label) -> px.
 * Returns [{ label, f, x, lx, show }]. V1: drawSpectrum octave-C labels (index.html@a7b7a23)
 */
export function layoutMarkerLabels(markers, xOf, widthOf, plotRight) {
  const out = [];
  let lastRight = -Infinity;
  for (const m of markers) {
    const x = xOf(m.f);
    // right of its line, or left of it where the plot edge would clip it (C10 at 320 px)
    const lw = widthOf(m.label);
    const lx = x + 2 + lw <= plotRight - 2 ? x + 2 : x - 2 - lw;
    const show = lx > lastRight + 2;
    if (show) lastRight = lx + lw;
    out.push({ label: m.label, f: m.f, x, lx, show });
  }
  return out;
}

/** Frequency ticks and labels of the axis: [{ f, label }]. V1 drawSpectrum ticks. */
export function spectrumTicks(axis) {
  const ticks = axis.log ? SPECTRUM_MARKERS : LINEAR_TICKS;
  const labels = axis.log ? SPECTRUM_MARKER_LABELS : LINEAR_TICK_LABELS;
  const out = [];
  for (let i = 0; i < ticks.length; i++) {
    if (ticks[i] < axis.fmin || ticks[i] > axis.fmax) continue;
    out.push({ f: ticks[i], label: labels[i] });
  }
  return out;
}

/**
 * Markers of the chart: { requested, requestedB, nyquist, digitalLimit } in Hz (null when off
 * the axis). requested is the instantaneous frequency while playing, else the plan's start.
 * V1: drawSpectrum markers (index.html@a7b7a23)
 */
export function spectrumMarkers(st, axis) {
  const L = st.live;
  const fc = L.voice ? L.inst : L.refFreq;
  const inAxis = (f) => isNum(f) && f >= axis.fmin && f <= axis.fmax;
  return {
    requested: inAxis(fc) ? fc : null,
    requestedB: st.source === 'dual' && inAxis(st.dual.fb) ? st.dual.fb : null,
    nyquist: axis.fmax,
    digitalLimit: axis.fmax * SAFE_NYQUIST_FACTOR,
  };
}
