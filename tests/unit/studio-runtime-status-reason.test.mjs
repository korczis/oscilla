// C027: the Studio status of a node or cable the running graph does not reflect says WHY, by the
// divergence verdict (runtime.js studioDivergence) rather than one sentence for every state.
// Before the fix graph-view.js runtimeStatus said "the last update was refused" for 'behind'
// and 'not-applied' too, quoted an old unrelated runtime.lastError for 'behind', and for
// 'refused' dropped the diagnostic's node or edge and its code (and all of it without a
// message). The status now names the runtime's diagnostic (message, entity, code) and carries
// `cause: { node | edge, code }`, which the Inspector offers as a jump. Armed (the plan is
// liveModel's), a node the live model leaves out on purpose is 'outside-live', not an error.
//   node --test tests/unit/studio-runtime-status-reason.test.mjs
// Wiring: graph-view.js runtimeStatus over a plain runtime record (state, applied(), lastError,
// plan, unresolved()), and once over the real AudioEngine on the fake AudioContext of
// sequencer-fake-audio.mjs with createBiquadFilter made to throw once (a prepare refusal).
// Namespace imports: each test fails on its own assertion on the code before this change.
// Tolerances: none (text and identity).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
import * as graphView from '../../src/js/ui/studio/graph-view.js';
import * as inspector from '../../src/js/ui/studio/inspector.js';
import { liveModel } from '../../src/js/studio/live-notes.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';
import { panelStore } from './synth-fixture.mjs';

const SR = 48000;
const ADD_FILTER = { type: 'NODE_ADD', nodeType: 'filter', position: { x: 40, y: 40 } };
const ADD_LFO = { type: 'NODE_ADD', nodeType: 'lfo', position: { x: 80, y: 80 } };
const OLD = 'old unrelated failure';

/**
 * A runtime record as runtimeStatus reads it: the reference template's plan without the nodes
 * in `missing` (and their cables), applied as revision `applied` while running.
 */
function fakeRuntime(model, { state = 'running', applied = 3, lastError = null,
  missing = [] } = {}) {
  const nodes = model.graph.nodes.filter((n) => !missing.includes(n.id));
  const edges = model.graph.edges.filter((e) => !missing.includes(e.from.node)
    && !missing.includes(e.to.node));
  return {
    state,
    lastError,
    plan: {
      model: { ...model, graph: { ...model.graph, nodes, edges } },
      nodes: new Map(nodes.map((n) => [n.id, { type: n.type, params: n.params,
        status: 'ready' }])),
      edges: new Map(edges.map((e) => [e.id, { status: 'ready' }])),
    },
    nodes: new Map(),
    edges: new Map(),
    applied: () => (state === 'running' ? { revision: applied, studioHash: 'applied' } : null),
    unresolved: () => [],
  };
}

const refusal = (revision, diag) => ({ phase: 'prepare', message: diag.message,
  errors: [diag], at: 0, revision, studioHash: null });

test('behind without a refusal: not applied yet, never "refused"', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const st = graphView.runtimeStatus(model, fakeRuntime(model, { missing: ['lfo-1'] }), 4);
  const lfo = st.nodes.get('lfo-1');
  assert.equal(lfo.status, 'degraded');
  assert.equal(lfo.code, 'not-in-runtime');
  assert.match(lfo.reason, /not applied yet/);
  assert.doesNotMatch(lfo.reason, /refused/i);
  assert.match(lfo.reason, /revision 3/, 'names what the running graph plays');
  assert.match(lfo.reason, /next Play/, 'says when it will be applied');
  assert.equal(lfo.cause, undefined, 'nothing refused it: no cause');
  assert.match(st.edges.get('edge-4').reason, /not applied yet/);
  assert.equal(st.nodes.get('osc-1').status, 'ready', 'a node it runs stays ready');
});

test('behind with an OLD unrelated lastError does not quote it', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const lastError = refusal(2, { code: 'prepare-failed', severity: 'error', owner: 'runtime',
    entity: { kind: 'node', id: 'osc-1' }, message: OLD, path: '' });
  const rt = fakeRuntime(model, { missing: ['lfo-1'], lastError });
  const lfo = graphView.runtimeStatus(model, rt, 4).nodes.get('lfo-1');
  assert.match(lfo.reason, /not applied yet/);
  assert.ok(!lfo.reason.includes(OLD), lfo.reason);
  assert.doesNotMatch(lfo.reason, /refused|prepare-failed|Oscillator 1/i);
  assert.equal(lfo.cause, undefined);
});

test('refused names the diagnostic: its message, its node and its code, with a cause', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const lastError = refusal(4, { code: 'prepare-failed', severity: 'error', owner: 'runtime',
    entity: { kind: 'node', id: 'lfo-1' }, message: 'injected lfo failure', path: '' });
  const st = graphView.runtimeStatus(model, fakeRuntime(model, { missing: ['lfo-1'],
    lastError }), 4);
  const lfo = st.nodes.get('lfo-1');
  assert.match(lfo.reason, /refused/);
  assert.match(lfo.reason, /injected lfo failure/);
  assert.match(lfo.reason, /LFO 1/, 'the node by name');
  assert.match(lfo.reason, /prepare-failed/, 'the code');
  assert.match(lfo.reason, /last working graph keeps playing/);
  assert.deepEqual(lfo.cause, { node: 'lfo-1', code: 'prepare-failed' });
  assert.deepEqual(st.edges.get('edge-4').cause, { node: 'lfo-1', code: 'prepare-failed' });
});

test('refused without a message still names the edge and the code', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const lastError = refusal(4, { code: 'route-failed', severity: 'error', owner: 'runtime',
    entity: { kind: 'edge', id: 'edge-4' }, path: '' });
  const st = graphView.runtimeStatus(model, fakeRuntime(model, { missing: ['lfo-1'],
    lastError }), 4);
  const edge = st.edges.get('edge-4');
  assert.match(edge.reason, /refused/);
  assert.match(edge.reason, /connection from LFO 1/i, 'the edge by its description');
  assert.match(edge.reason, /route-failed/);
  assert.doesNotMatch(edge.reason, /undefined|null/);
  assert.deepEqual(edge.cause, { edge: 'edge-4', code: 'route-failed' });
});

test('not-applied says the Studio graph is not running, never "refused"', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const rt = fakeRuntime(model, { state: 'stopped', missing: model.graph.nodes.map((n) => n.id),
    lastError: refusal(2, { code: 'prepare-failed', severity: 'error', owner: 'runtime',
      entity: null, message: OLD, path: '' }) });
  const osc = graphView.runtimeStatus(model, rt, 4).nodes.get('osc-1');
  assert.equal(osc.code, 'not-in-runtime');
  assert.match(osc.reason, /not running/);
  assert.doesNotMatch(osc.reason, /refused/i);
  assert.ok(!osc.reason.includes(OLD), osc.reason);
});

// ---------------------------------------------------------------- real runtime

function ungated() {
  const fx = createFakeAudioEnv({ sampleRate: SR });
  const engine = new AudioEngine({ env: fx.env });
  assert.ok(engine.init(), 'engine.init');
  if (engine.limiterFeed) engine.limiterFeed.infrastructure = true;
  const runtime = createStudioRuntime({ engine });
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime, engine, store });
  return { fx, engine, runtime, store, transport };
}

function failNextBiquad(ctx) {
  const own = Object.prototype.hasOwnProperty.call(ctx, 'createBiquadFilter');
  const original = ctx.createBiquadFilter;
  ctx.createBiquadFilter = function failing() {
    if (own) ctx.createBiquadFilter = original;
    else delete ctx.createBiquadFilter;
    throw new Error('injected biquad failure');
  };
}

test('real runtime: a prepare refusal names the filter; a later unsynced edit does not', () => {
  const s = ungated();
  assert.ok(s.transport.start().ok);
  s.fx.advance(0.1);
  failNextBiquad(s.fx.ctx);
  const filter = s.store.dispatch(ADD_FILTER).created.nodes[0];
  s.transport.sync();
  const name = s.store.getModel().graph.nodes.find((n) => n.id === filter).metadata.name;
  const refused = graphView.runtimeStatus(s.store.getModel(), s.runtime,
    s.store.getRevision()).nodes.get(filter);
  assert.match(refused.reason, /refused.*injected biquad failure/);
  assert.ok(refused.reason.includes(name), refused.reason);
  assert.match(refused.reason, /prepare-failed/);
  assert.deepEqual(refused.cause, { node: filter, code: 'prepare-failed' });
  // The next edit is committed and not synced: behind, and the old refusal is not its reason.
  const lfo = s.store.dispatch(ADD_LFO).created.nodes[0];
  const behind = graphView.runtimeStatus(s.store.getModel(), s.runtime,
    s.store.getRevision()).nodes.get(lfo);
  assert.match(behind.reason, /not applied yet/);
  assert.doesNotMatch(behind.reason, /refused|injected biquad failure/);
  s.transport.stop();
});

// ---------------------------------------------------------------- Inspector jump

test('the Inspector offers the cause of another node as a selection', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const cause = { node: 'lfo-1', code: 'prepare-failed' };
  const reason = 'Not in the running graph.';
  const view = inspector.inspectorView(model, { nodes: ['filter-1'] }, {
    status: new Map([['filter-1', { status: 'degraded', code: 'not-in-runtime', reason,
      cause }]]) });
  assert.deepEqual(view.cause, { kind: 'node', id: 'lfo-1', label: 'LFO 1',
    selection: { nodes: ['lfo-1'] } });
  // The node the cause names is the one shown: nothing to jump to.
  const self = inspector.inspectorView(model, { nodes: ['lfo-1'] }, {
    status: new Map([['lfo-1', { status: 'degraded', code: 'not-in-runtime', reason,
      cause }]]) });
  assert.equal(self.cause, null);
  // A cable whose status names a node offers that node.
  const edge = inspector.inspectorView(model, { edges: ['edge-4'] }, {
    edgeStatus: new Map([['edge-4', { status: 'inactive', code: 'not-in-runtime', reason,
      cause }]]) });
  assert.deepEqual(edge.cause && edge.cause.selection, { nodes: ['lfo-1'] });
});

/** The reference template with the semi-mono panel (synth-fixture.mjs) and what liveModel drops. */
function armedFixture() {
  const model = panelStore().getModel();
  const kept = new Set(liveModel(model).graph.nodes.map((n) => n.id));
  return { model, kept, missing: model.graph.nodes.filter((n) => !kept.has(n.id))
    .map((n) => n.id) };
}

test('armed and in sync: a node the live model leaves out is outside-live, not unavailable', () => {
  const { model, kept, missing } = armedFixture();
  assert.ok(missing.includes('lfo-1'), 'the template LFO is joined to no note source');
  const st = graphView.runtimeStatus(model, fakeRuntime(model, { missing }), 3);
  const lfo = st.nodes.get('lfo-1');
  assert.equal(lfo.status, 'outside-live');
  assert.equal(lfo.code, 'outside-live');
  assert.equal(lfo.reason, graphView.OUTSIDE_LIVE_TEXT);
  assert.doesNotMatch(lfo.reason, /refused|not applied/i);
  const cable = model.graph.edges.find((e) => e.from.node === 'lfo-1' || e.to.node === 'lfo-1');
  assert.equal(st.edges.get(cable.id).status, 'inactive');
  assert.equal(st.edges.get(cable.id).code, 'outside-live');
  const played = [...kept].find((id) => !model.graph.nodes.find((n) => n.id === id)
    .type.startsWith('master'));
  assert.equal(st.nodes.get(played).status, 'ready', 'what the live model plays stays ready');
  const card = graphView.nodeCard(model, model.graph.nodes.find((n) => n.id === 'lfo-1'),
    { status: lfo });
  assert.equal(card.flags.error, false, 'no error flag on a node left out on purpose');
  assert.equal(card.statusLabel, 'Not in the armed chain');
});

test('armed but behind: the edit is still named as not applied yet', () => {
  const { model, missing } = armedFixture();
  const lfo = graphView.runtimeStatus(model, fakeRuntime(model, { missing }), 4).nodes
    .get('lfo-1');
  assert.equal(lfo.code, 'not-in-runtime');
  assert.match(lfo.reason, /not applied yet/);
});

test('in sync, a plan that is not the live model: a missing node is still not-in-runtime', () => {
  const { model } = armedFixture();
  const lfo = graphView.runtimeStatus(model, fakeRuntime(model, { missing: ['lfo-1'] }), 3)
    .nodes.get('lfo-1');
  assert.equal(lfo.status, 'degraded');
  assert.equal(lfo.code, 'not-in-runtime');
});

test('the cause link is the catalogued studio.inspector.statusCause and selects the cause', () => {
  // The rendered link (inspector.js causeLink) carries the hook the UI catalogue declares and
  // dispatches the view's cause selection, so the census and the catalogue name one control.
  const src = readFileSync(new URL('../../src/js/ui/studio/inspector.js', import.meta.url),
    'utf8');
  const at = src.indexOf("'data-osc': 'studio.inspector.statusCause'");
  assert.ok(at > 0, 'the cause link carries data-osc studio.inspector.statusCause');
  const body = src.slice(src.lastIndexOf('function causeLink', at), src.indexOf('\n  }\n', at));
  assert.match(body, /SELECTION_CHANGE', selection: c\.selection/);
});
