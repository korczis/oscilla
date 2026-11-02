// Review of #329, round 2 (K058, K061, K062, K063, K066, K106): what a cable, a link and a preset
// must do on the semi-modular panel, judged on the real runtime's ranges (fake Web Audio).
//   - A cable inherits the props of the normal it replaces (same source), else of a normal of
//     the jack whose source has the same range, else source-range defaults: an EG cable into the
//     VCA rests at 0 (no drone), EG cables into pitch or cutoff rest at the jack's base, a Keys
//     pitch cable tracks 1.00 oct per octave; a cable an amount knob covers takes its depth.
//   - No inert jack (project.no-inert-surfaces): every input jack a cable reaches is active.
//   - Every link Copy link writes reopens (every jack pair), and over a patched panel it
//     reopens the same patch; presets write their values and amounts.
//   - Studio edits the panel did not make are shown as they sound; a deleted Keys node does not
//     block the panel; opening the Synth never cuts the document's Master feed unasked.
//   - The transport: PLAY while armed promotes to the whole document; arming closes the
//     Keys-gated envelopes; the armed model never crosses Master.
import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import {
  breakNormals, createAmountMemory, jackState, panelCables, panelEdges, patchCable, setAmount,
  unpatch,
} from '../../src/js/synth/normals.js';
import { linkAction, linkOf } from '../../src/js/synth/link.js';
import { PRESETS, presetAction, presetOf, presetValues } from '../../src/js/synth/presets.js';
import { decodeSynthLink, encodeSynthLink } from '../../src/js/core/url-state-synth.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { listTemplates, templateModel } from '../../src/js/studio/templates/index.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const amount = (id) => PANEL.amounts.find((a) => a.id === id);
const nodeOf = (m, mid) => PANEL.resolve(m).get(mid);
const patch = (st, from, to, opts) => {
  const r = patchCable(st.getModel(), PANEL, from, to, opts);
  assert.ok(r.action, `${from} > ${to}: ${r.reason}`);
  const done = st.dispatch(r.action);
  assert.equal(done.ok, true, `${from} > ${to}: ${done.reason}`);
  return panelCables(st.getModel(), PANEL).find((c) => c.from === from && c.to === to);
};
const edgeOf = (m, id) => m.graph.edges.find((e) => e.id === id);
const into = (m, jack) => {
  const ids = new Map([...PANEL.resolve(m)].filter(([, n]) => n).map(([k, n]) => [n.id, k]));
  return m.graph.edges.filter((e) => `${ids.get(e.to.node)}.${e.to.port}` === jack)
    .map((e) => `${ids.get(e.from.node) || e.from.node}.${e.from.port}@${e.props.depth}`).sort();
};

function engineEnv() {
  const fx = createFakeAudioEnv({ sampleRate: 48000 });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { fx, engine };
}
/** The runtime running the armed model of `model` (the real adapters' handles and ranges). */
function running(model) {
  const { engine } = engineEnv();
  const runtime = createStudioRuntime({ engine });
  const r = runtime.apply(liveModel(model), { revision: 1 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(runtime.start().ok, true);
  return runtime;
}
/** What edge `e` adds to its parameter (compiler computeBases): u is the source's value. */
function edgeMap(runtime, e) {
  const h = runtime.edges.get(e.id);
  assert.equal(h && h.status, 'active', `edge ${e.id} is active`);
  const [lo, hi] = h.range;
  const p = e.props;
  const t0 = p.polarity === 'unipolar' ? 0 : -p.depth;
  const a = (p.depth - t0) / (hi - lo);
  return { slope: a, at: (u) => t0 + a * (u - lo) + p.offset };
}

// ------------------------------------------------------------------ cable props (P1)

test('an EG cable into the VCA rests at 0: no drone with no key held', () => {
  for (const eg of ['eg1', 'eg2']) {
    const st = panelStore();
    const c = patch(st, `${eg}.control`, 'vca.gain');
    const m = st.getModel();
    const e = edgeOf(m, c.id);
    const rt = running(m);
    assert.equal(edgeMap(rt, e).at(0), 0, `${eg} at rest adds nothing to the VCA gain`);
    assert.equal(edgeMap(rt, e).at(1), 1, `${eg} at its peak opens the VCA as the normal does`);
    assert.equal(e.props.polarity, 'unipolar');
  }
});

test('EG cables into pitch and cutoff rest at the jack base', () => {
  const pairs = [['eg1.control', 'vco1.pitch'], ['eg2.control', 'vco2.pitch'],
    ['eg1.control', 'lpf.frequency'], ['eg1.control', 'hpf.frequency'],
    ['eg2.control', 'lpf.frequency'], ['eg1.control', 'vco1.fm']];
  for (const [from, to] of pairs) {
    const st = panelStore();
    const c = patch(st, from, to);
    const rt = running(st.getModel());
    assert.equal(edgeMap(rt, edgeOf(st.getModel(), c.id)).at(0), 0, `${from} > ${to} at rest`);
  }
});

test('a Keys pitch cable tracks 1.00 oct per octave of the note and rests at A4', () => {
  for (const to of ['vco1.pitch', 'vco2.pitch', 'vco2.fm', 'lpf.frequency', 'hpf.frequency']) {
    const st = panelStore();
    const c = patch(st, 'keys.pitch', to);
    const e = edgeOf(st.getModel(), c.id);
    const map = edgeMap(running(st.getModel()), e);
    assert.equal(map.slope, 1, `${to}: one octave per octave`);
    assert.equal(map.at(0), 0, `${to}: A4 adds nothing`);
  }
});

test('re-patching a normal\'s own jacks gives the normal\'s props', () => {
  for (const id of ['n1', 'n2', 'n24', 'n22', 'n17']) {
    const n = PANEL.normals.find((x) => x.id === id);
    const st = panelStore();
    const c = patch(st, n.from, n.to);
    const got = edgeOf(st.getModel(), c.id).props;
    for (const k of ['polarity', 'mapping', 'depth', 'offset']) {
      assert.equal(got[k], n.props[k], `${id} ${k}`);
    }
  }
});

test('a cable an amount knob covers takes the knob depth; unpatching keeps the knob', () => {
  const st = panelStore();
  const memory = createAmountMemory(PANEL);
  const step = (action) => {
    const r = st.dispatch(action);
    assert.equal(r.ok, true, r.reason);
    memory.note(st.getModel());
  };
  step(setAmount(st.getModel(), PANEL, amount('lpf-eg2'), 3.5));
  step(setAmount(st.getModel(), PANEL, amount('lpf-mg'), 1));
  // A cable from the knob's own source keeps its depth (the knob does not jump).
  step(patchCable(st.getModel(), PANEL, 'eg2.control', 'lpf.frequency', { memory }).action);
  assert.deepEqual(into(st.getModel(), 'lpf.frequency'), ['eg2.control@3.5']);
  step(unpatch(st.getModel(), PANEL, panelCables(st.getModel(), PANEL)[0].id, { memory }).action);
  assert.deepEqual(into(st.getModel(), 'lpf.frequency'), ['eg2.control@3.5', 'mg.control@1']);
  // A cable from another source: both knobs come back as they were.
  step(patchCable(st.getModel(), PANEL, 'eg1.control', 'lpf.frequency', { memory }).action);
  step(unpatch(st.getModel(), PANEL, panelCables(st.getModel(), PANEL)[0].id, { memory }).action);
  assert.deepEqual(into(st.getModel(), 'lpf.frequency'), ['eg2.control@3.5', 'mg.control@1']);
  // One knob, equal depths: MG into VCO 1 FM next to the VCO 2 FM normal.
  step(setAmount(st.getModel(), PANEL, amount('vco-mg'), 0.5));
  step(patchCable(st.getModel(), PANEL, 'mg.control', 'vco1.fm', { memory }).action);
  assert.deepEqual(new Set([...into(st.getModel(), 'vco1.fm'), ...into(st.getModel(), 'vco2.fm')]
    .values().filter((x) => x.startsWith('mg.'))), new Set(['mg.control@0.5']));
});

// ------------------------------------------------------------------ no inert jack (P1)

test('the filters show no Peak (Q) jack: low- and high-pass Q cannot be modulated', () => {
  for (const mid of ['hpf', 'lpf']) {
    assert.equal(PANEL.jacksOf(mid).some((j) => j.port === 'Q'), false, mid);
    assert.ok(PANEL.faceOf(mid).some((c) => c.key === 'Q'), `${mid} keeps its Peak knob`);
  }
});

test('every input jack a cable reaches is active in the runtime, or the cable is refused', () => {
  const source = { CONTROL: 'mg.control', AUDIO: 'noise.audio', TRIGGER: 'keys.gate' };
  const other = { CONTROL: 'eg1.control', AUDIO: 'vco1.audio', TRIGGER: 'keys.gate' };
  let checked = 0;
  for (const m of PANEL.modules) {
    for (const j of PANEL.jacksOf(m.id).filter((x) => x.direction === 'in')) {
      const from = source[j.type].startsWith(`${m.id}.`) ? other[j.type] : source[j.type];
      const st = panelStore();
      const r = patchCable(st.getModel(), PANEL, from, j.id);
      if (r.reason) {
        assert.equal(j.id, 'sh.rate', `only a clocked S&H Rate refuses: ${j.id} ${r.reason}`);
        assert.match(r.reason, /Clock is patched/);
        continue;
      }
      const done = st.dispatch(r.action);
      if (!done.ok) {
        assert.match(done.reason, /feedback|loop|own source/i, `${from} > ${j.id}`);
        continue;
      }
      const rt = running(st.getModel());
      assert.deepEqual(rt.debugInfo().inactiveEdges, [], `${from} > ${j.id} is active`);
      checked += 1;
    }
  }
  assert.ok(checked >= 25, `${checked} jacks checked`);
  // With the clock unpatched, Rate takes a cable and it sounds.
  const st = panelStore();
  st.dispatch({ type: 'EDGE_REMOVE', edgeIds: ['semi-mono-1-n23'] });
  patch(st, 'mg.control', 'sh.rate');
  assert.deepEqual(running(st.getModel()).debugInfo().inactiveEdges, []);
});

test('the panel source ranges are the runtime adapters\' output ranges', () => {
  const st = panelStore();
  const rt = running(st.getModel());
  for (const m of PANEL.modules) {
    for (const j of PANEL.jacksOf(m.id)) {
      if (j.direction !== 'out' || j.type !== 'CONTROL') continue;
      const h = rt.nodes.get(nodeOf(st.getModel(), m.id).id);
      assert.deepEqual([...PANEL.sourceRange(j.id)], [...(h.outputRange[j.port] || [-1, 1])],
        j.id);
    }
  }
});

// ------------------------------------------------------------------ links (P1, P2)

test('every jack pair the panel patches round-trips through Copy link', () => {
  const outs = PANEL.modules.flatMap((m) => PANEL.jacksOf(m.id)).filter((j) => j.direction
    === 'out');
  const ins = PANEL.modules.flatMap((m) => PANEL.jacksOf(m.id)).filter((j) => j.direction
    === 'in');
  let pairs = 0;
  for (const a of outs) {
    for (const b of ins) {
      const st = panelStore();
      const r = patchCable(st.getModel(), PANEL, a.id, b.id);
      if (!r.action || !st.dispatch(r.action).ok) continue;
      const hash = encodeSynthLink(linkOf(st.getModel(), PANEL, 'init'));
      const d = decodeSynthLink(`#${hash}`, PANEL, PRESETS);
      assert.equal(d && d.ok, true, `${a.id} > ${b.id}: ${d && d.reason}`);
      assert.deepEqual(d.link.cables, [[a.id, b.id]]);
      const fresh = panelStore();
      assert.equal(fresh.dispatch(linkAction(fresh.getModel(), PANEL, d.link)).ok, true);
      assert.equal(encodeSynthLink(linkOf(fresh.getModel(), PANEL, 'init')), hash,
        `${a.id} > ${b.id} reopens`);
      pairs += 1;
    }
  }
  assert.ok(pairs >= 120, `${pairs} pairs`);
});

test('a link applied to a patched panel reopens the sender\'s patch, not the receiver\'s', () => {
  const sender = panelStore();
  sender.dispatch(presetAction(sender.getModel(), PANEL, 'lead').action);
  patch(sender, 'mg.control', 'vco1.fm');
  const link = linkOf(sender.getModel(), PANEL, 'lead');
  const receiver = panelStore();
  patch(receiver, 'mg.control', 'lpf.frequency');
  patch(receiver, 'noise.audio', 'mix.in1');
  const done = receiver.dispatch(linkAction(receiver.getModel(), PANEL, link));
  assert.equal(done.ok, true, done.reason);
  const got = receiver.getModel();
  assert.deepEqual(linkOf(got, PANEL, 'lead'), link);
  for (const jack of ['lpf.frequency', 'mix.in1', 'vco1.fm', 'vco2.fm']) {
    assert.deepEqual(into(got, jack), into(sender.getModel(), jack), jack);
  }
  assert.equal(jackState(got, PANEL, 'lpf.frequency'), 'normalled');
});

// ------------------------------------------------------------------ presets (P1)

test('every preset writes its values and amounts, and differs from Init', () => {
  const init = presetValues(PANEL, presetOf('init'));
  for (const p of PRESETS) {
    const st = panelStore();
    // From a panel off every preset (no preset sets Noise to 0.33), so each write shows.
    // An engine preset starts from its engine at Level 3.3 (no preset sets it).
    const [om, ok, ov] = p.engine ? [p.engine, 'level', 3.3] : ['mix', 'level3', 0.33];
    st.dispatch({ type: 'NODE_PARAM_SET', nodeId: nodeOf(st.getModel(), om).id,
      key: ok, value: ov });
    const before = st.debugInfo().undoDepth;
    const done = st.dispatch(presetAction(st.getModel(), PANEL, p.id).action);
    assert.equal(done.ok, true, done.reason);
    assert.equal(st.debugInfo().undoDepth, before + 1, `${p.id}: one undo entry`);
    assert.equal(st.undoLabel(), `Preset ${p.title.split(':')[0]}`);
    const m = st.getModel();
    const want = presetValues(PANEL, p);
    // A preset sets its own tab's modules (presets.js): a Panel preset the panel, an engine
    // preset its engine.
    const own = (mod) => mod && mod.tab === p.tab && (!p.engine || mod.id === p.engine);
    for (const mod of PANEL.modules) {
      const n = nodeOf(m, mod.id);
      if (mod.def.maxInstances === 1 || !own(mod)) continue;
      for (const [k, v] of Object.entries(want[mod.id])) {
        assert.deepEqual(n.params[k], v, `${p.id} ${mod.id}.${k}`);
      }
    }
    for (const a of PANEL.amounts) {
      if (!own(PANEL.module(a.module))) continue;
      const depths = new Set(a.to.flatMap((t) => into(m, t))
        .filter((x) => x.startsWith(`${a.source}@`)).map((x) => Number(x.split('@')[1])));
      assert.deepEqual([...depths], [p.amounts[a.id] ?? 0], `${p.id} amount ${a.id}`);
    }
    // An engine preset also chooses the engine the keys play ('kit' is Percussion at its
    // init values), so the three-knob rule is the Panel tab's.
    if (p.id !== 'init' && p.tab === 'panel') {
      const diff = Object.entries(p.values).filter(([k, v]) => {
        const [mid, key] = k.split('.');
        return init[mid][key] !== v;
      });
      assert.ok(diff.length >= 3, `${p.id} changes at least three knobs from Init`);
    }
  }
});

// ------------------------------------------------------------------ Studio edits (P2)

test('a Studio edge into a normalled jack is shown as sounding with the normal', () => {
  const st = panelStore();
  const lfo = st.getModel().graph.nodes.find((n) => n.type === 'lfo' && !n.metadata.panel);
  assert.ok(lfo, 'the reference template has an LFO');
  st.dispatch({ type: 'EDGE_ADD', from: { node: lfo.id, port: 'control' },
    to: { node: nodeOf(st.getModel(), 'lpf').id, port: 'frequency' } });
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'mixed');
  const r = breakNormals(st.getModel(), PANEL, 'lpf.frequency');
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(jackState(st.getModel(), PANEL, 'lpf.frequency'), 'patched');
  // A panel-to-panel edge added in Studio over live normals is mixed too.
  const s2 = panelStore();
  s2.dispatch({ type: 'EDGE_ADD', from: { node: nodeOf(s2.getModel(), 'eg1').id,
    port: 'control' }, to: { node: nodeOf(s2.getModel(), 'lpf').id, port: 'frequency' } });
  assert.equal(jackState(s2.getModel(), PANEL, 'lpf.frequency'), 'mixed');
});

test('a Keys node deleted in Studio: Insert reuses the surviving modules', () => {
  const st = panelStore();
  st.dispatch({ type: 'NODE_REMOVE', nodeIds: ['semi-mono-1-keys'] });
  const r = st.dispatch(PANEL.instantiate(st.getModel()));
  assert.equal(r.ok, true, r.reason);
  const m = st.getModel();
  // Every module but the one-per-Studio Master Output is a panel node.
  assert.equal(m.graph.nodes.filter((n) => n.metadata.panel).length,
    PANEL.modules.filter((x) => x.def.maxInstances !== 1).length);
  assert.ok(panelEdges(m, PANEL).normals.has('n1') && panelEdges(m, PANEL).normals.has('n23'));
});

test('Insert names the Master feed it takes; an inserted panel takes nothing more', () => {
  for (const { id } of listTemplates()) {
    const m = templateModel(id);
    const cuts = PANEL.cutsOf(m);
    const fed = m.graph.edges.some((e) => m.graph.nodes.find((n) => n.id === e.to.node).type
      === 'master');
    assert.equal(cuts.length > 0, fed, id);
  }
  const st = panelStore();
  assert.deepEqual(PANEL.cutsOf(st.getModel()), []);
});

// ------------------------------------------------------------------ transport (P2)

function transportOn(model) {
  const { fx, engine } = engineEnv();
  const runtime = createStudioRuntime({ engine });
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  return { fx, runtime, store, transport };
}

test('arming closes the Keys-gated envelopes; PLAY while armed plays the whole document', () => {
  const st = panelStore();
  const s = transportOn(st.getModel());
  assert.equal(s.transport.arm().ok, true);
  const ids = PANEL.resolve(st.getModel());
  assert.deepEqual(new Set(s.transport.debugInfo().gatedEnvelopes),
    new Set([ids.get('eg1').id, ids.get('eg2').id]));
  assert.equal(s.transport.armed, true);
  const r = s.transport.start({ position: 0 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(s.transport.armed, false, 'PLAY promotes the armed transport');
  assert.equal(s.runtime.nodes.size, st.getModel().graph.nodes.length);
});

test('the armed model never crosses Master into the document', () => {
  // The store holds one edge into Master; liveModel is a pure function of any model, so the
  // guard is proved on a model whose Master also hears a document source (as a multi-input
  // Master or a hand-edited file would): without it the source would play while armed.
  const m = panelStore().getModel();
  const master = m.graph.nodes.find((n) => n.type === 'master');
  const doc = m.graph.nodes.find((n) => n.type === 'oscillator' && !n.metadata.panel);
  assert.ok(doc, 'the reference template has an oscillator');
  const wide = { ...m, graph: { ...m.graph, edges: [...m.graph.edges, { id: 'x-edge',
    from: { node: doc.id, port: 'audio' }, to: { node: master.id, port: 'audio' },
    props: { muted: false } }] } };
  const live = liveModel(wide);
  assert.equal(live.graph.nodes.some((n) => n.id === doc.id), false,
    'a document source behind Master stays out of the armed model');
  assert.ok(live.graph.nodes.some((n) => n.id === master.id));
});

test('opening the Synth inserts by itself only over the untouched reference document', async () => {
  const { insertDecision } = await import('../../src/js/synth/ui.js');
  const ref = templateModel('subtractive-synth');
  const r = insertDecision(ref, PANEL);
  assert.equal(r.auto, true, 'the untouched reference: nothing of the user\'s is cut');
  assert.equal(r.cuts.length, 1, 'and the notice names the feed it takes');
  const st = createStudioStore(ref, { idGenerator: createIdGenerator(ref) });
  const filter = ref.graph.nodes.find((n) => n.type === 'filter');
  st.dispatch({ type: 'NODE_PARAM_SET', nodeId: filter.id, key: 'frequency', value: 777 });
  assert.equal(insertDecision(st.getModel(), PANEL).auto, false,
    'an edited document whose chain feeds Master waits for Insert');
  for (const { id } of listTemplates()) {
    const m = templateModel(id);
    const d = insertDecision(m, PANEL);
    assert.equal(d.auto, id === 'subtractive-synth' || d.cuts.length === 0, id);
  }
});
