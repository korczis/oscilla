// K062, K063 (data-driven): the Synth panel is ONE declaration (src/js/synth/panels/
// semi-mono.js). Every face control is a registry parameter or an amount, every jack a registry
// port, every normal a legal connection; adding one module entry adds its face and jacks and
// nothing else; the instantiated panel validates and plays keys -> output.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { definePanel } from '../../src/js/synth/panel.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { panelStore } from './synth-fixture.mjs';

test('every module names a registry type; the face is its params less fixed, plus amounts', () => {
  assert.equal(PANEL.title, 'Semi-modular mono voice');
  for (const m of PANEL.modules) {
    const def = NODE_REGISTRY.get(m.node);
    assert.ok(def, m.id);
    const face = PANEL.faceOf(m.id);
    const fixed = Object.keys(m.fixed || {});
    const amounts = PANEL.amounts.filter((a) => a.module === m.id);
    assert.equal(face.length, def.params.length - fixed.length + amounts.length, m.id);
    for (const c of face.filter((x) => x.kind !== 'amount')) {
      assert.ok(def.params.some((p) => p.key === c.key), `${m.id}.${c.key}`);
    }
    const ports = [...def.inputs, ...def.outputs].map((p) => p.id);
    for (const j of PANEL.jacksOf(m.id)) assert.ok(ports.includes(j.port), j.id);
  }
});

test('adding one module entry adds its face and jacks and changes nothing else', () => {
  const decl = (extra) => ({ id: 'probe', title: 'Probe', modules: [
    { id: 'osc', label: 'OSC', node: 'vco' }, ...extra], normals: [] });
  const a = definePanel(decl([]));
  const b = definePanel(decl([{ id: 'n', label: 'N', node: 'noise' }]));
  assert.deepEqual(b.faceOf('osc'), a.faceOf('osc'));
  assert.deepEqual(b.jacksOf('osc'), a.jacksOf('osc'));
  assert.equal(b.faceOf('n').length, NODE_REGISTRY.get('noise').params.length);
  assert.equal(b.jacksOf('n').length, 2);
  assert.throws(() => definePanel(decl([{ id: 'x', label: 'X', node: 'nope' }])), /unknown node/);
  assert.throws(() => definePanel({ ...decl([]), normals: [['n1', 'osc.audio', 'osc.pitch']] }),
    /normal n1/, 'an audio output into a control input is refused');
});

test('the panel narrows the registry and never widens it', () => {
  const lpf = PANEL.module('lpf');
  const q = lpf.params.find((p) => p.key === 'Q');
  assert.deepEqual([q.min, q.max, q.label], [0.5, 30, 'Peak']);
  const mg = PANEL.module('mg').params.find((p) => p.key === 'shape');
  assert.deepEqual(mg.options.map((o) => o[0]), ['triangle', 'square']);
  assert.throws(() => definePanel({ id: 'w', title: 'W', normals: [], modules: [
    { id: 'f', label: 'F', node: 'filter', ranges: { Q: [0, 2000] } }] }), /range/);
});

test('the instantiated panel validates, is one entry, and its live model compiles', () => {
  const st = panelStore();
  assert.equal(st.undoLabel(), 'Insert Semi-modular mono voice');
  const m = st.getModel();
  const res = PANEL.resolve(m);
  for (const mod of PANEL.modules) assert.ok(res.get(mod.id), mod.id);
  for (const n of PANEL.normals) {
    assert.ok(m.graph.edges.some((e) => e.id === n.edgeId || (n.to === 'out.audio'
      && e.to.node === res.get('out').id)), n.id);
  }
  const live = liveModel(m);
  assert.equal(live.graph.nodes.length, PANEL.modules.length);
  const plan = compileStudio(live);
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  // An AUDIO path keys -> ... -> out: vco1 -> mix -> hpf -> lpf -> vca -> master.
  const audio = live.graph.edges.filter((e) => e.from.port === 'audio');
  const reach = new Set([res.get('vco1').id]);
  for (let i = 0; i < 8; i++) for (const e of audio) if (reach.has(e.from.node)) reach.add(e.to.node);
  assert.ok(reach.has(res.get('out').id));
});
