// Studio schema migrations and the import pipeline (spec §11, §159-§160, §237). Pure; never evals,
// never throws on bad input, no DOM, no globals.
//
// Registry: studioMigrations[n] upgrades a document of schema n - 1 to schema n. Schema 1 is the
// first Studio schema (V3.1), so `1` is an identity placeholder: no released file has schema 0.
// A schema 2 adds `2: (doc) => ({ ...doc, ... })`. The stepping, the copy of the input and the
// "newer than supported" refusal are experiments/migrate.js migrateExperiment, reused with this
// registry and target (one migration engine for every persisted format, ADR 0023).
//
// Pipeline (§160), the only place version numbers are looked at — never the UI:
//   parse      size cap before JSON.parse; JSON text or an already parsed object
//   validate   version-independent safety scan BEFORE any migration code runs: plain data
//              only, no prototype keys, finite numbers, bounded size and depth; kind check
//   migrate    stepwise n-1 → n through the registry
//   validate   strict current-schema check and import limits (validate.js validateStudioImport)
//   normalize  defaults filled, canonical shapes (schema.js normalizeStudio, inside the above)
// The schema check cannot run before migration because a schema-1 validator cannot judge a
// schema-0 shape; the safety scan can, so untrusted data never reaches a migration step unchecked.
//
//   migrateStudio(doc, { migrations, targetVersion }) ->
//     { ok: true, doc, from, to, applied } | { ok: false, errors: [{ path, text }] }
//   importStudio(input, { limits, migrations, targetVersion, registry }) ->
//     { ok: true, model, warnings, migratedFrom: n | null } | { ok: false, errors, warnings }

import { migrateExperiment } from '../experiments/migrate.js';
import { scanUntrusted, utf8Length } from '../experiments/validate.js';
import { STUDIO_KIND, STUDIO_SCHEMA_VERSION } from './schema.js';
import { STUDIO_IMPORT_LIMITS, validateStudioImport } from './validate.js';

export const studioMigrations = Object.freeze({
  1: (doc) => doc,
});

const retext = (t) => t.replace(/^experiment schema/, 'Studio schema')
  .replace('not an experiment object', 'not a Studio object');

/** Upgrade a parsed Studio document to `targetVersion` (default: the current schema). */
export function migrateStudio(doc, opts = {}) {
  const r = migrateExperiment(doc, {
    migrations: opts.migrations || studioMigrations,
    targetVersion: opts.targetVersion ?? STUDIO_SCHEMA_VERSION,
  });
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => ({ ...e, text: retext(e.text) })) };
  return { ok: true, doc: r.experiment, from: r.from, to: r.to, applied: r.applied };
}

/** The full parse → validate → migrate → validate/normalize pipeline for untrusted input. */
export function importStudio(input, opts = {}) {
  const limits = { ...STUDIO_IMPORT_LIMITS, ...(opts.limits || {}) };
  const fail = (path, message, code = 'invalid-structure') => ({ ok: false, warnings: [],
    errors: [{ code, severity: 'error', message, path }] });
  let doc = input;
  if (typeof input === 'string') {
    if (utf8Length(input, limits.maxBytes) > limits.maxBytes) {
      return fail('', `The file is larger than the ${limits.maxBytes}-byte import limit.`,
        'limit-exceeded');
    }
    try {
      doc = JSON.parse(input);
    } catch (err) {
      return fail('', `Not valid JSON (${String(err && err.message).slice(0, 120)}).`);
    }
  }
  const scan = scanUntrusted(doc, { maxBytes: typeof input === 'string' ? Infinity
    : limits.maxBytes, maxErrors: limits.maxErrors });
  if (scan.length) {
    return { ok: false, warnings: [], errors: scan.map((e) => ({ code: 'invalid-structure',
      severity: 'error', message: e.text, path: e.path })) };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return fail('', 'The file does not contain a Studio object.');
  }
  if (doc.kind !== STUDIO_KIND) {
    return fail('kind', doc.kind === 'oscilla-experiment'
      ? 'This is an OSCILLA experiment file, not a Studio file.'
      : `kind must be "${STUDIO_KIND}".`);
  }
  const migrated = migrateStudio(doc, opts);
  if (!migrated.ok) {
    return { ok: false, warnings: [], errors: migrated.errors.map((e) => ({
      code: 'unsupported-version', severity: 'error', message: e.text, path: e.path })) };
  }
  const result = validateStudioImport(migrated.doc, limits, { registry: opts.registry });
  if (!result.ok) return result;
  return { ok: true, model: result.model, warnings: result.warnings,
    migratedFrom: migrated.applied.length ? migrated.from : null };
}
