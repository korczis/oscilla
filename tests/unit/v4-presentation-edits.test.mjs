// R9 (docs/v4/completion-ledger.md, P2): a presentation-only Studio edit while playing (a node
// moved or renamed, a marker, the Studio title: anything the execution state, and so the audio
// graph, does not depend on; schema.js executionState) skips the compile and the runtime
// transaction. Before this change every such edit, through the store's commit gate
// (transport.admit), compiled the whole model, diffed it, ran an empty transaction and re-planned
// the timeline. ADR 0039 stays true: the applied record moves to the new revision with the same
// plan (its planHash unchanged), and the divergence verdict stays in-sync.
//   node --test tests/unit/v4-presentation-edits.test.mjs
// Wiring is the workspace's (as tests/unit/v31-studio-trace.test.mjs): createStoreHandle with the
// commit gate transport.admit, the transport and runtime on the real AudioEngine over the fake
// AudioContext of sequencer-fake-audio.mjs, one trace port for all three. A compile is a runtime
// `compile` step of the trace (runtime.js records one for every compileStudio it runs).
// Namespace imports: each test fails on its own assertion on the code before this change.
// Tolerances: none (identity and counts).
// Round 1 of the adversarial review (#155): a node rename is not presentation-only (its name
// reaches the plan's validation warnings, so the runtime diagnostics); setOptions compiles the
// store's current model; the automation and track clauses of sameExecutionState, the transport's
// early returns and adopt's lastError clearing each have a test that fails when they are removed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createTrace } from '../../src/js/core/trace.js';
import * as runtimeModule from '../../src/js/studio/runtime.js';
import * as schema from '../../src/js/studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import { createStoreHandle } from '../../src/js/ui/studio/workspace.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

/**
 * As the workspace wires it, playing: { fx, runtime, store, transport, trace }. `gated: false`
 * leaves out the commit gate, so that every edit reaches the transport through `sync`.
 */
function playing(model = templateModel(REFERENCE_TEMPLATE_ID), { gated = true } = {}) {
  const trace = createTrace();
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = runtimeModule.createStudioRuntime({ engine, trace });
  let transport = null;
  const store = createStoreHandle(model, { trace, gate: gated
    ? (next, info) => (transport ? transport.admit(next, info) : null) : undefined });
  transport = createStudioTransport({ runtime, engine, store, trace });
  store.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
  ok(transport.start());
  fx.advance(0.4);
  return { fx, engine, runtime, store, transport, trace };
}

/** What one operation cost: compiles, runtime ops and every Web Audio write it made. */
function cost(s, fn) {
  const last = () => { const st = s.trace.steps(); return st.length ? st[st.length - 1].seq : 0; };
  const seq0 = last();
  const created0 = s.fx.ctx.created.length;
  const calls = () => s.fx.ctx.created.reduce((sum, n) => sum + Object.values(n)
    .filter((v) => v && Array.isArray(v.calls)).reduce((k, p) => k + p.calls.length, 0), 0);
  const calls0 = calls();
  const r = fn();
  const steps = s.trace.steps().filter((x) => x.seq > seq0);
  return {
    r,
    compiles: steps.filter((x) => x.owner === 'runtime' && x.kind === 'compile').length,
    transactions: steps.filter((x) => x.owner === 'runtime' && x.kind === 'apply'
      && x.outcome === 'applied').length,
    nodesCreated: s.fx.ctx.created.length - created0,
    paramWrites: calls() - calls0,
  };
}

/** The ADR 0039 truth after an edit: the record names the store revision; in sync. */
function truth(s) {
  const applied = s.runtime.applied();
  const verdict = runtimeModule.studioDivergence({ model: s.store.getModel(),
    revision: s.store.getRevision() }, s.runtime);
  return { applied, verdict };
}

const PRESENTATION = [
  ['move one node', () => ({ type: 'NODE_MOVE', nodeId: 'filter-1', position: { x: 333, y: 77 } })],
  ['move two nodes', () => ({ type: 'NODE_MOVE', nodeIds: ['osc-1', 'env-1'],
    delta: { x: 16, y: -8 } })],
  ['add a marker', () => ({ type: 'MARKER_ADD', time: 1.5, kind: 'custom', label: 'Here' })],
  ['retitle the Studio', () => ({ type: 'METADATA_SET', title: 'Renamed', notes: 'n' })],
];

test('R9: a presentation-only edit while playing compiles nothing and touches no audio', () => {
  const s = playing();
  const before = truth(s);
  assert.equal(before.verdict.state, 'in-sync');
  for (const [what, action] of PRESENTATION) {
    const tBefore = s.transport.debugInfo();
    const c = cost(s, () => s.store.dispatch(action()));
    ok(c.r);
    // The transport re-planned nothing: no scheduler.edit decision, nothing rescheduled.
    const tAfter = s.transport.debugInfo();
    assert.equal(tAfter.decisions.length, tBefore.decisions.length,
      `${what}: no timeline re-plan (scheduler.edit decided nothing)`);
    assert.equal(tAfter.scheduledUntil, tBefore.scheduledUntil, `${what}: horizon unchanged`);
    assert.deepEqual(tAfter.lanes, tBefore.lanes, `${what}: lanes as they were`);
    const admit = s.trace.steps().filter((x) => x.owner === 'transport' && x.kind === 'admit')
      .at(-1);
    assert.equal(admit.outcome, 'presentation-only', `${what}: transport admit outcome`);
    assert.equal(c.compiles, 0, `${what}: no compile`);
    assert.equal(c.transactions, 0, `${what}: no runtime transaction`);
    assert.equal(c.nodesCreated, 0, `${what}: no Web Audio node built`);
    assert.equal(c.paramWrites, 0, `${what}: no AudioParam written (nor the timeline re-planned)`);
    const t = truth(s);
    assert.equal(t.applied.revision, s.store.getRevision(), `${what}: the record's revision`);
    assert.equal(t.applied.planHash, before.applied.planHash, `${what}: the plan identity`);
    assert.equal(t.applied.studioHash, before.applied.studioHash, `${what}: the studio hash`);
    assert.equal(t.verdict.state, 'in-sync', `${what}: no divergence`);
    assert.equal(t.verdict.reason, null);
  }
  // Undo and redo of a presentation edit are presentation edits too.
  for (const step of ['undo', 'redo']) {
    const c = cost(s, () => s.store[step]());
    ok(c.r);
    assert.equal(c.compiles, 0, `${step}: no compile`);
    assert.equal(truth(s).verdict.state, 'in-sync', `${step}: no divergence`);
  }
  // Nothing was refused or warned on the way.
  assert.equal(s.transport.debugInfo().diagnostics.length, 0);
  assert.equal(s.runtime.lastError, null);
  s.transport.stop({ fast: true });
});

test('R9: an audio edit while playing compiles exactly once and changes the plan', () => {
  const s = playing();
  const before = truth(s);
  const c = cost(s, () => s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1',
    key: 'detune', value: 7 }));
  ok(c.r);
  assert.equal(c.compiles, 1, 'one compile');
  assert.equal(c.transactions, 1, 'one runtime transaction');
  assert.ok(c.paramWrites > 0, 'the new detune reaches the oscillator');
  const t = truth(s);
  assert.equal(t.applied.revision, s.store.getRevision());
  assert.notEqual(t.applied.planHash, before.applied.planHash, 'a new plan identity');
  assert.equal(t.verdict.state, 'in-sync');
  // A move after it is presentation again; a node added after that compiles once.
  assert.equal(cost(s, () => s.store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1',
    position: { x: 1, y: 2 } })).compiles, 0);
  const add = cost(s, () => s.store.dispatch({ type: 'NODE_ADD', nodeType: 'gain',
    position: { x: 40, y: 40 } }));
  ok(add.r);
  assert.equal(add.compiles, 1);
  assert.equal(truth(s).verdict.state, 'in-sync');
  s.transport.stop({ fast: true });
});

test('R9: new capabilities still recompile the same model (setOptions)', () => {
  const s = playing();
  const before = truth(s).applied;
  const c = cost(s, () => s.runtime.setOptions({ inputPermission: true }));
  ok(c.r);
  assert.equal(c.compiles, 1, 'the same model under new options is compiled');
  assert.equal(truth(s).applied.revision, before.revision, 'same revision');
  s.transport.stop({ fast: true });
});

test('R9 review: a presentation edit that reaches the transport by sync re-plans nothing',
  () => {
  const s = playing(undefined, { gated: false });
  for (const [what, action] of PRESENTATION) {
    const tBefore = s.transport.debugInfo();
    const c = cost(s, () => s.store.dispatch(action()));
    ok(c.r);
    assert.equal(c.compiles, 0, `${what}: no compile`);
    const sync = s.trace.steps().filter((x) => x.owner === 'transport' && x.kind === 'sync')
      .at(-1);
    assert.equal(sync && sync.outcome, 'presentation-only', `${what}: transport sync outcome`);
    const tAfter = s.transport.debugInfo();
    assert.equal(tAfter.decisions.length, tBefore.decisions.length,
      `${what}: no timeline re-plan (scheduler.edit decided nothing)`);
    assert.equal(tAfter.scheduledUntil, tBefore.scheduledUntil, `${what}: horizon unchanged`);
    assert.deepEqual(tAfter.lanes, tBefore.lanes, `${what}: lanes as they were`);
    assert.equal(c.paramWrites, 0, `${what}: no AudioParam written`);
  }
  // A parameter edit by the same path re-plans (the check above can see one).
  const before = s.transport.debugInfo().decisions.length;
  ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'detune', value: 7 }));
  assert.ok(s.transport.debugInfo().decisions.length > before, 'a real edit re-plans');
  s.transport.stop({ fast: true });
});

test('R9 review: a rename while playing reaches the runtime diagnostics with the new name', () => {
  const s = playing();
  // An oscillator that reaches nothing: validation warns, naming it.
  const add = ok(s.store.dispatch({ type: 'NODE_ADD', nodeType: 'oscillator',
    position: { x: 60, y: 60 } }));
  const id = add.created.nodes[0];
  const old = s.store.getModel().graph.nodes.find((n) => n.id === id).metadata.name;
  const named = (name) => s.runtime.debugInfo().warnings
    .filter((w) => w.startsWith(`${name} does not reach Master Output`));
  assert.equal(named(old).length, 1, `the unreachable ${old} is warned about`);
  const c = cost(s, () => s.store.dispatch({ type: 'NODE_RENAME', nodeId: id, name: 'Pad' }));
  ok(c.r);
  assert.equal(named('Pad').length, 1, 'the warning names the new name');
  assert.equal(named(old).length, 0, 'and not the old one');
  assert.equal(c.compiles, 1, 'a rename compiles (names reach the plan warnings)');
  assert.ok(!s.runtime.debugInfo().diagnostics.some((d) => d.message.includes(old)),
    'no diagnostic keeps the old name');
  assert.equal(truth(s).verdict.state, 'in-sync');
  // New capabilities (Allow microphone) recompile the renamed document, not the old one.
  ok(s.runtime.setOptions({ inputPermission: true }));
  assert.equal(named('Pad').length, 1, 'after setOptions: the new name');
  assert.equal(named(old).length, 0, 'after setOptions: never the old name again');
  s.transport.stop({ fast: true });
});

test('R9 review: after any presentation edit, setOptions compiles the store\'s current model',
  () => {
  const s = playing();
  let permission = false;
  for (const [what, action] of PRESENTATION) {
    ok(s.store.dispatch(action()));
    permission = !permission;
    const c = cost(s, () => s.runtime.setOptions({ inputPermission: permission }));
    ok(c.r);
    assert.equal(c.compiles, 1, `${what}: setOptions compiles`);
    assert.equal(s.runtime.plan.model, s.store.getModel(),
      `${what}: the compiled model is the store's current model`);
    const t = truth(s);
    assert.equal(t.applied.revision, s.store.getRevision(), `${what}: same revision`);
    assert.equal(t.verdict.state, 'in-sync', `${what}: in sync`);
  }
  s.transport.stop({ fast: true });
});

test('R9 review: an automation edit while playing is not presentation-only', () => {
  const s = playing();
  for (const [what, action] of [
    ['move an automation point', { type: 'AUTOMATION_POINT_MOVE', laneId: 'lane-1',
      pointId: 'pt-2', value: 6000 }],
    ['add an automation point', { type: 'AUTOMATION_POINT_ADD',
      target: { node: 'filter-1', param: 'frequency' }, time: 1.5, value: 2000 }],
  ]) {
    const c = cost(s, () => s.store.dispatch(action));
    ok(c.r);
    assert.equal(c.compiles, 1, `${what}: compiles`);
    const admit = s.trace.steps().filter((x) => x.owner === 'transport' && x.kind === 'admit')
      .at(-1);
    assert.equal(admit.outcome, 'admitted', `${what}: the transport re-plans the lane`);
    assert.equal(truth(s).verdict.state, 'in-sync', `${what}: in sync`);
  }
  s.transport.stop({ fast: true });
});

test('R9 review: a refusal is cleared when a presentation edit takes its revision number', () => {
  const s = playing();
  const revision = s.store.getRevision();
  // The next filter the running graph builds throws: the edit is refused at revision + 1.
  const ctx = s.fx.ctx;
  const own = Object.prototype.hasOwnProperty.call(ctx, 'createBiquadFilter');
  const original = ctx.createBiquadFilter;
  ctx.createBiquadFilter = function failing() {
    if (own) ctx.createBiquadFilter = original;
    else delete ctx.createBiquadFilter;
    throw new Error('injected biquad failure');
  };
  const refused = s.store.dispatch({ type: 'NODE_ADD', nodeType: 'filter',
    position: { x: 40, y: 40 } });
  assert.equal(refused.ok, false, 'the edit is refused');
  assert.equal(s.store.getRevision(), revision, 'the store kept its revision');
  assert.ok(s.runtime.lastError, 'the runtime holds the refusal');
  assert.equal(s.runtime.lastError.revision, revision + 1);
  // A move takes that revision number without a transaction: the refusal is no longer true.
  const c = cost(s, () => s.store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1',
    position: { x: 5, y: 5 } }));
  ok(c.r);
  assert.equal(c.compiles, 0, 'the move is presentation-only');
  assert.equal(s.store.getRevision(), revision + 1);
  assert.equal(s.runtime.lastError, null, 'adopt clears the refusal of its revision');
  assert.equal(truth(s).verdict.state, 'in-sync');
  s.transport.stop({ fast: true });
});

test('R9: while stopped, PLAY after presentation edits builds the graph of the document', () => {
  const s = playing();
  ok(s.store.dispatch({ type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Lead' }));
  s.transport.stop({ fast: true });
  s.fx.advance(0.5);
  ok(s.store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1', position: { x: 9, y: 9 } }));
  ok(s.transport.start());
  const t = truth(s);
  assert.equal(t.applied.revision, s.store.getRevision());
  assert.equal(t.verdict.state, 'in-sync');
  assert.equal(s.runtime.nodes.get('osc-1').name, 'Lead', 'built from the current document');
  s.transport.stop({ fast: true });
});

test('R9: sameExecutionState agrees with the studio hash on every edit, never claims more',
  () => {
  assert.equal(typeof schema.sameExecutionState, 'function',
    'schema.js exports sameExecutionState');
  const base = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStoreHandle(base);
  const actions = [
    ...PRESENTATION.map(([, a]) => a()),
    { type: 'MARKER_MOVE', markerId: null, time: 2 },
    { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'detune', value: 3 },
    { type: 'EDGE_UPDATE', edgeId: base.graph.edges[0].id, props: { muted: true } },
    { type: 'LOOP_SET', enabled: true, start: 0, end: 2 },
    { type: 'TRANSPORT_SET', tempo: 90 },
    { type: 'CLIP_MOVE', clipId: base.timeline.clips[0].id, start: 0.25 },
    { type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Lead' },
    { type: 'AUTOMATION_POINT_MOVE', laneId: 'lane-1', pointId: 'pt-2', value: 6000 },
    { type: 'AUTOMATION_POINT_ADD', target: { node: 'filter-1', param: 'frequency' }, time: 1.5,
      value: 2000 },
    { type: 'NODE_ADD', nodeType: 'gain', position: { x: 0, y: 0 } },
  ];
  let seen = 0;
  for (const a of actions) {
    if (a.type === 'MARKER_MOVE') a.markerId = store.getModel().timeline.markers[0].id;
    const prev = store.getModel();
    const r = store.dispatch(a);
    if (!r.ok || !r.changed) continue;
    const next = store.getModel();
    const same = schema.studioHash(prev) === schema.studioHash(next);
    assert.equal(schema.sameExecutionState(prev, next), same, `${a.type}`);
    assert.equal(schema.sameExecutionState(next, prev), same, `${a.type} (symmetric)`);
    seen++;
  }
  assert.equal(seen, actions.length, 'every action changed the document');
  // A track retargeted (no action does it alone; NODE_REMOVE clears targets with the node): the
  // studio hash covers the target, so it is execution state.
  const m = store.getModel();
  const retargeted = { ...m, timeline: { ...m.timeline, tracks: m.timeline.tracks.map((t, i) =>
    (i === 0 ? { ...t, target: 'filter-1' } : t)) } };
  assert.notEqual(schema.studioHash(m), schema.studioHash(retargeted), 'the hash covers it');
  assert.equal(schema.sameExecutionState(m, retargeted), false, 'a track retarget');
  assert.equal(schema.sameExecutionState(retargeted, m), false, 'a track retarget (symmetric)');
  const automationMoved = { ...m, timeline: { ...m.timeline, automation: m.timeline.automation
    .map((l) => ({ ...l, points: l.points.map((p) => ({ ...p, value: p.value + 1 })) })) } };
  assert.equal(schema.sameExecutionState(m, automationMoved), false, 'automation values');
  // Equal content in new objects is the same execution state; a reordered node list is not
  // claimed to be (conservative: it compiles).
  const copy = JSON.parse(JSON.stringify(base));
  assert.equal(schema.sameExecutionState(base, copy), true);
  const reordered = { ...base, graph: { ...base.graph, nodes: [...base.graph.nodes].reverse() } };
  assert.equal(schema.sameExecutionState(base, reordered), false);
  });
