// Findings (ADR 0046): a user's interpretive statement linked to the evidence it rests on, kept
// apart from measurement truth. A measurement is what was observed or computed; an observation is
// what the user recorded; a finding is an interpretation linked to evidence.
//
//   - validation: categorical status only, typed evidence references, evidence required for
//     supported / contradicted, the identity (id + result hash) of each cited run, unsafe input
//     (prototype pollution, HTML markup, control and bidirectional characters, sizes) refused;
//   - integrity: findingIssues names a missing (deleted, or never stored here) run, a reference
//     to something that is not a run, a different record under a cited id, a value reference to
//     a run without a stored response, and a claimed status none of whose evidence is here;
//   - the store: the findings object store (DB version 4) in memory and IndexedDB, an atomic
//     import, deletion of a cited run that never touches a finding, and the memory observer;
//   - export / import: the file round-trips with each cited run's id and result hash, a newer
//     schema is refused clearly, and one bad finding refuses the whole file;
//   - the workspace adapter: backlinks, the delete warning, the unsaved draft and the memory
//     fallback reported to the unsaved-work guard (ADR 0045).
//   node --test tests/unit/v4-findings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as F from '../../src/js/experiments/findings.js';
import {
  DB_VERSION, FINDINGS, ExperimentStoreError, createMemoryStore, observeMemoryStore,
  openExperimentStore, upgradeExperimentDb,
} from '../../src/js/experiments/store.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { createFindingsUi } from '../../src/js/ui/findings.js';
import { buildFixtures, NOW } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const LATER = '2026-10-02T11:00:00.000Z';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

/** A valid finding as plain JSON, with overrides. */
function raw(over = {}) {
  return {
    kind: F.FINDING_KIND, schemaVersion: F.FINDING_SCHEMA_VERSION, id: 'f-1',
    statement: 'The response falls above 6 kHz.', status: 'observation',
    evidence: [{ kind: 'run', experimentId: 'run-a' }],
    runs: [{ experimentId: 'run-a', resultHash: H1 }],
    notes: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}
const ok = (v) => {
  const r = F.validateFinding(v);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.errors));
  return r.finding;
};
const refused = (v, re, what) => {
  const r = F.validateFinding(v);
  assert.equal(r.ok, false, `${what}: refused`);
  assert.ok(r.errors.some((e) => re.test(`${e.path}: ${e.text}`)),
    `${what}: ${JSON.stringify(r.errors)}`);
};

// ---------------------------------------------------------------- validation

test('a finding is categorical: five statuses, no confidence number', () => {
  assert.deepEqual(F.FINDING_STATUSES, ['observation', 'hypothesis', 'supported',
    'contradicted', 'inconclusive']);
  for (const status of F.FINDING_STATUSES) assert.equal(ok(raw({ status })).status, status);
  refused(raw({ status: 'likely' }), /status: must be one of/, 'an unknown status');
  refused(raw({ status: 'SUPPORTED' }), /status/, 'case matters');
  refused({ ...raw(), confidence: 0.8 }, /confidence: unknown field/, 'a confidence number');
  refused(raw({ status: 3 }), /status/, 'a number as status');
});

test('supported and contradicted must cite evidence; the others need not', () => {
  for (const status of ['supported', 'contradicted']) {
    refused(raw({ status, evidence: [], runs: [] }), /evidence: .*at least one/,
      `${status} without evidence`);
    assert.equal(ok(raw({ status })).evidence.length, 1, `${status} with evidence`);
  }
  for (const status of ['observation', 'hypothesis', 'inconclusive']) {
    assert.deepEqual(ok(raw({ status, evidence: [], runs: [] })).evidence, [], status);
  }
  assert.deepEqual(F.EVIDENCE_REQUIRED_STATUSES, ['supported', 'contradicted']);
});

test('evidence references are typed and unambiguous', () => {
  const compare = { kind: 'compare', a: 'run-a', b: 'run-b' };
  const value = { kind: 'value', experimentId: 'run-a', at: { hz: 1000 } };
  const both = [{ experimentId: 'run-a', resultHash: H1 }, { experimentId: 'run-b',
    resultHash: H2 }];
  const f = ok(raw({ evidence: [{ kind: 'run', experimentId: 'run-a' }, compare, value],
    runs: both }));
  assert.deepEqual(f.evidence.map((r) => r.kind), ['run', 'compare', 'value']);
  assert.deepEqual(F.citedRunIds(f), ['run-a', 'run-b']);
  refused(raw({ evidence: [{ kind: 'compare', a: 'run-a', b: 'run-a' }] }),
    /evidence\[0\].*two different runs/, 'a run compared with itself');
  refused(raw({ evidence: [{ kind: 'run', experimentId: 'run-a', hz: 3 }] }),
    /evidence\[0\]\.hz: unknown field/, 'an extra field');
  refused(raw({ evidence: [{ kind: 'definition', id: 'd' }] }), /evidence\[0\]\.kind/,
    'an unknown kind');
  refused(raw({ evidence: [{ kind: 'run' }] }), /evidence\[0\]\.experimentId: missing/,
    'a reference without its run');
  refused(raw({ evidence: [{ kind: 'run', experimentId: '../x' }] }),
    /evidence\[0\]\.experimentId: has an invalid format/, 'an id that is not an id');
  for (const hz of [0, -1, Infinity, 'x', 200000]) {
    refused(raw({ evidence: [{ kind: 'value', experimentId: 'run-a', at: { hz } }] }),
      /evidence\[0\]\.at\.hz/, `value at ${hz}`);
  }
  refused(raw({ evidence: [{ kind: 'run', experimentId: 'run-a' }, { kind: 'run',
    experimentId: 'run-a' }] }), /evidence\[1\]: .*already cited/, 'a duplicate reference');
  refused(raw({ evidence: Array.from({ length: F.FINDING_LIMITS.evidence + 1 },
    (_, i) => ({ kind: 'run', experimentId: `r${i}` })), runs: Array.from({ length:
    F.FINDING_LIMITS.evidence + 1 }, (_, i) => ({ experimentId: `r${i}`, resultHash: null })) }),
  /evidence: more than/, 'too many references');
});

test('each cited run carries its identity (id + result hash), exactly once', () => {
  refused(raw({ runs: [] }), /runs: .*run-a/, 'a cited run without its identity');
  refused(raw({ runs: [{ experimentId: 'run-a', resultHash: H1 }, { experimentId: 'run-z',
    resultHash: H1 }] }), /runs\[1\]: .*not cited/, 'an identity of a run that is not cited');
  refused(raw({ runs: [{ experimentId: 'run-a', resultHash: H1 }, { experimentId: 'run-a',
    resultHash: H1 }] }), /runs\[1\]/, 'a duplicate identity');
  refused(raw({ runs: [{ experimentId: 'run-a', resultHash: 'nope' }] }),
    /runs\[0\]\.resultHash/, 'a hash that is not a SHA-256');
  assert.equal(ok(raw({ runs: [{ experimentId: 'run-a', resultHash: null }] })).runs[0]
    .resultHash, null, 'an unstamped run has no hash');
});

test('unsafe input is refused: prototype pollution, markup, control characters, sizes', () => {
  const polluted = JSON.parse(`{"kind":"${F.FINDING_KIND}","schemaVersion":1,"id":"f-1",`
    + '"statement":"x","status":"observation","evidence":[],"runs":[],"notes":null,'
    + `"createdAt":"${NOW}","updatedAt":"${NOW}","__proto__":{"polluted":true}}`);
  refused(polluted, /__proto__: unknown field/, '__proto__ on the finding');
  const ref = JSON.parse('{"kind":"run","experimentId":"run-a","__proto__":{"polluted":1}}');
  refused(raw({ evidence: [ref] }), /evidence\[0\]\.__proto__: unknown field/,
    '__proto__ on a reference');
  refused({ ...raw(), constructor: { prototype: { polluted: 1 } } }, /constructor: unknown/,
    'constructor');
  assert.equal(({}).polluted, undefined, 'nothing reached Object.prototype');
  refused(Object.assign(Object.create({ inherited: 1 }), raw()), /must be an object/,
    'an object with a foreign prototype');
  for (const s of ['<script>alert(1)</script>', 'see <img src=x onerror=alert(1)>',
    '<!-- x -->', 'a</p>', '<svg/onload=alert(1)>']) {
    refused(raw({ statement: s }), /statement: .*markup/, `statement ${s}`);
    refused(raw({ notes: s }), /notes: .*markup/, `notes ${s}`);
  }
  for (const s of ['A < B by 3 dB', 'level <= -20 dB', 'x < 1 kHz & y > 2 kHz', 'a <-> b']) {
    assert.equal(ok(raw({ statement: s })).statement, s, `plain text ${s}`);
  }
  refused(raw({ statement: 'a\u0000b' }), /statement: contains control/, 'NUL');
  refused(raw({ statement: 'two\nlines' }), /statement: contains control/,
    'a statement is one line');
  assert.equal(ok(raw({ notes: 'two\nlines' })).notes, 'two\nlines', 'notes may wrap');
  refused(raw({ statement: 'abc‮dcb' }), /statement: .*bidirectional/, 'a bidi override');
  refused(raw({ statement: '   ' }), /statement: must not be empty/, 'blank');
  refused(raw({ statement: 'x'.repeat(F.FINDING_LIMITS.statementChars + 1) }),
    /statement: longer than/, 'too long');
  refused(raw({ notes: 'x'.repeat(F.FINDING_LIMITS.notesChars + 1) }), /notes: longer than/,
    'notes too long');
  refused(raw({ updatedAt: '2026-10-01T00:00:00.000Z' }), /updatedAt: .*before createdAt/,
    'updated before created');
  refused(raw({ id: '__proto__' }), /id: has an invalid format/, 'an id that is a key');
});

test('a finding from a newer schema is refused with the reason, not misread', () => {
  const r = F.validateFinding(raw({ schemaVersion: F.FINDING_SCHEMA_VERSION + 1 }));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].text, /newer than this OSCILLA reads/);
  refused(raw({ kind: 'oscilla-experiment' }), /kind: must be oscilla-finding/, 'another kind');
});

test('create and update: the id and creation time stay, updatedAt moves, input is trimmed', () => {
  const f = F.createFinding({ id: 'f-9', now: NOW, statement: '  Falls above 6 kHz. ',
    status: 'hypothesis' });
  assert.deepEqual({ ...f }, { kind: F.FINDING_KIND, schemaVersion: F.FINDING_SCHEMA_VERSION,
    id: 'f-9', statement: 'Falls above 6 kHz.', status: 'hypothesis', evidence: [], runs: [],
    notes: null, createdAt: NOW, updatedAt: NOW });
  assert.throws(() => F.createFinding({ id: 'f-9', now: NOW, statement: 'x',
    status: 'supported' }), /at least one/);
  const g = F.updateFinding(f, { status: 'supported', evidence: [{ kind: 'run',
    experimentId: 'run-a' }], runs: [{ experimentId: 'run-a', resultHash: H1 }] },
  { now: LATER });
  assert.equal(g.id, 'f-9');
  assert.equal(g.createdAt, NOW);
  assert.equal(g.updatedAt, LATER);
  assert.equal(g.status, 'supported');
  assert.equal(f.status, 'hypothesis', 'the input is not mutated');
  assert.throws(() => F.updateFinding(f, { id: 'other' }, { now: LATER }), /id/);
});

// ---------------------------------------------------------------- integrity

/** A lookup over a table { id: { kind, name, resultHash, hasResponse } }. */
const lookupOf = (table) => (id) => (Object.prototype.hasOwnProperty.call(table, id)
  ? table[id] : null);
const RUNS = {
  'run-a': { kind: 'run', name: 'A', resultHash: H1, hasResponse: true },
  'run-b': { kind: 'run', name: 'B', resultHash: H2, hasResponse: true },
  'def-1': { kind: 'definition', name: 'Desk speaker' },
};
const both = [{ experimentId: 'run-a', resultHash: H1 }, { experimentId: 'run-b',
  resultHash: H2 }];

test('findingIssues: a whole finding has none', () => {
  const f = ok(raw({ status: 'supported', evidence: [{ kind: 'run', experimentId: 'run-a' },
    { kind: 'compare', a: 'run-a', b: 'run-b' }, { kind: 'value', experimentId: 'run-b',
      at: { hz: 1000 } }], runs: both }));
  assert.deepEqual(F.findingIssues(f, lookupOf(RUNS)), []);
});

test('findingIssues: a deleted or never-stored run reads as missing, never as nothing', () => {
  const f = ok(raw({ status: 'supported', evidence: [{ kind: 'compare', a: 'run-a',
    b: 'run-b' }], runs: both }));
  const { 'run-b': gone, ...rest } = RUNS; // eslint-disable-line no-unused-vars
  const issues = F.findingIssues(f, lookupOf(rest));
  assert.deepEqual(issues.map((i) => [i.code, i.index, i.experimentId]),
    [['missing-run', 0, 'run-b'], ['unsupported-status', null, null]]);
  assert.match(issues[0].text, /^missing: run "?run-b"? is not stored here/);
  assert.match(issues[1].text, /supported.*none of the evidence it cites can be checked here/);
  // A finding whose other evidence is here keeps its status without that issue.
  const g = ok(raw({ status: 'supported', evidence: [{ kind: 'run', experimentId: 'run-a' },
    { kind: 'run', experimentId: 'run-b' }], runs: both }));
  assert.deepEqual(F.findingIssues(g, lookupOf(rest)).map((i) => i.code), ['missing-run']);
});

test('findingIssues: wrong kind, a different record, a value without a response', () => {
  const wrong = ok(raw({ evidence: [{ kind: 'run', experimentId: 'def-1' }],
    runs: [{ experimentId: 'def-1', resultHash: null }] }));
  const [w] = F.findingIssues(wrong, lookupOf(RUNS));
  assert.equal(w.code, 'wrong-kind');
  assert.match(w.text, /names a definition, not a run/);
  const other = ok(raw({ runs: [{ experimentId: 'run-a', resultHash: H2 }] }));
  const [d] = F.findingIssues(other, lookupOf(RUNS));
  assert.equal(d.code, 'different-run');
  assert.match(d.text, /different record.*result hash/);
  const value = ok(raw({ evidence: [{ kind: 'value', experimentId: 'run-a', at: { hz: 1000 } }] }));
  const noResponse = { ...RUNS, 'run-a': { ...RUNS['run-a'], hasResponse: false } };
  assert.deepEqual(F.findingIssues(value, lookupOf(noResponse)).map((i) => i.code),
    ['no-response']);
  assert.deepEqual(F.ISSUE_CODES.slice(0, 7), ['missing-run', 'wrong-kind', 'unreadable-run',
    'different-run', 'unverifiable-identity', 'no-response', 'unsupported-status']);
});

test('findingsCiting names each finding that cites a run, and how', () => {
  const a = ok(raw({ id: 'f-a' }));
  const b = ok(raw({ id: 'f-b', evidence: [{ kind: 'compare', a: 'run-b', b: 'run-a' }],
    runs: both }));
  const c = ok(raw({ id: 'f-c', evidence: [{ kind: 'value', experimentId: 'run-b',
    at: { hz: 4974.2 } }], runs: [{ experimentId: 'run-b', resultHash: H2 }] }));
  assert.deepEqual(F.findingsCiting([a, b, c], 'run-a').map((x) => [x.finding.id, x.how]),
    [['f-a', ['this run']], ['f-b', ['a comparison with run-b']]]);
  assert.deepEqual(F.findingsCiting([a, b, c], 'run-b').map((x) => [x.finding.id, x.how]),
    [['f-b', ['a comparison with run-a']], ['f-c', ['its value at 4974.2 Hz']]]);
  assert.deepEqual(F.findingsCiting([a, b, c], 'nope'), []);
});

test('reference text never claims a cause; a comparison says what changed between runs', () => {
  const name = (id) => ({ 'run-a': 'A', 'run-b': 'B' }[id] || null);
  assert.equal(F.refText({ kind: 'run', experimentId: 'run-a' }, name), 'Run "A"');
  assert.equal(F.refText({ kind: 'compare', a: 'run-a', b: 'run-b' }, name),
    'Comparison of "A" with "B" (what changed between the runs, not why)');
  assert.equal(F.refText({ kind: 'value', experimentId: 'run-b', at: { hz: 1000 } }, name,
    { storedPoint: true }), 'Value of "B" at 1000 Hz (a stored grid point)');
  assert.equal(F.refText({ kind: 'run', experimentId: '0123456789abcdef-x' }, () => null),
    'Run 0123456789ab…');
  const texts = F.FINDING_STATUSES.map((s) => `${F.STATUS_TEXT[s]} ${F.STATUS_HINT[s]}`).join(' ');
  assert.ok(!/\b(caus|because|due to|proves?)\b/i.test(texts), texts);
});

// ---------------------------------------------------------------- the store

test('DB version 4 adds the findings store and never deletes anything', async () => {
  assert.equal(DB_VERSION, 4);
  assert.equal(FINDINGS, 'findings');
  const fake = fakeIndexedDB();
  const fresh = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'fresh' });
  assert.deepEqual(fake.state.upgrades, [[0, 4]]);
  assert.deepEqual([...fake.dbs.get('fresh').stores.keys()], ['experiments', 'summaries',
    'studio', 'studioSummaries', 'definitions', 'findings']);
  fresh.close();
  // A version-3 database as v3.10 left it, with a run, a Studio record and a definition.
  const stores = new Map();
  const keep = { experiments: 'experimentId', summaries: 'experimentId', studio: 'id',
    studioSummaries: 'id', definitions: 'id' };
  for (const [k, keyPath] of Object.entries(keep)) {
    stores.set(k, { keyPath, data: new Map([[`${k}-1`, { [keyPath]: `${k}-1`, v: k }]]) });
  }
  fake.dbs.set('v3', { version: 3, stores });
  const up = await openExperimentStore({ indexedDB: fake.indexedDB, name: 'v3' });
  assert.deepEqual(fake.state.upgrades.at(-1), [3, 4]);
  const rec = fake.dbs.get('v3');
  for (const [k, keyPath] of Object.entries(keep)) {
    assert.deepEqual(rec.stores.get(k).data.get(`${k}-1`), { [keyPath]: `${k}-1`, v: k },
      `${k} untouched`);
  }
  assert.deepEqual((await up.listFindings()).findings, []);
  // A partial earlier upgrade completes; an existing store is never recreated.
  const created = [];
  upgradeExperimentDb({ objectStoreNames: { contains: (k) => k !== 'findings' },
    createObjectStore: (k) => created.push(k) }, 3);
  assert.deepEqual(created, ['findings']);
});

for (const kind of ['memory', 'indexeddb']) {
  test(`the ${kind} store keeps findings: round trip, refusals, atomic import`, async () => {
    const fake = fakeIndexedDB();
    const store = kind === 'memory' ? createMemoryStore(OPTS)
      : await openExperimentStore({ indexedDB: fake.indexedDB, name: 'f', ...OPTS });
    const f = ok(raw());
    const g = ok(raw({ id: 'f-2', statement: 'Second', updatedAt: LATER }));
    assert.deepEqual(await store.putFinding(f), f);
    await store.putFinding(g);
    assert.deepEqual(await store.getFinding('f-1'), f);
    assert.equal(await store.getFinding('none'), null);
    assert.deepEqual((await store.listFindings()).findings.map((x) => x.id), ['f-2', 'f-1'],
      'newest change first');
    // An edit keeps the creation time; changing it is refused.
    const edited = F.updateFinding(f, { status: 'supported' }, { now: LATER });
    assert.equal((await store.putFinding(edited)).status, 'supported');
    await assert.rejects(store.putFinding({ ...edited, createdAt: LATER }),
      (e) => e instanceof ExperimentStoreError && e.code === 'immutable');
    await assert.rejects(store.putFinding({ ...f, status: 'supported', evidence: [], runs: [] }),
      (e) => e instanceof ExperimentStoreError && e.code === 'invalid'
        && /at least one/.test(e.message));
    // Import: all or nothing. A different finding under a stored id refuses the whole batch.
    const h = ok(raw({ id: 'f-3', statement: 'Third' }));
    await assert.rejects(store.putFindings([h, { ...g, statement: 'changed elsewhere' }]),
      (e) => e.code === 'conflict' && e.fields.join() === 'f-2');
    assert.equal(await store.getFinding('f-3'), null, 'nothing of a refused import is stored');
    await assert.rejects(store.putFindings([h, { ...h, id: 'f-4', status: 'supported',
      evidence: [], runs: [] }]), (e) => e.code === 'invalid');
    assert.equal(await store.getFinding('f-3'), null, 'an invalid finding refuses the batch');
    assert.deepEqual(await store.putFindings([h, g]), { stored: ['f-3'], same: ['f-2'] });
    assert.deepEqual(await store.getFinding('f-3'), h);
    // Deleting a cited run never touches a finding.
    const { a } = await fx();
    await store.put(a.experiment);
    const cites = ok(raw({ id: 'f-5', status: 'supported', evidence: [{ kind: 'run',
      experimentId: 'fixture-a' }], runs: [{ experimentId: 'fixture-a',
      resultHash: a.experiment.provenance.resultHash }] }));
    await store.putFinding(cites);
    assert.equal(await store.delete('fixture-a'), true);
    assert.deepEqual(await store.getFinding('f-5'), cites, 'the finding is unchanged');
    assert.equal(await store.deleteFinding('f-5'), true);
    assert.equal(await store.deleteFinding('f-5'), false);
    if (kind === 'indexeddb') {
      // A damaged stored finding is listed as unreadable, never fails the others.
      fake.dbs.get('f').stores.get('findings').data.set('bad', { id: 'bad', kind: 'x' });
      const l = await store.listFindings();
      assert.deepEqual(l.unreadable.map((u) => u.id), ['bad']);
      assert.ok(l.findings.length >= 3);
      await assert.rejects(store.getFinding('bad'), (e) => e.code === 'corrupt');
    }
  });
}

test('the memory store reports the findings it holds (losable work, ADR 0045)', async () => {
  const seen = [];
  const store = observeMemoryStore(createMemoryStore(OPTS), (h) => seen.push(h));
  await store.putFinding(ok(raw()));
  await store.putFindings([ok(raw({ id: 'f-2' }))]);
  await store.deleteFinding('f-2');
  assert.deepEqual(seen.map((h) => h.findings), [1, 2, 1]);
  assert.deepEqual(Object.keys(store.held()).sort(), ['definitions', 'experiments', 'findings',
    'studio']);
});

// ---------------------------------------------------------------- export / import

test('export and import round-trip, with each cited run\'s id and result hash', () => {
  const f = ok(raw({ status: 'supported', evidence: [{ kind: 'compare', a: 'run-a',
    b: 'run-b' }], runs: both, notes: 'Two lines\nof notes' }));
  const g = ok(raw({ id: 'f-2', status: 'hypothesis', evidence: [], runs: [] }));
  const doc = F.exportFindings([f, g], { now: LATER, oscillaVersion: '9.9.9' });
  assert.deepEqual(Object.keys(doc), ['kind', 'schemaVersion', 'exportedAt', 'oscillaVersion',
    'findings']);
  assert.equal(doc.kind, F.FINDINGS_FILE_KIND);
  assert.deepEqual(doc.findings[0].runs, both, 'the evidence identity travels with the file');
  const text = F.findingsToJson(doc);
  const back = F.parseFindingsFile(text);
  assert.ok(back.ok, JSON.stringify(back.errors));
  assert.deepEqual(back.findings, [f, g]);
  assert.equal(F.FINDINGS_FILE_EXTENSION, '.oscilla-findings.json');
});

test('import validates the whole file first: one bad finding refuses all of it', () => {
  const doc = F.exportFindings([ok(raw()), ok(raw({ id: 'f-2' }))], { now: LATER });
  doc.findings[1].statement = '<b>bold</b>';
  const r = F.parseFindingsFile(JSON.stringify(doc));
  assert.equal(r.ok, false);
  assert.deepEqual(r.findings, []);
  assert.match(r.errors[0].path, /^findings\[1\]\.statement/);
  const dup = F.exportFindings([ok(raw()), ok(raw())], { now: LATER });
  assert.match(F.parseFindingsFile(JSON.stringify(dup)).errors[0].text, /f-1.*more than once/);
  for (const [text, re] of [
    ['not json', /not valid JSON/],
    ['[]', /must be an object/],
    [JSON.stringify({ ...doc, kind: 'oscilla-experiment' }), /kind: must be oscilla-findings/],
    [JSON.stringify({ ...doc, extra: 1 }), /extra: unknown field/],
    [`{"__proto__":{"x":1},"kind":"${F.FINDINGS_FILE_KIND}"}`, /__proto__: unknown field/],
  ]) {
    const x = F.parseFindingsFile(text);
    assert.equal(x.ok, false, text.slice(0, 30));
    assert.ok(x.errors.some((e) => re.test(`${e.path}: ${e.text}`)), JSON.stringify(x.errors));
  }
  assert.match(F.parseFindingsFile('x'.repeat(50), { maxBytes: 10 }).errors[0].text,
    /larger than/);
});

test('a findings file from a newer schema is refused clearly', () => {
  const doc = F.exportFindings([ok(raw())], { now: LATER });
  const r = F.parseFindingsFile(JSON.stringify({ ...doc, schemaVersion: 2 }));
  assert.equal(r.ok, false);
  assert.equal(r.newer, true);
  assert.match(r.errors[0].text, /schema v2.*newer than this OSCILLA reads \(v1\)/);
});

test('importPlan: new findings are added, identical ones skipped, different ones refused', () => {
  const f = ok(raw());
  const g = ok(raw({ id: 'f-2' }));
  const p = F.importPlan([f, g, ok(raw({ id: 'f-3' }))], [f, { ...g, statement: 'other' }]);
  assert.deepEqual({ add: p.add.map((x) => x.id), same: p.same, conflicts: p.conflicts },
    { add: ['f-3'], same: ['f-1'], conflicts: ['f-2'] });
});

// ---------------------------------------------------------------- the workspace adapter

function harness(fake = fakeIndexedDB()) {
  globalThis.indexedDB = fake.indexedDB;
  const cmp = {};
  for (const part of [createExperimentsUi(), createFindingsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  const notes = [];
  Object.assign(cmp, { notify: (kind, title, text) => notes.push({ kind, title, text }),
    $nextTick: (f) => f && f(), openModal() {}, closeModal() {}, setWorkspace() {},
    measureCurrentProfile: () => null });
  cmp.experimentsInit();
  cmp.findingsInit();
  return { cmp, notes, fake };
}

test('the workspace: record from a run, link a compare, support it, see backlinks', async () => {
  const { a, b } = await fx();
  const { cmp } = harness();
  await cmp.experimentsImportText(a.json);
  await cmp.experimentsImportText(b.json);
  await cmp.experimentsOpen('fixture-a');
  assert.equal(cmp.findingsWhatWouldBeLost().length, 0, 'nothing typed, nothing to lose');
  await cmp.findingsAskRun('fixture-a');
  assert.deepEqual(cmp.fnd.form.evidence.map((x) => x.ref), [{ kind: 'run',
    experimentId: 'fixture-a' }]);
  cmp.fnd.form.statement = 'A falls above 6 kHz.';
  assert.deepEqual(cmp.findingsWhatWouldBeLost(), [{ domain: 'findings',
    label: 'A finding being written' }]);
  await cmp.findingsAddCompare('fixture-a', 'fixture-b');
  cmp.fnd.form.status = 'supported';
  const saved = await cmp.findingsSave();
  assert.ok(saved, cmp.fnd.form.error);
  assert.deepEqual(saved.runs.map((r) => r.experimentId), ['fixture-a', 'fixture-b']);
  assert.equal(saved.runs[0].resultHash, a.experiment.provenance.resultHash);
  assert.equal(cmp.findingsWhatWouldBeLost().length, 0, 'saved: nothing to lose');
  assert.equal(cmp.fnd.rows.length, 1);
  assert.equal(cmp.fnd.rows[0].statusText, F.STATUS_TEXT.supported);
  assert.deepEqual(cmp.fnd.rows[0].evidence.map((e) => e.state), ['ok', 'ok']);
  assert.deepEqual(cmp.findingsBacklinks('fixture-b').map((x) => x.how), [
    'a comparison with fixture-a']);
  assert.equal(cmp.findingsCiting('fixture-a'), 1);
  // Delete the cited run: the dialog says one finding cites it; the reference reads missing.
  cmp.experimentsAskDelete({ id: 'fixture-b', name: 'B' });
  assert.match(cmp.exps.deleteCiting, /^1 finding cites this run/);
  assert.equal(await cmp.experimentsDelete(), true);
  const row = cmp.fnd.rows[0];
  assert.deepEqual(row.evidence.map((e) => e.state), ['ok', 'missing']);
  assert.match(row.evidence[1].issue, /^missing: run .* is not stored here/);
  assert.equal(row.status, 'supported', 'the finding keeps its status and its reference');
  assert.equal(JSON.stringify(cmp.fnd.rows), JSON.stringify(JSON.parse(JSON.stringify(
    cmp.fnd.rows))), 'plain data for Alpine');
});

test('the workspace: import refuses a conflict whole and names runs not stored here', async () => {
  const { cmp, notes } = harness();
  await cmp.experimentsRefresh();
  const f = ok(raw({ id: 'f-imp', status: 'supported' }));
  const text = F.findingsToJson(F.exportFindings([f], { now: LATER }));
  assert.equal(await cmp.findingsImportText(text), 1);
  assert.match(notes.at(-1).text, /1 cited run is not stored here/);
  assert.match(cmp.fnd.rows[0].evidence[0].issue, /not stored here/);
  const changed = F.findingsToJson(F.exportFindings([{ ...f, statement: 'Other' },
    ok(raw({ id: 'f-new' }))], { now: LATER }));
  assert.equal(await cmp.findingsImportText(changed), null);
  assert.match(cmp.fnd.importErrors[0], /f-imp is already stored with different content/);
  assert.equal(cmp.fnd.rows.length, 1, 'nothing of the refused file was stored');
  const newer = text.replace('"schemaVersion": 1', '"schemaVersion": 7');
  assert.equal(await cmp.findingsImportText(newer), null);
  assert.match(cmp.fnd.importErrors[0], /newer than this OSCILLA reads/);
});

test('the memory fallback counts its findings as losable work', async () => {
  const cmp = {};
  for (const part of [createExperimentsUi(), createFindingsUi()]) {
    Object.defineProperties(cmp, Object.getOwnPropertyDescriptors(part));
  }
  cmp.exps.persistent = false;
  cmp.exps.memoryHeld = { experiments: 0, definitions: 0, studio: 0, findings: 2 };
  assert.deepEqual(cmp.experimentsWhatWouldBeLost(), [{ domain: 'experiments',
    label: '2 findings kept in page memory only' }]);
});

test('findings are rendered as text: no x-html or innerHTML on the findings path', () => {
  const html = readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/js/ui/findings.js'), 'utf8');
  assert.ok(!/x-html/.test(html), 'no x-html anywhere in the page');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(ui));
  assert.match(html, /data-osc="fnd\.panel"/, 'the Findings panel is in the page');
  assert.match(html, /data-osc="exp\.findings"/, 'the run detail lists the findings citing it');
});

// ---------------------------------------------------------------- adversarial review 1 of #149

/** fixture `k` stored under `id` (the id is not hashed), optionally without its result hash. */
const recordAs = async (k, id, { unstamped = false, name = null } = {}) => {
  const j = JSON.parse((await fx())[k].json);
  j.experimentId = id;
  if (name) j.name = name;
  if (unstamped) {
    delete j.provenance.resultHash;
    delete j.provenance.resultHashVersion;
  }
  return JSON.stringify(j);
};
/** The stored record of `id` as the store keeps it (file form), for in-place corruption. */
const rawRecord = (fake, id) => fake.dbs.get('oscilla-experiments').stores.get('experiments')
  .data.get(id);
const rowOf = (cmp, statement) => cmp.fnd.rows.find((r) => r.statement === statement);

test('review 1.1: an identity that cannot be verified is an issue, never ok', () => {
  const f = ok(raw({ status: 'supported' }));
  const stored = (o) => lookupOf({ 'run-a': { kind: 'run', name: 'A', resultHash: H1,
    hasResponse: true, ...o } });
  let is = F.findingIssues(f, stored({ resultHash: null }));
  assert.deepEqual(is.map((i) => i.code), ['unverifiable-identity', 'unsupported-status']);
  assert.match(is[0].text, /cannot be verified: the record stored under this id has no result hash/);
  const g = ok(raw({ status: 'supported', runs: [{ experimentId: 'run-a', resultHash: null }] }));
  is = F.findingIssues(g, stored({}));
  assert.deepEqual(is.map((i) => i.code), ['unverifiable-identity', 'unsupported-status']);
  assert.match(is[0].text, /cannot be verified: it was cited without a result hash/);
  is = F.findingIssues(f, lookupOf({ 'run-a': { kind: 'run', name: 'A' } }));
  assert.deepEqual(is.map((i) => i.code), ['unverifiable-identity', 'unsupported-status'],
    'an identity the lookup does not know is not verified either');
  assert.ok(F.ISSUE_CODES.includes('unverifiable-identity'));
});

test('review 1.1: a different, hash-less record under a cited id is not shown as the run', async () => {
  const { cmp, notes } = harness();
  await cmp.experimentsImportText(await recordAs('b', 'run-x'));
  await cmp.findingsAskRun('run-x');
  cmp.fnd.form.statement = 'cites X';
  cmp.fnd.form.status = 'supported';
  assert.ok(await cmp.findingsSave(), cmp.fnd.form.error);
  assert.equal(rowOf(cmp, 'cites X').evidence[0].state, 'ok');
  cmp.experimentsAskDelete({ id: 'run-x', name: 'X' });
  await cmp.experimentsDelete();
  await cmp.experimentsImportText(await recordAs('c', 'run-x', { unstamped: true,
    name: 'impostor' }));
  const row = rowOf(cmp, 'cites X');
  assert.equal(row.evidence[0].state, 'broken');
  assert.match(row.evidence[0].issue, /cannot be verified: the record stored under this id has no result hash/);
  assert.match(row.statusIssue, /none of the evidence it cites/);
  // A run without a result hash cannot be linked in the first place.
  assert.equal(await cmp.findingsAskRun('run-x'), false);
  assert.match(notes.at(-1).text, /has no result hash/);
});

test('review 1.2: a cited run that is stored but cannot be read is unreadable, not ok', async () => {
  const fake = fakeIndexedDB();
  const first = harness(fake).cmp;
  await first.experimentsImportText(await recordAs('a', 'run-y'));
  await first.findingsAskRun('run-y');
  first.fnd.form.statement = 'cites Y';
  first.fnd.form.status = 'supported';
  assert.ok(await first.findingsSave(), first.fnd.form.error);
  rawRecord(fake, 'run-y').provenance.resultHash = 'e'.repeat(64); // fails verification on read
  const { cmp } = harness(fake); // a reload: nothing cached
  await cmp.experimentsRefresh();
  const row = rowOf(cmp, 'cites Y');
  assert.equal(row.evidence[0].state, 'broken');
  assert.match(row.evidence[0].issue, /^run .* is stored here but cannot be read/);
  assert.match(row.statusIssue, /none of the evidence it cites/);
  const is = F.findingIssues(ok(raw()), lookupOf({ 'run-a': { kind: 'run', name: 'A',
    readable: false, reason: 'stored experiment run-a is invalid' } }));
  assert.deepEqual(is.map((i) => i.code), ['unreadable-run']);
  assert.ok(F.ISSUE_CODES.includes('unreadable-run'));
});

test('review 1.3: a record replaced under a cited id elsewhere is caught on the next refresh', async () => {
  const fake = fakeIndexedDB();
  const { cmp } = harness(fake);
  await cmp.experimentsImportText(await recordAs('b', 'run-z'));
  await cmp.findingsAskRun('run-z');
  cmp.fnd.form.statement = 'cites Z';
  assert.ok(await cmp.findingsSave(), cmp.fnd.form.error);
  assert.equal(rowOf(cmp, 'cites Z').evidence[0].state, 'ok');
  // Another tab deletes the run and stores a different, stamped record under its id.
  const other = await openExperimentStore({ indexedDB: fake.indexedDB, ...OPTS });
  await other.delete('run-z');
  const { validateExperiment } = await import('../../src/js/experiments/validate.js');
  await other.put(validateExperiment(await recordAs('c', 'run-z', { name: 'impostor' }), OPTS)
    .experiment);
  await cmp.experimentsRefresh();
  const e = rowOf(cmp, 'cites Z').evidence[0];
  assert.equal(e.state, 'broken');
  assert.match(e.issue, /different record is stored under this id/);
});

test('review 1.4: a value reference names a stored grid point exactly, or says it does not', async () => {
  const name = () => 'A';
  const v = (hz) => ({ kind: 'value', experimentId: 'run-a', at: { hz } });
  const grid = { 'run-a': { kind: 'run', name: 'A', resultHash: H1, hasResponse: true,
    frequencies: [1000.5, 2000.25] } };
  const on = ok(raw({ evidence: [v(1000.5)] }));
  const off = ok(raw({ evidence: [v(1234.56789)] }));
  assert.deepEqual(F.findingIssues(on, lookupOf(grid)), []);
  const [x] = F.findingIssues(off, lookupOf(grid));
  assert.equal(x.code, 'not-a-grid-point');
  assert.match(x.text, /1234\.56789 Hz is not a frequency the run stores/);
  assert.ok(F.ISSUE_CODES.includes('not-a-grid-point'));
  assert.match(F.refText(v(1000.5), name, { storedPoint: true }), /\(a stored grid point\)$/);
  assert.ok(!/stored/.test(F.refText(v(1234.56789), name)), 'no claim without the check');
  assert.notEqual(F.refText(v(1000), name), F.refText(v(1000.0001), name),
    'distinct frequencies never read the same');
  // In the workspace: the value the evidence shows is a grid point; a crafted one is not.
  const { cmp } = harness();
  await cmp.experimentsImportText(await recordAs('a', 'run-v'));
  await cmp.experimentsOpen('run-v');
  assert.ok(await cmp.findingsAskValue());
  cmp.fnd.form.statement = 'value on the grid';
  assert.ok(await cmp.findingsSave(), cmp.fnd.form.error);
  const good = rowOf(cmp, 'value on the grid').evidence[0];
  assert.equal(good.state, 'ok');
  assert.match(good.text, /\(a stored grid point\)$/);
  const crafted = ok(raw({ id: 'f-off', statement: 'value off the grid', evidence: [{ kind: 'value',
    experimentId: 'run-v', at: { hz: 1234.56789 } }], runs: [{ experimentId: 'run-v',
    resultHash: (await fx()).a.experiment.provenance.resultHash }] }));
  assert.equal(await cmp.findingsImportText(F.findingsToJson(F.exportFindings([crafted],
    { now: LATER }))), 1);
  const bad = rowOf(cmp, 'value off the grid').evidence[0];
  assert.equal(bad.state, 'broken');
  assert.ok(!/stored grid point\)/.test(bad.text), bad.text);
  assert.match(bad.issue, /not a frequency the run stores/);
});

test('review 1.5: closing the dialog keeps a typed draft; only Discard drops it', async () => {
  const { cmp, notes } = harness();
  await cmp.experimentsImportText(await recordAs('a', 'run-d'));
  await cmp.findingsAskRun('run-d');
  cmp.fnd.form.statement = 'a long careful draft';
  cmp.findingsDialogClosed(); // Escape, a backdrop click or Close
  assert.equal(cmp.fnd.form.open, false);
  assert.deepEqual(cmp.findingsWhatWouldBeLost(), [{ domain: 'findings',
    label: 'A finding being written' }], 'the guard still reports the kept draft');
  assert.equal(cmp.fnd.draftKept, true);
  // Starting another finding reopens the kept draft instead of replacing it.
  assert.equal(await cmp.findingsAskRun('run-d'), true);
  assert.equal(cmp.fnd.form.statement, 'a long careful draft');
  assert.match(notes.at(-1).text, /draft/);
  cmp.findingsDiscardDraft();
  assert.equal(cmp.fnd.form.statement, '');
  assert.equal(cmp.fnd.draftKept, false);
  assert.deepEqual(cmp.findingsWhatWouldBeLost(), []);
  // An untouched form closes without leaving a draft.
  await cmp.findingsAskRun('run-d');
  cmp.findingsDialogClosed();
  assert.equal(cmp.fnd.draftKept, false);
  assert.deepEqual(cmp.findingsWhatWouldBeLost(), []);
});

test('review 1.7: removing the last reference to a run drops its identity; relinking reads it anew', async () => {
  const { cmp } = harness();
  await cmp.experimentsImportText(await recordAs('b', 'run-r'));
  await cmp.findingsAskRun('run-r');
  cmp.fnd.form.statement = 'cites R';
  const first = await cmp.findingsSave();
  assert.ok(first, cmp.fnd.form.error);
  cmp.experimentsAskDelete({ id: 'run-r', name: 'R' });
  await cmp.experimentsDelete();
  await cmp.experimentsImportText(await recordAs('c', 'run-r', { name: 'another record' }));
  await cmp.findingsAskEdit(first.id);
  cmp.findingsRemoveRef(0);
  assert.deepEqual(cmp.fnd.form.runs, [], 'no identity is kept for a run no longer cited');
  assert.ok(await cmp.findingsAddRun('run-r'), cmp.fnd.form.error);
  const saved = await cmp.findingsSave();
  assert.ok(saved, cmp.fnd.form.error);
  assert.equal(saved.runs[0].resultHash, (await fx()).c.experiment.provenance.resultHash);
  assert.equal(rowOf(cmp, 'cites R').evidence[0].state, 'ok');
});

test('review 1.8: invisible, directional and malformed characters are refused', () => {
  const bad = {
    LRM: '‎', RLM: '‏', ALM: '؜', NEL: '\u0085', 'C1 0x9B': '\u009B',
    LS: ' ', PS: ' ', BOM: '﻿', ZWSP: '​', ZWNJ: '‌', ZWJ: '‍',
    'word joiner': '⁠', 'lone high surrogate': '\uD800', 'lone low surrogate': '\uDC00',
    RLO: '‮', LRI: '⁦',
  };
  for (const [what, ch] of Object.entries(bad)) {
    refused(raw({ statement: `gain${ch}is 3 dB` }), /statement: contains/, `statement ${what}`);
    refused(raw({ notes: `line${ch}two` }), /notes: contains/, `notes ${what}`);
  }
  assert.equal(ok(raw({ statement: 'Sweep 🎵 at 1 kHz: −3 dB, café' })).statement,
    'Sweep 🎵 at 1 kHz: −3 dB, café', 'paired surrogates and ordinary Unicode pass');
});

test('review 1.9: an edit is refused when the finding changed since the form loaded it', async () => {
  for (const kind of ['memory', 'indexeddb']) {
    const store = kind === 'memory' ? createMemoryStore(OPTS)
      : await openExperimentStore({ indexedDB: fakeIndexedDB().indexedDB, ...OPTS });
    const f = await store.putFinding(ok(raw()));
    const mine = F.updateFinding(f, { statement: 'mine' }, { now: LATER });
    const theirs = F.updateFinding(f, { statement: 'theirs' }, { now: '2026-10-02T11:30:00.000Z' });
    await store.putFinding(theirs, { expectedUpdatedAt: f.updatedAt });
    await assert.rejects(store.putFinding(mine, { expectedUpdatedAt: f.updatedAt }),
      (e) => e.code === 'conflict' && /changed elsewhere/.test(e.message), kind);
    assert.equal((await store.getFinding(f.id)).statement, 'theirs', `${kind}: not overwritten`);
  }
  const { cmp } = harness();
  await cmp.experimentsImportText(await recordAs('a', 'run-e'));
  await cmp.findingsAskRun('run-e');
  cmp.fnd.form.statement = 'first';
  const saved = await cmp.findingsSave();
  await cmp.findingsAskEdit(saved.id);
  cmp.fnd.form.statement = 'my edit';
  const s = await cmp.experimentsStore();
  await s.putFinding(F.updateFinding(await s.getFinding(saved.id), { statement: 'other tab' },
    { now: Date.now() + 1000 }));
  assert.equal(await cmp.findingsSave(), null);
  assert.match(cmp.fnd.form.error, /changed in another tab or window/);
  assert.equal(cmp.fnd.form.statement, 'my edit', 'the text typed here is kept');
  assert.equal((await s.getFinding(saved.id)).statement, 'other tab');
});

test('review 1.10: export says how many unreadable findings it left out', async () => {
  const fake = fakeIndexedDB();
  const { cmp, notes } = harness(fake);
  await cmp.experimentsRefresh();
  const s = await cmp.experimentsStore();
  await s.putFinding(ok(raw()));
  fake.dbs.get('oscilla-experiments').stores.get('findings').data.set('bad', { id: 'bad' });
  let file = null;
  const text = await cmp.findingsExport({ download: (blob, name) => { file = name; } });
  assert.equal(F.parseFindingsFile(text).findings.length, 1);
  assert.equal(file, 'findings.oscilla-findings.json');
  assert.equal(notes.at(-1).kind, 'warning');
  assert.match(notes.at(-1).text, /1 stored finding could not be read and was left out \(bad\)/);
});

test('review 1.11: one import rule: importPlan is the store\'s verdict, and the UI maps its refusal', async () => {
  const f = ok(raw());
  const reordered = Object.fromEntries(Object.entries(f).reverse());
  assert.deepEqual(F.importPlan([f], [reordered]).same, ['f-1'], 'key order is not content');
  const store = readFileSync(path.join(ROOT, 'src/js/experiments/store.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/js/ui/findings.js'), 'utf8');
  assert.match(store, /importPlan\(/, 'the store decides an import with importPlan');
  assert.ok(!/importPlan\(/.test(ui), 'the workspace does not pre-check with a second copy');
  const { cmp } = harness();
  await cmp.experimentsRefresh();
  const g = ok(raw({ id: 'f-c1' }));
  assert.equal(await cmp.findingsImportText(F.findingsToJson(F.exportFindings([g],
    { now: LATER }))), 1);
  assert.equal(await cmp.findingsImportText(F.findingsToJson(F.exportFindings([{ ...g,
    statement: 'changed' }, ok(raw({ id: 'f-c2' }))], { now: LATER }))), null);
  assert.deepEqual(cmp.fnd.importErrors, ['f-c1 is already stored with different content; '
    + 'nothing was imported']);
  assert.equal(await (await cmp.experimentsStore()).getFinding('f-c2'), null);
});
