// The OSCILLA Studio graph compiler (spec §41-§43, §170-§171, §186-§190, §240-§242; plan issue
// V414): StudioModel → a runtime plan → nodes of the EXISTING AudioEngine runtime. There is no
// second audio engine (§42): every node is built by the adapter of its registry `compiler` key
// (adapters/nodes.js) from the existing builders, registered in the engine's node/source
// accounting (adapters/engine-hooks.js), and the only way out of a Studio graph is the Master
// Output bus into engine.master, the head of the safety chain (master → limiter → trim →
// ceiling → analyser → destination, §186, §240).
//
//   compileStudio(model, { engine, registry, adapters, options }) -> plan
//     plan = { ok, errors, warnings, order, nodes: Map<id, PlanNode>, edges: Map<id, PlanEdge>,
//              edgeOrder, masterId, model }
//     Invalid models are refused ({ ok: false, errors } from validate.js, never a throw): Web
//     Audio never discovers a topology (§38). Unsupported or unavailable nodes compile to an
//     explicit status with a reason instead of throwing (§170-§171).
//     PlanNode = { id, type, name, def, adapter, params, status: 'ready' | 'degraded' |
//                  'offline-only' | 'data', code, reason }
//     PlanEdge = { id, kind: 'audio' | 'control' | 'trigger' | 'analysis', from, to, fromPort,
//                  toPort, paramDef, props (complete), status: 'active' | 'inactive' |
//                  'logical' | 'data', code, reason }
//     `code` is the machine reason of a status (null when there is none), `reason` its display
//     prose (docs/v31/compiler.md "Diagnostics"): node no-adapter, adapter-mismatch,
//     offline-only, no-web-audio, or an adapter check's code (mic-unsupported, mic-off);
//     edge endpoint-offline-only, endpoint-unavailable.
//   planHash(plan) -> hex | null   the plan's identity (below); studioHashOf(model) memoized
//   diffPlans(prev, next, { owned }) -> [op]   the minimal patch (§44), deterministic order;
//     owned: Map<node id, Set<param key>> of parameters another owner drives (runtime
//     setOwnedParams): a change of an adapter's `rebuildWhenOwned` key on such a node is a
//     node-replace (see diffPlans)
//     op = { op: 'node-add' | 'node-remove' | 'node-replace' | 'node-params', id, keys? }
//        | { op: 'edge-add' | 'edge-remove' | 'edge-rewire' | 'edge-props', id, keys? }
//   instantiateNode(planNode, ctxEnv) -> handle      (adapters/nodes.js handle + bookkeeping)
//   createEdgeHandle(planEdge, fromHandle, toHandle, ctxEnv) -> edge handle (gain at 0;
//                                                      fromNode, toNode, toPort, kind, gain)
//   computeBases(planNode, incoming, hooks, peaks) -> { base, gains, limited, exceeds }
//   disposeHandle(handle, acct)                       stop, disconnect, untrack
//
// Routing semantics:
//   - AUDIO edge: source output → edge GainNode → target input. The edge gain is the crossfade
//     point of every route change (0 → 1 on connect, current → ROUTE_FLOOR before a disconnect,
//     ROUTE_FLOOR when muted).
//     Fan-out is explicit (§189): one output feeds as many edge gains as it has edges.
//   - TAP input (analyzers, Capture, Recorder): the same edge into a node with no output, so a
//     tap observes a copy and never alters the audio path (§190).
//   - CONTROL edge: modulator output → edge depth GainNode → the target AudioParam (§35). The
//     source signal range [lo, hi] (LFO/Random/Steps −1..1, Envelope 0..1) maps onto
//     [−depth, depth] (bipolar) or [0, depth] (unipolar) plus offset: gain a = range / (hi − lo)
//     on the edge, constant b = t0 − a·lo + offset added to the parameter's base value. Linear
//     mapping: parameter units. Log mapping (frequency-like parameters): octaves, applied as
//     cents on the node's detune AudioParam (frequency · 2^(cents/1200), exact). Several edges
//     on one parameter add (§104). Frequency parameters are kept at or below 0.95 × Nyquist:
//     the base is clamped and the upward excursion of the edges is scaled down to fit
//     (`limited`, visible in debugInfo). A frequency an automation lane owns is sized from the
//     lane's peak, not from the static parameter it overrides (`peaks`, V431 review X1).
//     Other parameters may exceed their range through
//     modulation; that is reported (`exceeds`), never hidden (§242).
//   - TRIGGER and ANALYSIS edges have no Web Audio connection: they are logical bindings for
//     the timeline/scheduler and the measurement engine.
//
// INVARIANTS: nothing here connects to ctx.destination; every node created is tracked; a
// handle's dispose leaves zero of its nodes in engine.nodes.

import { NODE_REGISTRY } from './registry.js';
import { validateEdgeProps } from './ports.js';
import { studioDiagnostic, validateStudioModel } from './validate.js';
import { studioHash } from './schema.js';
import { canonicalJson } from '../experiments/canonical-json.js';
import { sha256Hex } from '../calibration/sha256.js';
import { NODE_ADAPTERS, inertHandle } from './adapters/nodes.js';
import { createAccounting } from './adapters/engine-hooks.js';
import { createRamp } from './adapters/ramp.js';
import { hasMicrophoneApi } from '../audio/microphone.js';
import { GAIN_FLOOR } from '../core/constants.js';

/** Route crossfade (connect, disconnect, reconnect, replace): filters.js CROSSFADE_S. */
export const STUDIO_XFADE_S = 0.02;
/** Studio stop: the engine's fast release (scheduler.js FAST_RELEASE_S). */
export const STUDIO_STOP_S = 0.015;
/** Sources stop this long after their route has faded out (engine: 10 ms stop margin). */
export const SOURCE_STOP_PAD_S = 0.01;
/** Disposal runs this long after the last fade (UI bookkeeping, never audio timing). */
export const CLEANUP_MARGIN_S = 0.05;
/**
 * Level an audio route or the Studio bus fades to before it is disconnected, and the level of a
 * muted audio edge: the engine's GAIN_FLOOR (−80 dB), never exactly 0. Like the engine's own
 * releases, the signal is never ramped to digital silence while the source still plays: in
 * Firefox an input that turns entirely silent lets the master chain drop the tail of its fade
 * (a step measured at the end of a ramp to 0: 5.4 × the sine slope for a mute, 3.4 × for a
 * stop; at GAIN_FLOOR: 1.0).
 */
export const ROUTE_FLOOR = GAIN_FLOOR;

const CENTS_PER_OCTAVE = 1200;
const DEFAULT_RANGE = Object.freeze([-1, 1]);
const KIND_BY_TYPE = Object.freeze({ AUDIO: 'audio', CONTROL: 'control', TRIGGER: 'trigger',
  ANALYSIS: 'analysis' });

/** What the running browser and engine can do (inputs to adapter `check`). */
export function studioCapabilities(engine, options = {}) {
  const env = engine && engine._env ? engine._env : {};
  const nav = env.navigator || null;
  return {
    realtime: !!engine && (typeof engine.isSupported !== 'function' || engine.isSupported()),
    microphone: hasMicrophoneApi(nav),
    inputPermission: options.inputPermission === true,
  };
}

const nameOf = (node, def) => (node.metadata && node.metadata.name) || def.displayName;

function refused(errors, warnings = []) {
  return { ok: false, errors, warnings, order: null, nodes: new Map(), edges: new Map(),
    edgeOrder: [], masterId: null, model: null };
}

/** StudioModel → plan (see the header). Never throws for a model of the schema shape. */
export function compileStudio(model, {
  engine = null, registry = NODE_REGISTRY, adapters = NODE_ADAPTERS, options = {},
} = {}) {
  let report;
  try {
    report = validateStudioModel(model, { registry });
  } catch (e) {
    return refused([{ ...studioDiagnostic('compiler', 'invalid-structure',
      `The Studio model has an invalid structure: ${e && e.message}`, null, 'error'), path: '' }]);
  }
  if (!report.ok) return refused(report.errors, report.warnings);
  const caps = studioCapabilities(engine, options);
  const byId = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const nodes = new Map();
  let masterId = null;
  for (const id of report.order) {
    const node = byId.get(id);
    const def = registry.get(node.type);
    const adapter = Object.prototype.hasOwnProperty.call(adapters, node.type)
      ? adapters[node.type] : null;
    let status = 'degraded';
    let code = null;
    let reason = null;
    // An adapter check returns null, display prose, or { code, reason }.
    const why = adapter && adapter.check ? adapter.check(node.params, caps) : null;
    if (!adapter) {
      code = 'no-adapter';
      reason = `No Studio compiler adapter for ${def.compiler}.`;
    } else if (adapter.compiler !== def.compiler) {
      code = 'adapter-mismatch';
      reason = `Compiler key mismatch: the registry names ${def.compiler}, the adapter `
        + `implements ${adapter.compiler}.`;
    } else if (!def.capabilities.realtime) {
      status = code = 'offline-only';
      reason = (why && (why.reason || why))
        || `${def.displayName} works only in offline rendering.`;
    } else if (adapter.data) {
      status = 'data';
    } else if (!caps.realtime) {
      code = 'no-web-audio';
      reason = 'The Web Audio API is not available in this browser.';
    } else if (why) {
      code = why.code || 'unavailable';
      reason = why.reason || why;
    } else status = 'ready';
    if (node.type === 'master') masterId = id;
    nodes.set(id, Object.freeze({ id, type: node.type, name: nameOf(node, def), def, adapter,
      params: node.params, status, code, reason }));
  }
  const rank = new Map(report.order.map((id, i) => [id, i]));
  const edges = new Map();
  const sorted = [...model.graph.edges].sort((a, b) => rank.get(a.from.node)
    - rank.get(b.from.node) || rank.get(a.to.node) - rank.get(b.to.node));
  for (const e of sorted) {
    const from = nodes.get(e.from.node);
    const to = nodes.get(e.to.node);
    const fromPort = registry.port(from.type, e.from.port, 'out');
    const toPort = registry.port(to.type, e.to.port, 'in');
    const kind = KIND_BY_TYPE[fromPort.type];
    const paramDef = toPort.param ? registry.param(to.type, toPort.param.key) : null;
    const props = validateEdgeProps(e.props, fromPort.type, toPort, paramDef).props;
    let status = kind === 'trigger' ? 'logical' : kind === 'analysis' ? 'data' : 'active';
    let code = null;
    let reason = null;
    const usable = (n) => n.status === 'ready' || (kind === 'analysis' && n.status === 'data');
    for (const n of [from, to]) {
      if (!usable(n) && status !== 'inactive') {
        const off = n.status === 'offline-only';
        status = 'inactive';
        code = off ? 'endpoint-offline-only' : 'endpoint-unavailable';
        reason = `${n.name} is ${off ? 'offline only' : 'unavailable'}`
          + `${n.reason ? `: ${n.reason}` : '.'}`;
      }
    }
    edges.set(e.id, Object.freeze({ id: e.id, kind, from: e.from, to: e.to, fromPort, toPort,
      paramDef, props, status, code, reason }));
  }
  return { ok: true, errors: [], warnings: report.warnings, order: report.order, nodes, edges,
    edgeOrder: [...edges.keys()], masterId, model };
}

/** The empty plan (nothing compiled yet). */
export const EMPTY_PLAN = Object.freeze({ ok: true, errors: [], warnings: [], order: [],
  nodes: new Map(), edges: new Map(), edgeOrder: [], masterId: null, model: null });

// ---------------------------------------------------------------- plan identity

/** Version of the planHash selection; bump when what it covers changes. */
export const PLAN_HASH_VERSION = 1;

// Store model or plan → its hash (a hex string, never empty): both are immutable once made.
const hashes = new WeakMap();
const memo = (key, fn) => hashes.get(key) || hashes.set(key, fn()).get(key);

/** studioHash (schema.js) of a store model, computed once per model object. */
export const studioHashOf = (model) => memo(model, () => studioHash(model));

/**
 * The identity of a compiled plan: SHA-256 (hex) of canonicalJson({ v, studioHash, nodes, edges })
 * where nodes are [id, type, adapter compiler key, status, code] in topological order and edges
 * [id, kind, from node, from port, to node, to port, status, code] in edge order. Equal models
 * compiled with equal capabilities give equal hashes; a layout, name or view change does not
 * change it (studioHash covers execution state only); a parameter change, a status change
 * (a capability: microphone permission, Web Audio) or a route change does. Plain data in,
 * computed lazily on first read and memoized per plan: never on the audio path. null for a
 * refused or empty plan.
 */
export function planHash(plan) {
  if (!plan || !plan.ok || !plan.model) return null;
  return memo(plan, () => sha256Hex(canonicalJson({
    v: PLAN_HASH_VERSION,
    studioHash: studioHashOf(plan.model),
    nodes: plan.order.map((id) => {
      const n = plan.nodes.get(id);
      return [id, n.type, n.adapter ? n.adapter.compiler : null, n.status, n.code];
    }),
    edges: plan.edgeOrder.map((id) => {
      const e = plan.edges.get(id);
      return [id, e.kind, e.from.node, e.from.port, e.to.node, e.to.port, e.status, e.code];
    }),
  })));
}

// ---------------------------------------------------------------- diff (§44)

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => !sameValue(a[k], b[k])).sort();

/**
 * The minimal patch from `prev` to `next` (both plans). A parameter change on a running node
 * is `node-params` unless it touches a structural key of its adapter (`node-replace`); edges of
 * a replaced node are `edge-rewire` (rebuilt and crossfaded); a modulation edge whose mapping
 * changes is rewired (it targets another AudioParam); other edge property changes are
 * `edge-props`. `owned` (Map node id → Set of owned parameter keys): on a node with an owned
 * parameter, a change of one of its adapter's `rebuildWhenOwned` keys is a `node-replace` too —
 * the builder's live update for that key rewrites every parameter and cannot skip an owned one
 * (adapters/nodes.js, the owned-parameter contract).
 */
export function diffPlans(prev, next, { owned = null } = {}) {
  const ops = [];
  const replaced = new Set();
  const removed = new Set();
  for (const [id, n] of next.nodes) {
    const p = prev.nodes.get(id);
    if (!p) { ops.push({ op: 'node-add', id }); continue; }
    if (p.type !== n.type || p.status !== n.status || p.reason !== n.reason) {
      replaced.add(id);
      ops.push({ op: 'node-replace', id, keys: [] });
      continue;
    }
    const keys = changedKeys(p.params, n.params);
    if (!keys.length) continue;
    const ownedHere = !!(owned && owned.get(id) && owned.get(id).size);
    const rebuild = ownedHere && n.adapter ? n.adapter.rebuildWhenOwned || [] : [];
    const structural = n.adapter ? keys.filter((k) => n.adapter.structural.includes(k)
      || rebuild.includes(k)) : keys;
    if (structural.length) {
      replaced.add(id);
      ops.push({ op: 'node-replace', id, keys });
    } else {
      ops.push({ op: 'node-params', id, keys });
    }
  }
  for (const id of prev.nodes.keys()) {
    if (!next.nodes.has(id)) { removed.add(id); ops.push({ op: 'node-remove', id }); }
  }
  for (const [id, e] of next.edges) {
    const p = prev.edges.get(id);
    if (!p) { ops.push({ op: 'edge-add', id }); continue; }
    const moved = p.from.node !== e.from.node || p.from.port !== e.from.port
      || p.to.node !== e.to.node || p.to.port !== e.to.port || p.kind !== e.kind;
    if (moved) {
      ops.push({ op: 'edge-remove', id }, { op: 'edge-add', id });
      continue;
    }
    if (replaced.has(e.from.node) || replaced.has(e.to.node) || p.status !== e.status
      || p.props.mapping !== e.props.mapping) {
      ops.push({ op: 'edge-rewire', id });
      continue;
    }
    const keys = changedKeys(p.props, e.props);
    if (keys.length) ops.push({ op: 'edge-props', id, keys });
  }
  for (const id of prev.edges.keys()) {
    if (!next.edges.has(id)) ops.push({ op: 'edge-remove', id });
  }
  return ops;
}

// ---------------------------------------------------------------- instantiation

function stopAndDisconnect(nodes, sources) {
  for (const s of sources) {
    try { s.stop(); } catch (e) { /* never started or already stopped */ }
  }
  for (const n of nodes) {
    try { n.disconnect(); } catch (e) { /* already disconnected */ }
  }
}

/**
 * Build one node. ctxEnv = { hooks, owners: [{ nodes, sources }], now, at, options }. Returns
 * the adapter handle plus { id, type, name, nodes, sources, acct }. A non-ready plan node
 * becomes an inert handle carrying its status and reason. A builder that throws leaves no
 * tracked node behind (the error propagates to the transaction).
 */
export function instantiateNode(planNode, ctxEnv) {
  const own = { nodes: new Set(), sources: new Set() };
  const base = { id: planNode.id, type: planNode.type, name: planNode.name, ...own };
  if (planNode.status !== 'ready') {
    return { ...inertHandle(planNode.status, planNode.reason), code: planNode.code, ...base,
      acct: null };
  }
  const { hooks } = ctxEnv;
  const acct = createAccounting(hooks, [own, ...ctxEnv.owners]);
  try {
    const h = planNode.adapter.create({ ctx: hooks.ctx, hooks, acct, now: ctxEnv.now,
      at: ctxEnv.at, params: planNode.params, node: planNode, def: planNode.def,
      options: ctxEnv.options || {} });
    return Object.assign(h, base, { nodes: own.nodes, sources: own.sources, acct });
  } catch (e) {
    stopAndDisconnect(own.nodes, own.sources);
    for (const n of [...own.nodes]) acct.untrack(n);
    throw e;
  }
}

/** Stop, dispose, disconnect and untrack everything a handle owns. Never throws. */
export function disposeHandle(handle) {
  try { handle.dispose(); } catch (e) { /* the builder was already disposed */ }
  stopAndDisconnect(handle.nodes, handle.sources);
  if (handle.acct) for (const n of [...handle.nodes]) handle.acct.untrack(n);
  handle.nodes.clear();
  handle.sources.clear();
}

/**
 * Route one edge (gain at 0; the transaction ramps it). ctxEnv = { hooks, owners, now }.
 * Returns { id, kind, status: 'active' | 'inactive' | 'logical' | 'data', code, reason, gain,
 * ramp, scale, range, dispose() }; a route the handles cannot make is inactive with code
 * no-output, no-input or no-mod-target (the plan's code otherwise).
 */
export function createEdgeHandle(planEdge, fromHandle, toHandle, ctxEnv) {
  const base = { id: planEdge.id, kind: planEdge.kind, fromNode: planEdge.from.node,
    toNode: planEdge.to.node, toPort: planEdge.to.port, gain: null, ramp: null, scale: 1,
    range: null, dispose() {} };
  if (planEdge.status !== 'active') {
    return { ...base, status: planEdge.status, code: planEdge.code, reason: planEdge.reason };
  }
  const inactive = (code, reason) => ({ ...base, status: 'inactive', code, reason });
  const out = fromHandle && fromHandle.outputs[planEdge.from.port];
  if (!out) {
    return inactive('no-output', `${fromHandle ? fromHandle.name : planEdge.from.node} has no `
      + `${planEdge.from.port} output here${fromHandle && fromHandle.reason
        ? `: ${fromHandle.reason}` : '.'}`);
  }
  let target;
  let scale = 1;
  if (planEdge.kind === 'audio') {
    target = toHandle && toHandle.inputs[planEdge.to.port];
    if (!target) {
      return inactive('no-input', `${toHandle ? toHandle.name : planEdge.to.node} has no `
        + `${planEdge.to.port} input here.`);
    }
  } else {
    const t = toHandle.modTarget(planEdge.to.port, planEdge.props.mapping);
    if (!t || !t.param) {
      return inactive('no-mod-target', t && t.reason ? t.reason : 'No modulation target.');
    }
    target = t.param;
    scale = t.scale;
  }
  const { hooks } = ctxEnv;
  const own = { nodes: new Set(), sources: new Set() };
  const acct = createAccounting(hooks, [own, ...ctxEnv.owners]);
  const ctx = hooks.ctx;
  const gain = acct.track(ctx.createGain());
  const ramp = createRamp(gain.gain, 0, ctxEnv.now, ctx.sampleRate);
  out.connect(gain);
  gain.connect(target);
  return {
    ...base,
    status: 'active',
    code: null,
    reason: null,
    gain,
    ramp,
    scale,
    range: planEdge.kind === 'control'
      ? (fromHandle.outputRange[planEdge.from.port] || DEFAULT_RANGE) : null,
    nodes: own.nodes,
    dispose() {
      try { out.disconnect(gain); } catch (e) { /* already disconnected */ }
      try { gain.disconnect(); } catch (e) { /* already disconnected */ }
      acct.untrack(gain);
    },
  };
}

// ---------------------------------------------------------------- parameter bases

/**
 * Base values of a node's modulatable parameters and the gains of its incoming modulation
 * edges. incoming = [{ edge: PlanEdge, handle: edge handle }]. Returns
 *   base:    { key: { value (parameter unit, offsets included), cents (log edges) } }
 *   gains:   Map<edgeId, edge GainNode value>   (muted edges: 0)
 *   limited: Set<edgeId>   upward excursion scaled down to stay ≤ 0.95 × Nyquist
 *   exceeds: [key]         base + modulation may leave the parameter range (reported, §242)
 * peaks: { key: value } (optional) the highest value another owner (an automation lane) gives a
 * parameter, in its unit and before the edges' offsets. A frequency's headroom is sized from
 * the larger of its base and that peak (plus the same offsets), never above the cap: the lane
 * overrides the static value, so a lane held at 20 kHz under a static 440 Hz still limits a
 * two-octave LFO to 0.95 × Nyquist (V431 review X1).
 */
export function computeBases(planNode, incoming, hooks, peaks = null) {
  const base = {};
  const defs = new Map();
  for (const p of planNode.def.params) {
    if (!p.modulatable) continue;
    base[p.key] = { value: planNode.params[p.key], cents: 0 };
    defs.set(p.key, p);
  }
  const gains = new Map();
  const limited = new Set();
  const exceeds = [];
  const groups = new Map();
  for (const { edge, handle } of incoming) {
    if (!handle || handle.status !== 'active' || edge.kind !== 'control') continue;
    const key = edge.to.port;
    if (!base[key]) continue;
    const pr = edge.props;
    if (pr.muted) { gains.set(edge.id, 0); continue; }
    const [lo, hi] = handle.range || DEFAULT_RANGE;
    const t0 = pr.polarity === 'unipolar' ? 0 : -pr.depth;
    const a = (pr.depth - t0) / (hi - lo);
    const b = t0 - a * lo + pr.offset;
    const log = pr.mapping === 'log';
    if (log) base[key].cents += CENTS_PER_OCTAVE * b;
    else base[key].value += b;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: edge.id, a, up: Math.max(a * lo, a * hi),
      down: Math.min(a * lo, a * hi), log, scale: handle.scale });
  }
  for (const [key, b] of Object.entries(base)) {
    const p = defs.get(key);
    const list = groups.get(key) || [];
    const isFreq = p.unit === 'Hz';
    const cap = isFreq && hooks ? Math.min(p.max, hooks.safeMaximum) : p.max;
    const offset = Number.isFinite(b.value - planNode.params[key])
      ? b.value - planNode.params[key] : 0;
    if (isFreq) {
      if (b.value > cap) b.value = cap;
      if (b.value < p.min) b.value = p.min;
    }
    const peak = peaks && Number.isFinite(peaks[key]) ? peaks[key] + offset : -Infinity;
    const ref = isFreq ? Math.min(cap, Math.max(b.value, peak)) : b.value;
    const lin = list.filter((x) => !x.log);
    const logs = list.filter((x) => x.log);
    let up = lin.reduce((s, x) => s + x.up, 0);
    let k = 1;
    if (isFreq && up > 0 && ref + up > cap) {
      k = Math.max(0, cap - ref) / up;
      for (const x of lin) limited.add(x.id);
      up *= k;
    }
    for (const x of lin) gains.set(x.id, x.a * k * x.scale);
    let kc = 1;
    if (logs.length) {
      const top = Math.max(ref + up, 1e-9);
      const room = CENTS_PER_OCTAVE * Math.log2(cap / top);
      const upC = logs.reduce((s, x) => s + CENTS_PER_OCTAVE * x.up, 0);
      if (isFreq && b.cents > room) {
        b.cents = room;
        for (const x of logs) limited.add(x.id);
      }
      if (isFreq && upC > 0 && b.cents + upC > room) {
        kc = Math.max(0, room - b.cents) / upC;
        for (const x of logs) limited.add(x.id);
      }
      for (const x of logs) gains.set(x.id, x.a * kc * x.scale);
    }
    if (!isFreq && list.length) {
      const down = lin.reduce((s, x) => s + x.down, 0);
      if (b.value + up > p.max || b.value + down < p.min) exceeds.push(key);
    } else if (!isFreq && (b.value > p.max || b.value < p.min)) {
      exceeds.push(key);
    }
  }
  return { base, gains, limited, exceeds };
}
