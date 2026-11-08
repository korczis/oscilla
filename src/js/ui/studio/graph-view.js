// Studio graph view descriptors (spec §31-§37, §65-§77, §121, §138-§139, §143, §170-§171). Pure:
// the StudioModel (and an optional compiled plan) in, plain view records out. The DOM renderer
// (graph-editor.js), the compact widget and the connection dialog only draw these records; they
// never decide compatibility, labels or status themselves.
//
//   nodeCard(model, node, opts) -> { id, type, name, title, typeLabel, category, categoryLabel,
//     summary, inputs: [port], outputs: [port], flags, status, reason, ariaLabel }
//   edgeView(model, edge, opts) -> { id, type, cable, muted, inactive, route, reason, from, to,
//     ariaLabel, title }
//   edgeRoute(model, edge, { registry, status }) -> { state: 'live' | 'no-route' | 'no-effect',
//     reason, text, short }        a cable that carries nothing says why (§237)
//   edgeEffectReason(model, edge, registry) -> reason | null   routed but inaudible modulation
//   compiledEdgeStatus(plan) -> Map edgeId -> { status, reason }
//   nodeWarnings(model, registry) -> Map nodeId -> [message]      (validator warnings, §77)
//   probeConnection(model, from, to, registry) -> { allowed, reason, signalType }
//   probeRewire(model, from, to, { detach, registry }) -> { allowed, reason, signalType, remove,
//     replaces, same }        a cable drop (K008): `detach` (the edge a drag picked up at its
//     input end) is judged as gone, and an occupied single input as replaced
//   connectionTargets(model, from, registry, { rewire, detach }) -> [{ node, port, nodeName,
//     portLabel, type, allowed, reason, label, replaces, same }]   every input of every other
//     node (§65, §139); `rewire` judges each by probeRewire (a cable drag), else by
//     probeConnection (tap-connect, the Connect dialog)
//   connectableTypes(model, from, registry) -> [type]   node types with an input that accepts
//     the source port type and role (create-node-from-cable, §66)
//   firstCompatibleInput(def, sourcePort) -> port | null
//   compiledStatus(plan) -> Map nodeId -> { status, code, reason }   (code: compiler.js)
//   runtimeStatus(model, runtime, revision?) -> { nodes: Map, edges: Map }   what the running
//     graph plays, judged by runtime.js studioDivergence; a `not-in-runtime` status
//     says why by the verdict's state (notInRuntimeText) and, when refused, carries the
//     diagnostic's `cause: { node | edge, code }` (divergenceCause); armed and current, what the
//     live model leaves out is `outside-live` (OUTSIDE_LIVE_TEXT), never an error
//
// INVARIANT: probeConnection asks the same validator the store uses (validateStudioModel on the
// model plus the candidate edge), so the live feedback of a cable drag and the store's verdict
// on EDGE_ADD cannot disagree; the store still has the last word (§33, §46).

import { NODE_REGISTRY } from '../../studio/registry.js';
import { CLIP_TARGET_TEXT, gainIsUsed, qIsUsed } from '../../studio/clip-targets.js';
import { PORT_VISUALS, canConnect, validateEdgeProps } from '../../studio/ports.js';
import { validateStudioModel } from '../../studio/validate.js';
import { article, describeEdge, describeNode, describePortLabel } from '../../studio/a11y.js';
import { studioDivergence } from '../../studio/runtime.js';
import { liveModel } from '../../studio/live-notes.js';

/** Short category labels on node cards (text, never colour alone, §32, §167). */
export const CATEGORY_LABELS = Object.freeze({
  SOURCES: 'Source',
  MODULATION: 'Modulation',
  PROCESSING: 'Processing',
  ANALYSIS: 'Analysis',
  OUTPUT: 'Output',
  MEASUREMENT: 'Measurement',
});

/** Text of a compiled node status that is not simply ready (§170-§171). */
export const STATUS_LABELS = Object.freeze({
  degraded: 'Unavailable',
  'offline-only': 'Offline only',
  'outside-live': 'Not in the armed chain',
});

/**
 * Reason of a node or cable the ARMED live model leaves out (live-notes.js liveModel keeps what a
 * cable joins to a note source, and the master): it is not broken, nothing plays it until Play.
 */
export const OUTSIDE_LIVE_TEXT = 'Not in the armed chain: armed, only what a cable joins to a '
  + 'note source (Keys, MIDI, a sequencer) plays, and this is not joined to one. Play plays the '
  + 'whole graph.';

const nodeById = (model, id) => model.graph.nodes.find((n) => n.id === id) || null;

/** Validator warnings per node (unconnected sources, open required inputs). */
export function nodeWarnings(model, registry = NODE_REGISTRY) {
  const out = new Map();
  let report;
  try {
    report = validateStudioModel(model, { registry });
  } catch (e) {
    return out;
  }
  for (const d of report.warnings) {
    if (!d.nodeId) continue;
    if (!out.has(d.nodeId)) out.set(d.nodeId, []);
    out.get(d.nodeId).push(d.message);
  }
  return out;
}

/** { status, code, reason } of a plan node or edge, a runtime handle or route. */
const statusOf = (x) => ({ status: x.status, code: x.code || null, reason: x.reason || null });

/** Node id -> { status, code, reason } of a compiled plan (compiler.js compileStudio). */
export function compiledStatus(plan) {
  const out = new Map();
  if (!plan || !plan.nodes) return out;
  for (const [id, n] of plan.nodes) out.set(id, statusOf(n));
  return out;
}

/** Edge id -> { status, code, reason } of a compiled plan (PlanEdge status, compiler.js). */
export function compiledEdgeStatus(plan) {
  const out = new Map();
  if (!plan || !plan.edges) return out;
  for (const [id, e] of plan.edges) out.set(id, statusOf(e));
  return out;
}

/** The node or edge a diagnostic names ({ kind, id } | null): its entity, else validation's ids. */
const entityOfDiagnostic = (d) => (!d ? null : d.entity && d.entity.id ? d.entity
  : d.nodeId ? { kind: 'node', id: d.nodeId } : d.edgeId ? { kind: 'edge', id: d.edgeId }
    : null);

/** "LFO 1" or "connection from LFO 1 output to Filter 1 cutoff": what `ent` names. */
function entityText(model, ent) {
  if (!ent) return null;
  if (ent.kind === 'node') {
    const n = model && nodeById(model, ent.id);
    return n ? n.metadata.name : `node ${ent.id}`;
  }
  if (ent.kind === 'edge') {
    const known = model && model.graph.edges.some((e) => e.id === ent.id);
    const d = known ? describeEdge(model, ent.id) : `Connection ${ent.id}`;
    return `${d[0].toLowerCase()}${d.slice(1)}`;
  }
  return `${ent.kind} ${ent.id}`;
}

/** A diagnostic in words: "message (LFO 1, prepare-failed)"; every part it has, none it lacks. */
function diagnosticText(model, d) {
  const where = [entityText(model, entityOfDiagnostic(d)), d.code].filter(Boolean).join(', ');
  return [d.message, where ? `(${where})` : null].filter(Boolean).join(' ') || 'no reason given';
}

/**
 * The cause a diagnostic names, for a jump (the Inspector selects it): { node | edge | clip |
 * lane: id, code } | null.
 */
export function divergenceCause(d) {
  if (!d) return null;
  const ent = entityOfDiagnostic(d);
  return { ...(ent ? { [ent.kind]: ent.id } : {}), code: d.code || null };
}

/**
 * Reason of a model node or edge the running graph does not reflect (runtimeStatus), by the
 * divergence verdict (runtime.js studioDivergence) and the model its entities are named from.
 * Only 'refused' says refused, and names the runtime's diagnostic. 'behind' is an edit the
 * runtime has not taken yet, which nothing refused (transport.js: while playing, its next sync,
 * at the next edit or wake-up, applies the store's revision; once stopped, PLAY applies it).
 * 'not-applied': the Studio graph is not running.
 */
export function notInRuntimeText(verdict, model = null) {
  const v = verdict || {};
  const a = v.applied;
  const plays = a && a.revision != null ? `revision ${a.revision}` : 'the last applied graph';
  if (v.state === 'refused') {
    return 'Not in the running graph: the runtime refused this update: '
      + `${diagnosticText(model, v.reason || {})}. The last working graph keeps playing.`;
  }
  if (v.state === 'behind') {
    return `Not in the running graph: this edit is not applied yet (${plays} plays). While `
      + 'playing, the next sync applies it; when stopped, the next Play does.';
  }
  if (v.state === 'not-applied') {
    return 'Not in the running graph: the Studio graph is not running, so nothing is applied; '
      + `Play applies it.${v.reason ? ` The last Play failed on it: ${diagnosticText(model,
        v.reason)}.` : ''}`;
  }
  // in-sync or degraded: the applied revision is this one, and its plan does not hold it.
  return `Not in the running graph: the plan of ${plays} does not hold it`
    + `${v.reason ? ` (${diagnosticText(model, v.reason)})` : ''}.`;
}

/**
 * True when the runtime's plan was compiled from liveModel(model) (an armed run, transport.js
 * view) rather than the whole model: the live model is smaller and the plan holds its nodes.
 */
function playsLiveModel(model, plan) {
  const ids = plan.model ? plan.model.graph.nodes : null;
  const live = liveModel(model).graph.nodes;
  return !!ids && live.length < model.graph.nodes.length && live.length === ids.length
    && live.every((n, i) => n.id === ids[i].id);
}

/**
 * Node and edge status from the RUNNING Studio runtime (runtime.js: plan, nodes, edges,
 * lastError), the same shape as compiledStatus / compiledEdgeStatus (V431 review #15). A node
 * shows its live handle's status (a Microphone waiting for permission, a builder that degraded
 * at run time), an edge its route's. When the divergence verdict (runtime.js studioDivergence,
 * for the store `revision` when given) is not in-sync, a model node or edge the runtime's plan
 * does not reflect (the node's type or parameters, or the edge, differ) is `degraded` /
 * `inactive` with code `not-in-runtime` and the reason, so a graph that is not playing never
 * looks live. The reason is the verdict's state in words (notInRuntimeText), and a refused one
 * adds `cause` (divergenceCause: the node or edge the runtime's diagnostic names, and its code).
 * Armed (transport.js plays liveModel), the plan is the live model of this one, which leaves out
 * on purpose what no cable joins to a note source (playsLiveModel); while current, such a node
 * is `outside-live` and its cables `inactive`, both with code `outside-live`, never `degraded`.
 */
export function runtimeStatus(model, runtime, revision = null) {
  const plan = runtime.plan;
  const verdict = studioDivergence({ model, revision }, runtime);
  // degraded: the applied revision runs, short of a failed step (its diagnostic names it).
  const current = verdict.state === 'in-sync' || verdict.state === 'degraded';
  // The reason is the verdict's alone: an older runtime.lastError is not this state's cause.
  const reason = notInRuntimeText(verdict, model);
  const cause = verdict.state === 'refused' ? divergenceCause(verdict.reason) : null;
  const notIn = (status) => ({ status, code: 'not-in-runtime', reason, ...(cause ? { cause }
    : {}) });
  const planEdges = !current && plan.model
    ? new Map(plan.model.graph.edges.map((e) => [e.id, e])) : null;
  const nodes = new Map();
  const stale = new Set();
  const outside = new Set(); // armed and current: left out of the live model on purpose
  let armed = null; // computed at the first node the plan lacks
  const outsideLive = (status) => ({ status, code: 'outside-live', reason: OUTSIDE_LIVE_TEXT });
  for (const node of model.graph.nodes) {
    const pn = plan.nodes.get(node.id);
    if (!pn && current && (armed === null ? (armed = playsLiveModel(model, plan)) : armed)) {
      outside.add(node.id);
      nodes.set(node.id, outsideLive('outside-live'));
      continue;
    }
    if (!pn || (!current && (pn.type !== node.type || pn.params !== node.params))) {
      stale.add(node.id);
      nodes.set(node.id, notIn('degraded'));
      continue;
    }
    const h = runtime.nodes.get(node.id);
    const st = h && h.status ? h : pn;
    nodes.set(node.id, statusOf(st));
  }
  const edges = new Map();
  for (const e of model.graph.edges) {
    const pe = plan.edges.get(e.id);
    if (!pe && (outside.has(e.from.node) || outside.has(e.to.node))) {
      edges.set(e.id, outsideLive('inactive'));
      continue;
    }
    if (!pe || stale.has(e.from.node) || stale.has(e.to.node)
      || (planEdges && planEdges.get(e.id) !== e)) {
      edges.set(e.id, notIn('inactive'));
      continue;
    }
    const eh = runtime.edges.get(e.id);
    const st = eh && eh.status ? eh : pe;
    edges.set(e.id, statusOf(st));
  }
  return { nodes, edges };
}

/** The filter adapter's reason for not applying Q modulation (adapters/processing.js modTarget). */
export const FILTER_Q_NOT_APPLIED = 'Low-/high-pass Q is a dB AudioParam in Web Audio; a linear Q '
  + 'modulation would be mis-scaled, so it is not applied.';

/**
 * Why a modulation the compiler routes cannot be heard, or null (§237: a graph must not look
 * live when it is not). Three rules, all from the node's own model:
 *   - Filter Q on a low-pass or high-pass filter: the adapter does not apply it (Q is a dB
 *     AudioParam there; adapters/processing.js filter.modTarget, the same reason text; the parity
 *     with the runtime's inactive edges is a unit test).
 *   - Filter Q on a low-shelf or high-shelf filter: Web Audio ignores it (clip-targets.js
 *     qIsUsed, the adapter's reason).
 *   - Filter gain on any type but peaking and the shelves: Web Audio ignores a biquad's gain
 *     for low-pass, high-pass, band-pass, notch and all-pass (clip-targets.js gainIsUsed; the
 *     registry's own constraint).
 */
export function edgeEffectReason(model, edge, registry = NODE_REGISTRY) {
  const b = nodeById(model, edge.to.node);
  if (!b || b.type !== 'filter') return null;
  const tgt = registry.port(b.type, edge.to.port, 'in');
  if (!tgt || tgt.role !== 'PARAMETER') return null;
  const type = b.params && b.params.type;
  if (edge.to.port === 'Q' && (type === 'lowpass' || type === 'highpass')) {
    return FILTER_Q_NOT_APPLIED;
  }
  if (edge.to.port === 'Q' && !qIsUsed(type)) return CLIP_TARGET_TEXT.filterQUnused;
  if (edge.to.port === 'gain' && !gainIsUsed(type)) {
    const p = registry.param(b.type, 'type');
    const o = p && (p.options || []).find((x) => x[0] === type);
    const label = o ? o[1] : String(type);
    return `Filter gain applies to peaking and the shelves only; ${article(label)} ${label} `
      + 'filter ignores it.';
  }
  return null;
}

/**
 * Whether a cable carries anything (§237, docs/v31/compiler.md "inactive routes with a
 * reason"): 'live', 'no-route' (the compiled plan has no Web Audio route for it: an unavailable
 * or offline-only end) or 'no-effect' (routed, but the target cannot change the sound).
 * opts: { registry, status: { status, reason } of the plan edge | null }.
 * -> { state, reason, text, short }; text and short are what labels and notes say.
 */
export function edgeRoute(model, edge, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const st = opts.status || null;
  if (st && st.status === 'inactive') {
    const a = nodeById(model, edge.from.node);
    const src = a ? registry.port(a.type, edge.from.port, 'out') : null;
    const routed = !src || src.type === 'AUDIO' || src.type === 'CONTROL';
    const short = routed ? 'no Web Audio route' : 'inactive';
    const reason = st.reason || 'An end of this connection is unavailable.';
    return { state: 'no-route', reason, short,
      text: `${short[0].toUpperCase()}${short.slice(1)}: ${reason}` };
  }
  const why = edgeEffectReason(model, edge, registry);
  if (why) {
    return { state: 'no-effect', reason: why, short: 'no audible effect',
      text: `No audible effect: ${why}` };
  }
  return { state: 'live', reason: null, short: null, text: null };
}

function portView(model, node, port, connectedSet) {
  const vis = PORT_VISUALS[port.type];
  const key = `${port.direction}:${port.id}`;
  return {
    id: port.id,
    key,
    direction: port.direction,
    type: port.type,
    role: port.role,
    shape: vis ? vis.shape : 'circle',
    label: port.label,
    param: port.role === 'PARAMETER',
    connected: connectedSet.has(key),
    ariaLabel: describePortLabel(model, node.id, port.id, port.direction),
  };
}

/**
 * The card of one node. opts: { registry, selected, status: { status, reason } | null,
 * warnings: [message] }. Status flags (§77): selected, unconnected (a validator warning), error
 * (degraded: unavailable), offline (offline only), bypassed (a disabled filter).
 */
export function nodeCard(model, node, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const def = registry.get(node.type);
  const connected = new Set();
  for (const e of model.graph.edges) {
    if (e.from.node === node.id) connected.add(`out:${e.from.port}`);
    if (e.to.node === node.id) connected.add(`in:${e.to.port}`);
  }
  const st = opts.status || null;
  const status = st ? st.status : null;
  const warnings = opts.warnings || [];
  const bypassed = !!(node.params && node.params.enabled === false);
  const flags = {
    selected: !!opts.selected,
    unconnected: warnings.length > 0,
    error: status === 'degraded',
    offline: status === 'offline-only',
    bypassed,
  };
  const reason = st && st.reason ? st.reason : null;
  const statusLabel = STATUS_LABELS[status] || (bypassed ? 'Bypassed'
    : flags.unconnected ? 'Not connected' : null);
  return {
    id: node.id,
    type: node.type,
    name: node.metadata.name,
    title: node.metadata.name.toUpperCase(),
    typeLabel: def ? def.displayName : node.type,
    category: def ? def.category : 'UNKNOWN',
    categoryLabel: def ? CATEGORY_LABELS[def.category] || def.category : 'Unknown',
    summary: registry.summarize(node),
    inputs: def ? def.inputs.map((p) => portView(model, node, p, connected)) : [],
    outputs: def ? def.outputs.map((p) => portView(model, node, p, connected)) : [],
    flags,
    status,
    statusLabel,
    reason: reason || (warnings[0] || null),
    ariaLabel: describeNode(model, node.id, { selected: flags.selected, status,
      summary: true, connections: true, registry }),
  };
}

/**
 * The view of one edge: its signal type (from the source port), cable style, whether it is live
 * (edgeRoute; opts.status is the plan edge's { status, reason }) and labels that say why not.
 */
export function edgeView(model, edge, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const a = nodeById(model, edge.from.node);
  const b = nodeById(model, edge.to.node);
  const src = a ? registry.port(a.type, edge.from.port, 'out') : null;
  const tgt = b ? registry.port(b.type, edge.to.port, 'in') : null;
  const type = src ? src.type : 'AUDIO';
  const route = edgeRoute(model, edge, { registry, status: opts.status || null });
  const described = describeEdge(model, edge.id, { selected: !!opts.selected, registry });
  const label = route.text ? `${described}. ${route.text}` : described;
  return {
    id: edge.id,
    type,
    cable: PORT_VISUALS[type] ? PORT_VISUALS[type].cable : 'solid',
    muted: !!(edge.props && edge.props.muted),
    selected: !!opts.selected,
    inactive: route.state !== 'live',
    route: route.state,
    reason: route.reason,
    from: { node: edge.from.node, port: edge.from.port },
    to: { node: edge.to.node, port: edge.to.port },
    targetRole: tgt ? tgt.role : null,
    ariaLabel: label,
    title: label,
  };
}

function probeId(model) {
  const used = new Set(model.graph.edges.map((e) => e.id));
  let i = 0;
  while (used.has(`probe-${i}`)) i++;
  return `probe-${i}`;
}

/**
 * Would EDGE_ADD { from, to } be accepted? The port check of ports.js canConnect, then the
 * store's own validation of the model with the candidate edge (multiple connections,
 * duplicates, feedback and control cycles, live input to output). Never throws.
 */
export function probeConnection(model, from, to, registry = NODE_REGISTRY) {
  const no = (reason) => ({ allowed: false, reason, signalType: null });
  const a = from ? nodeById(model, from.node) : null;
  const b = to ? nodeById(model, to.node) : null;
  if (!a || !b) return no('Unknown node.');
  const src = registry.port(a.type, from.port, 'out');
  const tgt = registry.port(b.type, to.port, 'in');
  const verdict = canConnect(src, tgt, { sourceNodeId: a.id, targetNodeId: b.id });
  if (!verdict.allowed) return no(`Connection rejected: ${verdict.reason}`);
  const paramDef = tgt.param ? registry.param(b.type, tgt.param.key) : null;
  const props = validateEdgeProps(undefined, verdict.signalType, tgt, paramDef);
  if (!props.ok) return no('Connection rejected: invalid connection properties.');
  const edge = { id: probeId(model), from: { node: a.id, port: src.id },
    to: { node: b.id, port: tgt.id }, props: props.props };
  const trial = { ...model, graph: { ...model.graph, edges: [...model.graph.edges, edge] } };
  let report;
  try {
    report = validateStudioModel(trial, { registry });
  } catch (e) {
    return no(`Connection rejected: ${e && e.message}`);
  }
  if (!report.ok) {
    const err = report.errors[0];
    const msg = err.detail ? `${err.message} (${err.detail})` : err.message;
    return no(/^Connection rejected/.test(msg) ? msg : `Connection rejected: ${msg}`);
  }
  return { allowed: true, reason: null, signalType: verdict.signalType };
}

/**
 * Would a cable drag that ends on `to` be accepted (K008)? `detach` is the edge the drag picked
 * up at its input end, or null for a new cable from an output: it is judged as removed, and a
 * drop back on its own input is `same` (nothing to do). An input that takes one connection and
 * has one from another output is judged as replaced (`replaces`: its edge ids); one from the same
 * output stays, so the validator names the duplicate. `remove` is what the drop removes before
 * EDGE_ADD. The verdict is probeConnection's on the model without the removed edges. Never throws.
 */
export function probeRewire(model, from, to, { detach = null, registry = NODE_REGISTRY } = {}) {
  const none = { remove: [], replaces: [], same: false };
  const old = detach ? model.graph.edges.find((e) => e.id === detach) || null : null;
  if (old && to && old.to.node === to.node && old.to.port === to.port
    && from && old.from.node === from.node && old.from.port === from.port) {
    return { allowed: true, reason: null, signalType: null, ...none, same: true };
  }
  const b = to ? nodeById(model, to.node) : null;
  const tgt = b ? registry.port(b.type, to.port, 'in') : null;
  const replaces = tgt && !tgt.multiple ? model.graph.edges.filter((e) => e !== old
    && e.to.node === to.node && e.to.port === to.port
    && !(from && e.from.node === from.node && e.from.port === from.port)).map((e) => e.id) : [];
  const remove = [...(old ? [old.id] : []), ...replaces];
  const gone = new Set(remove);
  const trial = gone.size ? { ...model, graph: { ...model.graph,
    edges: model.graph.edges.filter((e) => !gone.has(e.id)) } } : model;
  const v = probeConnection(trial, from, to, registry);
  return v.allowed ? { ...v, remove, replaces, same: false } : { ...v, ...none };
}

/**
 * Every input port of every other node with the verdict of connecting `from` { node, port } to
 * it, in model order then port order (§65 live feedback, §139 accessible list). Inputs whose
 * type differs are judged by canConnect alone (cheap); type-compatible ones by probeConnection,
 * or by probeRewire when `rewire` (a cable drag, with the picked-up edge `detach`).
 */
export function connectionTargets(model, from, registry = NODE_REGISTRY,
  { rewire = false, detach = null } = {}) {
  const a = from ? nodeById(model, from.node) : null;
  const src = a ? registry.port(a.type, from.port, 'out') : null;
  if (!src) return [];
  const out = [];
  for (const n of model.graph.nodes) {
    if (n.id === a.id) continue;
    const def = registry.get(n.type);
    if (!def) continue;
    for (const p of def.inputs) {
      const quick = canConnect(src, p, { sourceNodeId: a.id, targetNodeId: n.id });
      const to = { node: n.id, port: p.id };
      const verdict = !quick.allowed
        ? { allowed: false, reason: `Connection rejected: ${quick.reason}` }
        : rewire ? probeRewire(model, from, to, { detach, registry })
          : probeConnection(model, from, to, registry);
      out.push({
        node: n.id,
        port: p.id,
        nodeName: n.metadata.name,
        portLabel: p.label,
        type: p.type,
        role: p.role,
        allowed: verdict.allowed,
        reason: verdict.reason,
        label: `${n.metadata.name} / ${p.role === 'PARAMETER' ? `${p.label} control`
          : `${p.label} input`}`,
        replaces: verdict.replaces || [],
        same: !!verdict.same,
      });
    }
  }
  return out;
}

/** The first input of a node definition that accepts `sourcePort` by type and role. */
export function firstCompatibleInput(def, sourcePort) {
  if (!def || !sourcePort) return null;
  return def.inputs.find((p) => canConnect(sourcePort, p, {}).allowed) || null;
}

/**
 * Node types that have an input accepting the source port (create-node-from-cable, §66), in
 * library order, excluding types at their instance limit.
 */
export function connectableTypes(model, from, registry = NODE_REGISTRY) {
  const a = from ? nodeById(model, from.node) : null;
  const src = a ? registry.port(a.type, from.port, 'out') : null;
  if (!src) return [];
  const counts = new Map();
  for (const n of model.graph.nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
  return registry.list().filter((def) => {
    if (def.maxInstances != null && (counts.get(def.type) || 0) >= def.maxInstances) return false;
    return !!firstCompatibleInput(def, src);
  }).map((def) => def.type);
}

/** The output ports of a node as { id, label, type, text } (connection dialog step 1). */
export function nodeOutputs(model, nodeId, registry = NODE_REGISTRY) {
  const n = nodeById(model, nodeId);
  const def = n ? registry.get(n.type) : null;
  if (!def) return [];
  return def.outputs.map((p) => ({ id: p.id, label: p.label, type: p.type, role: p.role,
    text: `${n.metadata.name} / ${p.label} ${PORT_VISUALS[p.type].noun} output` }));
}

/** "Connecting from Oscillator 1 / Audio" (§138). */
export function connectingText(model, from, registry = NODE_REGISTRY) {
  const a = from ? nodeById(model, from.node) : null;
  const p = a ? registry.port(a.type, from.port, 'out') : null;
  return a && p ? `Connecting from ${a.metadata.name} / ${p.label}` : 'Connecting';
}

/**
 * The connections of a node for its Inspector: [{ edgeId, text, direction, route }]. A
 * connection that carries nothing says so in its text (edgeRoute; edgeStatus: Map edge id ->
 * the plan edge's { status, reason }).
 */
export function nodeConnections(model, nodeId, registry = NODE_REGISTRY, edgeStatus = null) {
  return model.graph.edges.filter((e) => e.from.node === nodeId || e.to.node === nodeId)
    .map((e) => {
      const route = edgeRoute(model, e, { registry,
        status: edgeStatus ? edgeStatus.get(e.id) : null });
      const text = describeEdge(model, e.id, { registry });
      return { edgeId: e.id, direction: e.from.node === nodeId ? 'out' : 'in',
        route: route.state, text: route.short ? `${text} (${route.short})` : text };
    });
}
