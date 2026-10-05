// ADR 0040: a completed experiment run is immutable; metadata is separate.
//   store.put refuses any change to a stored completed run (code 'immutable'), store.annotate
//   changes only name / annotations.notes, duplicateExperiment copies the same run with
//   provenance.duplicateOf, measurement.runs[i].id = 'run-<i + 1>', result hash version 3 covers
//   the measurement block and provenance.build (v1 / v2 records keep verifying), schema 1 → 2
//   migration assigns run ids, provenance.build records sourceDigest / artifactSha256.
// The experiments are the deterministic TEST CONTEXT fixtures of the V3 UI suite (the real
// engine on a synthetic io, built by measure-experiment.js experimentFromResult).
//   node --test tests/unit/v3-experiment-immutable.test.mjs
//
// Namespace imports on purpose: a function missing in an older build fails its own test only.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import * as store from '../../src/js/experiments/store.js';
import * as migrate from '../../src/js/experiments/migrate.js';
import * as definition from '../../src/js/experiments/definition.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import { sha256Hex } from '../../src/js/calibration/sha256.js';
import { resolveBuild } from '../../src/js/core/build-info.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { experimentFromResult } from '../../src/js/ui/measure-experiment.js';
import { exportableExperiment } from '../../src/js/ui/experiments.js';
import { buildFixtures, NOW, FIXTURE_BUILD } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const clone = (v) => JSON.parse(JSON.stringify(v));
const docOf = (e) => clone(schema.serializeExperiment(e));
const decode = (doc) => {
  const v = validateExperiment(typeof doc === 'string' ? doc : clone(doc), OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  return v;
};
/** Re-stamp both hashes, as anyone can: the store must refuse on facts, not on hashes. */
const restamp = (e, version = hash.RESULT_HASH_VERSION) => hash.withResultHash(
  hash.withConfigHash(e, hash.configHash(e)), hash.resultHash(e, { version }), version);
/** A schema-1 record as V3.0-V3.5 wrote it: no run ids, no build digests, a v2 result hash. */
function schema1Doc(e, version = 2) {
  const d = docOf(e);
  d.schemaVersion = 1;
  delete d.definition; // ADR 0043: schema 3

  d.measurement.runs = d.measurement.runs.map(({ id, ...rest }) => rest);
  if (d.provenance.build) {
    delete d.provenance.build.sourceDigest;
    delete d.provenance.build.artifactSha256;
  }
  d.provenance.resultHash = hash.resultHash(d, { version });
  if (version === 1) delete d.provenance.resultHashVersion;
  else d.provenance.resultHashVersion = version;
  return d;
}
const DIGEST = 'd'.repeat(64);
const ARTIFACT = 'e'.repeat(64);
const STAMPED_REGION = JSON.stringify({ schema: 1, product: 'oscilla', version: '9.9.9',
  channel: 'production', sourceDigest: DIGEST, commit: 'f'.repeat(40), shortCommit: 'fffffff',
  sourceDate: '2026-10-04T00:00:00Z', artifactSha256: ARTIFACT });

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};
const stores = () => {
  const fake = fakeIndexedDB();
  return [
    ['memory', async () => store.createMemoryStore(OPTS)],
    ['indexeddb', () => store.openExperimentStore({ indexedDB: fake.indexedDB,
      name: `t${Math.random()}`, ...OPTS })],
  ];
};

// ---------------------------------------------------------------- store: immutability

/** [path the refusal names, mutation of a decoded completed run] — each re-stamped. */
const FACT_EDITS = [
  ['results.ir', (x) => { x.results.ir.samples[5] += 0.001; }],
  ['results.aggregate', (x) => { x.results.aggregate.repeatabilityDb = 0; }],
  ['quality.status', (x) => { x.quality.status = 'GOOD'; }],
  // A recipe edit takes the definition derived from the edited recipe along (ADR 0043), or the
  // file would be refused before the store sees it.
  ['recipe.stimulus', (x) => { x.recipe.stimulus.duration = 1.5;
    x.definition = definition.derivedRef(x.recipe); }],
  ['recipe.repeats', (x) => { x.recipe.repeats = 2;
    x.definition = definition.derivedRef(x.recipe); }],
  ['definition.id', (x) => { x.definition = definition.definitionRef(definition.createDefinition({
    id: 'other-definition', now: NOW, execution: x.definition.execution })); }],
  ['measurement.runs', (x) => { x.measurement.runs = x.measurement.runs.slice(0, 2); }],
  ['measurement.startedAt', (x) => { x.measurement.startedAt = '2026-10-02T11:00:00.000Z'; }],
  // A consistent claim: the quality says the level calibration was applied (a record naming one
  // its results do not show carries the finding calibration-claim-contradicted, ADR 0040
  // resolution 2026-10-05).
  ['calibration.level', (x) => {
    x.calibration.level = { schemaVersion: 1, kind: 'level', referenceHz: 1000,
      referenceDbSpl: 94, observedDbRelative: -30, offsetDb: 124, conditions: null,
      createdAt: null };
    x.quality.metrics.levelCalibrated = true;
    const r = x.quality.reasons.find((y) => y.code === 'LEVEL_CALIBRATION');
    Object.assign(r, { severity: 'ok', value: 124 });
  }],
  ['input.device', (x) => { x.input.device.label = 'Another mic'; }],
  ['output.level', (x) => { x.output.level = 0.01; }],
  ['environment.notes', (x) => { x.environment.notes = 'rewritten conditions'; }],
  ['algorithms.transfer', (x) => { x.algorithms.transfer = 'oscilla.transfer.v1'; }],
  ['oscillaVersion', (x) => { x.oscillaVersion = '9.9.9'; }],
  ['provenance.createdAt', (x) => { x.provenance.createdAt = '2030-01-01T00:00:00.000Z'; }],
  ['provenance.repeatOf', (x) => { x.provenance.repeatOf = 'other-run'; }],
  ['provenance.build', (x) => { x.provenance.build = { ...x.provenance.build,
    sourceDigest: DIGEST }; }],
  ['provenance.resultHashVersion', (x) => Object.assign(x, hash.withResultHash(x,
    hash.resultHash(x, { version: 2 }), 2))],
];

test('ADR 0040: put refuses every execution-fact change of a stored completed run', async () => {
  const { a } = await fx();
  for (const [kind, open] of stores()) {
    const s = await open();
    await s.put(a.experiment);
    for (const [path, mutate] of FACT_EDITS) {
      const x = decode(a.json).experiment;
      mutate(x);
      const edited = path === 'provenance.resultHashVersion' ? x : restamp(x);
      assert.ok(validateExperiment(schema.experimentToJson(edited), OPTS).ok,
        `${path}: the edit is a valid experiment`);
      await assert.rejects(s.put(edited), (err) => err instanceof store.ExperimentStoreError
        && err.code === 'immutable' && err.fields.includes(path)
        && /completed run and cannot be changed/.test(err.message), `${kind} ${path}`);
    }
    const back = await s.get('fixture-a');
    assert.equal(schema.experimentToJson(back), a.json, `${kind}: the stored run is unchanged`);
  }
});

test('ADR 0040: put of a stored run is idempotent; metadata goes through annotate only',
  async () => {
    const { a } = await fx();
    for (const [kind, open] of stores()) {
      const s = await open();
      assert.equal(await s.put(a.experiment), 'fixture-a');
      assert.equal(await s.put(decode(a.json).experiment), 'fixture-a', `${kind}: same run`);
      await assert.rejects(s.put({ ...a.experiment, name: 'renamed by put' }), (err) => err.code
        === 'immutable' && /only through annotate/.test(err.message)
        && err.fields.join() === 'name', kind);
      // Still being measured (no result hash): not a completed run, so it may be replaced.
      const draft = { ...a.experiment, experimentId: 'draft',
        provenance: { ...a.experiment.provenance, resultHash: null } };
      await s.put(draft);
      await s.put({ ...draft, name: 'draft renamed' });
      assert.equal((await s.get('draft')).name, 'draft renamed', kind);
    }
  });

test('ADR 0040: annotate changes name and notes only; hashes and facts stay', async () => {
  const { b } = await fx();
  for (const [kind, open] of stores()) {
    const s = await open();
    await s.put(b.experiment);
    const named = await s.annotate('fixture-b', { name: '  Desk speakers, take 2  ',
      notes: 'Window was open.' });
    assert.equal(named.name, 'Desk speakers, take 2');
    assert.deepEqual(named.annotations, { notes: 'Window was open.' });
    const back = await s.get('fixture-b');
    assert.deepEqual(back, named, kind);
    assert.deepEqual(schema.executionFactChanges(b.experiment, back), ['annotations', 'name']);
    assert.equal(back.provenance.resultHash, b.experiment.provenance.resultHash);
    assert.equal(back.provenance.configHash, b.experiment.provenance.configHash);
    decode(schema.experimentToJson(back));
    // Only the given field changes; null / '' removes the notes; nothing else is accepted.
    const notesOnly = await s.annotate('fixture-b',
      { notes: null, quality: null, name: undefined });
    assert.equal(notesOnly.name, 'Desk speakers, take 2');
    assert.equal('annotations' in notesOnly, false);
    assert.deepEqual(notesOnly.quality, b.experiment.quality);
    assert.equal((await s.list())[0].name, 'Desk speakers, take 2', `${kind}: list row follows`);
    await assert.rejects(s.annotate('nope', { name: 'x' }), (err) => err.code === 'missing');
    await assert.rejects(s.annotate('fixture-b', { name: 42 }), (err) => err.code === 'invalid');
  }
});

test('ADR 0040: annotate persists in IndexedDB across reopening', async () => {
  const { a } = await fx();
  const fake = fakeIndexedDB();
  const s1 = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'p', ...OPTS });
  await s1.put(a.experiment);
  await s1.annotate('fixture-a', { name: 'kept', notes: 'n' });
  s1.close();
  const s2 = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'p', ...OPTS });
  const back = await s2.get('fixture-a');
  assert.equal(back.name, 'kept');
  assert.deepEqual(back.annotations, { notes: 'n' });
  assert.equal(back.provenance.resultHash, a.experiment.provenance.resultHash);
});

// ---------------------------------------------------------------- duplicate

test('ADR 0040: duplicate is the same run under a new id with provenance.duplicateOf',
  async () => {
    const { a } = await fx();
    const d = schema.duplicateExperiment(a.experiment, { id: 'copy-1' });
    assert.equal(d.experimentId, 'copy-1');
    assert.equal(d.name, `${a.experiment.name} (copy)`);
    assert.equal(d.provenance.duplicateOf, 'fixture-a');
    for (const k of ['configHash', 'resultHash', 'resultHashVersion', 'createdAt', 'repeatOf']) {
      assert.deepEqual(d.provenance[k], a.experiment.provenance[k], k);
    }
    assert.deepEqual(d.measurement, a.experiment.measurement, 'not a new measurement');
    assert.deepEqual(schema.executionFactChanges(a.experiment, d).sort(),
      ['experimentId', 'name', 'provenance.duplicateOf']);
    const v = decode(schema.experimentToJson(d));
    assert.equal(v.experiment.provenance.duplicateOf, 'fixture-a');
    const s = store.createMemoryStore(OPTS);
    await s.put(a.experiment);
    await s.put(d);
    assert.deepEqual((await s.list()).map((r) => r.experimentId).sort(), ['copy-1', 'fixture-a']);
    assert.throws(() => schema.duplicateExperiment(a.experiment, { id: 'fixture-a' }), RangeError);
    const self = docOf(d);
    self.provenance.duplicateOf = 'copy-1';
    const r = validateExperiment(self, OPTS);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.path === 'provenance.duplicateOf'));
  });

// ---------------------------------------------------------------- run identity

test('ADR 0040: runs carry deterministic ids run-1..N, first among their fields', async () => {
  const { a, b } = await fx();
  assert.deepEqual(a.experiment.measurement.runs.map((r) => r.id), ['run-1', 'run-2', 'run-3']);
  assert.ok(a.experiment.measurement.runs.every((r) => Object.keys(r)[0] === 'id'));
  assert.equal(schema.runId(0), 'run-1');
  // Deterministic: the same result gives the same ids and bytes (no clock, no randomness).
  const again = experimentFromResult(a.result, { now: NOW, id: 'fixture-a',
    build: FIXTURE_BUILD, name: a.name, notes: 'Synthetic low-pass system; used by the '
      + 'automated UI tests and the visual reference.' });
  assert.equal(schema.experimentToJson(again), a.json);
  // withResults assigns ids by position whatever the caller passed.
  const e = schema.withResults(b.experiment, { runs: [{ id: 'x', n: 1 }, { n: 2 }] });
  assert.deepEqual(e.measurement.runs, [{ id: 'run-1', n: 1 }, { id: 'run-2', n: 2 }]);
  // validate: every run needs its positional id.
  for (const mutate of [
    (d) => { delete d.measurement.runs[1].id; },
    (d) => { d.measurement.runs[1].id = 'run-3'; },
    (d) => { [d.measurement.runs[0], d.measurement.runs[1]] = [d.measurement.runs[1],
      d.measurement.runs[0]]; },
  ]) {
    const d = docOf(a.experiment);
    mutate(d);
    const r = validateExperiment(d, OPTS);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((x) => /^measurement\.runs\[\d\]\.id$/.test(x.path)),
      JSON.stringify(r.errors));
  }
});

// ---------------------------------------------------------------- result hash versions

test('ADR 0040: result hash v3 covers measurement and build', async () => {
  const { a } = await fx();
  const e = a.experiment;
  // ADR 0043: new records use version 4 (v3 + recipe and definition); v3 stays verifiable.
  assert.deepEqual(hash.RESULT_HASH_VERSIONS, [1, 2, 3, 4]);
  const part = (k) => clone(schema.serializeExperiment(e[k]));
  assert.equal(hash.resultHash(e, { version: 3 }), sha256Hex(canonicalJson({ v: 3,
    results: part('results'), quality: part('quality'), calibration: part('calibration'),
    input: part('input'), output: part('output'), measurement: part('measurement'),
    build: clone(e.provenance.build) })));
  const h = hash.resultHash(e, { version: 3 });
  const h2 = hash.resultHash(e, { version: 2 });
  const dropped = { ...e, measurement: { ...e.measurement, runs: e.measurement.runs.slice(1) } };
  assert.notEqual(hash.resultHash(dropped, { version: 3 }), h, 'a dropped run changes v3');
  assert.equal(hash.resultHash(dropped, { version: 2 }), h2, 'v2 never covered the runs');
  const built = { ...e, provenance: { ...e.provenance, build: { ...e.provenance.build,
    sourceDigest: DIGEST } } };
  assert.notEqual(hash.resultHash(built, { version: 3 }), h, 'v3 covers the build');
  // Metadata and lineage stay outside: a duplicate or an annotation keeps the hash.
  const meta = schema.annotateExperiment(schema.duplicateExperiment(e, { id: 'z' }),
    { name: 'other', notes: 'n' });
  assert.equal(hash.resultHash(meta, { version: 3 }), h);
  // A v3 record whose runs were edited is corrupt on import.
  const doc = docOf(restamp(e, 3));
  doc.measurement.runs[2].frames += 1;
  const r = validateExperiment(doc, OPTS);
  assert.ok(r.errors.some((x) => x.path === 'provenance.resultHash' && x.code === 'corrupt'
    && /runs or build/.test(x.text)), JSON.stringify(r.errors));
});

test('ADR 0040: v1 and v2 records keep verifying; export re-stamps in their own version',
  async () => {
    const { c } = await fx();
    for (const version of [1, 2]) {
      const old = restamp(c.experiment, version);
      assert.equal(hash.resultHashVersionOf(old), version);
      const v = decode(schema.experimentToJson(old));
      assert.equal(v.experiment.provenance.resultHash, old.provenance.resultHash);
      assert.equal(hash.resultHashVersionOf(v.experiment), version);
      // A raw deviceId on an old record: export sanitizes it and keeps the hash version.
      const legacy = restamp({ ...old, input: { device: { label: 'mic', id: 'raw-id' },
        constraints: { requested: null, applied: null } } }, version);
      const out = exportableExperiment(legacy);
      assert.equal(hash.resultHashVersionOf(out), version);
      decode(schema.experimentToJson(out));
    }
    const v3 = restamp({ ...c.experiment, input: { device: { label: 'mic', id: 'raw-id' },
      constraints: { requested: null, applied: null } } }, 3);
    const out = exportableExperiment(v3);
    assert.equal(out.provenance.resultHashVersion, 3);
    assert.doesNotMatch(schema.experimentToJson(out), /raw-id/);
    decode(schema.experimentToJson(out));
  });

// ---------------------------------------------------------------- migration 1 → 2

test('ADR 0040: schema 1 records and export files migrate to schema 2 and still verify',
  async () => {
    const { a } = await fx();
    assert.equal(schema.EXPERIMENT_SCHEMA_VERSION, 3);
    assert.equal(typeof migrate.migrations[2], 'function');
    for (const version of [1, 2]) {
      const old = schema1Doc(a.experiment, version);
      const text = JSON.stringify(old, null, 2);
      const v = decode(text);
      assert.equal(v.migratedFrom, 1);
      assert.equal(v.experiment.schemaVersion, 3);
      assert.deepEqual(v.experiment.measurement.runs.map((r) => r.id),
        ['run-1', 'run-2', 'run-3']);
      assert.equal(v.experiment.provenance.resultHash, old.provenance.resultHash,
        'the stored hash is kept');
      assert.equal(hash.resultHashVersionOf(v.experiment), version);
      assert.equal('sourceDigest' in v.experiment.provenance.build, false, 'not invented');
      // The migrated record re-exports as a valid schema-3 file with the same hash.
      const again = decode(schema.experimentToJson(v.experiment));
      assert.equal(again.migratedFrom, null);
      assert.equal(again.experiment.provenance.resultHash, old.provenance.resultHash);
      // The step itself: ids only, input untouched.
      const before = JSON.stringify(old);
      const m = migrate.migrateExperiment(old);
      assert.deepEqual(m.applied, [2, 3]);
      assert.equal(JSON.stringify(old), before);
      const stripped = clone(m.experiment);
      stripped.measurement.runs = stripped.measurement.runs.map(({ id, ...rest }) => rest);
      assert.equal(stripped.definition.derived, true, 'ADR 0043: derived, never authored');
      delete stripped.definition;
      assert.deepEqual({ ...stripped, schemaVersion: 1 }, old);
    }
  });

test('ADR 0040: a schema 1 record stored before the upgrade reads, annotates and stays immutable',
  async () => {
    const { b } = await fx();
    const fake = fakeIndexedDB();
    const s = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'old', ...OPTS });
    await s.put(b.experiment);
    const old = schema1Doc(b.experiment, 2);
    fake.dbs.get('old').stores.get('experiments').data.set('fixture-b', clone(old));
    const read = await s.get('fixture-b');
    assert.equal(read.schemaVersion, 3);
    assert.equal(read.measurement.runs[0].id, 'run-1');
    assert.equal(await s.put(read), 'fixture-b', 'the same run again is a no-op');
    await assert.rejects(s.put(restamp({ ...read, quality: { ...read.quality, status: 'GOOD' } },
      2)), (err) => err.code === 'immutable' && err.fields.includes('quality.status'));
    const named = await s.annotate('fixture-b', { name: 'renamed old run' });
    assert.equal(named.provenance.resultHash, old.provenance.resultHash);
    assert.equal(named.provenance.resultHashVersion, 2);
    const raw = fake.dbs.get('old').stores.get('experiments').data.get('fixture-b');
    assert.equal(raw.schemaVersion, 3, 'written back in the current schema');
    decode(raw);
  });

// ---------------------------------------------------------------- build provenance

test('ADR 0040: provenance.build records sourceDigest and, when stamped, artifactSha256',
  async () => {
    const { a } = await fx();
    const stamped = resolveBuild({ regionText: STAMPED_REGION });
    const source = resolveBuild({ defined: { version: '9.9.9', sourceDigest: DIGEST } });
    assert.deepEqual(schema.normalizeBuild(stamped), { version: '9.9.9', commit: 'f'.repeat(40),
      shortCommit: 'fffffff', sourceDate: '2026-10-04T00:00:00Z', channel: 'production',
      dirty: null, repository: null, sourceDigest: DIGEST, artifactSha256: ARTIFACT });
    const nb = schema.normalizeBuild(source);
    assert.equal(nb.sourceDigest, DIGEST);
    assert.equal(nb.artifactSha256, null, 'a source build is not stamped');
    assert.equal(schema.normalizeBuild({ version: '1.0.0', sourceDigest: 'xyz' }).sourceDigest,
      null, 'malformed is null');
    const e = experimentFromResult(a.result, { now: NOW, id: 'built', build: stamped });
    assert.equal(e.provenance.build.sourceDigest, DIGEST);
    assert.equal(e.provenance.build.artifactSha256, ARTIFACT);
    const v = decode(schema.experimentToJson(e));
    assert.deepEqual(v.experiment.provenance.build, e.provenance.build);
    for (const [k, bad] of [['sourceDigest', 'abc'], ['artifactSha256', 'A'.repeat(64)],
      ['sourceDigest', 7]]) {
      const d = docOf(e);
      d.provenance.build[k] = bad;
      const r = validateExperiment(d, OPTS);
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((x) => x.path === `provenance.build.${k}`), JSON.stringify(r.errors));
    }
    const old = schema1Doc(e, 2);
    assert.equal('sourceDigest' in old.provenance.build, false);
    decode(old);
  });

// ---------------------------------------------------------------- round trip

test('ADR 0040: serialize → import → verify round-trips an annotated duplicate', async () => {
  const { c } = await fx();
  const e = schema.annotateExperiment(schema.duplicateExperiment(c.experiment, { id: 'dup-c',
    name: 'C again' }), { notes: 'Copied for a report.\nSecond line.' });
  const json = schema.experimentToJson(e, 2);
  const v = decode(json);
  assert.equal(v.migratedFrom, null);
  assert.deepEqual(v.experiment, e);
  assert.equal(schema.experimentToJson(v.experiment, 2), json, 'byte-stable re-export');
  const s = store.createMemoryStore(OPTS);
  await s.put(v.experiment);
  assert.deepEqual(await s.get('dup-c'), e);
  assert.equal(hash.resultHash(v.experiment), c.experiment.provenance.resultHash);
});
