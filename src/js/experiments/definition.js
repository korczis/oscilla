// Experiment definitions (ADR 0043): WHAT to measure and HOW, versioned, apart from the runs
// executed from it. Pure: plain data in, plain data out; no DOM, no clock, no randomness —
// callers pass `now` and `id`.
//
// DEFINITION (stored, store.js putDefinition) =
//   { kind: 'oscilla-definition', schemaVersion: 1, id, name, notes, createdAt,
//     versions: [{ version, hash, createdAt, execution }] }
//   execution  { recipe, conditions: { notes }, acceptance: { minimumQuality } }: the only
//              fields definitionHash covers. `name` and `notes` are metadata (the split of
//              ADR 0040): renaming never makes a new version.
//   recipe     a schema.js Recipe of the values the user ASKED for, at no particular rate
//              (stimulus.sampleRate null, no `requested`; setupRecipe). A run's own recipe
//              records the rate it ran at and any clamp to 0.95 × Nyquist.
//   conditions.notes   the conditions the user declares for every run (text or null)
//   acceptance.minimumQuality   the lowest quality.js verdict that meets the definition
//              (ACCEPTANCE_LEVELS) or null. It compares the stored verdict only; no threshold
//              of its own.
// Versions are append-only: an edit of an execution field appends version n + 1 with its hash
// (reviseDefinition); an edit that leaves the hash as it is appends nothing; a stored version
// never changes (store.js refuses it with 'immutable').
//
// RUN REFERENCE = experiment.definition (experiment schema 3) =
//   { id, version, hash, derived, execution }
// The run carries the execution it ran so that a file is checked on its own: validate.js
// recomputes the hash over `execution` and requires the run's recipe to be what that
// execution asks for (recipeMismatches). derived: true marks a definition derived from the
// run's own recipe (derivedRef): a run not started from an authored definition, or recorded
// before definitions existed (migrate.js 2 → 3). It is the recipe as PLAYED (no rate), so it
// is consistent with its run by construction, whatever `requested` the run records; its id is
// DERIVED_PREFIX + the first 32 hex digits of its hash, so equal recipes derive one definition.
// It was never authored and is never presented as one.
//
//   setupRecipe(recipe) -> Recipe            (a MEASURE setup recipe as a definition holds it)
//   buildExecution({ recipe, conditions, minimumQuality }) -> execution   (throws RangeError)
//   definitionHash(execution, { sha256Hex }) -> hex
//   createDefinition({ id, name, notes, now, execution }) -> Definition
//   reviseDefinition(def, execution, { now }) -> { definition, changed }
//   renameDefinition(def, { name, notes }) -> a copy, only metadata changed
//   latestVersion(def), definitionRef(def, version?) -> run reference (derived: false)
//   derivedRef(experimentRecipe) -> run reference (derived: true)
//   recipeMismatches(runRecipe, runReference) -> [path]   (empty: consistent)
//   storedMatch(ref, storedDefinition|null) -> 'derived'|'match'|'mismatch'|'absent'
//   acceptanceOf(execution, status) -> { met: true|false|null, text }
//   checkExecution / checkDefinitionRef / validateDefinition   (shared with validate.js, store)

import { canonicalJson } from './canonical-json.js';
import { sha256Hex as defaultSha256Hex } from '../calibration/sha256.js';
import {
  HEX64_PATTERN, ID_PATTERN, LIMITS, checkRecipe, createChecker, createRecipe, formatErrors,
  toIsoTimestamp,
} from './schema.js';
import {
  normalizeStimulus, safeMaxFrequency, SAMPLE_RATE_LIMITS,
} from '../measurement/stimulus.js';
import { MEASUREMENT_LEVELS } from '../measurement/engine.js';
import { QUALITY_STATUSES } from '../measurement/quality.js';

export const DEFINITION_KIND = 'oscilla-definition';
export const DEFINITION_SCHEMA_VERSION = 1;
export const DEFINITION_HASH_VERSION = 1;
export const DERIVED_PREFIX = 'derived-';
export const MAX_VERSIONS = 256;
/** Verdicts a definition may require, best first (an INVALID run meets nothing). */
export const ACCEPTANCE_LEVELS = Object.freeze(QUALITY_STATUSES.filter((s) => s !== 'INVALID'));

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const FREQUENCIES = ['f', 'f1', 'f2'];
/** Highest frequency any supported rate plays: a value above it is no definition's request. */
const TOP_HZ = safeMaxFrequency(SAMPLE_RATE_LIMITS[1]);
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * A setup recipe (measure-flow.js recipeFromFields: level 'low' | 'medium' | 'high' or a peak)
 * as a definition stores it: the stimulus normalized by stimulus.js with every field, the level
 * resolved, no rate. A frequency no supported rate can play is refused, never clamped.
 */
export function setupRecipe(recipe) {
  const r = recipe || {};
  const st = r.stimulus || {};
  const level = typeof st.level === 'string' ? MEASUREMENT_LEVELS[st.level] : st.level;
  let n;
  try {
    n = normalizeStimulus({ ...st, level, sampleRate: SAMPLE_RATE_LIMITS[1] });
  } catch (err) {
    throw new RangeError(`Invalid recipe: stimulus: ${err.message}`);
  }
  if (n.clampedTo !== null) {
    throw new RangeError(`Invalid recipe: a frequency is above ${TOP_HZ} Hz`);
  }
  return createRecipe({ stimulus: { ...n.spec, sampleRate: null }, repeats: r.repeats ?? 1,
    analysis: r.analysis ?? {} });
}

/** Check an execution block; returns its normalized copy or null (errors are in c.errors). */
export function checkExecution(c, v, path) {
  const n = c.errors.length;
  if (!c.keys(v, path, ['recipe', 'conditions', 'acceptance'])) return null;
  const rp = `${path}.recipe`;
  const recipe = checkRecipe(c, v.recipe, rp);
  if (recipe && recipe.stimulus.sampleRate !== null) {
    c.add(`${rp}.stimulus.sampleRate`, 'must be null (a definition is not bound to a rate)');
  }
  if (recipe && has(recipe, 'requested')) c.add(`${rp}.requested`, 'unknown field');
  const k = v.conditions;
  if (c.keys(k, `${path}.conditions`, ['notes'])) {
    c.str(k.notes, `${path}.conditions.notes`, LIMITS.notesChars,
      { nullable: true, multiline: true, min: 1 });
  }
  const a = v.acceptance;
  if (c.keys(a, `${path}.acceptance`, ['minimumQuality'])) {
    c.oneOf(a.minimumQuality, `${path}.acceptance.minimumQuality`, ACCEPTANCE_LEVELS,
      { nullable: true });
  }
  if (c.errors.length > n || !recipe) return null;
  return { recipe, conditions: { notes: k.notes }, acceptance: { minimumQuality:
    a.minimumQuality } };
}

/** An execution block from a definition recipe (setupRecipe form); throws RangeError. */
export function buildExecution({ recipe, conditions = null, minimumQuality = null } = {}) {
  const c = createChecker();
  const x = checkExecution(c, { recipe, conditions: { notes: text(conditions, LIMITS.notesChars) },
    acceptance: { minimumQuality } }, 'execution');
  if (!x) throw new RangeError(`Invalid definition: ${formatErrors(c.errors)}`);
  return x;
}

/** SHA-256 hex of the canonical JSON of { v: 1, recipe, conditions, acceptance }. */
export function definitionHash(execution, { sha256Hex = defaultSha256Hex } = {}) {
  return sha256Hex(canonicalJson({ v: DEFINITION_HASH_VERSION, ...execution }));
}

const versionOf = (version, execution, createdAt, opts) => ({ version,
  hash: definitionHash(execution, opts), createdAt, execution });

/** A new authored definition with version 1. */
export function createDefinition({ id, name = '', notes = null, now, execution } = {}) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || id.startsWith(DERIVED_PREFIX)) {
    throw new TypeError('createDefinition: id must be 1-128 [A-Za-z0-9._-], not "derived-…"');
  }
  const createdAt = toIsoTimestamp(now);
  return { kind: DEFINITION_KIND, schemaVersion: DEFINITION_SCHEMA_VERSION, id,
    name: text(name, LIMITS.nameChars) || '', notes: text(notes, LIMITS.notesChars), createdAt,
    versions: [versionOf(1, execution, createdAt)] };
}

export const latestVersion = (def) => def.versions[def.versions.length - 1];

/**
 * Edit: the definition with `execution` appended as the next version when its hash differs
 * from the latest version's ({ changed: true }); otherwise the same definition, unchanged.
 */
export function reviseDefinition(def, execution, { now } = {}) {
  const last = latestVersion(def);
  const next = versionOf(last.version + 1, execution, toIsoTimestamp(now));
  if (next.hash === last.hash) return { definition: def, changed: false };
  if (def.versions.length >= MAX_VERSIONS) {
    throw new RangeError(`a definition keeps at most ${MAX_VERSIONS} versions`);
  }
  return { definition: { ...def, versions: [...def.versions, next] }, changed: true };
}

/** Metadata only: `name` and `notes` ('' or null removes them); versions untouched. */
export function renameDefinition(def, { name, notes } = {}) {
  const out = { ...def };
  if (name !== undefined) out.name = text(name, LIMITS.nameChars) || '';
  if (notes !== undefined) out.notes = text(notes, LIMITS.notesChars);
  return out;
}

/** The run reference of `version` (default: the latest) of an authored definition. */
export function definitionRef(def, version = latestVersion(def).version) {
  const v = def.versions.find((x) => x.version === version);
  if (!v) throw new RangeError(`definition ${def.id} has no version ${version}`);
  return { id: def.id, version: v.version, hash: v.hash, derived: false, execution: v.execution };
}

/**
 * The definition derived from a run's own recipe (validated schema.js Recipe): the stimulus as
 * played, at no rate; repeats and analysis as they are. `requested` is not used: a recorded
 * request is the run's fact, and an earlier file may hold one that no rate explains.
 */
export function derivedRef(recipe, opts) {
  const execution = buildExecution({ recipe: { stimulus: { ...recipe.stimulus, sampleRate: null },
    repeats: recipe.repeats, analysis: recipe.analysis } });
  const hash = definitionHash(execution, opts);
  return { id: `${DERIVED_PREFIX}${hash.slice(0, 32)}`, version: 1, hash, derived: true,
    execution };
}

/**
 * Paths at which a run's recipe is NOT what a definition recipe asks for: repeats and analysis
 * equal; every stimulus field but the rate equal. For an authored definition a frequency may be
 * lowered to 0.95 × Nyquist of the run's rate exactly as stimulus.js clamps it, and a playable
 * frequency the run records as requested must be the definition's. A derived definition is the
 * played recipe, so only equality applies (`requested` is not checked).
 */
export function recipeMismatches(run, ref) {
  const def = ref.execution.recipe;
  const derived = ref.derived === true;
  const out = [];
  if (run.repeats !== def.repeats) out.push('recipe.repeats');
  if (canonicalJson(run.analysis) !== canonicalJson(def.analysis)) out.push('recipe.analysis');
  const a = run.stimulus;
  const b = def.stimulus;
  const sr = a.sampleRate;
  for (const k of Object.keys(b)) {
    if (k === 'sampleRate') continue;
    let ok = a[k] === b[k];
    if (!derived && FREQUENCIES.includes(k) && typeof b[k] === 'number') {
      ok = a[k] === (sr ? Math.min(b[k], safeMaxFrequency(sr)) : b[k]);
      const r = run.requested ? run.requested[k] : null;
      if (typeof r === 'number' && r <= TOP_HZ && r !== b[k]) ok = false;
    }
    if (!ok) out.push(`recipe.stimulus.${k}`);
  }
  return out;
}

/**
 * Is a run reference (or a list row's { id, version, hash, derived }) a version of the stored
 * definition? 'match' only when that definition has that version with that hash; 'mismatch'
 * when it has the id but not that version and hash (an imported run of another definition that
 * shares the id, or an altered one); 'absent' when nothing is stored; 'derived' for a derived
 * reference. Only 'match' may borrow the stored name or the words "the same definition".
 */
export function storedMatch(ref, stored) {
  if (!ref || ref.derived) return 'derived';
  if (!stored || stored.id !== ref.id) return 'absent';
  const v = stored.versions[ref.version - 1];
  return v && v.version === ref.version && v.hash === ref.hash ? 'match' : 'mismatch';
}

/** Does a stored verdict meet the definition's minimum? (null: no criterion or no verdict) */
export function acceptanceOf(execution, status) {
  const min = execution ? execution.acceptance.minimumQuality : null;
  if (!min) return { met: null, text: 'no acceptance criterion' };
  if (!QUALITY_STATUSES.includes(status)) {
    return { met: null, text: `verdict ${min} or better required; not assessed` };
  }
  const met = QUALITY_STATUSES.indexOf(status) <= QUALITY_STATUSES.indexOf(min);
  return { met, text: `verdict ${min} or better required: ${met ? 'met' : 'NOT met'} (${
    status})` };
}

/**
 * Check a run reference (experiment.definition): shape, the hash recomputed over `execution`
 * (a mismatch is 'corrupt'), and a derived id that is the hash's ('derived-' is reserved).
 */
export function checkDefinitionRef(c, v, path, opts = {}) {
  const n = c.errors.length;
  if (!c.keys(v, path, ['id', 'version', 'hash', 'derived', 'execution'])) return null;
  c.str(v.id, `${path}.id`, LIMITS.idChars, { pattern: ID_PATTERN });
  c.num(v.version, `${path}.version`, 1, MAX_VERSIONS, { integer: true });
  c.str(v.hash, `${path}.hash`, 64, { pattern: HEX64_PATTERN });
  c.bool(v.derived, `${path}.derived`);
  const execution = checkExecution(c, v.execution, `${path}.execution`);
  if (c.errors.length > n || !execution) return null;
  if (definitionHash(execution, opts) !== v.hash) {
    c.add(`${path}.hash`, 'corrupt: the definition does not match its hash', 'corrupt');
    return null;
  }
  const own = `${DERIVED_PREFIX}${v.hash.slice(0, 32)}`;
  if (v.derived && (v.id !== own || v.version !== 1)) {
    c.add(`${path}.id`, `a derived definition is "${own}" version 1`);
  } else if (!v.derived && v.id.startsWith(DERIVED_PREFIX)) {
    c.add(`${path}.id`, `"${DERIVED_PREFIX}" is reserved for derived definitions`);
  }
  return c.errors.length > n ? null : { id: v.id, version: v.version, hash: v.hash,
    derived: v.derived, execution };
}

/** Validate a stored definition (untrusted plain data): { ok, definition } | { ok, errors }. */
export function validateDefinition(v, opts = {}) {
  const c = createChecker(20);
  const keys = ['kind', 'schemaVersion', 'id', 'name', 'notes', 'createdAt', 'versions'];
  if (c.keys(v, '', keys)) {
    c.oneOf(v.kind, 'kind', [DEFINITION_KIND]);
    c.oneOf(v.schemaVersion, 'schemaVersion', [DEFINITION_SCHEMA_VERSION]);
    if (c.str(v.id, 'id', LIMITS.idChars, { pattern: ID_PATTERN })
      && v.id.startsWith(DERIVED_PREFIX)) c.add('id', 'a stored definition is authored');
    c.str(v.name, 'name', LIMITS.nameChars);
    c.str(v.notes, 'notes', LIMITS.notesChars, { nullable: true, multiline: true, min: 1 });
    c.iso(v.createdAt, 'createdAt');
    if (!Array.isArray(v.versions) || !v.versions.length || v.versions.length > MAX_VERSIONS) {
      c.add('versions', `must hold 1-${MAX_VERSIONS} versions`);
    } else {
      v.versions.forEach((x, i) => {
        const p = `versions[${i}]`;
        if (!c.keys(x, p, ['version', 'hash', 'createdAt', 'execution'])) return;
        if (x.version !== i + 1) c.add(`${p}.version`, `must be ${i + 1}`);
        c.iso(x.createdAt, `${p}.createdAt`);
        checkDefinitionRef(c, { id: v.id, version: i + 1, hash: x.hash, derived: false,
          execution: x.execution }, p, opts);
      });
    }
  }
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, definition: JSON.parse(JSON.stringify(v)) };
}
