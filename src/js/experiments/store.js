// Experiment storage (spec §54-§55, §88, §175, §225-§227). One of the three non-pure modules
// of docs/v3/architecture.md: it talks to IndexedDB, which is injected (never read from a
// global here), so it is testable and the caller decides what to do under file://.
//
//   openExperimentStore({ indexedDB, name, storage, knownAlgorithms }) -> Promise<Store>
//   createMemoryStore({ knownAlgorithms }) -> Store        (same API, nothing persists)
//   openExperimentStoreOrMemory(opts) -> Promise<{ store, persistent, error }>
//   observeMemoryStore(store, onChange) -> Store   (onChange(store.held()) after every write;
//                                                   the memory store only, ADR 0045)
//   Store = { kind: 'indexeddb'|'memory', list(), get(id), put(experiment),
//             annotate(id, { name, notes, baseline }), delete(id), estimate(), close(),
//             listStudio({ kind }), getStudio(id), putStudio(record), deleteStudio(id),
//             listDefinitions() -> { definitions, unreadable: [{ id, reason }] },
//             getDefinition(id), putDefinition(definition),
//             listFindings() -> { findings, unreadable: [{ id, reason }] }, getFinding(id),
//             putFinding(finding, { expectedUpdatedAt }),
//             putFindings([finding]) -> { stored, same }, deleteFinding(id) }
//   memory Store only: held() -> { experiments, definitions, studio, findings } (records it
//   holds, which a reload discards: the unsaved-work guard reports them)
//
// Records are stored in the portable file form (schema.serializeExperiment: EncodedArray
// result arrays) of the validated, migrated experiment (validate.js on put, and again on get),
// so a corrupt record is reported rather than rendered. list() reads a small summary store,
// not the results.
//
// Immutability (ADR 0019, ADR 0040): a stored experiment whose provenance.resultHash is stamped
// is a COMPLETED run. put() of the same id may only repeat it unchanged (a no-op); any other
// difference is refused with code 'immutable' (err.fields names what differs), checked inside
// the write transaction. The user metadata — name and annotations.notes (schema.js
// METADATA_KEYS) — changes only through annotate(id, { name, notes }), which reads the record,
// applies schema.js annotateExperiment and verifies that no execution fact moved before it
// writes. An unstamped record (resultHash null: still being measured) may be replaced.
// Baseline (ADR 0041): at most one stored experiment carries annotations.baseline. annotate(id,
// { baseline: true }) clears the mark on any other record in the same write (transaction), and
// put() of a marked record while another one is the baseline is refused with code 'conflict'.
// list() rows carry `baseline: true` for the marked record.
// Deletion happens only through delete(id): the upgrade function creates stores and never
// removes data (§225). Every failure rejects with an ExperimentStoreError whose `code` is
//   'unavailable' (no IndexedDB, open failed or blocked), 'quota' (QuotaExceededError),
//   'invalid' (put of an experiment that fails validation), 'corrupt' (stored record fails
//   validation), 'immutable' (put that would change a completed run), 'missing' (annotate of
//   an id that is not stored), 'conflict' (put of a baseline while another record is the
//   baseline), 'failed' (any other storage error).
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
//
// Definitions (ADR 0043; DB_VERSION 3 adds the DEFINITIONS store, keyPath 'id'): authored
// experiment definitions (definition.js), validated on put and on read. listDefinitions never
// fails on one bad record: it lists the readable ones and names the others in `unreadable`, so a
// damaged definition can neither hide the rest nor fail a refresh of the runs. putDefinition
// creates one or writes its next state: the name and notes may change, versions may only be appended,
// and a stored version that differs is refused with 'immutable' (err.fields names it). list()
// rows carry the run's `definition` { id, version, hash, derived } (schema 3), so a definition's
// runs are found without reading the records.
//
// Findings (ADR 0046; DB_VERSION 4 adds the FINDINGS store, keyPath 'id'): user metadata, an
// interpretation linked to the runs it cites (findings.js). Validated on put and on read; a stored
// finding that cannot be read is named in `unreadable` and never hides the others. putFinding
// creates or edits one (its createdAt never changes: 'immutable'); putFindings is an import, all
// or nothing in one transaction: a different finding stored under an incoming id refuses the whole
// batch with 'conflict' (err.fields names the ids), an identical one is skipped. No finding write
// touches a run, and delete(id) of a run never touches a finding: a reference to a deleted run
// stays and reads missing (findings.js findingIssues).

import {
  serializeExperiment, formatErrors, annotateExperiment, executionFactChanges, isMetadataPath,
  isBaseline,
} from './schema.js';
import { validateExperiment } from './validate.js';
import { validateDefinition } from './definition.js';
import { validateFinding, importPlan } from './findings.js';
import { canonicalJson } from './canonical-json.js';

export const DB_NAME = 'oscilla-experiments';
/**
 * Version 1: experiments; version 2 adds the Studio partition; version 3 the definitions;
 * version 4 the findings (never deletes anything). One-way: a build with a lower version cannot
 * open the database, so a revert keeps this version and its upgrade step (ADR 0046).
 */
export const DB_VERSION = 4;
export const RECORDS = 'experiments';
export const SUMMARIES = 'summaries';
export const STUDIO_RECORDS = 'studio';
export const STUDIO_SUMMARIES = 'studioSummaries';
export const DEFINITIONS = 'definitions';
export const FINDINGS = 'findings';
/** Kinds of Studio records (studio/schema.js STUDIO_KIND, studio/patches.js PATCH_KIND). */
export const STUDIO_RECORD_KINDS = Object.freeze(['oscilla-studio', 'oscilla-patch']);
/** Largest stored Studio document (JSON characters): twice the 4 MiB Studio import limit. */
export const STUDIO_RECORD_MAX_CHARS = 8 * 1024 * 1024;

export class ExperimentStoreError extends Error {
  constructor(code, message, cause, fields) {
    super(message);
    this.name = 'ExperimentStoreError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    if (fields) this.fields = fields;
  }
}

const isComplete = (e) => !!e && !!e.provenance && typeof e.provenance.resultHash === 'string';

/**
 * May `next` (validated) be written over the stored `old` (decoded, or null)? 'write' or 'same'
 * (identical: nothing to write); throws 'immutable' when `old` is a completed run and an
 * execution fact differs, or (unless `metadata`) any field differs.
 */
export function replaceVerdict(old, next, { metadata = false } = {}) {
  if (!old) return 'write';
  const changed = executionFactChanges(old, next);
  if (!changed.length) return 'same';
  if (!isComplete(old)) return 'write';
  const facts = changed.filter((p) => !isMetadataPath(p));
  if (!facts.length && metadata) return 'write';
  const id = old.experimentId;
  throw new ExperimentStoreError('immutable', facts.length
    ? `experiment ${id} is a completed run and cannot be changed (${facts.slice(0, 6)
      .join(', ')} differ); measure again or duplicate it instead`
    : `experiment ${id} is a completed run: its name and notes change only through annotate`,
  undefined, changed);
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
  if (oldVersion < 3) ensure(DEFINITIONS, 'id');
  if (oldVersion < 4) ensure(FINDINGS, 'id');
}

// ---------------------------------------------------------------- findings

/** A validated finding copy, or throws 'invalid' / 'corrupt' (`code`). */
function checkedFinding(f, code, id) {
  const v = validateFinding(f);
  if (!v.ok) {
    throw new ExperimentStoreError(code, `${code === 'corrupt' ? `stored finding ${id} is`
      : 'finding not stored:'} invalid: ${formatErrors(v.errors.slice(0, 5))}`);
  }
  return v.finding;
}

/**
 * May `next` replace the stored `old`? Its creation time never changes; with `expectedUpdatedAt`
 * (the version an edit was made from) a finding changed since then is refused with 'conflict'.
 */
function findingVerdict(old, next, expectedUpdatedAt) {
  if (old && old.createdAt !== next.createdAt) {
    throw new ExperimentStoreError('immutable', `finding ${next.id}: its creation time never `
      + 'changes', undefined, ['createdAt']);
  }
  if (expectedUpdatedAt !== undefined && (old ? old.updatedAt : null) !== expectedUpdatedAt) {
    throw new ExperimentStoreError('conflict', `finding ${next.id} was changed elsewhere since it `
      + 'was opened here (another tab or window); nothing was overwritten', undefined, [next.id]);
  }
}

const findingNewest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))
  || String(a.id).localeCompare(String(b.id));

/** { findings (valid, newest change first), unreadable: [{ id, reason }] } of stored rows. */
function findingList(rows) {
  const findings = [];
  const unreadable = [];
  for (const row of rows) {
    const id = row && typeof row.id === 'string' ? row.id : null;
    try {
      findings.push(checkedFinding(row, 'corrupt', id));
    } catch (err) {
      unreadable.push({ id, reason: err.message });
    }
  }
  return { findings: findings.sort(findingNewest), unreadable };
}

/** Validate an import batch: [finding] (copies), or throws 'invalid'. */
function checkedBatch(list) {
  if (!Array.isArray(list)) throw new ExperimentStoreError('invalid', 'findings must be a list');
  const out = list.map((f) => checkedFinding(f, 'invalid'));
  const ids = out.map((f) => f.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new ExperimentStoreError('invalid', `finding ${dup} appears more than once`);
  return out;
}

/** The import verdict over the stored copies (null when absent): { write, same } or throws. */
function batchVerdict(batch, olds) {
  const plan = importPlan(batch, olds.filter(Boolean));
  if (plan.conflicts.length) {
    const n = plan.conflicts.length;
    throw new ExperimentStoreError('conflict', `${n === 1 ? 'a finding' : 'findings'} with the `
      + `same id ${n === 1 ? 'is' : 'are'} already stored with different content (${plan.conflicts
        .slice(0, 4).join(', ')}); nothing was imported`, undefined, plan.conflicts);
  }
  return { write: plan.add, same: plan.same };
}

// ---------------------------------------------------------------- definitions

/** A validated definition copy, or throws 'invalid' / 'corrupt' (`code`). */
function checkedDefinition(def, code, id) {
  const v = validateDefinition(def);
  if (!v.ok) {
    throw new ExperimentStoreError(code, `${code === 'corrupt' ? `stored definition ${id} is`
      : 'definition not stored:'} invalid: ${formatErrors(v.errors.slice(0, 5))}`);
  }
  return v.definition;
}

/** May `next` replace the stored `old`? Only metadata and appended versions (ADR 0043). */
export function definitionVerdict(old, next) {
  if (!old) return;
  const fields = old.versions.map((x, i) => `versions[${i}]`).filter((p, i) => !next.versions[i]
    || canonicalJson(old.versions[i]) !== canonicalJson(next.versions[i]));
  if (old.createdAt !== next.createdAt) fields.push('createdAt');
  if (fields.length) {
    throw new ExperimentStoreError('immutable', `definition ${old.id}: a stored version never `
      + `changes (${fields.slice(0, 4).join(', ')}); an edit appends a new version`, undefined,
    fields);
  }
}

const defNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  || String(a.id).localeCompare(String(b.id));

/** { definitions (valid, newest first), unreadable: [{ id, reason }] } of stored rows. */
function definitionList(rows) {
  const definitions = [];
  const unreadable = [];
  for (const row of rows) {
    const id = row && typeof row.id === 'string' ? row.id : null;
    try {
      definitions.push(checkedDefinition(row, 'corrupt', id));
    } catch (err) {
      unreadable.push({ id, reason: err.message });
    }
  }
  return { definitions: definitions.sort(defNewest), unreadable };
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
    // The run's identity (ADR 0046): a finding's reference is checked against it on every
    // refresh. A row written by an earlier build lacks it and the record is read instead.
    resultHash: doc.provenance && typeof doc.provenance.resultHash === 'string'
      ? doc.provenance.resultHash : null,
    sizeBytes,
    ...(isBaseline(doc) ? { baseline: true } : {}),
    ...(doc.definition ? { definition: { id: doc.definition.id, version: doc.definition.version,
      hash: doc.definition.hash, derived: doc.definition.derived } } : {}),
  };
}

/** Ids of the other baseline rows; refuses a put of a baseline while one exists (ADR 0041). */
function otherBaselines(rows, id, prepared) {
  const ids = rows.filter((r) => r.baseline && r.experimentId !== id).map((r) => r.experimentId);
  if (prepared && ids.length && isBaseline(prepared.experiment)) {
    throw new ExperimentStoreError('conflict', `experiment ${id} is marked as the baseline but `
      + `${ids[0]} already is; mark the baseline through annotate`);
  }
  return ids;
}

// Validate + serialize for writing: { experiment (validated, migrated), doc, summary }.
function prepare(experiment, knownAlgorithms) {
  let json;
  try {
    json = JSON.stringify(serializeExperiment(experiment));
  } catch (err) {
    throw new ExperimentStoreError('invalid', `experiment cannot be serialized: ${err.message}`);
  }
  const v = validateExperiment(json, { knownAlgorithms });
  if (!v.ok) {
    throw new ExperimentStoreError('invalid', `experiment not stored: ${formatErrors(v.errors)}`);
  }
  const doc = serializeExperiment(v.experiment);
  const size = JSON.stringify(doc).length;
  return { experiment: v.experiment, doc, summary: summaryRecord(doc, size) };
}

// The annotated copy of the stored `old`, prepared, with a check that no execution fact moved.
function prepareAnnotation(old, id, meta, knownAlgorithms) {
  if (!old) throw new ExperimentStoreError('missing', `experiment ${id} is not stored`);
  let next;
  try {
    next = annotateExperiment(old, meta || {});
  } catch (err) {
    throw new ExperimentStoreError('invalid', `experiment ${id} not annotated: ${err.message}`);
  }
  const prepared = prepare(next, knownAlgorithms);
  return { prepared, verdict: replaceVerdict(old, prepared.experiment, { metadata: true }) };
}

function decodeStored(doc, knownAlgorithms, id) {
  const v = validateExperiment(doc, { knownAlgorithms });
  if (!v.ok) {
    throw new ExperimentStoreError('corrupt', `stored experiment ${id} is invalid: `
      + `${formatErrors(v.errors.slice(0, 5))}`);
  }
  return v.experiment;
}

const lacksHash = (row) => !!row && !Object.prototype.hasOwnProperty.call(row, 'resultHash');
const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  || String(a.experimentId).localeCompare(String(b.experimentId));

/** In-memory store with the IndexedDB store's API (file:// fallback, tests). */
export function createMemoryStore({ knownAlgorithms } = {}) {
  const records = new Map();
  const summaries = new Map();
  const studio = new Map();
  const studioSummaries = new Map();
  const defs = new Map();
  const finds = new Map();
  const readFinding = (id) => (finds.has(id) ? checkedFinding(JSON.parse(finds.get(id)),
    'corrupt', id) : null);
  const readDef = (id) => (defs.has(id) ? checkedDefinition(JSON.parse(defs.get(id)), 'corrupt',
    id) : null);
  const wrap = (what, fn) => {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(storeError(err, what));
    }
  };
  const read = (id) => (records.has(id)
    ? decodeStored(JSON.parse(records.get(id)), knownAlgorithms, id) : null);
  const write = ({ doc, summary }) => {
    records.set(doc.experimentId, JSON.stringify(doc));
    summaries.set(doc.experimentId, summary);
  };
  return {
    kind: 'memory',
    list: () => wrap('list', () => [...summaries.values()].map((s) => ({ ...s })).sort(byNewest)),
    get: (id) => wrap('get', () => read(id)),
    put: (experiment) => wrap('put', () => {
      const prepared = prepare(experiment, knownAlgorithms);
      const id = prepared.doc.experimentId;
      const verdict = replaceVerdict(read(id), prepared.experiment);
      otherBaselines([...summaries.values()], id, prepared);
      if (verdict === 'write') write(prepared);
      return id;
    }),
    annotate: (id, meta) => wrap('annotate', () => {
      const old = read(id);
      const { prepared, verdict } = prepareAnnotation(old, id, meta, knownAlgorithms);
      const clear = meta && meta.baseline === true
        ? otherBaselines([...summaries.values()], id).map((o) => prepareAnnotation(read(o), o,
          { baseline: false }, knownAlgorithms).prepared) : [];
      clear.forEach(write);
      if (verdict === 'write') write(prepared);
      return verdict === 'write' ? prepared.experiment : old;
    }),
    delete: (id) => wrap('delete', () => {
      summaries.delete(id);
      return records.delete(id);
    }),
    estimate: () => wrap('estimate', () => {
      let usage = 0;
      for (const v of records.values()) usage += v.length;
      for (const v of studio.values()) usage += v.length;
      for (const v of finds.values()) usage += v.length;
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
    listDefinitions: () => wrap('listDefinitions', () => definitionList([...defs.values()]
      .map((t) => JSON.parse(t)))),
    getDefinition: (id) => wrap('getDefinition', () => readDef(id)),
    putDefinition: (def) => wrap('putDefinition', () => {
      const next = checkedDefinition(def, 'invalid');
      definitionVerdict(readDef(next.id), next);
      defs.set(next.id, JSON.stringify(next));
      return next;
    }),
    listFindings: () => wrap('listFindings', () => findingList([...finds.values()]
      .map((t) => JSON.parse(t)))),
    getFinding: (id) => wrap('getFinding', () => readFinding(id)),
    putFinding: (f, { expectedUpdatedAt } = {}) => wrap('putFinding', () => {
      const next = checkedFinding(f, 'invalid');
      findingVerdict(readFinding(next.id), next, expectedUpdatedAt);
      finds.set(next.id, JSON.stringify(next));
      return next;
    }),
    putFindings: (list) => wrap('putFindings', () => {
      const batch = checkedBatch(list);
      const { write, same } = batchVerdict(batch, batch.map((f) => readFinding(f.id)));
      for (const f of write) finds.set(f.id, JSON.stringify(f));
      return { stored: write.map((f) => f.id), same };
    }),
    deleteFinding: (id) => wrap('deleteFinding', () => finds.delete(id)),
    held: () => ({ experiments: summaries.size, definitions: defs.size,
      studio: studioSummaries.size, findings: finds.size }),
    close() {},
  };
}

const MEMORY_WRITES = ['put', 'annotate', 'delete', 'putStudio', 'deleteStudio', 'putDefinition',
  'putFinding', 'putFindings', 'deleteFinding'];

/**
 * The memory store with `onChange(store.held())` called after each write settles (a refused
 * write too: it may have changed nothing). Any other store is returned as it is.
 */
export function observeMemoryStore(store, onChange) {
  if (!store || store.kind !== 'memory' || typeof store.held !== 'function') return store;
  const out = { ...store };
  for (const k of MEMORY_WRITES) {
    out[k] = (...args) => {
      const settle = () => {
        try { onChange(store.held()); } catch (e) { /* the observer's own failure */ }
      };
      return store[k](...args).then((v) => { settle(); return v; },
        (err) => { settle(); throw err; });
    };
  }
  return out;
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
  const readIn = (tx, id) => request(tx.objectStore(RECORDS).get(id))
    .then((doc) => (doc == null ? null : decodeStored(doc, knownAlgorithms, id)));
  const rowsIn = (tx) => request(tx.objectStore(SUMMARIES).getAll());
  const writeIn = (tx, { doc, summary }) => Promise.all([
    request(tx.objectStore(RECORDS).put(doc)),
    request(tx.objectStore(SUMMARIES).put(summary)),
  ]);
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
  // A row written by an earlier build has no resultHash (ADR 0046). On its first read it is
  // filled in from the stored record's provenance (the record itself is not changed), so later
  // refreshes need not read the record to know the run's identity. One transaction; a row whose
  // record is gone or carries no hash gets null.
  const backfillHashes = () => run('list', [RECORDS, SUMMARIES], 'readwrite', (tx) => {
    const sums = tx.objectStore(SUMMARIES);
    return request(sums.getAll()).then((rows) => Promise.all(rows.map((row) => {
      if (!lacksHash(row)) return row;
      return request(tx.objectStore(RECORDS).get(row.experimentId)).then((doc) => {
        const p = doc && doc.provenance;
        const next = { ...row, resultHash: p && typeof p.resultHash === 'string'
          ? p.resultHash : null };
        return request(sums.put(next)).then(() => next);
      });
    })));
  });
  return {
    kind: 'indexeddb',
    list: () => run('list', [SUMMARIES], 'readonly',
      (tx) => request(tx.objectStore(SUMMARIES).getAll()))
      .then((rows) => (rows.some(lacksHash) ? backfillHashes() : rows))
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
      const id = prepared.doc.experimentId;
      // Read, check and write in ONE transaction, so no other write slips in between.
      return run('put', [RECORDS, SUMMARIES], 'readwrite', (tx) => Promise.all([readIn(tx, id),
        rowsIn(tx)]).then(([old, rows]) => {
        const verdict = replaceVerdict(old, prepared.experiment);
        otherBaselines(rows, id, prepared);
        return verdict === 'write' ? writeIn(tx, prepared) : null;
      })).then(() => id);
    },
    annotate: (id, meta) => run('annotate', [RECORDS, SUMMARIES], 'readwrite',
      (tx) => Promise.all([readIn(tx, id), rowsIn(tx)]).then(([old, rows]) => {
        const { prepared, verdict } = prepareAnnotation(old, id, meta, knownAlgorithms);
        const clear = meta && meta.baseline === true ? otherBaselines(rows, id) : [];
        return Promise.all(clear.map((o) => readIn(tx, o).then((x) => writeIn(tx,
          prepareAnnotation(x, o, { baseline: false }, knownAlgorithms).prepared))))
          .then(() => (verdict === 'write' ? writeIn(tx, prepared)
            .then(() => prepared.experiment) : old));
      })),
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
    listDefinitions: () => run('listDefinitions', [DEFINITIONS], 'readonly',
      (tx) => request(tx.objectStore(DEFINITIONS).getAll())).then(definitionList),
    getDefinition: (id) => run('getDefinition', [DEFINITIONS], 'readonly',
      (tx) => request(tx.objectStore(DEFINITIONS).get(id)))
      .then((d) => (d == null ? null : checkedDefinition(d, 'corrupt', id))),
    putDefinition(def) {
      let next;
      try {
        next = checkedDefinition(def, 'invalid');
      } catch (err) {
        return Promise.reject(err);
      }
      // Read, check and write in ONE transaction (as put).
      return run('putDefinition', [DEFINITIONS], 'readwrite', (tx) => {
        const os = tx.objectStore(DEFINITIONS);
        return request(os.get(next.id)).then((old) => {
          definitionVerdict(old == null ? null : checkedDefinition(old, 'corrupt', next.id), next);
          return request(os.put(next));
        });
      }).then(() => next);
    },
    listFindings: () => run('listFindings', [FINDINGS], 'readonly',
      (tx) => request(tx.objectStore(FINDINGS).getAll())).then(findingList),
    getFinding: (id) => run('getFinding', [FINDINGS], 'readonly',
      (tx) => request(tx.objectStore(FINDINGS).get(id)))
      .then((f) => (f == null ? null : checkedFinding(f, 'corrupt', id))),
    putFinding(f, { expectedUpdatedAt } = {}) {
      let next;
      try {
        next = checkedFinding(f, 'invalid');
      } catch (err) {
        return Promise.reject(err);
      }
      return run('putFinding', [FINDINGS], 'readwrite', (tx) => {
        const os = tx.objectStore(FINDINGS);
        return request(os.get(next.id)).then((old) => {
          findingVerdict(old == null ? null : checkedFinding(old, 'corrupt', next.id), next,
            expectedUpdatedAt);
          return request(os.put(next));
        });
      }).then(() => next);
    },
    putFindings(list) {
      let batch;
      try {
        batch = checkedBatch(list);
      } catch (err) {
        return Promise.reject(err);
      }
      // Read, check and write in ONE transaction: a refused batch writes nothing.
      return run('putFindings', [FINDINGS], 'readwrite', (tx) => {
        const os = tx.objectStore(FINDINGS);
        return Promise.all(batch.map((f) => request(os.get(f.id)))).then((olds) => {
          const { write, same } = batchVerdict(batch, olds.map((o, i) => (o == null ? null
            : checkedFinding(o, 'corrupt', batch[i].id))));
          return Promise.all(write.map((f) => request(os.put(f))))
            .then(() => ({ stored: write.map((f) => f.id), same }));
        });
      });
    },
    deleteFinding: (id) => run('deleteFinding', [FINDINGS], 'readwrite', (tx) => {
      const os = tx.objectStore(FINDINGS);
      return Promise.all([request(os.get(id)).then((v) => v != null), request(os.delete(id))])
        .then(([existed]) => existed);
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
