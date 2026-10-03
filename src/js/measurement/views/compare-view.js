// Experiment comparison view model (spec §59-§60, §105, §150). Pure.
//
//   buildCompareView(experiments, options) -> CompareView
//     options = { labels = ['A', 'B', …], deltaPair = [0, 1], pointsPerOctave = 48,
//                 allowNonEquivalentDelta = false, irRange = null ([fromMs, toMs]; null =
//                 ir-chart.js IR_OVERLAY_RANGE_MS) }
//   CompareView = {
//     entries: [{ label, id, title, compact, role }],
//     common: [{ field, label, text }],
//     differences: [{ field, label, severity: 'info'|'warn', glyph, icon, shape,
//                     values: [{ label, text }] }],
//     compatible, sameConfiguration, warnings: [text],
//     overlay: { x, grid: 'shared'|'resampled', axes, series, notes } | null,
//     delta: { ok: true, x, range, rangeText, label, series, axes, summary, readoutAt(hz) }
//          | { ok: false, reason },
//     irOverlay: { ok: true, view (ir-chart.js IrOverlayView), summary, notes, labels }
//              | { ok: false, reason },
//     irDelta: { ok: false, reason },
//     summary }
//
// Rules: the comparison metadata come from experiments/compare.js compareExperiments
// (differences in calibration, sample rate, stimulus, analysis or algorithm versions are
// 'warn' and make the set non-equivalent). The overlay shows each experiment's RAW magnitude
// (results.transfer, or the stored aggregate centre, G16/G20) unchanged — nothing is
// normalized or offset to make curves meet (§60). A − B (compare.js responseDelta) exists only
// over the overlap of both VALID ranges and, unless the caller explicitly allows it, only for
// equivalent experiments; otherwise the delta is refused with the reason. Each overlay curve
// keeps its own reliability mask (dashed where unreliable).
// IR overlay (spec §59 "useful: IR overlay"; plan V356): the impulse responses of the compared
// experiments on one time axis (ms re each curve's own direct peak, original scale, nothing
// normalized; ir-chart.js buildIrOverlayView), shown ONLY when the set is equivalent (the
// compareExperiments rules that also gate A − B: same calibration, sample rate, stimulus,
// analysis, algorithms and master gain) and at least two of them carry an IR; otherwise it is
// refused with the reason. There is no A − B of impulse responses (irDelta is always refused):
// docs/v3/algorithms.md defines none.

import { compareExperiments, responseDelta } from '../../experiments/compare.js';
import { describeStimulus } from '../../experiments/schema.js';
import { isValidLevelCalibration } from '../../calibration/level.js';
import { TRANSFER_RATIO_UNIT } from '../../experiments/csv.js';
import { experimentSummary } from './experiment-summary.js';
import { buildIrOverlayView } from './ir-chart.js';
import {
  QUANTITY_KINDS as K, COMPARE_ROLES, LINE_STYLES, STATUS_PRESENTATION, UNAVAILABLE,
  splitByMask, extent, dbAxisRange, frequencyAxis, interpLogF, nearestIndex, maskOn, rangeText,
  ratioDbText, gridFrequencyText,
} from './common.js';

const FIELD_LABELS = Object.freeze({
  'calibration.frequency': 'Frequency calibration profile',
  'calibration.level': 'Level calibration',
  'measurement.sampleRate': 'Sample rate',
  'recipe.stimulus': 'Stimulus',
  'recipe.analysis': 'Analysis settings',
  'recipe.repeats': 'Repeats',
  'output.level': 'Output level (digital peak)',
  schemaVersion: 'Schema version',
  oscillaVersion: 'OSCILLA version',
  oscillaCommit: 'OSCILLA commit',
  'input.device.label': 'Input device',
});

function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const m = /^algorithms\.(.+)$/.exec(field);
  if (m) return `Algorithm (${m[1]})`;
  const r = /^results\.(.+)\.algorithm$/.exec(field);
  if (r) return `Result algorithm (${r[1]})`;
  return field;
}

/** Human text of one compared value; the level text names SPL only for a valid calibration. */
function valueText(field, v, e) {
  if (v === null || v === undefined) {
    if (field === 'calibration.frequency') return 'none (UNCALIBRATED)';
    if (field === 'calibration.level') return 'none (levels relative, dBFS-like)';
    if (field === 'input.device.label') return 'UNKNOWN (not exposed by the browser)';
    return 'none';
  }
  switch (field) {
    case 'calibration.frequency': {
      const name = e && e.calibration && e.calibration.frequency
        ? e.calibration.frequency.name : null;
      return `"${name || UNAVAILABLE.UNKNOWN}" (${String(v).slice(0, 12)}…)`;
    }
    case 'calibration.level': {
      const l = e && e.calibration ? e.calibration.level : null;
      return isValidLevelCalibration(l)
        ? `CALIBRATED: ${l.referenceDbSpl} dB SPL reference at ${l.referenceHz} Hz`
        : 'present but invalid (not applied)';
    }
    case 'measurement.sampleRate': return `${v} Hz`;
    case 'recipe.stimulus': return describeStimulus(v);
    case 'oscillaCommit': return String(v).slice(0, 7);
    case 'recipe.analysis':
      return typeof v === 'object' ? Object.keys(v).sort().map((k) => `${k} ${
        typeof v[k] === 'object' ? JSON.stringify(v[k]) : v[k]}`).join(', ') : String(v);
    default:
      return typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v);
  }
}

/** Magnitude, grid, validity and mask of an experiment (RAW; transfer or stored aggregate). */
export function experimentResponse(e) {
  const r = e && e.results ? e.results : {};
  const t = r.transfer;
  const a = r.aggregate;
  let frequencies = null;
  let magnitudeDb = null;
  let validRange = null;
  let source = null;
  if (t && t.frequencies && t.magnitudeDb) {
    ({ frequencies, magnitudeDb } = t);
    validRange = t.validRange || null;
    source = 'transfer';
  } else if (a && a.frequencies && a.centreDb) {
    frequencies = a.frequencies;
    magnitudeDb = a.centreDb;
    source = 'aggregate';
  }
  if (!frequencies) return null;
  const q = e.quality || null;
  if (!validRange && q && q.metrics && Array.isArray(q.metrics.coverage))
    validRange = q.metrics.coverage;
  const mask = q && q.mask && q.mask.frequencies && q.mask.frequencies.length
    === frequencies.length ? maskOn(q.mask.reliable, frequencies.length) : null;
  return { frequencies, magnitudeDb, validRange, mask, source,
    runs: a && Number.isInteger(a.runs) ? a.runs : 1 };
}

function sameGrid(list) {
  const f0 = list[0].frequencies;
  return list.every((r) => r.frequencies.length === f0.length
    && r.frequencies.every((v, i) => v === f0[i]));
}

function logGrid(lo, hi, ppo) {
  const n = Math.max(2, Math.ceil(Math.log2(hi / lo) * ppo) + 1);
  const out = new Float64Array(n);
  const step = Math.log(hi / lo) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = i === n - 1 ? hi : lo * Math.exp(step * i);
  return out;
}

function overlayView(exps, responses, labels, ppo) {
  const present = responses.map((r, i) => ({ r, i })).filter((x) => x.r);
  if (present.length < 2) return null;
  const shared = sameGrid(present.map((x) => x.r));
  let x;
  const notes = [];
  if (shared) x = Float64Array.from(present[0].r.frequencies);
  else {
    const lo = Math.min(...present.map((p) => p.r.frequencies[0]));
    const hi = Math.max(...present.map((p) => p.r.frequencies[p.r.frequencies.length - 1]));
    x = logGrid(lo, hi, ppo);
    notes.push(`The experiments use different frequency grids: each curve is drawn on a common `
      + `1/${ppo}-octave grid (linear in dB over log frequency, only inside its own range).`);
  }
  const series = [];
  for (const { r, i } of present) {
    let values;
    let mask;
    if (shared) {
      values = r.magnitudeDb;
      mask = r.mask;
    } else {
      values = new Float64Array(x.length);
      mask = r.mask ? new Uint8Array(x.length) : null;
      for (let k = 0; k < x.length; k++) {
        const v = interpLogF(r.frequencies, r.magnitudeDb, x[k]);
        values[k] = v === null ? NaN : v;
        if (mask && v !== null) mask[k] = r.mask[nearestIndex(r.frequencies, x[k])];
      }
    }
    const split = splitByMask(values, mask);
    const role = COMPARE_ROLES[i % COMPARE_ROLES.length];
    const name = `${labels[i]} · RAW · OBSERVED · ${exps[i].name || '(unnamed)'}`;
    series.push({ id: `exp-${i}`, label: name, kind: K.OBSERVED, role, values: split.reliable,
      width: LINE_STYLES.primary.width, dash: null, alpha: 1, show: true, reliable: true,
      derivation: null });
    series.push({ id: `exp-${i}-unreliable`, label: `${name} · UNRELIABLE (dashed)`,
      kind: K.OBSERVED, role, values: split.unreliable, width: LINE_STYLES.unreliable.width,
      dash: LINE_STYLES.unreliable.dash, alpha: LINE_STYLES.unreliable.alpha, show: true,
      reliable: false, derivation: null });
    if (!mask) notes.push(`${labels[i]}: reliability ${UNAVAILABLE.NOT_ASSESSED} (drawn dashed).`);
  }
  notes.push('Raw magnitudes as measured: nothing is normalized or offset.');
  const y = dbAxisRange(extent(series.map((s) => s.values)));
  return {
    x,
    grid: shared ? 'shared' : 'resampled',
    axes: { x: frequencyAxis(x[0], x[x.length - 1]),
      y: { label: 'Magnitude · dB relative', unit: TRANSFER_RATIO_UNIT, range: y.range,
        ticks: y.ticks, kind: K.OBSERVED } },
    series,
    notes,
  };
}

function deltaView(exps, responses, labels, [ia, ib], cmp, { allowNonEquivalentDelta, ppo }) {
  if (exps.length < 2 || !exps[ia] || !exps[ib] || ia === ib)
    return { ok: false, reason: 'A − B needs two different experiments' };
  if (!cmp.compatible && !allowNonEquivalentDelta) {
    return { ok: false, reason: `A − B is not shown for non-equivalent experiments: ${
      cmp.warnings.join(' ')}` };
  }
  const ra = responses[ia];
  const rb = responses[ib];
  if (!ra || !rb) return { ok: false, reason: 'both experiments need a frequency response' };
  if (!ra.validRange || !rb.validRange) {
    return { ok: false, reason: `the valid frequency range of ${!ra.validRange ? labels[ia]
      : labels[ib]} is ${UNAVAILABLE.UNKNOWN}; A − B needs both` };
  }
  const t = (r) => ({ frequencies: r.frequencies, magnitudeDb: r.magnitudeDb,
    validRange: r.validRange });
  const d = responseDelta(t(ra), t(rb), { pointsPerOctave: ppo });
  if (!d.ok) return { ok: false, reason: d.reason };
  const values = Array.from(d.deltaDb, (v) => (Number.isFinite(v) ? v : null));
  const label = `${labels[ia]} − ${labels[ib]} · ${d.label}`;
  const ext = extent([values]);
  const y = dbAxisRange(ext, { step: 3, minSpan: 12 });
  const rText = rangeText(d.frequencies, d.range[0], d.range[1]);
  let hi = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && (hi < 0 || Math.abs(values[i]) > Math.abs(values[hi]))) hi = i;
  }
  return {
    ok: true,
    x: d.frequencies,
    range: d.range,
    rangeText: rText,
    label,
    series: [{ id: 'delta', label, kind: K.DELTA, role: 'derived', values,
      width: LINE_STYLES.primary.width, dash: null, alpha: 1, show: true, reliable: null,
      derivation: { delta: { pair: [labels[ia], labels[ib]], pointsPerOctave: d.pointsPerOctave,
        method: 'linear dB over log frequency' } } }],
    axes: { x: frequencyAxis(d.range[0], d.range[1]),
      y: { label: `${labels[ia]} − ${labels[ib]} · dB`, unit: 'dB (ratio of the two responses)',
        range: y.range, ticks: y.ticks, kind: K.DELTA } },
    summary: hi < 0 ? `${labels[ia]} − ${labels[ib]}: no values.`
      : `${labels[ia]} − ${labels[ib]} over ${rText} (overlap of both valid ranges): largest `
        + `difference ${ratioDbText(values[hi])} at ${gridFrequencyText(d.frequencies, hi)}.`,
    readoutAt: (hz) => {
      if (!(hz >= d.range[0] && hz <= d.range[1])) return null;
      const v = interpLogF(d.frequencies, d.deltaDb, hz);
      return v === null ? null : { hz, value: v, text: `${labels[ia]} − ${labels[ib]} `
        + `${ratioDbText(v)}` };
    },
  };
}

/** The IrResult of an experiment, or null. */
function experimentIr(e) {
  const ir = e && e.results ? e.results.ir : null;
  return ir && ir.samples && ir.samples.length > 0 && ir.sampleRate > 0
    && Number.isInteger(ir.peakIndex) ? ir : null;
}

/** IR_DELTA_REASON: why the compare view has no A − B of impulse responses. */
export const IR_DELTA_REASON = 'A − B is not defined for impulse responses (only for the '
  + 'frequency responses above)';

/** The IR overlay of a compared set, or the reason it is not shown (see the header). */
function irOverlayOf(exps, labels, cmp, { irRange }) {
  const present = exps.map((e, i) => ({ ir: experimentIr(e), i })).filter((x) => x.ir);
  if (present.length < 2) {
    const missing = exps.map((e, i) => (experimentIr(e) ? null : labels[i])).filter(Boolean);
    return { ok: false, reason: `the IR overlay needs two or more impulse responses (${
      missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} none)` };
  }
  if (!cmp.compatible) {
    return { ok: false, reason: `the IR overlay is not shown for non-equivalent experiments: ${
      cmp.warnings.join(' ')}` };
  }
  const rates = [...new Set(present.map((p) => p.ir.sampleRate))];
  if (rates.length > 1) {
    return { ok: false, reason: `the impulse responses have different sample rates (${
      rates.join(' Hz, ')} Hz)` };
  }
  const entries = present.map(({ ir, i }) => ({ ir, label: labels[i],
    name: exps[i].name || '(unnamed)', role: COMPARE_ROLES[i % COMPARE_ROLES.length] }));
  const view = buildIrOverlayView(entries, irRange ? { range: irRange } : {});
  return { ok: true, view, summary: view.summary, notes: view.notes.slice(),
    labels: entries.map((e) => e.label) };
}

/** buildCompareView(experiments, options) → CompareView (see the header). */
export function buildCompareView(experiments, options = {}) {
  if (!Array.isArray(experiments) || experiments.length < 2)
    throw new RangeError('buildCompareView needs at least two experiments');
  const {
    labels = experiments.map((_, i) => String.fromCharCode(65 + (i % 26))),
    deltaPair = [0, 1], pointsPerOctave = 48, allowNonEquivalentDelta = false, irRange = null,
  } = options;
  const cmp = compareExperiments(experiments);
  const entries = experiments.map((e, i) => {
    const s = experimentSummary(e);
    return { label: labels[i], id: s.id, title: s.title, compact: s.compact,
      role: COMPARE_ROLES[i % COMPARE_ROLES.length] };
  });
  const common = Object.keys(cmp.common).map((field) => ({ field, label: fieldLabel(field),
    text: valueText(field, cmp.common[field], experiments[0]) }));
  const differences = cmp.differences.map((d) => {
    const p = STATUS_PRESENTATION[d.severity === 'warn' ? 'warn' : 'info'];
    return { field: d.field, label: fieldLabel(d.field), severity: d.severity, glyph: p.glyph,
      icon: p.icon, shape: p.shape, className: p.className,
      values: d.values.map((v, i) => ({ label: labels[i], text: valueText(d.field, v,
        experiments[i]) })) };
  });
  const responses = experiments.map(experimentResponse);
  const overlay = overlayView(experiments, responses, labels, pointsPerOctave);
  const delta = deltaView(experiments, responses, labels, deltaPair, cmp,
    { allowNonEquivalentDelta, ppo: pointsPerOctave });
  const irOverlay = irOverlayOf(experiments, labels, cmp, { irRange });
  const warn = cmp.warnings.length;
  const refused = delta.ok ? '' : delta.reason.replace(/\.$/, '');
  const summary = `Comparing ${entries.map((e) => `${e.label} "${e.title}"`).join(', ')}: `
    + `${warn ? `NOT EQUIVALENT (${warn} warning${warn === 1 ? '' : 's'})` : 'equivalent '
      + 'configuration'}; ${differences.length} difference${differences.length === 1 ? ''
      : 's'}${delta.ok ? `; ${delta.summary}` : `; A − B not shown: ${refused}.`}`;
  return {
    entries,
    common,
    differences,
    compatible: cmp.compatible,
    sameConfiguration: cmp.sameConfiguration,
    warnings: cmp.warnings.slice(),
    overlay,
    delta,
    irOverlay,
    irDelta: { ok: false, reason: IR_DELTA_REASON },
    summary,
  };
}
