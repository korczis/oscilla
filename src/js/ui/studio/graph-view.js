// Studio graph view descriptors (spec §31-§37, §65-§77, §121, §138-§139, §143, §170-§171). Pure:
// the StudioModel (and an optional compiled plan) in, plain view records out. The DOM renderer
// (graph-editor.js), the compact widget and the connection dialog only draw these records; they
// never decide compatibility, labels or status themselves.
//
//   nodeCard(model, node, opts) -> { id, type, name, title, typeLabel, category, categoryLabel,
//     summary, inputs: [port], outputs: [port], flags, status, reason, ariaLabel }
//   edgeView(model, edge, opts) -> { id, type, cable, muted, from, to, ariaLabel, title }
//   nodeWarnings(model, registry) -> Map nodeId -> [message]      (validator warnings, §77)
//   probeConnection(model, from, to, registry) -> { allowed, reason, signalType }
//   connectionTargets(model, from, registry) -> [{ node, port, nodeName, portLabel, type,
//     allowed, reason, label }]                     every input of every other node (§65, §139)
//   connectableTypes(model, from, registry) -> [type]   node types with an input that accepts
//     the source port type and role (create-node-from-cable, §66)
//   firstCompatibleInput(def, sourcePort) -> port | null
//   compiledStatus(plan) -> Map nodeId -> { status, reason }
//
// INVARIANT: probeConnection asks the same validator the store uses (validateStudioModel on the
// model plus the candidate edge), so the live feedback of a cable drag and the store's verdict
// on EDGE_ADD cannot disagree; the store still has the last word (§33, §46).

import { NODE_REGISTRY } from '../../studio/registry.js';
import { PORT_VISUALS, canConnect, validateEdgeProps } from '../../studio/ports.js';
import { validateStudioModel } from '../../studio/validate.js';
import { describeEdge, describeNode, describePortLabel } from '../../studio/a11y.js';

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
});

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

/** Node id -> { status, reason } of a compiled plan (compiler.js compileStudio). */
export function compiledStatus(plan) {
  const out = new Map();
  if (!plan || !plan.nodes) return out;
  for (const [id, n] of plan.nodes) out.set(id, { status: n.status, reason: n.reason || null });
  return out;
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
      summary: true, registry }),
  };
}

/** The view of one edge: its signal type (from the source port), cable style and labels. */
export function edgeView(model, edge, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const a = nodeById(model, edge.from.node);
  const b = nodeById(model, edge.to.node);
  const src = a ? registry.port(a.type, edge.from.port, 'out') : null;
  const tgt = b ? registry.port(b.type, edge.to.port, 'in') : null;
  const type = src ? src.type : 'AUDIO';
  const label = describeEdge(model, edge.id, { selected: !!opts.selected, registry });
  return {
    id: edge.id,
    type,
    cable: PORT_VISUALS[type] ? PORT_VISUALS[type].cable : 'solid',
    muted: !!(edge.props && edge.props.muted),
    selected: !!opts.selected,
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
 * Every input port of every other node with the verdict of connecting `from` { node, port } to
 * it, in model order then port order (§65 live feedback, §139 accessible list). Inputs whose
 * type differs are judged by canConnect alone (cheap); type-compatible ones by probeConnection.
 */
export function connectionTargets(model, from, registry = NODE_REGISTRY) {
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
      const verdict = quick.allowed ? probeConnection(model, from, { node: n.id, port: p.id },
        registry) : { allowed: false, reason: `Connection rejected: ${quick.reason}` };
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

/** The connections of a node for its Inspector: [{ edgeId, text, direction }]. */
export function nodeConnections(model, nodeId, registry = NODE_REGISTRY) {
  return model.graph.edges.filter((e) => e.from.node === nodeId || e.to.node === nodeId)
    .map((e) => ({ edgeId: e.id, direction: e.from.node === nodeId ? 'out' : 'in',
      text: describeEdge(model, e.id, { registry }) }));
}
