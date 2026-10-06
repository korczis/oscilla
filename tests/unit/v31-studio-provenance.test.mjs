// V3.1 Studio in experiment provenance (src/js/studio/provenance.js; experiments/validate.js and
// hash.js `studio` block). Spec §106, §109-§110, §162-§163, §252, §255, §258; ADR 0019, ADR 0038.
// Plan issue V425.
//   node --test tests/unit/v31-studio-provenance.test.mjs
//
// Tolerances: none. The recipe derived from the Measurement Sweep template is compared with
// the stimulus module's own normalization of the same values (no arithmetic beyond
// min(0.01, 5 / 4) = 0.01); hashes and exported text are compared byte for byte.

import test from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

import {
  executionToModel, recipeFromStudio, studioProvenance, verifyExperimentStudio,
  withStudioProvenance,
} from '../../src/js/studio/provenance.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import {
  STUDIO_HASH_VERSION, STUDIO_SCHEMA_VERSION, executionState, normalizeStudio, serializeStudio,
  studioHash,
} from '../../src/js/studio/schema.js';
import { canonicalJson } from '../../src/js/experiments/canonical-json.js';
import {
  createExperiment, experimentToJson, withResults,
} from '../../src/js/experiments/schema.js';
import { validateExperiment } from '../../src/js/experiments/validate.js';
import {
  configHash, studioExecutionHash, withConfigHash, measuredPathHash,
} from '../../src/js/experiments/hash.js';
import { createMemoryStore } from '../../src/js/experiments/store.js';
import { normalizeStimulus } from '../../src/js/measurement/stimulus.js';
import { DEFAULT_TIMING, validateRecipe } from '../../src/js/measurement/engine.js';
import { KNOWN_ALGORITHM_IDS } from '../../src/js/measurement/algorithms.js';

const NOW = '2026-10-02T12:00:00.000Z';
const SR = 48000;
const OPTS = { knownAlgorithms: KNOWN_ALGORITHM_IDS };
const nodeSha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const measurement = () => templateModel(MEASUREMENT_TEMPLATE_ID);

/** The experiment a Studio measurement run starts with: recipe derived, Studio recorded. */
function studioExperiment(model = measurement(), id = 'studio-run-1') {
  const r = recipeFromStudio(model, { sampleRate: SR });
  assert.strictEqual(r.ok, true, r.reason);
  const e = createExperiment({ recipe: r.recipe, now: NOW, id, name: 'Desk speaker',
    sampleRate: SR, build: { version: '9.8.7', commit: '8f38e3d' } });
  return withStudioProvenance(withConfigHash(e, configHash(e)), model);
}

// ---------------------------------------------------------------- the block (§109, §163)

test('§109 the Studio block is schema version, studioHash, execution state, measured path', () => {
  const m = measurement();
  const s = studioProvenance(m);
  // Ledger D3: the measured path names what the measurement depended on (v4-measurement-truth).
  assert.deepStrictEqual(Object.keys(s), ['schemaVersion', 'studioHash', 'execution',
    'measured']);
  assert.strictEqual(s.measured.hash, measuredPathHash(s.execution, s.measured));
  assert.strictEqual(s.schemaVersion, STUDIO_SCHEMA_VERSION);
  assert.strictEqual(s.studioHash, studioHash(m));
  assert.strictEqual(s.studioHash, nodeSha(canonicalJson(executionState(m))));
  assert.strictEqual(studioExecutionHash(s.execution), s.studioHash,
    'the experiment layer recomputes the same hash without the Studio layer');
  assert.strictEqual(s.execution.v, STUDIO_HASH_VERSION);
  const json = JSON.stringify(s);
  for (const word of ['position', 'metadata', 'view', 'markers', 'selection', 'panX', 'name']) {
    assert.ok(!json.includes(`"${word}"`), `${word} never enters provenance (§163, §252)`);
  }
  assert.throws(() => studioProvenance(normalizeStudio({ graph: { nodes: [
    { id: 'osc-1', type: 'nope', position: { x: 0, y: 0 }, params: {} }] } })), TypeError);
});

test('§255 view state and presentation never change the provenance; parameters do', () => {
  const store = createStudioStore(measurement(), { idGenerator: createIdGenerator(measurement()) });
  const before = studioProvenance(store.getModel());
  store.dispatch({ type: 'VIEW_SET', view: { graph: { panX: 120, zoom: 2 } } });
  store.dispatch({ type: 'SELECTION_CHANGE', selection: { nodes: ['sweep-1'] } });
  store.dispatch({ type: 'NODE_MOVE', nodeId: 'sweep-1', position: { x: 300, y: 300 } });
  store.dispatch({ type: 'NODE_RENAME', nodeId: 'sweep-1', name: 'Stimulus' });
  assert.deepStrictEqual(studioProvenance(store.getModel()), before);
  store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 6 });
  assert.notStrictEqual(studioProvenance(store.getModel()).studioHash, before.studioHash);
});

// ---------------------------------------------------------------- recipe (§110, ADR 0019)

test('§110 the recipe is derived from the topology and the measurement engine accepts it', () => {
  const m = measurement();
  const r = recipeFromStudio(m, { sampleRate: SR });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sweepId, 'sweep-1');
  assert.strictEqual(r.analyzerId, 'transfer-1');
  // Exactly what the Sweep adapter renders (fade = min(SWEEP_FADE_S, duration / 4)).
  assert.deepStrictEqual(r.recipe.stimulus, normalizeStimulus({ kind: 'log-sweep',
    sampleRate: SR, duration: 5, level: 0.5, f1: 20, f2: 20000, fade: 0.01 }).spec);
  // Timing from the measurement clips: pre-roll 0.5 s, tail 1 s, noise check 1 s.
  assert.deepStrictEqual(r.recipe.analysis, { preRollS: 0.5, postRollS: 1,
    gapS: DEFAULT_TIMING.gapS, noiseCheckS: 1, phase: false, aggregation: 'mean' });
  assert.strictEqual(r.recipe.repeats, 1);
  const plan = validateRecipe(r.recipe, { sampleRate: SR });
  assert.deepStrictEqual(plan.timing, { preRollS: 0.5, postRollS: 1, gapS: 0.5,
    noiseCheckS: 1 });
  assert.strictEqual(plan.stimulusSpec.duration, 5);
  // Refusals are explicit, never thrown.
  assert.deepStrictEqual(recipeFromStudio(m, {}), { ok: false,
    reason: 'A sample rate is needed to derive the stimulus.' });
  assert.match(recipeFromStudio(templateModel('basic-tone'), { sampleRate: SR }).reason,
    /no Transfer Analyzer/);
  const lin = JSON.parse(serializeStudio(m));
  lin.graph.nodes[0].params.curve = 'linear';
  assert.match(recipeFromStudio(normalizeStudio(lin), { sampleRate: SR }).reason,
    /not logarithmic/);
  const noClips = JSON.parse(serializeStudio(m));
  noClips.timeline.clips = [];
  assert.deepStrictEqual(recipeFromStudio(normalizeStudio(noClips), { sampleRate: SR }).recipe
    .analysis, { ...DEFAULT_TIMING, phase: false, aggregation: 'mean' }, 'engine defaults');
});

test('ADR 0019: the recipe stays authoritative — Studio never enters configHash', () => {
  const e = studioExperiment();
  const { studio, ...plain } = e;
  assert.ok(studio);
  assert.strictEqual(configHash(e), configHash(plain));
  assert.strictEqual(e.provenance.configHash, configHash(plain));
  // A measurement run from the Measure workspace with the same recipe: same configHash.
  const measure = createExperiment({ recipe: e.recipe, now: '2026-10-03T08:00:00.000Z',
    id: 'measure-run-1', sampleRate: SR, build: { version: '9.8.7', commit: '8f38e3d' } });
  assert.strictEqual(configHash(measure), configHash(e));
});

// ---------------------------------------------------------------- round trip (§109, ADR 0038)

test('ADR 0038 round trip: export → validate → import keeps the Studio block byte for byte', () => {
  const e = studioExperiment();
  const text = experimentToJson(e);
  const v = validateExperiment(text, OPTS);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.deepStrictEqual(v.experiment, e);
  assert.strictEqual(experimentToJson(v.experiment), text, 're-export is byte-identical');
  const check = verifyExperimentStudio(v.experiment);
  assert.strictEqual(check.ok, true, check.errors.join());
  assert.strictEqual(check.present, true);
  assert.strictEqual(studioHash(check.model), e.studio.studioHash);
  assert.deepStrictEqual(executionState(check.model), e.studio.execution);
  // The rebuilt model is the template's execution state; presentation is at defaults.
  assert.strictEqual(canonicalJson(executionState(check.model)),
    canonicalJson(executionState(measurement())));
  assert.deepStrictEqual(check.model.graph.nodes[0].position, { x: 0, y: 0 });
  // With results added later (the run), the Studio block stays and still verifies.
  const done = withResults(v.experiment, { startedAt: NOW, sampleRate: SR });
  assert.strictEqual(validateExperiment(experimentToJson(done), OPTS).ok, true);
  assert.deepStrictEqual(done.studio, e.studio);
});

test('ADR 0038 through the experiment store: put → get keeps the Studio block', async () => {
  const store = createMemoryStore(OPTS);
  const e = studioExperiment();
  await store.put(e);
  const got = await store.get(e.experimentId);
  assert.deepStrictEqual(got.studio, e.studio);
  assert.strictEqual(verifyExperimentStudio(got).ok, true);
});

test('experiments without Studio are unchanged: no studio key, same text as before', () => {
  const e = createExperiment({ recipe: recipeFromStudio(measurement(), { sampleRate: SR }).recipe,
    now: NOW, id: 'plain-1' });
  const v = validateExperiment(experimentToJson(e), OPTS);
  assert.strictEqual(v.ok, true);
  assert.strictEqual('studio' in v.experiment, false, 'presence is kept: absent stays absent');
  assert.deepStrictEqual(verifyExperimentStudio(v.experiment), { ok: false, present: false,
    errors: ['The experiment has no Studio block.'] });
});

test('§109 tampering with the Studio block is corrupt; malformed blocks are rejected', () => {
  const e = studioExperiment();
  const doc = () => JSON.parse(experimentToJson(e));
  const errs = (d) => {
    const v = validateExperiment(d, OPTS);
    assert.strictEqual(v.ok, false);
    return v.errors;
  };
  const param = doc();
  param.studio.execution.nodes.find((x) => x.id === 'sweep-1').params.level = 0.9;
  // The Sweep is on the measured path: both hashes catch it.
  assert.deepStrictEqual(errs(param).map((x) => [x.path, x.code]),
    [['studio.studioHash', 'corrupt'], ['studio.measured.hash', 'corrupt']]);
  const hash = doc();
  hash.studio.studioHash = '0'.repeat(64);
  assert.strictEqual(errs(hash)[0].code, 'corrupt');
  const extra = doc();
  extra.studio.view = { panX: 1 };
  assert.strictEqual(errs(extra)[0].path, 'studio.view');
  const execExtra = doc();
  execExtra.studio.execution.selection = [];
  assert.strictEqual(errs(execExtra)[0].path, 'studio.execution.selection');
  const version = doc();
  version.studio.schemaVersion = 2;
  assert.strictEqual(errs(version)[0].path, 'studio.execution.schemaVersion');
  const kind = doc();
  kind.studio.execution.kind = 'oscilla-experiment';
  assert.strictEqual(errs(kind)[0].path, 'studio.execution.kind');
  const proto = experimentToJson(e).replace('"execution":{', '"execution":{"__proto__":{},');
  assert.strictEqual(validateExperiment(proto, OPTS).ok, false);
  const big = doc();
  big.studio.execution.nodes = Array.from({ length: 20001 }, () => ({}));
  assert.match(errs(big)[0].text, /more than 20000 elements/);
});

test('§109 a hash-consistent but semantically invalid execution state fails verification', () => {
  const e = studioExperiment();
  const forged = JSON.parse(experimentToJson(e));
  // Swap reference and observed (§191) and re-stamp the hash: integrity holds, semantics not.
  const edges = forged.studio.execution.edges;
  edges.find((x) => x.id === 'edge-2').to.port = 'observed';
  edges.find((x) => x.id === 'edge-4').to.port = 'reference';
  forged.studio.studioHash = studioExecutionHash(forged.studio.execution);
  forged.studio.measured.hash = measuredPathHash(forged.studio.execution, forged.studio.measured);
  const v = validateExperiment(forged, OPTS);
  assert.strictEqual(v.ok, true, 'shape and integrity only at the experiment layer');
  const check = verifyExperimentStudio(v.experiment);
  assert.strictEqual(check.ok, false);
  assert.match(check.errors[0], /studio\.execution: .*reference/i);
  // Not in normalized form (a missing default parameter) is also caught.
  const partial = JSON.parse(experimentToJson(e));
  delete partial.studio.execution.nodes.find((x) => x.id === 'transfer-1').params.phase;
  partial.studio.studioHash = studioExecutionHash(partial.studio.execution);
  partial.studio.measured.hash = measuredPathHash(partial.studio.execution,
    partial.studio.measured);
  const p = verifyExperimentStudio(validateExperiment(partial, OPTS).experiment);
  assert.deepStrictEqual(p.errors, ['studio.execution is not in the normalized form of its own '
    + 'model', 'studio.studioHash does not match']);
  assert.throws(() => executionToModel({ ...e.studio.execution, nodes: [{ id: 'x-1',
    type: 'nope', params: {} }], edges: [] }), /unknown node type "nope"/);
});
