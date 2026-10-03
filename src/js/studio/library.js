// Studio projects and patches: local save/load, file export/import, dirty state (spec §113-§115,
// §154-§160, §238-§239, §253-§255; plan issue V426). The only persistence is the EXISTING
// experiment store (experiments/store.js: IndexedDB with the Studio partition of DB version 2,
// or its memory store under file:// when IndexedDB is unavailable, §154). This module adds no
// database; it is pure apart from the injected store.
//
//   createStudioLibrary(store) -> library
//     library.persistent                         false on the memory store (say so in the UI)
//     saveProject(model, { id, now }) -> Promise<summary>      overwrites the project `id`
//     loadProject(id) -> Promise<{ model, warnings, migratedFrom, summary } | null>
//     savePatch(patch, { id, now, overwrite = false }) -> Promise<summary>
//       an existing patch is never silently overwritten (§155): ExperimentStoreError 'exists'
//     loadPatch(id) -> Promise<{ patch, warnings, migratedFrom, summary } | null>
//     list({ kind }) -> Promise<[summary]>  newest first;   remove(id) -> Promise<boolean>
//     Saving validates first ('invalid'); loading runs the full untrusted pipeline (migrate.js
//     importStudio, patches.js importPatch), so a corrupt or tampered record is 'corrupt',
//     never loaded. Records of the other kind are refused ('invalid' on save, 'corrupt' on load).
//   Files (§158): exportProjectFile(model) / exportPatchFile(patch) -> { name, type, text }
//     (`.oscilla-studio.json`, `.oscilla-patch.json`, pretty canonical JSON);
//     importStudioFile(text) -> { ok, kind: 'project' | 'patch', model | patch, warnings }
//     | { ok: false, errors } — recognises either file by its `kind`.
//   Dirty state (§156, §254): createDirtyTracker(baseline) -> { markSaved(model, info),
//     isDirty(model), status(model) }. Dirty = execution or presentation state differs from the
//     last explicit save (schema.js semanticState); pan, zoom, timeline scale and selection
//     never make a document dirty.
//
// Nothing leaves the browser: no network, no telemetry (§239); a file exists only when the
// user exports one.

import { canonicalJson } from '../experiments/canonical-json.js';
import { ExperimentStoreError } from '../experiments/store.js';
import { toIsoTimestamp } from '../experiments/schema.js';
import {
  STUDIO_FILE_EXTENSION, STUDIO_KIND, semanticState, serializeStudio, studioHash,
} from './schema.js';
import { STUDIO_IMPORT_LIMITS, validateStudioModel } from './validate.js';
import { importStudio } from './migrate.js';
import {
  PATCH_FILE_EXTENSION, PATCH_KIND, importPatch, patchHash, serializePatch,
} from './patches.js';

export const STUDIO_FILE_TYPE = 'application/json';

const invalid = (what, why) => new ExperimentStoreError('invalid', `${what} not saved: ${why}`);
const corrupt = (id, why) => new ExperimentStoreError('corrupt', `stored Studio record ${id} `
  + `cannot be loaded: ${why}`);
const firstMessage = (errors) => (errors && errors[0] ? errors[0].message : 'invalid');

/** The library over an experiment store (openExperimentStoreOrMemory().store). */
export function createStudioLibrary(store) {
  if (!store || typeof store.putStudio !== 'function') {
    throw new TypeError('createStudioLibrary: an experiment store with the Studio partition '
      + '(experiments/store.js DB_VERSION 2) is required');
  }

  async function read(id, kind) {
    const rec = await store.getStudio(id);
    if (!rec) return null;
    if (rec.kind !== kind) throw corrupt(id, `it is a ${rec.kind} record, not ${kind}`);
    const summary = { id: rec.id, kind: rec.kind, name: rec.name, savedAt: rec.savedAt,
      studioHash: rec.studioHash };
    return { rec, summary };
  }

  return Object.freeze({
    persistent: store.kind === 'indexeddb',

    async saveProject(model, { id, now } = {}) {
      const report = validateStudioModel(model);
      if (!report.ok) throw invalid('Studio project', firstMessage(report.errors));
      const existing = await store.getStudio(id).catch(() => null);
      if (existing && existing.kind !== STUDIO_KIND) {
        throw invalid('Studio project', `"${id}" is a ${existing.kind} record`);
      }
      const doc = JSON.parse(serializeStudio(model));
      const record = { id, kind: STUDIO_KIND, name: model.metadata.title,
        savedAt: toIsoTimestamp(now), studioHash: studioHash(model), doc };
      await store.putStudio(record);
      return { id, kind: STUDIO_KIND, name: record.name, savedAt: record.savedAt,
        studioHash: record.studioHash };
    },

    async loadProject(id) {
      const r = await read(id, STUDIO_KIND);
      if (!r) return null;
      const imported = importStudio(r.rec.doc);
      if (!imported.ok) throw corrupt(id, firstMessage(imported.errors));
      if (studioHash(imported.model) !== r.rec.studioHash) {
        throw corrupt(id, 'its content does not match its stored studioHash');
      }
      return { model: imported.model, warnings: imported.warnings,
        migratedFrom: imported.migratedFrom, summary: r.summary };
    },

    async savePatch(patch, { id, now, overwrite = false } = {}) {
      const checked = importPatch(patch);
      if (!checked.ok) throw invalid('Patch', firstMessage(checked.errors));
      const existing = await store.getStudio(id).catch(() => null);
      if (existing && existing.kind !== PATCH_KIND) {
        throw invalid('Patch', `"${id}" is a ${existing.kind} record`);
      }
      if (existing && !overwrite) {
        throw new ExperimentStoreError('exists', `A patch "${existing.name}" is already saved `
          + `as ${id}; save it under a new name or confirm replacing it.`);
      }
      const record = { id, kind: PATCH_KIND, name: checked.patch.name,
        savedAt: toIsoTimestamp(now), studioHash: patchHash(checked.patch),
        doc: checked.patch };
      await store.putStudio(record);
      return { id, kind: PATCH_KIND, name: record.name, savedAt: record.savedAt,
        studioHash: record.studioHash };
    },

    async loadPatch(id) {
      const r = await read(id, PATCH_KIND);
      if (!r) return null;
      const imported = importPatch(r.rec.doc);
      if (!imported.ok) throw corrupt(id, firstMessage(imported.errors));
      if (patchHash(imported.patch) !== r.rec.studioHash) {
        throw corrupt(id, 'its content does not match its stored studioHash');
      }
      return { patch: imported.patch, warnings: imported.warnings,
        migratedFrom: imported.migratedFrom, summary: r.summary };
    },

    list: ({ kind } = {}) => store.listStudio({ kind }),
    remove: (id) => store.deleteStudio(id),
  });
}

// ---------------------------------------------------------------- files (§158)

/** "Subtractive Synth" → "subtractive-synth" (letters, digits and dashes; "studio" if empty). */
export function fileSlug(title, fallback = 'studio') {
  const s = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return s || fallback;
}

/** The `.oscilla-studio.json` download of a project: { name, type, text }. */
export function exportProjectFile(model) {
  const report = validateStudioModel(model);
  if (!report.ok) throw new TypeError(`The project is invalid: ${firstMessage(report.errors)}`);
  return { name: `${fileSlug(model.metadata.title)}${STUDIO_FILE_EXTENSION}`,
    type: STUDIO_FILE_TYPE, text: `${serializeStudio(model, 2)}\n` };
}

/** The `.oscilla-patch.json` download of a patch: { name, type, text }. */
export function exportPatchFile(patch) {
  return { name: `${fileSlug(patch.name, 'patch')}${PATCH_FILE_EXTENSION}`,
    type: STUDIO_FILE_TYPE, text: `${serializePatch(patch, 2)}\n` };
}

/**
 * Import an untrusted Studio project or patch file (JSON text). The kind is read from the
 * parsed document only to choose the pipeline; each pipeline re-checks everything.
 */
export function importStudioFile(text) {
  let kind = null;
  if (typeof text === 'string') {
    if (text.length <= STUDIO_IMPORT_LIMITS.maxBytes) {
      try {
        const doc = JSON.parse(text);
        kind = doc && typeof doc === 'object' ? doc.kind : null;
      } catch (e) {
        kind = null; // importStudio reports the parse error
      }
    }
  } else if (text && typeof text === 'object') {
    kind = text.kind;
  }
  if (kind === PATCH_KIND) {
    const r = importPatch(text);
    return r.ok ? { ok: true, kind: 'patch', patch: r.patch, warnings: r.warnings,
      migratedFrom: r.migratedFrom } : r;
  }
  const r = importStudio(text);
  return r.ok ? { ok: true, kind: 'project', model: r.model, warnings: r.warnings,
    migratedFrom: r.migratedFrom } : r;
}

// ---------------------------------------------------------------- dirty state (§156, §254)

/**
 * Tracks whether the document differs from its last explicit save. `baseline` is the model as
 * loaded or created (a new document is clean until edited). Compares semantic state only
 * (execution + presentation); view changes never dirty it. Models are compared by their
 * canonical semantic text, cached per (frozen) model object.
 */
export function createDirtyTracker(baseline) {
  const cache = new WeakMap();
  const digest = (model) => {
    if (cache.has(model)) return cache.get(model);
    const d = canonicalJson(semanticState(model));
    cache.set(model, d);
    return d;
  };
  let saved = digest(baseline);
  let info = null;
  return Object.freeze({
    /** The model was explicitly saved (or exported) now. */
    markSaved(model, { id = null, savedAt = null, target = 'local' } = {}) {
      saved = digest(model);
      info = { id, savedAt, target };
    },
    isDirty: (model) => digest(model) !== saved,
    status: (model) => ({ dirty: digest(model) !== saved, lastSave: info }),
  });
}
