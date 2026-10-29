// Studio graph commands of plan K009 (spec §50; rule typed-ports): Shift+Delete deletes the
// selected node and bridges its input to its outputs where the validator allows it, L tidies the
// graph into signal order as one NODE_MOVE gesture (deterministic, from compactLayout), M mutes
// or unmutes the selected connections. The keys are tests/unit/studio-graph-keys.test.mjs.
//   src/js/ui/studio/graph-commands.js bridgePlan, tidyPositions, muteTargets, createGraphCommands
//   node --test tests/unit/studio-graph-commands.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIDY_COLUMN_GAP, TIDY_DEFAULT_HEIGHT, TIDY_ROW_GAP, bridgePlan, createGraphCommands,
  muteTargets, tidyPositions,
} from '../../src/js/ui/studio/graph-commands.js';
import { compactLayout } from '../../src/js/ui/studio/graph-layout.js';
import { NODE_WIDTH } from '../../src/js/ui/studio/graph-geometry.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';

// The Subtractive Synth: osc-1 -edge-1-> env-1 -edge-2-> filter-1 -edge-3-> master-1,
// lfo-1 -edge-4-> filter-1.frequency, filter-1 -edge-5-> spectrum-1.
const synth = () => templateModel(REFERENCE_TEMPLATE_ID);
const at = (node, port) => ({ node, port });

/** createGraphCommands on a real store, with the DOM it touches stubbed. */
function harness(m = synth()) {
  globalThis.requestAnimationFrame = () => 0;
  const store = createStudioStore(m, { idGenerator: createIdGenerator(m) });
  const said = [];
  const viewport = { addEventListener() {}, contains: () => false, focus() {} };
  const cmd = createGraphCommands({ viewport, store, registry: NODE_REGISTRY,
    svc: { announce: (text, opts) => said.push({ text, assertive: !!(opts && opts.assertive) }) },
    view: () => ({ panX: 0, panY: 0, zoom: 1 }), setView() {}, centerPoint: () => ({ x: 0, y: 0 }),
    clientToGraph: () => ({ x: 0, y: 0 }), isOverViewport: () => true, focusNode: () => true,
    isShown: () => false, nodeHeights: () => new Map() });
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });
  return { store, cmd, said, select, depth: () => store.debugInfo().undoDepth };
}

test('K009 bridgePlan joins a node\'s input to its outputs where the validator allows it', () => {
  const m = synth();
  assert.deepEqual(bridgePlan(m, 'env-1'), { edges: [{ from: at('osc-1', 'audio'),
    to: at('filter-1', 'audio') }], reason: null });
  // Filter: the Envelope feeds both outputs; the LFO's control cable cannot reach an audio input.
  assert.deepEqual(bridgePlan(m, 'filter-1').edges, [
    { from: at('env-1', 'audio'), to: at('master-1', 'audio') },
    { from: at('env-1', 'audio'), to: at('spectrum-1', 'audio') }]);
  const lfo = bridgePlan(m, 'lfo-1');
  assert.deepEqual(lfo.edges, []);
  assert.equal(lfo.reason, 'LFO 1 has no input connection to bridge.');
  const master = bridgePlan(m, 'master-1');
  assert.deepEqual(master.edges, []);
  assert.equal(master.reason, 'Master has no output connection to bridge.');
});

test('K009 a bridge the types refuse is not made, and the plan says why', () => {
  const s = createStudioStore(synth(), { idGenerator: createIdGenerator(synth()) });
  // LFO 1 -> Oscillator 1 frequency: the oscillator's only input is a control cable.
  s.dispatch({ type: 'EDGE_ADD', from: at('lfo-1', 'control'), to: at('osc-1', 'frequency') });
  const p = bridgePlan(s.getModel(), 'osc-1');
  assert.deepEqual(p.edges, []);
  assert.match(p.reason, /^Connection rejected: Control output cannot connect to an audio input/);
});

test('K009 Shift+Delete is one history entry; undo restores the node and its cables', () => {
  const h = harness();
  const before = h.store.getModel();
  h.select({ nodes: ['env-1'] });
  const d0 = h.depth();
  assert.equal(h.cmd.deleteBridge(), true);
  const m = h.store.getModel();
  assert.ok(!m.graph.nodes.some((n) => n.id === 'env-1'));
  assert.ok(m.graph.edges.some((e) => e.from.node === 'osc-1' && e.to.node === 'filter-1'
    && e.to.port === 'audio'));
  assert.equal(h.depth(), d0 + 1);
  assert.equal(h.said.at(-1).text, 'Deleted Envelope 1 and bridged Oscillator 1 to Filter 1');
  h.store.undo();
  assert.deepEqual(h.store.getModel().graph, before.graph);
});

test('K009 Shift+Delete without a possible bridge deletes plainly and announces the reason', () => {
  const h = harness();
  h.select({ nodes: ['lfo-1'] });
  const d0 = h.depth();
  h.cmd.deleteBridge();
  assert.ok(!h.store.getModel().graph.nodes.some((n) => n.id === 'lfo-1'));
  assert.equal(h.depth(), d0 + 1);
  assert.equal(h.said.at(-1).text, 'Deleted LFO 1. No bridge: LFO 1 has no input connection to '
    + 'bridge.');
  // Two nodes: no bridge is guessed.
  const h2 = harness();
  h2.select({ nodes: ['env-1', 'lfo-1'] });
  h2.cmd.deleteBridge();
  assert.equal(h2.store.getModel().graph.nodes.length, synth().graph.nodes.length - 2);
  assert.match(h2.said.at(-1).text, /No bridge: select one node to bridge it\.$/);
});

test('K009 tidyPositions places compactLayout columns and rows on the grid, deterministically', () => {
  const m = synth();
  const layout = compactLayout(m);
  const pos = tidyPositions(m);
  const step = NODE_WIDTH + TIDY_COLUMN_GAP;
  const row1 = 160 + TIDY_DEFAULT_HEIGHT + TIDY_ROW_GAP;
  assert.deepEqual(Object.fromEntries(pos), {
    'osc-1': { x: 40, y: 160 }, 'env-1': { x: 40 + step, y: 160 },
    'filter-1': { x: 40 + 2 * step, y: 160 }, 'master-1': { x: 40 + 3 * step, y: 160 },
    'lfo-1': { x: 40, y: row1 }, 'spectrum-1': { x: 40 + 3 * step, y: row1 } });
  for (const n of layout.nodes) {
    assert.equal(pos.get(n.id).x, 40 + n.col * step, n.id);
  }
  for (const p of pos.values()) assert.ok(p.x % 8 === 0 && p.y % 8 === 0, 'on the grid');
  assert.deepEqual(tidyPositions(m), pos, 'deterministic');
  // A taller row pushes the next one down by its tallest node.
  const tall = tidyPositions(m, { heights: new Map([['filter-1', 200]]) });
  assert.equal(tall.get('lfo-1').y, 160 + 200 + TIDY_ROW_GAP);
});

test('K009 L is one NODE_MOVE gesture; a tidy graph does not change again', () => {
  const h = harness();
  const d0 = h.depth();
  assert.equal(h.cmd.tidy(), true);
  assert.equal(h.depth(), d0 + 1);
  assert.equal(h.store.debugInfo().lastAction.type, 'NODE_MOVE');
  assert.equal(h.store.debugInfo().lastAction.label, 'Tidy the graph');
  const after = h.store.getModel();
  for (const [id, p] of tidyPositions(after)) {
    const n = after.graph.nodes.find((x) => x.id === id);
    assert.deepEqual(n.position, p, id);
  }
  h.cmd.tidy();
  assert.equal(h.depth(), d0 + 1, 'nothing to move: no entry');
  assert.equal(h.said.at(-1).text, 'The graph is already tidy');
  h.store.undo();
  assert.deepEqual(h.store.getModel().graph.nodes.map((n) => n.position),
    synth().graph.nodes.map((n) => n.position));
});

test('K009 M mutes the selected connections, then unmutes them, one entry each', () => {
  const m = synth();
  assert.deepEqual(muteTargets(m, ['edge-1', 'edge-2']), { muted: true,
    edgeIds: ['edge-1', 'edge-2'] });
  assert.equal(muteTargets(m, []), null);
  assert.equal(muteTargets(m, ['nope']), null);
  const h = harness();
  h.select({ edges: ['edge-1', 'edge-4'] });
  const d0 = h.depth();
  h.cmd.toggleMute();
  const muted = (id) => h.store.getModel().graph.edges.find((e) => e.id === id).props.muted;
  assert.equal(muted('edge-1'), true);
  assert.equal(muted('edge-4'), true);
  assert.equal(muted('edge-2'), false);
  assert.equal(h.depth(), d0 + 1);
  assert.equal(h.said.at(-1).text, 'Muted 2 connections');
  h.cmd.toggleMute();
  assert.equal(muted('edge-1'), false);
  assert.equal(h.depth(), d0 + 2);
  assert.equal(h.said.at(-1).text, 'Unmuted 2 connections');
  // Mixed: everything selected is muted.
  h.store.dispatch({ type: 'EDGE_UPDATE', edgeId: 'edge-1', props: { muted: true } });
  assert.deepEqual(muteTargets(h.store.getModel(), ['edge-1', 'edge-4']).muted, true);
  // Nothing selected: nothing changes.
  h.select({ nodes: ['osc-1'] });
  const d1 = h.depth();
  h.cmd.toggleMute();
  assert.equal(h.depth(), d1);
  assert.equal(h.said.at(-1).text, 'Select connections to mute.');
});
