// The Studio operation trace (ADR 0042): the bounded ring of core/trace.js, and one correlation
// id followed from the store's intent through the compiled plan and the runtime apply to the
// AudioParam the runtime scheduled, including a refused live edit and an edit made while
// stopped; the Inspector's Trace view model; the trace is not evidence (no hash moves); the
// traced drag stays within the one-frame budget.
//   node --test tests/unit/v31-studio-trace.test.mjs
// Wiring is the workspace's: createStoreHandle with the commit gate transport.admit, the
// transport and runtime on the real AudioEngine over the fake AudioContext of
// sequencer-fake-audio.mjs, one trace port handed to all three. createBiquadFilter is made to
// throw once to refuse a transaction in its prepare phase (as in v431-studio-refused-edit).
// Namespace imports: each test fails on its own assertion on the code before this change.
// Tolerances: none (identity, counts and text), except the performance budget (one frame).

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import * as traceModule from '../../src/js/core/trace.js';
import { planHash, ROUTE_FLOOR, STUDIO_XFADE_S } from '../../src/js/studio/compiler.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { normalizeStudio, serializeStudio, studioHash } from '../../src/js/studio/schema.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import * as workspace from '../../src/js/ui/studio/workspace.js';
import { PERF_BUDGETS, buildLargeStudio } from './fixtures/v31-large-studio.mjs';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const ADD_FILTER = { type: 'NODE_ADD', nodeType: 'filter', position: { x: 40, y: 40 } };
const DETUNE = { type: 'NODE_PARAM_SET', nodeId: 'osc-1', key: 'detune', value: 7 };

function ok(r) {
  assert.ok(r && r.ok, (r && (r.reason || JSON.stringify(r.errors))) || 'no result');
  return r;
}

function newTrace(opts) {
  assert.equal(typeof traceModule.createTrace, 'function', 'core/trace.js exports createTrace');
  return traceModule.createTrace(opts);
}

/** As the workspace wires it: one trace port for the store handle, runtime and transport. */
function gated(model = templateModel(REFERENCE_TEMPLATE_ID), trace = newTrace()) {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine, trace });
  let transport = null;
  const store = workspace.createStoreHandle(model, { trace,
    gate: (next, info) => (transport ? transport.admit(next, info) : null) });
  transport = createStudioTransport({ runtime, engine, store, trace });
  store.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
  return { fx, engine, runtime, store, transport, trace };
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

/** The steps recorded by `fn` (the trace's new tail). */
function stepsOf(s, fn) {
  const before = s.trace.stats().ops;
  const r = fn();
  const steps = s.trace.steps().filter((x) => Number(x.op.slice(3)) > before);
  return { r, steps };
}
const find = (steps, owner, kind) => steps.find((x) => x.owner === owner && x.kind === kind);

test('the trace ring keeps the last cap steps in order, counts the dropped ones and freezes '
  + 'each', () => {
  let clock = 1000;
  const t = newTrace({ cap: 4, now: () => clock++ });
  const first = t.run(() => {
    t.record('a', 'one', { revision: 3, entity: { kind: 'node', id: 'osc-1', extra: 1 },
      outcome: 'done', detail: { value: 2, list: [1, 2], obj: { x: 1 }, none: undefined } });
    return t.run(() => t.record('b', 'two'));
  });
  assert.equal(first.op, 'op-1', 'a nested run joins the open operation');
  const solo = t.record('c', 'three');
  assert.equal(solo.op, 'op-2', 'a step outside any run is an operation of its own');
  assert.throws(() => t.run(() => { throw new Error('producer broke'); }), /producer broke/);
  t.run(() => t.record('d', 'four'));
  assert.equal(t.steps().at(-1).op, 'op-4', 'a throwing producer closes its operation');
  t.record('e', 'five');
  const steps = t.steps();
  assert.equal(steps.length, 4, 'the cap holds');
  assert.deepEqual(steps.map((x) => x.kind), ['two', 'three', 'four', 'five'], 'oldest first');
  assert.deepEqual(steps.map((x) => x.seq), [2, 3, 4, 5], 'seq is monotonic');
  assert.deepEqual(t.stats(), { cap: 4, size: 4, dropped: 1, ops: 5 });
  for (const x of steps) {
    assert.ok(Object.isFrozen(x), 'every step is frozen');
    assert.deepEqual(Object.keys(x), ['op', 'seq', 'at', 'owner', 'kind', 'revision', 'entity',
      'outcome', 'code', 'detail']);
  }
  const t2 = newTrace({ cap: 8 });
  const s = t2.record('a', 'k', { entity: { kind: 'node', id: 'n', extra: 1 },
    detail: { value: 2, list: [1, 2], obj: { x: 1 }, none: undefined } });
  assert.equal(s.at, null, 'no clock: no time');
  assert.deepEqual(s.entity, { kind: 'node', id: 'n' });
  assert.ok(Object.isFrozen(s.entity) && Object.isFrozen(s.detail));
  assert.deepEqual(s.detail, { value: 2, list: null, obj: null, none: null },
    'detail is flat primitives: nothing shared with the producer');
  assert.equal(steps[0].at, 1001, 'at is the injected clock');
  assert.equal(traceModule.NO_TRACE.run(() => 5), 5);
  assert.equal(traceModule.NO_TRACE.record('a', 'b'), null);
  // A long run allocates no more than the cap.
  for (let i = 0; i < 1000; i++) t2.record('x', 'y');
  assert.equal(t2.steps().length, 8);
  assert.equal(t2.stats().dropped, 1001 - 8);
});

test('a parameter edit while playing: one op on the action, the compile with its planHash, the '
  + 'apply and the AudioParam the runtime scheduled', () => {
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  const { r, steps } = stepsOf(s, () => s.store.dispatch(DETUNE));
  ok(r);
  const rev = s.store.getRevision();
  const ops = new Set(steps.map((x) => x.op));
  assert.equal(ops.size, 1, `one correlation id, got ${[...ops]}`);
  const action = find(steps, 'store', 'action');
  assert.deepEqual([action.outcome, action.entity, action.detail.type, action.detail.key,
    action.detail.value], ['requested', { kind: 'node', id: 'osc-1' }, 'NODE_PARAM_SET',
    'detune', 7]);
  assert.equal(steps[0], action, 'the intent comes first');
  const compile = find(steps, 'runtime', 'compile');
  assert.equal(compile.outcome, 'compiled');
  assert.equal(compile.revision, rev, 'the store revision is the shared id');
  assert.match(compile.detail.planHash, /^[0-9a-f]{64}$/);
  assert.equal(compile.detail.planHash, planHash(s.runtime.plan), 'the plan that runs');
  assert.equal(compile.detail.planHash, s.runtime.applied().planHash, 'the applied record');
  const apply = find(steps, 'runtime', 'apply');
  assert.deepEqual([apply.outcome, apply.revision], ['applied', rev]);
  const param = find(steps, 'runtime', 'param');
  assert.deepEqual([param.outcome, param.entity, param.detail.param, param.detail.value,
    param.detail.unit, param.detail.via], ['scheduled', { kind: 'node', id: 'osc-1' },
    'detune', 7, 'cents', 'base']);
  // The step is what reached the AudioParam: the same value at the same audio time.
  const audioParam = s.runtime.nodes.get('osc-1').modTarget('detune', 'linear').param;
  assert.deepEqual(audioParam.calls.at(-1).slice(0, 3), ['setTargetAtTime', 7, param.detail.at]);
  assert.deepEqual([find(steps, 'transport', 'admit').outcome,
    find(steps, 'store', 'commit').outcome, find(steps, 'store', 'commit').revision],
  ['admitted', 'committed', rev]);
  assert.ok(steps.indexOf(apply) < steps.indexOf(param), 'applied, then its parameter');
  // A lane drives the filter cutoff: the runtime does not write it and says so.
  const cut = stepsOf(s, () => s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-1',
    key: 'frequency', value: 1500 })).steps;
  const owned = find(cut, 'runtime', 'param');
  assert.deepEqual([owned.outcome, owned.detail.param], ['owned', 'frequency']);
  s.transport.stop();
});

test('a topology edit while playing: the same op on the node built and the route gains ramped',
  () => {
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  const edge = s.store.getModel().graph.edges.find((e) => e.from.node === 'env-1');
  const removed = stepsOf(s, () => s.store.dispatch({ type: 'EDGE_REMOVE', edgeId: edge.id }));
  ok(removed.r);
  assert.equal(new Set(removed.steps.map((x) => x.op)).size, 1);
  const out = find(removed.steps, 'runtime', 'route');
  assert.deepEqual([out.outcome, out.entity, out.detail.gain], ['scheduled',
    { kind: 'edge', id: edge.id }, ROUTE_FLOOR]);
  assert.ok(Math.abs(out.detail.end - out.detail.at - STUDIO_XFADE_S) < 1e-9, 'one crossfade');
  const back = stepsOf(s, () => s.store.undo());
  ok(back.r);
  const [undo, ...rest] = back.steps;
  assert.deepEqual([undo.owner, undo.kind], ['store', 'undo']);
  const compile = find(rest, 'runtime', 'compile');
  assert.match(compile.detail.planHash, /^[0-9a-f]{64}$/);
  const into = find(rest, 'runtime', 'route');
  assert.deepEqual([into.op, into.entity.id, into.detail.gain], [undo.op, edge.id, 1]);
  const gain = s.runtime.edges.get(edge.id).gain.gain;
  assert.deepEqual(gain.calls.at(-1), ['linearRampToValueAtTime', 1, into.detail.end],
    'the route step is the ramp the edge gain got');
  const added = stepsOf(s, () => s.store.dispatch(ADD_FILTER));
  const id = ok(added.r).created.nodes[0];
  const built = find(added.steps, 'runtime', 'node');
  assert.deepEqual([built.outcome, built.entity, built.op], ['built', { kind: 'node', id },
    added.steps[0].op]);
  s.transport.stop();
});

test('a live edit the running graph cannot take: the refusal is traced with its diagnostic '
  + 'codes, and nothing claims it applied', () => {
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  const revision = s.store.getRevision();
  failNextBiquad(s.fx.ctx);
  const { r, steps } = stepsOf(s, () => s.store.dispatch(ADD_FILTER));
  assert.equal(r.ok, false);
  assert.equal(new Set(steps.map((x) => x.op)).size, 1);
  const apply = find(steps, 'runtime', 'apply');
  assert.deepEqual([apply.outcome, apply.code, apply.revision], ['refused', 'prepare-failed',
    revision + 1], 'the revision the commit would have had');
  assert.equal(apply.entity.kind, 'node', 'it names the node that threw');
  assert.match(apply.detail.reason, /injected biquad failure/);
  const admit = find(steps, 'transport', 'admit');
  assert.deepEqual([admit.outcome, admit.code], ['refused', 'edit-refused']);
  const commit = find(steps, 'store', 'commit');
  assert.deepEqual([commit.outcome, commit.revision], ['refused', null]);
  assert.match(commit.detail.reason, /Edit refused/);
  assert.ok(!steps.some((x) => x.outcome === 'applied' || x.kind === 'param'),
    'no apply and no parameter step for a refused edit');
  const tv = inspector.traceView(s.store.getModel(), s.trace.steps());
  assert.equal(tv.ops[0].op, apply.op, 'newest first');
  assert.match(tv.ops[0].outcome, /^refused \(prepare-failed\)$/);
  assert.ok(tv.ops[0].steps.some((x) => /^transport admit: refused \(edit-refused\)/
    .test(x.text)));
  s.transport.stop();
});

test('an edit while stopped says it was not applied; PLAY is its own op', () => {
  const s = gated();
  const { steps } = stepsOf(s, () => ok(s.store.dispatch(DETUNE)));
  const admit = find(steps, 'transport', 'admit');
  assert.deepEqual([admit.outcome, admit.detail.playing], ['not-applied', false]);
  assert.ok(!find(steps, 'runtime', 'compile'), 'the runtime was not asked');
  assert.equal(find(steps, 'store', 'commit').outcome, 'committed');
  const play = stepsOf(s, () => ok(s.transport.start())).steps;
  assert.equal(new Set(play.map((x) => x.op)).size, 1);
  assert.deepEqual(play.map((x) => `${x.owner} ${x.kind} ${x.outcome}`), [
    'runtime compile compiled', 'runtime apply not-applied', 'runtime apply applied',
    'transport play playing']);
  const stop = stepsOf(s, () => s.transport.stop()).steps;
  assert.deepEqual(stop.map((x) => `${x.owner} ${x.kind} ${x.outcome}`), [
    'transport stop stopped', 'runtime stop stopped']);
  const tv = inspector.traceView(s.store.getModel(), s.trace.steps(), { nodeId: 'osc-1' });
  assert.equal(tv.total, 1, 'filtered to the node: only the op that named osc-1');
  assert.match(tv.ops[0].title, /Detune/);
  assert.ok(tv.ops[0].steps.some((x) => /^transport admit: not-applied · rev \d+ · playing false/
    .test(x.text)), JSON.stringify(tv.ops[0].steps));
});

test('the trace is not evidence: the same edits give the same hashes with and without it', () => {
  const run = (trace) => {
    const s = trace ? gated(undefined, trace) : (() => {
      const fx = createFakeAudioEnv({ sampleRate: SR });
      const engine = new AudioEngine({ env: fx.env });
      engine.init();
      const runtime = createStudioRuntime({ engine });
      let transport = null;
      const store = workspace.createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), {
        gate: (next, info) => (transport ? transport.admit(next, info) : null) });
      transport = createStudioTransport({ runtime, engine, store });
      store.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
      return { fx, runtime, store, transport };
    })();
    ok(s.transport.start());
    s.fx.advance(0.1);
    ok(s.store.dispatch(DETUNE));
    ok(s.store.dispatch(ADD_FILTER));
    const m = s.store.getModel();
    const out = { studio: studioHash(m), plan: s.runtime.applied().planHash,
      text: serializeStudio(m) };
    s.transport.stop();
    return out;
  };
  const trace = newTrace();
  const traced = run(trace);
  const plain = run(null);
  assert.ok(trace.steps().some((x) => x.kind === 'compile' && x.detail.planHash === traced.plan),
    'the traced run did trace, down to the plan that runs');
  assert.deepEqual(traced, plain);
  assert.ok(!/op-\d/.test(traced.text), 'nothing of the trace is in the document');
});

test('the traced drag: a parameter dispatch on the 100-node Studio while playing stays within '
  + 'one frame', (t) => {
  const s = gated(normalizeStudio({}), newTrace());
  buildLargeStudio(s.store);
  // The fixture has no clips: a loop region keeps it playing, so every edit is a live one.
  ok(s.store.dispatch({ type: 'LOOP_SET', enabled: true, start: 0, end: 8 }));
  ok(s.transport.start());
  s.fx.advance(0.1);
  assert.ok(s.transport.playing, 'playing while measured');
  const xs = [];
  for (let i = -1; i < 15; i++) {
    const t0 = performance.now();
    ok(s.store.dispatch({ type: 'NODE_PARAM_SET', nodeId: 'filter-12', key: 'frequency',
      value: 500 + 10 * (i + 2) }));
    if (i >= 0) xs.push(performance.now() - t0);
  }
  const min = Math.min(...xs);
  t.diagnostic(`traced dispatchParam while playing, 100 nodes: ${min.toFixed(3)} ms `
    + `(budget ${PERF_BUDGETS.dispatchParam.toFixed(1)})`);
  assert.ok(min <= PERF_BUDGETS.dispatchParam, `${min.toFixed(2)} ms`);
  const last = s.trace.steps().filter((x) => x.op === s.trace.steps().at(-1).op);
  assert.ok(last.some((x) => x.kind === 'compile') && last.some((x) => x.kind === 'param'
    && x.entity.id === 'filter-12'), 'every measured dispatch was traced to its parameter');
  assert.ok(s.trace.steps().length <= traceModule.TRACE_CAP);
  s.transport.stop();
});
