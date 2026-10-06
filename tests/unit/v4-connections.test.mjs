// Connected records (ADR 0048, ledger item 4 "cross-domain Trace over real stored relations"):
// from any stored record, what it is connected to (upstream) and what depends on it
// (downstream), each connection from one stored field that it names, with a state in words.
//
//   - the record link: one stored record in the URL hash, refused whole when malformed;
//   - runLinks: the references a run stores, kept on each list row of the store;
//   - connectionsOf: run (definition, repeat, duplicate, Studio by recomputed hash, frequency
//     profile, build; findings, repeats and duplicates downstream), definition (the runs that
//     executed it), finding (the runs it cites), Studio project (the runs measured from it);
//     present / missing / mismatch; nothing inferred from names, recipes or times; bounded;
//   - navigation: the records domain of the one hash dispatcher (ADR 0045);
//   - the workspace adapter over the stores, legacy list rows, Studio projects and the page.
//   node --test tests/unit/v4-connections.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as C from '../../src/js/experiments/connections.js';
import {
  RECORD_LINK_KEYS, decodeRecordLink, encodeRecordLink, withoutRecordParams,
} from '../../src/js/core/url-state-records.js';
import {
  HASH_DOMAINS, hashAfterRefusal, hashForWorkspace, routeOfHash,
} from '../../src/js/ui/navigation.js';
import { createMemoryStore, summaryRecord } from '../../src/js/experiments/store.js';
import { serializeExperiment, experimentToJson } from '../../src/js/experiments/schema.js';
import { createFinding } from '../../src/js/experiments/findings.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { createFindingsUi } from '../../src/js/ui/findings.js';
import { createConnectionsUi } from '../../src/js/ui/connections.js';
import { createStudioLibrary } from '../../src/js/studio/library.js';
import { studioProvenance, withStudioProvenance } from '../../src/js/studio/provenance.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import { buildFixtures, NOW } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const H = (c) => c.repeat(64);

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

// ---------------------------------------------------------------- plain records for the pure part

/** A run as connections.js reads it (the fields it reads, nothing else). */
function run(id, over = {}) {
  const { provenance = {}, ...rest } = over;
  return { experimentId: id, name: `Run ${id}`,
    definition: { id: `derived-${id}`, version: 1, hash: H('d'), derived: true },
    provenance: { resultHash: H('1'), repeatOf: null, ...provenance }, ...rest };
}
const row = (e) => ({ experimentId: e.experimentId, name: e.name,
  definition: e.definition ? { id: e.definition.id, version: e.definition.version,
    hash: e.definition.hash, derived: e.definition.derived } : undefined,
  links: C.runLinks(e), readable: true });
const def = (id, hashes, name = 'Room sweep') => ({ kind: 'oscilla-definition', schemaVersion: 1,
  id, name, notes: null, createdAt: NOW,
  versions: hashes.map((hash, i) => ({ version: i + 1, hash, createdAt: NOW, execution: {} })) });
const finding = (id, evidence, runs, statement = 'A falls above 6 kHz.') => createFinding({ id,
  now: NOW, statement, status: 'hypothesis', evidence, runs });
const index = (runs, over = {}) => ({ runs: runs.map(row), definitions: [],
  unreadableDefinitions: [], findings: [], studio: { projects: [], unreadable: [] },
  build: null, profile: null, ...over });
const of = (list, relation) => list.filter((c) => c.relation === relation);
const one = (list, relation) => {
  const x = of(list, relation);
  assert.equal(x.length, 1, `exactly one ${relation}: ${JSON.stringify(list)}`);
  return x[0];
};

// ---------------------------------------------------------------- the record link

test('a record link names one stored record, and is refused whole when malformed', () => {
  assert.deepEqual(RECORD_LINK_KEYS, { run: 'run', definition: 'def', finding: 'finding' });
  for (const kind of ['run', 'definition', 'finding']) {
    const h = encodeRecordLink({ kind, id: 'abc-1.x_2' });
    assert.deepEqual(decodeRecordLink(`#${h}`), { ok: true, kind, id: 'abc-1.x_2' });
    assert.equal(new URLSearchParams(h).get('m'), 'experiments');
  }
  assert.equal(decodeRecordLink('#m=measure&mr=x'), null, 'no record key: not a record link');
  for (const [hash, re] of [
    ['run=a&run=b', /"run" appears more than once/],
    ['run=a&def=b', /names one record/],
    ['m=measure&run=a', /opens the Experiments workspace/],
    ['run=', /empty/],
    ['finding=..%2Fx', /is not a record id/],
    ['def=%3Cscript%3E', /is not a record id/],
  ]) {
    const r = decodeRecordLink(hash);
    assert.equal(r.ok, false, hash);
    assert.ok(r.errors.some((e) => re.test(e)), `${hash}: ${r.errors}`);
  }
  assert.throws(() => encodeRecordLink({ kind: 'run', id: '<x>' }), RangeError);
  assert.throws(() => encodeRecordLink({ kind: 'studio', id: 'p-1' }), RangeError);
  assert.equal(withoutRecordParams('m=experiments&run=a&v=1&f=440'), 'm=experiments&v=1&f=440');
});

test('navigation: the records domain is dispatched last; its keys leave with Experiments', () => {
  assert.deepEqual([...HASH_DOMAINS], ['instrument', 'measure', 'studio', 'records']);
  assert.deepEqual(routeOfHash('#run=abc'), { workspace: 'experiments', owner: 'records' });
  assert.deepEqual(routeOfHash('#m=experiments&def=abc'), { workspace: 'experiments',
    owner: 'workspace' });
  assert.equal(routeOfHash('#m=studio&run=abc').workspace, 'studio', 'm decides');
  const off = new URLSearchParams(hashForWorkspace('m=experiments&run=a&v=1', 'measure'));
  assert.equal(off.get('run'), null, 'off Experiments the record key would be refused');
  assert.equal(off.get('v'), '1');
  assert.equal(new URLSearchParams(hashForWorkspace('m=experiments&run=a', 'experiments'))
    .get('run'), 'a');
  const refused = new URLSearchParams(hashAfterRefusal('#m=experiments&run=a&run=b',
    { records: false }, 'experiments'));
  assert.equal(refused.get('run'), null, 'a refused record link is not kept');
});

// ---------------------------------------------------------------- runLinks and the store rows

test('runLinks: what a run stores about other records, nothing more', async () => {
  const { a } = await fx();
  assert.deepEqual(C.runLinks(a.experiment), { resultHash: a.experiment.provenance.resultHash,
    repeatOf: null, duplicateOf: null, studio: null });
  const s = withStudioProvenance(a.experiment, templateModel('measurement-sweep'));
  const l = C.runLinks(s);
  assert.equal(l.studio.hash, s.studio.studioHash);
  assert.deepEqual(l.studio.measured, { v: s.studio.measured.v, hash: s.studio.measured.hash });
  assert.deepEqual(C.runLinks(serializeExperiment(s)), l, 'the same from a stored document');
  assert.deepEqual(C.runLinks(run('x', { provenance: { repeatOf: 'o', duplicateOf: 'd' } })),
    { resultHash: H('1'), repeatOf: 'o', duplicateOf: 'd', studio: null });
  assert.deepEqual(C.runLinks(null), { resultHash: null, repeatOf: null, duplicateOf: null,
    studio: null });
});

test('the store keeps each run\'s links on its list row (no record read to find dependents)',
  async () => {
    const { a } = await fx();
    const doc = serializeExperiment(a.experiment);
    assert.deepEqual(summaryRecord(doc, 10).links, C.runLinks(doc));
    const store = createMemoryStore(OPTS);
    await store.put(a.experiment);
    const [r] = await store.list();
    assert.deepEqual(r.links, C.runLinks(a.experiment));
  });

// ---------------------------------------------------------------- run: upstream

test('run: the definition it was executed from, present, mismatched, missing or unreadable', () => {
  const r = run('r1', { definition: { id: 'def-1', version: 2, hash: H('b'), derived: false } });
  const cases = [
    [{ definitions: [def('def-1', [H('a'), H('b')])] }, 'present', /stored with the same hash/],
    [{ definitions: [def('def-1', [H('a'), H('c')])] }, 'mismatch', /has no version 2 with/],
    [{}, 'missing', /not stored in this browser/],
    [{ unreadableDefinitions: ['def-1'] }, 'unreadable', /cannot be read/],
  ];
  for (const [over, state, re] of cases) {
    const c = one(C.connectionsOf({ kind: 'run', record: r }, index([r], over)).upstream,
      'definition');
    assert.equal(c.state, state);
    assert.match(c.text, re);
    assert.equal(c.text.startsWith(C.STATE_WORDS[state]), true, 'the state comes first, in words');
    assert.equal(c.field, 'definition (id, version and hash)');
    assert.equal(c.fieldOf, 'this run');
    assert.deepEqual(c.to, { kind: 'definition', id: 'def-1', version: 2 });
    assert.equal(c.href, ['missing', 'unreadable'].includes(state) ? null
      : '#m=experiments&def=def-1');
  }
  const derived = C.connectionsOf({ kind: 'run', record: run('r2') }, index([run('r2')]));
  assert.equal(of(derived.upstream, 'definition').length, 0, 'a derived definition is no record');
  assert.ok(derived.notes.some((n) => n.field === 'definition.derived'
    && /derived from its own recipe/.test(n.text)));
});

test('run: repeat and duplicate links by the stored id; a missing original stays listed', () => {
  const orig = run('orig');
  const rep = run('rep', { provenance: { repeatOf: 'orig', resultHash: H('2') } });
  const dup = run('dup', { provenance: { duplicateOf: 'orig' } });
  const ix = index([orig, rep, dup]);
  const r = one(C.connectionsOf({ kind: 'run', record: rep }, ix).upstream, 'repeat-of');
  assert.equal(r.state, 'unverifiable', 'a repeat records no identity of its original');
  assert.equal(r.field, 'provenance.repeatOf');
  assert.match(r.text, /^not verifiable: .*by id only/);
  assert.equal(r.href, '#m=experiments&run=orig');
  const d = one(C.connectionsOf({ kind: 'run', record: dup }, ix).upstream, 'duplicate-of');
  assert.equal(d.state, 'present');
  assert.match(d.text, /result hash recorded, recomputed when it was read/);
  // A different record stored under the original's id: a duplicate keeps the original's hash.
  const other = index([run('orig', { provenance: { resultHash: H('9') } }), dup]);
  assert.equal(one(C.connectionsOf({ kind: 'run', record: dup }, other).upstream, 'duplicate-of')
    .state, 'mismatch');
  // The original deleted: the reference is still there, and reads missing.
  const gone = one(C.connectionsOf({ kind: 'run', record: rep }, index([rep])).upstream,
    'repeat-of');
  assert.equal(gone.state, 'missing');
  assert.equal(gone.href, null);
  assert.match(gone.text, /^missing: not stored in this browser/);
  // Stored but unreadable (fails validation, or its hash does not verify): never fine.
  const bad = index([orig, dup]);
  Object.assign(bad.runs[0], { readable: false, reason: 'stored experiment orig is invalid' });
  const u = one(C.connectionsOf({ kind: 'run', record: dup }, bad).upstream, 'duplicate-of');
  assert.equal(u.state, 'unreadable');
  assert.match(u.text, /^unreadable: .*cannot be read \(stored experiment orig is invalid\)/);
  // Stored, but not read: never shown as verified.
  delete bad.runs[0].readable;
  assert.equal(one(C.connectionsOf({ kind: 'run', record: dup }, bad).upstream, 'duplicate-of')
    .state, 'unverifiable');
  // A hash missing on either side cannot verify an identity.
  const unst = index([run('orig', { provenance: { resultHash: null } }), dup]);
  assert.equal(one(C.connectionsOf({ kind: 'run', record: dup }, unst).upstream, 'duplicate-of')
    .state, 'unverifiable');
});

test('nothing is inferred: the same name, recipe, definition or time is no connection', () => {
  const a = run('a', { name: 'Same', recipe: { x: 1 } });
  const b = run('b', { name: 'Same', recipe: { x: 1 } });
  const out = C.connectionsOf({ kind: 'run', record: a }, index([a, b]));
  assert.deepEqual(out.upstream, []);
  assert.deepEqual(out.downstream, []);
});

test('run: Studio projects by the hash recomputed over them, whole graph or measured path', () => {
  const model = templateModel('measurement-sweep');
  const p = studioProvenance(model);
  const r = run('s', { studio: { studioHash: p.studioHash, measured: p.measured } });
  const proj = (id, studioHash, measured) => ({ id, name: `P ${id}`, studioHash, measured });
  const ix = index([r], { studio: { projects: [proj('whole', p.studioHash, { v: 1,
    hash: p.measured.hash }), proj('path', H('e'), { v: 1, hash: p.measured.hash }),
  proj('other', H('f'), { v: 1, hash: H('0') })], unreadable: [] } });
  const up = C.connectionsOf({ kind: 'run', record: r }, ix).upstream;
  const g = one(up, 'studio-graph');
  assert.deepEqual([g.state, g.to, g.field], ['present', { kind: 'studio', id: 'whole' },
    'studio.studioHash']);
  assert.deepEqual(g.open, { kind: 'studio', id: 'whole' });
  const m = one(up, 'studio-path');
  assert.deepEqual([m.state, m.to.id, m.field], ['present', 'path', 'studio.measured.hash']);
  assert.match(m.text, /other parts of its graph differ/);
  // No project holds the graph: one missing connection, never nothing.
  const none = C.connectionsOf({ kind: 'run', record: r }, index([r])).upstream;
  const miss = one(none, 'studio-graph');
  assert.equal(miss.state, 'missing');
  assert.match(miss.text, /no Studio project stored here has this graph or its measured path/);
  // The projects could not be read: said, not guessed.
  const unread = C.connectionsOf({ kind: 'run', record: r }, index([r], { studio: null }));
  assert.equal(of(unread.upstream, 'studio-graph').length, 0);
  assert.ok(unread.notes.some((n) => /could not be read/.test(n.text)));
  // A measured path of another version is not compared.
  const v9 = run('v9', { studio: { studioHash: H('a'), measured: { v: 9, hash: p.measured.hash } } });
  const out9 = C.connectionsOf({ kind: 'run', record: v9 }, index([v9], { studio: ix.studio }));
  assert.equal(of(out9.upstream, 'studio-path').length, 0);
  assert.ok(out9.notes.some((n) => /version 9/.test(n.text)));
});

test('run: the frequency profile by id (loaded or not) and the build (this one or another)', () => {
  const r = run('c', { calibration: { frequency: { id: H('7'), name: 'Mic A' }, level: null },
    provenance: { build: { version: '9.8.7', sourceDigest: H('s'), artifactSha256: null } } });
  const cur = { version: '9.8.7', sourceDigest: H('s'), artifactSha256: H('x') };
  const up = (over) => C.connectionsOf({ kind: 'run', record: r }, index([r], over)).upstream;
  assert.equal(one(up({ profile: { id: H('7'), name: 'Mic A' } }), 'profile').state, 'present');
  const p = one(up({ profile: { id: H('8'), name: 'Other' } }), 'profile');
  assert.equal(p.state, 'missing');
  assert.match(p.text, /keeps a frequency profile only while it is loaded/);
  assert.equal(p.field, 'calibration.frequency.id');
  assert.equal(one(up({ build: cur }), 'build').state, 'present');
  assert.equal(one(up({ build: { ...cur, sourceDigest: H('t') } }), 'build').state, 'mismatch');
  const older = one(up({ build: { ...cur, version: '9.9.0' } }), 'build');
  assert.equal(older.state, 'missing');
  assert.match(older.text, /this page runs OSCILLA 9\.9\.0/);
  assert.equal(one(up({ build: { ...cur, sourceDigest: null } }), 'build').state,
    'unverifiable');
  const none = C.connectionsOf({ kind: 'run', record: run('n') }, index([run('n')],
    { build: cur }));
  assert.ok(none.notes.some((n) => n.field === 'provenance.build'));
});

// ---------------------------------------------------------------- run: downstream

test('run: the findings citing it, the runs repeating or duplicating it', () => {
  const a = run('a');
  const rep = run('rep', { provenance: { repeatOf: 'a', resultHash: H('2') } });
  const dup = run('dup', { provenance: { duplicateOf: 'a' } });
  const f1 = finding('f-1', [{ kind: 'run', experimentId: 'a' },
    { kind: 'value', experimentId: 'a', at: { hz: 1000 } }],
  [{ experimentId: 'a', resultHash: H('1') }]);
  const f2 = finding('f-2', [{ kind: 'compare', a: 'rep', b: 'a' }],
    [{ experimentId: 'rep', resultHash: H('2') }, { experimentId: 'a', resultHash: H('9') }],
    'Other record');
  const out = C.connectionsOf({ kind: 'run', record: a }, index([a, rep, dup],
    { findings: [f1, f2] }));
  const cites = of(out.downstream, 'cited-by');
  assert.deepEqual(cites.map((c) => [c.to.id, c.state]), [['f-1', 'present'],
    ['f-2', 'mismatch']]);
  assert.equal(cites[0].field, 'evidence[0], evidence[1] (identity: runs[0].resultHash)');
  assert.equal(cites[0].fieldOf, 'that finding');
  assert.match(cites[0].text, /this run; its value at 1 kHz/);
  assert.match(cites[1].text, /different record/);
  assert.equal(cites[0].href, '#m=experiments&finding=f-1');
  const rb = one(out.downstream, 'repeated-by');
  assert.deepEqual([rb.to, rb.state], [{ kind: 'run', id: 'rep' }, 'unverifiable']);
  assert.equal(one(out.downstream, 'duplicated-as').state, 'present');
  for (const c of [...out.upstream, ...out.downstream]) {
    assert.ok(C.CONNECTION_STATES.includes(c.state));
    assert.ok(c.field && c.fieldOf && c.label && c.target && c.text, JSON.stringify(c));
  }
});

test('the lists are bounded, and what is left out is counted', () => {
  const a = run('a');
  const reps = Array.from({ length: C.CONNECTION_LIMIT + 7 }, (_, i) => run(`r${i}`,
    { provenance: { repeatOf: 'a' } }));
  const out = C.connectionsOf({ kind: 'run', record: a }, index([a, ...reps]));
  assert.equal(out.downstream.length, C.CONNECTION_LIMIT);
  assert.equal(out.more.downstream, 7);
  // A list row whose links could not be read is counted, not silently skipped.
  const ix = index([a, reps[0]]);
  ix.runs[1].links = null;
  const unread = C.connectionsOf({ kind: 'run', record: a }, ix);
  assert.equal(unread.downstream.length, 0);
  assert.ok(unread.notes.some((n) => /1 stored run could not be read/.test(n.text)));
});

// ---------------------------------------------------------------- the other subjects

test('definition: the runs that executed one of its versions', () => {
  const d = def('def-1', [H('a'), H('b')]);
  const r1 = run('r1', { definition: { id: 'def-1', version: 1, hash: H('a'), derived: false } });
  const r2 = run('r2', { definition: { id: 'def-1', version: 2, hash: H('c'), derived: false } });
  const r3 = run('r3');
  const out = C.connectionsOf({ kind: 'definition', record: d }, index([r1, r2, r3],
    { definitions: [d] }));
  assert.deepEqual(out.upstream, []);
  assert.ok(out.notes.some((n) => /stores no reference/.test(n.text)));
  assert.deepEqual(out.downstream.map((c) => [c.to.id, c.state]), [['r1', 'present'],
    ['r2', 'mismatch']]);
  assert.match(out.downstream[0].text, /version 1/);
  assert.equal(out.downstream[0].fieldOf, 'that run');
});

test('finding: each run it cites, by the identity it recorded', () => {
  const a = run('a');
  const b = run('b', { provenance: { resultHash: H('5') } });
  const f = finding('f-1', [{ kind: 'run', experimentId: 'a' },
    { kind: 'compare', a: 'a', b: 'b' }, { kind: 'run', experimentId: 'gone' },
    { kind: 'run', experimentId: 'def-x' }],
  [{ experimentId: 'a', resultHash: H('1') }, { experimentId: 'b', resultHash: H('6') },
    { experimentId: 'gone', resultHash: null }, { experimentId: 'def-x', resultHash: null }]);
  const out = C.connectionsOf({ kind: 'finding', record: f }, index([a, b],
    { definitions: [def('def-x', [H('a')])] }));
  assert.deepEqual(out.upstream.map((c) => [c.to.id, c.field, c.state]), [
    ['a', 'evidence[0].experimentId (identity: runs[0].resultHash)', 'present'],
    ['a', 'evidence[1].a (identity: runs[0].resultHash)', 'present'],
    ['b', 'evidence[1].b (identity: runs[1].resultHash)', 'mismatch'],
    ['gone', 'evidence[2].experimentId (identity: runs[2].resultHash)', 'missing'],
    ['def-x', 'evidence[3].experimentId (identity: runs[3].resultHash)', 'mismatch'],
  ]);
  assert.match(out.upstream[4].text, /names a stored definition, not a run/);
  assert.deepEqual(out.downstream, []);
  assert.ok(out.notes.some((n) => /No record stores a reference to a finding/.test(n.text)));
});

test('Studio project: the runs measured from its graph or holding its measured path', () => {
  const p = { id: 'p-1', name: 'Sweep', studioHash: H('a'), measured: { v: 1, hash: H('m') } };
  const whole = run('w', { studio: { studioHash: H('a'), measured: { v: 1, hash: H('m') } } });
  const path = run('p', { studio: { studioHash: H('b'), measured: { v: 1, hash: H('m') } } });
  const neither = run('n', { studio: { studioHash: H('c'), measured: { v: 1, hash: H('o') } } });
  const out = C.connectionsOf({ kind: 'studio', record: p }, index([whole, path, neither]));
  assert.deepEqual(out.downstream.map((c) => [c.relation, c.to.id, c.field]), [
    ['measured-graph', 'w', 'studio.studioHash'], ['measured-path', 'p', 'studio.measured.hash']]);
  assert.throws(() => C.connectionsOf({ kind: 'nope', record: {} }, {}), TypeError);
});

// ---------------------------------------------------------------- the workspace adapter

function harness() {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake.indexedDB;
  const cmp = {};
  for (const part of [createExperimentsUi(), createFindingsUi(), createConnectionsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  const notes = [];
  Object.assign(cmp, { notify: (kind, title, text) => notes.push({ kind, title, text }),
    $nextTick: (f) => f && f(), openModal() {}, closeModal() {}, setWorkspace() {},
    measureCurrentProfile: () => null, workspace: 'experiments' });
  cmp.experimentsInit();
  cmp.findingsInit();
  return { cmp, notes, fake };
}

test('the workspace: a duplicate, a finding and a deleted original, in both directions',
  async () => {
    const { a, b } = await fx();
    const { cmp } = harness();
    await cmp.experimentsImportText(a.json);
    await cmp.experimentsImportText(b.json);
    const dupId = await cmp.experimentsDuplicate('fixture-a');
    await cmp.findingsAskRun('fixture-a');
    cmp.fnd.form.statement = 'A falls above 6 kHz.';
    const saved = await cmp.findingsSave();
    assert.ok(saved, cmp.fnd.form.error);
    const fromA = await cmp.connectionsOfRun('fixture-a');
    assert.deepEqual(fromA.downstream.map((c) => [c.relation, c.to.id, c.state]), [
      ['cited-by', saved.id, 'present'], ['duplicated-as', dupId, 'present']]);
    const fromDup = await cmp.connectionsOfRun(dupId);
    assert.equal(one(fromDup.upstream, 'duplicate-of').state, 'present');
    const fromF = await cmp.connectionsOfFinding(saved.id);
    assert.equal(fromF.upstream[0].state, 'present');
    assert.equal(cmp.cnx.findings[saved.id].upstream.length, 1, 'kept for the finding row');
    // The original deleted: both references stay, and read missing.
    cmp.experimentsAskDelete({ id: 'fixture-a', name: 'A' });
    assert.equal(await cmp.experimentsDelete(), true);
    assert.equal(one((await cmp.connectionsOfRun(dupId)).upstream, 'duplicate-of').state,
      'missing');
    assert.equal((await cmp.connectionsOfFinding(saved.id)).upstream[0].state, 'missing');
    // A different record stored under the id: read again (not the earlier cached read).
    const { c } = await fx();
    const impostor = JSON.parse(c.json);
    impostor.experimentId = 'fixture-a';
    await cmp.experimentsImportText(JSON.stringify(impostor));
    const re = (await cmp.connectionsOfFinding(saved.id)).upstream[0];
    assert.equal(re.state, 'mismatch');
    assert.match(re.text, /^does not match: a different record is stored under this id/);
    assert.equal(one((await cmp.connectionsOfRun(dupId)).upstream, 'duplicate-of').state,
      'mismatch');
    assert.equal(JSON.stringify(cmp.cnx), JSON.stringify(JSON.parse(JSON.stringify(cmp.cnx))),
      'plain data for Alpine');
  });

test('the workspace: a list row written before links existed is read once from its record',
  async () => {
    const { a } = await fx();
    const { cmp } = harness();
    const store = createMemoryStore(OPTS);
    await store.put(a.experiment);
    let reads = 0;
    const legacy = { ...store,
      list: async () => (await store.list()).map(({ links, ...r }) => r),
      get: async (id) => { reads += 1; return store.get(id); } };
    cmp.experimentsStore = async () => legacy;
    const f = finding('f-1', [{ kind: 'run', experimentId: 'fixture-a' }],
      [{ experimentId: 'fixture-a', resultHash: H('0') }]);
    await store.putFinding(f);
    const out = await cmp.connectionsOfFinding('f-1');
    assert.equal(out.upstream[0].state, 'mismatch', 'the identity is checked from the record');
    await cmp.connectionsOfFinding('f-1');
    assert.equal(reads, 1, 'read once per id');
  });

test('the workspace: a run measured from Studio connects to the stored project', async () => {
  const { a } = await fx();
  const { cmp } = harness();
  const model = templateModel('measurement-sweep');
  const e = JSON.parse(experimentToJson(withStudioProvenance(a.experiment, model)));
  e.experimentId = 'from-studio';
  await cmp.experimentsImportText(JSON.stringify(e));
  const lib = createStudioLibrary(await cmp.experimentsStore());
  await lib.saveProject(model, { id: 'project-sweep', now: NOW });
  const up = (await cmp.connectionsOfRun('from-studio')).upstream;
  const g = one(up, 'studio-graph');
  assert.deepEqual([g.state, g.to.id], ['present', 'project-sweep']);
  const down = (await cmp.connectionsOfStudioProject('project-sweep')).downstream;
  assert.deepEqual(down.map((c) => [c.relation, c.to.id]), [['measured-graph', 'from-studio']]);
  // The project edited outside the measured path and saved again: the whole graph no longer
  // matches, the measured path still does (recomputed as the project loads).
  const edited = { ...model, graph: { ...model.graph, nodes: model.graph.nodes.map((n) => (
    n.id === 'result-1' ? { ...n, params: { ...n.params, smoothing: 3 } } : n)) } };
  await lib.saveProject(edited, { id: 'project-sweep', now: '2026-10-02T11:00:00.000Z' });
  const after = (await cmp.connectionsOfRun('from-studio')).upstream;
  assert.equal(of(after, 'studio-graph').length, 0);
  assert.deepEqual([one(after, 'studio-path').state, one(after, 'studio-path').to.id],
    ['present', 'project-sweep']);
  assert.deepEqual((await cmp.connectionsOfStudioProject('project-sweep')).downstream
    .map((c) => c.relation), ['measured-path']);
  // Saved again with the measured Sweep changed: no project holds it; that reads missing.
  const swept = { ...model, graph: { ...model.graph, nodes: model.graph.nodes.map((n) => (
    n.id === 'sweep-1' ? { ...n, params: { ...n.params, duration: 4 } } : n)) } };
  await lib.saveProject(swept, { id: 'project-sweep', now: '2026-10-02T12:00:00.000Z' });
  assert.equal(one((await cmp.connectionsOfRun('from-studio')).upstream, 'studio-graph').state,
    'missing');
});

test('the workspace: a record link opens the record; a malformed one is refused', async () => {
  const { a } = await fx();
  const { cmp, notes } = harness();
  await cmp.experimentsImportText(a.json);
  assert.equal(cmp.recordsApplyHash('#m=measure'), null, 'no record key: not this domain');
  assert.equal(cmp.recordsApplyHash('#m=experiments&run=a&def=b'), false);
  assert.match(notes.at(-1).text, /names one record/);
  assert.equal(cmp.recordsApplyHash('#m=experiments&run=fixture-a', 'link'), true);
  await cmp.cnxSettled();
  assert.equal(cmp.exps.detail.id, 'fixture-a');
  assert.equal(cmp.recordsApplyHash('#m=experiments&run=nope', 'link'), true);
  await cmp.cnxSettled();
  assert.match(notes.at(-1).text, /not stored in this browser/);
});

test('connected records are rendered as text, in every record view', () => {
  const html = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/js/ui/connections.js'), 'utf8');
  assert.ok(!/x-html/.test(html));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(ui));
  for (const osc of ['exp.connections', 'def.connections', 'fnd.connections']) {
    assert.match(html, new RegExp(`data-osc="${osc.replace('.', '\\.')}"`), osc);
  }
});
