// K061: BATCH, several model edits as one (src/js/studio/actions.js): reduced in order and
// validated once, one commit-gate call, one revision, one history entry; a refused step refuses
// the whole batch with that step's sentence; no nested batch and no view action inside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';

function store() {
  const gates = [];
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID), {
    idGenerator: createIdGenerator(), gate: (next, info) => { gates.push(info); return null; },
  });
  return { st, gates };
}

test('a BATCH is one revision, one history entry and one gate call', () => {
  const { st, gates } = store();
  const r0 = st.getRevision();
  const r = st.dispatch({ type: 'BATCH', label: 'Two nodes', steps: [
    { type: 'NODE_ADD', nodeType: 'noise', id: 'n-a', position: { x: 0, y: 0 } },
    { type: 'NODE_ADD', nodeType: 'lfo', id: 'l-a', position: { x: 10, y: 0 } },
  ] });
  assert.equal(r.ok, true, r.reason);
  assert.equal(st.getRevision(), r0 + 1);
  assert.equal(gates.length, 1);
  assert.equal(st.undoLabel(), 'Two nodes');
  assert.deepEqual(r.created.nodes, ['n-a', 'l-a']);
  st.undo();
  assert.equal(st.getModel().graph.nodes.some((n) => n.id === 'n-a' || n.id === 'l-a'), false,
    'one undo restores both');
});

test('a refused step refuses the batch with its sentence and leaves the model', () => {
  const { st, gates } = store();
  const before = st.getModel();
  const r = st.dispatch({ type: 'BATCH', steps: [
    { type: 'NODE_ADD', nodeType: 'noise', id: 'n-b' },
    { type: 'NODE_ADD', nodeType: 'no-such-type' },
  ] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Unknown node type "no-such-type"/);
  assert.equal(st.getModel(), before);
  assert.equal(gates.length, 0);
});

test('nested batches and view actions are refused', () => {
  const { st } = store();
  assert.match(st.dispatch({ type: 'BATCH', steps: [{ type: 'BATCH', steps: [] }] }).reason,
    /cannot hold another batch/);
  assert.match(st.dispatch({ type: 'BATCH', steps: [{ type: 'VIEW_SET', view: {} }] }).reason,
    /model edits only/);
  assert.match(st.dispatch({ type: 'BATCH', steps: [] }).reason, /at least one edit/);
});

test('an explicit id must be unused in the model the step edits', () => {
  const { st } = store();
  const e = st.getModel().graph.edges[0];
  const r = st.dispatch({ type: 'BATCH', steps: [
    { type: 'EDGE_REMOVE', edgeIds: [e.id] },
    { type: 'EDGE_ADD', id: e.id, from: e.from, to: e.to, props: e.props },
  ] });
  assert.equal(r.ok, true, 'removed and added back with the same id');
  assert.equal(st.dispatch({ type: 'NODE_ADD', nodeType: 'noise', id: e.id }).ok, false);
});
