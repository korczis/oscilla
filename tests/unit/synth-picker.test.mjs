// K066: beside the piano. The instrument picker lists exactly the nodes that play notes (or
// hits), a choice is ONE history entry and undo restores the previous route; the waveform group
// is NODE_PARAM_SET; every quick preset is a factory panel patch that validates, applies by
// PATCH_REPLACE through patches.js in one entry and changes only parameters of the panel's
// nodes (never an edge added, removed or moved).
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { PRESETS, presetAction, presetPatch } from '../../src/js/synth/presets.js';
import {
  NEW_VOICE, NEW_VOICE_TAKEN, instrumentChoices, routeAction, routedNode, waveAction, waveOf,
} from '../../src/js/synth/picker.js';
import { importPatch, patchParams, patchTargets } from '../../src/js/studio/patches.js';
import { NODE_REGISTRY, playsNotes } from '../../src/js/studio/registry.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { importStudio } from '../../src/js/studio/migrate.js';
import { serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { templateModel, REFERENCE_TEMPLATE_ID } from '../../src/js/studio/templates/index.js';
import { panelStore } from './synth-fixture.mjs';

const noteTypes = (m) => m.graph.nodes.filter((n) => playsNotes(n.type)).map((n) => n.id);

test('the picker lists exactly the nodes with the notes or hits capability, then New Synth voice',
  () => {
    const st = panelStore();
    const m = st.getModel();
    const list = instrumentChoices(m, PANEL);
    const want = m.graph.nodes.filter((n) => {
      const c = NODE_REGISTRY.get(n.type).capabilities;
      return c.notes || c.hits;
    }).map((n) => n.id);
    assert.deepEqual(list.slice(0, -1).map((c) => c.id), want);
    assert.equal(want.length, 8, 'the panel Keys, its six engines and the XY pad');
    assert.ok(!list.some((c) => c.id === PANEL.resolve(m).get('vco1').id), 'a VCO plays no note');
    const last = list.at(-1);
    assert.equal(last.id, NEW_VOICE);
    assert.equal(last.disabled, true, 'the panel is there: Master Output takes one cable');
    assert.equal(last.reason, NEW_VOICE_TAKEN);
  });

test('a choice is one history entry; undo restores the previous route, redo the new one', () => {
  const st = panelStore();
  const fm = PANEL.resolve(st.getModel()).get('fm');
  const depth = st.debugInfo().undoDepth;
  const r = routeAction(st.getModel(), PANEL, fm.id);
  const done = st.dispatch(r.action);
  assert.equal(done.ok, true, done.reason);
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  assert.equal(st.undoLabel(), `Play ${fm.metadata.name} from the keys`);
  assert.equal(routedNode(st.getModel()).id, fm.id);
  assert.equal(instrumentChoices(st.getModel(), PANEL, { current: fm.id })
    .find((c) => c.selected).id, fm.id);
  // The route is saved with the document and outside its execution hash.
  const reopened = importStudio(JSON.parse(serializeStudio(st.getModel())));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.model.metadata.noteTarget, fm.id);
  st.undo();
  assert.equal(routedNode(st.getModel()), null);
  assert.equal(st.getModel().metadata.noteTarget, undefined);
  st.redo();
  assert.equal(routedNode(st.getModel()).id, fm.id);
  assert.equal(studioHash(st.getModel()), (() => {
    st.undo();
    return studioHash(st.getModel());
  })(), 'the route does not change what the graph executes');
  // The panel's own Keys clears the route: the tab chooses again.
  st.redo();
  const keys = PANEL.resolve(st.getModel()).get('keys');
  assert.equal(st.dispatch(routeAction(st.getModel(), PANEL, keys.id).action).ok, true);
  assert.equal(st.getModel().metadata.noteTarget, undefined);
});

test('negative: a target without the notes capability is refused with its sentence', () => {
  const st = panelStore();
  const vco = PANEL.resolve(st.getModel()).get('vco1');
  assert.match(routeAction(st.getModel(), PANEL, vco.id).reason, /does not play notes/);
  const before = st.getModel();
  const depth = st.debugInfo().undoDepth;
  const r = st.dispatch({ type: 'METADATA_SET', noteTarget: vco.id });
  assert.equal(r.ok, false);
  assert.match(r.reason, /VCO 1 does not play notes: the keys play a node with the notes or hits/);
  assert.equal(st.getModel(), before, 'model unchanged');
  assert.equal(st.debugInfo().undoDepth, depth, 'history unchanged');
  // A tampered file that names a VCO as the target does not load.
  const doc = JSON.parse(serializeStudio(before));
  doc.metadata.noteTarget = vco.id;
  const bad = importStudio(doc);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /does not play notes/);
});

test('removing the routed node clears the route in the same entry; undo restores both', () => {
  const st = panelStore();
  const am = PANEL.resolve(st.getModel()).get('am');
  st.dispatch(routeAction(st.getModel(), PANEL, am.id).action);
  assert.equal(st.dispatch({ type: 'NODE_REMOVE', nodeIds: [am.id] }).ok, true);
  assert.equal(st.getModel().metadata.noteTarget, undefined);
  st.undo();
  assert.equal(st.getModel().metadata.noteTarget, am.id);
});

test('New Synth voice inserts the panel in one entry when the document has none', () => {
  const st = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator() });
  const choice = instrumentChoices(st.getModel(), PANEL).at(-1);
  assert.equal(choice.disabled, false);
  const depth = st.debugInfo().undoDepth;
  assert.equal(st.dispatch(routeAction(st.getModel(), PANEL, NEW_VOICE).action).ok, true);
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  assert.ok(PANEL.resolve(st.getModel()).get('keys'));
  assert.equal(noteTypes(st.getModel()).length, 8);
});

test('the waveform group: each wave one NODE_PARAM_SET; Noise is the Mixer\'s noise level', () => {
  const st = panelStore();
  for (const w of ['sine', 'triangle', 'sawtooth', 'square', 'pulse']) {
    const a = waveAction(st.getModel(), PANEL, 'vco2', w);
    assert.equal(a.type, 'NODE_PARAM_SET', w);
    st.dispatch(a);
    assert.equal(PANEL.resolve(st.getModel()).get('vco2').params.waveform, w);
    assert.equal(waveOf(st.getModel(), PANEL, 'vco2'), w);
  }
  const n = waveAction(st.getModel(), PANEL, 'vco2', 'noise');
  assert.equal(n.type, 'NODE_PARAM_SET');
  assert.equal(n.nodeId, PANEL.resolve(st.getModel()).get('mix').id);
  st.dispatch(n);
  const mix = PANEL.resolve(st.getModel()).get('mix').params;
  assert.equal(mix.level2, 0);
  assert.ok(mix.level3 > 0);
  assert.equal(waveOf(st.getModel(), PANEL, 'vco2'), 'noise');
  // A wave after Noise brings the oscillator back, in one entry.
  const depth = st.debugInfo().undoDepth;
  st.dispatch(waveAction(st.getModel(), PANEL, 'vco2', 'sine'));
  assert.equal(st.debugInfo().undoDepth, depth + 1);
  assert.equal(waveOf(st.getModel(), PANEL, 'vco2'), 'sine');
  assert.equal(waveAction(st.getModel(), PANEL, 'vco2', 'chirp'), null);
});

test('every quick preset is a valid factory panel patch applied by PATCH_REPLACE, params only',
  () => {
    for (const p of PRESETS) {
      const patch = presetPatch(PANEL, p.id);
      const checked = importPatch(patch);
      assert.equal(checked.ok, true, `${p.id}: ${checked.ok || checked.errors[0].message}`);
      const st = panelStore();
      const before = st.getModel();
      const r = presetAction(before, PANEL, p.id);
      assert.equal(r.action.type, 'PATCH_REPLACE', p.id);
      assert.ok(r.action.onto, `${p.id}: onto the panel's nodes`);
      const depth = st.debugInfo().undoDepth;
      const done = st.dispatch(r.action);
      assert.equal(done.ok, true, `${p.id}: ${done.reason}`);
      const after = st.getModel();
      if (done.changed) assert.equal(st.debugInfo().undoDepth, depth + 1, p.id);
      const ids = (m) => m.graph.nodes.map((n) => `${n.id}@${n.position.x},${n.position.y}`
        + `:${n.metadata.name}`);
      const edges = (m) => m.graph.edges.map((e) => `${e.id}:${e.from.node}.${e.from.port}>`
        + `${e.to.node}.${e.to.port}`);
      assert.deepEqual(ids(after), ids(before), `${p.id}: nodes kept, not moved or renamed`);
      assert.deepEqual(edges(after), edges(before), `${p.id}: every edge kept`);
      const panelIds = new Set([...PANEL.resolve(before).values()].filter(Boolean)
        .map((n) => n.id));
      for (const n of after.graph.nodes) {
        const old = before.graph.nodes.find((x) => x.id === n.id);
        if (JSON.stringify(old.params) !== JSON.stringify(n.params)) {
          assert.ok(panelIds.has(n.id), `${p.id}: ${n.id} is not a panel node`);
        }
      }
      assert.equal(compileStudio(liveModel(after)).ok, true, p.id);
    }
  });

test('negative: a preset that would add edges adds none; the edge is reported skipped', () => {
  const st = panelStore();
  const m = st.getModel();
  const patch = JSON.parse(JSON.stringify(presetPatch(PANEL, 'bass')));
  // An edge the panel does not hold: VCO 1 audio straight into the LPF.
  patch.graph.edges.push({ id: 'extra', from: { node: 'vco1', port: 'audio' },
    to: { node: 'lpf', port: 'audio' }, props: {} });
  assert.equal(importPatch(patch).ok, true);
  const { onto, missing } = patchTargets(m, patch);
  assert.deepEqual(missing, []);
  const r = patchParams(m, patch, onto);
  assert.equal(r.model.graph.edges.length, m.graph.edges.length);
  assert.deepEqual(r.skipped.edges, ['extra']);
  const done = st.dispatch({ type: 'PATCH_REPLACE', patch, onto, label: 'Preset Bass' });
  assert.equal(done.ok, true);
  assert.deepEqual(st.getModel().graph.edges.map((e) => e.id), m.graph.edges.map((e) => e.id));
  // Onto a node of another type: refused with the reason, nothing changes.
  const vco = PANEL.resolve(m).get('vco1');
  const wrong = st.dispatch({ type: 'PATCH_REPLACE', patch, onto: { lpf: vco.id } });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /VCO 1 is a VCO; the patch sets a Filter/);
});

test('review R1: a preset sets an amount depth, keeping the cable\'s polarity and mapping', () => {
  const st = panelStore();
  const m = st.getModel();
  const eg2 = PANEL.resolve(m).get('eg2').id;
  const lpf = PANEL.resolve(m).get('lpf').id;
  const edge = m.graph.edges.find((e) => e.from.node === eg2 && e.to.node === lpf
    && e.to.port === 'frequency');
  assert.equal(st.dispatch({ type: 'EDGE_UPDATE', edgeId: edge.id,
    props: { polarity: 'bipolar', mapping: 'linear' } }).ok, true);
  assert.equal(st.dispatch(presetAction(st.getModel(), PANEL, 'init').action).ok, true);
  const after = st.getModel().graph.edges.find((e) => e.id === edge.id).props;
  assert.equal(after.depth, 2, 'the preset owns the depth');
  assert.equal(after.polarity, 'bipolar', 'polarity kept');
  assert.equal(after.mapping, 'linear', 'mapping kept');
});

test('review R3: applying the preset that is already in place adds no undo entry', () => {
  const st = panelStore();
  st.dispatch(presetAction(st.getModel(), PANEL, 'bass').action);
  const depth = st.debugInfo().undoDepth;
  const again = st.dispatch(presetAction(st.getModel(), PANEL, 'bass').action);
  assert.equal(again.ok, true);
  assert.equal(st.debugInfo().undoDepth, depth);
});

test('review R4: a route may name any valid node id, up to the id limit', () => {
  const st = panelStore();
  const id = `keys-${'k'.repeat(100)}`;
  assert.equal(st.dispatch({ type: 'NODE_ADD', id, nodeType: 'keys',
    position: { x: 0, y: 0 } }).ok, true);
  assert.equal(st.dispatch({ type: 'METADATA_SET', noteTarget: id }).ok, true);
  const back = importStudio(JSON.parse(serializeStudio(st.getModel())));
  assert.equal(back.ok, true, back.ok || back.errors[0].message);
  assert.equal(back.model.metadata.noteTarget, id);
});
