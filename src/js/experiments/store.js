// Experiment storage (spec §54-§55, §88, §175, §225-§227). One of the three non-pure modules
// of docs/v3/architecture.md: it talks to IndexedDB, which is injected (never read from a
// global here), so it is testable and the caller decides what to do under file://.
//
//   openExperimentStore({ indexedDB, name, storage, knownAlgorithms }) -> Promise<Store>
//   createMemoryStore({ knownAlgorithms }) -> Store        (same API, nothing persists)
//   openExperimentStoreOrMemory(opts) -> Promise<{ store, persistent, error }>
//   Store = { kind: 'indexeddb'|'memory', list(), get(id), put(experiment), delete(id),
//             estimate(), close(),
//             listStudio({ kind }), getStudio(id), putStudio(record), deleteStudio(id) }
//
// Records are stored in the portable file form (schema.serializeExperiment: EncodedArray
// result arrays), validated (validate.js) on put and again on get, so a corrupt record is
// reported rather than rendered. list() reads a small summary store, not the results.
// Deletion happens only through delete(id): the upgrade function creates stores and never
// removes data (§225). Every failure rejects with an ExperimentStoreError whose `code` is
//   'unavailable' (no IndexedDB, open failed or blocked), 'quota' (QuotaExceededError),
//   'invalid' (put of an experiment that fails validation), 'corrupt' (stored record fails
//   validation), 'failed' (any other storage error).
// The app keeps working without persistence (§227): openExperimentStoreOrMemory falls back to
// the memory store and says so.
//
// Studio partition (V3.1 spec §154, §225-§226; plan issue V426): Studio projects
// ('oscilla-studio') and patches ('oscilla-patch') live in the SAME database, in two object
// stores added by the version 2 upgrade — STUDIO_RECORDS (keyPath 'id') and STUDIO_SUMMARIES
// (the list() rows). No second persistence layer. A Studio record is
//   { id, kind, name, savedAt, studioHash, doc }   doc: the canonical project or patch JSON
// The store checks only the envelope (id, kind, bounded size, plain data, doc.kind = kind) and
// stores it as given; content validation (parse → validate → normalize → migrate) belongs to
// the Studio layer (src/js/studio/library.js), which also decodes every record it reads, so a
// corrupt record is reported, never loaded. This module imports nothing from studio/.

import { serializeExperiment, formatErrors } from './schema.js';
import { validateExperiment } from './validate.js';

export const DB_NAME = 'oscilla-experiments';
/** Version 1: experiments; version 2 adds the Studio partition (never deletes anything). */
export const DB_VERSION = 2;
export const RECORDS = 'experiments';
export const SUMMARIES = 'summaries';
export const STUDIO_RECORDS = 'studio';
export const STUDIO_SUMMARIES = 'studioSummaries';
/** Kinds of Studio records (studio/schema.js STUDIO_KIND, studio/patches.js PATCH_KIND). */
export const STUDIO_RECORD_KINDS = Object.freeze(['oscilla-studio', 'oscilla-patch']);
/** Largest stored Studio document (JSON characters): twice the 4 MiB Studio import limit. */
export const STUDIO_RECORD_MAX_CHARS = 8 * 1024 * 1024;

export class ExperimentStoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'ExperimentStoreError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const isQuota = (err) => !!err && (err.name === 'QuotaExceededError' || err.code === 22
  || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/** Map a storage error to an ExperimentStoreError. */
export function storeError(err, what) {
  if (err instanceof ExperimentStoreError) return err;
  if (isQuota(err)) {
    return new ExperimentStoreError('quota', `${what}: browser storage is full; export or `
      + 'delete experiments to free space (the current result is kept in memory)', err);
  }
  const detail = err && (err.message || err.name) ? `: ${err.message || err.name}` : '';
  return new ExperimentStoreError('failed', `${what} failed${detail}`, err);
}

/**
 * Version upgrade (DB_VERSION 2). From 0 (empty) it creates every object store; from 1 it adds
 * the two Studio stores next to the experiments. It never deletes a store or a record, and
 * each step is guarded by objectStoreNames, so a partial earlier upgrade completes.
 */
export function upgradeExperimentDb(db, oldVersion) {
  const ensure = (name, keyPath) => {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
  };
  if (oldVersion < 1) {
    ensure(RECORDS, 'experimentId');
    ensure(SUMMARIES, 'experimentId');
  }
  if (oldVersion < 2) {
    ensure(STUDIO_RECORDS, 'id');
    ensure(STUDIO_SUMMARIES, 'id');
  }
}

// ---------------------------------------------------------------- Studio records (envelope)

const STUDIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** null when `rec` is a well-formed Studio record envelope, else the reason. */
export function studioRecordProblem(rec) {
  if (!isPlain(rec)) return 'a Studio record must be an object';
  if (typeof rec.id !== 'string' || !STUDIO_ID.test(rec.id)) return 'invalid id';
  if (!STUDIO_RECORD_KINDS.includes(rec.kind)) {
    return `kind must be one of ${STUDIO_RECORD_KINDS.join(', ')}`;
  }
  if (typeof rec.name !== 'string' || rec.name.length > 200
    || /[\u0000-\u001f\u007f]/.test(rec.name)) return 'invalid name';
  if (typeof rec.savedAt !== 'string' || !ISO.test(rec.savedAt)
    || !Number.isFinite(Date.parse(rec.savedAt))) return 'savedAt must be an ISO timestamp';
  if (rec.studioHash !== null && !(typeof rec.studioHash === 'string'
    && HEX64.test(rec.studioHash))) return 'studioHash must be a SHA-256 or null';
  if (!isPlain(rec.doc)) return 'doc must be an object';
  if (rec.doc.kind !== rec.kind) return 'doc.kind differs from the record kind';
  return null;
}

/** The list row of a Studio record. */
export function studioSummaryRecord(rec, sizeBytes) {
  return { id: rec.id, kind: rec.kind, name: rec.name, savedAt: rec.savedAt,
    studioHash: rec.studioHash, sizeBytes };
}

// Envelope check + JSON copy for writing: { value, summary }.
function prepareStudio(rec) {
  const why = studioRecordProblem(rec);
  if (why) throw new ExperimentStoreError('invalid', `Studio record not stored: ${why}`);
  let json;
  try {
    json = JSON.stringify(rec.doc);
  } catch (err) {
    throw new ExperimentStoreError('invalid', `Studio record cannot be serialized: ${
      err.message}`);
  }
  if (json.length > STUDIO_RECORD_MAX_CHARS) {
    throw new ExperimentStoreError('invalid', 'Studio record not stored: the document is larger '
      + `than ${STUDIO_RECORD_MAX_CHARS} characters`);
  }
  const value = { id: rec.id, kind: rec.kind, name: rec.name, savedAt: rec.savedAt,
    studioHash: rec.studioHash, doc: JSON.parse(json) };
  return { value, summary: studioSummaryRecord(rec, json.length) };
}

function decodeStudio(value, id) {
  const why = studioRecordProblem(value);
  if (why) {
    throw new ExperimentStoreError('corrupt', `stored Studio record ${id} is invalid: ${why}`);
  }
  return JSON.parse(JSON.stringify(value));
}

const studioNewest = (a, b) => String(b.savedAt).localeCompare(String(a.savedAt))
  || String(a.id).localeCompare(String(b.id));
const ofKind = (kind) => (s) => kind == null || s.kind === kind;

/** The list() entry of a serialized experiment. */
export function summaryRecord(doc, sizeBytes) {
  return {
    experimentId: doc.experimentId,
    name: doc.name,
    createdAt: doc.provenance ? doc.provenance.createdAt : null,
    schemaVersion: doc.schemaVersion,
    oscillaVersion: doc.oscillaVersion,
    status: doc.quality ? doc.quality.status : null,
    sizeBytes,
  };
}

// Serialize + validate for writing: { doc, json, summary }.
function prepare(experiment, knownAlgorithms) {
  let doc;
  let json;
  try {
    doc = serializeExperiment(experiment);
    json = JSON.stringify(doc);
  } catch (err) {
    throw new ExperimentStoreError('invalid', `experiment cannot be serialized: ${err.message}`);
  }
  const v = validateExperiment(json, { knownAlgorithms });
  if (!v.ok) {
    throw new ExperimentStoreError('invalid', `experiment not stored: ${formatErrors(v.errors)}`);
  }
  return { doc, summary: summaryRecord(doc, json.length) };
}

function decodeStored(doc, knownAlgorithms, id) {
  const v = validateExperiment(doc, { knownAlgorithms });
  if (!v.ok) {
    throw new ExperimentStoreError('corrupt', `stored experiment ${id} is invalid: `
      + `${formatErrors(v.errors.slice(0, 5))}`);
  }
  return v.experiment;
}

const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  || String(a.experimentId).localeCompare(String(b.experimentId));

/** In-memory store with the IndexedDB store's API (file:// fallback, tests). */
export function createMemoryStore({ knownAlgorithms } = {}) {
  const records = new Map();
  const summaries = new Map();
  const studio = new Map();
  const studioSummaries = new Map();
  const wrap = (what, fn) => {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(storeError(err, what));
    }
  };
  return {
    kind: 'memory',
    list: () => wrap('list', () => [...summaries.values()].map((s) => ({ ...s })).sort(byNewest)),
    get: (id) => wrap('get', () => (records.has(id)
      ? decodeStored(JSON.parse(records.get(id)), knownAlgorithms, id) : null)),
    put: (experiment) => wrap('put', () => {
      const { doc, summary } = prepare(experiment, knownAlgorithms);
      records.set(doc.experimentId, JSON.stringify(doc));
      summaries.set(doc.experimentId, summary);
      return doc.experimentId;
    }),
    delete: (id) => wrap('delete', () => {
      summaries.delete(id);
      return records.delete(id);
    }),
    estimate: () => wrap('estimate', () => {
      let usage = 0;
      for (const v of records.values()) usage += v.length;
      for (const v of studio.values()) usage += v.length;
      return { usage, quota: null, persistent: false };
    }),
    listStudio: ({ kind } = {}) => wrap('listStudio', () => [...studioSummaries.values()]
      .filter(ofKind(kind)).map((x) => ({ ...x })).sort(studioNewest)),
    getStudio: (id) => wrap('getStudio', () => (studio.has(id)
      ? decodeStudio(JSON.parse(studio.get(id)), id) : null)),
    putStudio: (rec) => wrap('putStudio', () => {
      const { value, summary } = prepareStudio(rec);
      studio.set(value.id, JSON.stringify(value));
      studioSummaries.set(value.id, summary);
      return value.id;
    }),
    deleteStudio: (id) => wrap('deleteStudio', () => {
      studioSummaries.delete(id);
      return studio.delete(id);
    }),
    close() {},
  };
}

// ---------------------------------------------------------------- IndexedDB

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    // The error also aborts the transaction (no preventDefault), so a partial write rolls back.
    req.onerror = () => reject(req.error);
  });
}

/** Open (and upgrade) the experiment database. Rejects with code 'unavailable' on failure. */
export function openExperimentStore({ indexedDB, name = DB_NAME, storage = null,
  knownAlgorithms } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    return Promise.reject(new ExperimentStoreError('unavailable', 'IndexedDB is not available'));
  }
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch (err) {
      reject(new ExperimentStoreError('unavailable', `IndexedDB cannot be opened: ${
        err && err.message}`, err));
      return;
    }
    req.onupgradeneeded = (ev) => {
      try {
        upgradeExperimentDb(req.result, ev.oldVersion || 0, ev.newVersion);
      } catch (err) {
        if (req.transaction) req.transaction.abort();
      }
    };
    req.onblocked = () => reject(new ExperimentStoreError('unavailable',
      'the experiment database is blocked by another open OSCILLA tab'));
    req.onerror = (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      const err = req.error;
      reject(new ExperimentStoreError('unavailable', `IndexedDB open failed: ${
        err ? err.message || err.name : 'unknown error'}`, err));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(idbStore(db, storage, knownAlgorithms));
    };
  });
}

function idbStore(db, storage, knownAlgorithms) {
  // Run fn(tx) in a transaction; resolve with its value once the transaction completes.
  const run = (what, stores, mode, fn) => new Promise((resolve, reject) => {
    let tx;
    let value;
    let failed = null;
    try {
      tx = db.transaction(stores, mode);
    } catch (err) {
      reject(storeError(err, what));
      return;
    }
    const fail = (err) => {
      if (!failed) failed = storeError(err, what);
    };
    tx.oncomplete = () => (failed ? reject(failed) : resolve(value));
    tx.onerror = (ev) => fail(tx.error || (ev && ev.target && ev.target.error));
    tx.onabort = () => {
      fail(tx.error || new Error('transaction aborted'));
      reject(failed);
    };
    const abort = (err) => {
      fail(err);
      try { tx.abort(); } catch (e) { /* already finished */ }
    };
    let pending;
    try {
      pending = fn(tx); // requests are issued synchronously while the transaction is active
    } catch (err) {
      abort(err);
      return;
    }
    Promise.resolve(pending).then((v) => { value = v; }, abort);
  });
  return {
    kind: 'indexeddb',
    list: () => run('list', [SUMMARIES], 'readonly',
      (tx) => request(tx.objectStore(SUMMARIES).getAll()))
      .then((rows) => rows.map((s) => ({ ...s })).sort(byNewest)),
    get: (id) => run('get', [RECORDS], 'readonly',
      (tx) => request(tx.objectStore(RECORDS).get(id)))
      .then((doc) => (doc == null ? null : decodeStored(doc, knownAlgorithms, id))),
    put(experiment) {
      let prepared;
      try {
        prepared = prepare(experiment, knownAlgorithms);
      } catch (err) {
        return Promise.reject(err);
      }
      const { doc, summary } = prepared;
      return run('put', [RECORDS, SUMMARIES], 'readwrite', (tx) => Promise.all([
        request(tx.objectStore(RECORDS).put(doc)),
        request(tx.objectStore(SUMMARIES).put(summary)),
      ])).then(() => doc.experimentId);
    },
    delete: (id) => run('delete', [RECORDS, SUMMARIES], 'readwrite', (tx) => {
      const records = tx.objectStore(RECORDS);
      return Promise.all([
        request(records.get(id)).then((doc) => doc != null),
        request(records.delete(id)),
        request(tx.objectStore(SUMMARIES).delete(id)),
      ]).then(([existed]) => existed);
    }),
    async estimate() {
      if (!storage || typeof storage.estimate !== 'function') {
        return { usage: null, quota: null, persistent: null };
      }
      try {
        const e = await storage.estimate();
        const persistent = typeof storage.persisted === 'function' ? await storage.persisted()
          : null;
        return { usage: e.usage ?? null, quota: e.quota ?? null, persistent };
      } catch (err) {
        throw storeError(err, 'estimate');
      }
    },
    listStudio: ({ kind } = {}) => run('listStudio', [STUDIO_SUMMARIES], 'readonly',
      (tx) => request(tx.objectStore(STUDIO_SUMMARIES).getAll()))
      .then((rows) => rows.filter(ofKind(kind)).map((x) => ({ ...x })).sort(studioNewest)),
    getStudio: (id) => run('getStudio', [STUDIO_RECORDS], 'readonly',
      (tx) => request(tx.objectStore(STUDIO_RECORDS).get(id)))
      .then((v) => (v == null ? null : decodeStudio(v, id))),
    putStudio(rec) {
      let prepared;
      try {
        prepared = prepareStudio(rec);
      } catch (err) {
        return Promise.reject(err);
      }
      const { value, summary } = prepared;
      return run('putStudio', [STUDIO_RECORDS, STUDIO_SUMMARIES], 'readwrite', (tx) => Promise.all([
        request(tx.objectStore(STUDIO_RECORDS).put(value)),
        request(tx.objectStore(STUDIO_SUMMARIES).put(summary)),
      ])).then(() => value.id);
    },
    deleteStudio: (id) => run('deleteStudio', [STUDIO_RECORDS, STUDIO_SUMMARIES], 'readwrite',
      (tx) => {
        const recs = tx.objectStore(STUDIO_RECORDS);
        return Promise.all([
          request(recs.get(id)).then((v) => v != null),
          request(recs.delete(id)),
          request(tx.objectStore(STUDIO_SUMMARIES).delete(id)),
        ]).then(([existed]) => existed);
      }),
    close: () => db.close(),
  };
}

/** Open IndexedDB, or fall back to memory: { store, persistent, error }. Never rejects. */
export async function openExperimentStoreOrMemory(opts = {}) {
  try {
    return { store: await openExperimentStore(opts), persistent: true, error: null };
  } catch (err) {
    return { store: createMemoryStore(opts), persistent: false, error: storeError(err, 'open') };
  }
}
