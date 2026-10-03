// Studio templates (spec §194-§196, §256-§258; plan issue V423): canonical, versioned,
// validated product data — never built inside UI handlers. Pure; no DOM, no Web Audio.
//
// A template record:
//   { id, version, title, category: 'synthesis' | 'measurement',
//     learn: { summary, points: [text] }        short Learn text (§194), no textbook walls
//     studioHash                                 SHA-256 of the normalized model's execution
//                                                state (schema.js studioHash), pinned
//     model }                                    a schema-1 Studio document (may be partial;
//                                                normalizeStudio completes it)
// Provenance (§196): `version` is the template's own revision. Whatever changes the executed
// result — a node, a parameter, a connection, a clip, an automation point, or an engine default
// the normalized model inherits — changes the hash, and the unit test then fails until the
// template's version is raised and its pinned hash updated. Positions, names and Learn text do
// not enter the hash (they are presentation, §163) and need no version bump.
//
//   STUDIO_TEMPLATES                 every template, frozen, in library order
//   listTemplates() -> [{ id, version, title, category, learn }]
//   getTemplate(id) -> record | null
//   templateModel(id) -> a fresh normalized StudioModel (plain, unfrozen; the caller owns it)
//   validateTemplate(record) -> { ok, errors: [text], warnings: [Diagnostic], model }
//   templateProvenance(record) -> { templateId, templateVersion, studioHash }

import { deepFreeze } from '../actions.js';
import { normalizeStudio, studioHash } from '../schema.js';
import { validateStudioModel } from '../validate.js';
import { HEX64_PATTERN } from '../../experiments/schema.js';
import basicTone from './basic-tone.js';
import subtractiveSynth from './subtractive-synth.js';
import sweepSequence from './sweep-sequence.js';
import stereoBeat from './stereo-beat.js';
import filterAutomation from './filter-automation.js';
import measurementSweep from './measurement-sweep.js';

export const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
export const TEMPLATE_CATEGORIES = Object.freeze(['synthesis', 'measurement']);
/** Learn text bounds: a summary sentence and at most four short points (§194). */
export const LEARN_LIMITS = Object.freeze({ summaryChars: 200, points: 4, pointChars: 200 });

export const STUDIO_TEMPLATES = Object.freeze([basicTone, subtractiveSynth, sweepSequence,
  stereoBeat, filterAutomation, measurementSweep].map((t) => deepFreeze(t)));

/** The id of the §257 reference fixture (the Basic Synth of the specification). */
export const REFERENCE_TEMPLATE_ID = 'subtractive-synth';
/** The id of the §258 measurement template. */
export const MEASUREMENT_TEMPLATE_ID = 'measurement-sweep';

/** Library entries (no model). */
export function listTemplates() {
  return STUDIO_TEMPLATES.map((t) => ({ id: t.id, version: t.version, title: t.title,
    category: t.category, learn: t.learn }));
}

/** The template record with `id`, or null. */
export function getTemplate(id) {
  return STUDIO_TEMPLATES.find((t) => t.id === id) || null;
}

/** A fresh normalized model of the template (throws RangeError for an unknown id). */
export function templateModel(id) {
  const t = getTemplate(id);
  if (!t) throw new RangeError(`Unknown Studio template "${String(id)}".`);
  return normalizeStudio(t.model);
}

/** What an experiment or a saved project may record about the template it started from. */
export function templateProvenance(t) {
  return { templateId: t.id, templateVersion: t.version, studioHash: t.studioHash };
}

/**
 * Authoring check of a template record: fields, Learn bounds, a valid normalized model
 * (validateStudioModel) and the pinned hash. Never throws.
 */
export function validateTemplate(t) {
  const errors = [];
  const str = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
  if (!t || typeof t !== 'object') return { ok: false, errors: ['not a record'], warnings: [] };
  if (!TEMPLATE_ID_PATTERN.test(t.id || '')) errors.push('invalid id');
  if (!(Number.isInteger(t.version) && t.version >= 1)) errors.push('version must be >= 1');
  if (!str(t.title, 64)) errors.push('missing title');
  if (!TEMPLATE_CATEGORIES.includes(t.category)) errors.push('unknown category');
  const l = t.learn || {};
  if (!str(l.summary, LEARN_LIMITS.summaryChars)) errors.push('learn.summary missing or long');
  if (!Array.isArray(l.points) || l.points.length > LEARN_LIMITS.points
    || l.points.some((p) => !str(p, LEARN_LIMITS.pointChars))) {
    errors.push(`learn.points must be at most ${LEARN_LIMITS.points} short texts`);
  }
  if (typeof t.studioHash !== 'string' || !HEX64_PATTERN.test(t.studioHash)) {
    errors.push('studioHash must be a 64-digit hex SHA-256');
  }
  let model = null;
  let warnings = [];
  try {
    model = normalizeStudio(t.model);
  } catch (e) {
    errors.push(`model: ${e && e.message}`);
  }
  if (model) {
    const report = validateStudioModel(model);
    warnings = report.warnings;
    for (const d of report.errors) errors.push(`model: ${d.code}: ${d.message}`);
    if (model.metadata.title !== t.title) errors.push('model title differs from the title');
    const hash = studioHash(model);
    if (hash !== t.studioHash) {
      errors.push(`studioHash is ${hash}; the pinned value differs (raise the version)`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, model };
}
