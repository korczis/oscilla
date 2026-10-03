// Experiment comparison (spec §59-§60, §105). Pure; no DOM, no globals.
//
//   compareExperiments(list) -> { common: { field: value }, differences: [{ field, values,
//     severity: 'info'|'warn' }], compatible, warnings: [text], sameConfiguration }
// Differences in calibration, sample rate, stimulus, analysis, algorithm versions or the master
// output gain (output.masterGain: 20·log10 of it is part of every stored magnitude, so two
// gains offset the curves by their ratio; a recorded gain against none is a difference too) are
// 'warn' and make the set incompatible (it may still be overlaid, with the warnings shown); name,
// versions of OSCILLA and of the schema, input device and repeats are 'info'. The stored
// response kind (G20) is 'warn' too: a single run against the aggregate of repeated runs is not
// an equivalent comparison (field `results.response`: 'single run' | 'aggregate (<method>)'),
// and neither are aggregates of different methods; the number of runs is 'info'
// (`results.aggregate.runs`).
//
//   responseDelta(a, b, { pointsPerOctave = 48 }) -> { ok: true, frequencies, aDb, bDb,
//     deltaDb, range: [fLo, fHi], pointsPerOctave, label, sources: [kindA, kindB],
//     equivalent, warnings, envelope } | { ok: false, reason }
// A − B of two responses on a common log-spaced grid, interpolated linearly in dB over
// log-frequency, ONLY over the overlap of both valid ranges. Values are raw dB relative;
// nothing is normalized or offset. A response is (responseOf):
//   - an experiment: results.aggregate when it holds ≥ 2 runs (G20: the primary response of a
//     repeated measurement; centre on its grid, valid range from the derivedFrom 'aggregate'
//     transfer when there is one), else results.transfer;
//   - a TransferResult (kind 'transfer', or 'aggregate-centre' when derivedFrom 'aggregate');
//   - an AggregateResult (kind 'aggregate'; its whole grid is the valid range).
// A single run against an aggregate (or its centre) gives equivalent: false and a warning.
// envelope: null unless both responses carry an envelope (aggregates of ≥ 2 runs); then
//   { aLowerDb, aUpperDb, bLowerDb, bUpperDb (on the common grid), overlap: Uint8Array (1 where
//   the two intervals intersect), overlapFraction, dispersion: [a, b], comparable } —
//   comparable false (with a warning) when the dispersions differ (std vs p10-p90).

import { canonicalJson } from './canonical-json.js';
import { configSelection } from './hash.js';

const FIELDS = [
  ['calibration.frequency', (e) => e.calibration?.frequency?.id ?? null, 'warn'],
  ['calibration.level', (e) => levelIdentity(e.calibration?.level), 'warn'],
  ['measurement.sampleRate', (e) => e.measurement?.sampleRate ?? null, 'warn'],
  ['recipe.stimulus', (e) => e.recipe?.stimulus ?? null, 'warn'],
  ['recipe.analysis', (e) => e.recipe?.analysis ?? null, 'warn'],
  ['recipe.repeats', (e) => e.recipe?.repeats ?? null, 'info'],
  ['output.level', (e) => e.output?.level ?? null, 'info'],
  ['output.masterGain', (e) => e.output?.masterGain ?? null, 'warn'],
  ['schemaVersion', (e) => e.schemaVersion ?? null, 'info'],
  ['oscillaVersion', (e) => e.oscillaVersion ?? null, 'info'],
  ['oscillaCommit', (e) => e.oscillaCommit ?? null, 'info'],
  ['input.device.label', (e) => e.input?.device?.label ?? null, 'info'],
];

const WARN_TEXT = {
  'calibration.frequency': 'different frequency calibration profiles',
  'calibration.level': 'different level (SPL) calibrations',
  'measurement.sampleRate': 'different sample rates',
  'recipe.stimulus': 'different stimuli',
  'recipe.analysis': 'different analysis settings',
  'output.masterGain': 'different master output gains (20·log10 of the gain is part of every '
    + 'magnitude)',
  'results.response': 'a single run compared with the aggregate of repeated runs, or aggregates '
    + 'of different methods',
};

function levelIdentity(l) {
  if (!l) return null;
  return { referenceHz: l.referenceHz, referenceDbSpl: l.referenceDbSpl,
    observedDbRelative: l.observedDbRelative, offsetDb: l.offsetDb };
}

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** Compare two or more experiments; never modifies them. */
export function compareExperiments(list) {
  if (!Array.isArray(list) || list.length < 2) {
    throw new RangeError('compareExperiments needs at least two experiments');
  }
  const common = {};
  const differences = [];
  const add = (field, values, severity) => {
    const allSame = values.every((v) => same(v, values[0]));
    if (allSame) common[field] = values[0];
    else differences.push({ field, values, severity });
  };
  for (const [field, get, severity] of FIELDS) add(field, list.map(get), severity);
  const roles = new Set(list.flatMap((e) => Object.keys(e.algorithms || {})));
  for (const role of [...roles].sort()) {
    add(`algorithms.${role}`, list.map((e) => (e.algorithms || {})[role] ?? null), 'warn');
  }
  for (const kind of ['transfer', 'ir', 'rta', 'aggregate']) {
    const ids = list.map((e) => e.results?.[kind]?.algorithm ?? null);
    if (ids.some((x) => x !== null)) add(`results.${kind}.algorithm`, ids, 'warn');
  }
  const kinds = list.map(responseKind);
  if (kinds.some((k) => k !== null)) {
    add('results.response', kinds.map((k) => (k ? k.label : null)), 'warn');
    const runs = kinds.map((k) => (k ? k.runs : null));
    if (runs.some((r) => r !== null)) add('results.aggregate.runs', runs, 'info');
  }
  const warnings = differences.filter((d) => d.severity === 'warn').map((d) => {
    const text = WARN_TEXT[d.field] || `different ${d.field}`;
    return `Not equivalent: ${text} (${d.values.map(show).join(' vs ')}).`;
  });
  const selections = list.map((e) => canonicalJson(configSelection(e)));
  return {
    common,
    differences,
    compatible: warnings.length === 0,
    warnings,
    sameConfiguration: selections.every((s) => s === selections[0]),
  };
}

function show(v) {
  if (v === null) return 'none';
  if (typeof v === 'object') return canonicalJson(v).slice(0, 80);
  return String(v);
}

const isRepeated = (a) => !!a && Number.isInteger(a.runs) && a.runs >= 2 && !!a.centreDb;

/** The stored response kind of an experiment: { label, runs } or null (no response). */
function responseKind(e) {
  const r = e && e.results;
  if (!r) return null;
  if (isRepeated(r.aggregate)) {
    return { label: `aggregate (${r.aggregate.method})`, runs: r.aggregate.runs };
  }
  if (r.transfer) return { label: 'single run', runs: null };
  return null;
}

/**
 * responseOf(x) → { kind: 'transfer'|'aggregate'|'aggregate-centre', frequencies, magnitudeDb,
 *   validRange, lowerDb, upperDb, dispersion, runs, method } | null
 * The response responseDelta compares (see the header).
 */
export function responseOf(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.results) {
    const r = x.results;
    if (isRepeated(r.aggregate)) {
      const t = r.transfer && r.transfer.derivedFrom === 'aggregate' ? r.transfer : null;
      return fromAggregate(r.aggregate, t ? t.validRange : null);
    }
    if (r.transfer) return responseOf(r.transfer);
    if (r.aggregate) return fromAggregate(r.aggregate, null);
    return null;
  }
  if (x.centreDb) return fromAggregate(x, null);
  if (x.magnitudeDb) {
    return { kind: x.derivedFrom === 'aggregate' ? 'aggregate-centre' : 'transfer',
      frequencies: x.frequencies, magnitudeDb: x.magnitudeDb, validRange: x.validRange ?? null,
      lowerDb: null, upperDb: null, dispersion: null, runs: null, method: null };
  }
  return null;
}

function fromAggregate(a, validRange) {
  const env = a.runs >= 2 && !!a.lowerDb && !!a.upperDb;
  return { kind: 'aggregate', frequencies: a.frequencies, magnitudeDb: a.centreDb,
    validRange: validRange ?? null, lowerDb: env ? a.lowerDb : null,
    upperDb: env ? a.upperDb : null, dispersion: env ? a.dispersion : null, runs: a.runs,
    method: a.method };
}

function describe(r) {
  if (r.kind === 'transfer') return 'a single run';
  if (r.kind === 'aggregate-centre') return 'the aggregate centre of repeated runs';
  return `the ${r.method} of ${r.runs} run${r.runs === 1 ? '' : 's'}`;
}

/** A − B of two responses over the overlap of their valid ranges (see the header). */
export function responseDelta(a, b, { pointsPerOctave = 48 } = {}) {
  const ta = responseOf(a);
  const tb = responseOf(b);
  if (!ta || !tb) return { ok: false, reason: 'both experiments need a transfer result' };
  if (!(Number.isInteger(pointsPerOctave) && pointsPerOctave >= 1 && pointsPerOctave <= 384)) {
    throw new RangeError('pointsPerOctave must be an integer 1..384');
  }
  const ra = usableRange(ta);
  const rb = usableRange(tb);
  if (!ra || !rb) return { ok: false, reason: 'a transfer result has no usable frequency range' };
  const lo = Math.max(ra[0], rb[0]);
  const hi = Math.min(ra[1], rb[1]);
  if (!(hi > lo)) return { ok: false, reason: 'the valid frequency ranges do not overlap' };
  const n = Math.max(2, Math.ceil(Math.log2(hi / lo) * pointsPerOctave) + 1);
  const frequencies = new Float64Array(n);
  const aDb = new Float64Array(n);
  const bDb = new Float64Array(n);
  const deltaDb = new Float64Array(n);
  const step = Math.log(hi / lo) / (n - 1);
  for (let i = 0; i < n; i++) {
    const f = i === n - 1 ? hi : lo * Math.exp(step * i);
    frequencies[i] = f;
    aDb[i] = interpLogF(ta.frequencies, ta.magnitudeDb, f);
    bDb[i] = interpLogF(tb.frequencies, tb.magnitudeDb, f);
    deltaDb[i] = aDb[i] - bDb[i];
  }
  const warnings = [];
  const single = (r) => r.kind === 'transfer';
  let equivalent = single(ta) === single(tb);
  if (!equivalent) {
    warnings.push(`Not equivalent: ${describe(ta)} (A) compared with ${describe(tb)} (B); a `
      + 'single run includes run-to-run scatter that the aggregate averages out.');
  } else if (ta.kind === 'aggregate' && tb.kind === 'aggregate' && ta.method !== tb.method) {
    equivalent = false;
    warnings.push(`Not equivalent: aggregates of different methods (${ta.method} vs `
      + `${tb.method}).`);
  }
  let envelope = null;
  if (ta.lowerDb && tb.lowerDb) {
    const at = (r, k, f) => interpLogF(r.frequencies, r[k], f);
    const e = { aLowerDb: new Float64Array(n), aUpperDb: new Float64Array(n),
      bLowerDb: new Float64Array(n), bUpperDb: new Float64Array(n), overlap: new Uint8Array(n) };
    let count = 0;
    for (let i = 0; i < n; i++) {
      const f = frequencies[i];
      e.aLowerDb[i] = at(ta, 'lowerDb', f);
      e.aUpperDb[i] = at(ta, 'upperDb', f);
      e.bLowerDb[i] = at(tb, 'lowerDb', f);
      e.bUpperDb[i] = at(tb, 'upperDb', f);
      const hit = e.aLowerDb[i] <= e.bUpperDb[i] && e.bLowerDb[i] <= e.aUpperDb[i];
      e.overlap[i] = hit ? 1 : 0;
      if (hit) count += 1;
    }
    const comparable = ta.dispersion === tb.dispersion;
    if (!comparable) {
      warnings.push(`The envelopes use different dispersion measures (${ta.dispersion} vs `
        + `${tb.dispersion}); their overlap is not comparable.`);
    }
    envelope = { ...e, overlapFraction: count / n, dispersion: [ta.dispersion, tb.dispersion],
      comparable };
  }
  return {
    ok: true, frequencies, aDb, bDb, deltaDb, range: [lo, hi], pointsPerOctave,
    label: 'A − B, dB relative (raw magnitudes, log-frequency interpolation, not normalized)',
    sources: [ta.kind, tb.kind], equivalent, warnings, envelope,
  };
}

// The valid range clipped to the positive frequencies actually present.
function usableRange(t) {
  const f = t.frequencies;
  if (!f || f.length < 2 || !t.magnitudeDb || t.magnitudeDb.length !== f.length) return null;
  let first = 0;
  while (first < f.length && !(f[first] > 0)) first++;
  if (first >= f.length - 1) return null;
  const v = t.validRange || [f[first], f[f.length - 1]];
  const lo = Math.max(v[0], f[first]);
  const hi = Math.min(v[1], f[f.length - 1]);
  return hi > lo ? [lo, hi] : null;
}

// Linear interpolation of dB values over log(f); f is inside the positive data range.
function interpLogF(freqs, db, f) {
  let lo = 0;
  let hi = freqs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freqs[mid] <= f) lo = mid; else hi = mid;
  }
  const f0 = freqs[lo];
  const f1 = freqs[hi];
  if (f <= f0 || !(f0 > 0)) return f <= f0 ? db[lo] : db[hi];
  if (f >= f1) return db[hi];
  const t = Math.log(f / f0) / Math.log(f1 / f0);
  return db[lo] + (db[hi] - db[lo]) * t;
}
