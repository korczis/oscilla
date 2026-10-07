// ADR 0041: run comparison is semantic and classifies execution vs presentation changes.
//   experiments/semantic-diff.js runChanges / runFields, studio/diff.js studioChanges,
//   compare.js compareExperiments().semantic, compare-view.js semantic groups, the baseline
//   mark (schema.js annotateExperiment / isBaseline, store.js annotate, validate.js) and
//   experiment-summary.js compareSelection.
// The experiments are the deterministic TEST CONTEXT fixtures of the V3 UI suite.
//   node --test tests/unit/v3-semantic-compare.test.mjs
//
// Modules introduced by ADR 0041 are imported dynamically, so on a build without them each
// test fails on its own instead of the whole file failing to load.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../../src/js/experiments/schema.js';
import * as store from '../../src/js/experiments/store.js';
import { compareExperiments } from '../../src/js/experiments/compare.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import { withStudioProvenance } from '../../src/js/studio/provenance.js';
import { templateModel } from '../../src/js/studio/templates/index.js';
import { normalizeStudio, executionState } from '../../src/js/studio/schema.js';
import { buildCompareView } from '../../src/js/measurement/views/compare-view.js';
import * as summary from '../../src/js/measurement/views/experiment-summary.js';
import { exportableExperiment } from '../../src/js/ui/experiments.js';
import { buildFixtures } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const sd = () => import('../../src/js/experiments/semantic-diff.js');
const sdiff = () => import('../../src/js/studio/diff.js');
const clone = (v) => structuredClone(v);
const plain = (v) => JSON.parse(JSON.stringify(v));

let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};

/** Studio model of the filter-automation template, with an optional edit. */
function studio(edit = () => {}) {
  const m = plain(templateModel('filter-automation'));
  edit(m);
  return normalizeStudio(m);
}

const listed = (changes) => changes.filter((c) => c.kind !== 'unchanged');
const byPath = (changes, path) => changes.find((c) => c.path === path);

// ---------------------------------------------------------------- the comparator

test('ADR 0041: every domain is compared, typed, classified and labelled', async () => {
  const { runChanges, DOMAINS } = await sd();
  const { studioChanges } = await sdiff();
  const { a } = await fx();
  const before = withStudioProvenance(clone(a.experiment), studio());
  const after = withStudioProvenance(clone(a.experiment), studio((m) => {
    m.graph.nodes.find((n) => n.id === 'filter-1').params.frequency = 2345.678901234;
  }));
  after.experimentId = 'other-run';
  after.name = 'Renamed';
  after.recipe = { ...after.recipe, repeats: 5,
    stimulus: { ...after.recipe.stimulus, f2: 19999.123456789, duration: 3 } };
  after.algorithms = { ...after.algorithms, transfer: 'oscilla.transfer.v2' };
  after.calibration = { frequency: { id: 'b'.repeat(64), name: 'Other mic' }, level: null };
  after.output = { ...after.output, masterGain: 0.125 };
  after.measurement = { ...after.measurement, sampleRate: 44100 };
  after.oscillaVersion = '9.9.9';
  after.provenance = { ...after.provenance,
    build: { ...after.provenance.build, sourceDigest: 'd'.repeat(64) } };
  after.quality = { ...after.quality, status: 'POOR' };
  const changes = runChanges(before, after, { studioChanges });
  const want = [
    ['recipe', 'recipe.stimulus.f2', 'Hz', 19999.123456789],
    ['recipe', 'recipe.stimulus.duration', 's', 3],
    ['recipe', 'recipe.repeats', 'runs', 5],
    ['algorithms', 'algorithms.transfer', undefined, 'oscilla.transfer.v2'],
    ['calibration', 'calibration.frequency', undefined, 'b'.repeat(64)],
    ['conditions', 'measurement.sampleRate', 'Hz', 44100],
    ['conditions', 'output.masterGain', 'linear gain', 0.125],
    ['studio', 'studio.nodes.filter-1.params.frequency', 'Hz', 2345.678901234],
    ['build', 'oscillaVersion', undefined, '9.9.9'],
    ['build', 'provenance.build.sourceDigest', undefined, 'd'.repeat(64)],
    ['result', 'quality.status', undefined, 'POOR'],
    ['metadata', 'name', undefined, 'Renamed'],
  ];
  for (const [domain, path, unit, value] of want) {
    const c = byPath(changes, path);
    assert.ok(c, path);
    assert.equal(c.domain, domain, path);
    assert.equal(c.kind, c.before === null ? 'added' : 'changed', path);
    assert.notEqual(c.before, value, path);
    assert.equal(c.class, domain === 'metadata' ? 'metadata' : 'execution', path);
    assert.equal(c.unit, unit, path);
    assert.equal(c.after, value, `${path}: full precision in the model`);
    assert.equal(typeof c.label, 'string', path);
  }
  assert.equal(byPath(changes, 'studio.nodes.filter-1.params.frequency').label,
    'Filter filter-1 · Cutoff', 'label from the node registry param schema');
  // Deterministic order: domains in DOMAINS order, never interleaved.
  const ranks = changes.map((c) => DOMAINS.indexOf(c.domain));
  assert.ok(ranks.every((r, i) => r >= 0 && (i === 0 || r >= ranks[i - 1])), 'domain order');
  for (const c of changes) {
    assert.deepEqual(Object.keys(c).filter((k) => !['unit', 'note'].includes(k)),
      ['domain', 'path', 'kind', 'class', 'before', 'after', 'label']);
  }
  // Identity and time are not changes between runs.
  assert.equal(changes.some((c) => /experimentId|createdAt|startedAt|Hash$/.test(c.path)), false);
});

test('ADR 0041: an unchanged run has no execution change; a duplicate differs in metadata only',
  async () => {
    const { runChanges } = await sd();
    const { a } = await fx();
    const same = runChanges(a.experiment, a.experiment);
    assert.ok(same.length > 10);
    assert.deepEqual(listed(same), [], 'every listed field unchanged');
    const dup = schema.duplicateExperiment(a.experiment, { id: 'dup-1' });
    const d = listed(runChanges(a.experiment, dup));
    assert.deepEqual(d.map((c) => [c.path, c.class]), [['name', 'metadata']]);
    const notes = schema.annotateExperiment(a.experiment, { notes: 'later', baseline: true });
    assert.deepEqual(listed(runChanges(a.experiment, notes)).map((c) => c.class),
      ['metadata', 'metadata']);
  });

test('ADR 0041: an algorithm version change names the method and both versions', async () => {
  const { runChanges } = await sd();
  const { a } = await fx();
  const b = { ...a.experiment, algorithms: { ...a.experiment.algorithms,
    transfer: 'oscilla.transfer.v2', ir: 'oscilla.ir.farina-inverse.v3' } };
  const t = byPath(runChanges(a.experiment, b), 'algorithms.transfer');
  assert.equal(t.before, a.experiment.algorithms.transfer);
  assert.equal(t.after, 'oscilla.transfer.v2');
  assert.match(t.note, /^version \d+ → 2 of oscilla\.transfer$/);
  assert.equal(t.label, 'Algorithm (transfer)');
  const ir = byPath(runChanges(a.experiment, b), 'algorithms.ir');
  assert.equal(ir.note, 'another ir method');
  const gone = { ...a.experiment, algorithms: {} };
  assert.equal(byPath(runChanges(a.experiment, gone), 'algorithms.transfer').kind, 'removed');
});

test('ADR 0041: a calibration change is a calibration-domain execution change', async () => {
  const { runChanges } = await sd();
  const { a } = await fx();
  const level = { schemaVersion: 1, kind: 'level', referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30, offsetDb: 124, conditions: null, createdAt: null };
  const b = { ...a.experiment, calibration: { frequency: { id: 'c'.repeat(64), name: 'P' },
    level } };
  const c = runChanges(a.experiment, b).filter((x) => x.domain === 'calibration');
  assert.deepEqual(c.map((x) => [x.path, x.kind, x.class]), [
    ['calibration.frequency', a.experiment.calibration.frequency ? 'changed' : 'added',
      'execution'],
    ['calibration.level', 'added', 'execution']]);
  assert.deepEqual(c[1].after, { referenceHz: 1000, referenceDbSpl: 94,
    observedDbRelative: -30, offsetDb: 124 });
});

test('ADR 0041: Studio topology add/remove, parameter units and automation lanes', async () => {
  const { runChanges } = await sd();
  const { studioChanges } = await sdiff();
  const { a } = await fx();
  const ea = withStudioProvenance(clone(a.experiment), studio());
  const eb = withStudioProvenance(clone(a.experiment), studio((m) => {
    m.graph.nodes.push({ id: 'osc-9', type: 'oscillator', position: { x: 0, y: 0 },
      params: {} });
    m.graph.edges = m.graph.edges.filter((e) => e.id !== 'edge-3');
    m.timeline.automation[0].points[0].value = 500;
  }));
  const s = runChanges(ea, eb, { studioChanges }).filter((c) => c.domain === 'studio');
  assert.deepEqual(s.map((c) => [c.path, c.kind, c.class]), [
    ['studio.nodes.osc-9', 'added', 'execution'],
    ['studio.edges.edge-3', 'removed', 'execution'],
    ['studio.automation.lane-1', 'changed', 'execution']]);
  assert.equal(s[0].after, 'oscillator');
  assert.equal(s[0].label, 'Node Oscillator osc-9');
  assert.deepEqual(s[1].before.from, { node: 'filter-1', port: 'audio' });
  assert.equal(s[2].unit, 'Hz', 'the unit of the parameter the lane drives');
  assert.match(s[2].label, /Filter filter-1 · Cutoff/);
  // Without the injected Studio comparator: one change of the execution hash.
  const h = runChanges(ea, eb).filter((c) => c.domain === 'studio');
  assert.deepEqual(h.map((c) => [c.path, c.kind]), [['studio', 'changed']]);
  // Studio block on one side only.
  assert.equal(byPath(runChanges(a.experiment, ea), 'studio').kind, 'added');
});

test('ADR 0041: a layout-only Studio change is presentation, never execution', async () => {
  const { runChanges } = await sd();
  const { studioChanges } = await sdiff();
  const ma = studio();
  const mb = studio((m) => {
    m.graph.nodes[0].position = { x: 999, y: -5 };
    m.graph.nodes[1].metadata = { name: 'Renamed filter' };
    m.view.graph.zoom = 2;
    m.metadata.title = 'Other title';
  });
  const full = studioChanges(ma, mb);
  assert.ok(full.length >= 4);
  assert.ok(full.every((c) => c.class === 'presentation' && c.domain === 'studio'),
    JSON.stringify(full.map((c) => [c.path, c.class])));
  assert.ok(full.some((c) => c.path === 'studio.view.graph'));
  assert.deepEqual(studioChanges(executionState(ma), executionState(mb)), [],
    'execution states: nothing changed');
  // Two runs recorded from the two layouts: the same studioHash, no Studio change at all.
  const { a } = await fx();
  const c = runChanges(withStudioProvenance(clone(a.experiment), ma),
    withStudioProvenance(clone(a.experiment), mb), { studioChanges });
  assert.deepEqual(listed(c), []);
  assert.equal(byPath(c, 'studio').kind, 'unchanged');
  // A real parameter change next to a layout change: only the parameter is execution.
  const mc = studio((m) => {
    m.graph.nodes[0].position = { x: 1, y: 2 };
    m.graph.nodes.find((n) => n.id === 'filter-1').params.frequency = 900;
  });
  const mixed = studioChanges(ma, mc);
  assert.deepEqual(mixed.filter((x) => x.class === 'execution').map((x) => x.path),
    ['studio.nodes.filter-1.params.frequency']);
  assert.deepEqual(mixed.filter((x) => x.class === 'presentation').map((x) => x.path),
    ['studio.nodes.noise-1.position']);
});

/** A deep copy with every object's keys in reverse order (arrays kept). */
function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
  return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])]));
}

test('ADR 0041: the comparison is deterministic under key order and list order', async () => {
  const { runChanges } = await sd();
  const { studioChanges } = await sdiff();
  const { a, c } = await fx();
  const ea = withStudioProvenance(clone(a.experiment), studio());
  const ec = withStudioProvenance(clone(c.experiment), studio((m) => {
    m.graph.nodes.find((n) => n.id === 'filter-1').params.q = 3;
    m.graph.edges.pop();
  }));
  const ref = runChanges(ea, ec, { studioChanges });
  const shuffled = (e) => {
    const x = reverseKeys(e);
    x.studio.execution.nodes = [...x.studio.execution.nodes].reverse();
    x.studio.execution.edges = [...x.studio.execution.edges].reverse();
    return x;
  };
  const again = runChanges(shuffled(ea), shuffled(ec), { studioChanges });
  assert.deepEqual(plain(again), plain(ref));
  assert.deepEqual(plain(runChanges(ea, ec, { studioChanges })), plain(ref), 'repeatable');
  assert.ok(ref.some((x) => x.path === 'recipe.stimulus.f1' && x.before === 20
    && x.after === 50 && x.unit === 'Hz'));
});

// ---------------------------------------------------------------- compareExperiments / view

test('ADR 0041: compareExperiments keeps its differences and adds the semantic changes',
  async () => {
    const { runChanges } = await sd();
    const { a, b, c } = await fx();
    const r = compareExperiments([a.experiment, c.experiment, b.experiment]);
    assert.deepEqual(r.differences.map((d) => [d.field, d.severity]),
      [['recipe.stimulus', 'warn']]);
    assert.equal(r.compatible, false);
    assert.deepEqual(r.semantic.map((s) => s.index), [1, 2]);
    assert.deepEqual(plain(r.semantic[0].changes),
      plain(runChanges(a.experiment, c.experiment)));
    assert.deepEqual(listed(r.semantic[0].changes).filter((x) => x.domain === 'recipe')
      .map((x) => x.path), ['recipe.stimulus.f1']);
  });

test('ADR 0041: the compare view groups changes, execution first, wording "changed between"',
  async () => {
    const { a, c } = await fx();
    const base = schema.annotateExperiment(a.experiment, { baseline: true });
    const v = buildCompareView([base, c.experiment]);
    assert.equal(v.entries[0].baseline, true);
    assert.equal(v.semantic.length, 1);
    const p = v.semantic[0];
    assert.equal(p.heading, 'Changed between experiments A (baseline) and B');
    assert.ok(p.executionCount >= 1);
    const firstOther = p.groups.findIndex((g) => g.other);
    assert.ok(firstOther > 0 && p.groups.slice(firstOther).every((g) => g.other),
      'execution groups first');
    assert.deepEqual(p.groups[0].items.map((i) => i.text), ['Stimulus f1: 20 Hz → 50 Hz']);
    assert.equal(p.groups[0].label, 'Recipe');
    assert.ok(p.groups.some((g) => g.other && g.label === 'Metadata'
      && g.items.some((i) => /^Name: /.test(i.text))));
    const text = JSON.stringify(v.semantic);
    assert.doesNotMatch(text, /caus|because|due to/i, 'never causal wording');
    assert.doesNotMatch(text, /SPL/);
    const same = buildCompareView([a.experiment, a.experiment]).semantic[0];
    assert.equal(same.executionCount, 0);
    assert.equal(same.none, 'No execution change between experiments A and B.');
  });

// ---------------------------------------------------------------- baseline

test('ADR 0041: annotateExperiment marks and clears the baseline as metadata only', async () => {
  const { a } = await fx();
  const e = a.experiment;
  assert.equal(schema.isBaseline(e), false);
  const marked = schema.annotateExperiment(e, { baseline: true });
  assert.equal(schema.isBaseline(marked), true);
  assert.deepEqual(marked.annotations, { baseline: true });
  assert.deepEqual(schema.executionFactChanges(e, marked), ['annotations']);
  const both = schema.annotateExperiment(marked, { notes: 'ref' });
  assert.deepEqual(both.annotations, { baseline: true, notes: 'ref' });
  const cleared = schema.annotateExperiment(both, { baseline: false });
  assert.deepEqual(cleared.annotations, { notes: 'ref' });
  assert.equal('annotations' in schema.annotateExperiment(marked, { baseline: false }), false);
  assert.throws(() => schema.annotateExperiment(e, { baseline: 'yes' }), TypeError);
  // A duplicate is not a second baseline.
  assert.equal(schema.isBaseline(schema.duplicateExperiment(marked, { id: 'd-1' })), false);
  // Validation: true only, never an empty block; the hash still verifies.
  const doc = plain(schema.serializeExperiment(marked));
  const v = validateExperiment(JSON.stringify(doc), OPTS);
  assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
  assert.deepEqual(v.experiment.annotations, { baseline: true });
  for (const bad of [{ baseline: false }, { baseline: 'yes' }, {}]) {
    const r = validateExperiment(JSON.stringify({ ...doc, annotations: bad }), OPTS);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

const stores = () => {
  const fake = fakeIndexedDB();
  return [
    ['memory', async () => store.createMemoryStore(OPTS)],
    ['indexeddb', () => store.openExperimentStore({ indexedDB: fake.indexedDB,
      name: `b${Math.random()}`, ...OPTS })],
  ];
};

test('ADR 0041: at most one baseline per store; the run stays immutable', async () => {
  const { a, b } = await fx();
  for (const [kind, open] of stores()) {
    const s = await open();
    await s.put(a.experiment);
    await s.put(b.experiment);
    const ma = await s.annotate('fixture-a', { baseline: true });
    assert.equal(schema.isBaseline(ma), true, kind);
    assert.equal(ma.provenance.resultHash, a.experiment.provenance.resultHash, kind);
    assert.equal(ma.provenance.configHash, a.experiment.provenance.configHash, kind);
    assert.deepEqual((await s.list()).filter((r) => r.baseline).map((r) => r.experimentId),
      ['fixture-a'], kind);
    // Marking another run clears the first in the same write.
    await s.annotate('fixture-b', { baseline: true });
    assert.equal(schema.isBaseline(await s.get('fixture-a')), false, kind);
    assert.equal(schema.isBaseline(await s.get('fixture-b')), true, kind);
    assert.deepEqual((await s.list()).filter((r) => r.baseline).map((r) => r.experimentId),
      ['fixture-b'], kind);
    // put cannot change the mark of a stored run (metadata goes through annotate) ...
    await assert.rejects(s.put(schema.annotateExperiment(a.experiment, { baseline: true })),
      (err) => err.code === 'immutable', kind);
    // ... and a new marked run is refused while another is the baseline.
    const dup = schema.annotateExperiment(schema.duplicateExperiment(a.experiment,
      { id: 'dup-x' }), { baseline: true });
    await assert.rejects(s.put(dup), (err) => err.code === 'conflict', kind);
    assert.equal(await s.get('dup-x'), null, `${kind}: nothing written`);
    // Execution facts never move.
    const back = await s.get('fixture-b');
    assert.deepEqual(schema.executionFactChanges(b.experiment, back), ['annotations'], kind);
    await s.annotate('fixture-b', { baseline: false });
    assert.equal((await s.list()).some((r) => r.baseline), false, kind);
  }
});

test('ADR 0041: the baseline persists across reopening and round-trips through export',
  async () => {
    const { a } = await fx();
    const fake = fakeIndexedDB();
    const s1 = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'bp', ...OPTS });
    await s1.put(a.experiment);
    await s1.annotate('fixture-a', { baseline: true });
    s1.close();
    const s2 = await store.openExperimentStore({ indexedDB: fake.indexedDB, name: 'bp', ...OPTS });
    const back = await s2.get('fixture-a');
    assert.equal(schema.isBaseline(back), true);
    assert.equal((await s2.list())[0].baseline, true);
    const json = schema.experimentToJson(exportableExperiment(back), 2);
    assert.match(json, /"baseline": true/);
    const v = validateExperiment(json, OPTS);
    assert.ok(v.ok, v.ok ? '' : schema.formatErrors(v.errors));
    assert.equal(v.experiment.provenance.resultHash, a.experiment.provenance.resultHash);
    const s3 = store.createMemoryStore(OPTS);
    await s3.put(v.experiment);
    assert.equal(schema.isBaseline(await s3.get('fixture-a')), true, 'imported with its mark');
  });

test('ADR 0041: Compare defaults to the baseline (compareSelection)', () => {
  const { compareSelection } = summary;
  assert.equal(typeof compareSelection, 'function');
  assert.deepEqual(compareSelection(['x', 'y']), ['x', 'y']);
  assert.deepEqual(compareSelection(['x', 'y', 'b'], 'b'), ['b', 'x', 'y']);
  assert.deepEqual(compareSelection(['x'], 'b'), ['b', 'x']);
  assert.equal(compareSelection(['x']), null);
  assert.equal(compareSelection(['b'], 'b'), null);
  assert.deepEqual(compareSelection(['1', '2', '3', '4', '5'], '5'), ['5', '1', '2', '3']);
  const rows = summary.experimentListRows([
    { experimentId: 'x', name: 'X' }, { experimentId: 'b', name: 'B', baseline: true }],
  { selected: ['x'] });
  assert.equal(rows.baselineId, 'b');
  assert.equal(rows.canCompare, true);
  assert.deepEqual(rows.rows.map((r) => r.baseline), [false, true]);
});
