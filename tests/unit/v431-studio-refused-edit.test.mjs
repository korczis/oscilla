// V431 review #15 (A6): ADR 0035 says that when the runtime cannot prepare an edit made while
// playing, "the model change is refused and the last valid runtime graph keeps running". Before
// the fix the store committed first and the runtime failed afterwards: dispatch ok, store
// revision 2, runtime revision 1, lastError prepare, and the node card showed nothing, because
// node status came from a fresh compile of the model rather than from the runtime.
//   node --test tests/unit/v431-studio-refused-edit.test.mjs
// Wiring under test is the workspace's: createStoreHandle with the commit gate transport.admit,
// the transport and runtime on the real AudioEngine over a fake AudioContext whose
// createBiquadFilter is made to throw once (a resource failure in the prepare phase).
// Tolerances: none (identity, counts and text).

import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioEngine } from '../../src/js/audio/audio-engine.js';
import { createIdGenerator, createStudioStore } from '../../src/js/studio/actions.js';
import { createStudioRuntime } from '../../src/js/studio/runtime.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../src/js/studio/transport.js';
// Namespace import: the status selector is new with this fix, and each test must fail on its
// own assertion on the code before it rather than the whole file on a missing export.
import * as workspace from '../../src/js/ui/studio/workspace.js';
import { createFakeAudioEnv } from './sequencer-fake-audio.mjs';

const SR = 48000;
const ADD_FILTER = { type: 'NODE_ADD', nodeType: 'filter', position: { x: 40, y: 40 } };

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

/** As the workspace wires it: the handle's commit gate is transport.admit. */
function gated() {
  const a = audio();
  let transport = null;
  const handle = workspace.createStoreHandle(templateModel(REFERENCE_TEMPLATE_ID), {
    gate: (next, info) => (transport && typeof transport.admit === 'function'
      ? transport.admit(next, info) : null),
  });
  transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store: handle });
  handle.subscribe((ev) => { if (ev.type === 'model') transport.sync(); });
  return { ...a, handle, transport };
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

const counts = (s) => ({ nodes: s.engine.activeNodeCount, sources: s.engine.activeSourceCount });

test('#15 a live edit whose runtime prepare fails is refused: store, history and runtime keep '
  + 'the last good revision', () => {
  const s = gated();
  // A redo entry to prove the refused edit does not clear redo (§51 applies to real edits).
  const osc = s.handle.getModel().graph.nodes.find((n) => n.type === 'oscillator');
  ok(s.handle.dispatch({ type: 'NODE_MOVE', nodeId: osc.id, position: { x: 1, y: 2 } }));
  ok(s.handle.undo());
  ok(s.transport.start());
  s.fx.advance(0.1);
  const model = s.handle.getModel();
  const revision = s.handle.getRevision();
  const depth = s.handle.debugInfo();
  const plan = s.runtime.plan;
  const before = counts(s);
  assert.equal(s.runtime.revision, revision, 'the runtime plays the store revision');
  assert.equal(plan.model, model);

  failNextBiquad(s.fx.ctx);
  const r = s.handle.dispatch(ADD_FILTER);
  assert.equal(r.ok, false, `refused, got ${JSON.stringify({ ok: r.ok, rev: r.revision })}`);
  assert.equal(r.refused, true);
  assert.equal(r.phase, 'prepare');
  assert.match(r.reason, /Edit refused: .*injected biquad failure.*last working graph/);
  assert.equal(s.handle.getModel(), model, 'the model is the previous one, unchanged');
  assert.equal(s.handle.getRevision(), revision, 'no revision was spent');
  assert.equal(s.runtime.revision, revision, 'the runtime stays on its last good revision');
  assert.equal(s.runtime.plan, plan, 'the runtime plan is untouched');
  assert.equal(s.runtime.lastError.phase, 'prepare');
  assert.match(s.runtime.lastError.message, /injected biquad failure/);
  const after = s.handle.debugInfo();
  assert.equal(after.undoDepth, depth.undoDepth, 'no history entry left behind');
  assert.equal(after.redoDepth, depth.redoDepth, 'the redo stack is kept');
  assert.ok(s.handle.canRedo());
  assert.deepEqual(counts(s), before, 'prepared nodes were released, nothing else changed');
  assert.match(s.transport.debugInfo().warnings.at(-1), /Edit refused/);
  assert.equal(s.transport.debugInfo().lastError.phase, 'prepare');

  // Once the failure is gone the same edit commits, and store and runtime agree again.
  const again = ok(s.handle.dispatch(ADD_FILTER));
  const id = again.created.nodes[0];
  assert.equal(s.handle.getRevision(), revision + 1);
  assert.equal(s.runtime.revision, revision + 1);
  assert.equal(s.runtime.plan.model, s.handle.getModel());
  assert.ok(s.runtime.nodes.has(id));
  assert.equal(s.handle.canRedo(), false, 'a committed edit clears redo');
  s.transport.stop();
});

test('#15 an undo or redo the running graph cannot take is refused and keeps its entry', () => {
  const s = gated();
  ok(s.transport.start());
  s.fx.advance(0.1);
  ok(s.handle.dispatch({ type: 'NODE_REMOVE', nodeId: 'filter-1' }));
  const removed = s.handle.getModel();
  const revision = s.handle.getRevision();
  assert.equal(s.runtime.revision, revision);

  failNextBiquad(s.fx.ctx); // undo re-creates the filter
  const u = s.handle.undo();
  assert.equal(u.ok, false, 'undo refused');
  assert.equal(u.phase, 'prepare');
  assert.equal(s.handle.getModel(), removed);
  assert.equal(s.handle.getRevision(), revision);
  assert.equal(s.runtime.revision, revision);
  assert.ok(s.handle.canUndo(), 'the entry is still on the undo stack');
  assert.equal(s.handle.canRedo(), false);
  assert.equal(s.handle.undoLabel(), 'Delete Filter 1');

  ok(s.handle.undo());
  assert.ok(s.handle.getModel().graph.nodes.some((n) => n.id === 'filter-1'));
  assert.ok(s.runtime.nodes.has('filter-1'));
  assert.equal(s.runtime.revision, s.handle.getRevision());

  // Redo removes the filter again (no creation, admitted); a redo that creates is refused.
  ok(s.handle.redo());
  ok(s.handle.undo());
  ok(s.handle.dispatch(ADD_FILTER));
  ok(s.handle.undo());
  const top = s.handle.getModel();
  failNextBiquad(s.fx.ctx);
  const rr = s.handle.redo();
  assert.equal(rr.ok, false, 'redo refused');
  assert.equal(s.handle.getModel(), top);
  assert.ok(s.handle.canRedo(), 'the entry is still on the redo stack');
  assert.equal(s.runtime.revision, s.handle.getRevision());
  s.transport.stop();
});

test('#15 the node and edge status the Studio shows come from the running runtime', () => {
  assert.equal(typeof workspace.studioStatus, 'function', 'workspace.js exports studioStatus');
  // Without the gate (a store that commits first) the runtime keeps its last good graph and the
  // model holds a node it does not run: the status must say so, not the model's compile.
  const a = audio();
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  const transport = createStudioTransport({ runtime: a.runtime, engine: a.engine, store });
  ok(transport.start());
  a.fx.advance(0.1);
  const running = workspace.studioStatus(store.getModel(), { runtime: a.runtime,
    engine: a.engine });
  for (const n of store.getModel().graph.nodes) {
    assert.equal(running.nodes.get(n.id).status, a.runtime.nodes.get(n.id).status, n.id);
  }
  failNextBiquad(a.fx.ctx);
  const id = ok(store.dispatch(ADD_FILTER)).created.nodes[0];
  ok(store.dispatch({ type: 'EDGE_ADD', from: { node: 'osc-1', port: 'audio' },
    to: { node: id, port: 'audio' } }));
  transport.sync();
  assert.equal(a.runtime.lastError.phase, 'prepare');
  assert.ok(!a.runtime.nodes.has(id), 'the runtime does not run the new filter');
  const m = store.getModel();
  const edge = m.graph.edges.find((e) => e.to.node === id);
  const live = workspace.studioStatus(m, { runtime: a.runtime, engine: a.engine });
  assert.equal(live.nodes.get(id).status, 'degraded');
  assert.match(live.nodes.get(id).reason, /Not in the running graph.*injected biquad failure/);
  assert.equal(live.edges.get(edge.id).status, 'inactive');
  assert.equal(live.nodes.get('osc-1').status, 'ready', 'running nodes stay ready');
  const compiled = workspace.studioStatus(m, { runtime: null, engine: a.engine });
  assert.equal(compiled.nodes.get(id).status, 'ready', 'a compile of the model would say ready');
  transport.stop();
  const stopped = workspace.studioStatus(m, { runtime: a.runtime, engine: a.engine });
  assert.equal(stopped.nodes.get(id).status, 'ready', 'stopped: the status is the compile');
});

test('#15 the store commit gate: revision offered, a refused cancel keeps the edit, a throw '
  + 'refuses', () => {
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const seen = [];
  let refuse = null;
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model),
    gate: (next, info) => {
      seen.push(info);
      if (refuse === 'throw') throw new Error('gate broke');
      return refuse === info.reason ? { ok: false, reason: 'no', phase: 'prepare' } : null;
    } });
  ok(store.dispatch({ type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Carrier' }));
  assert.equal(seen.length, 1, 'the gate is asked before the commit');
  assert.equal(seen.at(-1).reason, 'dispatch');
  assert.equal(seen.at(-1).revision, 1, 'the gate is offered the revision the commit gets');
  assert.equal(store.getRevision(), 1);

  store.beginGesture('Move');
  ok(store.dispatch({ type: 'NODE_MOVE', nodeId: 'osc-1', position: { x: 5, y: 5 } }));
  const moved = store.getModel();
  refuse = 'cancel';
  assert.equal(store.cancelGesture(), false, 'the cancel is refused');
  assert.equal(store.getModel(), moved, 'the running model stays');
  assert.equal(store.debugInfo().inGesture, false);
  assert.equal(store.undoLabel(), 'Move', 'the gesture is kept as one undo entry');

  refuse = 'throw';
  const r = store.dispatch({ type: 'NODE_RENAME', nodeId: 'osc-1', name: 'Other' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.match(r.reason, /gate broke/);
  assert.equal(store.getModel(), moved);
  refuse = null;
  ok(store.undo());
  assert.equal(seen.at(-1).reason, 'undo');
});
