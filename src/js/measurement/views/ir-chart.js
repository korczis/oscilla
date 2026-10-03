// Impulse-response chart view model (spec §37-§42, §121, §150, §214). Pure.
//
//   buildIrView(ir, options) -> IrView
//     ir       an IrResult (impulse-response.js; engine result.ir or experiment results.ir)
//     options  { scale = 'linear' | 'db', normalize = false,
//                window = null | [fromMs, toMs]   relative to the direct peak (view only),
//                range = null | 'full' | [fromMs, toMs]  x-axis range; null = [first sample,
//                                                 200 ms], 'full' = first to last sample,
//                maxPoints = 4000                 plot columns (min/max decimation) }
//   IrView = { x: Float64Array (ms re direct peak), axes, series: [descriptor], origin,
//     windowRegion|null, decimation, badges, notes, summary }
//
// Time (§214): x is milliseconds relative to the detected direct peak (0 ms = the peak); the
// absolute position is kept in `origin` (capture offset + peak time, in s and ms) and in the
// summary, never discarded. Amplitude (§39, §41): the original scale (relative amplitude, a
// unity digital system reads ~1 in band) unless `normalize`, in which case every label says
// NORMALIZED (impulse-response.js normalizeIr carries the algorithm ID). The window (§40) is a
// region descriptor from irWindow(): the IrResult is never cropped.
//
// Decimation keeps the minimum and maximum of each column (so the direct peak and reflections
// are never averaged away) and runs over the VISIBLE span only (M7 of the V3 review): the
// samples inside the x range (plus one on each side, so the line reaches the edges) are sliced
// first and then decimated to maxPoints columns, so a 22 ms span of a 10 s IR is drawn sample by
// sample instead of from a handful of whole-IR columns. A changed span needs a new view (the
// caller rebuilds on every span change). The summary never lists points (§150).

import { irWindow, normalizeIr } from '../impulse-response.js';
import { ZERO_POWER_DB } from '../transfer.js';
import {
  QUANTITY_KINDS as K, LINE_STYLES, fixedText, msText, extent,
} from './common.js';
import { linearTicks } from '../../charts/axes.js';

/** Default visible span after the peak (ms): the direct sound and early reflections. */
export const IR_DEFAULT_VIEW_MS = 200;
/** Default number of plot columns. */
export const IR_MAX_POINTS = 4000;
/** dB-view floor below the peak (display only; the data keep their values). */
export const IR_DB_FLOOR = -120;

export const IR_LABELS = Object.freeze({
  time: 'Time re direct peak',
  linear: 'Amplitude · relative (original scale)',
  db: 'Level · dB re unity amplitude (relative)',
});

function validIr(ir) {
  return !!ir && ir.samples && typeof ir.samples.length === 'number' && ir.samples.length > 0
    && ir.sampleRate > 0 && Number.isInteger(ir.peakIndex);
}

/** Min/max decimation of y over x into at most maxPoints columns (pairs per column). */
function decimate(xs, ys, maxPoints) {
  const n = ys.length;
  if (n <= maxPoints) return { x: Float64Array.from(xs), y: Array.from(ys), factor: 1 };
  const cols = Math.max(1, Math.floor(maxPoints / 2));
  const per = Math.ceil(n / cols);
  const x = [];
  const y = [];
  for (let c = 0; c * per < n; c++) {
    const a = c * per;
    const b = Math.min(n, a + per);
    let iMin = a;
    let iMax = a;
    for (let i = a; i < b; i++) {
      if (ys[i] < ys[iMin]) iMin = i;
      if (ys[i] > ys[iMax]) iMax = i;
    }
    const [p, q] = iMin <= iMax ? [iMin, iMax] : [iMax, iMin];
    x.push(xs[p]);
    y.push(ys[p]);
    if (q !== p) {
      x.push(xs[q]);
      y.push(ys[q]);
    }
  }
  return { x: Float64Array.from(x), y, factor: per };
}

/** buildIrView(ir, options) → IrView, or null without an impulse response (NOT MEASURED). */
export function buildIrView(ir, options = {}) {
  if (!validIr(ir)) return null;
  const {
    scale = 'linear', normalize = false, window = null, range = null,
    maxPoints = IR_MAX_POINTS,
  } = options;
  if (scale !== 'linear' && scale !== 'db') throw new RangeError(`unknown IR scale '${scale}'`);
  const sr = ir.sampleRate;
  const n = ir.samples.length;
  const msPerSample = 1000 / sr;
  const peakMs = (ir.peakTimeS ?? ir.peakIndex / sr) * 1000;
  const msAt = (i) => (i - ir.peakIndex) * msPerSample;
  const startMs = msAt(0);
  const endMs = msAt(n - 1);
  let xr;
  if (range === 'full') xr = [startMs, endMs];
  else if (Array.isArray(range)) xr = [range[0], range[1]];
  else if (range === null) xr = [startMs, Math.min(endMs, IR_DEFAULT_VIEW_MS)];
  else throw new RangeError("range must be null, 'full' or [fromMs, toMs]");
  if (!(xr[1] > xr[0])) throw new RangeError('range must be [fromMs, toMs] with fromMs < toMs');
  // The visible samples, one beyond each edge (clamped to the IR).
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(ir.peakIndex + xr[0] / msPerSample) - 1));
  const i1 = Math.max(i0, Math.min(n - 1, Math.ceil(ir.peakIndex + xr[1] / msPerSample) + 1));
  const xsVis = new Float64Array(i1 - i0 + 1);
  for (let i = i0; i <= i1; i++) xsVis[i - i0] = msAt(i);

  let values;
  let label;
  let unit;
  let kind = K.OBSERVED;
  let derivation = null;
  if (normalize) {
    const v = normalizeIr(ir, scale === 'db' ? 'peak-db' : 'peak-linear');
    values = v.values;
    label = v.label;
    unit = v.unit;
    kind = K.NORMALIZED;
    derivation = { normalization: { mode: v.mode, algorithm: v.algorithm,
      referenceValue: v.referenceValue, label: v.label } };
  } else if (scale === 'db') {
    values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(ir.samples[i]);
      values[i] = a > 0 ? Math.max(ZERO_POWER_DB, 20 * Math.log10(a)) : ZERO_POWER_DB;
    }
    label = IR_LABELS.db;
    unit = 'dB re unity amplitude';
  } else {
    values = ir.samples;
    label = IR_LABELS.linear;
    unit = 'relative';
  }
  const visible = values.subarray ? values.subarray(i0, i1 + 1) : values.slice(i0, i1 + 1);
  const ys = scale === 'db' ? Array.from(visible, (v) => (v > ZERO_POWER_DB ? v : -Infinity))
    : Array.from(visible);
  const dec = decimate(xsVis, ys, maxPoints);
  const plotY = dec.y.map((v) => (Number.isFinite(v) ? v : null));

  const lineLabel = `${kind === K.NORMALIZED ? 'NORMALIZED' : 'OBSERVED'} impulse response · `
    + `${label}`;
  const seriesList = [{
    id: 'ir', label: lineLabel, kind, role: 'observed', values: plotY,
    width: LINE_STYLES.primary.width, dash: null, alpha: 1, show: true, reliable: null,
    derivation,
  }];

  let yAxis;
  if (scale === 'db') {
    // Top: the peak (0 dB when normalized); bottom: 10 dB under the noise tail (re peak),
    // never more than IR_DB_FLOOR under the peak.
    const e = extent([plotY]);
    const top = normalize ? 0 : (e ? e[1] : 0);
    const tail = Number.isFinite(ir.noiseFloorDb) ? ir.noiseFloorDb - 10 : IR_DB_FLOOR;
    const hiR = Math.ceil(top / 10) * 10 || 0; // never −0
    const loR = Math.min(hiR - 60, Math.floor((top + Math.max(IR_DB_FLOOR, tail)) / 20) * 20);
    yAxis = { label: normalize ? label : IR_LABELS.db, unit, range: [loR, hiR],
      ticks: linearTicks(loR, hiR, { step: 20 }), kind };
  } else {
    const e = extent([plotY]) || [-1, 1];
    const m = Math.max(Math.abs(e[0]), Math.abs(e[1])) * 1.1 || 1;
    yAxis = { label: normalize ? label : IR_LABELS.linear, unit, range: [-m, m],
      ticks: linearTicks(-m, m, { count: 4 }), kind };
  }

  const absolutePeakS = (ir.captureOffsetS || 0) + (ir.peakTimeS ?? ir.peakIndex / sr);
  const origin = {
    peakIndex: ir.peakIndex,
    peakTimeS: ir.peakTimeS ?? ir.peakIndex / sr,
    captureOffsetS: ir.captureOffsetS ?? 0,
    absolutePeakS,
    absolutePeakMs: absolutePeakS * 1000,
    label: `0 ms = direct peak, ${msText(absolutePeakS * 1000, msPerSample)} after the capture `
      + 'start',
  };

  let windowRegion = null;
  if (window) {
    const [fromMs, toMs] = window;
    const w = irWindow(ir, (peakMs + fromMs) / 1000, (peakMs + toMs) / 1000);
    windowRegion = {
      fromMs, toMs,
      startIndex: w.view.startIndex,
      endIndex: w.view.endIndex,
      samples: w.view.endIndex - w.view.startIndex,
      label: `WINDOW ${msText(fromMs, msPerSample)} to ${msText(toMs, msPerSample)} (view only; `
        + 'the impulse response is kept whole)',
      role: 'neutral',
      dash: LINE_STYLES.marker.dash,
    };
  }

  const badges = [normalize ? 'NORMALIZED' : 'ORIGINAL SCALE', scale === 'db' ? 'dB' : 'LINEAR'];
  const notes = [origin.label + '.', `Method: ${ir.method || 'spectral'} (${ir.algorithm}).`];
  if (!Number.isFinite(ir.noiseFloorDb)) notes.push('Noise tail: not available.');
  else if (typeof ir.noiseFloorMethod === 'string' && ir.noiseFloorMethod) {
    notes.push(`Noise tail estimate: ${ir.noiseFloorMethod}.`);
  }
  if (dec.factor > 1) notes.push(`Drawn as the minimum and maximum of every ${dec.factor} `
    + 'samples of the visible span (display decimation; the data are not resampled).');
  if (normalize) notes.push('NORMALIZED for display; the experiment keeps the original scale.');

  const peakAmp = ir.samples[ir.peakIndex];
  const amp = Number.isFinite(peakAmp) ? Number(peakAmp.toPrecision(3)) : null;
  const summary = 'Impulse response: direct peak '
    + `${msText(absolutePeakS * 1000, msPerSample)} after the capture start (shown at 0 ms), `
    + `peak amplitude ${amp === null ? '—' : fixedText(amp, decimalsOf(amp))} (relative, `
    + `${amp !== null && amp < 0 ? 'inverted polarity, ' : ''}original scale), noise tail `
    // IR v2 may report no noise floor (noiseFloorDb null): say so, never print a number.
    + `${Number.isFinite(ir.noiseFloorDb) ? `${fixedText(ir.noiseFloorDb, 0)} dB re peak`
      : 'not available'}, `
    + `length ${msText(n * msPerSample, Math.max(1, msPerSample))}`
    + `${normalize ? '; display NORMALIZED' : ''}.`;

  return {
    x: dec.x,
    axes: {
      x: { label: IR_LABELS.time, unit: 'ms', scale: 'linear', range: xr,
        ticks: linearTicks(xr[0], xr[1], { count: 6 }), kind: K.OBSERVED },
      y: yAxis,
    },
    series: seriesList,
    origin,
    windowRegion,
    decimation: { factor: dec.factor, points: dec.x.length, samples: n,
      visibleSamples: i1 - i0 + 1, firstIndex: i0, lastIndex: i1 },
    badges,
    notes,
    summary,
  };
}

function decimalsOf(v) {
  if (v === 0) return 0;
  return Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v))));
}
