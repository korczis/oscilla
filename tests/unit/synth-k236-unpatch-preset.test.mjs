// K236 (review of #329, R4 and R5; audit of 2026-11-10): what the Synth bay does to a jack's
// normals and an amount knob's remembered depth.
//   R4: on a mixed jack (a Studio edge beside its normals) a panel cable patched and then
//       removed left no normals while the panel said "Kabel odpojen; normál je obnoven."; now
//       the normals come back beside the Studio edge, and the sentence says what unpatch did.
//   R5: a preset applied while an amount's edges are broken did not update
//       metadata.synthAmounts, so the unpatch restored the normal at the depth from before the
//       preset (bass: lpf-eg2 2, not 3); now the preset writes it, in the same undo.
// R6 (Escape leaving the connection list open) is a page check: tests/browser/synth.cjs.
//   node --test tests/unit/synth-k236-unpatch-preset.test.mjs
// Fails on c4a5d77a: unpatchText does not exist, the mixed jack ends 'patched' with its normals
// gone, and the bass preset leaves the remembered lpf-eg2 depth at 2.
import test from 'node:test';
import assert from 'node:assert/strict';

import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  amountDepth, breakNormals, jackState, panelCables, patchCable, unpatch, unpatchText,
} from '../../src/js/synth/normals.js';
import { presetAction } from '../../src/js/synth/presets.js';
import { panelStore } from './synth-fixture.mjs';

const ok = (st, action, what) => {
  assert.ok(action, `${what}: an action`);
  const r = st.dispatch(action);
  assert.equal(r.ok, true, `${what}: ${r.reason}`);
  return r;
};
const amount = (id) => PANEL.amounts.find((a) => a.id === id);
const cableInto = (st, jack) => panelCables(st.getModel(), PANEL).find((c) => c.to === jack);
/** The edges into a jack as "source@depth", sorted. */
const into = (m, jack) => {
  const ids = new Map([...PANEL.resolve(m)].filter(([, n]) => n).map(([k, n]) => [n.id, k]));
  return m.graph.edges.filter((e) => `${ids.get(e.to.node)}.${e.to.port}` === jack)
    .map((e) => `${ids.get(e.from.node) || 'studio'}.${e.from.port}@${e.props.depth}`).sort();
};

/** A Studio LFO patched into LPF Cutoff beside its normals: the jack is mixed. */
function mixedCutoff() {
  const st = panelStore();
  const lpf = PANEL.resolve(st.getModel()).get('lpf');
  const lfo = ok(st, { type: 'NODE_ADD', nodeType: 'lfo', position: { x: 0, y: 0 } }, 'lfo')
    .created.nodes[0];
  ok(st, { type: 'EDGE_ADD', from: { node: lfo, port: 'control' },
    to: { node: lpf.id, port: 'frequency' } }, 'the Studio edge');
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'mixed');
  return st;
}

test('K236 R4: a mixed jack patched and unpatched is mixed again, its normals back', () => {
  const st = mixedCutoff();
  const before = into(st.getModel(), 'lpf.frequency');
  ok(st, patchCable(st.getModel(), PANEL, 'eg1.control', 'lpf.frequency').action, 'patch');
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  const r = unpatch(st.getModel(), PANEL, cableInto(st, 'lpf.frequency').id);
  assert.deepEqual([r.restored > 0, r.cables, r.studio], [true, 0, 1], JSON.stringify(r));
  ok(st, r.action, 'unpatch');
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'mixed');
  assert.deepEqual(into(st.getModel(), 'lpf.frequency'), before, 'the normals at their depths');
  assert.equal(unpatchText(r), 'Kabel odpojen; normál je obnoven vedle propojení ze Studia.');
  // one undo takes the unpatch back
  st.undo();
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
});

test('K236 R4: the sentence says what unpatch did, never a normal it did not restore', () => {
  // a plain normalled jack: the normal comes back
  const st = panelStore();
  ok(st, patchCable(st.getModel(), PANEL, 'eg1.control', 'lpf.frequency').action, 'patch');
  const plain = unpatch(st.getModel(), PANEL, cableInto(st, 'lpf.frequency').id);
  assert.equal(unpatchText(plain), 'Kabel odpojen; normál je obnoven.');
  // another panel cable still feeds the jack: no normal comes back, and none is claimed
  ok(st, patchCable(st.getModel(), PANEL, 'eg1.control', 'vco1.fm').action, 'patch 1');
  ok(st, patchCable(st.getModel(), PANEL, 'eg2.control', 'vco1.fm').action, 'patch 2');
  const two = panelCables(st.getModel(), PANEL).filter((c) => c.to === 'vco1.fm');
  assert.equal(two.length, 2, 'two panel cables into VCO 1 FM');
  const one = unpatch(st.getModel(), PANEL, two[0].id);
  assert.deepEqual([one.restored, one.cables], [0, 1]);
  assert.equal(unpatchText(one), 'Kabel odpojen; vstup dál napájí jiný kabel.');
  assert.equal(unpatchText({ restored: 0, cables: 0, studio: 1 }),
    'Kabel odpojen; vstup dál napájí propojení ze Studia.');
  assert.equal(unpatchText({ restored: 0, cables: 0, studio: 0 }), 'Kabel odpojen.');
  for (const r of [plain, { restored: 0, cables: 1 }, { restored: 0, studio: 1 }, {}]) {
    if (!r.restored) assert.doesNotMatch(unpatchText(r), /obnoven/, JSON.stringify(r));
  }
});

test('K236 R5: a preset over broken amount edges is the depth the normal comes back at', () => {
  const st = panelStore();
  const a = amount('lpf-eg2');
  ok(st, breakNormals(st.getModel(), PANEL, 'lpf.frequency').action, 'break');
  assert.equal(amountDepth(st.getModel(), PANEL, a), 2, 'init: the remembered 2');
  const preset = presetAction(st.getModel(), PANEL, 'bass').action;
  ok(st, preset, 'bass');
  assert.equal(amountDepth(st.getModel(), PANEL, a), 3, 'bass: the remembered depth is 3');
  // the cable that replaces the normal, then its removal: the normal is bass's
  ok(st, patchCable(st.getModel(), PANEL, 'eg1.control', 'lpf.frequency').action, 'patch');
  ok(st, unpatch(st.getModel(), PANEL, cableInto(st, 'lpf.frequency').id).action, 'unpatch');
  assert.ok(into(st.getModel(), 'lpf.frequency').includes('eg2.control@3'),
    into(st.getModel(), 'lpf.frequency').join(' '));
  // the preset was one undo: its values and the remembered depth go back together
  st.undo();
  st.undo();
  st.undo();
  assert.equal(amountDepth(st.getModel(), PANEL, a), 2, 'undo: the depth from before bass');
});

test('K236 R5: with every amount edge in place a preset stays one PATCH_REPLACE', () => {
  const st = panelStore();
  const r = presetAction(st.getModel(), PANEL, 'bass').action;
  assert.equal(r.type, 'PATCH_REPLACE');
  ok(st, r, 'bass');
  assert.equal(amountDepth(st.getModel(), PANEL, amount('lpf-eg2')), 3, 'the edge carries 3');
});
