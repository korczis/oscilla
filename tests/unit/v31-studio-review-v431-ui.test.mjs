// V431 review follow-ups in the Studio UI layer (docs/v31/review-v431.md #14, A5/X3): a cable
// that carries nothing is drawn and labelled as such, with the compiler's own reason (§237).
//   node --test tests/unit/v31-studio-review-v431-ui.test.mjs
// Rules, one test each:
//   no-route   the compiled plan has no Web Audio route (an offline-only or unavailable end)
//   Q          LFO → Filter Q on a low-pass / high-pass filter is not applied by the adapter
//   gain       Filter gain modulation on any type but peaking is ignored by Web Audio
// Parity: the UI's verdict equals the real runtime's inactive edges (same ids, same reason) on
// a fake AudioContext, so the drawing cannot disagree with what plays.
// Tolerances: none (plain data and text).

import test from 'node:test';
import assert from 'node:assert';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { FILTER_TYPES } from '../../src/js/audio/filters.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { compileStudio } from '../../src/js/studio/compiler.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { cableCross } from '../../src/js/ui/studio/graph-geometry.js';
import {
  FILTER_Q_NOT_APPLIED, compiledEdgeStatus, edgeEffectReason, edgeRoute, edgeView,
  nodeConnections,
} from '../../src/js/ui/studio/graph-view.js';
import { inspectorView } from '../../src/js/ui/studio/inspector.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

/** What the workspace compiles against: a realtime engine with a microphone API. */
const ENGINE = { isSupported: () => true,
  _env: { navigator: { mediaDevices: { getUserMedia() {} } } } };

function build(fn) {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const ok = (r) => {
    assert.ok(r.ok, r.reason || JSON.stringify(r.errors));
    return r;
  };
  const add = (nodeType, params) => {
    const id = ok(store.dispatch({ type: 'NODE_ADD', nodeType, position: { x: 0, y: 0 } }))
      .created.nodes[0];
    for (const [key, value] of Object.entries(params || {})) {
      ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: id, key, value }));
    }
    return id;
  };
  const connect = (a, ap, b, bp, props) => ok(store.dispatch({ type: 'EDGE_ADD',
    from: { node: a, port: ap }, to: { node: b, port: bp }, props })).created.edges[0];
  const ids = fn({ add, connect, store });
  return { store, model: store.getModel(), ids };
}

function routesOf(model) {
  const status = compiledEdgeStatus(compileStudio(model, { engine: ENGINE }));
  const out = new Map();
  for (const e of model.graph.edges) {
    out.set(e.id, edgeRoute(model, e, { status: status.get(e.id) }));
  }
  return { status, routes: out };
}

/** The runtime's inactive edges on a fake AudioContext: Map id -> reason. */
function runtimeInactive(model) {
  const fx = createFakeAudioEnv({ sampleRate: 48000, navigator: ENGINE._env.navigator });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  runtime.apply(model);
  assert.strictEqual(runtime.start().ok, true);
  const out = new Map(runtime.debugInfo().inactiveEdges.map((x) => [x.id, x.reason]));
  runtime.stop();
  return out;
}

test('V431 A5/X3 no-route: an offline-only or unavailable end is drawn without a route', () => {
  const { model, ids } = build(({ add, connect }) => {
    const osc = add('oscillator');
    const master = add('master');
    const rec = add('recorder');
    const mic = add('microphone');
    const spec = add('spectrum');
    return { live: connect(osc, 'audio', master, 'audio'),
      rec: connect(osc, 'audio', rec, 'audio'), mic: connect(mic, 'audio', spec, 'audio'),
      osc };
  });
  const { status, routes } = routesOf(model);
  assert.equal(routes.get(ids.live).state, 'live');
  for (const id of [ids.rec, ids.mic]) {
    const r = routes.get(id);
    assert.equal(r.state, 'no-route', id);
    assert.equal(r.reason, status.get(id).reason);
    assert.match(r.text, /^No Web Audio route: /);
  }
  assert.match(routes.get(ids.rec).reason, /Recorder\/Export 1 is offline only/);
  assert.match(routes.get(ids.mic).reason, /Microphone 1 is unavailable/);
  // The cable view: inactive, out of the live style, its label gives the reason.
  const e = model.graph.edges.find((x) => x.id === ids.rec);
  const v = edgeView(model, e, { status: status.get(ids.rec) });
  assert.equal(v.inactive, true);
  assert.equal(v.route, 'no-route');
  assert.match(v.ariaLabel, new RegExp('^Connection from Oscillator 1 audio to Recorder/Export 1 '
    + 'input\\. No Web Audio route: Recorder/Export 1 is offline only'));
  assert.equal(v.title, v.ariaLabel);
  const live = edgeView(model, model.graph.edges.find((x) => x.id === ids.live),
    { status: status.get(ids.live) });
  assert.equal(live.inactive, false);
  assert.equal(live.ariaLabel, 'Connection from Oscillator 1 audio to Master Output 1 input');
  // The node Inspector's connection list and the connection Inspector say it too.
  const conns = nodeConnections(model, ids.osc, NODE_REGISTRY, status);
  assert.deepEqual(conns.map((c) => c.route), ['live', 'no-route']);
  assert.match(conns[1].text, /\(no Web Audio route\)$/);
  const insp = inspectorView(model, { edges: [ids.rec] }, { edgeStatus: status });
  assert.equal(insp.route, 'no-route');
  assert.match(insp.routeText, /^No Web Audio route: Recorder\/Export 1 is offline only/);
  // Without the plan's verdict nothing is claimed.
  assert.equal(edgeRoute(model, e, {}).state, 'live');
  // Parity with what plays: the runtime leaves the same edges unrouted, for the same reason.
  const rt = runtimeInactive(model);
  assert.deepEqual([...rt.keys()].sort(), [ids.mic, ids.rec].sort());
  for (const id of [ids.rec, ids.mic]) assert.equal(rt.get(id), routes.get(id).reason);
});

test('V431 A5/X3 Q: LFO → Q on a low-pass or high-pass filter has no audible effect', () => {
  for (const type of FILTER_TYPES) {
    const { model, ids } = build(({ add, connect }) => {
      const osc = add('oscillator');
      const f = add('filter', { type });
      const master = add('master');
      const lfo = add('lfo');
      connect(osc, 'audio', f, 'audio');
      connect(f, 'audio', master, 'audio');
      return { q: connect(lfo, 'control', f, 'Q', { depth: 0.5 }),
        cutoff: connect(lfo, 'control', f, 'frequency'), f };
    });
    const { routes, status } = routesOf(model);
    const notApplied = type === 'lowpass' || type === 'highpass';
    const q = routes.get(ids.q);
    assert.equal(q.state, notApplied ? 'no-effect' : 'live', type);
    assert.equal(routes.get(ids.cutoff).state, 'live', type);
    if (notApplied) {
      assert.equal(q.reason, FILTER_Q_NOT_APPLIED);
      assert.match(q.text, /^No audible effect: /);
      const insp = inspectorView(model, { edges: [ids.q] }, { edgeStatus: status });
      assert.equal(insp.route, 'no-effect');
      const node = inspectorView(model, { nodes: [ids.f] }, { edgeStatus: status });
      assert.match(node.fields.find((x) => x.key === 'Q').modulatedBy[0],
        /\(no audible effect\)$/);
    }
    // Parity: the runtime leaves exactly this edge inactive, with the adapter's reason.
    const rt = runtimeInactive(model);
    assert.deepEqual([...rt.keys()], notApplied ? [ids.q] : [], type);
    if (notApplied) assert.equal(rt.get(ids.q), q.reason);
  }
});

test('V431 A5/X3 gain: Filter gain modulation is heard on a peaking filter only', () => {
  for (const type of FILTER_TYPES) {
    const { model, ids } = build(({ add, connect }) => {
      const f = add('filter', { type });
      const lfo = add('lfo');
      return { g: connect(lfo, 'control', f, 'gain') };
    });
    const e = model.graph.edges.find((x) => x.id === ids.g);
    const why = edgeEffectReason(model, e);
    if (type === 'peaking') {
      assert.equal(why, null);
      assert.equal(routesOf(model).routes.get(ids.g).state, 'live');
    } else {
      assert.match(why, /^Filter gain applies to peaking only; a .+ filter ignores it\.$/);
      assert.equal(routesOf(model).routes.get(ids.g).state, 'no-effect', type);
    }
  }
  // Rules apply to parameter inputs only: the filter's audio input is never "no effect".
  const { model } = build(({ add, connect }) => {
    const osc = add('oscillator');
    const f = add('filter', { type: 'lowpass' });
    connect(osc, 'audio', f, 'audio');
    return {};
  });
  assert.equal(edgeEffectReason(model, model.graph.edges[0]), null);
});

test('V431 A5/X3: the cross of an inactive cable sits on the cable midpoint', () => {
  // cablePath's cubic has mirrored control points, so its t = 0.5 point is the ends' midpoint.
  assert.equal(cableCross(0, 0, 100, 40), 'M 45 15 L 55 25 M 45 25 L 55 15');
  assert.equal(cableCross(10, 10, 10, 10, 2), 'M 8 8 L 12 12 M 8 12 L 12 8');
});
