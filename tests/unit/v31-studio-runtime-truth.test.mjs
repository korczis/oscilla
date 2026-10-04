// Studio runtime truth as data (ADR 0039, docs/v31/compiler.md "Diagnostics", "Plan identity",
// "Applied record", "Divergence"): one diagnostic shape with machine codes across validation,
// compiler, runtime and transport; a deterministic planHash; the runtime's applied record, set
// only when a transaction commits; one pure divergence verdict over desired model and applied
// record; and transport.sync no longer adopting a model the runtime refused.
//   node --test tests/unit/v31-studio-runtime-truth.test.mjs
// Wiring: the real AudioEngine over the fake AudioContext of sequencer-fake-audio.mjs, as in
// v431-studio-refused-edit.test.mjs; createBiquadFilter is made to throw once to refuse a
// transaction in its prepare phase. Namespace imports: each test fails on its own assertion on
// the code before this change, not the whole file on a missing export.
// Tolerances: none (identity, codes, hashes and counts).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import * as compiler from '../../src/js/studio/compiler.js';
import * as runtimeModule from '../../src/js/studio/runtime.js';
import { studioHash } from '../../src/js/studio/schema.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { validateStudioImport, validateStudioModel } from '../../src/js/studio/validate.js';
import * as workspace from '../../src/js/ui/studio/workspace.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const ADD_FILTER = { type: 'NODE_ADD', nodeType: 'filter', position: { x: 40, y: 40 } };
const OWNERS = ['validate', 'compiler', 'runtime', 'transport'];
const HEX64 = /^[0-9a-f]{64}$/;
/** A navigator whose microphone API exists (the permission is the runtime option). */
const MIC_NAVIGATOR = { mediaDevices: { getUserMedia: () => new Promise(() => {}) } };

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

function audio({ navigator, options } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: SR, navigator });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { fx, engine, runtime: runtimeModule.createStudioRuntime({ engine, options }) };
}

/** A store that commits first (no gate) with a transport on it, synced only when asked. */
function ungated(model = templateModel(REFERENCE_TEMPLATE_ID)) {
  const a = audio();
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store });
  return { ...a, store, transport };
}

/** The next createBiquadFilter on the fake context throws (one shot). */
function failNextBiquad(ctx) {
  const own = Object.prototype.hasOwnProperty.call(ctx, 'createBiquadFilter');
  const original = ctx.createBiquadFilter;
  ctx.createBiquadFilter = function failing() {
    if (own) ctx.createBiquadFilter = original;
    else delete ctx.createBiquadFilter;
    throw new Error('injected biquad failure');
  };
}

/** Every key of the shared shape, owner in the canonical set, entity null or { kind, id }. */
function assertDiagnostic(d, owner, code) {
  assert.equal(typeof d, 'object', `a diagnostic, not ${JSON.stringify(d)}`);
  for (const k of ['code', 'severity', 'owner', 'entity', 'message']) {
    assert.ok(k in d, `${k} in ${JSON.stringify(d)}`);
  }
  assert.ok(OWNERS.includes(d.owner), d.owner);
  assert.equal(d.owner, owner);
  if (code) assert.equal(d.code, code);
  assert.ok(['error', 'warning'].includes(d.severity));
  assert.ok(d.entity === null || (typeof d.entity.kind === 'string'
    && typeof d.entity.id === 'string'), JSON.stringify(d.entity));
  assert.equal(typeof d.message, 'string');
}

const nodeCode = (plan, id) => plan.nodes.get(id).code;
const edgeTo = (plan, to) => [...plan.edges.values()].find((e) => e.to.node === to);

// ---------------------------------------------------------------- diagnostics

test('validation and compiler: one diagnostic shape, and every status reason has a code', () => {
  // Validation keeps its compatibility fields and gains owner and entity.
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId: 'edge-3' }));
  const w = validateStudioModel(store.getModel()).warnings
    .find((d) => d.code === 'unreachable-output');
  assertDiagnostic(w, 'validate', 'unreachable-output');
  assert.deepEqual(w.entity, { kind: 'node', id: w.nodeId });
  assert.equal(typeof w.path, 'string');
  const imported = validateStudioImport('{"kind":"nonsense"}');
  assert.equal(imported.ok, false);
  assertDiagnostic(imported.errors[0], 'validate');
  const broken = compiler.compileStudio({ nonsense: true }).errors[0];
  assertDiagnostic(broken, 'compiler', 'invalid-structure');

  // Compiler: machine codes beside the display reason; null where there is no reason.
  const m = templateModel(MEASUREMENT_TEMPLATE_ID);
  const noMic = compiler.compileStudio(m, { engine: audio().engine });
  assert.equal(noMic.nodes.get('mic-1').status, 'degraded');
  assert.equal(nodeCode(noMic, 'mic-1'), 'mic-unsupported');
  assert.equal(nodeCode(noMic, 'sweep-1'), null);
  assert.equal(nodeCode(noMic, 'cal-1'), null, 'a data node has no reason');
  assert.equal(edgeTo(noMic, 'cal-1').status, 'inactive');
  assert.equal(edgeTo(noMic, 'cal-1').code, 'endpoint-unavailable');
  assert.equal(edgeTo(noMic, 'master-1').code, null);
  const off = compiler.compileStudio(m, { engine: audio({ navigator: MIC_NAVIGATOR }).engine });
  assert.equal(nodeCode(off, 'mic-1'), 'mic-off');
  const on = compiler.compileStudio(m, { engine: audio({ navigator: MIC_NAVIGATOR }).engine,
    options: { inputPermission: true } });
  assert.equal(on.nodes.get('mic-1').status, 'ready');
  assert.equal(nodeCode(on, 'mic-1'), null);
  const noAudio = compiler.compileStudio(templateModel(REFERENCE_TEMPLATE_ID), {
    engine: { isSupported: () => false, _env: {} } });
  assert.equal(nodeCode(noAudio, 'osc-1'), 'no-web-audio');
  assert.equal(edgeTo(noAudio, 'env-1').code, 'endpoint-unavailable');
  // The status maps the views read carry the code too.
  const status = workspace.studioStatus(m, { engine: audio().engine });
  assert.equal(status.nodes.get('mic-1').code, 'mic-unsupported');
});

test('runtime warnings stay structured: a failed crossfade step is a coded diagnostic', () => {
  const a = audio();
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  ok(a.runtime.apply(store.getModel(), { revision: 0 }));
  ok(a.runtime.start());
  a.runtime.nodes.get('osc-1').applyBase = () => { throw new Error('boom'); };
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 330 }));
  const r = ok(a.runtime.apply(store.getModel(), { revision: 1 }));
  const w = r.warnings.find((x) => x && x.code === 'parameters-failed');
  assert.ok(w, `structured warnings, got ${JSON.stringify(r.warnings)}`);
  assertDiagnostic(w, 'runtime', 'parameters-failed');
  assert.deepEqual(w.entity, { kind: 'node', id: 'osc-1' });
  const dbg = a.runtime.debugInfo();
  assert.ok(dbg.diagnostics.some((d) => d.code === 'parameters-failed' && d.owner === 'runtime'));
  assert.ok(dbg.warnings.includes('parameters osc-1: boom'), 'the text list is derived from it');
  // A refused transaction records a runtime diagnostic, not a bare string.
  failNextBiquad(a.fx.ctx);
  ok(store.dispatch(ADD_FILTER));
  const refused = a.runtime.apply(store.getModel(), { revision: 2 });
  assert.equal(refused.ok, false);
  assertDiagnostic(refused.errors[0], 'runtime', 'prepare-failed');
  assert.equal(a.runtime.lastError.revision, 2, 'lastError names the refused revision');
  a.runtime.stop();
});

test('transport: unplayed reasons and warnings carry codes, never only prose', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const track = ok(store.dispatch({ type: 'TRACK_ADD', kind: 'event', target: 'env-1' }))
    .created.tracks[0];
  const trig = ok(store.dispatch({ type: 'CLIP_ADD', trackId: track, kind: 'event', start: 0.5,
    duration: 0.1, payload: { action: 'trigger' } })).created.clips[0];
  const a = audio();
  const warned = [];
  const transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store,
    onMeasurement: () => { throw new Error('hook broke'); } });
  transport.on((type, d) => { if (type === 'warning') warned.push(d); });
  ok(transport.start());
  const u = transport.debugInfo().unplayed.find((x) => x.id === trig);
  assert.equal(u.code, 'event-target');
  assert.equal(typeof u.reason, 'string');
  // A refused live update: a coded transport diagnostic, emitted as the 'warning' detail.
  failNextBiquad(a.fx.ctx);
  ok(store.dispatch(ADD_FILTER));
  transport.sync();
  const d = transport.debugInfo().diagnostics.at(-1);
  assertDiagnostic(d, 'transport', 'sync-refused');
  assert.equal(transport.debugInfo().warnings.at(-1), d.message);
  assert.equal(warned.at(-1), d, 'listeners get the diagnostic');
  assert.equal(transport.debugInfo().lastError.code, 'sync-refused');
  transport.stop();
});

// ---------------------------------------------------------------- plan identity

test('planHash: deterministic, blind to layout and names, sensitive to parameters, status and '
  + 'routes', () => {
  assert.equal(typeof compiler.planHash, 'function', 'compiler.js exports planHash');
  const engine = audio().engine;
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const hashOf = (m, options) => compiler.planHash(compiler.compileStudio(m, { engine, options }));
  const h0 = hashOf(store.getModel());
  assert.match(h0, HEX64);
  assert.equal(hashOf(templateModel(REFERENCE_TEMPLATE_ID)), h0, 'same model, same hash');
  assert.equal(hashOf(store.getModel()), h0, 'a second compile, the same hash');
  ok(store.dispatch({ type: 'NODE_MOVE', nodeId: 'filter-1', position: { x: 900, y: 10 } }));
  ok(store.dispatch({ type: 'NODE_RENAME', nodeId: 'filter-1', name: 'Tone' }));
  ok(store.dispatch({ type: 'METADATA_SET', title: 'Renamed' }));
  assert.equal(studioHash(store.getModel()), studioHash(model));
  assert.equal(hashOf(store.getModel()), h0, 'layout, names and metadata do not change it');
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency',
    value: 2345 }));
  const h1 = hashOf(store.getModel());
  assert.match(h1, HEX64);
  assert.notEqual(h1, h0, 'a parameter changes it');
  ok(store.dispatch({ type: 'EDGE_REMOVE', edgeId: 'edge-5' }));
  assert.notEqual(hashOf(store.getModel()), h1, 'a route changes it');
  // Same model, another capability: the microphone's status changes the plan.
  const m = templateModel(MEASUREMENT_TEMPLATE_ID);
  const micEngine = audio({ navigator: MIC_NAVIGATOR }).engine;
  const off = compiler.planHash(compiler.compileStudio(m, { engine: micEngine }));
  const on = compiler.planHash(compiler.compileStudio(m, { engine: micEngine,
    options: { inputPermission: true } }));
  assert.notEqual(on, off, 'a status (capability) change changes it');
  assert.equal(compiler.planHash(compiler.EMPTY_PLAN), null);
  assert.equal(compiler.planHash(compiler.compileStudio({ nonsense: true })), null);
});

// ---------------------------------------------------------------- applied record

test('the applied record is set only when a transaction commits; a refused edit leaves it', () => {
  const a = audio();
  assert.equal(typeof a.runtime.applied, 'function', 'runtime.applied()');
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  assert.equal(a.runtime.applied(), null, 'nothing applied yet');
  ok(a.runtime.apply(store.getModel(), { revision: 0 }));
  assert.equal(a.runtime.applied(), null, 'stopped: the plan is stored, not applied');
  ok(a.runtime.start());
  const first = a.runtime.applied();
  assert.equal(first.revision, 0);
  assert.equal(first.studioHash, studioHash(store.getModel()));
  assert.equal(first.planHash, compiler.planHash(a.runtime.plan));
  assert.match(first.planHash, HEX64);
  assert.ok(!Number.isNaN(Date.parse(first.at)) && first.at.endsWith('Z'), first.at);
  assert.deepEqual(Object.keys(first).sort(), ['at', 'planHash', 'revision', 'studioHash']);
  assert.deepEqual(a.runtime.debugInfo().applied, first);
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'frequency',
    value: 1500 }));
  ok(a.runtime.apply(store.getModel(), { revision: 1 }));
  const second = a.runtime.applied();
  assert.equal(second.revision, 1);
  assert.equal(second.studioHash, studioHash(store.getModel()));
  assert.notEqual(second.planHash, first.planHash);
  failNextBiquad(a.fx.ctx);
  ok(store.dispatch(ADD_FILTER));
  assert.equal(a.runtime.apply(store.getModel(), { revision: 2 }).ok, false);
  assert.deepEqual(a.runtime.applied(), second, 'the refused edit left the record');
  assert.equal(a.runtime.apply({ nonsense: true }, { revision: 3 }).ok, false);
  assert.deepEqual(a.runtime.applied(), second, 'an invalid model left it too');
  a.runtime.stop();
  assert.equal(a.runtime.applied(), null, 'stopped: nothing runs');

  // A capability change re-applies the same revision: a new planHash, not a new revision.
  const m = audio({ navigator: MIC_NAVIGATOR });
  const meas = templateModel(MEASUREMENT_TEMPLATE_ID);
  ok(m.runtime.apply(meas, { revision: 7 }));
  ok(m.runtime.start());
  const before = m.runtime.applied();
  ok(m.runtime.setOptions({ inputPermission: true }));
  const after = m.runtime.applied();
  assert.equal(after.revision, 7);
  assert.equal(after.studioHash, before.studioHash);
  assert.notEqual(after.planHash, before.planHash);
  assert.equal(runtimeModule.studioDivergence({ model: meas, revision: 7 }, m.runtime).state,
    'in-sync');
  m.runtime.stop();
});

// ---------------------------------------------------------------- divergence

test('divergence verdict: not-applied, in-sync, behind and refused, from data', () => {
  const divergence = runtimeModule.studioDivergence;
  assert.equal(typeof divergence, 'function', 'runtime.js exports studioDivergence');
  const s = ungated();
  const at = (revision = s.store.getRevision()) => divergence({ model: s.store.getModel(),
    revision }, s.runtime);
  const v0 = at();
  assert.equal(v0.state, 'not-applied', 'stopped');
  assert.equal(v0.applied, null);
  assert.deepEqual(v0.desired, { revision: 0, studioHash: studioHash(s.store.getModel()) });
  ok(s.transport.start());
  s.fx.advance(0.1);
  const v1 = at();
  assert.equal(v1.state, 'in-sync');
  assert.deepEqual(v1.applied, s.runtime.applied());
  assert.equal(v1.reason, null);
  assert.equal(at(null).state, 'in-sync', 'without a revision: by studioHash');

  // A presentation change the runtime has not seen: behind by revision, in sync by hash.
  ok(s.store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1', position: { x: 5, y: 5 } }));
  assert.equal(at().state, 'behind');
  assert.equal(at(null).state, 'in-sync');
  ok(s.transport.sync());
  assert.equal(at().state, 'in-sync');
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency',
    value: 330 }));
  assert.equal(at().state, 'behind');
  assert.equal(at(null).state, 'behind');
  ok(s.transport.sync());

  // The runtime refuses the desired model: refused, with the runtime's diagnostic.
  failNextBiquad(s.fx.ctx);
  const id = ok(s.store.dispatch(ADD_FILTER)).created.nodes[0];
  s.transport.sync();
  for (const v of [at(), at(null)]) {
    assert.equal(v.state, 'refused');
    assert.equal(v.reason.owner, 'runtime');
    assert.equal(v.reason.code, 'prepare-failed');
    assert.match(v.reason.message, /injected biquad failure/);
    assert.equal(v.applied.revision, s.store.getRevision() - 1, 'the last applied record');
  }
  // The status the Studio shows follows the verdict, with a code.
  const live = workspace.studioStatus(s.store.getModel(), { runtime: s.runtime,
    revision: s.store.getRevision() });
  assert.equal(live.nodes.get(id).status, 'degraded');
  assert.equal(live.nodes.get(id).code, 'not-in-runtime');
  // A later edit not yet synced is behind (the refusal was of another revision).
  ok(s.store.dispatch({ type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Carrier' }));
  assert.equal(at().state, 'behind');
  assert.equal(at().reason, null);
  s.transport.stop();
  assert.equal(at().state, 'not-applied');

  // With the workspace's commit gate a refused edit never becomes desired: still in sync.
  const g = audio();
  let transport = null;
  const handle = workspace.createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), {
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime: g.runtime, engine: g.engine, store: handle });
  ok(transport.start());
  failNextBiquad(g.fx.ctx);
  assert.equal(handle.dispatch(ADD_FILTER).ok, false);
  assert.equal(divergence({ model: handle.getModel(), revision: handle.getRevision() },
    g.runtime).state, 'in-sync');
  transport.stop();
});

// ---------------------------------------------------------------- transport.sync refusal

test('transport.sync: a model the runtime refused is not adopted; the transport stays on the '
  + 'last applied one', () => {
  const s = ungated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  const owned = s.runtime.ownedParams();
  failNextBiquad(s.fx.ctx);
  const id = ok(s.store.dispatch(ADD_FILTER)).created.nodes[0];
  const lane = ok(s.store.dispatch({ type: 'AUTOMATION_POINT_ADD',
    target: { node: id, param: 'frequency' }, time: 0.2, value: 800 }));
  const laneId = s.store.getModel().timeline.automation.find((l) => l.target.node === id).id;
  assert.ok(lane.ok && laneId);
  const r = s.transport.sync();
  assert.equal(s.runtime.lastError.phase, 'prepare', 'the runtime refused the update');
  assert.equal(r.ok, false, 'sync reports the refusal');
  assert.equal(r.applied.phase, 'prepare');
  assert.deepEqual(s.runtime.ownedParams(), owned,
    'the runtime claims only what the running graph has');
  assert.ok(!s.transport.debugInfo().unplayed.some((u) => u.id === laneId),
    'nothing of the refused model is scheduled or listed');
  assert.equal(s.transport.debugInfo().lastError.phase, 'prepare');
  // The next change that the runtime takes is adopted as usual.
  ok(s.store.dispatch({ type: 'NODE_REMOVE', nodeId: id }));
  const again = ok(s.transport.sync());
  assert.equal(again.applied.ok, true);
  assert.equal(s.runtime.applied().revision, s.store.getRevision());
  s.transport.stop();
});
