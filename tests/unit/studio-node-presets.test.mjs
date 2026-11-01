// K020: node presets. Every node type offers factory presets (one-node patches of the
// patches.js shape) and the person's saved single-node patches of that type; applying one
// changes only the node's parameters, keeps every edge and is one undo entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTORY_NODE_PRESETS, nodePresetAction, nodePresets, singleNodeType,
} from '../../src/js/studio/node-presets.js';
import { NODE_DEFINITIONS, NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createPatch, importPatch } from '../../src/js/studio/patches.js';
import { createStudioLibrary } from '../../src/js/studio/library.js';
import { createMemoryStore } from '../../src/js/experiments/store.js';
import { serializeStudio } from '../../src/js/studio/schema.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { panelStore } from './synth-fixture.mjs';

const NOW = new Date('2026-11-01T10:00:00Z');

test('every node type has factory presets, each a valid one-node patch of its own type', () => {
  for (const d of NODE_DEFINITIONS) {
    const list = nodePresets(d.type);
    assert.ok(list.length >= 1, d.type);
    assert.equal(list[0].name, 'Default', d.type);
    for (const e of list) {
      const r = importPatch(e.patch);
      assert.equal(r.ok, true, `${d.type}/${e.id}: ${r.ok || r.errors[0].message}`);
      assert.equal(singleNodeType(e.patch), d.type, `${d.type}/${e.id}`);
      assert.equal(e.source, 'factory');
    }
  }
  for (const [type, list] of Object.entries(FACTORY_NODE_PRESETS)) {
    assert.ok(NODE_REGISTRY.get(type), type);
    for (const p of list) {
      for (const k of Object.keys(p.values)) {
        assert.ok(NODE_REGISTRY.param(type, k), `${type}/${p.id}: ${k} is a parameter`);
      }
      assert.doesNotMatch(p.name, /moog|korg|roland|yamaha|arp|oberheim|vintage|analog/i);
    }
  }
  // The Synth's engine presets are reused as the engines' node presets, not copied.
  assert.deepEqual(nodePresets('fm-voice').map((e) => e.name), ['Default', 'FM bell', 'FM keys']);
});

test('applying a preset sets the node\'s parameters only, keeps its edges, one undo entry', () => {
  for (const [mid, id] of [['lpf', 'dark'], ['eg2', 'pluck'], ['vco1', 'thin-pulse'],
    ['fm', 'engine-fm-bell'], ['mg', 'default']]) {
    const st = panelStore();
    const before = st.getModel();
    const node = PANEL.resolve(before).get(mid);
    const entry = nodePresets(node.type).find((e) => e.id === id);
    const r = nodePresetAction(before, node.id, entry);
    assert.equal(r.action.type, 'PATCH_REPLACE');
    const depth = st.debugInfo().undoDepth;
    const done = st.dispatch(r.action);
    assert.equal(done.ok, true, `${mid}/${id}: ${done.reason}`);
    const after = st.getModel();
    if (done.changed) {
      assert.equal(st.debugInfo().undoDepth, depth + 1, `${mid}/${id}`);
      assert.match(st.undoLabel(), /^Preset /);
    }
    assert.deepEqual(after.graph.edges, before.graph.edges, `${mid}/${id}: every edge kept`);
    for (const n of after.graph.nodes) {
      const old = before.graph.nodes.find((x) => x.id === n.id);
      assert.deepEqual(n.position, old.position);
      assert.deepEqual(n.metadata, old.metadata);
      if (n.id !== node.id) assert.deepEqual(n.params, old.params, `${mid}/${id}: ${n.id}`);
    }
    for (const [k, v] of Object.entries(entry.patch.graph.nodes[0].params)) {
      assert.deepEqual(after.graph.nodes.find((n) => n.id === node.id).params[k], v, k);
    }
    assert.equal(compileStudio(liveModel(after)).ok, true, `${mid}/${id}`);
    if (done.changed) {
      st.undo();
      assert.equal(serializeStudio(st.getModel()), serializeStudio(before), 'undo is exact');
    }
  }
});

test('negative: a preset of another node type is refused, model and history unchanged', () => {
  const st = panelStore();
  const m = st.getModel();
  const vco = PANEL.resolve(m).get('vco1');
  const filterPreset = nodePresets('filter')[1];
  assert.match(nodePresetAction(m, vco.id, filterPreset).reason, /another node type/);
  const depth = st.debugInfo().undoDepth;
  const r = st.dispatch({ type: 'PATCH_REPLACE', patch: filterPreset.patch,
    onto: { n: vco.id } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /is a VCO; the patch sets a Filter/);
  assert.equal(st.getModel(), m);
  assert.equal(st.debugInfo().undoDepth, depth);
});

test('the person\'s single-node patches join the dropdown of their type only', async () => {
  const st = panelStore();
  const m = st.getModel();
  const res = PANEL.resolve(m);
  const lib = createStudioLibrary(createMemoryStore());
  const one = createPatch(m, [res.get('lpf').id], { name: 'My dark filter' });
  const two = createPatch(m, [res.get('vco1').id, res.get('mix').id], { name: 'Two nodes' });
  await lib.savePatch(one, { id: 'patch-my-dark-filter', now: NOW });
  await lib.savePatch(two, { id: 'patch-two-nodes', now: NOW });
  const user = await lib.patches();
  assert.deepEqual(user.map((u) => u.name).sort(), ['My dark filter', 'Two nodes']);
  const filters = nodePresets('filter', { user });
  const mine = filters.filter((e) => e.source === 'user');
  assert.deepEqual(mine.map((e) => e.name), ['My dark filter']);
  assert.equal(nodePresets('vco', { user }).filter((e) => e.source === 'user').length, 0,
    'a patch of two nodes is no node preset');
  // Applied onto the HPF module: parameters only, one entry.
  const hpf = res.get('hpf');
  const done = st.dispatch(nodePresetAction(m, hpf.id, mine[0]).action);
  assert.equal(done.ok, true, done.reason);
  assert.deepEqual(st.getModel().graph.edges, m.graph.edges);
  assert.equal(st.getModel().graph.nodes.find((n) => n.id === hpf.id).params.type, 'lowpass');
});
