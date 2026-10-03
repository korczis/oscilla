// Experiment storage (spec §54-§55, §88, §175, §225-§227). One of the three non-pure modules
// of docs/v3/architecture.md: it talks to IndexedDB, which is injected (never read from a
// global here), so it is testable and the caller decides what to do under file://.
//
//   openExperimentStore({ indexedDB, name, storage, knownAlgorithms }) -> Promise<Store>
//   createMemoryStore({ knownAlgorithms }) -> Store        (same API, nothing persists)
//   openExperimentStoreOrMemory(opts) -> Promise<{ store, persistent, error }>
//   Store = { kind: 'indexeddb'|'memory', list(), get(id), put(experiment), delete(id),
//             estimate(), close() }
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

import { serializeExperiment, formatErrors } from './schema.js';
import { validateExperiment } from './validate.js';

export const DB_NAME = 'oscilla-experiments';
export const DB_VERSION = 1;
export const RECORDS = 'experiments';
export const SUMMARIES = 'summaries';

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
 * Version upgrade (DB_VERSION 1). From 0 (empty) it creates both object stores; it never
 * deletes a store or a record.
 */
export function upgradeExperimentDb(db, oldVersion) {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(RECORDS)) {
      db.createObjectStore(RECORDS, { keyPath: 'experimentId' });
    }
    if (!db.objectStoreNames.contains(SUMMARIES)) {
      db.createObjectStore(SUMMARIES, { keyPath: 'experimentId' });
    }
  }
}

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
      return { usage, quota: null, persistent: false };
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
