// The OSCILLA Studio runtime (spec §43-§46, §80, §170-§171, §177-§179, §184, §186; plan issue
// V415): the ephemeral map Studio node id → runtime handle on the ONE existing AudioEngine, kept
// in line with the canonical model by incremental, transactional, click-free patches.
//
//   createStudioRuntime({ engine, registry, adapters, options }) -> runtime
//     options: { masterLevel: 'engine' | 'ignore'  Master Output level → engine.setMasterGain
//                                                  while running; STOP restores the engine's
//                                                  level from before start (after the fade),
//                inputPermission: false             Microphone nodes may open the input,
//                xfadeS: STUDIO_XFADE_S, stopS: STUDIO_STOP_S }
//   runtime.apply(model, { revision }) -> result   compile, diff against the last applied
//     model, patch the running graph (or only store the plan while stopped). result =
//     { ok, applied, ops, revision, warnings } | { ok: false, phase, errors, revision }
//   runtime.start() -> result      build the compiled graph and fade the Studio output in
//   runtime.stop({ fast }) -> Promise<counts>   fade out, stop every source, dispose everything
//                                                (§184); resolves when the nodes are released
//   runtime.dispose() -> Promise   stop and detach from the engine
//   runtime.nodes                  read-only Map view: nodes.get('filter-1') -> handle (§43)
//   runtime.edges                  read-only Map view of the routed edges
//   runtime.bindings()             { triggers, data }: the logical TRIGGER / ANALYSIS edges
//   runtime.setOptions({ inputPermission }) -> result   re-applies the current model
//   runtime.flush({ force })       run due (or all) deferred disposals now
//   runtime.debugInfo()            runtime node count, compiled revision, last error, ... (§177)
//   runtime.on(fn) -> off          fn(type, detail): 'applied' | 'error' | 'state'
//   runtime.setOwnedParams([{ node, param }]) -> list   parameters another owner drives (the
//                                  transport: automation lanes, pattern-played oscillator
//                                  levels). The runtime never glides their base value nor lets
//                                  a live update rewrite them; [] releases every claim
//   runtime.ownedParams()          the current claims, [{ node, param }]
//   runtime.baseOffset(id, key)    the constant part the modulation edges add to a parameter's
//                                  base (linear edges: unipolar polarity, offset), in its unit;
//                                  an owner adds it to the values it schedules (automation.js
//                                  combineAutomationAndModulation: actual = base + Σ edges)
//
// Transaction (§46), for every apply while running:
//   1. validate   compileStudio refuses an invalid model: nothing is touched (§179)
//   2. prepare    build every new or replacement node and every new route with its edge gain
//                 at 0 (silent; sources start at hooks.soon()). Any exception: everything
//                 prepared is disposed and the last valid runtime keeps playing, unchanged.
//   3. commit     swap the handle/edge maps and the plan (the runtime now reflects the model)
//   4. crossfade  at t = hooks.soon(): new routes ramp 0 → 1, removed routes ramp to
//                 ROUTE_FLOOR (−80 dB) over xfadeS (equal-gain linear crossfade, ramps re-ended
//                 in place, ADR 0001), and are disconnected only from there,
//                 parameter bases glide (τ 15 ms), retired nodes' sources stop after the fade
//   5. cleanup    after the fade (engine timers; immediately on a suspended context) retired
//                 routes and nodes are disconnected, disposed and untracked
// The master graph is never disconnected while sounding (§45): Studio output leaves only
// through the Master Output bus into engine.master, and that bus is faded, not cut.
//
// Owned parameters (docs/v31/compiler.md decision "Automated parameters belong to their lane").
// An explicit adapter contract (adapters/nodes.js header): the runtime calls
// applyBase(base, false, owned) and update(changed, owned) with `owned`, the Set of the node's
// owned keys whose handle.modTarget(key, 'linear') is an AudioParam (the one the owner
// automates), and the adapter does not write those AudioParams. Every other parameter of the node
// (its detune, which carries log-mapped modulation offsets, its Q, ...) is applied as before. A
// node's first applyBase (immediate, the node is still silent) gets no owned keys: it gives the
// parameter its initial value and the owner schedules from there. diffPlans receives the same
// map, so a key whose builder update cannot skip an owned parameter (an adapter's
// `rebuildWhenOwned`, the filter bypass) rebuilds the node instead. No AudioParam method is ever
// reassigned.

import { NODE_REGISTRY } from './registry.js';
import { NODE_ADAPTERS } from './adapters/nodes.js';
import { createEngineHooks } from './adapters/engine-hooks.js';
import {
  CLEANUP_MARGIN_S, EMPTY_PLAN, ROUTE_FLOOR, SOURCE_STOP_PAD_S, STUDIO_STOP_S, STUDIO_XFADE_S,
  compileStudio,
  computeBases, createEdgeHandle, diffPlans, disposeHandle, instantiateNode,
} from './compiler.js';

/** Escape-speed stop (scheduler.js ESCAPE_RELEASE_S). */
export const STUDIO_FAST_STOP_S = 0.008;

/** The owned keys of a node no other owner drives (shared, never mutated). */
const NONE_OWNED = Object.freeze(new Set());

const readOnlyMap = (map) => Object.freeze({
  get: (id) => map.get(id),
  has: (id) => map.has(id),
  keys: () => map.keys(),
  values: () => map.values(),
  entries: () => map.entries(),
  forEach: (fn) => map.forEach(fn),
  get size() { return map.size; },
  [Symbol.iterator]: () => map[Symbol.iterator](),
});

const messageOf = (e) => (e && e.message) || String(e);

export function createStudioRuntime({
  engine, registry = NODE_REGISTRY, adapters = NODE_ADAPTERS, options = {},
} = {}) {
  const hooks = createEngineHooks(engine);
  const opts = { masterLevel: 'engine', inputPermission: false, xfadeS: STUDIO_XFADE_S,
    stopS: STUDIO_STOP_S, ...options };
  const totals = { nodes: new Set(), sources: new Set() };
  const handles = new Map();
  const edges = new Map();
  const pending = new Set();
  const listeners = new Set();
  const bases = new Map(); // node id → last computeBases result (debug)
  const owned = new Map(); // node id → Set of parameter keys driven by another owner
  // The engine's master level before start: the Master Output level drives the ONE engine gain
  // only while the Studio plays; STOP gives it back so MEASURE, Labs and the Playground never
  // inherit the Studio's level (V431 review X4). null while nothing is to be restored.
  let savedMasterLevel = null;
  let plan = EMPTY_PLAN;
  let state = 'idle';
  let compiledRevision = null;
  let lastError = null;
  let lastOps = [];
  let lastWarnings = [];
  let disposed = false;

  const emit = (type, detail) => {
    for (const fn of listeners) {
      try { fn(type, detail); } catch (e) { /* a listener's error is its own */ }
    }
  };
  const setState = (s) => {
    if (state === s) return;
    state = s;
    emit('state', s);
  };
  const fail = (phase, errors, extra = {}) => {
    const list = Array.isArray(errors) ? errors : [{ code: 'runtime-error', severity: 'error',
      message: messageOf(errors), path: '' }];
    lastError = { phase, message: list[0].message, errors: list, at: Date.now() };
    emit('error', lastError);
    return { ok: false, phase, errors: list, revision: compiledRevision, ...extra };
  };

  const offEngine = hooks.on((type, detail) => {
    if (type === 'context' && detail === 'closed') dropAll();
  });

  /** The context is gone: forget every node without touching it (it belongs to it). */
  function dropAll() {
    for (const job of pending) {
      if (job.timer != null) hooks.timers.clearTimeout(job.timer);
      job.resolve();
    }
    pending.clear();
    for (const n of totals.nodes) {
      engine.nodes.delete(n);
      engine.sources.delete(n);
    }
    totals.nodes.clear();
    totals.sources.clear();
    handles.clear();
    edges.clear();
    bases.clear();
    setState('idle');
  }

  // ------------------------------------------------------------ deferred disposal

  function finish(job) {
    if (!pending.has(job)) return;
    pending.delete(job);
    if (job.timer != null) hooks.timers.clearTimeout(job.timer);
    job.timer = null;
    for (const eh of job.edges) {
      try { eh.dispose(); } catch (e) { /* already disposed */ }
    }
    for (const h of job.handles) disposeHandle(h);
    job.resolve();
  }

  /** Dispose `retire` once the audio clock has passed `at` (UI bookkeeping timer). */
  function schedule(at, retire) {
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const job = { at, handles: retire.handles, edges: retire.edges, timer: null, done, resolve };
    pending.add(job);
    const ctx = hooks.ctx;
    const arm = () => {
      job.timer = null;
      const c = hooks.ctx;
      if (c && c.state === 'running' && c.currentTime < job.at) {
        job.timer = hooks.timers.setTimeout(arm, Math.max(5, (job.at - c.currentTime) * 1000 + 5));
        return;
      }
      finish(job);
    };
    // A suspended or closed context renders nothing: its scheduled stops never fire.
    if (!ctx || ctx.state !== 'running') finish(job);
    else job.timer = hooks.timers.setTimeout(arm, Math.max(5, (at - ctx.currentTime) * 1000 + 5));
    return job;
  }

  function flush({ force = false } = {}) {
    const ctx = hooks.ctx;
    let n = 0;
    for (const job of [...pending]) {
      if (force || !ctx || ctx.state !== 'running' || ctx.currentTime >= job.at) {
        finish(job);
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------ owned parameters

  /**
   * The owned keys of handle `h` that the adapter must not write: those with an AudioParam
   * (modTarget(key, 'linear').param). A key without one has nothing another owner could drive.
   */
  function ownedKeys(h) {
    const keys = h && owned.get(h.id);
    if (!keys || !keys.size) return NONE_OWNED;
    const out = new Set();
    for (const key of keys) {
      let target = null;
      try { target = h.modTarget(key, 'linear'); } catch (e) { target = null; }
      if (target && target.param) out.add(key);
    }
    return out.size ? out : NONE_OWNED;
  }

  /** ownedKeys of every running node, for diffPlans (`rebuildWhenOwned`). */
  function ownedMap() {
    const out = new Map();
    for (const id of owned.keys()) {
      const keys = ownedKeys(handles.get(id));
      if (keys.size) out.set(id, keys);
    }
    return out;
  }

  function setOwnedParams(list = []) {
    owned.clear();
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e.node !== 'string' || typeof e.param !== 'string') continue;
      if (!owned.has(e.node)) owned.set(e.node, new Set());
      owned.get(e.node).add(e.param);
    }
    return ownedParams();
  }

  function ownedParams() {
    const out = [];
    for (const [node, keys] of owned) for (const param of keys) out.push({ node, param });
    return out;
  }

  function baseOffset(id, key) {
    const cb = bases.get(id);
    const pn = plan.nodes.get(id);
    if (!cb || !pn || !cb.base[key] || typeof pn.params[key] !== 'number') return 0;
    const d = cb.base[key].value - pn.params[key];
    return Number.isFinite(d) ? d : 0;
  }

  // ------------------------------------------------------------ transaction

  function incomingControl(next, id, edgeOf) {
    const out = [];
    for (const eid of next.edgeOrder) {
      const e = next.edges.get(eid);
      if (e.to.node === id && e.kind === 'control') out.push({ edge: e, handle: edgeOf(eid) });
    }
    return out;
  }

  function transact(next, ops) {
    const ctx = hooks.ctx;
    const now = ctx.currentTime;
    const X = opts.xfadeS;
    const env = { hooks, owners: [totals], now, at: now, options: opts };
    const createIds = new Set(ops.filter((o) => o.op === 'node-add' || o.op === 'node-replace')
      .map((o) => o.id));
    const edgeAdd = new Set(ops.filter((o) => o.op === 'edge-add' || o.op === 'edge-rewire')
      .map((o) => o.id));
    const edgeRemove = new Set(ops.filter((o) => o.op === 'edge-remove' || o.op === 'edge-rewire')
      .map((o) => o.id));
    const created = { handles: new Map(), edges: new Map() };
    let t;
    // 2. prepare: silent until the crossfade
    try {
      t = hooks.soon();
      env.at = t;
      for (const id of next.order) {
        if (createIds.has(id)) created.handles.set(id, instantiateNode(next.nodes.get(id), env));
      }
      const handleOf = (id) => created.handles.get(id) || handles.get(id);
      for (const id of next.edgeOrder) {
        if (!edgeAdd.has(id)) continue;
        const pe = next.edges.get(id);
        created.edges.set(id, createEdgeHandle(pe, handleOf(pe.from.node), handleOf(pe.to.node),
          env));
      }
      const edgeOf = (eid) => created.edges.get(eid)
        || (edgeRemove.has(eid) ? null : edges.get(eid));
      for (const [id, h] of created.handles) {
        if (h.status !== 'ready' && h.status !== 'pending') continue;
        const cb = computeBases(next.nodes.get(id), incomingControl(next, id, edgeOf), hooks);
        h.applyBase(cb.base, true, NONE_OWNED);
      }
    } catch (err) {
      for (const eh of created.edges.values()) {
        try { eh.dispose(); } catch (e) { /* ignore */ }
      }
      for (const h of created.handles.values()) disposeHandle(h);
      return fail('prepare', err, { kept: true });
    }
    // 3. commit
    const retire = { handles: [], edges: [] };
    for (const id of edgeRemove) {
      const eh = edges.get(id);
      if (eh) { retire.edges.push(eh); edges.delete(id); }
    }
    for (const o of ops) {
      if (o.op !== 'node-remove' && o.op !== 'node-replace') continue;
      const h = handles.get(o.id);
      if (h) { retire.handles.push(h); handles.delete(o.id); }
      bases.delete(o.id);
    }
    for (const [id, h] of created.handles) handles.set(id, h);
    for (const [id, eh] of created.edges) edges.set(id, eh);
    plan = next;
    // 4. crossfade
    const warnings = [];
    const guard = (what, fn) => {
      try { fn(); } catch (e) { warnings.push(`${what}: ${messageOf(e)}`); }
    };
    const affected = new Set(created.handles.keys());
    for (const o of ops) {
      if (o.op === 'node-params') {
        const pn = next.nodes.get(o.id);
        const h = handles.get(o.id);
        const live = o.keys.filter((k) => !(registry.param(pn.type, k) || {}).modulatable);
        if (live.length && h) {
          const changed = {};
          for (const k of live) changed[k] = pn.params[k];
          guard(`update ${o.id}`, () => h.update(changed, ownedKeys(h)));
        }
        if (live.length < o.keys.length) affected.add(o.id);
      } else if (o.op.startsWith('edge-')) {
        const pe = next.edges.get(o.id);
        if (pe && pe.kind === 'control') affected.add(pe.to.node);
      }
    }
    // Targets of removed modulation edges drop their offsets (their plan entry may be gone).
    for (const eh of retire.edges) if (eh.kind === 'control') affected.add(eh.toNode);
    const edgeOf = (eid) => edges.get(eid) || null;
    for (const id of affected) {
      const h = handles.get(id);
      if (!h || (h.status !== 'ready' && h.status !== 'pending')) continue;
      const cb = computeBases(next.nodes.get(id), incomingControl(next, id, edgeOf), hooks);
      bases.set(id, cb);
      if (!created.handles.has(id)) {
        guard(`parameters ${id}`, () => h.applyBase(cb.base, false, ownedKeys(h)));
      }
      for (const [eid, g] of cb.gains) {
        const eh = edges.get(eid);
        if (eh && eh.ramp && eh.ramp.target !== g) guard(`route ${eid}`, () => eh.ramp.to(g, t, X));
      }
    }
    for (const [id, eh] of created.edges) {
      if (eh.kind === 'audio' && eh.ramp) {
        const level = next.edges.get(id).props.muted ? ROUTE_FLOOR : 1;
        guard(`route ${id}`, () => eh.ramp.to(level, t, X));
      }
    }
    for (const o of ops) {
      if (o.op !== 'edge-props') continue;
      const eh = edges.get(o.id);
      if (eh && eh.kind === 'audio' && eh.ramp) {
        const level = next.edges.get(o.id).props.muted ? ROUTE_FLOOR : 1;
        guard(`route ${o.id}`, () => eh.ramp.to(level, t, X));
      }
    }
    for (const h of created.handles.values()) {
      if (typeof h.fade === 'function') guard(`output ${h.id}`, () => h.fade(1, t, X));
    }
    for (const eh of retire.edges) {
      const floor = eh.kind === 'audio' ? ROUTE_FLOOR : 0;
      if (eh.ramp) guard(`route ${eh.id}`, () => eh.ramp.to(floor, t, X));
    }
    for (const h of retire.handles) {
      if (typeof h.fade === 'function') guard(`output ${h.id}`, () => h.fade(ROUTE_FLOOR, t, X));
      guard(`stop ${h.id}`, () => h.stop(t + X + SOURCE_STOP_PAD_S));
    }
    // 5. cleanup after the fade
    if (retire.handles.length || retire.edges.length) {
      schedule(t + X + CLEANUP_MARGIN_S, retire);
    }
    lastOps = ops;
    lastWarnings = warnings;
    return { ok: true, applied: true, ops, warnings, at: t };
  }

  // ------------------------------------------------------------ public API

  function apply(model, { revision = null } = {}) {
    if (disposed) return fail('validate', 'The Studio runtime is disposed.');
    const next = compileStudio(model, { engine, registry, adapters, options: opts });
    if (!next.ok) return fail('validate', next.errors, { kept: true });
    const ops = diffPlans(plan, next, { owned: ownedMap() });
    const rev = revision != null ? revision : (compiledRevision == null ? 1 : compiledRevision + 1);
    if (state !== 'running' || !hooks.ctx) {
      plan = next;
      compiledRevision = rev;
      lastOps = ops;
      const result = { ok: true, applied: false, ops, revision: rev, warnings: next.warnings };
      emit('applied', result);
      return result;
    }
    const r = transact(next, ops);
    if (!r.ok) return r;
    compiledRevision = rev;
    const result = { ...r, revision: rev, warnings: [...next.warnings.map((w) => w.message),
      ...r.warnings] };
    emit('applied', result);
    return result;
  }

  function start() {
    if (disposed) return fail('start', 'The Studio runtime is disposed.');
    if (state === 'running') return { ok: true, applied: false, ops: [],
      revision: compiledRevision };
    if (!plan.model) return fail('start', 'Nothing is compiled yet: apply a Studio model first.');
    if (!hooks.ensure()) {
      return fail('start', (engine.lastError && engine.lastError.message) || 'Audio could not '
        + 'start.');
    }
    if (typeof engine.resume === 'function') engine.resume();
    if (opts.masterLevel !== 'ignore') savedMasterLevel = hooks.masterLevel;
    setState('running');
    const r = transact(plan, diffPlans(EMPTY_PLAN, plan));
    if (!r.ok) setState('idle');
    return r.ok ? { ...r, revision: compiledRevision } : r;
  }

  function stop({ fast = false } = {}) {
    const all = () => Promise.all([...pending].map((j) => j.done)).then(() => counts());
    if (state !== 'running') return all();
    setState('idle');
    const ctx = hooks.ctx;
    const level = savedMasterLevel;
    savedMasterLevel = null;
    if (!ctx) {
      if (level !== null) hooks.setMasterLevel(level);
      dropAll();
      return Promise.resolve(counts());
    }
    const S = fast ? STUDIO_FAST_STOP_S : opts.stopS;
    const t = hooks.soon();
    if (level !== null) hooks.restoreMasterLevel(level, t + S);
    const retire = { handles: [...handles.values()], edges: [...edges.values()] };
    for (const h of retire.handles) {
      try {
        if (typeof h.fade === 'function') h.fade(ROUTE_FLOOR, t, S);
      } catch (e) { /* disposed */ }
    }
    for (const h of retire.handles) {
      try { h.stop(t + S + SOURCE_STOP_PAD_S); } catch (e) { /* already stopped */ }
    }
    handles.clear();
    edges.clear();
    bases.clear();
    schedule(t + S + CLEANUP_MARGIN_S, retire);
    return all();
  }

  function counts() {
    return { nodes: totals.nodes.size, sources: totals.sources.size,
      engineNodes: engine.activeNodeCount, engineSources: engine.activeSourceCount };
  }

  function dispose() {
    if (disposed) return Promise.resolve(counts());
    const p = stop();
    disposed = true;
    return p.then((c) => {
      flush({ force: true });
      offEngine();
      listeners.clear();
      plan = EMPTY_PLAN;
      return c;
    });
  }

  function setOptions(next = {}) {
    if ('inputPermission' in next) opts.inputPermission = next.inputPermission === true;
    if ('masterLevel' in next) opts.masterLevel = next.masterLevel;
    return plan.model ? apply(plan.model) : { ok: true, applied: false, ops: [] };
  }

  function bindings() {
    const triggers = [];
    const data = [];
    for (const e of plan.edges.values()) {
      const b = { id: e.id, from: e.from, to: e.to, status: e.status, reason: e.reason };
      if (e.kind === 'trigger') triggers.push(b);
      else if (e.kind === 'analysis') data.push(b);
    }
    return { triggers, data };
  }

  function debugInfo() {
    const degraded = [];
    for (const n of plan.nodes.values()) {
      const h = handles.get(n.id);
      const status = h ? h.status : n.status;
      if (status !== 'ready' && status !== 'data') {
        degraded.push({ id: n.id, status, reason: h ? h.reason : n.reason });
      }
    }
    const inactiveEdges = [];
    for (const e of plan.edges.values()) {
      const eh = edges.get(e.id);
      const status = eh ? eh.status : e.status;
      if (status === 'inactive') {
        inactiveEdges.push({ id: e.id, reason: eh ? eh.reason : e.reason });
      }
    }
    const limitedEdges = [];
    const exceeds = [];
    for (const [id, cb] of bases) {
      limitedEdges.push(...cb.limited);
      for (const k of cb.exceeds) exceeds.push({ node: id, param: k });
    }
    return {
      state,
      compiledRevision,
      modelNodeCount: plan.nodes.size,
      modelEdgeCount: plan.edges.size,
      runtimeNodeCount: totals.nodes.size,
      runtimeSourceCount: totals.sources.size,
      handleCount: handles.size,
      routedEdgeCount: [...edges.values()].filter((e) => e.status === 'active').length,
      pendingCleanups: pending.size,
      engineNodeCount: engine.activeNodeCount,
      engineSourceCount: engine.activeSourceCount,
      degraded,
      inactiveEdges,
      limitedEdges,
      exceeds,
      warnings: [...plan.warnings.map((w) => w.message), ...lastWarnings],
      lastOps,
      lastError,
      ownedParams: ownedParams(),
    };
  }

  return Object.freeze({
    apply,
    start,
    stop,
    dispose,
    flush,
    setOptions,
    bindings,
    debugInfo,
    setOwnedParams,
    ownedParams,
    baseOffset,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    nodes: readOnlyMap(handles),
    edges: readOnlyMap(edges),
    get state() { return state; },
    get revision() { return compiledRevision; },
    get plan() { return plan; },
    get lastError() { return lastError; },
  });
}
