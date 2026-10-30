// The Engines tab (K090-K092, K121-K123; Q019, Q021): one declaration. Every engine module names a
// note-source node with 16 voices and its face is generated from the registry (the panel's count
// rule); the chain into the one Output is derived, so adding an engine is one entry; the blocked
// engines say why; no engine adapter builds a cycle or a DelayNode (project.no-silent-feedback
// v1); the live notes route to an engine's voice pool; links carry the tab and the engine; a
// preset sets only its own tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  ENGINE_BLOCKED, ENGINE_MODULES, ENGINE_TAB, enginesChain,
} from '../../src/js/synth/panels/engines.js';
import { definePanel } from '../../src/js/synth/panel.js';
import { presetAction, presetValues, presetOf } from '../../src/js/synth/presets.js';
import { linkAction, linkOf } from '../../src/js/synth/link.js';
import { decodeSynthLink, encodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { PRESETS } from '../../src/js/synth/presets.js';
import { createLiveNotes, liveModel } from '../../src/js/studio/live-notes.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { engineEnv, hasCycle } from './engine-fixture.mjs';
import { panelStore } from './synth-fixture.mjs';

const ENGINE_TYPES = ['additive-voice', 'fm-voice', 'am-voice', 'wavetable-voice', 'perc-voice'];

test('every engine module is a 16-voice note source with a generated face', () => {
  const mods = PANEL.modulesOf('engines');
  assert.deepEqual(mods.map((m) => m.id), ENGINE_MODULES.map((m) => m.id));
  assert.deepEqual(PANEL.tabs.map((t) => t.id), ['panel', 'engines']);
  for (const m of mods) {
    assert.equal(m.def.capabilities.notes, true, m.id);
    assert.equal(m.def.capabilities.voices, 16, m.id);
    const face = PANEL.faceOf(m.id);
    assert.equal(face.length, m.def.params.length - Object.keys(m.fixed || {}).length, m.id);
    for (const c of face) assert.ok(m.def.params.some((p) => p.key === c.key), `${m.id}.${c.key}`);
    assert.ok(PANEL.jacksOf(m.id).some((j) => j.id === `${m.id}.thru` && j.direction === 'in'));
  }
  assert.equal(PANEL.module('sync').values.bank, 'sync', 'the sync module fixes its bank');
  assert.deepEqual(PANEL.module('wavetable').params.find((p) => p.key === 'bank').options
    .map((o) => o[0]), ['basic', 'formant', 'pulse']);
});

test('the chain into the one Output is derived: adding an engine is one entry', () => {
  const chain = enginesChain('vca.audio', 'out.audio');
  assert.equal(chain.length, ENGINE_MODULES.length + 1);
  assert.deepEqual(chain[0], ['e1', 'vca.audio', 'additive.thru']);
  assert.deepEqual(chain.at(-1), [`e${chain.length}`, 'perc.audio', 'out.audio']);
  const extra = [...ENGINE_MODULES, { id: 'fm2', label: 'FM 2', node: 'fm-voice', tab: 'engines' }];
  const p = definePanel({ id: 'chain-fixture', title: 'Fixture', tabs: [{ id: 'panel',
    title: 'Fixture' }, ENGINE_TAB],
  modules: [{ id: 'vca', label: 'VCA', node: 'gain' }, { id: 'out', label: 'OUT', node: 'master' },
    ...extra],
  normals: enginesChain('vca.audio', 'out.audio', extra) });
  assert.equal(p.modulesOf('engines').length, ENGINE_MODULES.length + 1);
  assert.equal(p.normals.length, chain.length + 1);
  assert.deepEqual([p.normals.at(-2).from, p.normals.at(-2).to], ['perc.audio', 'fm2.thru']);
});

test('the instrument compiles with the chain, and every engine reaches the Output', () => {
  const st = panelStore();
  const m = st.getModel();
  const res = PANEL.resolve(m);
  const live = liveModel(m);
  assert.equal(compileStudio(live).ok, true);
  for (const mod of PANEL.modulesOf('engines')) {
    assert.ok(live.graph.nodes.some((n) => n.id === res.get(mod.id).id), `${mod.id} is armed`);
    let at = res.get(mod.id).id;
    for (let hop = 0; hop < 10 && at !== res.get('out').id; hop++) {
      at = m.graph.edges.find((e) => e.from.node === at && e.from.port === 'audio').to.node;
    }
    assert.equal(at, res.get('out').id, `${mod.id} reaches the Output`);
  }
});

test('the blocked engines are shown with their reason, naming the rule and Q022', () => {
  assert.deepEqual(ENGINE_BLOCKED.map((b) => b.id), ['pluck', 'fm-feedback']);
  for (const b of ENGINE_BLOCKED) {
    assert.match(b.reason, /project\.no-silent-feedback/);
    assert.match(b.reason, /Q022/);
    assert.match(b.reason, /AudioWorklet/);
  }
});

test('no engine adapter builds a cycle or a DelayNode (project.no-silent-feedback v1)', () => {
  for (const type of ENGINE_TYPES) {
    const { ctx, h } = engineEnv(type);
    for (const n of [48, 60, 66, 70, 72]) h.noteOn(0.1, n, 100);
    h.noteOff(0.3, 60);
    assert.equal(hasCycle(ctx), false, type);
    assert.equal(ctx.created.filter((n) => n.kind === 'delay').length, 0, type);
    assert.equal(typeof h.noteOn, 'function');
    assert.ok(h.inputs.thru && h.outputs.audio, type);
    assert.ok(h.inputs.thru === h.outputs.audio, `${type}: the chain passes unchanged`);
  }
});

test('live notes: an engine id plays its voice pool; all-off and held cover it', () => {
  const calls = [];
  const engine = {
    noteOn: (t, note, vel) => { calls.push(['on', note, vel]); return { slot: 0, dropped: 2 }; },
    noteOff: (t, note) => { calls.push(['off', note]); return true; },
    allOff: (t, fast) => { calls.push(['all', fast]); return 1; },
  };
  const notes = createLiveNotes({ getModel: () => ({ graph: { nodes: [], edges: [] } }),
    handleOf: (id) => (id === 'eng' ? engine : null) });
  const a = notes.event('eng', { kind: 'on', note: 60, velocity: 90, at: 1 });
  assert.equal(a.dropped, 2);
  notes.event('eng', { kind: 'on', note: 64, at: 1 });
  assert.deepEqual(notes.held().sort(), [60, 64]);
  notes.event('eng', { kind: 'off', note: 60, at: 2 });
  assert.deepEqual(notes.held(), [64]);
  assert.equal(notes.allOff(3), 1);
  assert.deepEqual(calls, [['on', 60, 90], ['on', 64, 100], ['off', 60], ['all', true]]);
  assert.deepEqual(notes.held(), []);
});

test('a link carries the tab and the engine, strictly', () => {
  const link = { tab: 'engines', engine: 'fm', preset: 'fm-bell', values: [['fm.ratio2', 7]],
    cables: [['mg.control', 'wavetable.morph']] };
  const hash = encodeSynthLink(link);
  assert.match(hash, /yt=engines&ye=fm&yp=fm-bell/);
  assert.deepEqual(decodeSynthLink(`#${hash}`, PANEL, PRESETS), { ok: true, link });
  assert.match(decodeSynthLink('#m=synth&ye=lpf', PANEL, PRESETS).reason, /no engine "lpf"/);
  assert.match(decodeSynthLink('#m=synth&yt=drums', PANEL, PRESETS).reason, /no tab/);
  assert.equal(decodeSynthLink('#m=synth&ye=perc', PANEL, PRESETS).link.tab, 'engines');
});

test('a preset sets its own tab only; a link reopens the whole instrument', () => {
  const st = panelStore();
  const res = PANEL.resolve(st.getModel());
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: res.get('fm').id, key: 'ratio2',
    value: 9 }).ok, true);
  assert.equal(st.dispatch(presetAction(st.getModel(), PANEL, 'bass').action).ok, true);
  const node = (mid) => st.getModel().graph.nodes.find((n) => n.id === res.get(mid).id);
  assert.equal(node('fm').params.ratio2, 9, 'a panel preset leaves the engines');
  assert.equal(node('lpf').params.frequency, 180);
  assert.equal(st.dispatch(presetAction(st.getModel(), PANEL, 'fm-bell').action).ok, true);
  assert.equal(node('fm').params.ratio2, 3.5);
  assert.equal(node('lpf').params.frequency, 180, 'an engine preset leaves the panel');
  assert.equal(presetOf('fm-bell').engine, 'fm');
  const l = linkOf(st.getModel(), PANEL, 'fm-bell');
  assert.ok(l.values.some(([k, v]) => k === 'lpf.frequency' && v === 180));
  const other = panelStore();
  assert.equal(other.dispatch(linkAction(other.getModel(), PANEL, l)).ok, true);
  const res2 = PANEL.resolve(other.getModel());
  const node2 = (mid) => other.getModel().graph.nodes.find((n) => n.id === res2.get(mid).id);
  for (const mid of ['fm', 'lpf', 'additive']) {
    assert.deepEqual(node2(mid).params, node(mid).params, mid);
  }
  assert.deepEqual(Object.keys(presetValues(PANEL, presetOf('kit'))).length,
    PANEL.modules.length);
});

test('the engine node types are new registry entries, sources, never a feedback parameter', () => {
  for (const type of ENGINE_TYPES) {
    const d = NODE_REGISTRY.get(type);
    assert.equal(d.category, 'SOURCES');
    assert.ok(d.help.constraints.includes('16 voices') || /16/.test(d.help.constraints), type);
    assert.ok(!d.params.some((p) => /feedback/i.test(p.key)), type);
  }
});
