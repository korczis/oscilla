// V3.1 Studio patches, local save/load, file import/export and dirty state
// (src/js/studio/patches.js, library.js, actions.js PATCH_*; experiments/store.js Studio
// partition, DB version 2). Spec §111-§117, §154-§161, §238, §253-§255. Plan issue V426.
//   node --test tests/unit/v31-studio-patches.test.mjs
//
// Tolerances: none. Patches move plain data; positions are integer offsets (exact in IEEE-754
// doubles); hashes and serialized text are compared byte for byte.

import test from 'node:test';
import assert from 'node:assert';

import {
  PATCH_FILE_EXTENSION, PATCH_IMPORT_LIMITS, PATCH_INSERT_GAP, PATCH_KIND, PATCH_SCHEMA_VERSION,
  PatchError, applyPatch, createPatch, defaultInsertPosition, importPatch, insertPatch,
  patchHash, replaceWithPatch, serializePatch,
} from '../../src/js/studio/patches.js';
import {
  createDirtyTracker, createStudioLibrary, exportPatchFile, exportProjectFile, fileSlug,
  importStudioFile,
} from '../../src/js/studio/library.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import {
  STUDIO_FILE_EXTENSION, STUDIO_KIND, collectIds, normalizeStudio, serializeStudio, studioHash,
} from '../../src/js/studio/schema.js';
import { validateStudioModel } from '../../src/js/studio/validate.js';
import {
  DB_VERSION, ExperimentStoreError, STUDIO_RECORDS, STUDIO_SUMMARIES, createMemoryStore,
  openExperimentStore, openExperimentStoreOrMemory, studioRecordProblem, upgradeExperimentDb,
} from '../../src/js/experiments/store.js';
import { createExperiment, createRecipe } from '../../src/js/experiments/schema.js';

// ---------------------------------------------------------------- fixtures

const NOW = '2026-10-02T12:00:00.000Z';
const synth = () => templateModel('subtractive-synth');
const voice = (m = synth()) => createPatch(m, ['osc-1', 'env-1', 'filter-1', 'lfo-1'],
  { name: 'Synth voice', description: 'Oscillator, envelope and a modulated low-pass filter.' });
const storeOf = (model) => createStudioStore(model, { idGenerator: createIdGenerator(model) });

function experiment(id = 'exp-1') {
  return createExperiment({ id, now: NOW, recipe: createRecipe({ stimulus: { kind: 'log-sweep',
    sampleRate: 48000, duration: 2, level: 0.5, f1: 20, f2: 20000, fade: 0.01 } }) });
}

// A minimal in-memory IndexedDB (the v3-experiments.test.mjs helper): open/upgrade, object
// stores with keyPath, readonly/readwrite transactions with put/get/getAll/delete, async events,
// rollback on abort, and a quota-error switch.
function fakeIndexedDB() {
  const dbs = new Map();
  const state = { upgrades: [], quota: null };
  const later = (fn) => setImmediate(fn);
  const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  class Tx {
    constructor(rec, names, mode) {
      this.rec = rec;
      this.names = names;
      this.mode = mode;
      this.pending = 0;
      this.finished = false;
      this.error = null;
      this.oncomplete = this.onerror = this.onabort = null;
      this.snapshot = new Map([...rec.stores].map(([k, s]) => [k, new Map(s.data)]));
      later(() => this.settle());
    }

    objectStore(name) {
      if (!this.names.includes(name)) throw new DOMException('not in scope', 'NotFoundError');
      const s = this.rec.stores.get(name);
      return {
        put: (value) => this.op(() => {
          if (this.mode !== 'readwrite') throw new DOMException('readonly', 'ReadOnlyError');
          if (state.quota === 'request') throw quotaError();
          s.data.set(value[s.keyPath], structuredClone(value));
          return value[s.keyPath];
        }),
        get: (key) => this.op(() => (s.data.has(key) ? structuredClone(s.data.get(key))
          : undefined)),
        getAll: () => this.op(() => [...s.data.values()].map((v) => structuredClone(v))),
        delete: (key) => this.op(() => {
          s.data.delete(key);
          return undefined;
        }),
      };
    }

    op(fn) {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      this.pending++;
      later(() => {
        this.pending--;
        if (this.finished) return;
        try {
          req.result = fn();
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (err) {
          req.error = err;
          const ev = { target: req, prevented: false, preventDefault() { this.prevented = true; } };
          if (req.onerror) req.onerror(ev);
          if (this.onerror) this.onerror(ev);
          if (!ev.prevented) this.abort(err);
        }
        this.settle();
      });
      return req;
    }

    settle() {
      later(() => {
        if (this.finished || this.pending) return;
        this.finished = true;
        if (this.oncomplete) this.oncomplete({});
      });
    }

    abort(err = new DOMException('aborted', 'AbortError')) {
      if (this.finished) throw new DOMException('finished', 'InvalidStateError');
      this.finished = true;
      this.error = err;
      for (const [k, data] of this.snapshot) this.rec.stores.get(k).data = data;
      later(() => this.onabort && this.onabort({}));
    }
  }
  const indexedDB = {
    open(name, version) {
      const req = { result: null, error: null, transaction: null, onsuccess: null, onerror: null,
        onupgradeneeded: null, onblocked: null };
      later(() => {
        if (!dbs.has(name)) dbs.set(name, { version: 0, stores: new Map() });
        const rec = dbs.get(name);
        const db = {
          objectStoreNames: { contains: (k) => rec.stores.has(k) },
          createObjectStore: (k, { keyPath }) => rec.stores.set(k, { keyPath, data: new Map() }),
          deleteObjectStore: () => { throw new Error('an upgrade must never delete a store'); },
          transaction: (names, mode = 'readonly') => new Tx(rec, [].concat(names), mode),
          close() {},
        };
        req.result = db;
        if (version > rec.version) {
          state.upgrades.push([rec.version, version]);
          const oldVersion = rec.version;
          rec.version = version;
          req.transaction = { abort() {} };
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
  return { indexedDB, dbs, state };
}

/** A version-1 database as V3.0 left it: the two experiment stores and one experiment. */
function v1Database(fake, name) {
  const stores = new Map();
  const exp = { experimentId: 'old-1', name: 'kept', note: 'a V3.0 record' };
  stores.set('experiments', { keyPath: 'experimentId', data: new Map([['old-1', exp]]) });
  stores.set('summaries', { keyPath: 'experimentId',
    data: new Map([['old-1', { experimentId: 'old-1', name: 'kept' }]]) });
  fake.dbs.set(name, { version: 1, stores });
}

// ---------------------------------------------------------------- patch schema (§111-§113)

test('§112 createPatch: an explicit StudioModel subset with its own kind and version', () => {
  const m = synth();
  const p = voice(m);
  assert.deepStrictEqual(Object.keys(p).sort(), ['automation', 'description', 'graph', 'kind',
    'name', 'schemaVersion', 'studioSchemaVersion']);
  assert.strictEqual(p.kind, PATCH_KIND);
  assert.strictEqual(p.schemaVersion, PATCH_SCHEMA_VERSION);
  assert.strictEqual(p.studioSchemaVersion, 1);
  assert.deepStrictEqual(p.graph.nodes.map((x) => x.id), ['osc-1', 'env-1', 'filter-1', 'lfo-1']);
  // Positions relative to the top-left (template: osc 40,160; env 240,160; filter and lfo 430).
  assert.deepStrictEqual(p.graph.nodes.map((x) => x.position), [{ x: 0, y: 0 }, { x: 200, y: 0 },
    { x: 390, y: 0 }, { x: 390, y: 180 }]);
  // Only internal edges (filter → master and filter → spectrum stay behind).
  assert.deepStrictEqual(p.graph.edges.map((x) => x.id), ['edge-1', 'edge-2', 'edge-4']);
  assert.deepStrictEqual(p.automation.map((l) => l.target), [{ node: 'filter-1',
    param: 'frequency' }]);
  // Complete parameters: the patch carries its defaults (§111).
  assert.deepStrictEqual(p.graph.nodes[1].params, m.graph.nodes[1].params);
  const json = JSON.stringify(p);
  for (const word of ['view', 'tracks', 'clips', 'markers', 'selection', 'panX']) {
    assert.ok(!json.includes(`"${word}"`), `no ${word} in a patch`);
  }
  const bare = createPatch(m, ['filter-1'], { name: ' Filter ', includeAutomation: false });
  assert.strictEqual(bare.name, 'Filter');
  assert.deepStrictEqual(bare.automation, []);
  assert.throws(() => createPatch(m, [], { name: 'x' }), PatchError);
  assert.throws(() => createPatch(m, ['nope'], { name: 'x' }), /no node "nope"/);
  assert.throws(() => createPatch(m, ['osc-1'], { name: '' }), /patch name/);
  assert.throws(() => createPatch(m, ['osc-1'], { name: 'x', description: 'y'.repeat(2001) }),
    /description/);
});

test('§161 serializePatch is canonical; patchHash ignores presentation', () => {
  const p = voice();
  const shuffled = JSON.parse(JSON.stringify(p), (k, v) => (v && typeof v === 'object'
    && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.strictEqual(serializePatch(shuffled), serializePatch(p));
  assert.strictEqual(serializePatch(p, 2), `${JSON.stringify(JSON.parse(serializePatch(p)),
    null, 2)}`);
  const moved = JSON.parse(JSON.stringify(p));
  moved.graph.nodes[0].position = { x: 999, y: 5 };
  moved.graph.nodes[0].metadata.name = 'Saw';
  moved.name = 'Other name';
  assert.strictEqual(patchHash(moved), patchHash(p));
  const changed = JSON.parse(JSON.stringify(p));
  changed.graph.nodes[0].params.frequency = 221;
  assert.notStrictEqual(patchHash(changed), patchHash(p));
});

// ---------------------------------------------------------------- import safety (§115, §159)

test('§115 importPatch: parse, validate, normalize; untrusted input rejected', () => {
  const p = voice();
  const ok = importPatch(serializePatch(p));
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.patch, p);
  assert.strictEqual(ok.migratedFrom, null);
  const err = (input, opts) => {
    const r = importPatch(input, opts);
    assert.strictEqual(r.ok, false, JSON.stringify(input).slice(0, 80));
    return r.errors[0];
  };
  assert.match(err('{nope').message, /Not valid JSON/);
  assert.strictEqual(err(' '.repeat(PATCH_IMPORT_LIMITS.maxBytes + 1)).code, 'limit-exceeded');
  assert.match(err(serializeStudio(synth())).message, /Studio project file, not a patch/);
  assert.match(err({ ...p, schemaVersion: 2 }).message, /Patch schema 2 is newer/);
  assert.strictEqual(err({ ...p, extra: 1 }).path, 'extra');
  assert.strictEqual(err('{"kind":"oscilla-patch","__proto__":{"x":1}}').code,
    'invalid-structure');
  assert.strictEqual(err({ ...p, name: 'x'.repeat(65) }).code, 'limit-exceeded');
  const deep = JSON.parse(JSON.stringify(p));
  let o = deep.graph.nodes[0].params;
  for (let i = 0; i < 20; i++) { o.x = {}; o = o.x; }
  assert.strictEqual(err(deep).code, 'limit-exceeded');
  // Embedded graph: counts, node types, references, cycles — before anything compiles.
  const many = JSON.parse(JSON.stringify(p));
  many.graph.nodes = Array.from({ length: 129 }, (_, i) => ({ id: `gain-${i + 1}`, type: 'gain',
    position: { x: 0, y: 0 }, params: {} }));
  many.graph.edges = [];
  many.automation = [];
  assert.match(err(many).message, /more than 128 nodes \(import limit\)/);
  const unknown = JSON.parse(JSON.stringify(p));
  unknown.graph.nodes[0].type = 'eval';
  assert.match(err(unknown).message, /unknown node type "eval"/);
  const dangling = JSON.parse(JSON.stringify(p));
  dangling.graph.edges.push({ id: 'edge-9', from: { node: 'filter-1', port: 'audio' },
    to: { node: 'master-1', port: 'audio' } });
  assert.strictEqual(err(dangling).code, 'missing-node');
  const loop = JSON.parse(JSON.stringify(p));
  loop.graph.edges.push({ id: 'edge-9', from: { node: 'filter-1', port: 'audio' },
    to: { node: 'osc-1', port: 'frequency' } });
  assert.strictEqual(err(loop).code, 'type-mismatch');
  const fb = JSON.parse(JSON.stringify(p));
  fb.graph.nodes.push({ id: 'mix-1', type: 'mixer', position: { x: 0, y: 0 }, params: {} });
  fb.graph.edges = [{ id: 'e1', from: { node: 'filter-1', port: 'audio' },
    to: { node: 'mix-1', port: 'in1' } }, { id: 'e2', from: { node: 'mix-1', port: 'audio' },
    to: { node: 'env-1', port: 'audio' } }, { id: 'e3', from: { node: 'env-1', port: 'audio' },
    to: { node: 'filter-1', port: 'audio' } }];
  assert.strictEqual(err(fb).code, 'audio-feedback');
  const lane = JSON.parse(JSON.stringify(p));
  lane.automation[0].target.param = 'type';
  assert.strictEqual(err(lane).path, 'automation[0].target.param');
  assert.strictEqual(err({ ...p, studioSchemaVersion: 7 }).path, 'studioSchemaVersion');
  // Input never modified.
  const frozen = JSON.parse(JSON.stringify(p));
  const before = JSON.stringify(frozen);
  importPatch(frozen);
  assert.strictEqual(JSON.stringify(frozen), before);
});

test('§160 patch envelopes migrate stepwise through their own registry', () => {
  const p = voice();
  const v0 = { ...JSON.parse(JSON.stringify(p)), schemaVersion: 0 };
  const r = importPatch(v0);
  assert.strictEqual(r.ok, true, 'schema 0 → 1 is the identity step');
  assert.strictEqual(r.migratedFrom, 0);
  const migrations = { 1: (d) => d, 2: (d) => { throw new Error('boom'); } };
  const two = importPatch(v0, { migrations });
  assert.strictEqual(two.ok, true, 'the target stays the current schema (1)');
});

// ---------------------------------------------------------------- insert / replace (§114)

test('§114 insertPatch: new ids, offset positions, renumbered names, Master skipped', () => {
  const m = synth();
  const before = collectIds(m);
  const p = createPatch(m, ['osc-1', 'env-1', 'filter-1', 'master-1', 'lfo-1'],
    { name: 'Chain' });
  const r = insertPatch(m, p, { x: 100, y: 600 });
  assert.deepStrictEqual(r.skipped, ['master-1'], 'one Master Output per Studio');
  assert.deepStrictEqual(r.created.nodes, ['osc-2', 'env-2', 'filter-2', 'lfo-2']);
  assert.deepStrictEqual(r.created.edges, ['edge-6', 'edge-7', 'edge-8'],
    'filter → master is dropped with the skipped Master');
  assert.deepStrictEqual(r.created.lanes, ['lane-2']);
  assert.deepStrictEqual(r.created.points, ['pt-3', 'pt-4']);
  for (const id of [...r.created.nodes, ...r.created.edges]) assert.ok(!before.has(id));
  const added = r.model.graph.nodes.filter((x) => r.created.nodes.includes(x.id));
  assert.deepStrictEqual(added.map((x) => [x.metadata.name, x.position]), [
    ['Oscillator 2', { x: 100, y: 600 }], ['Envelope 2', { x: 300, y: 600 }],
    ['Filter 2', { x: 490, y: 600 }], ['LFO 2', { x: 490, y: 780 }]]);
  assert.strictEqual(validateStudioModel(r.model).ok, true);
  assert.strictEqual(serializeStudio(m), serializeStudio(synth()), 'input model unchanged');
  // Custom names are kept; the default position is right of the existing content.
  const named = JSON.parse(JSON.stringify(p));
  named.graph.nodes[0].metadata.name = 'Bass osc';
  const r2 = insertPatch(m, named);
  assert.strictEqual(r2.model.graph.nodes.find((x) => x.id === 'osc-2').metadata.name,
    'Bass osc');
  assert.deepStrictEqual(defaultInsertPosition(m), { x: 640 + PATCH_INSERT_GAP, y: 160 });
  assert.deepStrictEqual(r2.model.graph.nodes.find((x) => x.id === 'osc-2').position,
    { x: 640 + PATCH_INSERT_GAP, y: 160 });
  const masterOnly = createPatch(m, ['master-1'], { name: 'Out' });
  assert.throws(() => insertPatch(m, masterOnly), /Nothing to insert/);
  assert.throws(() => insertPatch(m, { ...p, kind: 'x' }), PatchError);
});

test('§114 replaceWithPatch: the whole graph is replaced, the timeline is cleaned', () => {
  const m = synth();
  const p = createPatch(templateModel('filter-automation'), ['noise-1', 'filter-1', 'master-1',
    'spectrum-1'], { name: 'Noise sweep' });
  const r = replaceWithPatch(m, p);
  assert.deepStrictEqual(r.removed, ['osc-1', 'env-1', 'filter-1', 'master-1', 'lfo-1',
    'spectrum-1']);
  assert.deepStrictEqual(r.model.graph.nodes.map((x) => x.type), ['noise', 'filter', 'master',
    'spectrum']);
  assert.deepStrictEqual(r.skipped, []);
  assert.deepStrictEqual(r.model.timeline.tracks.map((t) => t.target), [null],
    'the track that targeted Oscillator 1 stays, untargeted');
  assert.deepStrictEqual(r.model.timeline.clips.map((c) => [c.id, c.target]), [['clip-1', null],
    ['clip-2', null]], 'as NODE_REMOVE: track clips stay on their now untargeted track');
  const own = JSON.parse(serializeStudio(m));
  own.timeline.clips[0].target = 'osc-1';
  const r3 = replaceWithPatch(normalizeStudio(own), p);
  assert.deepStrictEqual(r3.model.timeline.clips.map((c) => c.id), ['clip-2'],
    'a clip that targets a removed node itself is removed with it');
  assert.deepStrictEqual(r.model.timeline.automation.map((l) => l.target.node), ['filter-2']);
  const ids = r.model.graph.nodes.map((x) => x.id);
  assert.deepStrictEqual(ids, ['noise-1', 'filter-2', 'master-2', 'spectrum-2'],
    'ids never reuse those of the replaced graph');
  assert.strictEqual(validateStudioModel(r.model).ok, true);
  assert.throws(() => applyPatch(m, p, {}), /mode "insert" or "replace"/);
  assert.deepStrictEqual(applyPatch(m, p, { mode: 'replace' }).model, r.model);
  assert.deepStrictEqual(applyPatch(m, p, { mode: 'insert', at: { x: 0, y: 0 } }).model,
    insertPatch(m, p, { x: 0, y: 0 }).model);
});

test('§114 store PATCH_INSERT / PATCH_REPLACE are single undoable entries', () => {
  const store = storeOf(synth());
  const start = store.getModel();
  const p = voice();
  const r = store.dispatch({ type: 'PATCH_INSERT', patch: p, at: { x: 0, y: 600 } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.label, 'Insert Synth voice');
  assert.deepStrictEqual(store.getSelection().nodes, r.created.nodes);
  assert.strictEqual(store.undoLabel(), 'Insert Synth voice');
  store.undo();
  assert.strictEqual(store.getModel(), start, 'undo restores the exact earlier model');
  const rep = store.dispatch({ type: 'PATCH_REPLACE', patch: p });
  assert.strictEqual(rep.label, 'Replace graph with Synth voice');
  assert.strictEqual(store.getModel().graph.nodes.length, 4);
  store.undo();
  assert.strictEqual(store.getModel(), start);
  const bad = store.dispatch({ type: 'PATCH_INSERT', patch: { ...p, graph: null } });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /The patch is invalid/);
  assert.strictEqual(store.getModel(), start, 'a rejected patch changes nothing');
});

// ---------------------------------------------------------------- store partition (§154, §225)

test('§225 DB version 2 adds the Studio stores and never deletes anything', async () => {
  // Version 3 (ADR 0043) adds the definitions after them, version 4 (ADR 0046) the findings.
  assert.strictEqual(DB_VERSION, 4);
  const fake = fakeIndexedDB();
  const fresh = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'fresh' });
  assert.deepStrictEqual(fake.state.upgrades, [[0, 4]]);
  assert.deepStrictEqual([...fake.dbs.get('fresh').stores.keys()], ['experiments', 'summaries',
    STUDIO_RECORDS, STUDIO_SUMMARIES, 'definitions', 'findings']);
  fresh.close();
  v1Database(fake, 'old');
  const upgraded = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'old' });
  assert.deepStrictEqual(fake.state.upgrades, [[0, 4], [1, 4]]);
  const rec = fake.dbs.get('old');
  assert.deepStrictEqual([...rec.stores.keys()], ['experiments', 'summaries', 'studio',
    'studioSummaries', 'definitions', 'findings']);
  assert.deepStrictEqual(rec.stores.get('experiments').data.get('old-1'), { experimentId: 'old-1',
    name: 'kept', note: 'a V3.0 record' }, 'the V3.0 experiment is untouched');
  assert.deepStrictEqual(await upgraded.listStudio(), []);
  assert.strictEqual((await upgraded.list()).length, 1);
  // A partial earlier upgrade completes; an existing store is never recreated.
  const created = [];
  const db = { objectStoreNames: { contains: (k) => ['experiments', 'summaries', 'studio']
    .includes(k) }, createObjectStore: (k) => created.push(k) };
  upgradeExperimentDb(db, 1);
  assert.deepStrictEqual(created, ['studioSummaries', 'definitions', 'findings']);
});

for (const kind of ['memory', 'indexeddb']) {
  test(`§154 Studio records in the ${kind} store: envelope checks, list, get, delete`, async () => {
    const store = kind === 'memory' ? createMemoryStore()
      : await openExperimentStore({ indexedDB: fakeIndexedDB().indexedDB, name: 's' });
    const m = synth();
    const rec = (id, k, savedAt, doc) => ({ id, kind: k, name: id, savedAt,
      studioHash: studioHash(m), doc });
    await store.putStudio(rec('p-1', STUDIO_KIND, '2026-10-02T10:00:00.000Z',
      JSON.parse(serializeStudio(m))));
    await store.putStudio(rec('v-1', PATCH_KIND, '2026-10-02T11:00:00.000Z', voice()));
    assert.deepStrictEqual((await store.listStudio()).map((x) => x.id), ['v-1', 'p-1']);
    assert.deepStrictEqual((await store.listStudio({ kind: PATCH_KIND })).map((x) => x.id),
      ['v-1']);
    const row = (await store.listStudio({ kind: STUDIO_KIND }))[0];
    assert.deepStrictEqual(Object.keys(row).sort(), ['id', 'kind', 'name', 'savedAt',
      'sizeBytes', 'studioHash']);
    assert.deepStrictEqual((await store.getStudio('p-1')).doc, JSON.parse(serializeStudio(m)));
    assert.strictEqual(await store.getStudio('none'), null);
    await assert.rejects(store.putStudio({ ...rec('x', 'oscilla-experiment', NOW, {}) }),
      (e) => e instanceof ExperimentStoreError && e.code === 'invalid');
    await assert.rejects(store.putStudio(rec('x', PATCH_KIND, NOW, { kind: STUDIO_KIND })),
      /doc.kind differs/);
    await assert.rejects(store.putStudio(rec('../x', PATCH_KIND, NOW, voice())), /invalid id/);
    await assert.rejects(store.putStudio(rec('x', PATCH_KIND, 'yesterday', voice())),
      /ISO timestamp/);
    assert.strictEqual(await store.deleteStudio('v-1'), true);
    assert.strictEqual(await store.deleteStudio('v-1'), false);
    assert.deepStrictEqual((await store.listStudio()).map((x) => x.id), ['p-1']);
    assert.strictEqual((await store.list()).length, 0, 'experiments are a separate partition');
    await store.put(experiment());
    assert.strictEqual((await store.listStudio()).length, 1);
  });
}

test('§154 a corrupt stored envelope is reported, a quota error rolls back', async () => {
  const fake = fakeIndexedDB();
  const store = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'c' });
  const doc = voice();
  await store.putStudio({ id: 'v-1', kind: PATCH_KIND, name: 'v', savedAt: NOW,
    studioHash: null, doc });
  fake.dbs.get('c').stores.get('studio').data.get('v-1').kind = 'evil';
  await assert.rejects(store.getStudio('v-1'), (e) => e.code === 'corrupt');
  fake.state.quota = 'request';
  await assert.rejects(store.putStudio({ id: 'v-2', kind: PATCH_KIND, name: 'v', savedAt: NOW,
    studioHash: null, doc }), (e) => e.code === 'quota');
  fake.state.quota = null;
  assert.deepStrictEqual((await store.listStudio()).map((x) => x.id), ['v-1'],
    'nothing half-written');
  assert.strictEqual(studioRecordProblem(null), 'a Studio record must be an object');
});

test('§154 the memory fallback (file://) offers the same Studio partition', async () => {
  const fb = await openExperimentStoreOrMemory({});
  assert.strictEqual(fb.persistent, false);
  const lib = createStudioLibrary(fb.store);
  assert.strictEqual(lib.persistent, false, 'the UI says the work is kept for this session only');
  await lib.saveProject(synth(), { id: 'p-1', now: NOW });
  assert.strictEqual((await lib.list()).length, 1);
  assert.throws(() => createStudioLibrary({}), /Studio partition/);
});

// ---------------------------------------------------------------- library (§113-§114, §155)

test('§113 save and load a project: the exact model, view state included', async () => {
  const lib = createStudioLibrary(await openExperimentStore({
    indexedDB: fakeIndexedDB().indexedDB, name: 'lib' }));
  assert.strictEqual(lib.persistent, true);
  const store = storeOf(synth());
  store.dispatch({ type: 'VIEW_SET', view: { graph: { panX: 40, zoom: 1.5 } } });
  const model = store.getModel();
  const saved = await lib.saveProject(model, { id: 'p-1', now: NOW });
  assert.deepStrictEqual(saved, { id: 'p-1', kind: STUDIO_KIND, name: 'Subtractive Synth',
    savedAt: NOW, studioHash: studioHash(model) });
  const loaded = await lib.loadProject('p-1');
  assert.strictEqual(serializeStudio(loaded.model), serializeStudio(model));
  assert.deepStrictEqual(loaded.model.view.graph, { panX: 40, panY: 0, zoom: 1.5 });
  assert.strictEqual(await lib.loadProject('none'), null);
  // A project id is the user's own document: saving again overwrites it.
  const later = '2026-10-02T13:00:00.000Z';
  assert.strictEqual((await lib.saveProject(model, { id: 'p-1', now: later })).savedAt, later);
  // Invalid models are never saved.
  const broken = JSON.parse(serializeStudio(model));
  broken.graph.edges.push({ id: 'edge-9', from: { node: 'filter-1', port: 'audio' },
    to: { node: 'master-1', port: 'audio' } });
  await assert.rejects(lib.saveProject(normalizeStudio(broken), { id: 'p-2', now: NOW }),
    (e) => e.code === 'invalid');
});

test('§155 patches are never silently overwritten; kinds never mix', async () => {
  const lib = createStudioLibrary(createMemoryStore());
  const p = voice();
  const s = await lib.savePatch(p, { id: 'voice', now: NOW });
  assert.deepStrictEqual(s, { id: 'voice', kind: PATCH_KIND, name: 'Synth voice', savedAt: NOW,
    studioHash: patchHash(p) });
  await assert.rejects(lib.savePatch(p, { id: 'voice', now: NOW }),
    (e) => e.code === 'exists' && /already saved/.test(e.message));
  const renamed = { ...p, name: 'Voice 2' };
  await lib.savePatch(renamed, { id: 'voice', now: NOW, overwrite: true });
  assert.strictEqual((await lib.loadPatch('voice')).patch.name, 'Voice 2');
  await assert.rejects(lib.saveProject(synth(), { id: 'voice', now: NOW }),
    (e) => e.code === 'invalid' && /oscilla-patch record/.test(e.message));
  await assert.rejects(lib.loadProject('voice'), (e) => e.code === 'corrupt');
  await assert.rejects(lib.savePatch({ ...p, kind: 'x' }, { id: 'p', now: NOW }),
    (e) => e.code === 'invalid');
  assert.deepStrictEqual((await lib.list({ kind: PATCH_KIND })).map((x) => x.id), ['voice']);
  assert.strictEqual(await lib.remove('voice'), true);
});

test('§159 a tampered stored document is corrupt, never loaded', async () => {
  const mem = createMemoryStore();
  const lib = createStudioLibrary(mem);
  await lib.saveProject(synth(), { id: 'p-1', now: NOW });
  const rec = await mem.getStudio('p-1');
  rec.doc.graph.nodes[0].params.frequency = 9999;
  await mem.putStudio(rec);
  await assert.rejects(lib.loadProject('p-1'), (e) => e.code === 'corrupt'
    && /studioHash/.test(e.message));
  rec.doc.graph.nodes[0].type = 'unknown';
  await mem.putStudio(rec);
  await assert.rejects(lib.loadProject('p-1'), (e) => e.code === 'corrupt'
    && /unknown node type/.test(e.message));
  await lib.savePatch(voice(), { id: 'v', now: NOW });
  const prec = await mem.getStudio('v');
  prec.doc.graph.nodes[0].params.level = 0.5;
  await mem.putStudio(prec);
  await assert.rejects(lib.loadPatch('v'), (e) => e.code === 'corrupt');
});

// ---------------------------------------------------------------- files (§158)

test('§158 JSON export and import of projects and patches', () => {
  const m = synth();
  const f = exportProjectFile(m);
  assert.strictEqual(f.name, `subtractive-synth${STUDIO_FILE_EXTENSION}`);
  assert.strictEqual(f.type, 'application/json');
  assert.strictEqual(f.text, `${serializeStudio(m, 2)}\n`);
  const back = importStudioFile(f.text);
  assert.strictEqual(back.kind, 'project');
  assert.strictEqual(serializeStudio(back.model), serializeStudio(m));
  const pf = exportPatchFile(voice());
  assert.strictEqual(pf.name, `synth-voice${PATCH_FILE_EXTENSION}`);
  const pb = importStudioFile(pf.text);
  assert.strictEqual(pb.kind, 'patch');
  assert.deepStrictEqual(pb.patch, voice());
  assert.strictEqual(importStudioFile(JSON.parse(pf.text)).kind, 'patch');
  const exp = importStudioFile(JSON.stringify({ kind: 'oscilla-experiment', schemaVersion: 1 }));
  assert.strictEqual(exp.ok, false);
  assert.match(exp.errors[0].message, /experiment file, not a Studio file/);
  assert.strictEqual(importStudioFile('not json').ok, false);
  assert.strictEqual(fileSlug('Réverb  Test!'), 'reverb-test');
  assert.strictEqual(fileSlug('///'), 'studio');
  assert.strictEqual(fileSlug('x'.repeat(80)).length, 64);
});

// ---------------------------------------------------------------- dirty state (§156, §254)

test('§254 dirty state follows semantic content, never view state or selection', () => {
  const store = storeOf(synth());
  const dirty = createDirtyTracker(store.getModel());
  assert.strictEqual(dirty.isDirty(store.getModel()), false);
  store.dispatch({ type: 'VIEW_SET', view: { graph: { panX: 300, zoom: 2 },
    timeline: { pxPerSecond: 250 } } });
  store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: ['osc-1'] } });
  assert.strictEqual(dirty.isDirty(store.getModel()), false, 'pan, zoom, selection: clean');
  store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1', position: { x: 41, y: 160 } });
  assert.strictEqual(dirty.isDirty(store.getModel()), true, 'a moved node is an edit');
  store.undo();
  assert.strictEqual(dirty.isDirty(store.getModel()), false, 'undo back to the saved state');
  store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 330 });
  assert.deepStrictEqual(dirty.status(store.getModel()), { dirty: true, lastSave: null });
  dirty.markSaved(store.getModel(), { id: 'p-1', savedAt: NOW });
  assert.deepStrictEqual(dirty.status(store.getModel()), { dirty: false,
    lastSave: { id: 'p-1', savedAt: NOW, target: 'local' } });
  store.dispatch({ type: 'METADATA_SET', notes: 'changed' });
  assert.strictEqual(dirty.isDirty(store.getModel()), true, 'notes are saved content');
});
