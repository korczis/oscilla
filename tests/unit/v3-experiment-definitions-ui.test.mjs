// ADR 0043, review of #116: the MEASURE and EXPERIMENTS adapters over the experiment store, in
// Node (no DOM: the adapters' Alpine state is a plain object, IndexedDB the in-process fake).
//   D1  a stored definition that cannot be read never fails the list of runs, a save or a
//       rename; a list that cannot be read again after a stored change does not report the
//       change as failed; a retried save never stores a second copy of one run.
//   D2  a run that only shares a stored definition's id is never shown under its name.
//   D4  Repeat of a run with a derived definition loads its recipe only; nothing stays loaded.
//   node --test tests/unit/v3-experiment-definitions-ui.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as definition from '../../src/js/experiments/definition.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import { DB_NAME, openExperimentStore } from '../../src/js/experiments/store.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { buildFixtures, NOW, FIXTURE_RECIPE } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};
const loopbackDef = (id = 'def-loopback', name = 'Loopback') => definition.createDefinition({
  id, name, now: NOW, execution: definition.buildExecution({
    recipe: definition.setupRecipe(FIXTURE_RECIPE) }) });

/**
 * The two adapters composed as main.js composes them, on a fresh fake IndexedDB that `seed`
 * may fill first (through a store of the same database) and then alter directly.
 */
async function makeUi(seed = null) {
  const fake = fakeIndexedDB();
  if (seed) {
    const s = await openExperimentStore({ indexedDB: fake.indexedDB, ...OPTS });
    await seed(s, fake.dbs.get(DB_NAME));
    s.close();
  }
  globalThis.indexedDB = fake.indexedDB; // read by experiments.js pageIndexedDb()
  const notes = [];
  const cmp = {};
  for (const part of [createMeasureUi({ engine: { init() {}, activeNodeCount: 0 },
    stopPlayback() {}, loopback: true, build: null }), createExperimentsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  Object.assign(cmp, { notify: (type, title, text) => notes.push({ type, title, text }),
    $nextTick: (f) => f && f(), openModal() {}, closeModal() {}, setWorkspace() {} });
  cmp.measureInit();
  cmp.experimentsInit();
  return { cmp, notes, store: () => cmp.experimentsTestSeam().store() };
}
const errors = (notes) => notes.filter((n) => n.type === 'error');

/** Show the fixture-a engine result in MEASURE, as a finished measurement leaves it. */
async function showResult(cmp) {
  const { a } = await fx();
  const result = { ...a.result }; // a new measurement result each time
  cmp.measureTestSeam().showResult(result);
  return result;
}

test('review D1: a stored definition that cannot be read never fails the runs', async () => {
  const { cmp, notes, store } = await makeUi(async (s, db) => {
    await s.putDefinition(loopbackDef());
    await s.putDefinition(loopbackDef('def-two', 'Two'));
    db.stores.get('definitions').data.get('def-two').versions[0].execution.conditions
      .notes = 'bit rot';
  });
  await cmp.experimentsRefresh();
  assert.deepEqual(cmp.exps.defs.map((d) => d.id), ['def-loopback']);
  assert.equal(cmp.exps.defsNote, '1 stored definition could not be read and is not listed '
    + '(def-two).');
  const listed = await store().listDefinitions();
  assert.deepEqual(listed.unreadable.map((u) => u.id), ['def-two']);
  assert.match(listed.unreadable[0].reason, /corrupt/);
  // Save, rename and the list all work, and none of them reports a failure.
  await showResult(cmp);
  const id = await cmp.measureSave();
  assert.ok(id, JSON.stringify(notes));
  assert.equal(cmp.meas.saved, true);
  assert.deepEqual(cmp.exps.rows.map((r) => r.id), [id]);
  cmp.exps.renameId = id;
  cmp.exps.renameName = 'renamed';
  assert.equal(await cmp.experimentsRename(), true);
  assert.equal(cmp.exps.rows[0].name, 'renamed');
  assert.deepEqual(errors(notes), []);
});

test('review D1: a stored change is not reported as failed when the list cannot be read',
  async () => {
    const { cmp, notes, store } = await makeUi();
    await showResult(cmp);
    const s = await (async () => { await cmp.experimentsRefresh(); return store(); })();
    const list = s.list;
    s.list = () => Promise.reject(new Error('list unavailable'));
    const id = await cmp.measureSave();
    assert.ok(id);
    assert.equal(cmp.meas.saved, true);
    assert.deepEqual(errors(notes), []);
    assert.ok(notes.some((n) => n.type === 'warning' && n.title === 'List not refreshed'
      && /stored/.test(n.text)));
    assert.equal((await s.get(id)).experimentId, id, 'the run is stored');
    cmp.exps.renameId = id;
    cmp.exps.renameName = 'renamed while the list fails';
    assert.equal(await cmp.experimentsRename(), true);
    assert.equal((await s.get(id)).name, 'renamed while the list fails');
    // A definitions failure alone leaves the runs' list working.
    s.list = list;
    s.listDefinitions = () => Promise.reject(new Error('definitions unavailable'));
    await cmp.experimentsRefresh();
    assert.deepEqual(cmp.exps.rows.map((r) => r.id), [id]);
    assert.match(cmp.exps.defsNote, /definitions could not be read: definitions unavailable/);
    assert.deepEqual(errors(notes), []);
  });

test('review D1: a retried save stores one run, never a second copy', async () => {
  const { cmp, notes, store } = await makeUi();
  await cmp.experimentsRefresh();
  await showResult(cmp);
  const s = store();
  const put = s.put;
  // The first write is stored but its report fails (a lost acknowledgement): the store is read
  // back, the run is saved, and the UI never says "not saved" for it (ADR 0040 resolution).
  s.put = async (e) => {
    await put(e);
    s.put = put;
    throw new Error('the acknowledgement was lost');
  };
  const id = await cmp.measureSave();
  assert.ok(id);
  assert.equal(cmp.meas.saved, true);
  assert.deepEqual(errors(notes), []);
  assert.ok(notes.some((n) => n.title === 'Experiment saved' && /reported an error/.test(n.text)));
  assert.equal(await cmp.measureSave(), id, 'saving again is the same run');
  assert.deepEqual((await s.list()).map((r) => r.experimentId), [id], 'one run, one record');
  // A failed write (nothing stored) of the next measurement, retried, writes it once.
  await showResult(cmp);
  s.put = () => Promise.reject(new Error('quota'));
  assert.equal(await cmp.measureSave(), null);
  s.put = put;
  const id2 = await cmp.measureSave();
  assert.ok(id2 && id2 !== id);
  assert.equal((await s.list()).length, 2);
});

test('save model: a lost acknowledgement, a metadata edit, then a retry annotates the run',
  async () => {
    const { cmp, notes, store } = await makeUi();
    await cmp.experimentsRefresh();
    await showResult(cmp);
    const s = store();
    const { put, get } = s;
    // Stored, but the report fails and the store cannot be read back at that moment.
    s.put = async (e) => {
      await put(e);
      s.put = put;
      throw new Error('the acknowledgement was lost');
    };
    s.get = () => {
      s.get = get;
      return Promise.reject(new Error('read failed'));
    };
    assert.equal(await cmp.measureSave(), null);
    assert.ok(errors(notes).some((n) => n.title === 'Experiment not confirmed'));
    assert.ok(!errors(notes).some((n) => n.title === 'Experiment not saved'));
    // The user edits the name and notes, then retries: the same id, never "immutable".
    cmp.meas.name = 'edited before the retry';
    cmp.meas.notes = 'typed before the retry';
    const before = notes.length;
    const id = await cmp.measureSave();
    assert.ok(id, JSON.stringify(notes.slice(before)));
    assert.deepEqual(errors(notes.slice(before)), []);
    assert.equal(cmp.meas.saved, true);
    const rows = await s.list();
    assert.deepEqual(rows.map((r) => r.experimentId), [id], 'one run, one record');
    const back = await s.get(id);
    assert.equal(back.name, 'edited before the retry');
    assert.equal(back.annotations.notes, 'typed before the retry');
  });

test('save model: a record deleted after the save is stored again with its id and repeat link',
  async () => {
    const { cmp, notes, store } = await makeUi();
    await cmp.experimentsRefresh();
    const { a } = await fx();
    cmp.measureLoadRecipe(a.experiment.recipe, { repeatOf: 'the-original' });
    await showResult(cmp);
    const id = await cmp.measureSave();
    const s = store();
    const first = await s.get(id);
    assert.equal(first.provenance.repeatOf, 'the-original');
    cmp.exps.deleteId = id; // the confirmed delete of the Experiments workspace
    cmp.exps.deleteName = first.name;
    assert.equal(await cmp.experimentsDelete(), true);
    assert.equal(await s.get(id), null);
    cmp.meas.name = 'stored again';
    assert.equal(await cmp.measureSave(), id, 'the same id');
    const again = await s.get(id);
    assert.equal(again.provenance.createdAt, first.provenance.createdAt, 'the same timestamp');
    assert.equal(again.provenance.repeatOf, 'the-original', 'the repeat link is kept');
    assert.equal(again.provenance.resultHash, first.provenance.resultHash);
    assert.equal(again.name, 'stored again');
    assert.equal((await s.list()).length, 1);
    assert.deepEqual(errors(notes), []);
  });

test('save model: an update with nothing changed annotates nothing and says so', async () => {
  const { cmp, notes, store } = await makeUi();
  await cmp.experimentsRefresh();
  await showResult(cmp);
  const id = await cmp.measureSave();
  const s = store();
  // An annotation written in Experiments; MEASURE's notes are empty.
  await cmp.experimentsAnnotate(id, { notes: 'from Experiments' });
  const annotate = s.annotate;
  let calls = 0;
  s.annotate = (...args) => { calls += 1; return annotate(...args); };
  const before = notes.length;
  assert.equal(await cmp.measureSave(), id);
  assert.equal(calls, 0, 'no annotate is sent');
  assert.deepEqual(notes.slice(before).map((n) => n.title), ['Nothing to update']);
  assert.equal((await s.get(id)).annotations.notes, 'from Experiments', 'never cleared');
});

/** A run imported from elsewhere that claims the id of the local definition, version 7. */
async function foreignRun() {
  const { a } = await fx();
  const doc = JSON.parse(schema.experimentToJson(a.experiment));
  doc.experimentId = 'imported-run';
  doc.definition = { ...doc.definition, id: 'def-loopback', version: 7, derived: false };
  doc.definition.hash = definition.definitionHash(doc.definition.execution);
  doc.provenance.resultHash = hash.resultHash(doc);
  return JSON.stringify(doc);
}

test('review D2: a run that only shares a stored id is not shown under its name', async () => {
  const { a } = await fx();
  const local = loopbackDef();
  const own = experimentFromResult(a.result, { now: NOW, id: 'own-run',
    definition: definition.definitionRef(local) });
  const { cmp, notes } = await makeUi(async (s) => {
    await s.putDefinition(local);
    await s.put(own);
  });
  assert.ok(await cmp.experimentsImportText(await foreignRun()), JSON.stringify(notes));
  // A run of the stored version is shown under its name (the row carries the hash).
  assert.equal(cmp.exps.rows.find((r) => r.id === 'own-run').defText,
    ' · "Loopback" version 1');
  const row = cmp.exps.rows.find((r) => r.id === 'imported-run');
  assert.equal(row.defText, ' · definition version 7, does not match the stored definition with '
    + 'this id');
  assert.doesNotMatch(row.defText, /Loopback/);
  assert.match(cmp.exps.defs[0].meta, /last run 2026-10-02 10:00 UTC \(v1\)$/,
    'the imported run is not counted as a run of Loopback');
  await cmp.experimentsOpen('imported-run');
  const def = cmp.exps.detail.provenance.find((p) => p.label === 'Definition').text;
  assert.match(def, /^definition def-loopback version 7 \([0-9a-f]{12}…\), does not match/);
  await cmp.experimentsRepeat('imported-run');
  assert.doesNotMatch(cmp.meas.definition.text, /Loopback/);
  assert.notEqual(cmp.meas.name, 'Loopback');
});

test('review D4: Repeat of a derived run loads its recipe only, and says nothing early',
  async () => {
    const { a } = await fx();
    const { cmp, notes } = await makeUi(async (s) => { await s.put(a.experiment); });
    await cmp.experimentsRefresh();
    await cmp.experimentsRepeat('fixture-a');
    assert.equal(cmp.meas.definition, null, 'no derived definition stays loaded');
    const toast = notes.find((n) => n.type === 'info');
    assert.equal(toast.title, 'Recipe loaded for a repeat');
    assert.doesNotMatch(toast.text, /same definition/);
    // The setup is the run's recipe as played.
    const r = cmp.measureSetupRecipe();
    assert.equal(r.stimulus.f2, a.experiment.recipe.stimulus.f2);
    assert.equal(r.repeats, a.experiment.recipe.repeats);
  });
