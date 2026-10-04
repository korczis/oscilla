// The Studio Inspector's Runtime section as a pure view model (inspector.js runtimeView,
// runtimeDiagnostics, runtimeState, shortHash; ADR 0039): every divergence state in words, the
// identities behind them, the node and cable counts, the automation lanes and owned parameters,
// and the current diagnostics with an entity reference that selects what each one names. Also
// the two domain additions it reads: a prepare refusal names the node that threw, and the
// transport's diagnostics are those of the current playback.
//   node --test tests/unit/v31-studio-runtime-view.test.mjs
// Wiring: the real AudioEngine over the fake AudioContext of sequencer-fake-audio.mjs, the
// runtime and transport as the workspace builds them (with and without its commit gate);
// createBiquadFilter is made to throw once to refuse a transaction in its prepare phase.
// Namespace imports: each test fails on its own assertion on the code before this change.
// Tolerances: none (identity, text and counts).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { EMPTY_SELECTION, createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime, studioDivergence } from '../../src/js/studio/runtime.js';
import { studioHash } from '../../src/js/studio/schema.js';
import {
  MEASUREMENT_TEMPLATE_ID, REFERENCE_TEMPLATE_ID, templateModel,
} from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import * as workspace from '../../src/js/ui/studio/workspace.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const TO_HIGHPASS = { type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'type', value: 'highpass' };

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

function audio() {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  return { fx, engine, runtime: createStudioRuntime({ engine }) };
}

/** A store that commits first (no gate): behind and refused can arise. */
function ungated() {
  const a = audio();
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store });
  return { ...a, store, transport };
}

/** As the workspace wires it: the handle's commit gate is transport.admit. */
function gated() {
  const a = audio();
  let transport = null;
  const store = workspace.createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), {
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store });
  store.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
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

/** What the workspace passes the Inspector (workspace.js svc.truth). */
const truthOf = (s, runtime = s.runtime) => ({
  verdict: studioDivergence({ model: s.store.getModel(), revision: s.store.getRevision() },
    runtime),
  runtime: runtime && runtime.debugInfo(),
  transport: s.transport.debugInfo(),
});

/** The view model with the status the workspace shows (studioStatus). */
function viewOf(s, runtime = s.runtime) {
  const model = s.store.getModel();
  const st = workspace.studioStatus(model, { runtime, engine: s.engine,
    revision: s.store.getRevision() });
  return inspector.runtimeView(model, truthOf(s, runtime), { status: st.nodes,
    edgeStatus: st.edges });
}

test('runtimeView: each divergence state in words, failed PLAY included', () => {
  assert.equal(typeof inspector.runtimeView, 'function', 'inspector.js exports runtimeView');
  const s = ungated();
  // No runtime yet, then a stopped one: nothing is applied, said truthfully.
  for (const rv of [viewOf(s, null), viewOf(s)]) {
    assert.equal(rv.state, 'not-applied');
    assert.equal(rv.label, 'Not applied');
    assert.equal(rv.text, 'Nothing runs. Press Play to apply this Studio.');
    assert.equal(rv.applied, null);
    assert.equal(rv.code, null);
    assert.deepEqual(rv.diagnostics, []);
  }
  ok(s.transport.start());
  s.fx.advance(0.1);
  const run = viewOf(s);
  assert.equal(run.state, 'in-sync');
  assert.equal(run.label, 'Running');
  assert.equal(run.applied.revision, s.store.getRevision());
  assert.equal(run.text, `Revision ${run.applied.revision} plays as edited.`);
  // An edit the runtime has not taken yet: the previous configuration still runs.
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'frequency',
    value: 330 }));
  const behind = viewOf(s);
  assert.equal(behind.state, 'behind');
  assert.equal(behind.label, 'Previous configuration still running');
  assert.equal(behind.text, `Revision ${run.applied.revision} plays; revision `
    + `${s.store.getRevision()} is not applied yet.`);
  ok(s.transport.sync());
  // The runtime refuses the desired revision: refused, with why and its code.
  failNextBiquad(s.fx.ctx);
  ok(s.store.dispatch(TO_HIGHPASS));
  s.transport.sync();
  const refused = viewOf(s);
  assert.equal(refused.state, 'refused');
  assert.equal(refused.label, 'Refused');
  assert.equal(refused.code, 'prepare-failed');
  assert.equal(refused.text, `Revision ${s.store.getRevision()} was refused (injected biquad `
    + `failure). Revision ${s.store.getRevision() - 1} keeps playing.`);
  s.transport.stop();
  // PLAY refused on this revision: failed, with the reason (the runtime is stopped).
  const f = ungated();
  failNextBiquad(f.fx.ctx);
  assert.equal(f.transport.start().ok, false);
  const failed = viewOf(f);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.label, 'Failed');
  assert.equal(failed.text, 'Play failed: injected biquad failure');
  assert.equal(failed.code, 'prepare-failed');
  assert.equal(failed.applied, null);
  assert.equal(failed.diagnostics.length, 1, 'the refusal is the one diagnostic');
  assert.equal(failed.diagnostics[0].code, 'prepare-failed');
  assert.deepEqual(failed.diagnostics[0].entity && failed.diagnostics[0].entity.selection,
    { nodes: ['filter-1'] }, 'the refusal names the node that threw');
  // The Inspector's 'studio' view carries it.
  const view = inspector.inspectorView(f.store.getModel(), EMPTY_SELECTION,
    { truth: truthOf(f) });
  assert.equal(view.runtime.state, 'failed');
  // PLAY then succeeds on the same revision: that refusal is no longer true after STOP.
  ok(f.transport.start());
  assert.equal(viewOf(f).state, 'in-sync');
  f.transport.stop();
  assert.equal(viewOf(f).state, 'not-applied', 'a committed revision clears its refusal');
  assert.equal(f.runtime.lastError, null);
  assert.equal(inspector.runtimeState(null), 'not-applied');
});

test('runtimeView: short identities of the desired and applied Studio, local applied time', () => {
  assert.equal(typeof inspector.shortHash, 'function', 'inspector.js exports shortHash');
  assert.equal(inspector.shortHash('0123456789abcdef'), '01234567');
  assert.equal(inspector.shortHash(null), '—');
  const s = gated();
  const stopped = viewOf(s);
  assert.deepEqual(stopped.desired, { revision: s.store.getRevision(),
    hash: studioHash(s.store.getModel()).slice(0, 8) });
  ok(s.transport.start());
  s.fx.advance(0.1);
  const rec = s.runtime.applied();
  const rv = viewOf(s);
  assert.deepEqual(rv.applied, { revision: rec.revision, planHash: rec.planHash.slice(0, 8),
    at: new Date(rec.at).toLocaleTimeString() });
  assert.match(rv.applied.planHash, /^[0-9a-f]{8}$/);
  s.transport.stop();
});

test('runtimeView: node and cable counts, active lanes and owned parameters', () => {
  // Stopped Measurement Sweep: the compile's status (no microphone API: degraded, its cable
  // has no route); analysis nodes and data cables count as ready and live.
  const m = ungated();
  const model = templateModel(MEASUREMENT_TEMPLATE_ID);
  const st = workspace.studioStatus(model, { engine: m.engine });
  const rv = inspector.runtimeView(model, { verdict: studioDivergence({ model }, m.runtime) },
    { status: st.nodes, edgeStatus: st.edges });
  assert.deepEqual(rv.nodes, { ready: 5, degraded: 1, offline: 0 });
  assert.deepEqual(rv.edges, { live: 4, inactive: 1, 'no-effect': 0 });
  assert.deepEqual(rv.lanes, [], 'nothing runs: no lane is active');
  assert.deepEqual(rv.owned, []);
  // Subtractive Synth with an LFO on the low-pass Q: compiled, a route with no audible effect;
  // running, the runtime holds that route inactive (the adapter does not apply it).
  const s = gated();
  ok(s.store.dispatch({ type: 'EDGE_ADD', from: { node: 'lfo-1', port: 'control' },
    to: { node: 'filter-1', port: 'Q' } }));
  assert.deepEqual(viewOf(s).edges, { live: 5, inactive: 0, 'no-effect': 1 });
  ok(s.transport.start());
  s.fx.advance(0.1);
  const run = viewOf(s);
  assert.deepEqual(run.nodes, { ready: 6, degraded: 0, offline: 0 });
  assert.deepEqual(run.edges, { live: 5, inactive: 1, 'no-effect': 0 });
  assert.deepEqual(run.lanes, ['Filter 1 Cutoff'], 'the transport plays lane-1');
  assert.ok(run.owned.includes('Filter 1 Cutoff'), JSON.stringify(run.owned));
  assert.equal(run.owned.length, s.runtime.ownedParams().length);
  s.transport.stop();
  assert.deepEqual(viewOf(s).owned, [], 'STOP releases every claim');
});

test('a refused live edit names its node: diagnostics with an entity that selects it, and the '
  + 'node status line with the code', () => {
  assert.equal(typeof inspector.runtimeDiagnostics, 'function');
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  failNextBiquad(s.fx.ctx);
  const r = s.store.dispatch(TO_HIGHPASS);
  assert.equal(r.ok, false, 'the gate refuses the edit');
  // Domain: the runtime's refusal names the node whose preparation threw, and the transport's
  // edit-refused diagnostic carries that entity.
  assert.deepEqual(s.runtime.lastError.errors[0].entity, { kind: 'node', id: 'filter-1' });
  const rv = viewOf(s);
  assert.equal(rv.state, 'in-sync', 'with the gate the refused edit never became desired');
  const d = rv.diagnostics.find((x) => x.code === 'edit-refused');
  assert.ok(d, JSON.stringify(rv.diagnostics));
  assert.equal(d.owner, 'transport');
  assert.equal(d.severity, 'warning');
  assert.match(d.message, /Edit refused: .*injected biquad failure/);
  assert.deepEqual(d.entity, { kind: 'node', id: 'filter-1', label: 'Filter 1',
    selection: { nodes: ['filter-1'] } });
  const node = inspector.inspectorView(s.store.getModel(), { nodes: ['filter-1'] },
    { truth: truthOf(s) });
  assert.match(node.statusText, /Edit refused: .*\(edit-refused\)$/);
  assert.equal(node.statusError, true);
  // A later edit the runtime takes: the refusal is no longer current, anywhere.
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1', key: 'Q', value: 2 }));
  assert.equal(viewOf(s).diagnostics.some((x) => x.code === 'edit-refused'), false);
  assert.equal(inspector.inspectorView(s.store.getModel(), { nodes: ['filter-1'] },
    { truth: truthOf(s) }).statusText, '');
  s.transport.stop();
  // A refused attempt's revision number is the next commit's: in another document it is not a
  // refusal of that document (studioHash), so the stopped Studio is not "failed".
  ok(s.transport.start());
  failNextBiquad(s.fx.ctx);
  assert.equal(s.store.dispatch(TO_HIGHPASS).ok, false);
  s.transport.stop();
  s.store.replace(templateModel(MEASUREMENT_TEMPLATE_ID));
  assert.equal(s.store.getRevision(), s.runtime.lastError.revision, 'the same number');
  assert.equal(viewOf(s).state, 'not-applied');
  s.store.replace(templateModel(REFERENCE_TEMPLATE_ID));
  // PLAY starts with the current playback's diagnostics only.
  ok(s.transport.start());
  s.fx.advance(0.1);
  failNextBiquad(s.fx.ctx);
  assert.equal(s.store.dispatch(TO_HIGHPASS).ok, false);
  assert.equal(s.transport.debugInfo().diagnostics.length, 1);
  s.transport.stop();
  ok(s.transport.start());
  assert.deepEqual(s.transport.debugInfo().diagnostics, [], 'a new playback starts clean');
  s.transport.stop();
});

test('diagnostic entities: node, connection, clip and lane link to their selection; a gone one '
  + 'is text only; status codes on node and connection lines', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const d = (code, entity) => ({ code, severity: 'warning', owner: 'runtime', entity,
    message: `${code} message` });
  const truth = {
    verdict: { state: 'in-sync', desired: { revision: 3, studioHash: 'f'.repeat(64) },
      applied: { revision: 3, studioHash: 'f'.repeat(64), planHash: 'a'.repeat(64),
        at: '2026-10-04T10:00:00.000Z' }, reason: null },
    runtime: { diagnostics: [d('route-failed', { kind: 'edge', id: 'edge-4' }),
      d('update-failed', { kind: 'node', id: 'gone-1' }), d('timeline', null)],
    ownedParams: [] },
    transport: { diagnostics: [d('automation-failed', { kind: 'lane', id: 'lane-1' }),
      d('clip-x', { kind: 'clip', id: 'clip-2' })], lanes: [] },
  };
  const rv = inspector.runtimeView(model, truth);
  assert.deepEqual(rv.diagnostics.map((x) => x.entity), [
    { kind: 'edge', id: 'edge-4', label: 'connection from LFO 1 control to Filter 1 cutoff, '
      + 'depth 1 octave, bipolar', selection: { edges: ['edge-4'] } },
    { kind: 'node', id: 'gone-1', label: 'gone-1', selection: null },
    null,
    { kind: 'lane', id: 'lane-1', label: 'Filter 1 Cutoff lane',
      selection: { nodes: ['filter-1'], points: ['pt-1', 'pt-2'] } },
    { kind: 'clip', id: 'clip-2', label: 'pattern clip', selection: { clips: ['clip-2'] } },
  ]);
  // A stopped runtime's stale records are not current: only the verdict's reason would show.
  assert.deepEqual(inspector.runtimeDiagnostics({ ...truth, verdict: { ...truth.verdict,
    state: 'not-applied', applied: null } }), []);
  // The connection line: route text (code) and the diagnostics naming the connection.
  const edge = inspector.inspectorView(model, { edges: ['edge-4'] }, { truth,
    edgeStatus: new Map([['edge-4', { status: 'inactive', code: 'not-in-runtime',
      reason: 'Not in the running graph.' }]]) });
  assert.equal(edge.statusText, 'No Web Audio route: Not in the running graph. (not-in-runtime)'
    + ' · route-failed message (route-failed)');
  // The node line: label (code) and the structured reason.
  const node = inspector.inspectorView(model, { nodes: ['osc-1'] }, {
    status: new Map([['osc-1', { status: 'degraded', code: 'no-web-audio', reason: 'No audio.' }]]) });
  assert.equal(node.statusText, 'Unavailable (no-web-audio) · No audio.');
  assert.equal(node.code, 'no-web-audio');
});
