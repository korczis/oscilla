// v4.0 completion ledger, measurement truth (docs/v4/completion-ledger.md):
//   C1  an unbound manual level calibration applied to every input: a reading typed before any
//       setup check had no input binding, and levelCalibrationApplies() applied it to whatever
//       input came next (CALIBRATED, dB SPL). A level calibration is now refused until an input
//       is known; one without a binding (schema 1, earlier records) never applies to a known
//       input, and records say "not bound to an input" (ADR 0017, resolution 2026-10-06).
//   D3  the Studio block hashed nodes the measurement did not use: an unconnected Oscillator
//       changed studioHash and read as an execution change between two identical measurements.
//       The block now also records the measured path (the nodes, connections and measurement
//       clips the recipe was derived from) with its own hash; compare classifies Studio changes
//       outside it as 'unmeasured' (ADR 0038, resolution 2026-10-06).
//   D4  the experiment schema accepts six stimulus kinds and the engine measures log sweeps
//       only: Repeat of a white-noise record silently ran a log sweep. Such a record imports
//       with a finding and Repeat or "Run this definition" refuses it (ADR 0043, resolution
//       2026-10-06).
//   node --test tests/unit/v4-measurement-truth.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// Namespace imports: an export this change adds is undefined before it, so each test fails on
// its own assertion (the fail-before) rather than the whole file failing to load.
import * as level from '../../src/js/calibration/level.js';
import * as schema from '../../src/js/experiments/schema.js';
import * as hash from '../../src/js/experiments/hash.js';
import * as validate from '../../src/js/experiments/validate.js';
import { runChanges } from '../../src/js/experiments/semantic-diff.js';
import { evidenceLineage, reproducibilityChecklist } from '../../src/js/experiments/evidence.js';
import * as definition from '../../src/js/experiments/definition.js';
import { DB_NAME, openExperimentStore } from '../../src/js/experiments/store.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';
import * as engine from '../../src/js/measurement/engine.js';
import { normalizeStimulus } from '../../src/js/measurement/stimulus.js';
import { buildCompareView } from '../../src/js/measurement/views/compare-view.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { studioChanges } from '../../src/js/studio/diff.js';
import * as provenance from '../../src/js/studio/provenance.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createMeasureUi } from '../../src/js/ui/measure.js';
import { createExperimentsUi } from '../../src/js/ui/experiments.js';
import { buildFixtures, SR } from '../browser/fixtures/v3-experiments.mjs';
import { fakeIndexedDB } from './fixtures/fake-indexeddb.mjs';

const { createLevelCalibration, levelCalibrationApplies, levelLabel } = level;
const isBoundLevelCalibration = (c) => level.isBoundLevelCalibration(c);
const { describeCalibration, experimentToJson } = schema;
const { configHash, withConfigHash, resultHash, withResultHash } = hash;
const measuredPathHash = (x, ids) => hash.measuredPathHash(x, ids);
const { validateExperiment } = validate;
const { recipeFromStudio, studioProvenance, verifyExperimentStudio, withStudioProvenance }
  = provenance;
const measuredPath = (m) => provenance.measuredPath(m);

const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const clone = (v) => structuredClone(v);
let fixtures;
const fx = async () => {
  fixtures = fixtures || await buildFixtures();
  return fixtures;
};
const restamp = (e) => {
  const c = withConfigHash(e, configHash(e));
  return withResultHash(c, resultHash(c));
};

const FACTS = Object.freeze({
  device: { label: 'USB mic', id: 'raw-device-id-0123456789' },
  constraints: { requested: { echoCancellation: false },
    applied: { echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, sampleRate: 48000, deviceId: 'raw-device-id-0123456789' } },
  sampleRate: 48000,
});
const OTHER = Object.freeze({ ...FACTS, device: { label: 'Another mic', id: 'another-device' },
  constraints: { ...FACTS.constraints, applied: { ...FACTS.constraints.applied,
    deviceId: 'another-device' } } });

const levelCal = (input) => createLevelCalibration({ referenceHz: 1000, referenceDbSpl: 94,
  observedDbRelative: -30, createdAt: '2026-10-06T00:00:00Z', method: 'manual', input });
const V1_LEVEL = Object.freeze({ schemaVersion: 1, kind: 'level', referenceHz: 1000,
  referenceDbSpl: 94, observedDbRelative: -30, offsetDb: 124, conditions: null, createdAt: 'x' });

/** The MEASURE and EXPERIMENTS adapters composed as main.js composes them (no DOM). */
async function makeUi(seed = null) {
  const fake = fakeIndexedDB();
  if (seed) {
    const s = await openExperimentStore({ indexedDB: fake.indexedDB, ...OPTS });
    await seed(s, fake.dbs.get(DB_NAME));
    s.close();
  }
  globalThis.indexedDB = fake.indexedDB;
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
  return { cmp, notes };
}

// ================================================================= C1

test('C1: a level calibration without an input binding never applies to a known input', () => {
  const unbound = levelCal(null);
  assert.equal(unbound.input, null);
  assert.equal(isBoundLevelCalibration(unbound), false);
  assert.equal(isBoundLevelCalibration(V1_LEVEL), false, 'schema 1 has no binding');
  assert.equal(isBoundLevelCalibration(levelCal(FACTS)), true);
  for (const cal of [unbound, V1_LEVEL]) {
    const a = levelCalibrationApplies(cal, FACTS);
    assert.equal(a.applies, false, 'an unknown binding is not a match');
    assert.equal(a.checked, true);
    assert.match(a.reason, /^UNCALIBRATED: the level calibration is not bound to an input/);
    const label = levelLabel(cal, FACTS);
    assert.equal(label.indicator, 'UNCALIBRATED');
    assert.equal(label.unit, 'dB relative (dBFS-like)');
  }
  // A bound calibration on its own input still applies; on another it is void (unchanged).
  assert.equal(levelCalibrationApplies(levelCal(FACTS), FACTS).applies, true);
  assert.equal(levelCalibrationApplies(levelCal(FACTS), OTHER).applies, false);
  // No current input (a stored record, read on its own): nothing is compared.
  assert.deepEqual(levelCalibrationApplies(unbound, null),
    { applies: true, checked: false, reason: null, differences: [] });
});

test('C1: a reading typed before any input is known is refused and says why', async () => {
  const { cmp } = await makeUi();
  const seam = cmp.measureTestSeam();
  assert.equal(seam.inputNow, null, 'no setup check yet');
  cmp.measureSetLevelManual(true);
  Object.assign(cmp.meas.levelForm, { referenceHz: '1000', referenceDb: '94',
    observedDb: '-30' });
  assert.match(cmp.measureLevelManualNote, /Run the setup check first/);
  assert.equal(cmp.measureSaveLevelCalibration(), false);
  assert.match(cmp.meas.levelForm.error, /Run the setup check first: a level calibration is valid/);
  assert.equal(seam.levelCalibration, null, 'nothing stored');
  assert.equal(cmp.meas.cal.level, null);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  // Once an input is known the same reading is stored, bound to it.
  seam.setInputNow(FACTS);
  assert.equal(cmp.measureLevelManualNote, '');
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  const cal = seam.levelCalibration;
  assert.equal(isBoundLevelCalibration(cal), true);
  assert.equal(cal.input.sampleRate, 48000);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
  assert.match(cmp.measureLevelStateText, /entered by hand, bound to the input checked when it/);
  // The scenario of the finding: another microphone is plugged in and checked.
  seam.setInputNow(OTHER);
  assert.equal(cmp.measureCalIndicator, 'UNCALIBRATED');
  assert.match(cmp.meas.cal.levelVoid, /a different input device/);
  // Removed and typed again for the input now known: bound to that one.
  cmp.measureClearLevelCalibration();
  assert.equal(cmp.measureSaveLevelCalibration(), true);
  assert.equal(cmp.measureCalIndicator, 'CALIBRATED');
});

test('C1: records without a binding say so in the summary, compare and evidence', async () => {
  const { a } = await fx();
  const bound = levelCal(FACTS);
  const unbound = levelCal(null);
  assert.match(describeCalibration({ frequency: null, level: unbound }),
    /SPL CALIBRATED \(94 dB SPL at 1 kHz; not bound to an input\)/);
  assert.match(describeCalibration({ frequency: null, level: V1_LEVEL }), /not bound to an input/);
  assert.doesNotMatch(describeCalibration({ frequency: null, level: bound }), /not bound/);
  // Evidence: the lineage and the checklist reason never imply a checked binding.
  // A record whose results say the level calibration was applied (no contradicted claim).
  const rec = (level) => {
    const e = clone(a.experiment);
    e.calibration = { ...e.calibration, level };
    e.quality.metrics.levelCalibrated = true;
    e.quality.reasons = e.quality.reasons.map((r) => (r.code === 'LEVEL_CALIBRATION'
      ? { ...r, severity: 'ok', value: level.offsetDb, text: 'level calibration applied' } : r));
    return e;
  };
  const lin = evidenceLineage(rec(unbound)).find((l) => l.id === 'calibration').text;
  assert.match(lin, /not bound to an input: the record cannot show which input it was taken/);
  assert.doesNotMatch(lin, /applies to every input/);
  const item = reproducibilityChecklist(rec(unbound)).find((i) => i.id === 'calibration');
  assert.equal(item.state, 'partial');
  assert.match(item.reason, /not bound to an input/);
  assert.doesNotMatch(item.reason, /applies to every input/);
  // Compare names the missing binding beside the reference.
  const ea = rec(unbound);
  const eb = rec(bound);
  eb.experimentId = 'bound-run';
  const v = buildCompareView([ea, eb]);
  const d = v.differences.find((x) => x.field === 'calibration.level')
    || v.common.find((x) => x.field === 'calibration.level');
  const texts = d.values ? d.values.map((x) => x.text) : [d.text];
  assert.ok(texts.some((t) => /not bound to an input/.test(t)), JSON.stringify(texts));
});

// ================================================================= D3

const SWEEP_PATH = Object.freeze({
  nodes: ['cal-1', 'master-1', 'mic-1', 'sweep-1', 'transfer-1'],
  edges: ['edge-1', 'edge-2', 'edge-3', 'edge-4'],
  clips: ['clip-1', 'clip-2', 'clip-3', 'clip-4', 'clip-5', 'clip-6'],
});

function measurementStore() {
  const model = templateModel(MEASUREMENT_TEMPLATE_ID);
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

const ok = (r) => {
  assert.ok(r.ok, r.reason);
  return r;
};

/** An Oscillator, alone or feeding a Filter of its own (a chain the measurement never reads). */
function addOscillator(store, { chain = false } = {}) {
  const osc = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator',
    position: { x: 0, y: 0 }, params: { frequency: 440 } })).created.nodes[0];
  if (chain) {
    const f = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'filter',
      position: { x: 0, y: 0 }, params: { frequency: 200 } })).created.nodes[0];
    ok(store.dispatch({ type: 'EDGE_ADD', from: { node: osc, port: 'audio' },
      to: { node: f, port: 'audio' } }));
  }
  return osc;
}

async function studioRun(model, id) {
  const { a } = await fx();
  assert.equal(recipeFromStudio(model, { sampleRate: SR }).ok, true);
  const e = withStudioProvenance(clone(a.experiment), model);
  e.experimentId = id;
  return e;
}

test('D3: the Studio block records the measured path the recipe was derived from', () => {
  const m = measurementStore().getModel();
  const p = measuredPath(m);
  assert.deepEqual({ nodes: p.nodes, edges: p.edges, clips: p.clips }, SWEEP_PATH);
  const s = studioProvenance(m);
  assert.deepEqual(Object.keys(s), ['schemaVersion', 'studioHash', 'execution', 'measured']);
  assert.deepEqual(s.measured, { v: 1, ...SWEEP_PATH,
    hash: measuredPathHash(s.execution, SWEEP_PATH) });
  // The Measurement Result node displays the result; the measurement does not read it.
  assert.ok(!s.measured.nodes.includes('result-1'));
  // A graph with no Sweep reference into a Transfer Analyzer has no measured path.
  assert.equal(measuredPath(templateModel('basic-tone')), null);
  assert.equal('measured' in studioProvenance(templateModel('basic-tone')), false);
});

test('D3: an unconnected node changes studioHash but not the measured path', () => {
  const store = measurementStore();
  const before = studioProvenance(store.getModel());
  addOscillator(store);
  const after = studioProvenance(store.getModel());
  assert.notEqual(after.studioHash, before.studioHash, 'the whole graph is still recorded');
  assert.equal(after.measured.hash, before.measured.hash);
  assert.deepEqual(after.measured, before.measured);
  // Nor a chain of its own: the measurement reads the Sweep, its route to the Master Output,
  // the analyzer and its observed chain, and the measurement clips, nothing else.
  addOscillator(store, { chain: true });
  assert.equal(studioProvenance(store.getModel()).measured.hash, before.measured.hash);
  // A parameter on the path changes it.
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 6 }));
  assert.notEqual(studioProvenance(store.getModel()).measured.hash, before.measured.hash);
});

test('D3: compare does not call a change outside the measured path an execution change',
  async () => {
    const s1 = measurementStore();
    const s2 = measurementStore();
    const osc = addOscillator(s2, { chain: true });
    const ea = await studioRun(s1.getModel(), 'run-a');
    const eb = await studioRun(s2.getModel(), 'run-b');
    assert.notEqual(ea.studio.studioHash, eb.studio.studioHash);
    const changes = runChanges(ea, eb, { studioChanges }).filter((c) => c.domain === 'studio'
      && c.kind !== 'unchanged');
    assert.ok(changes.length >= 2, JSON.stringify(changes.map((c) => c.path)));
    assert.ok(changes.some((c) => c.path === `studio.nodes.${osc}`));
    assert.deepEqual(changes.filter((c) => c.class === 'execution').map((c) => c.path), []);
    assert.ok(changes.every((c) => c.class === 'unmeasured'));
    // The view: no execution change, the group named for what it is and collapsed.
    const v = buildCompareView([ea, eb]);
    const sem = v.semantic[0];
    assert.equal(sem.executionCount, 0);
    const g = sem.groups.find((x) => x.key === 'studio.unmeasured');
    assert.equal(g.other, true);
    assert.match(g.label, /not on the measured path/);
    // A change on the path stays an execution change.
    const s3 = measurementStore();
    ok(s3.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'transfer-1', key: 'phase', value: true }));
    const ec = await studioRun(s3.getModel(), 'run-c');
    const onPath = runChanges(ea, ec, { studioChanges }).filter((c) => c.domain === 'studio'
      && c.kind !== 'unchanged');
    assert.deepEqual(onPath.map((c) => [c.path, c.class]),
      [['studio.nodes.transfer-1.params.phase', 'execution']]);
    // Without the injected comparator: the measured path hash decides.
    const h = runChanges(ea, eb).filter((c) => c.domain === 'studio' && c.kind !== 'unchanged');
    assert.deepEqual(h.map((c) => [c.path, c.class]), [['studio', 'unmeasured']]);
  });

test('D3: the measured path is validated, its hash recomputed and its ids re-derived',
  async () => {
    const e = await studioRun(measurementStore().getModel(), 'run-v');
    const text = experimentToJson(e);
    const v = validateExperiment(text, OPTS);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(experimentToJson(v.experiment), text, 'byte-identical re-export');
    assert.equal(verifyExperimentStudio(v.experiment).ok, true);
    const doc = JSON.parse(text);
    doc.studio.measured.hash = '0'.repeat(64);
    const bad = validateExperiment(JSON.stringify(doc), OPTS);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((x) => x.path === 'studio.measured.hash' && x.code === 'corrupt'));
    // Ids that name an item the execution does not hold.
    const ghost = JSON.parse(text);
    ghost.studio.measured.nodes = [...ghost.studio.measured.nodes, 'ghost-1'].sort();
    assert.ok(validateExperiment(JSON.stringify(ghost), OPTS).errors
      .some((x) => x.path === 'studio.measured.nodes'));
    // A consistent block whose ids are not the path the recipe walk finds.
    const wrong = clone(e);
    const ids = { ...SWEEP_PATH, nodes: SWEEP_PATH.nodes.filter((n) => n !== 'mic-1') };
    wrong.studio = { ...wrong.studio, measured: { v: 1, ...ids,
      hash: measuredPathHash(wrong.studio.execution, ids) } };
    const w = validateExperiment(experimentToJson(wrong), OPTS);
    assert.equal(w.ok, true, 'consistent on its own');
    const check = verifyExperimentStudio(w.experiment);
    assert.equal(check.ok, false);
    assert.match(check.errors.join(), /studio\.measured does not name the path/);
  });

test('D3: an earlier record keeps its hash, verifies and is flagged as the whole graph',
  async () => {
    assert.equal(schema.EXPERIMENT_SCHEMA_VERSION, 4);
    const store = measurementStore();
    const ea = await studioRun(store.getModel(), 'legacy-a');
    addOscillator(store);
    const eb = await studioRun(store.getModel(), 'legacy-b');
    const legacy = (e) => {
      const doc = JSON.parse(experimentToJson(e));
      delete doc.studio.measured;
      doc.schemaVersion = 3;
      return JSON.stringify(doc);
    };
    const va = validateExperiment(legacy(ea), OPTS);
    const vb = validateExperiment(legacy(eb), OPTS);
    assert.equal(va.ok, true, JSON.stringify(va.errors));
    assert.equal(va.migratedFrom, 3);
    assert.equal(va.experiment.schemaVersion, 4);
    assert.equal(va.experiment.studio.studioHash, ea.studio.studioHash);
    assert.equal(va.experiment.provenance.resultHash, ea.provenance.resultHash);
    assert.equal('measured' in va.experiment.studio, false, 'nothing is inferred');
    assert.equal(verifyExperimentStudio(va.experiment).ok, true);
    const changes = runChanges(va.experiment, vb.experiment, { studioChanges })
      .filter((c) => c.domain === 'studio' && c.kind !== 'unchanged');
    assert.ok(changes.length >= 1);
    for (const c of changes) {
      assert.equal(c.class, 'execution', 'the record cannot say the change was not used');
      assert.match(c.note, /records the whole Studio graph/);
    }
    const lin = evidenceLineage(va.experiment).find((l) => l.id === 'studio').text;
    assert.match(lin, /records the whole graph without naming the measured path/);
    const now = evidenceLineage(ea).find((l) => l.id === 'studio').text;
    assert.match(now, /measured path: 5 nodes \(cal-1, master-1, mic-1, sweep-1, transfer-1\)/);
    assert.match(now, /, 4 connections and 6 measurement clips, hash /);
    assert.doesNotMatch(now, /covers the whole graph, including nodes the measurement did not/);
    // A schema-3 file never had a measured path: one that claims it is refused, not trusted.
    const forged = JSON.parse(experimentToJson(ea));
    forged.schemaVersion = 3;
    const f = validateExperiment(JSON.stringify(forged), OPTS);
    assert.equal(f.ok, false);
    assert.match(f.errors[0].text, /schema-3 experiment has no studio\.measured/);
  });

// ================================================================= D4

async function whiteRun() {
  const { a } = await fx();
  const e = clone(a.experiment);
  e.experimentId = 'white-run';
  e.name = 'White noise run';
  const { requested, ...rest } = e.recipe; // eslint-disable-line no-unused-vars
  e.recipe = { ...rest, stimulus: normalizeStimulus({ kind: 'white', sampleRate: SR,
    duration: 2, level: rest.stimulus.level }).spec };
  e.definition = definition.derivedRef(e.recipe);
  return restamp(e);
}

test('D4: the engine runs log sweeps only, and a record of another kind is a finding', async () => {
  assert.deepEqual(engine.MEASURABLE_STIMULUS_KINDS, ['log-sweep']);
  const e = await whiteRun();
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.equal(v.ok, true, 'kept: an imported record is never lost');
  const f = v.findings.find((x) => x.code === validate.STIMULUS_NOT_MEASURABLE);
  assert.ok(f, JSON.stringify(v.findings));
  assert.equal(f.path, 'recipe.stimulus.kind');
  assert.match(f.text, /this run used a white noise stimulus, which this version of OSCILLA/);
  assert.match(f.text, /cannot measure/);
  // Strict (every record the application writes): refused.
  const s = validateExperiment(experimentToJson(e), { ...OPTS, findings: 'strict' });
  assert.equal(s.ok, false);
  assert.equal(s.errors[0].code, validate.STIMULUS_NOT_MEASURABLE);
  // A log-sweep record has no such finding.
  const { a } = await fx();
  assert.deepEqual(validateExperiment(a.json, OPTS).findings, []);
  // The evidence checklist states the same thing (#129).
  const item = reproducibilityChecklist(e).find((i) => i.id === 'recipe');
  assert.equal(item.state, 'partial');
  assert.match(item.reason, /cannot measure/);
});

test('D4: import keeps the record with a warning; Repeat refuses and changes nothing',
  async () => {
    const e = await whiteRun();
    const { cmp, notes } = await makeUi();
    const id = await cmp.experimentsImportText(experimentToJson(e));
    assert.equal(id, 'white-run');
    const imported = notes.pop();
    assert.equal(imported.type, 'warning');
    assert.match(imported.text, /white noise stimulus, which this version of OSCILLA cannot/);
    assert.doesNotMatch(imported.text, /names a calibration/);
    const before = { ...cmp.meas.values };
    assert.equal(await cmp.experimentsRepeat(id), false);
    const refused = notes.pop();
    assert.equal(refused.type, 'error');
    assert.equal(refused.title, 'Repeat refused');
    assert.match(refused.text, /This run used a white noise stimulus, which this version/);
    assert.match(refused.text, /of OSCILLA cannot measure/);
    assert.deepEqual({ ...cmp.meas.values }, before, 'the setup is unchanged');
    assert.equal(cmp.meas.definition, null);
    // The MEASURE adapter refuses the recipe itself, whoever calls it.
    assert.equal(cmp.measureLoadRecipe(e.recipe), false);
    assert.deepEqual({ ...cmp.meas.values }, before);
  });

test('D4: "Run this definition" refuses a definition the engine cannot run', async () => {
  const e = await whiteRun();
  const white = definition.createDefinition({ id: 'def-white', name: 'White', now: Date.now(),
    execution: definition.buildExecution({ recipe: definition.setupRecipe(e.recipe) }) });
  const { cmp, notes } = await makeUi(async (s) => { await s.putDefinition(white); });
  let started = 0;
  cmp.measureStart = async () => { started += 1; };
  assert.equal(await cmp.experimentsDefRun('def-white'), false);
  assert.equal(started, 0, 'nothing is measured');
  const n = notes.pop();
  assert.equal(n.type, 'error');
  assert.equal(n.title, 'Definition not run');
  assert.match(n.text, /a white noise stimulus, which this version of OSCILLA cannot measure/);
  assert.equal(cmp.meas.definition, null, 'not loaded');
});
