// Accessible text for the Studio graph (spec §143-§144, §249-§250; plan issue V428). Pure: plain
// model data in, strings out; no DOM, no live region, no clock. The UI puts these strings into
// aria-label attributes and one polite live region; it never builds its own sentences.
//
//   summarizeGraph(model, opts) -> text        §249 screen-reader summary, bounded (§250)
//     "6 nodes, 5 connections. Signal path: Oscillator 1 to Envelope 1 to Filter 1 to Master.
//      Modulation: LFO 1 controls Filter 1 cutoff. Analysis: Spectrum 1 observes Filter 1
//      output."
//     opts: { maxItems = 6 (entries per section), maxPaths = 3, maxPathNodes = 8, registry }
//     = boundedSummary(summarizeGraphModel(model), opts): the bounded sentence of the model
//   summarizeGraphModel(model, { registry }) -> { counts, master, sections: [{ id, label, note,
//     total, omitted, items }] }   the same summary whole (K168): every path with every node,
//     every unheard source, every modulation, trigger, tap and measurement edge; the ONE
//     derivation of the paths and groups, which the Inspector lists and the sentence bounds
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
//   announceSelection(model, selection) -> "Filter 1 selected" | "Tone clip on Track 1
//     selected" | "3 nodes selected" | ...     clipLabel(clip) -> "Tone", "Noise check", ...
//   article(label) -> 'a' | 'an'   by how the label's first word is said, never by its first
//     letter: "an LFO", "an RTA", "a VCA", "a MIDI", "an Oscillator", "a Unison" (K172)
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

const CLIP_WORDS = Object.freeze({ 'noise-check': 'Noise check', 'pre-roll': 'Pre-roll',
  stimulus: 'Stimulus', capture: 'Capture', tail: 'Tail', analysis: 'Analysis', gate: 'Gate',
  trigger: 'Trigger' });

/** A clip's short name: "Tone", "Sweep", "Noise check", "Gate", ... (clips carry no name). */
export function clipLabel(clip) {
  const p = clip.payload || {};
  if (clip.kind === 'pattern') {
    const b = String(p.blockType || 'pattern');
    return b[0].toUpperCase() + b.slice(1);
  }
  if (clip.kind === 'measurement') return CLIP_WORDS[p.action] || 'Measurement';
  return CLIP_WORDS[p.action || 'gate'] || 'Event';
}

export const SUMMARY_DEFAULTS = Object.freeze({ maxItems: 6, maxPaths: 3, maxPathNodes: 8 });

// ---------------------------------------------------------------- small helpers

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- articles (K172)

/**
 * What decides "a" or "an" when the first letter does not (K172): the letters whose spoken
 * names start with a vowel sound (an F, an H, an L, an M, an N, an R, an S, an X and the
 * vowels), the initialisms said as a word (a MIDI, not an M-I-D-I), the vowel-initial words
 * said with a consonant sound (a one-shot, a Unison, a user) and the consonant-initial words
 * said with a vowel sound (an hour). Exported so a test can hand `article` another table.
 */
export const ARTICLE_SOUNDS = Object.freeze({
  vowelLetterNames: 'AEFHILMNORSX',
  saidAsWords: Object.freeze(['MIDI', 'LUFS']),
  consonantSoundWords: Object.freeze(['one', 'once', 'unison', 'unipolar', 'unit', 'unity',
    'user', 'uniform', 'unique', 'utility']),
  vowelSoundWords: Object.freeze(['hour', 'honest', 'honour', 'heir']),
});

/**
 * 'a' or 'an' before a label, by how its first word is said: an initialism (upper-case
 * letters, digits allowed) by the name of its first letter ("an LFO", "an RTA", "an EQ",
 * "a VCA") unless it is said as a word ("a MIDI"); a number by its first digits ("an 8-step",
 * "an 11", "a 16-step"); any other word by its first sound ("an Oscillator", "a Filter",
 * "a Unison", "a one-shot", "an hour", "an All-pass"). Pure; a label without a word gets 'a'.
 * Every Studio text that puts an article before a node, type or option label calls this (the
 * unit test scans src/js for a second decision).
 */
export function article(label, sounds = ARTICLE_SOUNDS) {
  const m = /[A-Za-z0-9]+/.exec(String(label == null ? '' : label));
  if (!m) return 'a';
  const word = m[0];
  if (/^[0-9]/.test(word)) return /^(8|11$|18$)/.test(word) ? 'an' : 'a';
  if (/^[A-Z0-9]+$/.test(word) && !sounds.saidAsWords.includes(word)) {
    return sounds.vowelLetterNames.includes(word[0]) ? 'an' : 'a';
  }
  const lower = word.toLowerCase();
  if (sounds.consonantSoundWords.includes(lower)) return 'a';
  if (sounds.vowelSoundWords.includes(lower)) return 'an';
  return /^[aeiou]/.test(lower) ? 'an' : 'a';
}

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

/** Most signal paths the summary model lists: a guard against a combinatorial graph (mixers
 * fed by mixers on every input multiply their paths); a patch a person builds stays far below
 * it. Past it the section says how many it did not list (`omitted`), never silently. */
export const SUMMARY_PATH_LIMIT = 1000;

/** The groups of the summary model, in reading order, with their headings. */
export const SUMMARY_SECTIONS = Object.freeze([
  Object.freeze({ id: 'signal', label: 'Signal paths' }),
  Object.freeze({ id: 'unconnected', label: 'Not connected to the output' }),
  Object.freeze({ id: 'modulation', label: 'Modulation' }),
  Object.freeze({ id: 'triggers', label: 'Triggers' }),
  Object.freeze({ id: 'analysis', label: 'Analysis' }),
  Object.freeze({ id: 'measurement', label: 'Measurement' }),
]);

function signalPaths(model, registry, byId, master, limit) {
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
  // Every path (up to `limit`), depth first in input-port order, each from its source to the
  // master: { ids, edges } (the edges in the same order, one fewer).
  const paths = [];
  const ids = [];
  const edges = [];
  const walk = (id) => {
    if (paths.length >= limit) return;
    ids.push(id);
    const ins = incoming.get(id) || [];
    if (!ins.length || ids.length > byId.size + 1) {
      paths.push({ ids: ids.slice().reverse(), edges: edges.slice().reverse() });
    } else {
      for (const x of ins) {
        edges.push(x.edge);
        walk(x.from);
        edges.pop();
      }
    }
    ids.pop();
  };
  walk(master.id);
  return { paths, total, reached: new Set(count.keys()) };
}

const ref = (n) => ({ id: n.id, name: n.metadata.name });
const partsText = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.name)).join('');

function item(key, parts, edges, muted, extra = {}) {
  const nodes = parts.filter((p) => typeof p !== 'string');
  return { key, nodes, edges, muted, parts, text: partsText(parts), ...extra };
}

/**
 * The §249 summary as structured data, the ONE derivation of the graph's summary: the
 * Inspector renders it whole (K168) and summarizeGraph reads it as a bounded sentence (§250).
 * Nothing is cut here: every signal path with every node (up to SUMMARY_PATH_LIMIT paths),
 * every sounding node no path reaches, every CONTROL, TRIGGER, TAP and ANALYSIS edge once.
 *
 *   summarizeGraphModel(model, { registry, pathLimit }) -> {
 *     counts: { nodes, edges }, master: { id, name } | null,
 *     sections: [{ id, label, note, total, omitted, items }]    ids of SUMMARY_SECTIONS, in order
 *   }
 *   item: { key, nodes: [{ id, name }] (in reading order), edges: [edge id], muted, parts:
 *     [string | { id, name }] (the item's words with its nodes in place), text, port? }
 *   signal: one item per path, its nodes from the source to the Master Output, muted when an
 *     edge on it is; `note` says why there is none ("No Master Output.", "Nothing reaches
 *     Master."); `total` is the exact path count, `omitted` how many past pathLimit are not
 *     listed. unconnected: one item per sounding node no path reaches, with `port`, the output
 *     a connection would start from. measurement: one item per receiving node.
 */
export function summarizeGraphModel(model, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const limit = Math.max(1, opts.pathLimit || SUMMARY_PATH_LIMIT);
  const byId = index(model);
  const nodes = model.graph.nodes;
  const edges = model.graph.edges;
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const isMuted = (e) => !!(e && e.props && e.props.muted);
  const lists = Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s.id, []]));
  const master = nodes.find((n) => n.type === 'master') || null;
  let signalNote = '';
  let total = 0;
  let reached = new Set();
  if (!master) {
    signalNote = nodes.length ? 'No Master Output.' : '';
  } else {
    const sp = signalPaths(model, registry, byId, master, limit);
    reached = sp.reached;
    for (const p of sp.paths) {
      if (p.ids.length < 2) continue;
      const parts = [];
      p.ids.forEach((id, i) => {
        if (i) parts.push(' to ');
        parts.push(ref(byId.get(id)));
      });
      lists.signal.push(item(`path:${p.edges.join(',')}`, parts, p.edges,
        p.edges.some((id) => isMuted(edgeById.get(id)))));
    }
    if (lists.signal.length) total = sp.total;
    else signalNote = `Nothing reaches ${master.metadata.name}.`;
  }
  for (const n of nodes) {
    const def = registry.get(n.type);
    if (!def || !def.sounding || reached.has(n.id)) continue;
    const out = def.outputs.find((p) => p.type === 'AUDIO') || def.outputs[0] || null;
    lists.unconnected.push(item(`node:${n.id}`, [ref(n)], [], false,
      { port: out ? out.id : null }));
  }
  const meas = new Map();
  for (const e of edges) {
    const info = edgeInfo(model, e, registry, byId);
    if (!info) continue;
    const { a, b, from, to } = info;
    const muted = isMuted(e);
    if (from.type === 'CONTROL') {
      lists.modulation.push(item(`edge:${e.id}`, [ref(a), ' controls ', ref(b),
        ` ${lowerLabel(to.label)}`], [e.id], muted));
    } else if (from.type === 'TRIGGER') {
      lists.triggers.push(item(`edge:${e.id}`, [ref(a), ' triggers ', ref(b),
        ` ${lowerLabel(to.label)}`], [e.id], muted));
    } else if (from.type === 'AUDIO' && to.role === 'TAP') {
      lists.analysis.push(item(`edge:${e.id}`, [ref(b), ` ${TAP_VERBS[b.type] || 'observes'} `,
        ref(a), ' output'], [e.id], muted));
    } else if (from.type === 'ANALYSIS') {
      if (!meas.has(b.id)) meas.set(b.id, { b, ins: [] });
      meas.get(b.id).ins.push({ e, a, to });
    }
  }
  for (const { b, ins } of meas.values()) {
    const parts = [ref(b), ' takes '];
    ins.forEach((x, i) => parts.push(...(i ? [' and '] : []), `${lowerLabel(x.to.label)} from `,
      ref(x.a)));
    lists.measurement.push(item(`node:${b.id}`, parts, ins.map((x) => x.e.id),
      ins.some((x) => isMuted(x.e))));
  }
  const sections = SUMMARY_SECTIONS.map((s) => {
    const items = lists[s.id];
    const signal = s.id === 'signal';
    return { id: s.id, label: signal && total === 1 ? 'Signal path' : s.label,
      note: signal ? signalNote : '', total: signal ? total : items.length,
      omitted: signal ? Math.max(0, total - items.length) : 0, items };
  });
  return { counts: { nodes: nodes.length, edges: edges.length },
    master: master ? ref(master) : null, sections };
}

function formatPath(pathNodes, mentioned, maxNodes) {
  // A later path stops at the first node an earlier path already named.
  let cut = pathNodes.length;
  for (let i = 1; i < pathNodes.length; i++) {
    if (mentioned.has(pathNodes[i].id)) { cut = i + 1; break; }
  }
  const shown = pathNodes.slice(0, cut);
  for (const n of shown) mentioned.add(n.id);
  const names = shown.map((n) => n.name);
  if (names.length <= maxNodes) return names.join(' to ');
  const head = names.slice(0, maxNodes - 2);
  const hidden = names.length - maxNodes + 1;
  const last = names[names.length - 1];
  return `${head.join(' to ')} through ${plural(hidden, 'more node')} to ${last}`;
}

/**
 * The bounded sentence of a summarizeGraphModel result (§249-§250): counts, the first maxPaths
 * signal paths (a later one stops at the first node an earlier one named; a long one elided in
 * the middle), then each other group, maxItems entries and "and N more". opts as
 * summarizeGraph's.
 */
export function boundedSummary(summary, opts = {}) {
  const o = { ...SUMMARY_DEFAULTS, ...opts };
  const { counts } = summary;
  if (!counts.nodes) return 'Empty Studio: no nodes.';
  const sec = Object.fromEntries(summary.sections.map((s) => [s.id, s]));
  const out = [`${plural(counts.nodes, 'node')}, ${plural(counts.edges, 'connection')}.`];
  const signal = sec.signal;
  if (!summary.master) {
    out.push('No Master Output.');
  } else if (!signal.items.length) {
    out.push(`Signal path: nothing reaches ${summary.master.name}.`);
  } else {
    const mentioned = new Set();
    const shown = signal.items.slice(0, o.maxPaths);
    const texts = shown.map((it) => formatPath(it.nodes, mentioned, o.maxPathNodes));
    const more = signal.total - shown.length;
    const label = signal.total === 1 ? 'Signal path' : 'Signal paths';
    out.push(`${label}: ${texts.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`);
  }
  const silent = sec.unconnected.items.map((it) => it.text);
  if (silent.length) {
    out.push(`Not connected to the output: ${bounded(silent, o.maxItems, ', ')}.`);
  }
  const said = (it) => `${it.text}${it.muted ? ', muted' : ''}`;
  if (sec.modulation.items.length) {
    out.push(`Modulation: ${bounded(sec.modulation.items.map(said), o.maxItems)}.`);
  }
  if (sec.triggers.items.length) {
    out.push(`Triggers: ${bounded(sec.triggers.items.map(said), o.maxItems)}.`);
  }
  if (sec.analysis.items.length) {
    out.push(`Analysis: ${bounded(sec.analysis.items.map(said), o.maxItems)}.`);
  }
  if (sec.measurement.items.length) {
    const items = sec.measurement.items.map((it) => it.text);
    out.push(`Measurement: ${bounded(items, o.maxItems)}.`);
  }
  return out.join(' ');
}

/**
 * The §249 screen-reader summary: counts, the signal path(s) to the Master Output, sources that
 * are not heard, modulation, triggers, analysis taps and measurement routing — each section
 * bounded, so a large graph (§250) reads in a few sentences. The bounded projection of
 * summarizeGraphModel (one derivation, two renderings).
 */
export function summarizeGraph(model, opts = {}) {
  const o = { ...SUMMARY_DEFAULTS, registry: NODE_REGISTRY, ...opts };
  const summary = summarizeGraphModel(model, { registry: o.registry,
    pathLimit: o.maxPaths });
  return boundedSummary(summary, o);
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
 * summary (true: add the node card summary, e.g. "Sine · 440 Hz"), connections (true: add the
 * edge counts, "2 input connections, 1 output connection": the ports themselves are
 * aria-hidden, their names are in the Inspector Connections list and the Connect dialog),
 * registry }.
 */
export function describeNode(model, nodeId, opts = {}) {
  const registry = opts.registry || NODE_REGISTRY;
  const n = model.graph.nodes.find((x) => x.id === nodeId);
  if (!n) return 'Unknown node';
  const def = registry.get(n.type);
  const parts = [n.metadata.name, def ? CATEGORY_NOUNS[def.category] || 'node' : 'unknown node'];
  if (opts.summary && def) parts.push(registry.summarize(n));
  if (opts.status && STATUS_WORDS[opts.status]) parts.push(STATUS_WORDS[opts.status]);
  if (opts.connections && def) {
    const edges = model.graph.edges;
    if (def.inputs.length) {
      parts.push(plural(edges.filter((e) => e.to.node === nodeId).length, 'input connection'));
    }
    if (def.outputs.length) {
      parts.push(plural(edges.filter((e) => e.from.node === nodeId).length, 'output connection'));
    }
  }
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

/**
 * "Filter 1 selected", "Sweep clip on Track 1 selected", "3 nodes selected", "Selection
 * cleared" (names, never coordinates).
 */
export function announceSelection(model, selection) {
  const ids = (selection && selection.nodes) || [];
  const edges = (selection && selection.edges) || [];
  const clips = (selection && selection.clips) || [];
  if (!ids.length && !edges.length && !clips.length) return 'Selection cleared';
  if (ids.length === 1 && !edges.length && !clips.length) {
    return `${nameOf(index(model), ids[0])} selected`;
  }
  const clip = clips.length === 1 && !ids.length && !edges.length
    ? model.timeline.clips.find((c) => c.id === clips[0]) : null;
  if (clip) {
    const track = model.timeline.tracks.find((t) => t.id === clip.trackId);
    return `${clipLabel(clip)} clip${track ? ` on ${track.name}` : ''} selected`;
  }
  const parts = [];
  if (ids.length) parts.push(plural(ids.length, 'node'));
  if (edges.length) parts.push(plural(edges.length, 'connection'));
  if (clips.length) parts.push(plural(clips.length, 'clip'));
  return `${parts.join(', ')} selected`;
}
