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
function harness(m = synth(), { gate = null, hold = false } = {}) {
  globalThis.requestAnimationFrame = () => 0;
  const raw = createStudioStore(m, { idGenerator: createIdGenerator(m), gate });
  // hold: a store with workspace.js's hold(fn), counting the commands that run in one.
  const holds = [];
  const store = hold ? { ...raw, hold: (fn) => { holds.push(raw.getRevision()); return fn(); } }
    : raw;
  const said = [];
  const viewport = { addEventListener() {}, contains: () => false, focus() {} };
  const cmd = createGraphCommands({ viewport, store, registry: NODE_REGISTRY,
    svc: { announce: (text, opts) => said.push({ text, assertive: !!(opts && opts.assertive) }) },
    view: () => ({ panX: 0, panY: 0, zoom: 1 }), setView() {}, centerPoint: () => ({ x: 0, y: 0 }),
    clientToGraph: () => ({ x: 0, y: 0 }), isOverViewport: () => true, focusNode: () => true,
    isShown: () => false, nodeHeights: () => new Map() });
  const select = (sel) => store.dispatch({ type: 'SELECTION_CHANGE', selection: sel });
  return { store, cmd, said, select, holds, depth: () => store.debugInfo().undoDepth };
}

test('K009 bridgePlan joins a node\'s input to its outputs where the validator allows it', () => {
  const m = synth();
  assert.deepEqual(bridgePlan(m, 'env-1'), { edges: [{ from: at('osc-1', 'audio'),
    to: at('filter-1', 'audio') }], reason: null, dropped: [] });
  // Filter: the Envelope feeds both outputs; the LFO's control cable cannot reach an audio input.
  assert.deepEqual(bridgePlan(m, 'filter-1').edges, [
    { from: at('env-1', 'audio'), to: at('master-1', 'audio') },
    { from: at('env-1', 'audio'), to: at('spectrum-1', 'audio') }]);
  const lfo = bridgePlan(m, 'lfo-1');
  assert.deepEqual(lfo.edges, []);
  assert.equal(lfo.reason, 'LFO 1 has no signal input connection to bridge.');
  const master = bridgePlan(m, 'master-1');
  assert.deepEqual(master.edges, []);
  assert.equal(master.reason, 'Master has no output connection to bridge.');
});

test('K009 a bridge the types refuse is not made, and the plan says why', () => {
  const s = createStudioStore(synth(), { idGenerator: createIdGenerator(synth()) });
  // Envelope 1 fed by Oscillator 1 (audio) feeds only Filter 1's Q (its control output): an
  // audio cable cannot reach a parameter input.
  s.dispatch({ type: 'EDGE_REMOVE', edgeIds: ['edge-2'] });
  assert.equal(s.dispatch({ type: 'EDGE_ADD', from: at('env-1', 'control'),
    to: at('filter-1', 'Q') }).ok, true);
  const p = bridgePlan(s.getModel(), 'env-1');
  assert.deepEqual(p.edges, []);
  assert.match(p.reason, /^Connection rejected: Audio output cannot connect to /);
  // A node whose only input is a parameter (LFO 1 -> Oscillator 1 frequency) has no signal to
  // bridge.
  s.dispatch({ type: 'EDGE_ADD', from: at('lfo-1', 'control'), to: at('osc-1', 'frequency') });
  assert.equal(bridgePlan(s.getModel(), 'osc-1').reason,
    'Oscillator 1 has no signal input connection to bridge.');
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
  assert.equal(h.said.at(-1).text, 'Deleted LFO 1. No bridge: LFO 1 has no signal input '
    + 'connection to bridge.');
  // Two nodes: no bridge is guessed.
  const h2 = harness();
  h2.select({ nodes: ['env-1', 'lfo-1'] });
  h2.cmd.deleteBridge();
  assert.equal(h2.store.getModel().graph.nodes.length, synth().graph.nodes.length - 2);
  assert.match(h2.said.at(-1).text, /No bridge: select one node to bridge it\.$/);
});

test('K009 tidyPositions puts compactLayout columns and rows on the grid, deterministic', () => {
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

test('K009 a bridge never takes a modulator of the deleted node\'s own parameter', () => {
  const s = createStudioStore(synth(), { idGenerator: createIdGenerator(synth()) });
  const lfo2 = s.dispatch({ type: 'NODE_ADD', nodeType: 'lfo', position: { x: 0, y: 600 } })
    .created.nodes[0];
  // LFO 2 -> LFO 1 rate, LFO 1 -> Filter cutoff (edge-4).
  assert.equal(s.dispatch({ type: 'EDGE_ADD', from: at(lfo2, 'control'),
    to: at('lfo-1', 'rate') }).ok, true);
  const p = bridgePlan(s.getModel(), 'lfo-1');
  assert.deepEqual(p.edges, [], 'LFO 2 does not become the cutoff modulator');
  assert.equal(p.reason, 'LFO 1 has no signal input connection to bridge.');
});

test('K009 a bridge is muted when a cable it replaces was, and says so', () => {
  for (const edgeId of ['edge-1', 'edge-2']) {
    const h = harness();
    h.store.dispatch({ type: 'EDGE_UPDATE', edgeId, props: { muted: true } });
    const plan = bridgePlan(h.store.getModel(), 'env-1');
    assert.deepEqual(plan.edges, [{ from: at('osc-1', 'audio'), to: at('filter-1', 'audio'),
      props: { muted: true } }], edgeId);
    h.select({ nodes: ['env-1'] });
    h.cmd.deleteBridge();
    const bridge = h.store.getModel().graph.edges.find((e) => e.from.node === 'osc-1'
      && e.to.node === 'filter-1');
    assert.equal(bridge.props.muted, true, `${edgeId} muted: the bridge stays silent`);
    assert.equal(h.said.at(-1).text, 'Deleted Envelope 1 and bridged Oscillator 1 to Filter 1, '
      + 'muted as before');
  }
});

test('K009 a bridge names the sources it does not reconnect', () => {
  const h = harness();
  const add = (nodeType, y) => h.store.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y } }).created.nodes[0];
  const mixer = add('mixer', 600);
  const osc2 = add('oscillator', 800);
  const filter2 = add('filter', 1000);
  for (const [from, to] of [[at('osc-1', 'audio'), at(mixer, 'in1')],
    [at(osc2, 'audio'), at(mixer, 'in2')], [at(mixer, 'audio'), at(filter2, 'audio')]]) {
    assert.equal(h.store.dispatch({ type: 'EDGE_ADD', from, to }).ok, true);
  }
  const plan = bridgePlan(h.store.getModel(), mixer);
  assert.equal(plan.edges.length, 1);
  assert.deepEqual(plan.dropped, ['Oscillator 2']);
  h.select({ nodes: [mixer] });
  h.cmd.deleteBridge();
  assert.match(h.said.at(-1).text,
    /and bridged Oscillator 1 to Filter 2\. Not reconnected: Oscillator 2$/);
});

test('K009 when every bridge is refused the delete is plain, its undo entry named for it', () => {
  const h = harness(synth(), { gate: (next, info) => (info.action
    && info.action.type === 'EDGE_ADD'
    ? { ok: false, reason: 'The running graph refused it.', phase: 'prepare' } : null) });
  h.select({ nodes: ['env-1'] });
  const d0 = h.depth();
  h.cmd.deleteBridge();
  assert.ok(!h.store.getModel().graph.nodes.some((n) => n.id === 'env-1'));
  assert.equal(h.depth(), d0 + 1);
  assert.equal(h.store.undoLabel(), 'Delete Envelope 1');
  assert.match(h.said.at(-1).text, /^Deleted Envelope 1\. No bridge: .*running graph refused it/);
});

test('K009 L and M each run in one store hold: the projections update once', () => {
  const h = harness(synth(), { hold: true });
  h.cmd.tidy();
  assert.equal(h.holds.length, 1);
  h.select({ edges: ['edge-1', 'edge-2', 'edge-4'] });
  h.cmd.toggleMute();
  assert.equal(h.holds.length, 2);
  assert.equal(h.said.at(-1).text, 'Muted 3 connections');
});

test('K009 L with unmeasured cards (a hidden graph) uses the default row height', () => {
  const m = synth();
  const zero = new Map(m.graph.nodes.map((n) => [n.id, 0]));
  assert.deepEqual(tidyPositions(m, { heights: zero }), tidyPositions(m));
});
