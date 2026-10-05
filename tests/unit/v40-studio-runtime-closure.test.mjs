// v4.0 closure audit, Studio runtime (F1, F2, F4, F5, F8, F10, F11 and the deleted-project
// data loss). Each test fails on the code before its fix:
//   F1  a refused PLAY, a refused live edit that adds a Master Output and a context closed from
//       outside left the Studio's master level on the ONE engine (MEASURE plays through it);
//   F4  a throw after the transaction's plan swap escaped `apply`: the store's commit gate
//       refused an edit whose plan the runtime already held (hidden divergence);
//   F8  dropAll forgot a live Microphone without disposing it: its MediaStream tracks stayed on;
//   F2  the stopped status ignored the runtime's input permission, the mic-off reason named a
//       control that did not exist, and there was no permission request to reuse;
//   F5  codes read back from message text (patches.js, validate.js), transport warnings
//       de-duplicated by text across codes, and a refused PLAY that was not a Diagnostic;
//   F10 a compile that throws gave the Studio a blank status;
//   F11 WAVEFORMS had two owners;
//   a deleted open project left the document clean, so the next template replaced it unasked.
//   node --test tests/unit/v40-studio-runtime-closure.test.mjs
// Wiring: the real AudioEngine over the fake AudioContext of sequencer-fake-audio.mjs, the
// runtime, the transport and the workspace's store handle with its commit gate.
// Tolerances: the engine's master level is compared exactly (it is the requested level).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as microphone from '../../src/js/audio/microphone.js';
import { WAVEFORMS as CORE_WAVEFORMS } from '../../src/js/core/constants.js';
import { WAVEFORMS as SEQUENCER_WAVEFORMS } from '../../src/js/sequencer/model.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import * as nodes from '../../src/js/studio/adapters/nodes.js';
import { createDirtyTracker } from '../../src/js/studio/library.js';
import { createPatch, importPatch, serializePatch } from '../../src/js/studio/patches.js';
import { createStudioRuntime, studioDivergence } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { NODE_REGISTRY } from '../../src/js/studio/registry.js';
import {
  STUDIO_IMPORT_LIMITS, validateStudioImport, validateStudioModel,
} from '../../src/js/studio/validate.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import * as workspace from '../../src/js/ui/studio/workspace.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const ENGINE_LEVEL = 0.2;
const STUDIO_LEVEL = 0.15;

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

/** A fake MediaStream whose tracks record stop(). */
function fakeStream() {
  const tracks = [{ stopped: false, onended: null, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => tracks };
}

function audio({ adapters, navigator, options } = {}) {
  const fx = createFakeAudioEnv({ sampleRate: SR, navigator });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  if (!fx.ctx.createMediaStreamSource) {
    fx.ctx.createMediaStreamSource = function createMediaStreamSource(stream) {
      const n = fx.ctx.createGain();
      n.kind = 'media-stream-source';
      n.stream = stream;
      return n;
    };
  }
  engine.setMasterGain(ENGINE_LEVEL);
  const runtime = createStudioRuntime({ engine, adapters, options });
  return { fx, engine, runtime };
}

/** The reference template with its Master Output at STUDIO_LEVEL. */
function studioModel() {
  const store = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator(templateModel(REFERENCE_TEMPLATE_ID)) });
  ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'master-1', key: 'level',
    value: STUDIO_LEVEL }));
  return store;
}

/**
 * Adapters whose first Master Output arms a one-shot createGain failure once it is built: the
 * transaction fails in prepare AFTER the Master node was created (the route gains follow).
 */
function failAfterMaster(getCtx) {
  const real = nodes.NODE_ADAPTERS.master;
  let armed = true;
  const master = { ...real, create(env) {
    const h = real.create(env);
    if (!armed) return h;
    armed = false;
    const ctx = getCtx();
    const own = Object.prototype.hasOwnProperty.call(ctx, 'createGain');
    const original = ctx.createGain;
    ctx.createGain = function failing() {
      if (own) ctx.createGain = original;
      else delete ctx.createGain;
      throw new Error('injected gain failure after the Master Output');
    };
    return h;
  } };
  return { ...nodes.NODE_ADAPTERS, master };
}

// ---------------------------------------------------------------- F1 global side effects

test('F1 a PLAY refused in prepare leaves the engine master level where it was', async () => {
  let fx = null;
  const a = audio({ adapters: failAfterMaster(() => fx.ctx) });
  fx = a.fx;
  const store = studioModel();
  const transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store });
  const r = transport.start({ position: 0 });
  assert.equal(r.ok, false, 'PLAY refused');
  assert.equal(a.runtime.state, 'idle');
  assert.equal(a.runtime.lastError.phase, 'prepare');
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL, 'the refused PLAY did not keep the Studio level');
  await transport.stop();
  a.runtime.flush({ force: true });
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL, 'and STOP did not either');
  assert.equal(a.engine.activeNodeCount, 0);

  // The next PLAY (no failure) drives the level while playing and gives it back at STOP.
  ok(transport.start({ position: 0 }));
  assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
  const done = transport.stop();
  fx.advance(0.3);
  await done;
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
});

test('F1 a refused live edit that adds a Master Output does not change the engine level',
  async () => {
    let fx = null;
    let arm = false;
    const real = nodes.NODE_ADAPTERS.master;
    const adapters = { ...nodes.NODE_ADAPTERS, master: { ...real, create(env) {
      const h = real.create(env);
      if (arm) {
        arm = false;
        const ctx = fx.ctx;
        const own = Object.prototype.hasOwnProperty.call(ctx, 'createGain');
        const original = ctx.createGain;
        ctx.createGain = function failing() {
          if (own) ctx.createGain = original;
          else delete ctx.createGain;
          throw new Error('injected gain failure after the new Master Output');
        };
      }
      return h;
    } } };
    const a = audio({ adapters });
    fx = a.fx;
    const store = studioModel();
    ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
    ok(a.runtime.start());
    assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
    // The next model replaces the Master Output (another id, level 0.05) and routes into it.
    ok(store.dispatch({ type: 'NODE_REMOVE', nodeId: 'master-1' }));
    const add = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'master',
      position: { x: 0, y: 0 }, params: { level: 0.05 } }));
    const id = add.created.nodes[0];
    ok(store.dispatch({ type: 'EDGE_ADD', from: { node: 'filter-1', port: 'audio' },
      to: { node: id, port: 'audio' } }));
    const plan = a.runtime.plan;
    arm = true;
    const r = a.runtime.apply(store.getModel(), { revision: store.getRevision() });
    assert.equal(r.ok, false, 'refused');
    assert.equal(r.phase, 'prepare');
    assert.equal(a.runtime.plan, plan, 'the running plan is untouched');
    assert.equal(a.engine.gainLevel, STUDIO_LEVEL, 'the refused edit wrote no master level');
    // The same edit without the failure commits and takes the new level.
    ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
    assert.equal(a.engine.gainLevel, 0.05);
    const done = a.runtime.stop();
    fx.advance(0.3);
    await done;
    assert.equal(a.engine.gainLevel, ENGINE_LEVEL, 'STOP gives the engine its own level back');
  });

test('F1 a context closed from outside gives the engine its level back', () => {
  const a = audio();
  const store = studioModel();
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  ok(a.runtime.start());
  assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
  a.fx.ctx.close();
  assert.equal(a.runtime.state, 'idle', 'the runtime dropped its graph');
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
});

test('F1 masterLevel ignore while playing gives the level back; ignore never writes it', () => {
  const a = audio();
  const store = studioModel();
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  ok(a.runtime.start());
  assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
  ok(a.runtime.setOptions({ masterLevel: 'ignore' }));
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  assert.equal(a.engine.gainLevel, ENGINE_LEVEL);
});

// ---------------------------------------------------------------- F4 atomic commit

/** As the workspace wires it: the handle's commit gate is transport.admit. */
function gated() {
  const a = audio();
  let transport = null;
  const handle = workspace.createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), {
    gate: (next, info) => (transport ? transport.admit(next, info) : null),
  });
  transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store: handle });
  handle.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
  return { ...a, handle, transport };
}

test('F4 a throw after the plan swap is a warning: the edit commits and the record is true',
  () => {
    const s = gated();
    ok(s.transport.start());
    s.fx.advance(0.1);
    // One read of the engine's safe maximum throws: computeBases of a parameter edit reads it
    // only after the transaction swapped its plan (nothing is created, nothing prepared).
    let armed = true;
    const proto = Object.getOwnPropertyDescriptor(AudioEngine.prototype, 'safeMaximum');
    Object.defineProperty(s.engine, 'safeMaximum', { configurable: true, get() {
      if (armed) {
        armed = false;
        throw new Error('injected failure after the commit');
      }
      return proto.get.call(this);
    } });
    const r = s.handle.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency',
      value: 330 });
    assert.equal(armed, false, 'the injected failure fired');
    assert.equal(r.ok, true, `the edit commits, got ${JSON.stringify(r.reason || '')}`);
    const model = s.handle.getModel();
    assert.equal(s.runtime.plan.model, model, 'the runtime holds the committed model');
    assert.equal(s.runtime.applied().revision, s.handle.getRevision(),
      'the applied record names the revision the runtime holds');
    const v = studioDivergence({ model, revision: s.handle.getRevision() }, s.runtime);
    assert.equal(v.state, 'in-sync');
    const d = s.runtime.debugInfo().diagnostics.find((x) => x.code === 'parameters-failed');
    assert.ok(d, 'the failed step is a diagnostic');
    assert.deepEqual(d.entity, { kind: 'node', id: 'osc-1' });
    assert.match(d.message, /injected failure after the commit/);
    s.transport.stop();
  });

// ---------------------------------------------------------------- F8 + F2 microphone

/** A Studio with a Microphone into a Spectrum (analysis only). */
function micModel() {
  const store = createStudioStore(null, { idGenerator: createIdGenerator(null) });
  const mic = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'microphone',
    position: { x: 0, y: 0 } })).created.nodes[0];
  const sp = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'spectrum',
    position: { x: 0, y: 0 } })).created.nodes[0];
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: mic, port: 'audio' },
    to: { node: sp, port: 'audio' } }));
  return { store, mic };
}

test('F8 a context closed while a Microphone is open stops its MediaStream tracks', async () => {
  const stream = fakeStream();
  const navigator = { mediaDevices: { getUserMedia: async () => stream } };
  const a = audio({ navigator, options: { inputPermission: true } });
  const { store, mic } = micModel();
  ok(a.runtime.apply(store.getModel()));
  ok(a.runtime.start());
  const events = [];
  a.runtime.on((type, detail) => { if (type === 'handle') events.push(detail); });
  await new Promise((res) => setImmediate(res));
  assert.equal(a.runtime.nodes.get(mic).status, 'ready', 'the input opened');
  a.fx.ctx.close();
  assert.equal(a.runtime.state, 'idle');
  assert.ok(stream.tracks[0].stopped, 'the microphone tracks were stopped');
  // F2: the settled handle was announced, so the views show the open input.
  assert.deepEqual(events, [{ id: mic, status: 'ready', code: null }]);
});

test('F2 the input permission is a real path: request, then the stopped status is ready',
  async () => {
    // The request reuses microphone.js (the request openMicrophone makes) and keeps nothing.
    const stream = fakeStream();
    let asked = null;
    const md = { getUserMedia: async (c) => { asked = c; return stream; } };
    assert.equal(await microphone.requestMicrophonePermission(md), true);
    assert.deepEqual(asked, { audio: { echoCancellation: false, noiseSuppression: false,
      autoGainControl: false } });
    assert.ok(stream.tracks[0].stopped, 'the permission probe does not keep the input open');
    const denied = { getUserMedia: async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    } };
    await assert.rejects(microphone.requestMicrophonePermission(denied),
      (e) => /permission was denied/.test(microphone.micErrorMessage(e)));

    // The mic-off reason names the control that exists.
    assert.match(nodes.MIC_OFF_TEXT, /Allow microphone in the Inspector/);
    assert.doesNotMatch(nodes.MIC_OFF_TEXT, /from the Microphone node/);

    // The stopped status follows the runtime's capability, so Allow shows at once.
    const navigator = { mediaDevices: { getUserMedia: async () => fakeStream() } };
    const a = audio({ navigator });
    const { store, mic } = micModel();
    ok(a.runtime.apply(store.getModel()));
    const before = workspace.studioStatus(store.getModel(), { runtime: a.runtime,
      engine: a.engine });
    assert.equal(before.nodes.get(mic).code, 'mic-off');
    ok(a.runtime.setOptions({ inputPermission: true }));
    assert.deepEqual(a.runtime.options, { masterLevel: 'engine', inputPermission: true });
    const after = workspace.studioStatus(store.getModel(), { runtime: a.runtime,
      engine: a.engine });
    assert.equal(after.nodes.get(mic).status, 'ready');
    assert.equal(after.error, null);
  });

test('F2 the Inspector offers Allow microphone while the input is off, failed or ended', () => {
  assert.equal(typeof inspector.microphoneView, 'function');
  const off = inspector.microphoneView({ status: 'degraded', code: 'mic-off' });
  assert.equal(off.action, 'Allow microphone');
  assert.match(off.note, /nothing is recorded, stored or uploaded/);
  assert.equal(inspector.microphoneView({ status: 'degraded', code: 'mic-error' },
    'Microphone permission was denied.').error, 'Microphone permission was denied.');
  assert.equal(inspector.microphoneView({ status: 'degraded', code: 'mic-ended' }).action,
    'Allow microphone again');
  for (const code of ['mic-unsupported', 'mic-pending', null]) {
    assert.equal(inspector.microphoneView({ status: 'ready', code }), null, String(code));
  }
  const { store, mic } = micModel();
  const view = inspector.inspectorView(store.getModel(), { nodes: [mic] }, {
    status: new Map([[mic, { status: 'degraded', code: 'mic-off', reason: nodes.MIC_OFF_TEXT }]]),
  });
  assert.equal(view.mic.action, 'Allow microphone');
});

// ---------------------------------------------------------------- F5 structured codes

test('F5 a future patch studioSchemaVersion is unsupported-version, not limit-exceeded', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const p = createPatch(m, ['osc-1'], { name: 'x' });
  const doc = JSON.parse(serializePatch(p.patch || p));
  doc.studioSchemaVersion = 99;
  const r = importPatch(JSON.stringify(doc));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'unsupported-version');
  assert.equal(r.errors[0].path, 'studioSchemaVersion');
  doc.studioSchemaVersion = 0;
  assert.equal(importPatch(JSON.stringify(doc)).errors[0].code, 'invalid-structure');
  doc.studioSchemaVersion = m.schemaVersion;
  doc.name = 'x'.repeat(65);
  assert.equal(importPatch(JSON.stringify(doc)).errors[0].code, 'limit-exceeded');
});

test('F5 an import error is limit-exceeded only when a limit was exceeded', () => {
  const m = JSON.parse(JSON.stringify(templateModel(REFERENCE_TEMPLATE_ID)));
  // A text that merely quotes the words is not a limit (an unknown node type is quoted).
  m.graph.nodes[0].type = 'x (import limit)';
  const r = validateStudioImport(JSON.stringify(m));
  assert.equal(r.ok, false);
  assert.ok(r.errors.every((e) => e.code !== 'limit-exceeded'),
    JSON.stringify(r.errors.map((e) => [e.code, e.message])));
  const big = JSON.stringify(templateModel(REFERENCE_TEMPLATE_ID));
  const r2 = validateStudioImport(big, { ...STUDIO_IMPORT_LIMITS, nodes: 2 });
  assert.equal(r2.errors[0].code, 'limit-exceeded');
  const r3 = validateStudioImport(big, { ...STUDIO_IMPORT_LIMITS, automationPoints: 1 });
  assert.equal(r3.errors[0].code, 'limit-exceeded');
});

test('F5 a refused PLAY is a Diagnostic with a code', () => {
  const a = audio();
  const store = createStudioStore(templateModel(REFERENCE_TEMPLATE_ID),
    { idGenerator: createIdGenerator(templateModel(REFERENCE_TEMPLATE_ID)) });
  const t = createStudioTransport({ runtime: a.runtime, engine: a.engine, store,
    onClaimOutput: () => false });
  const r = t.start();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'claim-refused');
  const e = t.debugInfo().lastError;
  assert.equal(e.code, 'claim-refused');
  assert.equal(e.owner, 'transport');
  assert.equal(e.severity, 'error');
  assert.equal(e.phase, 'claim');
  assert.equal(typeof e.message, 'string');
});

test('F5 transport diagnostics are one per code and entity, never merged by their text', () => {
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  const failNextBiquad = () => {
    const ctx = s.fx.ctx;
    const own = Object.prototype.hasOwnProperty.call(ctx, 'createBiquadFilter');
    const original = ctx.createBiquadFilter;
    ctx.createBiquadFilter = function failing() {
      if (own) ctx.createBiquadFilter = original;
      else delete ctx.createBiquadFilter;
      throw new Error('injected biquad failure');
    };
  };
  const ADD_FILTER = { type: 'NODE_ADD', nodeType: 'filter', position: { x: 40, y: 40 } };
  failNextBiquad();
  assert.equal(s.handle.dispatch(ADD_FILTER).ok, false);
  // The same failure on a synced model (a document opened while playing): another code, the
  // same text. Both are true, and both are listed.
  const next = templateModel(REFERENCE_TEMPLATE_ID);
  next.graph = { ...next.graph, nodes: [...next.graph.nodes, { id: 'filter-9', type: 'filter',
    position: { x: 9, y: 9 }, params: { ...next.graph.nodes.find((n) => n.type === 'filter')
      .params }, metadata: { name: 'Filter 9' } }] };
  failNextBiquad();
  s.handle.replace(next);
  const d = s.transport.debugInfo().diagnostics;
  const codes = d.map((x) => x.code);
  assert.ok(codes.includes('edit-refused'), JSON.stringify(codes));
  assert.ok(codes.includes('sync-refused'), JSON.stringify(codes));
  assert.equal(s.transport.debugInfo().lastError.code, 'sync-refused');
  assert.equal(s.transport.debugInfo().lastError.owner, 'transport');
  s.transport.stop();
});

// ---------------------------------------------------------------- F10, F11

/**
 * A registry whose port lookup throws once validation is done (compileStudio's edge pass): the
 * calls validation makes are counted first, the next one throws.
 */
function brokenRegistry(model) {
  let calls = 0;
  let limit = Infinity;
  const registry = { ...NODE_REGISTRY, port(...args) {
    calls += 1;
    if (calls > limit) throw new Error('injected registry failure');
    return NODE_REGISTRY.port(...args);
  } };
  assert.ok(validateStudioModel(model, { registry }).ok);
  limit = calls;
  calls = 0;
  assert.ok(validateStudioModel(model, { registry }).ok, 'validation alone still passes');
  calls = 0;
  return registry;
}

test('F10 a compile that throws shows a compile-failed Diagnostic, not a blank status', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const broken = brokenRegistry(m);
  const st = workspace.studioStatus(m, { registry: broken });
  assert.ok(st.error, 'an error diagnostic');
  assert.equal(st.error.code, 'compile-failed');
  assert.equal(st.error.owner, 'compiler');
  assert.equal(st.nodes.size, m.graph.nodes.length, 'every node has a status');
  for (const v of st.nodes.values()) {
    assert.equal(v.status, 'degraded');
    assert.equal(v.code, 'compile-failed');
  }
  for (const v of st.edges.values()) assert.equal(v.code, 'compile-failed');
});

test('F11 WAVEFORMS has one owner (core/constants.js), re-exported unchanged', () => {
  assert.equal(SEQUENCER_WAVEFORMS, CORE_WAVEFORMS);
  assert.deepEqual([...CORE_WAVEFORMS], ['sine', 'triangle', 'sawtooth', 'square']);
});

// ---------------------------------------------------------------- deleted open project

test('a deleted saved copy leaves the document unsaved until the next save', () => {
  const m = templateModel(REFERENCE_TEMPLATE_ID);
  const d = createDirtyTracker(m);
  d.markSaved(m, { id: 'project-x' });
  assert.equal(d.isDirty(m), false);
  assert.equal(typeof d.markUnsaved, 'function');
  d.markUnsaved();
  assert.equal(d.isDirty(m), true, 'nothing is saved any more');
  assert.equal(d.status(m).lastSave, null);
  d.markSaved(m, { id: 'project-y' });
  assert.equal(d.isDirty(m), false);
});

// ---------------------------------------------------------------- PR #119 adversarial review
// D1 Allow microphone again while playing rebuilt nothing (0 ops) and announced success; D2 the
// restored master level overwrote a level set elsewhere while the Studio played, also during
// STOP's held glide; D3 an engage or commit failure vanished at the next transaction and the
// verdict stayed in-sync; D4 a compile-failure warning was never cleared; and the plausible
// findings (a denied PLAY left the permission on, the Allow control's busy state and per-node
// error text).

/** A Microphone → Spectrum Studio playing with getUserMedia under the test's control. */
async function playingMic(mode) {
  const streams = [];
  const navigator = { mediaDevices: { getUserMedia: async () => {
    if (mode.value === 'deny') {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    }
    const st = fakeStream();
    streams.push(st);
    return st;
  } } };
  const a = audio({ navigator, options: { inputPermission: true } });
  const { store, mic } = micModel();
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  ok(a.runtime.start());
  await new Promise((res) => setImmediate(res));
  return { ...a, store, mic, streams };
}

test('D1 Allow microphone again while playing reopens a Microphone whose input was denied',
  async () => {
    const mode = { value: 'deny' };
    const s = await playingMic(mode);
    assert.equal(s.runtime.nodes.get(s.mic).code, 'mic-error');
    mode.value = 'allow';
    const r = ok(s.runtime.setOptions({ inputPermission: true }));
    assert.deepEqual(r.reopened, [s.mic]);
    assert.ok(r.ops.some((o) => o.op === 'node-replace' && o.id === s.mic), JSON.stringify(r.ops));
    const mics = await workspace.settleMicrophones(s.runtime, { timeoutMs: 1000 });
    assert.deepEqual(mics.map((m) => [m.id, m.status]), [[s.mic, 'ready']]);
    assert.equal(s.streams.length, 1, 'the input opened again');
    assert.equal(workspace.microphoneOutcome(mics, { playing: true }).ok, true);
    s.runtime.stop();
  });

test('D1 Allow microphone again while playing reopens a Microphone whose input ended', async () => {
  const s = await playingMic({ value: 'allow' });
  assert.equal(s.runtime.nodes.get(s.mic).status, 'ready');
  s.streams[0].tracks[0].onended();
  assert.equal(s.runtime.nodes.get(s.mic).code, 'mic-ended');
  assert.equal(s.runtime.options.inputPermission, true, 'an ended track is not a denial');
  const r = ok(s.runtime.setOptions({ inputPermission: true }));
  assert.deepEqual(r.reopened, [s.mic]);
  const mics = await workspace.settleMicrophones(s.runtime, { timeoutMs: 1000 });
  assert.equal(mics[0].status, 'ready');
  assert.equal(s.streams.length, 2);
  s.runtime.stop();
});

test('D1 the announcement is the outcome: a reopen the browser refuses again is not success',
  async () => {
    const mode = { value: 'deny' };
    const s = await playingMic(mode);
    ok(s.runtime.setOptions({ inputPermission: true }));
    const mics = await workspace.settleMicrophones(s.runtime, { timeoutMs: 1000 });
    const o = workspace.microphoneOutcome(mics, { playing: true });
    assert.equal(o.ok, false);
    assert.match(o.text, /permission was denied/);
    assert.deepEqual(o.failed.map((f) => f.id), [s.mic]);
    assert.match(workspace.microphoneOutcome([], { playing: false }).text, /when the Studio plays/);
    s.runtime.stop();
  });

test('PR119 a Microphone denied at PLAY turns the permission off: the stopped status says so',
  async () => {
    const s = await playingMic({ value: 'deny' });
    assert.equal(s.runtime.options.inputPermission, false);
    const done = s.runtime.stop();
    s.fx.advance(0.3);
    await done;
    const st = workspace.studioStatus(s.store.getModel(), { runtime: s.runtime,
      engine: s.engine });
    assert.equal(st.nodes.get(s.mic).code, 'mic-off', 'not "ready" while the browser refuses');
  });

test('PR119 the Allow control: busy while a request runs, its error per node, never doubled',
  () => {
  const off = { status: 'degraded', code: 'mic-off', reason: nodes.MIC_OFF_TEXT };
  const busy = inspector.microphoneView(off, '', true);
  assert.equal(busy.busy, true);
  assert.match(busy.action, /Waiting/);
  const denied = inspector.microphoneView(off, 'Microphone permission was denied.');
  assert.equal(denied.action, 'Allow microphone again');
  assert.equal(denied.error, 'Microphone permission was denied.');
  const live = { status: 'degraded', code: 'mic-error', reason: 'No microphone was found.' };
  assert.equal(inspector.microphoneView(live, 'No microphone was found.').error, '',
    'the status line already says it');
  const { store, mic } = micModel();
  const other = ok(store.dispatch({ type: 'NODE_ADD', nodeType: 'microphone',
    position: { x: 0, y: 0 } })).created.nodes[0];
  const status = new Map([[mic, off], [other, off]]);
  const micError = (id) => (id === mic ? 'Microphone permission was denied.' : '');
  const a = inspector.inspectorView(store.getModel(), { nodes: [mic] }, { status, micError });
  const b = inspector.inspectorView(store.getModel(), { nodes: [other] }, { status, micError });
  assert.match(a.mic.error, /denied/);
  assert.equal(b.mic.error, '', 'another Microphone does not show the first one\'s denial');
});

test('D2 STOP keeps a master level set elsewhere while the Studio played', async () => {
  const a = audio();
  const store = studioModel();
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  ok(a.runtime.start());
  assert.equal(a.engine.gainLevel, STUDIO_LEVEL);
  a.engine.setMasterGain(0.05); // the Playground's gain watcher (main.js)
  const done = a.runtime.stop();
  a.fx.advance(0.3);
  await done;
  assert.equal(a.engine.gainLevel, 0.05, 'the newer level is kept');
  // A level that is still the Studio's own is given back, as before.
  ok(a.runtime.start());
  const again = a.runtime.stop();
  a.fx.advance(0.3);
  await again;
  assert.equal(a.engine.gainLevel, 0.05, 'the level before this session');
});

test('D2 a level set during STOP\'s fade cancels the held restore', () => {
  const a = audio();
  const store = studioModel();
  ok(a.runtime.apply(store.getModel(), { revision: store.getRevision() }));
  ok(a.runtime.start());
  a.runtime.stop();
  const p = a.engine.master.gain;
  const now = a.fx.ctx.currentTime;
  assert.ok(p.events.some((e) => e.value === ENGINE_LEVEL && e.t > now), 'the restore is held');
  a.engine.setMasterGain(0.05);
  assert.equal(a.engine.gainLevel, 0.05);
  assert.ok(!p.events.some((e) => e.value === ENGINE_LEVEL && e.t >= now),
    `no held glide back to ${ENGINE_LEVEL}: ${JSON.stringify(p.events.slice(-3))}`);
  assert.equal(p.events.at(-1).value, 0.05);
});

/** The reference Studio whose Master Output engage fails while `fail.value`. */
function failingEngage(fail) {
  const real = nodes.NODE_ADAPTERS.master;
  const adapters = { ...nodes.NODE_ADAPTERS, master: { ...real, create(env) {
    const h = real.create(env);
    const engage = h.engage;
    h.engage = () => {
      if (fail.value) throw new Error('injected engage failure');
      engage();
    };
    return h;
  } } };
  const a = audio({ adapters });
  const store = studioModel();
  const verdict = () => studioDivergence({ model: store.getModel(),
    revision: store.getRevision() }, a.runtime);
  const codes = () => a.runtime.debugInfo().diagnostics.map((d) => d.code);
  return { ...a, store, verdict, codes };
}

test('D3 a failed engage stays visible and the verdict is degraded until it engages', () => {
  const fail = { value: true };
  const s = failingEngage(fail);
  ok(s.runtime.apply(s.store.getModel(), { revision: s.store.getRevision() }));
  ok(s.runtime.start());
  assert.equal(s.verdict().state, 'degraded');
  assert.equal(s.verdict().reason.code, 'engage-failed');
  assert.equal(s.engine.gainLevel, ENGINE_LEVEL, 'the Master level was not engaged');
  // An unrelated edit: the failure is still in effect, so it is still shown.
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 330 }));
  ok(s.runtime.apply(s.store.getModel(), { revision: s.store.getRevision() }));
  assert.ok(s.codes().includes('engage-failed'), JSON.stringify(s.codes()));
  assert.equal(s.verdict().state, 'degraded');
  // The next transaction engages it: resolved.
  fail.value = false;
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 440 }));
  ok(s.runtime.apply(s.store.getModel(), { revision: s.store.getRevision() }));
  assert.equal(s.verdict().state, 'in-sync');
  assert.ok(!s.codes().includes('engage-failed'));
  assert.equal(s.engine.gainLevel, STUDIO_LEVEL);
  s.runtime.stop();
});

test('D3 a throw in the commit\'s own bookkeeping is commit-failed and stays until STOP',
  async () => {
    let armed = false;
    const trace = { run: (fn) => fn(), record(owner, kind, f) {
      if (armed && owner === 'runtime' && kind === 'apply' && f.outcome === 'applied') {
        armed = false;
        throw new Error('injected trace failure');
      }
    } };
    const fx = createFakeAudioEnv({ sampleRate: SR });
    const engine = new AudioEngine({ env: fx.env });
    assert.ok(engine.init());
    const runtime = createStudioRuntime({ engine, trace });
    const store = studioModel();
    const verdict = () => studioDivergence({ model: store.getModel(),
      revision: store.getRevision() }, runtime);
    ok(runtime.apply(store.getModel(), { revision: store.getRevision() }));
    ok(runtime.start());
    armed = true;
    ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 330 }));
    const r = runtime.apply(store.getModel(), { revision: store.getRevision() });
    assert.equal(r.ok, true, 'the committed transaction is not refused');
    assert.equal(verdict().state, 'degraded');
    assert.equal(verdict().reason.code, 'commit-failed');
    ok(store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency', value: 440 }));
    ok(runtime.apply(store.getModel(), { revision: store.getRevision() }));
    assert.equal(verdict().state, 'degraded', 'still unresolved');
    const done = runtime.stop();
    fx.advance(0.3);
    await done;
    assert.deepEqual(runtime.unresolved(), []);
  });

test('D3 the Inspector names a degraded runtime and lists its reason once', () => {
  const s = failingEngage({ value: true });
  ok(s.runtime.apply(s.store.getModel(), { revision: s.store.getRevision() }));
  ok(s.runtime.start());
  const truth = { verdict: s.verdict(), runtime: s.runtime.debugInfo(), transport: null };
  const rv = inspector.runtimeView(s.store.getModel(), truth);
  assert.equal(rv.state, 'degraded');
  assert.equal(rv.label, 'Running, degraded');
  assert.match(rv.text, /injected engage failure/);
  assert.equal(inspector.runtimeDiagnostics(truth).filter((d) => d.code === 'engage-failed')
    .length, 1);
  s.runtime.stop();
});

test('D4 the compile-failure warning is cleared once the status compiles again', () => {
  assert.equal(typeof workspace.compileWarningLine, 'function');
  const error = { message: 'The Studio could not be compiled: x' };
  const failed = workspace.compileWarningLine({ warning: '', shown: '' }, error);
  assert.deepEqual(failed, { warning: error.message, shown: error.message });
  assert.deepEqual(workspace.compileWarningLine(failed, null), { warning: '', shown: '' });
  // Another warning written meanwhile (an edit refused) is not the compile's to clear.
  assert.deepEqual(workspace.compileWarningLine({ warning: 'Edit refused', shown: error.message },
    null), { warning: 'Edit refused', shown: '' });
});
