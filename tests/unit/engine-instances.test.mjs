// K188 (connected-instrument#engines; pack 06 section C, "never let a single-node preset secretly
// reset sibling modules"): two instances of one engine type are independent in the document, the
// model and the runtime, and a whole-panel preset never touches the engine-tab nodes unless it
// is the { all: true } reset a link applies (synth/presets.js header, synth/link.js linkAction).
//
// No offline render of one engine node exists (adapters/engines.js additivePartials is a table,
// not a render), so an engine's output is compared through the engine fixture: the adapter on
// the fake context (engine-fixture.mjs engineEnv), its parameters and voice census read back,
// and the fake nodes one note builds (kind, waveform, every AudioParam event) as its signature.
//
// Each check is a function run twice: on the real fixture it passes, and on a fixture with one
// deliberate shared-state mutation (a type-keyed parameter write, one voice host for two nodes,
// one runtime handle for two ids, a preset patch over every module) it must fail, so every
// case is mutation-proven in this file. This is the instantiation check the voice wrapper
// (K191) keeps green; the file stays K188's.
//   node --test tests/unit/engine-instances.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import PANEL from '../../src/js/synth/panels/semi-mono.js';
import { PRESETS, presetAction } from '../../src/js/synth/presets.js';
import { linkAction, linkOf } from '../../src/js/synth/link.js';
import { nodePresetAction, nodePresets } from '../../src/js/studio/node-presets.js';
import { NODE_ADAPTERS } from '../../src/js/studio/adapters/nodes.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { defaults, engineEnv } from './engine-fixture.mjs';
import { panelStore } from './synth-fixture.mjs';

const TYPE = 'fm-voice';
const EDIT = { key: 'ratio2', value: 7 };
const NOTE = { t: 0.5, note: 64, velocity: 100 };
const FM_BELL = () => nodePresets(TYPE).find((e) => e.id === 'engine-fm-bell');

// ------------------------------------------------------------------ the output signature

const isParam = (v) => v && typeof v === 'object' && Array.isArray(v.calls)
  && Array.isArray(v.events);

/** The fake nodes `ctx` created from index `from` on: kind, waveform and every param's calls. */
function signature(ctx, from) {
  return ctx.created.slice(from).map((n) => ({
    kind: n.kind,
    type: n.kind === 'oscillator' ? n.type : undefined,
    params: Object.fromEntries(Object.entries(n).filter(([, v]) => isParam(v))
      .map(([k, v]) => [k, v.calls])),
  }));
}

/** What one note on `h` builds on its context. */
function noteSignature(ctx, h, { t, note, velocity } = NOTE) {
  const from = ctx.created.length;
  h.noteOn(t, note, velocity);
  return signature(ctx, from);
}

/** The reference: `params` on a context of their own, one note, nothing else. */
function soloSignature(params, sampleRate = 48000) {
  const { ctx, h } = engineEnv(TYPE, params, { sampleRate });
  return noteSignature(ctx, h);
}

// ------------------------------------------------------------------ fixtures

/** A second engine adapter on the context of an engineEnv, with its own census. */
function siblingOn(env, params = {}, id = 'n2') {
  const nodes = new Set();
  const acct = {
    track: (n) => { nodes.add(n); return n; },
    source: (n) => {
      nodes.add(n);
      n.addEventListener('ended', () => nodes.delete(n));
      return n;
    },
    untrack: (n) => nodes.delete(n),
  };
  const p = { ...defaults(TYPE), ...params };
  const h = NODE_ADAPTERS[TYPE].create({ ctx: env.ctx, hooks: {
    ctx: env.ctx,
    oscillator(type, f, at) {
      const o = env.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, env.ctx.currentTime);
      o.start(at);
      return o;
    },
    clampFrequency: (f) => Math.min((env.ctx.sampleRate / 2) * 0.95, f),
  }, acct, at: 0, now: 0, params: p, node: { id, type: TYPE, params: p },
  def: NODE_REGISTRY.get(TYPE) });
  return { h, nodes, params: p };
}

/** Two fm-voice adapters on one fake context. `shared`: B is A's handle (the mutant). */
function adapterPair({ shared = false } = {}) {
  const a = engineEnv(TYPE);
  const b = shared ? { h: a.h, nodes: a.nodes, params: a.params } : siblingOn(a);
  return { ctx: a.ctx, a: { h: a.h, nodes: a.nodes, params: a.params }, b };
}

/** A Studio store with two fm-voice nodes. `typeKeyed`: a parameter write reaches every node
 * of the edited node's type (the mutant: parameters kept per type, not per node). */
function twoNodeStore({ typeKeyed = false } = {}) {
  const st = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const add = () => {
    const r = st.dispatch({ type: 'NODE_ADD', nodeType: TYPE, position: { x: 0, y: 0 } });
    assert.equal(r.ok, true, r.reason);
    return r.created.nodes[0];
  };
  const ids = [add(), add()];
  if (!typeKeyed) return { st, ids };
  const dispatch = (a) => {
    const r = st.dispatch(a);
    if (a.type !== 'NODE_PARAM_SET' && a.type !== 'PATCH_REPLACE') return r;
    const node = st.getModel().graph.nodes.find((n) => n.id === (a.nodeId
      || Object.values(a.onto)[0]));
    for (const n of st.getModel().graph.nodes) {
      if (n.type !== node.type || n.id === node.id) continue;
      for (const [key, value] of Object.entries(node.params)) {
        if (n.params[key] === value) continue;
        st.dispatch({ type: 'NODE_PARAM_SET', nodeId: n.id, key, value });
      }
    }
    return r;
  };
  return { st: { ...st, getModel: st.getModel, dispatch }, ids };
}

/** Two fm-voice nodes through a Mixer into the Master Output, running on the real AudioEngine
 * (fake context).
 * `shared`: the runtime view answers B's id with A's handle (the mutant). */
function twoNodeRuntime({ shared = false } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: 48000, holdSupported: true });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  const runtime = createStudioRuntime({ engine });
  const { st, ids } = twoNodeStore();
  const add = (nodeType) => st.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 400, y: 0 } })
    .created.nodes[0];
  const mix = add('mixer');
  const master = add('master');
  const edge = (from, fp, to, tp) => assert.equal(st.dispatch({ type: 'EDGE_ADD',
    from: { node: from, port: fp }, to: { node: to, port: tp } }).ok, true, `${from} -> ${to}`);
  ids.forEach((id, i) => edge(id, 'audio', mix, `in${i + 1}`));
  edge(mix, 'audio', master, 'audio');
  assert.equal(runtime.apply(st.getModel()).ok, true, 'apply');
  assert.equal(runtime.start().ok, true, 'start');
  const handleOf = (id) => runtime.nodes.get(shared ? ids[0] : id);
  return { fx, ctx: fx.ctx, runtime, st, ids, handleOf };
}

const paramsOf = (model, id) => model.graph.nodes.find((n) => n.id === id).params;

// ------------------------------------------------------------------ the checks

/** Model: an edit and a node preset on A leave B's parameters deep-equal. */
function checkModel({ st, ids: [a, b] }) {
  const before = structuredClone(paramsOf(st.getModel(), b));
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: a, ...EDIT }).ok, true);
  assert.equal(paramsOf(st.getModel(), a)[EDIT.key], EDIT.value);
  assert.deepEqual(paramsOf(st.getModel(), b), before, 'an edit on A leaves B');
  const r = nodePresetAction(st.getModel(), a, FM_BELL());
  assert.deepEqual(r.action.onto, { [FM_BELL().patch.graph.nodes[0].id]: a }, 'onto A only');
  assert.equal(st.dispatch(r.action).ok, true);
  assert.equal(paramsOf(st.getModel(), a).ratio2, 3.5, 'the preset reached A');
  assert.deepEqual(paramsOf(st.getModel(), b), before, 'a node preset on A leaves B');
}

/** Adapter: an update, a note and a preset's values on A leave B's parameters, census and
 * output (its next note's signature, against B alone on a context of its own). */
function checkAdapters({ ctx, a, b }) {
  const solo = soloSignature(b.params);
  const paramsB = structuredClone(b.params);
  a.h.update({ [EDIT.key]: EDIT.value }, new Set(), null);
  a.h.update(FM_BELL().patch.graph.nodes[0].params, new Set(), null);
  const voicesB = b.h.info.voices(NOTE.t);
  const nodesB = b.nodes.size;
  a.h.noteOn(0.1, 60, 100);
  assert.equal(a.h.info.voices(0.1), 1, 'A sounds its note');
  assert.equal(b.h.info.voices(0.1), voicesB, "A's note takes none of B's voices");
  assert.equal(b.nodes.size, nodesB, "A's note builds nothing in B's census");
  assert.deepEqual(b.params, paramsB, "B's parameters are unchanged");
  assert.deepEqual(noteSignature(ctx, b.h), solo, "B's next note is B's, as if A were absent");
  assert.equal(b.h.info.voices(NOTE.t), voicesB + 1);
  assert.equal(a.h.info.voices(NOTE.t), 1, "B's note takes none of A's voices");
}

/** Runtime: a note on A's handle and an applied edit on A leave B's handle, voices and output. */
function checkRuntime({ ctx, runtime, st, ids: [a, b], handleOf }) {
  const hb = handleOf(b);
  assert.ok(handleOf(a) && hb && typeof hb.noteOn === 'function', 'both are note sources');
  const t = ctx.currentTime + 0.5;
  handleOf(a).noteOn(t, 60, 100);
  assert.equal(handleOf(a).info.voices(t), 1, 'A sounds its note');
  assert.equal(hb.info.voices(t), 0, "A's note takes none of B's voices");
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: a, ...EDIT }).ok, true);
  assert.equal(runtime.apply(st.getModel()).ok, true, 'apply the edit while running');
  assert.equal(handleOf(b), hb, "B's handle is kept: the edit is not B's");
  const from = ctx.created.length;
  hb.noteOn(t + 0.1, NOTE.note, NOTE.velocity);
  const got = signature(ctx, from);
  assert.ok(got.length > 0, "B's note builds its voice");
  const osc = got.filter((n) => n.kind === 'oscillator')
    .map((n) => n.params.frequency[0][1]);
  const ref = soloSignature(paramsOf(st.getModel(), b)).filter((n) => n.kind === 'oscillator')
    .map((n) => n.params.frequency[0][1]);
  assert.deepEqual(osc, ref, "B's operators run at B's ratios, not A's edited one");
  assert.equal(hb.info.voices(t + 0.1), 1, 'B sounds its own note only');
}

/** The panel: a preset of module scope (`id`) changes only its own modules; every engine-tab
 * node outside its scope is deep-equal before and after, and so are free fm-voice nodes. */
function checkPanelPreset(st, id, { all = false } = {}) {
  const free = st.dispatch({ type: 'NODE_ADD', nodeType: TYPE, position: { x: 0, y: 1400 } })
    .created.nodes[0];
  const res = PANEL.resolve(st.getModel());
  const p = PRESETS.find((x) => x.id === id);
  const fm = res.get('fm').id;
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: fm, ...EDIT }).ok, true);
  assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: free, key: 'ratio2', value: 5 })
    .ok, true);
  const before = structuredClone(st.getModel());
  const r = presetAction(before, PANEL, id, { all });
  assert.equal(r.action.type, 'PATCH_REPLACE');
  assert.equal(st.dispatch(r.action).ok, true, id);
  const after = st.getModel();
  const engineTab = PANEL.modulesOf('engines').map((m) => m.id);
  for (const mid of engineTab) {
    if (p.engine === mid) continue;
    assert.deepEqual(paramsOf(after, res.get(mid).id), paramsOf(before, res.get(mid).id),
      `${id}: engine-tab ${mid} untouched`);
  }
  assert.deepEqual(paramsOf(after, free), paramsOf(before, free), `${id}: a free ${TYPE} too`);
  for (const m of PANEL.modules) {
    const inScope = m.def.maxInstances !== 1 && m.tab === p.tab
      && (!p.engine || m.id === p.engine);
    if (!inScope) {
      assert.deepEqual(paramsOf(after, res.get(m.id).id), paramsOf(before, res.get(m.id).id),
        `${id}: ${m.id} is outside the preset's scope`);
    }
  }
  return { before, after, res, free };
}

// ------------------------------------------------------------------ the cases

test('model: an edit and a node preset on one fm-voice leave the other\'s parameters', () => {
  checkModel(twoNodeStore());
  assert.throws(() => checkModel(twoNodeStore({ typeKeyed: true })), /leaves B/,
    'mutation-proven: type-keyed parameters fail it');
});

test('adapters: an edit, a note and a preset on one leave the other\'s params, voices, output',
  () => {
    checkAdapters(adapterPair());
    assert.throws(() => checkAdapters(adapterPair({ shared: true })), /B's voices|B's census/,
      'mutation-proven: one voice host for two nodes fails it');
  });

test('adapters: the output check sees a leaked edit (B built on A\'s edited parameters)', () => {
  const pair = adapterPair();
  const leaked = siblingOn({ ctx: pair.ctx }, { [EDIT.key]: EDIT.value });
  assert.throws(() => assert.deepEqual(noteSignature(pair.ctx, leaked.h),
    soloSignature(pair.b.params)), 'the signature tells ratio2 7 from the default');
});

test('runtime: a note and an applied edit on one fm-voice leave the other\'s handle and voices',
  () => {
    checkRuntime(twoNodeRuntime());
    assert.throws(() => checkRuntime(twoNodeRuntime({ shared: true })), /B's voices/,
      'mutation-proven: one runtime handle for two ids fails it');
  });

test('panel: a panel preset and an engine preset change only their modules', () => {
  // The panel tab's preset leaves every engine-tab node and a free fm-voice deep-equal.
  for (const id of PRESETS.filter((p) => p.tab === 'panel').map((p) => p.id)) {
    checkPanelPreset(panelStore(), id);
  }
  // An engine preset sets its engine's module only: the other engines and the panel stay.
  for (const id of PRESETS.filter((p) => p.tab === 'engines').map((p) => p.id)) {
    const { after, res } = checkPanelPreset(panelStore(), id);
    const p = PRESETS.find((x) => x.id === id);
    for (const [k, v] of Object.entries(p.values)) {
      const [mid, key] = k.split('.');
      assert.deepEqual(paramsOf(after, res.get(mid).id)[key], v, `${id}: ${k}`);
    }
  }
  // Mutation-proven: the same check over a patch of every module (scope widened) fails it.
  assert.throws(() => checkPanelPreset(panelStore(), 'bass', { all: true }), /engine-tab/);
});

test('panel: { all: true } resets the engine tabs by design, one PATCH_REPLACE, one undo entry',
  () => {
    const st = panelStore();
    const res = PANEL.resolve(st.getModel());
    const fm = res.get('fm').id;
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: fm, ...EDIT }).ok, true);
    const free = st.dispatch({ type: 'NODE_ADD', nodeType: TYPE, position: { x: 0, y: 1400 } })
      .created.nodes[0];
    assert.equal(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: free, ...EDIT }).ok, true);
    const before = structuredClone(st.getModel());
    const r = presetAction(before, PANEL, 'bass', { all: true });
    assert.equal(r.action.type, 'PATCH_REPLACE');
    const covered = new Set(r.action.patch.graph.nodes.map((n) => n.metadata.panel.module));
    for (const mid of PANEL.modulesOf('engines').map((m) => m.id)) {
      assert.ok(covered.has(mid), `{ all: true } covers engine-tab ${mid}`);
    }
    assert.ok(!Object.values(r.action.onto).includes(free), 'never a node off the panel');
    const depth = st.debugInfo().undoDepth;
    assert.equal(st.dispatch(r.action).ok, true);
    assert.equal(st.debugInfo().undoDepth, depth + 1, 'one history entry');
    assert.equal(paramsOf(st.getModel(), fm).ratio2, defaults(TYPE).ratio2,
      'the engine tab is reset to its init values');
    assert.deepEqual(paramsOf(st.getModel(), free), paramsOf(before, free),
      'a free fm-voice is not the panel\'s: { all: true } leaves it');
    // A link reopens the whole instrument through exactly this one PATCH_REPLACE step.
    const link = linkOf(before, PANEL, 'bass');
    const steps = linkAction(panelStore().getModel(), PANEL, link).steps;
    const replaces = steps.filter((s) => s.type === 'PATCH_REPLACE');
    assert.equal(replaces.length, 1, 'one PATCH_REPLACE step in a link');
    assert.equal(replaces[0].patch, presetAction(before, PANEL, 'bass', { all: true }).action.patch,
      'the link uses the { all: true } patch');
  });
