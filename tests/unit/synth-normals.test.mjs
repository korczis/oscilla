// K061: normalling (src/js/synth/normals.js). A cable into a normalled jack is one BATCH (its
// normals out, the cable in); removing the last cable restores the normals with their ids; a
// cable that closes a loop is refused with the no-silent-feedback sentence and changes nothing;
// a normal deleted in Studio stays deleted until Restore; amount knobs address edges by source.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  amountEdges, amountReason, jackState, panelEdges, patchCable, restoreNormals, setAmount,
  unpatch,
} from '../../src/js/synth/normals.js';
import { panelStore } from './synth-fixture.mjs';

test('a cable into a normalled jack is one batch: the normal out, the cable in', () => {
  const st = panelStore();
  assert.equal(jackState(st.getModel(), PANEL, 'vco2.pitch'), 'normalled');
  const r = patchCable(st.getModel(), PANEL, 'mg.control', 'vco2.pitch');
  assert.equal(r.action.type, 'BATCH');
  const rev = st.getRevision();
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(st.getRevision(), rev + 1);
  assert.equal(jackState(st.getModel(), PANEL, 'vco2.pitch'), 'patched');
  assert.equal(panelEdges(st.getModel(), PANEL).normals.has('n2'), false);
  const cable = panelEdges(st.getModel(), PANEL).cables[0];
  st.dispatch(unpatch(st.getModel(), PANEL, cable.id).action);
  assert.equal(jackState(st.getModel(), PANEL, 'vco2.pitch'), 'normalled');
  assert.equal(panelEdges(st.getModel(), PANEL).normals.get('n2').id, 'semi-mono-1-n2',
    'restored with its id');
});

test('a cable that closes a loop is refused with the feedback sentence', () => {
  const st = panelStore();
  const before = st.getModel();
  const r = st.dispatch(patchCable(before, PANEL, 'lpf.audio', 'mix.in1').action);
  assert.equal(r.ok, false);
  assert.match(r.reason, /feedback|loop|cycle|own source/i);
  assert.equal(st.getModel(), before);
});

test('a normal removed in Studio stays removed; Restore is explicit', () => {
  const st = panelStore();
  const e = panelEdges(st.getModel(), PANEL).normals.get('n6');
  st.dispatch({ type: 'EDGE_REMOVE', edgeId: e.id });
  assert.equal(jackState(st.getModel(), PANEL, 'mix.in2'), 'open');
  assert.equal(jackState(st.getModel(), PANEL, 'mix.in2'), 'open', 'reading never repairs');
  st.dispatch(restoreNormals(st.getModel(), PANEL, 'mix.in2').action);
  assert.equal(jackState(st.getModel(), PANEL, 'mix.in2'), 'normalled');
  assert.ok(restoreNormals(st.getModel(), PANEL, 'mix.in2').reason);
});

test('amount knobs edit the depth of every edge from their source', () => {
  const st = panelStore();
  const a = PANEL.amounts.find((x) => x.id === 'vco-mg');
  assert.equal(amountEdges(st.getModel(), PANEL, a).length, 2, 'vco1.fm and vco2.fm');
  st.dispatch(setAmount(st.getModel(), PANEL, a, 0.5));
  assert.deepEqual(amountEdges(st.getModel(), PANEL, a).map((e) => e.props.depth), [0.5, 0.5]);
  for (const e of amountEdges(st.getModel(), PANEL, a)) {
    st.dispatch({ type: 'EDGE_REMOVE', edgeId: e.id });
  }
  assert.match(amountReason(st.getModel(), PANEL, a), /Nothing from MG \/ LFO is patched/);
  assert.equal(setAmount(st.getModel(), PANEL, a, 1), null);
});
