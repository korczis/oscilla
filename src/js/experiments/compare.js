// Experiment comparison (spec §59-§60, §105). Pure; no DOM, no globals.
//
//   compareExperiments(list) -> { common: { field: value }, differences: [{ field, values,
//     severity: 'info'|'warn' }], compatible, warnings: [text], sameConfiguration }
// Differences in calibration, sample rate, stimulus, analysis or algorithm versions are 'warn'
// and make the set incompatible (it may still be overlaid, with the warnings shown); name,
// versions of OSCILLA and of the schema, input device and repeats are 'info'.
//
//   responseDelta(a, b, { pointsPerOctave = 48 }) -> { ok: true, frequencies, aDb, bDb,
//     deltaDb, range: [fLo, fHi], pointsPerOctave, label } | { ok: false, reason }
// A − B of two TransferResults (or experiments carrying results.transfer) on a common
// log-spaced grid, interpolated linearly in dB over log-frequency, ONLY over the overlap of
// both valid ranges. Values are raw dB relative; nothing is normalized or offset.

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
  for (const kind of ['transfer', 'ir', 'rta']) {
    const ids = list.map((e) => e.results?.[kind]?.algorithm ?? null);
    if (ids.some((x) => x !== null)) add(`results.${kind}.algorithm`, ids, 'warn');
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

const transferOf = (x) => (x && x.results ? x.results.transfer : x);

/** A − B of two transfer magnitudes over the overlap of their valid ranges. */
export function responseDelta(a, b, { pointsPerOctave = 48 } = {}) {
  const ta = transferOf(a);
  const tb = transferOf(b);
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
  return {
    ok: true, frequencies, aDb, bDb, deltaDb, range: [lo, hi], pointsPerOctave,
    label: 'A − B, dB relative (raw magnitudes, log-frequency interpolation, not normalized)',
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
