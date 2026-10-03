// Import validation for experiment files (spec §58, §144-§145). The input is untrusted: JSON
// text or an already parsed object. Pure; never evals, never throws, no DOM, no globals.
//
//   validateExperiment(json, { maxBytes = 32 MiB, maxArray = 4_000_000, knownAlgorithms,
//     migrations, maxErrors = 50, sha256Hex }) ->
//     { ok: true, experiment, migratedFrom: n|null }
//     | { ok: false, errors: [{ path, text, code? }] }
//
// Pipeline: size cap (before JSON.parse) -> structural scan (depth, plain objects only, no
// `__proto__` / `constructor` / `prototype` keys, finite numbers) -> schema migration
// (migrate.js) -> strict schema check (unknown fields rejected, types, numeric bounds, string
// caps, algorithm IDs, calibration shape, array dtypes and declared vs decoded lengths). The
// returned experiment is a normalized deep copy with result arrays decoded to typed arrays;
// nothing of the input object is reused or modified. Optional fields keep their presence (a
// field absent in the input is absent in the output), so a validated experiment re-exports
// byte for byte.
//
// Accepted result shapes are exactly what the analysis modules produce: TransferResult
// (validRange may be null; optional phaseReason and alignment), IrResult (optional method and
// fftSize; method must match the IR algorithm ID; optional truncation { maxSamples, fullLength,
// startIndex } of an IR capped by analysis-task.js capIrLength), RtaResult (rta.js rtaResult:
// optional windowAlgorithm; zero power is stored as −300 dB, non-finite levels are rejected),
// AggregateResult (aggregate.js aggregateResult, the optional `results.aggregate`: dispersion
// consistent with method and runs, envelope arrays and repeatabilityDb null for one run,
// lowerDb ≤ centreDb ≤ upperDb, spreadDb ≥ 0) and QualityAssessment (quality.js: reasons with
// optional scope, optional mask { frequencies f64, reliable u8, calibrated u8 }).
// `results.aggregate` is optional and keeps its presence: files written before it existed
// validate, hash and re-export unchanged.
//
// Repeated measurements (G20, aggregate.js "Storage rule"): with an aggregate of ≥ 2 runs,
// results.transfer is null or the aggregate centre marked derivedFrom: 'aggregate' — on the
// aggregate's grid, magnitudeDb bit-identical to centreDb, phaseDeg null, alignment null — and
// never one run's transfer; a derivedFrom transfer without such an aggregate is rejected. The
// optional results.runTransfers ([{ run, transfer }], at most LIMITS.runTransfers entries, run
// indices strictly increasing and below aggregate.runs, each an ordinary TransferResult on the
// aggregate grid) holds individual runs when they were asked for; it needs such an aggregate.
//
// Result hash (spec §101): when provenance.resultHash is a hash, it is recomputed (hash.js
// resultHash) over the decoded results; a mismatch is the error
// { path: 'provenance.resultHash', code: 'corrupt' }. opts.sha256Hex may inject SHA-256.
//
// knownAlgorithms: the allowed algorithm IDs (array, Set or an object such as ALGORITHMS whose
// values are IDs). Without it only the ID format (oscilla.<name>.v<n>) is checked. For imports
// pass algorithms.js KNOWN_ALGORITHM_IDS (current and retained IDs): ALGORITHMS alone names only
// the current defaults and would reject a stored 'oscilla.confidence.v1' assessment.

import {
  ALGORITHM_ID_PATTERN, CALIBRATION_SCHEMA_VERSION, COMMIT_PATTERN, EXPERIMENT_KIND,
  EXPERIMENT_SCHEMA_VERSION, FORBIDDEN_KEYS, HEX64_PATTERN, ID_PATTERN, LIMITS, VERSION_PATTERN,
  checkRecipe, createChecker,
} from './schema.js';
import { DTYPES, decodeArray, dtypeOf, isEncodedArray } from './encode.js';
import { migrateExperiment } from './migrate.js';
import { resultHash } from './hash.js';
import { PHASE_REASONS } from '../measurement/transfer.js';
import {
  IR_ALGORITHMS, IR_ALGORITHMS_V1, IR_NOISE_FLOOR_METHODS,
} from '../measurement/impulse-response.js';
import { AGGREGATE_DISPERSION, DERIVED_FROM_AGGREGATE } from '../measurement/aggregate.js';

export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_ARRAY = 4_000_000;
const MAX_DEPTH = 32;
const TOP_KEYS = ['kind', 'schemaVersion', 'oscillaVersion', 'oscillaCommit', 'experimentId',
  'name', 'recipe', 'output', 'input', 'calibration', 'environment', 'measurement', 'quality',
  'algorithms', 'results', 'provenance'];
const ROLE_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/;
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const STATUSES = ['GOOD', 'USABLE', 'POOR', 'INVALID'];
const SEVERITIES = ['ok', 'warn', 'fail'];
const SCOPES = ['quality', 'calibration'];
const BIG = Number.MAX_VALUE;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Validate an untrusted experiment document. Never throws. */
export function validateExperiment(json, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxArray = opts.maxArray ?? DEFAULT_MAX_ARRAY;
  const maxErrors = opts.maxErrors ?? 50;
  const fail = (path, text) => ({ ok: false, errors: [{ path, text }] });
  let doc = json;
  let measured = false;
  if (typeof json === 'string') {
    if (utf8Length(json, maxBytes) > maxBytes) {
      return fail('', `the file is larger than the ${maxBytes}-byte import limit`);
    }
    try {
      doc = JSON.parse(json);
    } catch (err) {
      return fail('', `not valid JSON (${String(err && err.message).slice(0, 120)})`);
    }
    measured = true;
  }
  const scan = scanUntrusted(doc, { maxBytes: measured ? Infinity : maxBytes, maxErrors });
  if (scan.length) return { ok: false, errors: scan };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return fail('', 'the file does not contain an experiment object');
  }
  if (doc.kind !== EXPERIMENT_KIND) {
    return fail('kind', doc.kind === 'oscilla-config'
      ? 'this is an OSCILLA configuration file, not an experiment'
      : `must be "${EXPERIMENT_KIND}"`);
  }
  let migrated;
  try {
    migrated = migrateExperiment(doc, { migrations: opts.migrations });
  } catch (err) {
    return fail('schemaVersion', `migration failed: ${String(err && err.message).slice(0, 120)}`);
  }
  if (!migrated.ok) return { ok: false, errors: migrated.errors };
  const c = createChecker(maxErrors);
  const ctx = { maxArray, known: knownSet(opts.knownAlgorithms), sha256Hex: opts.sha256Hex };
  let experiment;
  try {
    experiment = checkExperiment(c, migrated.experiment, ctx);
  } catch (err) {
    return fail('', `the experiment could not be checked (${String(err && err.message)
      .slice(0, 120)})`);
  }
  if (c.errors.length || !experiment) {
    return { ok: false, errors: c.errors.length ? c.errors : [{ path: '', text: 'invalid' }] };
  }
  return { ok: true, experiment, migratedFrom: migrated.applied.length ? migrated.from : null };
}

/** UTF-8 byte length of a string, stopping early once it exceeds `stopAbove`. */
export function utf8Length(s, stopAbove = Infinity) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      n += d >= 0xdc00 && d <= 0xdfff ? 4 : 3;
    } else n += 3;
    if (n > stopAbove) return n;
  }
  return n;
}

function knownSet(k) {
  if (k == null) return null;
  if (k instanceof Set) return k;
  if (Array.isArray(k)) return new Set(k);
  if (typeof k === 'object') return new Set(Object.values(k));
  return null;
}

/**
 * Structural safety pass over arbitrary input: plain objects/arrays/primitives (and f32/f64/u8
 * typed arrays) only, depth <= 32, no forbidden keys, finite numbers, an approximate size
 * bound for already parsed objects. Returns errors (empty when acceptable).
 */
export function scanUntrusted(root, { maxBytes = Infinity, maxErrors = 50 } = {}) {
  const errors = [];
  let bytes = 0;
  const add = (path, text) => errors.length < maxErrors && errors.push({ path, text });
  const walk = (v, path, depth) => {
    if (errors.length >= maxErrors || bytes > maxBytes) return;
    if (v === null || typeof v === 'boolean') {
      bytes += 5;
      return;
    }
    if (typeof v === 'number') {
      bytes += 8;
      if (!Number.isFinite(v)) add(path, `must be a finite number (got ${v})`);
      return;
    }
    if (typeof v === 'string') {
      bytes += v.length + 2;
      return;
    }
    if (typeof v !== 'object') {
      add(path, `${typeof v} is not JSON data`);
      return;
    }
    if (depth > MAX_DEPTH) {
      add(path, `nested deeper than ${MAX_DEPTH} levels`);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      if (!dtypeOf(v)) add(path, 'unsupported typed array');
      bytes += Math.ceil(v.byteLength / 3) * 4;
      return;
    }
    if (Array.isArray(v)) {
      bytes += 2;
      for (let i = 0; i < v.length; i++) walk(v[i], `${path}[${i}]`, depth + 1);
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      add(path || '(root)', 'is not a plain JSON object');
      return;
    }
    for (const k of Object.keys(v)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.includes(k)) {
        add(p, 'forbidden field name');
        continue;
      }
      bytes += k.length + 4;
      walk(v[k], p, depth + 1);
    }
  };
  walk(root, '', 0);
  if (bytes > maxBytes) add('', `the data is larger than the ${maxBytes}-byte import limit`);
  return errors;
}

// ---------------------------------------------------------------- strict schema

function checkExperiment(c, e, ctx) {
  if (!c.keys(e, '', TOP_KEYS)) return null;
  c.oneOf(e.kind, 'kind', [EXPERIMENT_KIND]);
  c.num(e.schemaVersion, 'schemaVersion', EXPERIMENT_SCHEMA_VERSION, EXPERIMENT_SCHEMA_VERSION,
    { integer: true });
  c.str(e.oscillaVersion, 'oscillaVersion', 64, { nullable: true, pattern: VERSION_PATTERN });
  c.str(e.oscillaCommit, 'oscillaCommit', 40, { nullable: true, pattern: COMMIT_PATTERN });
  c.str(e.experimentId, 'experimentId', LIMITS.idChars, { pattern: ID_PATTERN });
  c.str(e.name, 'name', LIMITS.nameChars);
  const out = {
    kind: e.kind,
    schemaVersion: e.schemaVersion,
    oscillaVersion: e.oscillaVersion,
    oscillaCommit: e.oscillaCommit,
    experimentId: e.experimentId,
    name: e.name,
    recipe: checkRecipe(c, e.recipe, 'recipe'),
    output: null,
    input: checkInput(c, e.input, 'input'),
    calibration: checkCalibration(c, e.calibration, 'calibration'),
    environment: null,
    measurement: checkMeasurement(c, e.measurement, 'measurement'),
    quality: e.quality === null ? null : checkQuality(c, e.quality, 'quality', ctx),
    algorithms: checkAlgorithms(c, e.algorithms, 'algorithms', ctx),
    results: checkResults(c, e.results, 'results', ctx),
    provenance: checkProvenance(c, e.provenance, 'provenance'),
  };
  if (c.keys(e.output, 'output', ['level'])) {
    c.num(e.output.level, 'output.level', ...LIMITS.levelDigital, { nullable: true });
    out.output = { level: e.output.level };
  }
  if (c.keys(e.environment, 'environment', ['notes'])) {
    c.str(e.environment.notes, 'environment.notes', LIMITS.notesChars,
      { nullable: true, multiline: true });
    out.environment = { notes: e.environment.notes };
  }
  if (!c.errors.length && out.provenance && typeof out.provenance.resultHash === 'string') {
    const opts = ctx.sha256Hex ? { sha256Hex: ctx.sha256Hex } : undefined;
    const actual = resultHash(out, opts);
    if (actual !== out.provenance.resultHash) {
      c.add('provenance.resultHash', 'corrupt: the results do not match their stored hash '
        + `(stored ${out.provenance.resultHash.slice(0, 12)}…, computed ${actual.slice(0, 12)}…)`,
      'corrupt');
    }
  }
  return c.errors.length ? null : out;
}

function algorithmId(c, v, path, ctx) {
  if (!c.str(v, path, 128, { pattern: ALGORITHM_ID_PATTERN })) return false;
  if (ctx.known && !ctx.known.has(v)) return c.add(path, `unknown algorithm "${v}"`);
  return true;
}

function checkInput(c, v, path) {
  if (!c.keys(v, path, ['device', 'constraints'])) return null;
  const out = { device: null, constraints: null };
  if (c.keys(v.device, `${path}.device`, ['label', 'id'])) {
    c.str(v.device.label, `${path}.device.label`, LIMITS.labelChars, { nullable: true });
    c.str(v.device.id, `${path}.device.id`, LIMITS.labelChars, { nullable: true });
    out.device = { label: v.device.label, id: v.device.id };
  }
  const k = v.constraints;
  if (c.keys(k, `${path}.constraints`, ['requested', 'applied'])) {
    const lim = { depth: 3, keys: 64, array: 32, string: 256 };
    const copy = (x, p) => {
      if (x === null) return null;
      if (!c.obj(x, p)) return null;
      return c.json(x, p, lim) ?? null;
    };
    out.constraints = {
      requested: copy(k.requested, `${path}.constraints.requested`),
      applied: copy(k.applied, `${path}.constraints.applied`),
    };
  }
  return out;
}

function checkCalibration(c, v, path) {
  if (!c.keys(v, path, ['frequency', 'level'])) return null;
  const out = { frequency: null, level: null };
  const f = v.frequency;
  if (f !== null && c.keys(f, `${path}.frequency`, ['id', 'name'])) {
    c.str(f.id, `${path}.frequency.id`, 64, { pattern: HEX64_PATTERN });
    c.str(f.name, `${path}.frequency.name`, LIMITS.nameChars);
    out.frequency = { id: f.id, name: f.name };
  }
  const l = v.level;
  const p = `${path}.level`;
  if (l !== null && c.keys(l, p, ['schemaVersion', 'kind', 'referenceHz', 'referenceDbSpl',
    'observedDbRelative', 'offsetDb', 'conditions', 'createdAt'])) {
    c.num(l.schemaVersion, `${p}.schemaVersion`, CALIBRATION_SCHEMA_VERSION,
      CALIBRATION_SCHEMA_VERSION, { integer: true });
    c.oneOf(l.kind, `${p}.kind`, ['level']);
    c.num(l.referenceHz, `${p}.referenceHz`, 10, 24000);
    c.num(l.referenceDbSpl, `${p}.referenceDbSpl`, 0, 200);
    c.num(l.observedDbRelative, `${p}.observedDbRelative`, -LIMITS.dbAbs, LIMITS.dbAbs);
    c.num(l.offsetDb, `${p}.offsetDb`, -LIMITS.dbAbs, LIMITS.dbAbs);
    c.str(l.conditions, `${p}.conditions`, LIMITS.textChars, { nullable: true, multiline: true });
    c.iso(l.createdAt, `${p}.createdAt`, { nullable: true });
    out.level = { ...l };
  }
  return out;
}

function checkMeasurement(c, v, path) {
  if (!c.keys(v, path, ['startedAt', 'sampleRate', 'runs'])) return null;
  c.iso(v.startedAt, `${path}.startedAt`, { nullable: true });
  c.num(v.sampleRate, `${path}.sampleRate`, ...LIMITS.sampleRate, { nullable: true });
  const runs = [];
  if (!Array.isArray(v.runs)) c.add(`${path}.runs`, 'must be an array');
  else if (v.runs.length > LIMITS.runs) c.add(`${path}.runs`, `more than ${LIMITS.runs} runs`);
  else {
    v.runs.forEach((r, i) => {
      const p = `${path}.runs[${i}]`;
      if (c.obj(r, p)) runs.push(c.json(r, p, { depth: 3, keys: 64, array: 64, string: 500 }));
    });
  }
  return { startedAt: v.startedAt, sampleRate: v.sampleRate, runs };
}

function checkQuality(c, q, path, ctx) {
  if (!c.keys(q, path, ['algorithm', 'status', 'reasons', 'metrics'], ['mask'])) return null;
  algorithmId(c, q.algorithm, `${path}.algorithm`, ctx);
  c.oneOf(q.status, `${path}.status`, STATUSES);
  const reasons = [];
  if (!Array.isArray(q.reasons)) c.add(`${path}.reasons`, 'must be an array');
  else if (q.reasons.length > LIMITS.qualityReasons) {
    c.add(`${path}.reasons`, `more than ${LIMITS.qualityReasons} reasons`);
  } else {
    q.reasons.forEach((r, i) => {
      const p = `${path}.reasons[${i}]`;
      if (!c.keys(r, p, ['code', 'severity', 'text', 'value', 'unit'], ['scope', 'range'])) return;
      c.str(r.code, `${p}.code`, 64, { pattern: CODE_PATTERN });
      if (has(r, 'scope')) c.oneOf(r.scope, `${p}.scope`, SCOPES);
      c.oneOf(r.severity, `${p}.severity`, SEVERITIES);
      c.str(r.text, `${p}.text`, 500);
      const val = r.value;
      if (typeof val === 'string') c.str(val, `${p}.value`, 200);
      else if (typeof val === 'number') c.num(val, `${p}.value`, -BIG, BIG);
      else if (val !== null && typeof val !== 'boolean') {
        c.add(`${p}.value`, 'must be a number, string, boolean or null');
      }
      c.str(r.unit, `${p}.unit`, 32, { nullable: true });
      const reason = { code: r.code };
      if (has(r, 'scope')) reason.scope = r.scope;
      Object.assign(reason, { severity: r.severity, text: r.text, value: r.value, unit: r.unit });
      if (r.range !== undefined) {
        c.range(r.range, `${p}.range`, -BIG, BIG, { strict: false });
        reason.range = Array.isArray(r.range) ? [r.range[0], r.range[1]] : null;
      }
      reasons.push(reason);
    });
  }
  let metrics = null;
  if (c.obj(q.metrics, `${path}.metrics`)) {
    // 1024 elements: the reliable/unreliable range lists of a 48-point-per-octave grid over the
    // widest band (13 octaves, 625 points) have at most 313 runs each.
    metrics = c.json(q.metrics, `${path}.metrics`,
      { depth: 3, keys: 64, array: 1024, string: 200 });
  }
  const out = { algorithm: q.algorithm, status: q.status, reasons, metrics };
  if (has(q, 'mask')) out.mask = checkMask(c, q.mask, `${path}.mask`, ctx);
  return out;
}

/** quality.js mask: { frequencies f64, reliable u8, calibrated u8 } on one grid. */
function checkMask(c, m, path, ctx) {
  if (!c.keys(m, path, ['frequencies', 'reliable', 'calibrated'])) return null;
  const frequencies = resultArray(c, m.frequencies, `${path}.frequencies`, 'f64', ctx,
    { lo: 0, hi: LIMITS.frequencyHz[1], increasing: true });
  if (!frequencies) return null;
  const n = frequencies.length;
  const flags = (k) => resultArray(c, m[k], `${path}.${k}`, 'u8', ctx,
    { length: n, lo: 0, hi: 1 });
  return { frequencies, reliable: flags('reliable'), calibrated: flags('calibrated') };
}

function checkAlgorithms(c, a, path, ctx) {
  if (!c.obj(a, path)) return null;
  const keys = Object.keys(a);
  if (keys.length > LIMITS.algorithmRoles) {
    c.add(path, `more than ${LIMITS.algorithmRoles} entries`);
    return null;
  }
  const out = {};
  for (const k of keys) {
    if (!ROLE_PATTERN.test(k)) c.add(`${path}.${k}`, 'invalid role name');
    else if (algorithmId(c, a[k], `${path}.${k}`, ctx)) out[k] = a[k];
  }
  return out;
}

function checkResults(c, r, path, ctx) {
  if (!c.keys(r, path, ['transfer', 'ir', 'rta'], ['aggregate', 'runTransfers'])) return null;
  const out = {
    transfer: r.transfer === null ? null : checkTransfer(c, r.transfer, `${path}.transfer`, ctx,
      { derived: true }),
    ir: r.ir === null ? null : checkIr(c, r.ir, `${path}.ir`, ctx),
    rta: r.rta === null ? null : checkRta(c, r.rta, `${path}.rta`, ctx),
  };
  if (has(r, 'aggregate')) {
    out.aggregate = r.aggregate === null ? null
      : checkAggregate(c, r.aggregate, `${path}.aggregate`, ctx);
  }
  const agg = out.aggregate || null;
  const repeated = !!agg && agg.runs >= 2;
  const onGrid = (t) => t.frequencies.length === agg.frequencies.length
    && t.frequencies.every((f, i) => f === agg.frequencies[i]);
  // G20: the transfer of a repeated measurement is the marked aggregate centre or null.
  const t = out.transfer;
  if (t && has(t, 'derivedFrom')) {
    if (!repeated) {
      c.add(`${path}.transfer.derivedFrom`, 'needs results.aggregate of at least two runs');
    } else if (!onGrid(t)) {
      c.add(`${path}.transfer.frequencies`, 'must equal results.aggregate.frequencies');
    } else if (t.magnitudeDb && agg.centreDb) {
      const bad = t.magnitudeDb.findIndex((v, i) => v !== agg.centreDb[i]);
      if (bad >= 0) {
        c.add(`${path}.transfer.magnitudeDb[${bad}]`, 'must equal results.aggregate.centreDb '
          + '(derivedFrom "aggregate")');
      }
    }
    if (t.phaseDeg) c.add(`${path}.transfer.phaseDeg`, 'must be null for the aggregate '
      + 'centre (phases of separate runs are not averaged)');
    if (has(t, 'alignment') && t.alignment !== null) {
      c.add(`${path}.transfer.alignment`, 'must be null for the aggregate centre');
    }
  } else if (t && repeated) {
    c.add(`${path}.transfer`, `a repeated measurement (${agg.runs} runs) stores the aggregate `
      + 'centre (derivedFrom "aggregate") or null here; one run\'s transfer belongs in '
      + 'results.runTransfers');
  }
  if (has(r, 'runTransfers')) {
    const list = checkRunTransfers(c, r.runTransfers, `${path}.runTransfers`, ctx, agg);
    if (list !== undefined) out.runTransfers = list;
    if (list && !repeated) {
      c.add(`${path}.runTransfers`, 'needs results.aggregate of at least two runs');
    } else if (list) {
      list.forEach((x, i) => {
        if (x.transfer && !onGrid(x.transfer)) {
          c.add(`${path}.runTransfers[${i}].transfer.frequencies`,
            'must equal results.aggregate.frequencies');
        }
      });
    }
  }
  return out;
}

/** results.runTransfers: [{ run, transfer }] of individual runs of a repeated measurement. */
function checkRunTransfers(c, list, path, ctx, agg) {
  if (!Array.isArray(list)) {
    c.add(path, 'must be an array of { run, transfer }');
    return undefined;
  }
  if (list.length < 1 || list.length > LIMITS.runTransfers) {
    c.add(path, `must hold 1-${LIMITS.runTransfers} run transfers`);
    return undefined;
  }
  const runs = agg && agg.runs >= 2 ? agg.runs : LIMITS.runs;
  const out = [];
  let prev = -1;
  list.forEach((x, i) => {
    const p = `${path}[${i}]`;
    if (!c.keys(x, p, ['run', 'transfer'])) return;
    if (c.num(x.run, `${p}.run`, 0, runs - 1, { integer: true }) && !(x.run > prev)) {
      c.add(`${p}.run`, 'run indices must be strictly increasing');
    }
    if (typeof x.run === 'number') prev = x.run;
    if (!c.obj(x.transfer, `${p}.transfer`)) return;
    if (has(x.transfer, 'derivedFrom')) {
      c.add(`${p}.transfer.derivedFrom`, 'a run transfer is one run, never derived');
      return;
    }
    out.push({ run: x.run, transfer: checkTransfer(c, x.transfer, `${p}.transfer`, ctx) });
  });
  return out;
}

/** aggregate.js aggregateResult(): the stored envelope of repeated runs (G16). */
function checkAggregate(c, a, path, ctx) {
  const keys = ['algorithm', 'method', 'dispersion', 'runs', 'frequencies', 'centreDb',
    'lowerDb', 'upperDb', 'spreadDb', 'repeatabilityDb'];
  if (!c.keys(a, path, keys)) return null;
  algorithmId(c, a.algorithm, `${path}.algorithm`, ctx);
  const okMethod = c.oneOf(a.method, `${path}.method`, Object.keys(AGGREGATE_DISPERSION));
  if (!c.num(a.runs, `${path}.runs`, 1, LIMITS.runs, { integer: true }) || !okMethod) return null;
  const single = a.runs === 1;
  const dispersion = single ? null : AGGREGATE_DISPERSION[a.method];
  if (a.dispersion !== dispersion) {
    c.add(`${path}.dispersion`, single ? 'must be null for one run'
      : `must be "${dispersion}" for method "${a.method}"`);
  }
  const db = LIMITS.dbAbs;
  const frequencies = resultArray(c, a.frequencies, `${path}.frequencies`, 'f64', ctx,
    { lo: 0, hi: LIMITS.frequencyHz[1], increasing: true, minLength: 1 });
  if (!frequencies) return null;
  const n = frequencies.length;
  const centreDb = resultArray(c, a.centreDb, `${path}.centreDb`, 'f64', ctx,
    { length: n, lo: -db, hi: db });
  const envelope = (k, lo) => {
    if (!single) return resultArray(c, a[k], `${path}.${k}`, 'f64', ctx, { length: n, lo, hi: db });
    if (a[k] !== null) c.add(`${path}.${k}`, 'must be null for one run');
    return null;
  };
  const lowerDb = envelope('lowerDb', -db);
  const upperDb = envelope('upperDb', -db);
  const spreadDb = envelope('spreadDb', 0);
  if (single) {
    if (a.repeatabilityDb !== null) c.add(`${path}.repeatabilityDb`, 'must be null for one run');
  } else {
    c.num(a.repeatabilityDb, `${path}.repeatabilityDb`, 0, db, { nullable: true });
  }
  if (centreDb && lowerDb && upperDb) {
    const bad = centreDb.findIndex((v, i) => !(lowerDb[i] <= v && v <= upperDb[i]));
    if (bad >= 0) c.add(`${path}.centreDb[${bad}]`, 'must lie between lowerDb and upperDb');
  }
  return {
    algorithm: a.algorithm, method: a.method, dispersion: a.dispersion, runs: a.runs,
    frequencies, centreDb, lowerDb, upperDb, spreadDb, repeatabilityDb: a.repeatabilityDb,
  };
}

/**
 * Decode one result array: an EncodedArray of `dtype`, a plain number array (small vectors,
 * <= LIMITS.plainArray elements) or a typed array of `dtype`. Returns a new typed array, null
 * for an accepted null, or undefined when rejected.
 */
function resultArray(c, v, path, dtype, ctx, o = {}) {
  if (v === null && o.nullable) return null;
  let out;
  if (isEncodedArray(v)) {
    try {
      out = decodeArray(v, { dtype, maxLength: ctx.maxArray });
    } catch (err) {
      c.add(path, err.message);
      return undefined;
    }
  } else if (Array.isArray(v)) {
    const cap = Math.min(LIMITS.plainArray, ctx.maxArray);
    if (v.length > cap) {
      c.add(path, `plain array longer than ${cap} elements (use the encoded form)`);
      return undefined;
    }
    const bad = v.findIndex((x) => typeof x !== 'number');
    if (bad >= 0) {
      c.add(`${path}[${bad}]`, 'must be a number');
      return undefined;
    }
    out = new DTYPES[dtype].ctor(v);
  } else if (ArrayBuffer.isView(v) && dtypeOf(v) === dtype) {
    if (v.length > ctx.maxArray) {
      c.add(path, `length ${v.length} exceeds the limit of ${ctx.maxArray} elements`);
      return undefined;
    }
    out = v.slice();
  } else {
    c.add(path, `must be an encoded ${dtype} array { dtype, length, encoding, data }`);
    return undefined;
  }
  if (o.length !== undefined && out.length !== o.length) {
    c.add(path, `has ${out.length} elements; expected ${o.length}`);
    return undefined;
  }
  if (o.minLength && out.length < o.minLength) {
    c.add(path, 'must not be empty');
    return undefined;
  }
  const lo = o.lo ?? -BIG;
  const hi = o.hi ?? BIG;
  for (let i = 0; i < out.length; i++) {
    const x = out[i];
    if (!Number.isFinite(x)) {
      c.add(`${path}[${i}]`, `must be a finite number (got ${x})`);
      return undefined;
    }
    if (x < lo || x > hi) {
      c.add(`${path}[${i}]`, `must be between ${lo} and ${hi}`);
      return undefined;
    }
    if (o.increasing && i > 0 && !(x > out[i - 1])) {
      c.add(`${path}[${i}]`, 'frequencies must be strictly increasing');
      return undefined;
    }
  }
  return out;
}

function checkTransfer(c, t, path, ctx, { derived = false } = {}) {
  const keys = ['algorithm', 'sampleRate', 'frequencies', 'magnitudeDb', 'phaseDeg', 'snrDb',
    'validRange', 'requestedRange', 'fftSize', 'binHz'];
  // transfer.v2 adds snrPooledDb, snrResolutionHz and resolutionHz (transfer.js header).
  const v2 = ['snrPooledDb', 'snrResolutionHz', 'resolutionHz'];
  const optional = derived ? ['phaseReason', 'alignment', 'derivedFrom', ...v2]
    : ['phaseReason', 'alignment', ...v2];
  if (!c.keys(t, path, keys, optional)) return null;
  if (derived && has(t, 'derivedFrom')) {
    c.oneOf(t.derivedFrom, `${path}.derivedFrom`, [DERIVED_FROM_AGGREGATE]);
  }
  algorithmId(c, t.algorithm, `${path}.algorithm`, ctx);
  if (!c.num(t.sampleRate, `${path}.sampleRate`, ...LIMITS.sampleRate)) return null;
  const nyq = t.sampleRate / 2;
  c.num(t.fftSize, `${path}.fftSize`, 1, 2 ** 25, { integer: true, nullable: true });
  c.num(t.binHz, `${path}.binHz`, 0, nyq, { nullable: true });
  // null: no grid point qualified (transfer.js); quality.js then reports NO_VALID_RANGE.
  c.range(t.validRange, `${path}.validRange`, 0, nyq, { nullable: true });
  if (has(t, 'phaseReason')) {
    c.oneOf(t.phaseReason, `${path}.phaseReason`, Object.values(PHASE_REASONS),
      { nullable: true });
  }
  let alignment;
  if (has(t, 'alignment')) alignment = checkAlignment(c, t.alignment, `${path}.alignment`, ctx);
  c.range(t.requestedRange, `${path}.requestedRange`, 0, LIMITS.frequencyHz[1]);
  const db = LIMITS.dbAbs;
  const frequencies = resultArray(c, t.frequencies, `${path}.frequencies`, 'f64', ctx,
    { lo: 0, hi: nyq, increasing: true, minLength: 1 });
  if (!frequencies) return null;
  const n = frequencies.length;
  const magnitudeDb = resultArray(c, t.magnitudeDb, `${path}.magnitudeDb`, 'f64', ctx,
    { length: n, lo: -db, hi: db });
  const phaseDeg = resultArray(c, t.phaseDeg, `${path}.phaseDeg`, 'f64', ctx,
    { length: n, lo: -1e7, hi: 1e7, nullable: true });
  const snrDb = resultArray(c, t.snrDb, `${path}.snrDb`, 'f64', ctx,
    { length: n, lo: -db, hi: db, nullable: true });
  // Key order follows transfer.js (the re-export is byte-identical).
  const out = {
    algorithm: t.algorithm, sampleRate: t.sampleRate, frequencies, magnitudeDb, phaseDeg, snrDb,
  };
  if (has(t, 'snrPooledDb')) {
    out.snrPooledDb = resultArray(c, t.snrPooledDb, `${path}.snrPooledDb`, 'f64', ctx,
      { length: n, lo: -db, hi: db, nullable: true });
  }
  if (has(t, 'snrResolutionHz')) {
    c.num(t.snrResolutionHz, `${path}.snrResolutionHz`, 0, nyq, { nullable: true });
    out.snrResolutionHz = t.snrResolutionHz;
  }
  Object.assign(out, { validRange: pair(t.validRange), requestedRange: pair(t.requestedRange),
    fftSize: t.fftSize, binHz: t.binHz });
  if (has(t, 'resolutionHz')) {
    c.num(t.resolutionHz, `${path}.resolutionHz`, 0, nyq, { nullable: true });
    out.resolutionHz = t.resolutionHz;
  }
  if (has(t, 'phaseReason')) out.phaseReason = t.phaseReason;
  if (has(t, 'alignment')) out.alignment = alignment;
  if (derived && has(t, 'derivedFrom')) out.derivedFrom = t.derivedFrom;
  return out;
}

/** transfer.js alignment summary { algorithm, lagSamples, peakCorrelation, polarity } | null. */
function checkAlignment(c, a, path, ctx) {
  if (a === null) return null;
  if (!c.keys(a, path, ['algorithm', 'lagSamples', 'peakCorrelation', 'polarity'])) return null;
  if (a.algorithm !== null) algorithmId(c, a.algorithm, `${path}.algorithm`, ctx);
  c.num(a.lagSamples, `${path}.lagSamples`, -1e9, 1e9, { nullable: true });
  c.num(a.peakCorrelation, `${path}.peakCorrelation`, 0, 1);
  c.oneOf(a.polarity, `${path}.polarity`, [1, -1], { nullable: true });
  return { algorithm: a.algorithm, lagSamples: a.lagSamples, peakCorrelation: a.peakCorrelation,
    polarity: a.polarity };
}

function checkIr(c, ir, path, ctx) {
  const keys = ['algorithm', 'sampleRate', 'samples', 'peakIndex', 'peakTimeS', 'captureOffsetS',
    'noiseFloorDb', 'window'];
  // ir.*.v2 adds noiseFloorMethod (impulse-response.js IR_NOISE_FLOOR_METHODS); a capped IR
  // records truncation (analysis memory cap).
  if (!c.keys(ir, path, keys, ['method', 'fftSize', 'truncation', 'noiseFloorMethod'])) return null;
  if (has(ir, 'noiseFloorMethod')) {
    c.oneOf(ir.noiseFloorMethod, `${path}.noiseFloorMethod`, IR_NOISE_FLOOR_METHODS);
  }
  algorithmId(c, ir.algorithm, `${path}.algorithm`, ctx);
  const irIds = [...Object.values(IR_ALGORITHMS), ...Object.values(IR_ALGORITHMS_V1)];
  if (has(ir, 'method') && c.oneOf(ir.method, `${path}.method`, Object.keys(IR_ALGORITHMS))
    && irIds.includes(ir.algorithm)
    && IR_ALGORITHMS[ir.method] !== ir.algorithm && IR_ALGORITHMS_V1[ir.method] !== ir.algorithm) {
    c.add(`${path}.method`, `does not match algorithm "${ir.algorithm}"`);
  }
  if (has(ir, 'fftSize')) {
    c.num(ir.fftSize, `${path}.fftSize`, 1, 2 ** 25, { integer: true, nullable: true });
  }
  c.num(ir.sampleRate, `${path}.sampleRate`, ...LIMITS.sampleRate);
  const samples = resultArray(c, ir.samples, `${path}.samples`, 'f32', ctx,
    { lo: -1e9, hi: 1e9, minLength: 1 });
  if (!samples) return null;
  c.num(ir.peakIndex, `${path}.peakIndex`, 0, samples.length - 1, { integer: true });
  c.num(ir.peakTimeS, `${path}.peakTimeS`, 0, LIMITS.timeS);
  c.num(ir.captureOffsetS, `${path}.captureOffsetS`, -LIMITS.timeS, LIMITS.timeS);
  c.num(ir.noiseFloorDb, `${path}.noiseFloorDb`, -LIMITS.dbAbs, LIMITS.dbAbs, { nullable: true });
  c.range(ir.window, `${path}.window`, -LIMITS.timeS, LIMITS.timeS, { nullable: true });
  const truncation = has(ir, 'truncation')
    ? checkIrTruncation(c, ir.truncation, `${path}.truncation`, samples.length) : undefined;
  const out = { algorithm: ir.algorithm };
  if (has(ir, 'method')) out.method = ir.method;
  Object.assign(out, {
    sampleRate: ir.sampleRate, samples, peakIndex: ir.peakIndex,
    peakTimeS: ir.peakTimeS, captureOffsetS: ir.captureOffsetS, noiseFloorDb: ir.noiseFloorDb,
  });
  if (has(ir, 'noiseFloorMethod')) out.noiseFloorMethod = ir.noiseFloorMethod;
  out.window = ir.window === null ? null : pair(ir.window);
  if (has(ir, 'fftSize')) out.fftSize = ir.fftSize;
  if (truncation) out.truncation = truncation;
  return out;
}

// The stored IR is the window [startIndex, startIndex + length) of a longer causal IR.
function checkIrTruncation(c, t, path, length) {
  if (!c.keys(t, path, ['maxSamples', 'fullLength', 'startIndex'])) return undefined;
  const okMax = c.num(t.maxSamples, `${path}.maxSamples`, length, length, { integer: true });
  const okFull = c.num(t.fullLength, `${path}.fullLength`, length + 1, Number.MAX_SAFE_INTEGER,
    { integer: true });
  const okStart = okFull && c.num(t.startIndex, `${path}.startIndex`, 0, t.fullLength - length,
    { integer: true });
  if (!okMax || !okFull || !okStart) return undefined;
  return { maxSamples: t.maxSamples, fullLength: t.fullLength, startIndex: t.startIndex };
}

function checkRta(c, r, path, ctx) {
  if (!c.keys(r, path, ['algorithm', 'sampleRate', 'resolution', 'bands', 'levelsDb', 'fftSize'],
    ['windowAlgorithm'])) {
    return null;
  }
  algorithmId(c, r.algorithm, `${path}.algorithm`, ctx);
  if (has(r, 'windowAlgorithm') && r.windowAlgorithm !== null) {
    algorithmId(c, r.windowAlgorithm, `${path}.windowAlgorithm`, ctx);
  }
  c.num(r.sampleRate, `${path}.sampleRate`, ...LIMITS.sampleRate);
  c.oneOf(r.resolution, `${path}.resolution`, ['octave', 'third']);
  c.num(r.fftSize, `${path}.fftSize`, 1, 2 ** 25, { integer: true, nullable: true });
  if (!Array.isArray(r.bands) || r.bands.length > 200) {
    c.add(`${path}.bands`, 'must be an array of at most 200 bands');
    return null;
  }
  const bands = [];
  const fMax = LIMITS.frequencyHz[1];
  r.bands.forEach((b, i) => {
    const p = `${path}.bands[${i}]`;
    if (!c.keys(b, p, ['nominal', 'exact', 'lo', 'hi'])) return;
    const ok = ['nominal', 'exact', 'lo', 'hi'].map((k) => c.num(b[k], `${p}.${k}`, 0, fMax))
      .every(Boolean);
    if (ok && !(b.lo > 0 && b.lo <= b.exact && b.exact <= b.hi && b.lo < b.hi)) {
      c.add(p, 'needs 0 < lo <= exact <= hi');
    }
    bands.push({ nominal: b.nominal, exact: b.exact, lo: b.lo, hi: b.hi });
  });
  const levelsDb = resultArray(c, r.levelsDb, `${path}.levelsDb`, 'f64', ctx,
    { length: r.bands.length, lo: -LIMITS.dbAbs, hi: LIMITS.dbAbs });
  const out = {
    algorithm: r.algorithm, sampleRate: r.sampleRate, resolution: r.resolution, bands, levelsDb,
    fftSize: r.fftSize,
  };
  if (has(r, 'windowAlgorithm')) out.windowAlgorithm = r.windowAlgorithm;
  return out;
}

function checkProvenance(c, p, path) {
  if (!c.keys(p, path, ['configHash', 'createdAt', 'repeatOf', 'build'], ['resultHash'])) {
    return null;
  }
  c.str(p.configHash, `${path}.configHash`, 64, { nullable: true, pattern: HEX64_PATTERN });
  if (has(p, 'resultHash')) {
    c.str(p.resultHash, `${path}.resultHash`, 64, { nullable: true, pattern: HEX64_PATTERN });
  }
  c.iso(p.createdAt, `${path}.createdAt`);
  c.str(p.repeatOf, `${path}.repeatOf`, LIMITS.idChars, { nullable: true, pattern: ID_PATTERN });
  let build = null;
  const b = p.build;
  const bp = `${path}.build`;
  if (b !== null && c.keys(b, bp, ['version', 'commit', 'shortCommit', 'sourceDate', 'channel',
    'dirty', 'repository'])) {
    c.str(b.version, `${bp}.version`, 64, { nullable: true, pattern: VERSION_PATTERN });
    c.str(b.commit, `${bp}.commit`, 40, { nullable: true, pattern: COMMIT_PATTERN });
    c.str(b.shortCommit, `${bp}.shortCommit`, 40, { nullable: true, pattern: COMMIT_PATTERN });
    if (b.commit && b.shortCommit && !b.commit.startsWith(b.shortCommit)) {
      c.add(`${bp}.shortCommit`, 'does not match commit');
    }
    c.str(b.sourceDate, `${bp}.sourceDate`, 64, { nullable: true, pattern: /^[0-9][0-9TZ:.+-]*$/ });
    c.str(b.channel, `${bp}.channel`, 32, { nullable: true, pattern: /^[A-Za-z0-9._-]+$/ });
    c.bool(b.dirty, `${bp}.dirty`, { nullable: true });
    c.str(b.repository, `${bp}.repository`, LIMITS.labelChars, { nullable: true });
    build = { ...b };
  }
  const out = { configHash: p.configHash };
  if (has(p, 'resultHash')) out.resultHash = p.resultHash;
  return Object.assign(out, { createdAt: p.createdAt, repeatOf: p.repeatOf, build });
}

const pair = (v) => (Array.isArray(v) ? [v[0], v[1]] : null);
