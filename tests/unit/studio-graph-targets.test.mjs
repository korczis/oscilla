// Studio graph drag targets (plan K008; spec §65; rule typed-ports): while a cable is dragged,
// an occupied single input is a target that replaces the cable there, and a drop on a node's
// body takes a free input before it replaces one. Tap-connect and the Connect dialog judge
// without replacement (an occupied single input stays refused there).
//   src/js/ui/studio/graph-view.js connectionTargets(..., { rewire, detach })
//   node --test tests/unit/studio-graph-targets.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { connectionTargets } from '../../src/js/ui/studio/graph-view.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';

// The Subtractive Synth: osc-1 -edge-1-> env-1 -edge-2-> filter-1 -edge-3-> master-1.
const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const at = (node, port) => ({ node, port });
const target = (list, node, port) => list.find((t) => t.node === node && t.port === port);

test('K008 a dragged cable may replace the cable of an occupied single input', () => {
  const m = synth();
  const drag = connectionTargets(m, at('osc-1', 'audio'), undefined, { rewire: true });
  const t = target(drag, 'filter-1', 'audio');
  assert.equal(t.allowed, true, 'the drop replaces Envelope 1\'s cable');
  assert.deepEqual(t.replaces, ['edge-2']);
  // Tap-connect: the same input is refused, nothing is replaced.
  const tap = target(connectionTargets(m, at('osc-1', 'audio')), 'filter-1', 'audio');
  assert.equal(tap.allowed, false);
  assert.deepEqual(tap.replaces, []);
});

test('K008 the cable picked up at an input is judged as removed', () => {
  const m = synth();
  const back = target(connectionTargets(m, at('env-1', 'audio'), undefined,
    { rewire: true, detach: 'edge-2' }), 'filter-1', 'audio');
  assert.equal(back.allowed, true);
  assert.equal(back.same, true, 'dropped back on its own input: nothing to do');
});

test('K008 on a Mixer only the occupied inputs are replacements', () => {
  const m0 = synth();
  const s = createStudioStore(m0, { idGenerator: createIdGenerator(m0) });
  const mixer = s.dispatch({ type: 'NODE_ADD', nodeType: 'mixer', position: { x: 0, y: 600 } })
    .created.nodes[0];
  s.dispatch({ type: 'EDGE_ADD', from: at('osc-1', 'audio'), to: at(mixer, 'in1') });
  const drag = connectionTargets(s.getModel(), at('filter-1', 'audio'), undefined,
    { rewire: true });
  assert.equal(target(drag, mixer, 'in1').replaces.length, 1);
  for (const p of ['in2', 'in3', 'in4']) {
    assert.equal(target(drag, mixer, p).allowed, true, p);
    assert.deepEqual(target(drag, mixer, p).replaces, [], p);
  }
});
