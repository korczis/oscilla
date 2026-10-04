// V431 review A1: a Studio measurement records its whole graph beside the recipe, so the recipe
// is refused when the graph shows processing the run does not do (a filter between the Sweep
// and the Master Output, a calibration MEASURE does not apply, a different analysis grid).
//   node --test tests/unit/v431-studio-recipe-unused.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { recipeFromStudio } from '../../src/js/studio/provenance.js';
import { MEASUREMENT_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';

const SR = 48000;
const PROFILE = 'a'.repeat(64);

function measurement() {
  const model = templateModel(MEASUREMENT_TEMPLATE_ID);
  return createStudioStore(model, { idGenerator: createIdGenerator(model) });
}

const ok = (r) => {
  assert.ok(r.ok, r.reason);
  return r;
};

test('A1: the template derives a recipe when MEASURE applies no profile', () => {
  const m = measurement().getModel();
  assert.equal(recipeFromStudio(m, { sampleRate: SR }).ok, true);
  assert.equal(recipeFromStudio(m, { sampleRate: SR, profileId: null }).ok, true);
});

test('A1: a filter between the Sweep and the Master Output is refused', () => {
  const store = measurement();
  const f = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'filter', position: { x: 0, y: 0 },
    params: { frequency: 200 } })).created.nodes[0];
  ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId: 'edge-1' }));
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: 'sweep-1', port: 'audio' },
    to: { node: f, port: 'audio' } }));
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: f, port: 'audio' },
    to: { node: 'master-1', port: 'audio' } }));
  const r = recipeFromStudio(store.getModel(), { sampleRate: SR });
  assert.equal(r.ok, false);
  assert.match(r.reason, /feeds .* on its way out; .* Connect the Sweep directly/);
});

test('A1: a Sweep with no route to the Master Output is refused', () => {
  const store = measurement();
  ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId: 'edge-1' }));
  assert.match(recipeFromStudio(store.getModel(), { sampleRate: SR }).reason,
    /not connected to the Master Output/);
});

test('A1: the Calibration node must name the profile MEASURE applies, without holding edges',
  () => {
    const store = measurement();
    ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'cal-1', key: 'profileId',
      value: PROFILE }));
    const m = store.getModel();
    assert.match(recipeFromStudio(m, { sampleRate: SR }).reason,
      new RegExp(`names profile ${PROFILE}, but MEASURE applies none`));
    assert.match(recipeFromStudio(m, { sampleRate: SR, profileId: 'b'.repeat(64) }).reason,
      /but MEASURE applies profile b{64}/);
    assert.equal(recipeFromStudio(m, { sampleRate: SR, profileId: PROFILE }).ok, true);
    ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'cal-1', key: 'extrapolate',
      value: 'hold' }));
    assert.match(recipeFromStudio(store.getModel(), { sampleRate: SR, profileId: PROFILE })
      .reason, /never extrapolates/);
    // MEASURE applies a profile the graph does not show.
    assert.match(recipeFromStudio(measurement().getModel(), { sampleRate: SR,
      profileId: PROFILE }).reason, /Calibration .* names no profile, but MEASURE applies profile/);
  });

test('A1: MEASURE applying a profile with no Calibration node in the graph is refused', () => {
  const store = measurement();
  ok(store.dispatch({ type: 'NODE_REMOVE', nodeId: 'cal-1' }));
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: 'mic-1', port: 'capture' },
    to: { node: 'transfer-1', port: 'observed' } }));
  const m = store.getModel();
  assert.equal(recipeFromStudio(m, { sampleRate: SR }).ok, true);
  assert.match(recipeFromStudio(m, { sampleRate: SR, profileId: PROFILE }).reason,
    /shows no Calibration node with it/);
});

test('A1: a points-per-octave the measurement does not compute is refused', () => {
  const store = measurement();
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'transfer-1', key: 'pointsPerOctave',
    value: 6 }));
  assert.match(recipeFromStudio(store.getModel(), { sampleRate: SR }).reason,
    /asks for 6 points per octave; the measurement computes 48/);
});
