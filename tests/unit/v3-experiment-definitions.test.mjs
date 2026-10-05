// ADR 0043: runs are executed from a versioned experiment definition.
//   definition.js definitionHash covers only the execution fields (recipe, declared conditions,
//   acceptance), never the name or notes; an edit of an execution field appends a version and
//   never changes what earlier runs reference; experiment.definition (schema 3) is bound to the
//   run's recipe and covered by result hash version 4; migrate.js 2 → 3 derives a definition
//   from each earlier run's own recipe (derived: true); the store keeps runs immutable and
//   stored versions append-only; the semantic compare names a definition version change.
// The runs are the deterministic TEST CONTEXT engine results of the V3 UI suite fixtures.
//   node --test tests/unit/v3-experiment-definitions.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import * as definition from '../../src/js/experiments/definition.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import * as store from '../../src/js/experiments/store.js';
import * as migrate from '../../src/js/experiments/migrate.js';
import { runChanges } from '../../src/js/experiments/semantic-diff.js';
import { compareExperiments } from '../../src/js/experiments/compare.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import { sha256Hex } from '../../src/js/calibration/sha256.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { safeMaxFrequency } from '../../src/js/measurement/stimulus.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { exportableExperiment } from '../../src/js/ui/experiments.js';
import { experimentSummary } from '../../src/js/measurement/views/experiment-summary.js';
import { buildCompareView } from '../../src/js/measurement/views/compare-view.js';
import {
  buildFixtures, NOW, FIXTURE_BUILD, FIXTURE_RECIPE,
} from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const clone = (v) => JSON.parse(JSON.stringify(v));
const docOf = (e) => clone(schema.serializeExperiment(e));
const decode = (doc) => {
  const v = validateExperiment(typeof doc === 'string' ? doc : clone(doc), OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  return v;
};
const restamp = (e, version = hash.RESULT_HASH_VERSION) => hash.withResultHash(
  hash.withConfigHash(e, hash.configHash(e)), hash.resultHash(e, { version }), version);
const LATER = '2026-10-03T09:00:00.000Z';

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};
/** The execution of the fixture setup (what MEASURE's setup asks for), with extras. */
const execution = (extra = {}, recipe = FIXTURE_RECIPE) => definition.buildExecution({
  recipe: definition.setupRecipe(recipe), ...extra });
const authored = (extra) => definition.createDefinition({ id: 'def-loopback', name: 'Loopback',
  notes: 'first notes', now: NOW, execution: execution(extra) });
/** A run of the fixture-a engine result started from `ref`. */
const runOf = async (ref, id = 'run-from-def') => {
  const { a } = await fx();
  return experimentFromResult(a.result, { now: NOW, id, build: FIXTURE_BUILD, name: 'run',
    definition: ref });
};
const stores = () => {
  const fake = fakeIndexedDB();
  return [
    ['memory', async () => store.createMemoryStore(OPTS)],
    ['indexeddb', () => store.openExperimentStore({ indexedDB: fake.indexedDB,
      name: `d${Math.random()}`, ...OPTS })],
  ];
};

// ---------------------------------------------------------------- hashing

test('ADR 0043: definitionHash covers the execution fields only, canonically', () => {
  const x = execution({ conditions: 'desk, 1 m', minimumQuality: 'USABLE' });
  const h = definition.definitionHash(x);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256Hex(canonicalJson({ v: 1, ...x })));
  // Key order and the setup's level word do not matter: 'low' is the peak 0.125.
  const reordered = { acceptance: x.acceptance, conditions: x.conditions,
    recipe: { analysis: x.recipe.analysis, repeats: x.recipe.repeats,
      stimulus: { ...x.recipe.stimulus } } };
  assert.equal(definition.definitionHash(reordered), h);
  assert.equal(definition.definitionHash(execution({ conditions: 'desk, 1 m',
    minimumQuality: 'USABLE' }, { ...FIXTURE_RECIPE, stimulus: { ...FIXTURE_RECIPE.stimulus,
    level: 0.125 } })), h);
  // Metadata is not hashed: two names and notes, one version hash; a rename keeps it.
  const one = definition.createDefinition({ id: 'd1', name: 'One', notes: 'n', now: NOW,
    execution: x });
  const two = definition.createDefinition({ id: 'd2', name: 'Two', notes: null, now: LATER,
    execution: x });
  assert.equal(one.versions[0].hash, h);
  assert.equal(two.versions[0].hash, h);
  const renamed = definition.renameDefinition(one, { name: 'Renamed', notes: '' });
  assert.equal(renamed.name, 'Renamed');
  assert.equal(renamed.notes, null);
  assert.deepEqual(renamed.versions, one.versions);
  // Every execution field changes it.
  const edits = [
    execution({ conditions: 'desk, 2 m', minimumQuality: 'USABLE' }),
    execution({ conditions: 'desk, 1 m', minimumQuality: 'GOOD' }),
    execution({ conditions: null, minimumQuality: 'USABLE' }),
    execution({ conditions: 'desk, 1 m', minimumQuality: 'USABLE' }, { ...FIXTURE_RECIPE,
      repeats: 2 }),
    execution({ conditions: 'desk, 1 m', minimumQuality: 'USABLE' }, { ...FIXTURE_RECIPE,
      stimulus: { ...FIXTURE_RECIPE.stimulus, duration: 3 } }),
    execution({ conditions: 'desk, 1 m', minimumQuality: 'USABLE' }, { ...FIXTURE_RECIPE,
      analysis: { ...FIXTURE_RECIPE.analysis, aggregation: 'median' } }),
  ];
  const hashes = new Set([h, ...edits.map((e) => definition.definitionHash(e))]);
  assert.equal(hashes.size, edits.length + 1);
});

test('ADR 0043: a definition recipe has no rate and refuses what no rate can play', () => {
  const r = definition.setupRecipe(FIXTURE_RECIPE);
  assert.equal(r.stimulus.sampleRate, null);
  assert.equal(r.stimulus.level, 0.125);
  assert.equal(r.stimulus.fade, 0.01, 'stimulus.js default, as the engine renders it');
  assert.equal('requested' in r, false);
  assert.throws(() => definition.setupRecipe({ ...FIXTURE_RECIPE, stimulus: {
    ...FIXTURE_RECIPE.stimulus, f2: 190000 } }), RangeError);
  assert.throws(() => execution({ minimumQuality: 'INVALID' }), RangeError);
  assert.throws(() => definition.createDefinition({ id: 'derived-x', now: NOW,
    execution: execution() }), TypeError, 'derived- is reserved');
});

// ---------------------------------------------------------------- versioning

test('ADR 0043: an execution edit appends a version; past runs keep their reference', async () => {
  const d1 = authored({ conditions: 'desk' });
  const run1 = await runOf(definition.definitionRef(d1));
  assert.deepEqual({ id: run1.definition.id, version: run1.definition.version,
    derived: run1.definition.derived }, { id: 'def-loopback', version: 1, derived: false });
  // The same execution: no new version.
  const same = definition.reviseDefinition(d1, execution({ conditions: 'desk' }), { now: LATER });
  assert.equal(same.changed, false);
  assert.equal(same.definition, d1);
  // An edit of the declared conditions: version 2 appended, version 1 untouched.
  const { definition: d2, changed } = definition.reviseDefinition(d1,
    execution({ conditions: 'desk, door closed' }), { now: LATER });
  assert.equal(changed, true);
  assert.deepEqual(d2.versions.map((v) => v.version), [1, 2]);
  assert.deepEqual(d2.versions[0], d1.versions[0]);
  assert.notEqual(d2.versions[1].hash, d2.versions[0].hash);
  assert.equal(definition.latestVersion(d2).createdAt, LATER);
  const run2 = await runOf(definition.definitionRef(d2), 'run-v2');
  assert.equal(run2.definition.version, 2);
  assert.equal(run2.definition.hash, d2.versions[1].hash);
  // Version 1's run is what it was and still verifies.
  assert.equal(run1.definition.hash, d1.versions[0].hash);
  decode(schema.experimentToJson(run1));
  // An older version can still be run explicitly (the same definition again).
  assert.equal(definition.definitionRef(d2, 1).hash, run1.definition.hash);
  assert.throws(() => definition.definitionRef(d2, 3), RangeError);
});

test('ADR 0043: stored versions are append-only; name and notes change in place', async () => {
  for (const [kind, open] of stores()) {
    const s = await open();
    const d1 = authored({ conditions: 'desk' });
    assert.deepEqual(await s.putDefinition(d1), d1, kind);
    const d2 = definition.reviseDefinition(d1, execution({ conditions: 'desk, 2 m' }),
      { now: LATER }).definition;
    await s.putDefinition(definition.renameDefinition(d2, { name: 'Loopback v2' }));
    const back = await s.getDefinition('def-loopback');
    assert.equal(back.name, 'Loopback v2', kind);
    assert.equal(back.versions.length, 2, kind);
    // Rewriting version 1, or dropping version 2, is refused.
    const rewritten = clone(back);
    rewritten.versions[0].execution.conditions.notes = 'rewritten';
    rewritten.versions[0].hash = definition.definitionHash(rewritten.versions[0].execution);
    await assert.rejects(s.putDefinition(rewritten), (err) => err.code === 'immutable'
      && err.fields.includes('versions[0]'), kind);
    await assert.rejects(s.putDefinition(d1), (err) => err.code === 'immutable'
      && err.fields.includes('versions[1]'), kind);
    // A version whose hash does not match its execution is not stored.
    const forged = clone(back);
    forged.versions[1].execution.conditions.notes = 'forged';
    await assert.rejects(s.putDefinition(forged), (err) => err.code === 'invalid'
      && /corrupt/.test(err.message), kind);
    assert.deepEqual((await s.listDefinitions()).map((d) => d.id), ['def-loopback'], kind);
  }
});

// ---------------------------------------------------------------- run ⇄ definition binding

test('ADR 0043: result hash v4 binds the run to its definition and its recipe', async () => {
  const { a } = await fx();
  assert.equal(hash.RESULT_HASH_VERSION, 4);
  const run = await runOf(definition.definitionRef(authored()));
  assert.equal(run.provenance.resultHashVersion, 4);
  const part = (k) => clone(schema.serializeExperiment(run[k]));
  assert.equal(run.provenance.resultHash, sha256Hex(canonicalJson({ v: 4,
    results: part('results'), quality: part('quality'), calibration: part('calibration'),
    input: part('input'), output: part('output'), measurement: part('measurement'),
    build: clone(run.provenance.build), recipe: part('recipe'),
    definition: part('definition') })));
  // Moving the run to another definition (same recipe, other conditions) fails v4, not v3.
  const other = { ...run, definition: definition.definitionRef(authored({ conditions: 'x' })) };
  assert.notEqual(hash.resultHash(other), hash.resultHash(run));
  assert.equal(hash.resultHash(other, { version: 3 }), hash.resultHash(run, { version: 3 }));
  const swapped = docOf(other);
  swapped.provenance = docOf(run).provenance;
  assert.ok(validateExperiment(swapped, OPTS).errors.some((x) => x.path
    === 'provenance.resultHash' && x.code === 'corrupt'
    && /recipe or definition/.test(x.text)));
  // A definition edited inside the file no longer matches its own hash.
  const edited = docOf(run);
  edited.definition.execution.acceptance.minimumQuality = 'GOOD';
  assert.ok(validateExperiment(edited, OPTS).errors.some((x) => x.path === 'definition.hash'
    && x.code === 'corrupt'));
  // A run whose recipe is not what its definition asks for is refused, even re-stamped.
  const moved = restamp({ ...run, recipe: { ...run.recipe, repeats: 2 } });
  assert.ok(validateExperiment(schema.experimentToJson(moved), OPTS).errors.some((x) =>
    x.path === 'definition' && x.code === 'corrupt' && /recipe\.repeats/.test(x.text)));
  // A derived id must be the hash's; an authored one may not pose as derived.
  const posing = docOf(run);
  posing.definition.derived = true;
  assert.ok(validateExperiment(posing, OPTS).errors.some((x) => x.path === 'definition.id'));
  // The builders refuse or fall back; they never record a definition the recipe is not.
  const ref3 = definition.definitionRef(authored({}));
  const wrong = { ...ref3, execution: execution({}, { ...FIXTURE_RECIPE, repeats: 2 }) };
  wrong.hash = definition.definitionHash(wrong.execution);
  assert.throws(() => schema.createExperiment({ recipe: run.recipe, now: NOW, id: 'x',
    definition: wrong }), /not definition def-loopback version 1's \(recipe\.repeats\)/);
  const fell = experimentFromResult(a.result, { now: NOW, id: 'fell', definition: wrong });
  assert.equal(fell.definition.derived, true);
  assert.equal(fell.definition.id, `derived-${fell.definition.hash.slice(0, 32)}`);
  decode(schema.experimentToJson(fell));
});

test('ADR 0043: a clamped run is still from the definition that asked for more', () => {
  // The definition asks for 30 kHz; at 44.1 kHz stimulus.js plays 0.95 × Nyquist.
  const def = definition.setupRecipe({ ...FIXTURE_RECIPE, stimulus: {
    ...FIXTURE_RECIPE.stimulus, f2: 30000 } });
  const top = safeMaxFrequency(44100);
  const ran = schema.createRecipe({ stimulus: { ...def.stimulus, sampleRate: 44100, f2: top },
    repeats: def.repeats, analysis: def.analysis, requested: { f1: 20, f2: 30000 } });
  assert.deepEqual(definition.recipeMismatches(ran, def), []);
  // Another requested value, or a played value that is not the clamp, is not.
  assert.deepEqual(definition.recipeMismatches({ ...ran, requested: { f1: 20, f2: 25000 } },
    def), ['recipe.stimulus.f2']);
  assert.deepEqual(definition.recipeMismatches({ ...ran, stimulus: { ...ran.stimulus,
    f2: top - 1 } }, def), ['recipe.stimulus.f2']);
  // Derived from that run: the requested 30 kHz, not the played value.
  const d = definition.derivedRef(ran);
  assert.equal(d.execution.recipe.stimulus.f2, 30000);
  assert.equal(d.derived, true);
});

test('ADR 0043: acceptance compares the stored verdict with the minimum only', () => {
  const x = execution({ minimumQuality: 'USABLE' });
  assert.deepEqual(definition.acceptanceOf(x, 'GOOD').met, true);
  assert.deepEqual(definition.acceptanceOf(x, 'USABLE').met, true);
  assert.deepEqual(definition.acceptanceOf(x, 'POOR').met, false);
  assert.deepEqual(definition.acceptanceOf(x, 'INVALID').met, false);
  assert.equal(definition.acceptanceOf(x, null).met, null);
  assert.equal(definition.acceptanceOf(execution(), 'GOOD').met, null);
});

// ---------------------------------------------------------------- migration 2 → 3

/** A schema-2 record as written before ADR 0043: no definition, a v3 result hash. */
function schema2Doc(e) {
  const d = docOf(e);
  d.schemaVersion = 2;
  delete d.definition;
  d.provenance.resultHash = hash.resultHash(d, { version: 3 });
  d.provenance.resultHashVersion = 3;
  return d;
}

test('ADR 0043: schema 2 files migrate to 3 with a derived definition, and round-trip',
  async () => {
    const { a, c } = await fx();
    assert.equal(schema.EXPERIMENT_SCHEMA_VERSION, 3);
    for (const fixture of [a, c]) {
      const old = schema2Doc(fixture.experiment);
      const before = JSON.stringify(old);
      const v = decode(JSON.stringify(old, null, 2));
      assert.equal(JSON.stringify(old), before, 'input untouched');
      assert.equal(v.migratedFrom, 2);
      const e = v.experiment;
      assert.equal(e.schemaVersion, 3);
      assert.equal(e.definition.derived, true, 'derived: never presented as authored');
      assert.equal(e.definition.version, 1);
      assert.equal(e.definition.id, `derived-${e.definition.hash.slice(0, 32)}`);
      assert.deepEqual(definition.recipeMismatches(e.recipe, e.definition.execution.recipe), []);
      assert.equal(e.definition.execution.conditions.notes, null, 'nothing invented');
      assert.equal(e.definition.execution.acceptance.minimumQuality, null);
      // The stored v3 hash is kept and verifies (v3 never covered the definition).
      assert.equal(e.provenance.resultHash, old.provenance.resultHash);
      assert.equal(e.provenance.resultHashVersion, 3);
      // v3 export → re-import is identical, byte for byte.
      const text = schema.experimentToJson(exportableExperiment(e), 2);
      const again = decode(text);
      assert.equal(again.migratedFrom, null);
      assert.deepEqual(again.experiment, e);
      assert.equal(schema.experimentToJson(again.experiment, 2), text);
    }
    // Equal recipes derive one definition; another recipe another one.
    const da = decode(schema2Doc(a.experiment)).experiment.definition;
    const db = decode(schema2Doc(fixtures.b.experiment)).experiment.definition;
    const dc = decode(schema2Doc(c.experiment)).experiment.definition;
    assert.equal(da.hash, db.hash);
    assert.notEqual(da.hash, dc.hash);
    // A schema-2 document that already claims a definition is refused, not trusted.
    const claim = schema2Doc(a.experiment);
    claim.definition = docOf(a.experiment).definition;
    const r = validateExperiment(claim, OPTS);
    assert.equal(r.ok, false);
    assert.match(r.errors[0].text, /migration 2 → 3 failed: a schema-2 experiment has no /);
    assert.deepEqual(migrate.migrateExperiment(schema2Doc(a.experiment)).applied, [3]);
  });

test('ADR 0043: a stored schema-2 record reads as schema 3 and stays immutable', async () => {
  const { b } = await fx();
  const fake = fakeIndexedDB();
  const s = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'old2', ...OPTS });
  await s.put(b.experiment);
  const old = schema2Doc(b.experiment);
  fake.dbs.get('old2').stores.get('experiments').data.set('fixture-b', clone(old));
  const read = await s.get('fixture-b');
  assert.equal(read.schemaVersion, 3);
  assert.equal(read.definition.derived, true);
  assert.equal(await s.put(read), 'fixture-b', 'the same run again is a no-op');
  const named = await s.annotate('fixture-b', { name: 'renamed v2 run' });
  assert.equal(named.provenance.resultHash, old.provenance.resultHash);
  const raw = fake.dbs.get('old2').stores.get('experiments').data.get('fixture-b');
  assert.equal(raw.schemaVersion, 3, 'written back in the current schema');
  decode(raw);
});

// ---------------------------------------------------------------- store immutability

test('ADR 0043: a stored run cannot be moved to another definition version', async () => {
  const d1 = authored({ conditions: 'desk' });
  const d2 = definition.reviseDefinition(d1, execution({ conditions: 'desk, 2 m' }),
    { now: LATER }).definition;
  const run = await runOf(definition.definitionRef(d1));
  for (const [kind, open] of stores()) {
    const s = await open();
    await s.put(run);
    const moved = restamp({ ...run, definition: definition.definitionRef(d2) });
    assert.ok(validateExperiment(schema.experimentToJson(moved), OPTS).ok, 'a valid run');
    await assert.rejects(s.put(moved), (err) => err.code === 'immutable'
      && err.fields.includes('definition.hash') && err.fields.includes('definition.version'),
    kind);
    const rows = await s.list();
    assert.deepEqual(rows[0].definition, { id: 'def-loopback', version: 1,
      hash: d1.versions[0].hash, derived: false }, kind);
    assert.equal((await s.get(run.experimentId)).definition.version, 1, kind);
  }
});

// ---------------------------------------------------------------- compare

test('ADR 0043: compare says plainly when the definition version changed', async () => {
  const d1 = authored({ conditions: 'desk' });
  const d2 = definition.reviseDefinition(d1, execution({ conditions: 'desk, 2 m' }),
    { now: LATER }).definition;
  const r1 = await runOf(definition.definitionRef(d1), 'r1');
  const r1b = await runOf(definition.definitionRef(d1), 'r1b');
  const r2 = await runOf(definition.definitionRef(d2), 'r2');
  const { a } = await fx();
  const def = (list) => list.find((c) => c.domain === 'definition');
  // Same version: unchanged.
  assert.equal(def(runChanges(r1, r1b)).kind, 'unchanged');
  // Version 1 → 2 of the same definition: an execution change with its note.
  const c = def(runChanges(r1, r2));
  assert.equal(c.kind, 'changed');
  assert.equal(c.class, 'execution');
  assert.equal(c.note, 'version 1 → 2 of the same definition: its execution fields were edited '
    + 'between the runs');
  assert.deepEqual(c.before, { id: 'def-loopback', version: 1, hash: d1.versions[0].hash });
  // An authored definition against a run without one (derived), and two derived runs.
  assert.equal(def(runChanges(r1, a.experiment)).note, 'not run from the same definition');
  assert.equal(def(runChanges(a.experiment, fixtures.c.experiment)).kind, 'unchanged',
    'derived definitions are their recipes; the recipe domain names the difference');
  // The compare view: first among the execution groups, under its own heading.
  const v = buildCompareView([schema.annotateExperiment(r1, { baseline: true }), r2]);
  const g = v.semantic[0].groups[0];
  assert.equal(g.label, 'Definition');
  assert.equal(g.other, false);
  assert.match(g.items[0].text, /^Definition version: version 1 \([0-9a-f]{12}…\) → version 2 /);
  assert.equal(v.semantic[0].heading, 'Changed between runs A (baseline) and B');
  assert.equal(compareExperiments([r1, r2]).semantic[0].changes[0].domain, 'definition');
  // The run detail names the version (with the stored name) and the acceptance.
  const s = experimentSummary(r2, { definitionName: 'Loopback' });
  const row = (label) => s.provenance.find((p) => p.label === label).text;
  assert.equal(row('Definition'), `"Loopback" version 2 (${d2.versions[1].hash.slice(0, 12)}…)`);
  assert.equal(row('Declared conditions'), 'desk, 2 m');
  assert.match(experimentSummary(a.experiment).provenance.find((p) => p.label
    === 'Definition').text, /^derived from a run's own recipe, not authored/);
});
