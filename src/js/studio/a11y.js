// Accessible text for the Studio graph (spec §143-§144, §249-§250; plan issue V428). Pure: plain
// model data in, strings out; no DOM, no live region, no clock. The UI puts these strings into
// aria-label attributes and one polite live region; it never builds its own sentences.
//
//   summarizeGraph(model, opts) -> text        §249 screen-reader summary, bounded (§250)
//     "6 nodes, 5 connections. Signal path: Oscillator 1 to Envelope 1 to Filter 1 to Master.
//      Modulation: LFO 1 controls Filter 1 cutoff. Analysis: Spectrum 1 observes Filter 1
//      output."
//     opts: { maxItems = 6 (entries per section), maxPaths = 3, maxPathNodes = 8, registry }
//   summarizeStudio(model, opts) -> text       the graph summary plus one timeline sentence
//   describeNode(model, nodeId, { selected, status, summary }) -> "Oscillator 1, source node,
//     selected"                                                              (§143)
//   describeEdge(model, edgeId, { selected }) -> "Connection from Oscillator 1 audio to
//     Filter 1 input"                                                        (§143)
//   describePortLabel(model, nodeId, portId, direction) -> "Filter 1 cutoff control input,
//     available"                                             (ports.js portAccessibleLabel)
//   announceAction(result) / announceUndo(result) / announceRedo(result) -> text   (§144)
//     from store.dispatch / undo / redo results: "Connected Oscillator 1 to Filter 1",
//     "Connection rejected: incompatible port type", "Deleted Filter 1", "Undo: deleted Filter 1"
//   announceLabel(label) -> past-tense sentence of a history label
//   announceSelection(model, selection) -> "Filter 1 selected" | "3 nodes selected" | ...
//
// INVARIANTS: no text contains pointer coordinates, positions or per-frame values (§143-§144):
// a move is "Moved Filter 1", never where to. Names come from node metadata as plain text; the
// UI renders them with textContent, never as HTML (§238).

import { NODE_REGISTRY } from './registry.js';
import { portAccessibleLabel } from './ports.js';
import { signalInputs } from './signal-path-projection.js';

const CATEGORY_NOUNS = Object.freeze({
  SOURCES: 'source node',
  MODULATION: 'modulation node',
  PROCESSING: 'processing node',
  ANALYSIS: 'analysis node',
  OUTPUT: 'output node',
  MEASUREMENT: 'measurement node',
});

/** Status words of a compiled node that is not simply ready (compiler.js statuses). */
const STATUS_WORDS = Object.freeze({
  degraded: 'unavailable',
  'offline-only': 'offline only',
  pending: 'starting',
});

const TAP_VERBS = Object.freeze({ recorder: 'records', capture: 'captures' });

export const SUMMARY_DEFAULTS = Object.freeze({ maxItems: 6, maxPaths: 3, maxPathNodes: 8 });

// ---------------------------------------------------------------- small helpers

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Cutoff" → "cutoff"; "Q", "A", "RMS" stay (an all-capitals word is a name). */
function lowerLabel(label) {
  const s = String(label || '');
  if (s.length > 1 && s[1] === s[1].toLowerCase() && s[0] !== s[0].toLowerCase()) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

function index(model) {
  return new Map(model.graph.nodes.map((n) => [n.id, n]));
}

const nameOf = (byId, id) => {
  const n = byId.get(id);
  return n ? n.metadata.name : String(id);
};

/** List `items` up to `max`, then "and N more". */
function bounded(items, max, sep = '; ') {
  if (items.length <= max) return items.join(sep);
  return `${items.slice(0, max).join(sep)}${sep}and ${items.length - max} more`;
}

/** Ports and types of an edge (null when the edge does not resolve). */
function edgeInfo(model, edge, registry, byId) {
  const a = byId.get(edge.from.node);
  const b = byId.get(edge.to.node);
  if (!a || !b) return null;
  const from = registry.port(a.type, edge.from.port, 'out');
  const to = registry.port(b.type, edge.to.port, 'in');
  if (!from || !to) return null;
  return { a, b, from, to };
}

// ---------------------------------------------------------------- §249 summary

function signalPaths(model, registry, byId, master, opts) {
  // AUDIO edges into SIGNAL inputs (taps observe, they are not on the path): the same reading
  // of the signal path as the Signal Path projection (signal-path-projection.js).
  const incoming = signalInputs(model, { registry });
  // Exact path counts (the graph is a validated DAG): roots count 1.
  const count = new Map();
  const countTo = (id, guard = 0) => {
    if (count.has(id)) return count.get(id);
    const ins = incoming.get(id) || [];
    const c = !ins.length || guard > byId.size ? 1
      : ins.reduce((s, x) => s + countTo(x.from, guard + 1), 0);
    count.set(id, c);
    return c;
  };
  const total = countTo(master.id);
  // The first maxPaths paths, depth first in input-port order.
  const paths = [];
  const walk = (id, suffix) => {
    if (paths.length >= opts.maxPaths) return;
    const ins = incoming.get(id) || [];
    if (!ins.length || suffix.length > byId.size) { paths.push([id, ...suffix]); return; }
    for (const x of ins) walk(x.from, [id, ...suffix]);
  };
  walk(master.id, []);
  return { paths, total, reached: new Set(count.keys()) };
}

function formatPath(ids, byId, mentioned, maxNodes) {
  // A later path stops at the first node an earlier path already named.
  let cut = ids.length;
  for (let i = 1; i < ids.length; i++) {
    if (mentioned.has(ids[i])) { cut = i + 1; break; }
  }
  const shown = ids.slice(0, cut);
  for (const id of shown) mentioned.add(id);
  const names = shown.map((id) => nameOf(byId, id));
  if (names.length <= maxNodes) return names.join(' to ');
  const head = names.slice(0, maxNodes - 2);
  const hidden = names.length - maxNodes + 1;
  const last = names[names.length - 1];
  return `${head.join(' to ')} through ${plural(hidden, 'more node')} to ${last}`;
}

/**
 * The §249 screen-reader summary: counts, the signal path(s) to the Master Output, sources that
 * are not heard, modulation, triggers, analysis taps and measurement routing — each section
 * bounded, so a large graph (§250) reads in a few sentences.
 */
export function summarizeGraph(model, opts = {}) {
  const o = { ...SUMMARY_DEFAULTS, registry: NODE_REGISTRY, ...opts };
  const registry = o.registry;
  const byId = index(model);
  const nodes = model.graph.nodes;
  const edges = model.graph.edges;
  if (!nodes.length) return 'Empty Studio: no nodes.';
  const out = [`${plural(nodes.length, 'node')}, ${plural(edges.length, 'connection')}.`];
  const master = nodes.find((n) => n.type === 'master') || null;
  let reached = new Set();
  if (!master) {
    out.push('No Master Output.');
  } else {
    const sp = signalPaths(model, registry, byId, master, o);
    reached = sp.reached;
    const realPaths = sp.paths.filter((p) => p.length > 1);
    if (!realPaths.length) {
      out.push(`Signal path: nothing reaches ${master.metadata.name}.`);
    } else {
      const mentioned = new Set();
      const texts = realPaths.map((p) => formatPath(p, byId, mentioned, o.maxPathNodes));
      const more = sp.total - realPaths.length;
      const label = sp.total === 1 ? 'Signal path' : 'Signal paths';
      out.push(`${label}: ${texts.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`);
    }
  }
  const silent = nodes.filter((n) => {
    const def = registry.get(n.type);
    return def && def.sounding && !reached.has(n.id);
  }).map((n) => n.metadata.name);
  if (silent.length) {
    out.push(`Not connected to the output: ${bounded(silent, o.maxItems, ', ')}.`);
  }
  const mod = [];
  const trig = [];
  const taps = [];
  const meas = new Map();
  for (const e of edges) {
    const info = edgeInfo(model, e, registry, byId);
    if (!info) continue;
    const { a, b, from, to } = info;
    const muted = e.props && e.props.muted ? ', muted' : '';
    if (from.type === 'CONTROL') {
      mod.push(`${a.metadata.name} controls ${b.metadata.name} ${lowerLabel(to.label)}${muted}`);
    } else if (from.type === 'TRIGGER') {
      trig.push(`${a.metadata.name} triggers ${b.metadata.name} ${lowerLabel(to.label)}${muted}`);
    } else if (from.type === 'AUDIO' && to.role === 'TAP') {
      const verb = TAP_VERBS[b.type] || 'observes';
      taps.push(`${b.metadata.name} ${verb} ${a.metadata.name} output${muted}`);
    } else if (from.type === 'ANALYSIS') {
      if (!meas.has(b.id)) meas.set(b.id, []);
      meas.get(b.id).push(`${lowerLabel(to.label)} from ${a.metadata.name}`);
    }
  }
  if (mod.length) out.push(`Modulation: ${bounded(mod, o.maxItems)}.`);
  if (trig.length) out.push(`Triggers: ${bounded(trig, o.maxItems)}.`);
  if (taps.length) out.push(`Analysis: ${bounded(taps, o.maxItems)}.`);
  if (meas.size) {
    const items = [...meas].map(([id, ins]) => `${nameOf(byId, id)} takes ${ins.join(' and ')}`);
    out.push(`Measurement: ${bounded(items, o.maxItems)}.`);
  }
  return out.join(' ');
}

/** summarizeGraph plus one sentence about the timeline (omitted when it is empty). */
export function summarizeStudio(model, opts = {}) {
  const t = model.timeline;
  const parts = [];
  if (t.tracks.length) parts.push(plural(t.tracks.length, 'track'));
  if (t.clips.length) parts.push(plural(t.clips.length, 'clip'));
  if (t.automation.length) parts.push(plural(t.automation.length, 'automation lane'));
  const graph = summarizeGraph(model, opts);
  if (!parts.length) return graph;
  const loop = t.loop.enabled ? ', looping' : '';
  return `${graph} Timeline: ${parts.join(', ')}${loop}.`;
}

// ---------------------------------------------------------------- §143 labels

/**
 * "Oscillator 1, source node, selected". opts: { selected, status (compiler.js node status),
 * summary (true: add the node card summary, e.g. "Sine · 440 Hz"), registry }.
 */
export function describeNode(model, nodeId, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const n = model.graph.nodes.find((x) => x.id === nodeId);
  if (!n) return 'Unknown node';
  const def = registry.get(n.type);
  const parts = [n.metadata.name, def ? CATEGORY_NOUNS[def.category] || 'node' : 'unknown node'];
  if (opts.summary && def) parts.push(registry.summarize(n));
  if (opts.status && STATUS_WORDS[opts.status]) parts.push(STATUS_WORDS[opts.status]);
  if (opts.selected) parts.push('selected');
  return parts.join(', ');
}

function depthText(props, to) {
  if (props.mapping === 'log') {
    return `depth ${props.depth} ${Math.abs(props.depth) === 1 ? 'octave' : 'octaves'}`;
  }
  const unit = to.param && to.param.unit ? ` ${to.param.unit}` : '';
  return `depth ${props.depth}${unit}`;
}

/**
 * "Connection from Oscillator 1 audio to Filter 1 input"; a modulation edge adds its depth and
 * polarity ("…to Filter 1 cutoff, depth 1200 Hz, bipolar"). opts: { selected, registry }.
 */
export function describeEdge(model, edgeId, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const e = model.graph.edges.find((x) => x.id === edgeId);
  if (!e) return 'Unknown connection';
  const info = edgeInfo(model, e, registry, index(model));
  if (!info) return 'Unresolved connection';
  const { a, b, from, to } = info;
  const target = to.role === 'SIGNAL' && to.type === 'AUDIO' && to.label === 'Audio'
    ? 'input' : to.role === 'TAP' ? 'input' : lowerLabel(to.label);
  const parts = [`Connection from ${a.metadata.name} ${lowerLabel(from.label)} to `
    + `${b.metadata.name} ${target}`];
  if (from.type === 'CONTROL' && e.props) parts.push(depthText(e.props, to), e.props.polarity);
  if (e.props && e.props.muted) parts.push('muted');
  if (opts.selected) parts.push('selected');
  return parts.join(', ');
}

/** The port label of ports.js with the names of the connected nodes (§143). */
export function describePortLabel(model, nodeId, portId, direction, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const byId = index(model);
  const n = byId.get(nodeId);
  const port = n ? registry.port(n.type, portId, direction) : null;
  if (!port) return 'Unknown port';
  const connections = model.graph.edges
    .filter((e) => (direction === 'out' ? e.from.node === nodeId && e.from.port === portId
      : e.to.node === nodeId && e.to.port === portId))
    .map((e) => nameOf(byId, direction === 'out' ? e.to.node : e.from.node));
  return portAccessibleLabel(port, { nodeName: n.metadata.name, connections });
}

// ---------------------------------------------------------------- §144 announcements

const PAST = Object.freeze({
  Add: 'Added', Delete: 'Deleted', Move: 'Moved', Change: 'Changed', Rename: 'Renamed',
  Connect: 'Connected', Disconnect: 'Disconnected', Edit: 'Edited', Resize: 'Resized',
  Link: 'Linked', Unlink: 'Unlinked', Automate: 'Automated', Paste: 'Pasted',
  Duplicate: 'Duplicated', Insert: 'Inserted', Replace: 'Replaced',
});

/** "Delete Filter 1" → "Deleted Filter 1"; "Edit connection A → B" → "Edited connection A to B". */
export function announceLabel(label) {
  const s = String(label || '').replace(/ → /g, ' to ').trim();
  if (!s) return '';
  const sp = s.indexOf(' ');
  const verb = sp < 0 ? s : s.slice(0, sp);
  return Object.prototype.hasOwnProperty.call(PAST, verb) ? `${PAST[verb]}${sp < 0 ? ''
    : s.slice(sp)}` : s;
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The live-region text of a store.dispatch result: past tense of its history label, or the
 * rejection reason ("Connection rejected: …" is kept; other refusals read "Not done: …").
 * View-only results (selection, pan, zoom) announce nothing: '' (§144, no per-frame chatter).
 */
export function announceAction(result) {
  if (!result) return '';
  if (!result.ok) {
    const reason = String(result.reason || 'The action was refused.');
    return /^Connection rejected/.test(reason) ? reason : `Not done: ${reason}`;
  }
  if (!result.changed || !result.label) return '';
  const text = announceLabel(result.label);
  const skipped = Array.isArray(result.skipped) && result.skipped.length
    ? ` (${plural(result.skipped.length, 'node')} skipped)` : '';
  return `${text}${skipped}`;
}

/** "Undo: deleted Filter 1" | "Nothing to undo." */
export function announceUndo(result) {
  if (!result || !result.ok) return (result && result.reason) || 'Nothing to undo.';
  return `Undo: ${lowerFirst(announceLabel(result.label))}`;
}

/** "Redo: deleted Filter 1" | "Nothing to redo." */
export function announceRedo(result) {
  if (!result || !result.ok) return (result && result.reason) || 'Nothing to redo.';
  return `Redo: ${lowerFirst(announceLabel(result.label))}`;
}

/** "Filter 1 selected", "3 nodes selected", "Selection cleared" (names, never coordinates). */
export function announceSelection(model, selection) {
  const ids = (selection && selection.nodes) || [];
  const edges = (selection && selection.edges) || [];
  const clips = (selection && selection.clips) || [];
  if (!ids.length && !edges.length && !clips.length) return 'Selection cleared';
  if (ids.length === 1 && !edges.length && !clips.length) {
    return `${nameOf(index(model), ids[0])} selected`;
  }
  const parts = [];
  if (ids.length) parts.push(plural(ids.length, 'node'));
  if (edges.length) parts.push(plural(edges.length, 'connection'));
  if (clips.length) parts.push(plural(clips.length, 'clip'));
  return `${parts.join(', ')} selected`;
}
