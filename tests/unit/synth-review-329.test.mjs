// Review of #329 (K061, K062, K106 part): defects a player meets on the semi-modular panel.
//   - A cable between the jacks of a normal (MG into LPF cutoff, the classic MS-20 patch) is a
//     cable: drawn, removable, in the link; it must not pass for the normal it replaced while
//     the jack's other normals stay silently broken.
//   - A copied link reopens the same patch: the cables, and the depth of an amount knob that
//     covers a cable.
//   - S&H Rate and Smooth do nothing while Clock is patched (normalled to the gate), so they
//     say why (project.no-inert-surfaces (b)); a control's name carries its module.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  jackState, panelCables, panelEdges, patchCable, setAmount, unpatch,
} from '../../src/js/synth/normals.js';
import { linkAction, linkOf } from '../../src/js/synth/link.js';
import { decodeSynthLink, encodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { PRESETS } from '../../src/js/synth/presets.js';
import { controlReason, plateHtml } from '../../src/js/synth/view/face.js';
import { panelStore } from './synth-fixture.mjs';

const amount = (id) => PANEL.amounts.find((a) => a.id === id);
const into = (m, jack) => {
  const ids = new Map([...PANEL.resolve(m)].filter(([, n]) => n).map(([k, n]) => [n.id, k]));
  return m.graph.edges.filter((e) => `${ids.get(e.to.node)}.${e.to.port}` === jack)
    .map((e) => `${ids.get(e.from.node)}.${e.from.port}@${e.props.depth}`).sort();
};

test('a cable on the endpoints of a normal is a cable; unpatching restores both normals', () => {
  const st = panelStore();
  st.dispatch(patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency').action);
  const m = st.getModel();
  assert.equal(jackState(m, PANEL, 'lpf.frequency'), 'patched');
  assert.deepEqual(panelCables(m, PANEL).map((c) => [c.from, c.to]),
    [['mg.control', 'lpf.frequency']]);
  const { normals } = panelEdges(m, PANEL);
  assert.equal(normals.has('n21'), false, 'MG to cutoff is broken by the cable');
  assert.equal(normals.has('n22'), false, 'EG 2 to cutoff is broken by the cable');
  st.dispatch(unpatch(m, PANEL, panelCables(m, PANEL)[0].id).action);
  const back = panelEdges(st.getModel(), PANEL).normals;
  assert.equal(back.get('n21').id, 'semi-mono-1-n21');
  assert.equal(back.get('n22').id, 'semi-mono-1-n22');
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'normalled');
});

test('a copied link reopens the cables and the amount depth that drives them', () => {
  const st = panelStore();
  st.dispatch(patchCable(st.getModel(), PANEL, 'mg.control', 'lpf.frequency').action);
  st.dispatch(setAmount(st.getModel(), PANEL, amount('lpf-mg'), 3));
  st.dispatch(patchCable(st.getModel(), PANEL, 'eg1.control', 'vco1.fm').action);
  st.dispatch(setAmount(st.getModel(), PANEL, amount('vco-eg1'), -1));
  st.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'semi-mono-1-lpf', key: 'frequency',
    value: 300 });
  const want = st.getModel();
  const hash = encodeSynthLink(linkOf(want, PANEL, 'init'));
  const r = decodeSynthLink(`#${hash}`, PANEL, PRESETS);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.link.cables, [['mg.control', 'lpf.frequency'], ['eg1.control', 'vco1.fm']]);
  const fresh = panelStore();
  const done = fresh.dispatch(linkAction(fresh.getModel(), PANEL, r.link));
  assert.equal(done.ok, true, done.reason);
  const got = fresh.getModel();
  for (const jack of ['lpf.frequency', 'vco1.fm', 'vco2.fm']) {
    assert.deepEqual(into(got, jack), into(want, jack), jack);
  }
  assert.equal(got.graph.nodes.find((n) => n.id === 'semi-mono-1-lpf').params.frequency, 300);
});

test('two cables into one jack: the link removes its normals once', () => {
  const st = panelStore();
  const link = { tab: 'panel', preset: 'init', values: [],
    cables: [['mg.control', 'vco1.fm'], ['eg1.control', 'vco1.fm']] };
  const r = st.dispatch(linkAction(st.getModel(), PANEL, link));
  assert.equal(r.ok, true, r.reason);
  assert.equal(panelCables(st.getModel(), PANEL).length, 2);
});

test('S&H Rate and Smooth say why while Clock is patched', () => {
  const st = panelStore();
  const m = st.getModel();
  const sh = PANEL.module('sh');
  const node = PANEL.resolve(m).get('sh');
  const face = PANEL.faceOf('sh');
  for (const key of ['rate', 'smooth']) {
    assert.match(controlReason(sh, node, face.find((c) => c.key === key), m, PANEL) || '',
      /without a clock/, key);
  }
  assert.equal(controlReason(sh, node, face.find((c) => c.key === 'seed'), m, PANEL), null);
  const html = plateHtml({ panel: PANEL, module: sh, node, model: m, tokens: new Proxy({},
    { get: () => 'currentColor' }) });
  assert.match(html,
    /data-toggle="sh\.smooth"[^>]*aria-disabled="true" aria-describedby="sh\.smooth-why"/);
  st.dispatch({ type: 'EDGE_REMOVE', edgeId: 'semi-mono-1-n23' });
  const free = st.getModel();
  assert.equal(controlReason(sh, PANEL.resolve(free).get('sh'), face.find((c) => c.key
    === 'rate'), free, PANEL), null);
});

test('every control is named by its module and its label', () => {
  const st = panelStore();
  const m = st.getModel();
  const lpf = PANEL.module('lpf');
  const html = plateHtml({ panel: PANEL, module: lpf, node: PANEL.resolve(m).get('lpf'),
    model: m, tokens: new Proxy({}, { get: () => 'currentColor' }) });
  assert.match(html,
    /data-knob="lpf\.frequency" aria-labelledby="synth-m-lpf lpf\.frequency-label"/);
  assert.match(html, /id="synth-m-lpf"/);
});
