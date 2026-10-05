// The OSCILLA Studio runtime (spec §43-§46, §80, §170-§171, §177-§179, §184, §186; plan issue
// V415): the ephemeral map Studio node id → runtime handle on the ONE existing AudioEngine, kept
// in line with the canonical model by incremental, transactional, click-free patches.
//
//   createStudioRuntime({ engine, registry, adapters, options, trace }) -> runtime
//     options: { masterLevel: 'engine' | 'ignore'  Master Output level → engine.setMasterGain
//                                                  while running (see "Global side effects"),
//                inputPermission: false             Microphone nodes may open the input,
//                xfadeS: STUDIO_XFADE_S, stopS: STUDIO_STOP_S }
//   runtime.apply(model, { revision }) -> result   compile, diff against the last applied
//     model, patch the running graph (or only store the plan while stopped). result =
//     { ok, applied, ops, revision, warnings: [Diagnostic] } | { ok: false, phase, errors,
//     revision }   (Diagnostic: validate.js studioDiagnostic; validation's warnings and the
//     runtime's own, owner 'runtime', code <step>-failed for a guarded crossfade step)
//   runtime.start() -> result      build the compiled graph and fade the Studio output in
//   runtime.stop({ fast }) -> Promise<counts>   fade out, stop every source, dispose everything
//                                                (§184); resolves when the nodes are released
//   runtime.dispose() -> Promise   stop and detach from the engine
//   runtime.nodes                  read-only Map view: nodes.get('filter-1') -> handle (§43)
//   runtime.edges                  read-only Map view of the routed edges
//   runtime.bindings()             { triggers, data }: the logical TRIGGER / ANALYSIS edges
//   runtime.setOptions({ inputPermission }) -> result   re-applies the current model at the
//                                  same revision (a new planHash, not a new revision); with
//                                  inputPermission true, running Microphones that failed or ended
//                                  are rebuilt (result.reopened: their ids)
//   runtime.unresolved() -> [Diagnostic]   commit-phase failures still in effect (engage-failed,
//                                  commit-failed), see "Commit atomicity"
//   runtime.options                { masterLevel, inputPermission }: a frozen copy of the
//                                  capabilities the next compile uses (the stopped status)
//   runtime.flush({ force })       run due (or all) deferred disposals now
//   runtime.debugInfo()            runtime node count, compiled revision, last error, applied
//                                  record, diagnostics, ... (§177)
//   runtime.applied() -> { revision, studioHash, planHash, at } | null   the applied record:
//                                  what the running graph holds, set only when a transaction
//                                  commits (start, apply while running), null while stopped;
//                                  `at` is wall-clock ISO text for people, never audio timing;
//                                  the hashes are computed on first read (compiler.js planHash)
//   runtime.lastError              { phase, message, errors: [Diagnostic], at, revision,
//                                  studioHash (of the refused model, null if it has none) }:
//                                  revision is the one it refused (apply) or could not start,
//                                  cleared when that revision later commits;
//                                  a prepare refusal's diagnostic names the node or edge that
//                                  threw (entity)
//   studioDivergence({ model, revision }, runtime) -> verdict   divergence as data (below)
//   runtime.on(fn) -> off          fn(type, detail): 'applied' | 'error' | 'state' | 'handle'
//                                  ('handle': { id, status, code }, a pending handle settled:
//                                  a Microphone opened or failed after its permission prompt)
//   runtime.setOwnedParams([{ node, param, peak? }]) -> list   parameters another owner drives
//                                  (the transport: automation lanes, pattern-played oscillator
//                                  levels). The runtime never glides their base value nor lets
//                                  a live update rewrite them; [] releases every claim. `peak`,
//                                  the highest value the owner gives the parameter, sizes a
//                                  frequency's Nyquist headroom (computeBases peaks, V431 X1);
//                                  a changed peak re-sizes that node on the next apply
//   runtime.ownedParams()          the current claims, [{ node, param }]
//   runtime.baseOffset(id, key)    the constant part the modulation edges add to a parameter's
//                                  base (linear edges: unipolar polarity, offset), in its unit,
//                                  plus the constant cents of log edges that land on the same
//                                  AudioParam (an Oscillator's detune, V431 X2);
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
// Global side effects (v4.0 closure audit F1). The one piece of state outside the Studio graph
// that a Studio node changes is the engine's master level (Master Output `level` →
// engine.setMasterGain), which MEASURE, Labs and the Playground share. An adapter never writes it
// while being prepared: it gets `env.global.setMasterLevel` and writes it from `engage(w)`,
// which the runtime calls only after the transaction committed, and from `update`, which runs
// after the commit too. The first write of a running session saves the engine's level, and that
// level is given back on every way out: STOP (after the fade), a PLAY whose transaction failed,
// `setOptions({ masterLevel: 'ignore' })`, dispose, and a context closed from outside (dropAll).
// A refused transaction (validate or prepare) never wrote it. It is given back only if nobody
// else wrote the level since the Studio's last write (engine.masterWrites; PR #119 D2): a level
// the user set elsewhere while the Studio played (the Playground's gain) is newer and is kept,
// and a write during STOP's fade cancels the held restore (engine.holdMasterGain).
//
// Commit atomicity (F4). Once step 3 has swapped the maps and the plan, the transaction is
// committed: everything after it (parameter bases, ramps, fades, stops, `engage`) is guarded, and
// a throw there is a warning with its <step>-failed code (`commit-failed` for a throw outside a
// guarded step), never an exception out of `apply`. So `apply` returns ok, the applied record
// names the revision whose plan the maps hold, and the store's commit gate never refuses an edit
// the runtime already holds. A failure that leaves the running graph short of its plan stays
// visible until it is resolved (runtime.unresolved(), PR #119 D3): `engage-failed` until that
// node engages (every later transaction retries it) or is removed, `commit-failed` until STOP.
// While any is unresolved the divergence verdict of the applied revision is 'degraded'.
//
// Microphone input (F2). `setOptions({ inputPermission: true })` also rebuilds every running
// Microphone whose input failed or ended (a forced node-replace, `reopened` in the result): the
// plan is unchanged, so a diff alone would leave it degraded. A Microphone whose permission the
// browser denied turns `inputPermission` off (the stopped status then shows the input off).
//
// Operation trace (ADR 0042; `trace`: the core/trace.js port, default NO_TRACE). apply, start and
// stop are one operation each, or join the caller's (the store's commit gate). Steps, owner
// 'runtime': `compile` (compiled with the planHash and op count | refused with the validation
// code), `apply` (applied at the crossfade time | not-applied: the runtime is not running, the
// plan is kept for PLAY | refused with the runtime code, e.g. prepare-failed, and its entity),
// then for an apply while running the transaction's own steps: `node` built | replaced |
// retired, `route` (an edge gain ramped to `gain` from `at`, reached at `end`), `param` (scheduled:
// the value given to the node's adapter, in the parameter's unit, at audio time `at`; owned: not
// written, another owner drives it), `<step>` failed with its <step>-failed code; `stop`.
// A param step is what the runtime handed the adapter, not a read-back of the AudioParam: an
// adapter clamps where its builder does (an oscillator frequency below 0.95 × Nyquist).
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
  computeBases, createEdgeHandle, diffPlans, disposeHandle, instantiateNode, planHash,
  studioHashOf,
} from './compiler.js';
import { studioDiagnostic } from './validate.js';
import { NO_TRACE } from '../core/trace.js';

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

/**
 * Divergence as data (pure; reads the runtime, changes nothing): the desired model (the store's,
 * with its revision when known) against what the runtime runs (its applied record and last
 * refusal; a null runtime, none yet, is a stopped one). -> { state, desired: { revision,
 * studioHash }, applied: record | null, reason: Diagnostic | null }, state:
 *   'not-applied'  the runtime is not running (stopped, never started): nothing is applied;
 *                  reason is the refusal of this model if PLAY failed on it
 *   'in-sync'      the applied record is the desired revision (without a revision: the same
 *                  studioHash, so a presentation-only change stays in sync)
 *   'degraded'     in sync, but a failure after its commit is still in effect (engage-failed,
 *                  commit-failed: runtime.unresolved()); reason is the first of them
 *   'refused'      the runtime refused the desired revision (lastError.revision; without a
 *                  revision: a refusal newer than the applied record); reason is the runtime's
 *                  diagnostic; the runtime keeps running its last applied record
 *   'behind'       the applied record is another (normally older) revision and the desired one
 *                  was not refused: it has not been applied yet
 */
export function studioDivergence({ model, revision = null }, runtime) {
  const desired = { revision, studioHash: studioHashOf(model) };
  const applied = runtime && runtime.state === 'running' ? runtime.applied() : null;
  const same = (r) => !!r && (revision != null ? r.revision === revision
    : r.studioHash === desired.studioHash);
  const e = runtime && runtime.lastError;
  // A refusal of this model: by revision (or newer than the record), and by studioHash when it
  // has one, since a refused attempt's revision number is the next commit's (the commit gate).
  const reason = e && (revision != null ? e.revision === revision
    : applied && e.revision > applied.revision)
    && (!e.studioHash || e.studioHash === desired.studioHash) ? e.errors[0] : null;
  // The applied revision with a commit-phase failure still in effect (runtime.unresolved):
  // it runs, short of its plan.
  const open = applied && same(applied) && typeof runtime.unresolved === 'function'
    ? runtime.unresolved() : [];
  const state = !applied ? 'not-applied' : same(applied) ? (open.length ? 'degraded' : 'in-sync')
    : reason ? 'refused' : 'behind';
  return { state, desired, applied,
    reason: state === 'in-sync' ? null : state === 'degraded' ? open[0] : reason };
}

export function createStudioRuntime({
  engine, registry = NODE_REGISTRY, adapters = NODE_ADAPTERS, options = {}, trace = NO_TRACE,
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
  // Tracing (ADR 0042): what each adapter last wrote, { key: value } per node id; nothing is
  // collected, and no planHash computed for the trace, with the NO_TRACE port.
  const tracing = trace !== NO_TRACE;
  const written = new Map();
  const owned = new Map(); // node id → Set of parameter keys driven by another owner
  const peaks = new Map(); // node id → { key: peak value } of owned parameters (computeBases)
  const peaksDirty = new Set(); // node ids whose peaks changed since the last apply
  // The engine's master level before the Studio first wrote it: the Master Output level drives
  // the ONE engine gain only while the Studio plays; every way out gives it back, so MEASURE,
  // Labs and the Playground never inherit the Studio's level (V431 review X4, v4.0 audit F1).
  // null while nothing is to be restored.
  let savedMasterLevel = null;
  let plan = EMPTY_PLAN;
  let state = 'idle';
  let compiledRevision = null;
  let lastError = null;
  let lastOps = [];
  let lastWarnings = [];
  let disposed = false;
  // The applied record (runtime.applied): set when a transaction commits, null while stopped.
  let record = null;
  // The revision being applied or started: what lastError names when it is refused.
  let attempt = null;
  let attemptModel = null; // ... and its model: a revision number alone may be reused

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
  // entity: the node or edge being prepared when it threw (a refusal names what failed).
  const fail = (phase, errors, extra = {}, code = `${phase}-failed`, entity = null) => {
    const list = Array.isArray(errors) ? errors : [{ ...studioDiagnostic('runtime', code,
      messageOf(errors), entity, 'error'), path: '' }];
    let studioHash = null;
    try {
      studioHash = attemptModel ? studioHashOf(attemptModel) : null;
    } catch (e) { /* a model of the wrong shape has no hash */ }
    lastError = { phase, message: list[0].message, errors: list, at: Date.now(),
      revision: attempt, studioHash };
    trace.record('runtime', phase === 'start' ? phase : Array.isArray(errors) ? 'compile'
      : 'apply',
      { revision: attempt, entity: list[0].entity, outcome: 'refused', code: list[0].code,
        detail: { reason: list[0].message } });
    emit('error', lastError);
    return { ok: false, phase, errors: list, revision: compiledRevision, ...extra };
  };
  /**
   * A transaction committed `plan` as `compiledRevision`: the running graph holds it, and a
   * refusal of that same revision (a PLAY that failed on it, then succeeded) is no longer true.
   */
  const commit = () => {
    record = { revision: compiledRevision, plan, at: new Date().toISOString() };
    if (lastError && lastError.revision === compiledRevision) lastError = null;
  };
  function applied() {
    return record && { revision: record.revision, studioHash: studioHashOf(record.plan.model),
      planHash: planHash(record.plan), at: record.at };
  }

  // ------------------------------------------------------------ global side effects

  /**
   * The adapters' only way to the engine's master level (see "Global side effects"): saves the
   * engine's level on the first write, -> whether it wrote (false with masterLevel 'ignore').
   */
  // The Studio's last write: the engine's write count after it (and the level, for an engine
  // that does not count writes). Someone else wrote the level when either differs.
  let ownWrite = null;
  const globalFx = Object.freeze({
    setMasterLevel(g) {
      if (opts.masterLevel === 'ignore') return false;
      if (savedMasterLevel === null) savedMasterLevel = hooks.masterLevel;
      hooks.setMasterLevel(g);
      ownWrite = { count: hooks.masterWrites, level: hooks.masterLevel };
      return true;
    },
  });

  /**
   * Give the engine its level back: at once, or held until audio time `at` (after a fade). Only
   * while the level is still the Studio's own write: a newer level set elsewhere is kept.
   */
  function restoreMaster(at = null) {
    const level = savedMasterLevel;
    const own = ownWrite;
    savedMasterLevel = null;
    ownWrite = null;
    if (level === null) return;
    const ours = !own || (own.count !== null ? hooks.masterWrites === own.count
      : hooks.masterLevel === own.level);
    if (!ours) return;
    if (at === null) hooks.setMasterLevel(level);
    else hooks.restoreMasterLevel(level, at);
  }

  /**
   * A pending handle settled (a Microphone opened, failed or ended): the views refresh its
   * status. A Microphone the browser refused (`denied`) turns the input permission off.
   */
  const settled = (h) => {
    if (!h || handles.get(h.id) !== h) return;
    if (h.code === 'mic-error' && h.denied) opts.inputPermission = false;
    emit('handle', { id: h.id, status: h.status, code: h.code || null });
  };

  // Commit-phase failures still in effect (see "Commit atomicity"): key → Diagnostic.
  const unresolvedMap = new Map();
  const unresolved = () => [...unresolvedMap.values()];

  /** A handle's builder dispose only (no node is touched): releases what is not audio. */
  const release = (h) => {
    try { h.dispose(); } catch (e) { /* already disposed */ }
  };

  const offEngine = hooks.on((type, detail) => {
    if (type === 'context' && detail === 'closed') dropAll();
  });

  /**
   * The context is gone: forget every node without touching it (it belongs to it). Builders are
   * still disposed, since some hold what the context does not own: a Microphone's MediaStream,
   * whose tracks would otherwise keep the input open (v4.0 audit F8).
   */
  function dropAll() {
    for (const job of pending) {
      if (job.timer != null) hooks.timers.clearTimeout(job.timer);
      for (const h of job.handles) release(h);
      job.resolve();
    }
    pending.clear();
    for (const h of handles.values()) release(h);
    for (const n of totals.nodes) {
      engine.nodes.delete(n);
      engine.sources.delete(n);
    }
    totals.nodes.clear();
    totals.sources.clear();
    handles.clear();
    edges.clear();
    bases.clear();
    written.clear();
    unresolvedMap.clear();
    record = null;
    restoreMaster();
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
    // A suspended or closed context renders nothing: its scheduled stops never fire. A timer
    // that cannot be armed releases at once rather than leave a job nothing resolves (D3).
    try {
      if (!ctx || ctx.state !== 'running') finish(job);
      else {
        job.timer = hooks.timers.setTimeout(arm, Math.max(5, (at - ctx.currentTime) * 1000 + 5));
      }
    } catch (e) {
      finish(job);
    }
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
    const before = new Map(peaks);
    peaks.clear();
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e.node !== 'string' || typeof e.param !== 'string') continue;
      if (!owned.has(e.node)) owned.set(e.node, new Set());
      owned.get(e.node).add(e.param);
      if (Number.isFinite(e.peak)) {
        if (!peaks.has(e.node)) peaks.set(e.node, {});
        peaks.get(e.node)[e.param] = e.peak;
      }
    }
    const sig = (v) => (v ? JSON.stringify(Object.entries(v).sort()) : '');
    for (const id of new Set([...before.keys(), ...peaks.keys()])) {
      if (sig(before.get(id)) !== sig(peaks.get(id))) peaksDirty.add(id);
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
    let d = cb.base[key].value - pn.params[key];
    // An AudioParam that also carries log-mapped modulation (an Oscillator's detune holds the
    // frequency edges' constant cents): the owner of that param must schedule those cents too,
    // or a lane on it drops them (V431 review X2/X8).
    const h = handles.get(id);
    const target = h ? modParam(h, key, 'linear') : null;
    if (target) {
      for (const [k, b] of Object.entries(cb.base)) {
        if (b.cents && modParam(h, k, 'log') === target) d += b.cents;
      }
    }
    return Number.isFinite(d) ? d : 0;
  }

  function modParam(h, key, mapping) {
    try {
      const t = h.modTarget(key, mapping);
      return t && t.param ? t.param : null;
    } catch (e) {
      return null;
    }
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

  /** A step of the running transaction (detail only for a live apply, not a fresh start). */
  let note = null;
  function transact(next, ops, rev, fresh = false) {
    const ctx = hooks.ctx;
    const now = ctx.currentTime;
    const X = opts.xfadeS;
    const env = { hooks, owners: [totals], now, at: now, options: opts, global: globalFx,
      settled };
    const createIds = new Set(ops.filter((o) => o.op === 'node-add' || o.op === 'node-replace')
      .map((o) => o.id));
    const edgeAdd = new Set(ops.filter((o) => o.op === 'edge-add' || o.op === 'edge-rewire')
      .map((o) => o.id));
    const edgeRemove = new Set(ops.filter((o) => o.op === 'edge-remove' || o.op === 'edge-rewire')
      .map((o) => o.id));
    const created = { handles: new Map(), edges: new Map() };
    let t;
    let doing = null; // the node or edge being prepared: what a refusal names
    // 2. prepare: silent until the crossfade
    try {
      t = hooks.soon();
      env.at = t;
      for (const id of next.order) {
        doing = { kind: 'node', id };
        if (createIds.has(id)) created.handles.set(id, instantiateNode(next.nodes.get(id), env));
      }
      const handleOf = (id) => created.handles.get(id) || handles.get(id);
      for (const id of next.edgeOrder) {
        if (!edgeAdd.has(id)) continue;
        doing = { kind: 'edge', id };
        const pe = next.edges.get(id);
        created.edges.set(id, createEdgeHandle(pe, handleOf(pe.from.node), handleOf(pe.to.node),
          env));
      }
      const edgeOf = (eid) => created.edges.get(eid)
        || (edgeRemove.has(eid) ? null : edges.get(eid));
      for (const [id, h] of created.handles) {
        if (h.status !== 'ready' && h.status !== 'pending') continue;
        doing = { kind: 'node', id };
        const cb = computeBases(next.nodes.get(id), incomingControl(next, id, edgeOf), hooks,
          peaks.get(id) || null);
        const w = tracing ? {} : null;
        h.applyBase(cb.base, true, NONE_OWNED, w);
        written.set(id, w);
      }
    } catch (err) {
      for (const eh of created.edges.values()) {
        try { eh.dispose(); } catch (e) { /* ignore */ }
      }
      for (const h of created.handles.values()) disposeHandle(h);
      return fail('prepare', err, { kept: true }, undefined, doing);
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
      written.delete(o.id);
    }
    for (const [id, h] of created.handles) handles.set(id, h);
    for (const [id, eh] of created.edges) edges.set(id, eh);
    plan = next;
    // 4. crossfade. Committed: from here nothing may throw out of apply (F4), or the store would
    // refuse a revision whose plan the maps already hold. Every step below is guarded or inside
    // the try; a throw outside a guarded step is commit-failed, and the cleanup still runs.
    const warnings = [];
    note = () => null; // until the trace's note is set (inside the try)
    // A failed step is a warning (owner runtime, code <step>-failed), never a half-applied route.
    const guard = (step, id, fn) => {
      try { fn(); } catch (e) {
        const d = studioDiagnostic('runtime', `${step}-failed`, `${step} ${id}: ${messageOf(e)}`,
          { kind: step === 'route' ? 'edge' : 'node', id });
        warnings.push(d);
        // An engage that failed leaves the running graph short of its plan: it stays visible.
        if (step === 'engage') unresolvedMap.set(`engage|${id}`, d);
        try {
          note(step === 'route' ? step : 'node', id, 'failed', { step, reason: messageOf(e) },
            `${step}-failed`);
        } catch (e2) { /* the trace's error is its own */ }
        return;
      }
      if (step === 'engage') unresolvedMap.delete(`engage|${id}`);
      return true;
    };
    // A route step: the gain an edge ramps to, from `at` until `end` (ramp.js returns it).
    const ramp = (id, eh, gain) => {
      let end = null;
      if (guard('route', id, () => { end = eh.ramp.to(gain, t, X); })) {
        note('route', id, 'scheduled', { gain, at: t, end });
      }
    };
    try {
      trace.record('runtime', 'apply', { revision: rev, outcome: 'applied',
        detail: { at: t, ops: ops.length, nodes: handles.size, edges: edges.size } });
      note = (kind, id, outcome, detail = null, code = null) => (fresh && !code ? null
        : trace.record('runtime', kind, { revision: rev, entity: { kind: kind === 'route'
          ? 'edge' : 'node', id }, outcome, code, detail }));
      for (const o of ops) {
        if (o.op === 'node-add' || o.op === 'node-replace') {
          note('node', o.id, o.op === 'node-add' ? 'built' : 'replaced');
        } else if (o.op === 'node-remove') note('node', o.id, 'retired');
      }
      // An engage that failed earlier: retried on its node, dropped with it (D3).
      for (const key of [...unresolvedMap.keys()]) {
        if (!key.startsWith('engage|')) continue;
        const id = key.slice('engage|'.length);
        const h = handles.get(id);
        if (!h || typeof h.engage !== 'function') unresolvedMap.delete(key);
        else if (!created.handles.has(id)) guard('engage', id, () => h.engage());
      }
      const unit = (type, k) => (registry.param(type, k) || {}).unit || null;
      const affected = new Set(created.handles.keys());
      for (const o of ops) {
        if (o.op === 'node-params') {
          const pn = next.nodes.get(o.id);
          const h = handles.get(o.id);
          const live = o.keys.filter((k) => !(registry.param(pn.type, k) || {}).modulatable);
          if (live.length && h) {
            const changed = {};
            for (const k of live) changed[k] = pn.params[k];
            const own = ownedKeys(h);
            const w = tracing ? {} : null;
            // What the adapter reports it did (w[key] = how): only 'set' and 'glide' act now; a
            // key it did not act on is only stored in the plan (the next gate, a rebuild, a view).
            if (guard('update', o.id, () => h.update(changed, own, w)) && w) {
              for (const k of live) {
                const how = w[k] || null;
                note('param', o.id, how && how !== 'next-gate' ? 'scheduled' : own.has(k) ? 'owned'
                  : 'stored', { param: k, value: pn.params[k], unit: unit(pn.type, k),
                  at: how === 'set' || how === 'glide' ? now : null, via: how });
              }
            }
          }
          if (live.length < o.keys.length) affected.add(o.id);
        } else if (o.op.startsWith('edge-')) {
          const pe = next.edges.get(o.id);
          if (pe && pe.kind === 'control') affected.add(pe.to.node);
        }
      }
      // Targets of removed modulation edges drop their offsets (their plan entry may be gone).
      for (const eh of retire.edges) if (eh.kind === 'control') affected.add(eh.toNode);
      // A lane whose peak changed re-sizes its node's headroom (no graph op names it).
      for (const id of peaksDirty) if (next.nodes.has(id)) affected.add(id);
      peaksDirty.clear();
      const edgeOf = (eid) => edges.get(eid) || null;
      for (const id of affected) {
        const h = handles.get(id);
        if (!h || (h.status !== 'ready' && h.status !== 'pending')) continue;
        const pn = next.nodes.get(id);
        let cb = null;
        if (!guard('parameters', id, () => {
          cb = computeBases(pn, incomingControl(next, id, edgeOf), hooks, peaks.get(id) || null);
        })) continue;
        const prev = bases.get(id);
        bases.set(id, cb);
        if (!created.handles.has(id)) {
          const own = ownedKeys(h);
          const w = tracing ? {} : null;
          if (guard('parameters', id, () => h.applyBase(cb.base, false, own, w)) && w) {
            // Each AudioParam value the adapter reports it wrote that differs from its last
            // write (a glide from now), then each key whose base changed but was not written.
            const was = written.get(id) || {};
            written.set(id, w);
            for (const [k, v] of Object.entries(w)) {
              if (was[k] !== v) {
                note('param', id, 'scheduled', { param: k, value: v, unit: unit(pn.type, k),
                  at: now, via: 'glide' });
              }
            }
            for (const [k, b] of Object.entries(cb.base)) {
              const p = prev && prev.base[k];
              if (k in w || (p && p.value === b.value && p.cents === b.cents)) continue;
              note('param', id, own.has(k) ? 'owned' : 'stored', { param: k, value: b.value,
                unit: unit(pn.type, k) });
            }
          }
        }
        for (const [eid, g] of cb.gains) {
          const eh = edges.get(eid);
          if (eh && eh.ramp && eh.ramp.target !== g) ramp(eid, eh, g);
        }
      }
      for (const [id, eh] of created.edges) {
        if (eh.kind === 'audio' && eh.ramp) {
          ramp(id, eh, next.edges.get(id).props.muted ? ROUTE_FLOOR : 1);
        }
      }
      for (const o of ops) {
        if (o.op !== 'edge-props') continue;
        const eh = edges.get(o.id);
        if (eh && eh.kind === 'audio' && eh.ramp) {
          ramp(o.id, eh, next.edges.get(o.id).props.muted ? ROUTE_FLOOR : 1);
        }
      }
      for (const h of created.handles.values()) {
        if (typeof h.fade === 'function') guard('output', h.id, () => h.fade(1, t, X));
      }
      // Global side effects of the new nodes (the engine's master level): only now, committed.
      for (const h of created.handles.values()) {
        if (typeof h.engage === 'function') guard('engage', h.id, () => h.engage());
      }
      for (const eh of retire.edges) {
        if (eh.ramp) ramp(eh.id, eh, eh.kind === 'audio' ? ROUTE_FLOOR : 0);
      }
      for (const h of retire.handles) {
        if (typeof h.fade === 'function') guard('output', h.id, () => h.fade(ROUTE_FLOOR, t, X));
        guard('stop', h.id, () => h.stop(t + X + SOURCE_STOP_PAD_S));
      }
    } catch (e) {
      const d = studioDiagnostic('runtime', 'commit-failed', `The running graph took `
        + `revision ${rev}, but a step after the commit failed: ${messageOf(e)}`);
      warnings.push(d);
      unresolvedMap.set('commit', d); // what failed is unknown: visible until STOP
      try {
        trace.record('runtime', 'apply', { revision: rev, outcome: 'failed',
          code: 'commit-failed', detail: { reason: messageOf(e) } });
      } catch (e2) { /* the trace's error is its own */ }
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

  function apply(model, args) {
    return trace.run(() => applyNow(model, args));
  }

  function applyNow(model, { revision = null, replace = null } = {}) {
    const rev = revision != null ? revision : (compiledRevision == null ? 1 : compiledRevision + 1);
    attempt = rev;
    attemptModel = model;
    if (disposed) return fail('validate', 'The Studio runtime is disposed.', {}, 'disposed');
    const next = compileStudio(model, { engine, registry, adapters, options: opts });
    if (!next.ok) return fail('validate', next.errors, { kept: true });
    const ops = diffPlans(plan, next, { owned: ownedMap(), replace });
    trace.record('runtime', 'compile', { revision: rev, outcome: 'compiled',
      detail: { planHash: tracing && planHash(next), ops: ops.length } });
    if (state !== 'running' || !hooks.ctx) {
      trace.record('runtime', 'apply', { revision: rev, outcome: 'not-applied',
        detail: { state } });
      plan = next;
      compiledRevision = rev;
      lastOps = ops;
      const result = { ok: true, applied: false, ops, revision: rev, warnings: next.warnings };
      emit('applied', result);
      return result;
    }
    const r = transact(next, ops, rev);
    if (!r.ok) return r;
    compiledRevision = rev;
    commit();
    const result = { ...r, revision: rev, warnings: [...next.warnings, ...r.warnings] };
    emit('applied', result);
    return result;
  }

  function start() {
    return trace.run(startNow);
  }

  function startNow() {
    attempt = compiledRevision;
    attemptModel = plan.model;
    if (disposed) return fail('start', 'The Studio runtime is disposed.', {}, 'disposed');
    if (state === 'running') return { ok: true, applied: false, ops: [],
      revision: compiledRevision };
    if (!plan.model) {
      return fail('start', 'Nothing is compiled yet: apply a Studio model first.', {},
        'nothing-compiled');
    }
    if (!hooks.ensure()) {
      return fail('start', (engine.lastError && engine.lastError.message) || 'Audio could not '
        + 'start.');
    }
    if (typeof engine.resume === 'function') engine.resume();
    setState('running');
    const r = transact(plan, diffPlans(EMPTY_PLAN, plan), compiledRevision, true);
    if (!r.ok) {
      restoreMaster(); // nothing was engaged by a refused transaction; never keep a saved level
      setState('idle');
    } else commit();
    return r.ok ? { ...r, revision: compiledRevision } : r;
  }

  function stop({ fast = false } = {}) {
    const all = () => Promise.all([...pending].map((j) => j.done)).then(() => counts());
    if (state !== 'running') return all();
    record = null;
    unresolvedMap.clear(); // the graph they were about is torn down
    setState('idle');
    const ctx = hooks.ctx;
    if (!ctx) {
      restoreMaster();
      dropAll();
      return Promise.resolve(counts());
    }
    const S = fast ? STUDIO_FAST_STOP_S : opts.stopS;
    const t = hooks.soon();
    trace.record('runtime', 'stop', { revision: compiledRevision, outcome: 'stopped',
      detail: { at: t, fade: S, nodes: handles.size } });
    restoreMaster(t + S);
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
    written.clear();
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
    if ('masterLevel' in next) {
      opts.masterLevel = next.masterLevel;
      if (opts.masterLevel === 'ignore') restoreMaster(); // the Studio no longer owns it
    }
    // Running Microphones whose input failed or ended: the plan does not change (the permission
    // already was on), so they are rebuilt explicitly, which opens the input again (D1).
    const reopened = [];
    if (next.inputPermission === true && state === 'running') {
      for (const [id, h] of handles) {
        if (h.type === 'microphone' && h.status !== 'ready' && h.status !== 'pending'
          && plan.nodes.has(id)) reopened.push(id);
      }
    }
    // The same model and revision under new capabilities: the record keeps its revision and
    // gets the new planHash, so the store revision stays in sync.
    if (!plan.model) return { ok: true, applied: false, ops: [], reopened };
    const r = apply(plan.model, { revision: compiledRevision,
      replace: reopened.length ? new Set(reopened) : null });
    return { ...r, reopened: r.ok ? reopened : [] };
  }

  function bindings() {
    const triggers = [];
    const data = [];
    for (const e of plan.edges.values()) {
      const b = { id: e.id, from: e.from, to: e.to, status: e.status, code: e.code,
        reason: e.reason };
      if (e.kind === 'trigger') triggers.push(b);
      else if (e.kind === 'analysis') data.push(b);
    }
    return { triggers, data };
  }

  function debugInfo() {
    // A live handle's or route's status, else the plan's, with its code (compiler.js).
    const status = (x, live) => {
      const st = live || x;
      return { id: x.id, status: st.status, code: st.code || null, reason: st.reason || null };
    };
    const degraded = [];
    for (const n of plan.nodes.values()) {
      const st = status(n, handles.get(n.id));
      if (st.status !== 'ready' && st.status !== 'data') degraded.push(st);
    }
    const inactiveEdges = [];
    for (const e of plan.edges.values()) {
      const st = status(e, edges.get(e.id));
      if (st.status === 'inactive') inactiveEdges.push(st);
    }
    // Validation's warnings, the last transaction's, and failures still in effect (once each).
    const warned = [...new Set([...plan.warnings, ...lastWarnings, ...unresolved()])];
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
      warnings: warned.map((w) => w.message),
      diagnostics: warned,
      lastOps,
      lastError,
      applied: applied(),
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
    applied,
    unresolved,
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
    get options() {
      return Object.freeze({ masterLevel: opts.masterLevel,
        inputPermission: opts.inputPermission });
    },
  });
}
