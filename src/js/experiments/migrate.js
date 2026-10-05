// Experiment schema migrations (spec §132, §226). Pure; no DOM, no globals.
//
// Registry: migrations[n] upgrades a document of schema n - 1 to schema n. Schema 1 is the
// first released experiment schema (V3.0), so `1` is an identity placeholder: no released file
// has schema 0, and a document claiming it is accepted only if it already has the schema-1
// shape (validate.js still checks everything after migration). Steps run in order; the result's
// schemaVersion is set to n after step n. Newer-than-supported versions are rejected with a
// clear message, never guessed at.
//
// 1 → 2 (ADR 0040): every measurement.runs entry gets its id 'run-<position + 1>' (schema.js
// runId), first among its fields; nothing else changes. Result hashes of versions 1 and 2 do
// not cover the measurement block, so a migrated record verifies under the hash it was stamped
// with (its provenance.resultHash and resultHashVersion are kept as they are).
//
// 2 → 3 (ADR 0043): every run gets `definition`, derived from its own recipe (definition.js
// derivedRef: derived: true — never presented as an authored definition). Result hashes of
// versions 1-3 do not cover it, so the stored hash and version are kept and still verify. A
// recipe a definition cannot be derived from is left without one, and validation names it.
//
//   migrateExperiment(json, { migrations, targetVersion }) ->
//     { ok: true, experiment, from, to, applied: [n, ...] }
//     | { ok: false, errors: [{ path, text }] }
// The input is never modified (steps receive a copy).

import { EXPERIMENT_SCHEMA_VERSION, withRunIds } from './schema.js';
import { derivedRef } from './definition.js';

/** Schema 1 → 2: run ids (the rest of the document is unchanged). */
function addRunIds(e) {
  const m = e.measurement;
  if (!m || typeof m !== 'object' || !Array.isArray(m.runs)) return e;
  return { ...e, measurement: { ...m, runs: withRunIds(m.runs) } };
}

/** Schema 2 → 3: the definition derived from the run's own recipe. */
function addDerivedDefinition(e) {
  if (Object.prototype.hasOwnProperty.call(e, 'definition')) {
    throw new Error('a schema-2 experiment has no definition field');
  }
  let definition;
  try {
    definition = derivedRef(e.recipe);
  } catch (err) {
    return e;
  }
  return { ...e, definition };
}

export const migrations = Object.freeze({
  1: (e) => e,
  2: addRunIds,
  3: addDerivedDefinition,
});

/** Upgrade a parsed experiment document to `targetVersion` (default: the current schema). */
export function migrateExperiment(json, opts = {}) {
  const registry = opts.migrations || migrations;
  const target = opts.targetVersion ?? EXPERIMENT_SCHEMA_VERSION;
  const fail = (text) => ({ ok: false, errors: [{ path: 'schemaVersion', text }] });
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: [{ path: '', text: 'not an experiment object' }] };
  }
  const from = json.schemaVersion;
  if (!Number.isSafeInteger(from) || from < 0) {
    return fail('missing or not a non-negative integer schema version');
  }
  if (from > target) {
    return fail(`experiment schema ${from} is newer than this OSCILLA supports (${target}); `
      + 'open it with a newer OSCILLA');
  }
  let doc = copy(json);
  const applied = [];
  for (let n = from + 1; n <= target; n++) {
    const step = Object.prototype.hasOwnProperty.call(registry, n) ? registry[n] : null;
    if (typeof step !== 'function') return fail(`no migration from schema ${n - 1} to ${n}`);
    let next;
    try {
      next = step(doc);
    } catch (err) {
      const why = String(err && err.message).slice(0, 200);
      return fail(`migration ${n - 1} → ${n} failed: ${why}`);
    }
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return fail(`migration ${n - 1} → ${n} did not return an object`);
    }
    doc = { ...next, schemaVersion: n };
    applied.push(n);
  }
  return { ok: true, experiment: doc, from, to: target, applied };
}

// A structural copy of parsed JSON (typed arrays are copied too).
function copy(v) {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return v.slice();
  if (Array.isArray(v)) return v.map(copy);
  const out = {};
  for (const k of Object.keys(v)) out[k] = copy(v[k]);
  return out;
}
