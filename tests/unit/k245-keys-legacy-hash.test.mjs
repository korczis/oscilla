// K245: a Studio record saved with a Keys node in v3.15.0-v3.27.x opens again. #447 (v3.28.0)
// gave the released Keys type keyLow and keyHigh with no hash epoch, so such a record matched no
// epoch's hash and loadProject called it corrupt (and an experiment's Studio block failed to
// verify). The records in fixtures/k245-keys-records.json are what v3.27.0 and v3.28.0 saved,
// made by their own src. After: a record matches its epoch's hash with the unepoched keys left
// out when the model holds them at their defaults (schema.js UNEPOCHED_PARAMS); a v3.28+ record
// still verifies as before, and one holding a key off its default never takes that path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as schema from '../../src/js/studio/schema.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { createStudioLibrary } from '../../src/js/studio/library.js';
import { createMemoryStore } from '../../src/js/experiments/store.js';
import { verifyExperimentStudio } from '../../src/js/studio/provenance.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';

const RECORDS = JSON.parse(readFileSync(new URL('./fixtures/k245-keys-records.json',
  import.meta.url), 'utf8'));
const V27 = RECORDS['v3.27.0'];
const V28 = RECORDS['v3.28.0'];
const { STUDIO_HASH_VERSION, STUDIO_KIND, UNEPOCHED_PARAMS, hashEpochOf, studioHash } = schema;

async function load(rec, id = 'p') {
  const store = createMemoryStore();
  const lib = createStudioLibrary(store);
  await store.putStudio({ id, kind: STUDIO_KIND, name: 'Keys', savedAt: '2026-11-05T00:00:00.000Z',
    studioHash: rec.studioHash, doc: rec.doc });
  return { r: await lib.loadProject(id), store };
}

test('the fixtures are what they say: v3.27.0 Keys without the key range, both at epoch 1', () => {
  assert.equal(V27.hashVersion, 1);
  assert.equal(V28.hashVersion, 1);
  assert.deepEqual(Object.keys(V27.keysParams).sort(), ['glide', 'priority', 'transpose']);
  assert.deepEqual(Object.keys(V28.keysParams).sort(),
    ['glide', 'keyHigh', 'keyLow', 'priority', 'transpose']);
  assert.ok(V27.project.doc.graph.nodes.some((n) => n.type === 'keys'), 'a Keys node is saved');
});

test('a project saved with a Keys node in v3.27.0 opens migrated, its hash kept', async () => {
  const { r, store } = await load(V27.project);
  assert.deepEqual(r.hashMigration, { from: 1, originalHash: V27.project.studioHash });
  const keys = r.model.graph.nodes.find((n) => n.type === 'keys');
  assert.equal(keys.params.keyLow, 0, 'the key range comes back at its defaults');
  assert.equal(keys.params.keyHigh, 127);
  assert.equal((await store.getStudio('p')).studioHash, V27.project.studioHash,
    'the stored record is not rewritten');
});

test('an experiment whose Studio block v3.27.0 wrote with a Keys node verifies migrated', () => {
  const r = verifyExperimentStudio({ studio: V27.experimentStudio });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.hashMigration.from, 1);
  assert.equal(r.hashMigration.originalHash, V27.experimentStudio.studioHash);
});

test('a v3.28.0 record (key range saved) still verifies at epoch 1, as before', async () => {
  const { r } = await load(V28.project);
  assert.deepEqual(r.hashMigration, { from: 1, originalHash: V28.project.studioHash });
  const v = verifyExperimentStudio({ studio: V28.experimentStudio });
  assert.deepEqual(v.errors, []);
  // A record saved now carries the current epoch's hash and opens with no migration.
  const m = importStudio(V28.project.doc).model;
  assert.equal(hashEpochOf(m, studioHash(m)), STUDIO_HASH_VERSION);
});

test('a key off its default never takes the unepoched path: a tampered record is corrupt',
  async () => {
    const doc = structuredClone(V27.project.doc);
    doc.graph.nodes.find((n) => n.type === 'keys').params.keyLow = 36;
    await assert.rejects(load({ studioHash: V27.project.studioHash, doc }),
      /does not match its stored studioHash/);
    const other = structuredClone(V27.project.doc);
    other.graph.nodes.find((n) => n.type === 'keys').params.transpose = 7;
    await assert.rejects(load({ studioHash: V27.project.studioHash, doc: other }),
      /does not match its stored studioHash/, 'any other change is still caught');
    const block = structuredClone(V27.experimentStudio);
    block.studioHash = V28.experimentStudio.studioHash;
    assert.equal(verifyExperimentStudio({ studio: block }).ok, false,
      'an experiment block carrying another record\'s hash is refused');
  });

test('UNEPOCHED_PARAMS is closed: only the Keys key range of #447, at epoch 1', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(UNEPOCHED_PARAMS)),
    [{ epoch: 1, params: { keys: ['keyLow', 'keyHigh'] } }]);
  assert.ok(Object.isFrozen(UNEPOCHED_PARAMS));
  for (const k of ['keyLow', 'keyHigh']) assert.ok(NODE_REGISTRY.param('keys', k), k);
});
