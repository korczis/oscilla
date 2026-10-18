// V272 final review A4, A5, A8: a Studio measurement's recipe is what the graph and the timeline
// show, or nothing. Two Sweep references into Transfer Analyzers are ambiguous whatever the array
// order (A4); a muted connection on the measured path, or a Master Output level other than the
// one the run plays at, is refused (A5); the measurement clips must be the pass the engine runs:
// every phase present, in engine order, back to back, the capture spanning pre-roll to tail (A8).
//   node --test tests/unit/v272-studio-measurement-recipe.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { normalizeStudio, studioHash } from '../../src/js/studio/schema.js';
import {
  measuredPath, recipeFromStudio, verifyExperimentStudio, withStudioProvenance,
} from '../../src/js/studio/provenance.js';
import { createStudioMeasurementRun } from '../../src/js/studio/measurement-run.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const SR = 48000;
const copy = (x) => JSON.parse(JSON.stringify(x));

function store(model = templateModel(MEASUREMENT_TEMPLATE_ID)) {
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

/** The template after `actions` through the store (each must be accepted). */
function edited(actions) {
  const s = store();
  for (const a of actions) {
    const r = s.dispatch(a);
    assert.ok(r.ok, `${JSON.stringify(a)}: ${r.reason}`);
  }
  return s.getModel();
}

const refused = (model, opts = {}) => {
  const r = recipeFromStudio(model, { sampleRate: SR, ...opts });
  assert.equal(r.ok, false, 'refused');
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0, 'with a reason');
  return r.reason;
};

// ---------------------------------------------------------------- A4

/** The template plus a second Sweep wired to a second analyzer's REFERENCE (array order). */
function twoReferences() {
  const doc = copy(templateModel(MEASUREMENT_TEMPLATE_ID));
  doc.graph.nodes.push(
    { id: 'sweep-0', type: 'sweep', position: { x: 0, y: 500 }, params: { curve: 'log' },
      metadata: { name: 'Sweep B' } },
    { id: 'transfer-0', type: 'transfer-analyzer', position: { x: 400, y: 500 }, params: {},
      metadata: { name: 'Analyzer B' } });
  doc.graph.edges.push({ id: 'edge-9', from: { node: 'sweep-0', port: 'reference' },
    to: { node: 'transfer-0', port: 'reference' }, props: {} });
  const a = normalizeStudio(doc);
  const b = normalizeStudio({ ...doc, graph: { ...doc.graph,
    nodes: [...doc.graph.nodes].sort((x, y) => (x.id < y.id ? -1 : 1)) } });
  return { a, b };
}

test('V272 A4: two Sweep references give one verdict and one measured path in any array order',
  () => {
    const { a, b } = twoReferences();
    assert.equal(studioHash(a), studioHash(b), 'array order is not part of the setup');
    const ra = refused(a);
    assert.equal(refused(b), ra, 'the same reason for both orders');
    assert.match(ra, /More than one Sweep reference reaches a Transfer Analyzer/);
    assert.deepEqual(measuredPath(a), measuredPath(b));
    for (const m of [a, b]) {
      const v = verifyExperimentStudio(withStudioProvenance({ schemaVersion: 1 }, m));
      assert.ok(v.ok, v.errors.join(' | '));
    }
  });

test('V272 A4: one Sweep wired to two analyzers\' REFERENCE inputs is refused too', () => {
  const s = store();
  const t = s.dispatch({ type: 'NODE_ADD', nodeType: 'transfer-analyzer',
    position: { x: 0, y: 600 } });
  assert.ok(t.ok, t.reason);
  const id = t.created.nodes[0];
  assert.ok(s.dispatch({ type: 'EDGE_ADD', from: { node: 'sweep-1', port: 'reference' },
    to: { node: id, port: 'reference' } }).ok);
  assert.match(refused(s.getModel()), /More than one Sweep reference/);
});

// ---------------------------------------------------------------- A5

test('V272 A5: a muted connection on the measured path refuses the recipe', () => {
  for (const id of ['edge-1', 'edge-2', 'edge-3', 'edge-4']) {
    const m = edited([{ type: 'EDGE_UPDATE', edgeId: id, props: { muted: true } }]);
    assert.match(refused(m), /is muted/, id);
  }
  // A muted connection off the measured path (Analyzer → Result) does not matter to the run.
  const off = edited([{ type: 'EDGE_UPDATE', edgeId: 'edge-5', props: { muted: true } }]);
  assert.equal(recipeFromStudio(off, { sampleRate: SR }).ok, true);
});

test('V272 A5: a Master Output level other than the run\'s output level is refused', () => {
  const m0 = templateModel(MEASUREMENT_TEMPLATE_ID);
  const level = m0.graph.nodes.find((n) => n.id === 'master-1').params.level;
  assert.equal(recipeFromStudio(m0, { sampleRate: SR, outputLevel: level }).ok, true);
  const silent = edited([{ type: 'NODE_PARAM_SET', nodeId: 'master-1', key: 'level',
    value: 0 }]);
  assert.match(refused(silent, { outputLevel: level }), /Master.*level 0\b.*plays at/);
  assert.match(refused(m0, { outputLevel: 0.2 }), /plays at 0\.2/);
});

test('V272 A5: the Studio run derives with the output level the run plays at', async () => {
  const views = [];
  const runner = createStudioMeasurementRun({
    getModel: () => templateModel(MEASUREMENT_TEMPLATE_ID), sampleRate: () => SR,
    now: () => 0, run: async () => ({ ok: true }), outputLevel: () => 0.2,
    onChange: (v) => views.push(v),
    timers: { setTimeout: () => 1, clearTimeout: () => {} } });
  runner.hook({ type: 'schedule', key: 'clip-1:0', clipId: 'clip-1', pass: 0, startTime: 0 });
  assert.equal(runner.view.state, 'failed');
  assert.match(runner.view.text, /Measurement not run: .*plays at 0\.2/);
});

// ---------------------------------------------------------------- A8

test('V272 A8: the measurement clips must be the pass the engine runs', () => {
  const cases = [
    ['capture clip shortened', [{ type: 'CLIP_RESIZE', clipId: 'clip-6', duration: 0.5 }],
      /capture clip/],
    ['pre-roll after the tail', [{ type: 'CLIP_MOVE', clipId: 'clip-2', start: 9 }],
      /order/],
    ['a gap before the stimulus', [{ type: 'CLIP_MOVE', clipId: 'clip-5', start: 40 },
      { type: 'CLIP_MOVE', clipId: 'clip-4', start: 36 },
      { type: 'CLIP_MOVE', clipId: 'clip-3', start: 30 }], /back to back/],
    ['analysis clip removed', [{ type: 'CLIP_REMOVE', clipId: 'clip-5' }], /no analysis clip/],
    ['capture clip removed', [{ type: 'CLIP_REMOVE', clipId: 'clip-6' }], /no capture clip/],
    ['stimulus clip longer than its Sweep', [{ type: 'CLIP_RESIZE', clipId: 'clip-3',
      duration: 6 }], /longer than/],
  ];
  for (const [label, actions, why] of cases) {
    assert.match(refused(edited(actions)), why, label);
  }
});

test('V272 A8: the template, and a shortened pass kept back to back, still derive', () => {
  assert.equal(recipeFromStudio(templateModel(MEASUREMENT_TEMPLATE_ID), { sampleRate: SR }).ok,
    true);
  const m = edited([
    { type: 'NODE_PARAM_SET', nodeId: 'sweep-1', key: 'duration', value: 1 },
    { type: 'CLIP_RESIZE', clipId: 'clip-1', start: 0.75, duration: 0.25 },
    { type: 'CLIP_RESIZE', clipId: 'clip-3', duration: 1 },
    { type: 'CLIP_MOVE', clipId: 'clip-4', start: 2.5 },
    { type: 'CLIP_MOVE', clipId: 'clip-5', start: 3.5 },
    { type: 'CLIP_RESIZE', clipId: 'clip-6', duration: 2.5 },
  ]);
  const r = recipeFromStudio(m, { sampleRate: SR });
  assert.ok(r.ok, r.reason);
  assert.equal(r.recipe.analysis.noiseCheckS, 0.25);
});
