// Studio graph editing commands (src/js/ui/studio/graph-commands.js createGraphCommands; spec
// §50, §63-§64, §118-§125, §140-§142; V272 C5, V431 U1, U7): add a node at a point or under the
// pointer (and connect it from a port in the same history entry), copy, cut, paste with a growing
// offset, duplicate, select all, the arrow-key nudge as one gesture per key sequence (a pan with
// nothing selected), a delete of nodes and cables together, keyboard focus selecting a node while
// a pointer press's focus does not, Enter activating a node, and T toggling the focused node. On
// a real store; the DOM it touches is stubbed. Shift+Delete, L and M are
// tests/unit/studio-graph-commands.test.mjs.
//   node --test tests/unit/studio-graph-commands-edit.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGraphCommands } from '../../src/js/ui/studio/graph-commands.js';
import { nudgeDelta } from '../../src/js/ui/studio/graph-geometry.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';

/** A node card's element as focus events and document.activeElement see it. */
const card = (id) => ({ dataset: { nodeId: id }, closest: (sel) => (sel === '.osc-sg-node'
  ? card(id) : null) });
const canvas = { closest: () => null };

function harness({ shown = true } = {}) {
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m) });
  const said = [];
  const listeners = {};
  const views = [];
  const focused = [];
  const activated = [];
  let viewportFocus = 0;
  const viewport = { addEventListener: (type, fn) => { listeners[type] = fn; },
    contains: () => true, focus: () => { viewportFocus += 1; } };
  const cmd = createGraphCommands({ viewport, store, registry: NODE_REGISTRY,
    svc: { announce: (text, opts) => said.push({ text, assertive: !!(opts && opts.assertive) }),
      onActivateNode: (id) => activated.push(id) },
    view: () => ({ panX: 0, panY: 0, zoom: 1 }), setView: (v) => views.push(v),
    centerPoint: () => ({ x: 100, y: 100 }), clientToGraph: (x, y) => ({ x, y }),
    isOverViewport: (x) => x > 0, focusNode: (id) => focused.push(id), isShown: () => shown,
    nodeGeometry: () => new Map(), viewSize: () => ({ w: 0, h: 0 }) });
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });
  const flush = () => { while (frames.length) frames.shift()(); };
  const last = () => said.at(-1).text;
  const nodes = () => store.getModel().graph.nodes;
  return { store, cmd, said, listeners, views, focused, activated, select, flush, last, nodes,
    depth: () => store.debugInfo().undoDepth, viewportFocus: () => viewportFocus };
}

test('addNodeAt adds a node, selects it, focuses it; an unknown type is refused', () => {
  const h = harness();
  const r = h.cmd.addNodeAt('gain');
  assert.equal(r.ok, true);
  const id = r.created.nodes[0];
  assert.deepEqual(h.store.getSelection().nodes, [id]);
  assert.equal(h.last(), 'Added Gain 1');
  h.flush();
  assert.deepEqual(h.focused, [id]);
  assert.deepEqual(h.cmd.addNodeAt('no-such-type'), { ok: false, reason: 'Unknown node type.' });
});

test('addNodeAt with connectFrom adds and connects in one history entry', () => {
  const h = harness();
  const edges = h.store.getModel().graph.edges.length;
  const depth = h.depth();
  const r = h.cmd.addNodeAt('gain', { x: 300, y: 300 }, { connectFrom: { node: 'osc-1',
    port: 'audio' } });
  const id = r.created.nodes[0];
  const g = h.store.getModel().graph;
  assert.equal(g.edges.length, edges + 1);
  assert.ok(g.edges.some((e) => e.from.node === 'osc-1' && e.to.node === id));
  assert.equal(h.depth(), depth + 1, 'one gesture');
  assert.equal(h.last(), 'Added Gain 1 and connected Oscillator 1 to Gain 1');
  // The node's top sits above the point and the card is centred on it (snapped).
  const n = g.nodes.find((x) => x.id === id);
  assert.ok(n.position.x < 300 && n.position.y < 300);
});

test('addNodeAtClient adds only over the viewport', () => {
  const h = harness();
  const before = h.nodes().length;
  assert.equal(h.cmd.addNodeAtClient('gain', -5, 10), false);
  assert.equal(h.nodes().length, before);
  assert.equal(h.cmd.addNodeAtClient('gain', 50, 60), true);
  assert.equal(h.nodes().length, before + 1);
});

test('copy and paste: each paste is a new copy, offset further; an empty clipboard says so', () => {
  const h = harness();
  assert.equal(h.cmd.paste(), false);
  assert.equal(h.last(), 'The Studio clipboard is empty.');
  assert.equal(h.cmd.copySelection(), false);
  assert.equal(h.last(), 'Select nodes to copy.');
  h.select({ nodes: ['osc-1'] });
  assert.equal(h.cmd.copySelection(), true);
  assert.equal(h.last(), 'Copied Oscillator 1');
  assert.equal(h.cmd.paste(), true);
  assert.equal(h.last(), 'Pasted Oscillator 2');
  assert.equal(h.cmd.paste(), true);
  assert.equal(h.last(), 'Pasted Oscillator 3');
  const pos = (name) => h.nodes().find((n) => n.metadata.name === name).position;
  const o1 = pos('Oscillator 1');
  const o2 = pos('Oscillator 2');
  const o3 = pos('Oscillator 3');
  // Each paste lands one 24-unit step further from the original.
  assert.deepEqual(o2, { x: o1.x + 24, y: o1.y + 24 });
  assert.deepEqual(o3, { x: o1.x + 48, y: o1.y + 48 });
  h.select({ nodes: ['osc-1', 'env-1'] });
  h.cmd.copySelection();
  assert.equal(h.last(), 'Copied 2 nodes');
});

test('cut deletes the copied nodes; the first paste after it lands at the first offset', () => {
  const h = harness();
  assert.equal(h.cmd.cutSelection(), false, 'nothing selected, nothing cut');
  h.select({ nodes: ['lfo-1'] });
  assert.equal(h.cmd.cutSelection(), true);
  assert.equal(h.nodes().some((n) => n.id === 'lfo-1'), false);
  assert.equal(h.last(), 'Deleted LFO 1');
  assert.equal(h.cmd.paste(), true);
  assert.equal(h.last(), 'Pasted LFO 1');
  const lfo = h.nodes().find((n) => n.metadata.name === 'LFO 1');
  assert.deepEqual(lfo.position, { x: 430 + 24, y: 340 + 24 });
});

test('duplicate and select all', () => {
  const h = harness();
  assert.equal(h.cmd.duplicateSelection(), false);
  assert.equal(h.last(), 'Select nodes to duplicate.');
  h.select({ nodes: ['osc-1', 'env-1'] });
  const before = h.nodes().length;
  assert.equal(h.cmd.duplicateSelection(), true);
  assert.equal(h.nodes().length, before + 2);
  h.cmd.selectAll();
  assert.equal(h.store.getSelection().nodes.length, before + 2);
  assert.equal(h.last(), `${before + 2} nodes selected`);
});

test('a nudge key sequence moves the selection as one history entry; nothing selected pans', () => {
  const h = harness();
  h.select({ nodes: ['lfo-1'] });
  const depth = h.depth();
  const small = nudgeDelta('ArrowRight', false);
  const large = nudgeDelta('ArrowRight', true);
  assert.equal(h.cmd.nudge('ArrowRight', false), true);
  assert.equal(h.cmd.nudge('ArrowRight', true), true);
  h.cmd.endNudge();
  assert.deepEqual(h.nodes().find((n) => n.id === 'lfo-1').position,
    { x: 430 + small.x + large.x, y: 340 });
  assert.equal(h.depth(), depth + 1);
  assert.equal(h.last(), 'Moved LFO 1');
  h.cmd.endNudge(); // a second end without a nudge says nothing more
  assert.equal(h.last(), 'Moved LFO 1');
  assert.equal(h.cmd.nudge('KeyX', false), false, 'not an arrow');

  h.select({ nodes: [] });
  assert.equal(h.cmd.nudge('ArrowLeft', false), true);
  const left = nudgeDelta('ArrowLeft', false);
  assert.equal(h.views.length, 1);
  assert.equal(h.views[0].panX, -left.x * 4, 'the view pans against the arrow');
  assert.equal(h.views[0].panY, 0);
});

test('delete of nodes and cables together is one entry named for both; focus goes to the nearest',
  () => {
    const h = harness();
    h.select({ nodes: ['spectrum-1'], edges: ['edge-4'] });
    const depth = h.depth();
    assert.equal(h.cmd.deleteSelection(), true);
    assert.equal(h.last(), 'Deleted 2 items');
    assert.equal(h.depth(), depth + 1);
    const g = h.store.getModel().graph;
    assert.equal(g.nodes.some((n) => n.id === 'spectrum-1'), false);
    assert.equal(g.edges.some((e) => e.id === 'edge-4'), false);
    h.flush();
    // spectrum-1 sat at (640, 340): Master (640, 160) is nearer than LFO 1 (430, 340).
    assert.deepEqual(h.focused, ['master-1']);

    // A cable whose node goes too is not deleted twice; cables alone are disconnected.
    h.select({ nodes: [], edges: ['edge-2'] });
    assert.equal(h.cmd.deleteSelection(), true);
    assert.equal(h.last(), 'Disconnected Envelope 1 from Filter 1');
    h.flush();
    assert.equal(h.viewportFocus(), 1, 'no node deleted: the canvas takes focus');
  });

test('while the graph is hidden a delete leaves focus where it is', () => {
  const h = harness({ shown: false });
  h.select({ nodes: ['spectrum-1'] });
  h.cmd.deleteSelection();
  h.flush();
  assert.deepEqual(h.focused, []);
  assert.equal(h.viewportFocus(), 0);
});

test('keyboard focus on a node selects it; focus a pointer press moves does not', async () => {
  const h = harness();
  h.listeners.focusin({ target: card('env-1') });
  assert.deepEqual(h.store.getSelection().nodes, ['env-1']);
  h.cmd.onPress();
  h.listeners.focusin({ target: card('osc-1') });
  assert.deepEqual(h.store.getSelection().nodes, ['env-1'], 'the press selects on release');
  // The press flag lasts one turn: a later keyboard focus selects again.
  h.cmd.onPress();
  await new Promise((r) => setTimeout(r, 0));
  h.listeners.focusin({ target: card('osc-1') });
  assert.deepEqual(h.store.getSelection().nodes, ['osc-1']);
  h.listeners.focusin({ target: canvas });
  assert.deepEqual(h.store.getSelection().nodes, ['osc-1'], 'the canvas selects nothing');
  h.cmd.destroy();
});

test('Enter on a node activates it; with a modifier or off a node it does nothing', () => {
  const h = harness();
  let prevented = 0;
  const key = (target, extra = {}) => h.listeners.keydown({ key: 'Enter', target,
    preventDefault: () => { prevented += 1; }, ...extra });
  key(card('filter-1'));
  key(card('filter-1'), { ctrlKey: true });
  key(card('filter-1'), { metaKey: true });
  key(canvas);
  h.listeners.keydown({ key: 'a', target: card('filter-1'), preventDefault() {} });
  assert.deepEqual(h.activated, ['filter-1']);
  assert.equal(prevented, 1);
});

test('T adds the focused node to the selection or takes it out; without focus it says how', () => {
  const h = harness();
  globalThis.document = { activeElement: canvas };
  assert.equal(h.cmd.toggleFocusedNode(), false);
  assert.equal(h.last(), 'Focus a node to add it to the selection.');

  h.select({ nodes: ['osc-1'] });
  globalThis.document = { activeElement: card('env-1') };
  assert.equal(h.cmd.toggleFocusedNode(), true);
  assert.deepEqual([...h.store.getSelection().nodes].sort(), ['env-1', 'osc-1']);
  assert.equal(h.last(), 'Envelope 1 added to the selection: 2 nodes selected');
  assert.equal(h.cmd.toggleFocusedNode(), true);
  assert.deepEqual(h.store.getSelection().nodes, ['osc-1']);
  assert.equal(h.last(), 'Envelope 1 taken out of the selection: 1 node selected');

  // Focus that replaced a selection: T brings the replaced selection back with the node.
  h.select({ nodes: ['osc-1', 'lfo-1'] });
  h.listeners.focusin({ target: card('master-1') });
  assert.deepEqual(h.store.getSelection().nodes, ['master-1']);
  globalThis.document = { activeElement: card('master-1') };
  h.cmd.toggleFocusedNode();
  assert.deepEqual([...h.store.getSelection().nodes].sort(), ['lfo-1', 'master-1', 'osc-1']);
  delete globalThis.document;
});
