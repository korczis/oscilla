// Studio validation (spec §37-§40, §115, §159, §187-§188, §238, §240-§241). Pure; never evals,
// never throws on bad input, no DOM, no globals.
//
//   validateStudioModel(model, { registry }) ->
//     { ok, errors: [Diagnostic], warnings: [Diagnostic], diagnostics, order: [nodeId] | null }
//   analyzeCycles(model, { registry }) -> { order, cycles: [{ kind, nodes, edges }] }
//   validateStudioImport(input, limits?, { registry }) ->
//     { ok: true, model, warnings } | { ok: false, errors, warnings }
// Diagnostic = { code, severity: 'error'|'warning', message, path, nodeId?, edgeId?, detail? }.
//
// Graph rules (errors unless noted):
//   unknown-node-type, missing-node, unknown-port, wrong-direction, self-connection,
//   type-mismatch, role-mismatch (ports.js canConnect, with its human reason);
//   duplicate-edge (same output to the same input twice);
//   multiple-connections: an input with multiple: false already has an edge. Single-input
//     ports: every AUDIO input (Mixer has one port per channel; it is the only summing node,
//     §188), TRIGGER and ANALYSIS inputs. Multi-input ports: CONTROL parameter inputs, where
//     modulations add (each with its edge depth);
//   invalid-edge-props, invalid-param, unknown-param, invalid-position, invalid-name,
//   duplicate-id, invalid-id;
//   too-many-instances: more than maxInstances of a type (one Master Output, §187);
//   audio-feedback: a directed cycle of AUDIO edges — the spec's message, §39;
//   control-cycle: any other directed cycle through nodes that uses a CONTROL or TRIGGER edge
//     (a modulation path that leads back to its own source, §40); analysis-cycle likewise for
//     ANALYSIS edges. Cycles are found on the NODE graph (Tarjan SCC) before anything reaches
//     Web Audio (§38, §241), and a valid graph always has a node topological order (Kahn,
//     ties broken by model order, so the order is deterministic);
//   live-input-to-output: a path of AUDIO edges from a microphone to Master Output (acoustic
//     feedback; the microphone is analysis only).
// Warnings (the graph stays valid and editable):
//   unreachable-output: a sounding source (Oscillator, Noise, Sweep, Sequence) has no AUDIO path
//     to Master Output — it will not be heard; no-master-output: sounding sources but no Master
//     Output; unconnected-input: a required input (analyzer tap, Transfer Analyzer reference /
//     observed, ...) has no edge.
// Timeline rules: track kinds, clip kinds per track, clip times (start >= 0, duration >=
// MIN_CLIP_S, end <= TIMELINE_MAX_S), clip targets (node exists and accepts the clip kind),
// pattern payloads (sequencer block types and parameter rules, duration within the block
// bounds), measurement actions, automation targets (parameter exists and is automatable),
// points (sorted, in range, exponential ramps only between positive values and only on a
// parameter whose domain is strictly positive, §98), markers, loop (an active loop is at least
// MIN_CLIP_S long), transport and view values. Tempo-linked clips (`musical`, §90-§91):
// musical-measurement (a measurement clip is never musical), invalid-musical (beats out of range,
// or seconds that disagree with the beats at the transport tempo by more than
// MUSICAL_TOLERANCE_S).

import { utf8Length, scanUntrusted } from '../experiments/validate.js';
import { ID_PATTERN, createChecker } from '../experiments/schema.js';
import { BLOCK_SCHEMA, normalizeBlock } from '../sequencer/model.js';
import { SAMPLE_RATE_LIMITS } from '../measurement/stimulus.js';
import { canConnect, describePort, validateEdgeProps } from './ports.js';
import { NODE_REGISTRY, validateParamValue } from './registry.js';
import {
  AUTOMATION_CURVES, EVENT_ACTIONS, MARKER_KINDS, MEASUREMENT_ACTIONS, MIN_CLIP_S,
  MUSICAL_TOLERANCE_S, NAME_MAX_CHARS,
  NOTES_MAX_CHARS, POSITION_LIMIT, STUDIO_KIND, STUDIO_SCHEMA_VERSION, TEMPO_RANGE,
  TIMELINE_MAX_S, TIME_MODES, TIME_SIGNATURE_DENOMINATORS, TITLE_MAX_CHARS, TRACK_CLIP_KINDS,
  TRACK_KINDS, CLIP_KINDS, normalizeStudio,
} from './schema.js';

export const AUDIO_FEEDBACK_MESSAGE = 'Connection rejected: This would create an unsupported '
  + 'instantaneous audio feedback loop.';
export const CONTROL_CYCLE_MESSAGE = 'Connection rejected: This modulation path would control '
  + 'its own source.';
export const ANALYSIS_CYCLE_MESSAGE = 'Connection rejected: This analysis path would feed its own '
  + 'input.';
export const LIVE_INPUT_MESSAGE = 'Microphone input cannot reach Master Output: it would feed '
  + 'back acoustically, and the microphone is for analysis only.';

/**
 * Untrusted-import limits (§115, §159). Sized from the §145 engineering target (~100 nodes, 200
 * edges, hundreds of clips) with headroom; a Majordomus decision candidate.
 */
export const STUDIO_IMPORT_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  depth: 12,
  nodes: 512,
  edges: 2048,
  tracks: 64,
  clips: 2048,
  automationLanes: 512,
  automationPoints: 20000,
  pointsPerLane: 4096,
  markers: 512,
  stringChars: 256,
  notesChars: NOTES_MAX_CHARS,
  maxErrors: 50,
});

const CTRL = /[\u0000-\u001f\u007f]/;

// ---------------------------------------------------------------- semantic validation

function makeSink() {
  const diagnostics = [];
  const add = (severity, code, message, extra = {}) => {
    diagnostics.push({ code, severity, message, path: '', ...extra });
  };
  return {
    diagnostics,
    error: (code, message, extra) => add('error', code, message, extra),
    warn: (code, message, extra) => add('warning', code, message, extra),
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const nameOf = (n) => (n && n.metadata && n.metadata.name) || (n && n.id) || '?';

/** Resolve an edge to its ports; reports the problem and returns null when not connectable. */
function resolveEdge(e, nodeById, registry, sink, path) {
  const from = nodeById.get(e.from && e.from.node);
  const to = nodeById.get(e.to && e.to.node);
  const at = { path, edgeId: e.id };
  if (!from || !to) {
    const missing = !from ? e.from && e.from.node : e.to && e.to.node;
    sink.error('missing-node', `The connection refers to a node that does not exist (${missing}).`,
      at);
    return null;
  }
  if (!registry.has(from.type) || !registry.has(to.type)) return null;
  const src = registry.port(from.type, e.from.port, 'out');
  const tgt = registry.port(to.type, e.to.port, 'in');
  if (!src || !tgt) {
    const side = !src ? { node: from, port: e.from.port, dir: 'in', label: 'output' }
      : { node: to, port: e.to.port, dir: 'out', label: 'input' };
    if (registry.port(side.node.type, side.port, side.dir)) {
      sink.error('wrong-direction', `${nameOf(side.node)}.${side.port} is not an ${side.label}.`,
        at);
    } else {
      sink.error('unknown-port', `${nameOf(side.node)} has no ${side.label} "${side.port}".`, at);
    }
    return null;
  }
  const verdict = canConnect(src, tgt, { sourceNodeId: from.id, targetNodeId: to.id });
  if (!verdict.allowed) {
    sink.error(verdict.code, verdict.reason, at);
    return null;
  }
  const paramDef = tgt.param ? registry.param(to.type, tgt.param.key) : null;
  return { edge: e, type: verdict.signalType, src, tgt, paramDef, from, to };
}

function checkId(id, path, sink, seen) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    sink.error('invalid-id', `Invalid id ${JSON.stringify(id)}.`, { path });
    return;
  }
  if (seen.has(id)) sink.error('duplicate-id', `The id "${id}" is used more than once.`, { path });
  seen.add(id);
}

function checkName(v, path, sink, max = NAME_MAX_CHARS) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || CTRL.test(v)) {
    sink.error('invalid-name', `A name must be 1-${max} printable characters.`, { path });
  }
}

/** Tarjan strongly connected components of adjacency lists over indices 0..n-1. */
function stronglyConnected(n, adj) {
  let index = 0;
  const idx = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const stack = [];
  const out = [];
  const visit = (v) => {
    idx[v] = low[v] = index++;
    stack.push(v);
    onStack[v] = true;
    for (const { to } of adj[v]) {
      if (idx[to] === -1) {
        visit(to);
        low[v] = Math.min(low[v], low[to]);
      } else if (onStack[to]) low[v] = Math.min(low[v], idx[to]);
    }
    if (low[v] === idx[v]) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      out.push(comp.sort((a, b) => a - b));
    }
  };
  for (let v = 0; v < n; v++) if (idx[v] === -1) visit(v);
  return out;
}

/** Shortest path of edges from `start` to `goal` inside `members` (BFS), or null. */
function pathWithin(start, goal, adj, members) {
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const v = queue.shift();
    if (v === goal && prev.get(v) !== null) break;
    for (const step of adj[v]) {
      if (!members.has(step.to) || prev.has(step.to)) continue;
      prev.set(step.to, { from: v, edge: step.edge });
      queue.push(step.to);
    }
  }
  if (!prev.has(goal)) return null;
  const edges = [];
  for (let v = goal; prev.get(v); v = prev.get(v).from) edges.unshift(prev.get(v).edge);
  return edges;
}

/**
 * Cycle analysis over resolved edges. Returns { order, cycles } where order is the node
 * topological order (null if any cycle) and each cycle is { kind: 'audio-feedback' |
 * 'control-cycle' | 'analysis-cycle', nodes: [id, ..., first id again], edges: [edgeId] }.
 */
function cyclesOf(nodes, resolved) {
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const build = (filter) => {
    const adj = nodes.map(() => []);
    for (const r of resolved) {
      if (!filter(r)) continue;
      adj[indexOf.get(r.from.id)].push({ to: indexOf.get(r.to.id), edge: r });
    }
    return adj;
  };
  const cycles = [];
  const describe = (kind, edges) => ({
    kind,
    nodes: [edges[0].from.id, ...edges.map((r) => r.to.id)],
    names: [nameOf(edges[0].from), ...edges.map((r) => nameOf(r.to))],
    edges: edges.map((r) => r.edge.id),
  });
  const audioAdj = build((r) => r.type === 'AUDIO');
  for (const comp of stronglyConnected(nodes.length, audioAdj)) {
    if (comp.length < 2) continue;
    const members = new Set(comp);
    const first = audioAdj[comp[0]].find((s) => members.has(s.to));
    const back = pathWithin(first.to, comp[0], audioAdj, members);
    cycles.push(describe('audio-feedback', [first.edge, ...back]));
  }
  const allAdj = build(() => true);
  for (const comp of stronglyConnected(nodes.length, allAdj)) {
    if (comp.length < 2) continue;
    const members = new Set(comp);
    const inner = resolved.filter((r) => r.type !== 'AUDIO'
      && members.has(indexOf.get(r.from.id)) && members.has(indexOf.get(r.to.id)));
    if (!inner.length) continue;
    const pivot = inner.find((r) => r.type !== 'ANALYSIS') || inner[0];
    const back = pathWithin(indexOf.get(pivot.to.id), indexOf.get(pivot.from.id), allAdj, members);
    const kind = inner.some((r) => r.type !== 'ANALYSIS') ? 'control-cycle' : 'analysis-cycle';
    cycles.push(describe(kind, [pivot, ...(back || [])]));
  }
  let order = null;
  if (!cycles.length) {
    const indeg = nodes.map(() => 0);
    for (const list of allAdj) for (const s of list) indeg[s.to]++;
    const ready = [];
    for (let i = 0; i < nodes.length; i++) if (!indeg[i]) ready.push(i);
    order = [];
    while (ready.length) {
      ready.sort((a, b) => a - b);
      const v = ready.shift();
      order.push(nodes[v].id);
      for (const s of allAdj[v]) if (--indeg[s.to] === 0) ready.push(s.to);
    }
  }
  return { order, cycles };
}

/** Nodes reachable from `startIds` along AUDIO edges. */
function audioReach(startIds, resolved) {
  const next = new Map();
  for (const r of resolved) {
    if (r.type !== 'AUDIO') continue;
    if (!next.has(r.from.id)) next.set(r.from.id, []);
    next.get(r.from.id).push(r.to.id);
  }
  const seen = new Set(startIds);
  const queue = [...startIds];
  while (queue.length) {
    for (const to of next.get(queue.shift()) || []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

function validateGraph(model, registry, sink, ids) {
  const nodes = model.graph.nodes;
  const nodeById = new Map();
  const counts = new Map();
  nodes.forEach((n, i) => {
    const path = `graph.nodes[${i}]`;
    checkId(n.id, `${path}.id`, sink, ids);
    if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    const def = registry.get(n.type);
    if (!def) {
      sink.error('unknown-node-type', `Unknown node type "${String(n.type)}".`,
        { path: `${path}.type`, nodeId: n.id });
      return;
    }
    counts.set(n.type, (counts.get(n.type) || 0) + 1);
    if (!n.position || !finite(n.position.x) || !finite(n.position.y)
      || Math.abs(n.position.x) > POSITION_LIMIT || Math.abs(n.position.y) > POSITION_LIMIT) {
      sink.error('invalid-position', `${nameOf(n)} has an invalid position.`,
        { path: `${path}.position`, nodeId: n.id });
    }
    checkName(n.metadata && n.metadata.name, `${path}.metadata.name`, sink);
    const params = n.params && typeof n.params === 'object' ? n.params : {};
    for (const k of Object.keys(params)) {
      const p = def.params.find((x) => x.key === k);
      if (!p) {
        sink.error('unknown-param', `${def.displayName} has no parameter "${k}".`,
          { path: `${path}.params.${k}`, nodeId: n.id });
        continue;
      }
      const why = validateParamValue(p, params[k]);
      if (why) {
        sink.error('invalid-param', `${nameOf(n)} ${p.label}: ${why}.`,
          { path: `${path}.params.${k}`, nodeId: n.id });
      }
    }
    for (const p of def.params) {
      if (!Object.prototype.hasOwnProperty.call(params, p.key)) {
        sink.error('invalid-param', `${nameOf(n)} ${p.label} is missing.`,
          { path: `${path}.params.${p.key}`, nodeId: n.id });
      }
    }
  });
  for (const [type, count] of counts) {
    const def = registry.get(type);
    if (def.maxInstances != null && count > def.maxInstances) {
      sink.error('too-many-instances', def.maxInstances === 1
        ? `A Studio has exactly one ${def.displayName}; remove the extra one.`
        : `At most ${def.maxInstances} ${def.displayName} nodes are allowed.`,
      { path: 'graph.nodes' });
    }
  }

  const resolved = [];
  const pairs = new Set();
  const inputUse = new Map();
  model.graph.edges.forEach((e, i) => {
    const path = `graph.edges[${i}]`;
    checkId(e.id, `${path}.id`, sink, ids);
    const r = resolveEdge(e, nodeById, registry, sink, path);
    if (!r) return;
    const key = `${e.from.node}\u0000${e.from.port}\u0000${e.to.node}\u0000${e.to.port}`;
    if (pairs.has(key)) {
      sink.error('duplicate-edge', `${nameOf(r.from)} is already connected to ${nameOf(r.to)} `
        + 'there.', { path, edgeId: e.id });
      return;
    }
    pairs.add(key);
    const inKey = `${e.to.node}\u0000${e.to.port}`;
    if (!r.tgt.multiple && inputUse.has(inKey)) {
      sink.error('multiple-connections', `${nameOf(r.to)} ${describePort(r.tgt).toLowerCase()} `
        + `accepts one connection${r.type === 'AUDIO' ? '; use a Mixer to combine signals' : ''}.`,
      { path, edgeId: e.id });
      return;
    }
    inputUse.set(inKey, e.id);
    const props = validateEdgeProps(e.props, r.type, r.tgt, r.paramDef);
    if (!props.ok) {
      sink.error('invalid-edge-props', `Connection ${nameOf(r.from)} → ${nameOf(r.to)}: `
        + props.errors.map((x) => `${x.field} ${x.text}`).join('; ') + '.', { path, edgeId: e.id });
    }
    resolved.push(r);
  });

  const { order, cycles } = cyclesOf(nodes.filter((n) => registry.has(n.type)), resolved);
  for (const c of cycles) {
    const message = c.kind === 'audio-feedback' ? AUDIO_FEEDBACK_MESSAGE
      : c.kind === 'control-cycle' ? CONTROL_CYCLE_MESSAGE : ANALYSIS_CYCLE_MESSAGE;
    sink.error(c.kind, message, { path: 'graph.edges', detail: c.names.join(' → '),
      cycle: c.nodes, edgeIds: c.edges });
  }

  const live = [];
  for (const r of resolved) if (r.src.liveInput) live.push(r);
  const masters = nodes.filter((n) => n.type === 'master').map((n) => n.id);
  for (const r of live) {
    const reach = audioReach([r.to.id], resolved);
    if (masters.some((m) => reach.has(m))) {
      sink.error('live-input-to-output', LIVE_INPUT_MESSAGE, { path: 'graph.edges',
        nodeId: r.from.id, edgeId: r.edge.id });
    }
  }

  const sounding = nodes.filter((n) => registry.has(n.type) && registry.get(n.type).sounding);
  if (sounding.length && !masters.length) {
    sink.warn('no-master-output', 'There is no Master Output, so nothing will be heard.',
      { path: 'graph.nodes' });
  } else {
    for (const n of sounding) {
      const reach = audioReach([n.id], resolved);
      if (!masters.some((m) => reach.has(m))) {
        sink.warn('unreachable-output', `${nameOf(n)} does not reach Master Output; it will not `
          + 'be heard.', { nodeId: n.id });
      }
    }
  }
  for (const n of nodes) {
    const def = registry.get(n.type);
    if (!def) continue;
    for (const port of def.inputs) {
      if (port.required && !inputUse.has(`${n.id}\u0000${port.id}`)) {
        sink.warn('unconnected-input', `${nameOf(n)} ${describePort(port).toLowerCase()} is not `
          + 'connected.', { nodeId: n.id, port: port.id });
      }
    }
  }
  return { order, nodeById };
}

function checkTime(v, path, sink, what) {
  if (!finite(v) || v < 0 || v > TIMELINE_MAX_S) {
    sink.error('invalid-time', `${what} must be between 0 and ${TIMELINE_MAX_S} s.`, { path });
    return false;
  }
  return true;
}

/** Pattern clip payload: { blockType, params } under the sequencer's block rules. */
function checkPattern(clip, path, sink) {
  const p = clip.payload || {};
  const schema = BLOCK_SCHEMA[p.blockType];
  if (!schema) {
    sink.error('invalid-clip', `Unknown pattern block type "${String(p.blockType)}".`,
      { path: `${path}.payload.blockType` });
    return;
  }
  const extra = Object.keys(p).filter((k) => k !== 'blockType' && k !== 'params');
  const params = p.params && typeof p.params === 'object' ? p.params : {};
  const unknown = Object.keys(params).filter((k) => !schema.params.some((d) => d.key === k));
  if (extra.length || unknown.length) {
    sink.error('invalid-clip', `Unknown pattern field ${[...extra, ...unknown][0]}.`,
      { path: `${path}.payload` });
  }
  const { issues } = normalizeBlock({ type: p.blockType, params, durationMs: clip.duration * 1000 },
    { sampleRate: SAMPLE_RATE_LIMITS[1] });
  if (issues.length) {
    sink.error('invalid-clip', issues[0].replace(/^Block 1: /, 'Pattern clip: '),
      { path: `${path}.payload` });
  }
}

/**
 * A tempo-linked clip (§90-§91): beats finite and in range, never on a measurement clip (musical
 * time never enters a measurement experiment), and its seconds equal its beats at the tempo.
 */
function checkMusical(clip, transport, path, sink) {
  const mu = clip.musical;
  const at = { path: `${path}.musical` };
  if (clip.kind === 'measurement') {
    sink.error('musical-measurement', 'A measurement clip is always placed in seconds; musical '
      + 'time never enters a measurement experiment.', at);
    return;
  }
  if (!mu || !finite(mu.startBeats) || mu.startBeats < 0 || !finite(mu.durationBeats)
    || !(mu.durationBeats > 0)) {
    sink.error('invalid-musical', 'A tempo-linked clip needs startBeats >= 0 and durationBeats '
      + '> 0.', at);
    return;
  }
  const tempo = transport && transport.tempo;
  if (!finite(tempo) || !(tempo > 0)) return;
  const spb = 60 / tempo;
  if (Math.abs(mu.startBeats * spb - clip.start) > MUSICAL_TOLERANCE_S
    || Math.abs(mu.durationBeats * spb - clip.duration) > MUSICAL_TOLERANCE_S) {
    sink.error('invalid-musical', 'A tempo-linked clip\'s seconds must equal its beats at the '
      + 'transport tempo.', at);
  }
}

function validateTimeline(model, registry, sink, ids, nodeById) {
  const t = model.timeline;
  const trackById = new Map();
  t.tracks.forEach((track, i) => {
    const path = `timeline.tracks[${i}]`;
    checkId(track.id, `${path}.id`, sink, ids);
    trackById.set(track.id, track);
    if (!TRACK_KINDS.includes(track.kind)) {
      sink.error('invalid-track', `Track kind must be one of ${TRACK_KINDS.join(', ')}.`,
        { path: `${path}.kind` });
    }
    checkName(track.name, `${path}.name`, sink);
    if (track.target !== null && !nodeById.has(track.target)) {
      sink.error('missing-node', `Track ${track.name} targets a node that does not exist.`,
        { path: `${path}.target` });
    }
  });
  t.clips.forEach((clip, i) => {
    const path = `timeline.clips[${i}]`;
    checkId(clip.id, `${path}.id`, sink, ids);
    const track = trackById.get(clip.trackId);
    if (!track) {
      sink.error('missing-track', 'The clip is on a track that does not exist.',
        { path: `${path}.trackId` });
    }
    if (!CLIP_KINDS.includes(clip.kind)) {
      sink.error('invalid-clip', `Clip kind must be one of ${CLIP_KINDS.join(', ')}.`,
        { path: `${path}.kind` });
      return;
    }
    const allowed = track ? TRACK_CLIP_KINDS[track.kind] : null;
    if (allowed && !allowed.includes(clip.kind)) {
      sink.error('clip-kind-mismatch', `A ${clip.kind} clip cannot go on a ${track.kind} track.`,
        { path: `${path}.kind` });
    }
    const okStart = checkTime(clip.start, `${path}.start`, sink, 'Clip start');
    if (!finite(clip.duration) || clip.duration < MIN_CLIP_S) {
      sink.error('invalid-time', `Clip duration must be at least ${MIN_CLIP_S} s.`,
        { path: `${path}.duration` });
    } else if (okStart && clip.start + clip.duration > TIMELINE_MAX_S) {
      sink.error('invalid-time', `A clip must end by ${TIMELINE_MAX_S} s.`,
        { path: `${path}.duration` });
    }
    const target = clip.target !== null ? clip.target : track ? track.target : null;
    if (target !== null) {
      const node = nodeById.get(target);
      const def = node && registry.get(node.type);
      if (!node) {
        sink.error('missing-node', 'The clip targets a node that does not exist.',
          { path: `${path}.target` });
      } else if (def && !def.clipKinds.includes(clip.kind)) {
        sink.error('invalid-clip-target', `${nameOf(node)} cannot play ${clip.kind} clips.`,
          { path: `${path}.target`, nodeId: node.id });
      }
    }
    if (clip.kind === 'pattern' && finite(clip.duration)) checkPattern(clip, path, sink);
    if (clip.musical !== undefined) checkMusical(clip, model.transport, path, sink);
    if (clip.kind === 'event' && clip.payload && clip.payload.action !== undefined
      && !EVENT_ACTIONS.includes(clip.payload.action)) {
      sink.error('invalid-clip', `An event clip action must be one of `
        + `${EVENT_ACTIONS.join(', ')}.`, { path: `${path}.payload.action` });
    }
    if (clip.kind === 'measurement'
      && !MEASUREMENT_ACTIONS.includes(clip.payload && clip.payload.action)) {
      sink.error('invalid-clip', `A measurement clip action must be one of `
        + `${MEASUREMENT_ACTIONS.join(', ')}.`, { path: `${path}.payload.action` });
    }
  });
  const laneTargets = new Set();
  t.automation.forEach((lane, i) => {
    const path = `timeline.automation[${i}]`;
    checkId(lane.id, `${path}.id`, sink, ids);
    const node = nodeById.get(lane.target && lane.target.node);
    const def = node && registry.get(node.type);
    const p = def ? def.params.find((x) => x.key === lane.target.param) : null;
    if (!node) {
      sink.error('missing-node', 'An automation lane targets a node that does not exist.',
        { path: `${path}.target.node` });
    } else if (def && (!p || !p.automatable)) {
      sink.error('not-automatable', `${nameOf(node)} ${p ? p.label : lane.target.param} cannot be `
        + 'automated.', { path: `${path}.target.param`, nodeId: node.id });
    }
    const key = `${lane.target && lane.target.node}\u0000${lane.target && lane.target.param}`;
    if (laneTargets.has(key)) {
      sink.error('duplicate-lane', 'A parameter has more than one automation lane.', { path });
    }
    laneTargets.add(key);
    let prev = null;
    lane.points.forEach((pt, j) => {
      const pp = `${path}.points[${j}]`;
      checkId(pt.id, `${pp}.id`, sink, ids);
      checkTime(pt.time, `${pp}.time`, sink, 'Automation time');
      if (prev && finite(prev.time) && finite(pt.time) && pt.time < prev.time) {
        sink.error('invalid-automation', 'Automation points must be sorted by time.', { path: pp });
      }
      if (!AUTOMATION_CURVES.includes(pt.curve)) {
        sink.error('invalid-automation', `Curve must be one of ${AUTOMATION_CURVES.join(', ')}.`,
          { path: `${pp}.curve` });
      }
      if (p) {
        const why = validateParamValue(p, pt.value);
        if (why) sink.error('invalid-automation', `${p.label}: ${why}.`, { path: `${pp}.value` });
      } else if (!finite(pt.value)) {
        sink.error('invalid-automation', 'Value must be a finite number.', { path: `${pp}.value` });
      }
      if (pt.curve === 'exponential' && p && !(p.min > 0)) {
        sink.error('invalid-automation', `${p.label} can reach zero or below, so it cannot use an `
          + 'exponential ramp; use a linear ramp.', { path: `${pp}.curve` });
      } else if (pt.curve === 'exponential' && !(pt.value > 0 && (!prev || prev.value > 0))) {
        sink.error('invalid-automation', 'An exponential ramp needs positive values at both ends '
          + '(never to or from zero); use a linear ramp.', { path: `${pp}.curve` });
      }
      prev = pt;
    });
  });
  t.markers.forEach((m, i) => {
    const path = `timeline.markers[${i}]`;
    checkId(m.id, `${path}.id`, sink, ids);
    checkTime(m.time, `${path}.time`, sink, 'Marker time');
    if (!MARKER_KINDS.includes(m.kind)) {
      sink.error('invalid-marker', `Marker kind must be one of ${MARKER_KINDS.join(', ')}.`,
        { path: `${path}.kind` });
    }
    if (typeof m.label !== 'string' || m.label.length > NAME_MAX_CHARS || CTRL.test(m.label)) {
      sink.error('invalid-name', `A marker label must be at most ${NAME_MAX_CHARS} printable `
        + 'characters.', { path: `${path}.label` });
    }
  });
  const loop = t.loop;
  if (typeof loop.enabled !== 'boolean' || !checkTime(loop.start, 'timeline.loop.start', sink,
    'Loop start') || !checkTime(loop.end, 'timeline.loop.end', sink, 'Loop end')
    || loop.end <= loop.start) {
    sink.error('invalid-loop', 'The loop needs enabled true/false and start < end.',
      { path: 'timeline.loop' });
  } else if (loop.enabled && loop.end - loop.start < MIN_CLIP_S) {
    sink.error('invalid-loop', `An active loop must be at least ${MIN_CLIP_S} s long.`,
      { path: 'timeline.loop' });
  }
}

function validateRest(model, sink) {
  if (model.kind !== STUDIO_KIND) sink.error('invalid-structure', `kind must be ${STUDIO_KIND}.`);
  if (model.schemaVersion !== STUDIO_SCHEMA_VERSION) {
    sink.error('invalid-structure', `schemaVersion must be ${STUDIO_SCHEMA_VERSION}.`);
  }
  const tr = model.transport;
  if (!TIME_MODES.includes(tr.timeMode)) {
    sink.error('invalid-transport', `Time mode must be one of ${TIME_MODES.join(', ')}.`,
      { path: 'transport.timeMode' });
  }
  if (!finite(tr.tempo) || tr.tempo < TEMPO_RANGE[0] || tr.tempo > TEMPO_RANGE[1]) {
    sink.error('invalid-transport', `Tempo must be ${TEMPO_RANGE[0]}-${TEMPO_RANGE[1]} BPM.`,
      { path: 'transport.tempo' });
  }
  const [beats, unit] = tr.timeSignature;
  if (!Number.isInteger(beats) || beats < 1 || beats > 32
    || !TIME_SIGNATURE_DENOMINATORS.includes(unit)) {
    sink.error('invalid-transport', 'Invalid time signature.', { path: 'transport.timeSignature' });
  }
  const { graph: vg, timeline: vt } = model.view;
  if (![vg.panX, vg.panY, vt.scrollX].every(finite) || !(vg.zoom > 0) || !finite(vg.zoom)
    || !(vt.pxPerSecond > 0) || !finite(vt.pxPerSecond)) {
    sink.error('invalid-view', 'View values must be finite; zoom and scale must be positive.',
      { path: 'view' });
  }
  const meta = model.metadata;
  checkName(meta.title, 'metadata.title', sink, TITLE_MAX_CHARS);
  if (typeof meta.notes !== 'string' || meta.notes.length > NOTES_MAX_CHARS) {
    sink.error('invalid-name', `Notes must be at most ${NOTES_MAX_CHARS} characters.`,
      { path: 'metadata.notes' });
  }
}

/**
 * Validate a normalized model (schema.js shape). Never throws for a model of that shape; the
 * `order` is the node topological order, null when the graph has a cycle.
 */
export function validateStudioModel(model, { registry = NODE_REGISTRY } = {}) {
  const sink = makeSink();
  const ids = new Set();
  const { order, nodeById } = validateGraph(model, registry, sink, ids);
  validateTimeline(model, registry, sink, ids, nodeById);
  validateRest(model, sink);
  const errors = sink.diagnostics.filter((d) => d.severity === 'error');
  const warnings = sink.diagnostics.filter((d) => d.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, diagnostics: sink.diagnostics,
    order: errors.length ? null : order };
}

/** Cycle report of a normalized model, independent of the other rules. */
export function analyzeCycles(model, { registry = NODE_REGISTRY } = {}) {
  const sink = makeSink();
  const nodes = model.graph.nodes.filter((n) => registry.has(n.type));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const resolved = model.graph.edges.map((e) => resolveEdge(e, nodeById, registry, sink, ''))
    .filter(Boolean);
  const { order, cycles } = cyclesOf(nodes, resolved);
  return { order,
    cycles: cycles.map(({ kind, nodes: ns, edges }) => ({ kind, nodes: ns, edges })) };
}

// ---------------------------------------------------------------- untrusted import

const TOP = { req: ['kind', 'schemaVersion', 'graph', 'timeline', 'transport'],
  opt: ['view', 'metadata'] };

function depthOf(v, limit, depth = 0) {
  if (v === null || typeof v !== 'object') return depth;
  if (depth > limit) return depth;
  let max = depth;
  for (const k of Object.keys(v)) max = Math.max(max, depthOf(v[k], limit, depth + 1));
  return max;
}

function structure(c, doc, lim, registry) {
  const s = (v, p, max = lim.stringChars) => c.str(v, p, max);
  const id = (v, p) => c.str(v, p, 128, { pattern: ID_PATTERN });
  const list = (v, p, max, what) => {
    if (!Array.isArray(v)) return c.add(p, 'must be a list') && [];
    if (v.length > max) {
      c.add(p, `more than ${max} ${what} (import limit)`);
      return null;
    }
    return v;
  };
  if (!c.keys(doc, '', TOP.req, TOP.opt)) return false;
  if (!c.keys(doc.graph, 'graph', ['nodes', 'edges'])) return false;
  const nodes = list(doc.graph.nodes, 'graph.nodes', lim.nodes, 'nodes');
  const edges = list(doc.graph.edges, 'graph.edges', lim.edges, 'edges');
  const tl = doc.timeline;
  if (!c.keys(tl, 'timeline', [], ['tracks', 'clips', 'automation', 'markers', 'loop'])) {
    return false;
  }
  const tracks = list(tl.tracks ?? [], 'timeline.tracks', lim.tracks, 'tracks');
  const clips = list(tl.clips ?? [], 'timeline.clips', lim.clips, 'clips');
  const lanes = list(tl.automation ?? [], 'timeline.automation', lim.automationLanes, 'lanes');
  const markers = list(tl.markers ?? [], 'timeline.markers', lim.markers, 'markers');
  if (!nodes || !edges || !tracks || !clips || !lanes || !markers) return false;
  let points = 0;
  for (const lane of lanes) points += Array.isArray(lane && lane.points) ? lane.points.length : 0;
  if (points > lim.automationPoints) {
    c.add('timeline.automation', `more than ${lim.automationPoints} automation points (import `
      + 'limit)');
    return false;
  }
  nodes.forEach((n, i) => {
    const p = `graph.nodes[${i}]`;
    if (!c.keys(n, p, ['id', 'type', 'position', 'params'], ['metadata'])) return;
    id(n.id, `${p}.id`);
    s(n.type, `${p}.type`, 64);
    if (c.keys(n.position, `${p}.position`, ['x', 'y'])) {
      c.num(n.position.x, `${p}.position.x`, -POSITION_LIMIT, POSITION_LIMIT);
      c.num(n.position.y, `${p}.position.y`, -POSITION_LIMIT, POSITION_LIMIT);
    }
    if (n.metadata !== undefined && c.keys(n.metadata, `${p}.metadata`, [], ['name'])) {
      if (n.metadata.name !== undefined) s(n.metadata.name, `${p}.metadata.name`, NAME_MAX_CHARS);
    }
    const def = registry.get(n.type);
    if (!def) c.add(`${p}.type`, `unknown node type "${String(n.type).slice(0, 64)}"`);
    if (c.obj(n.params, `${p}.params`) && def) {
      for (const k of Object.keys(n.params)) {
        const pd = def.params.find((x) => x.key === k);
        if (!pd) c.add(`${p}.params.${k}`, 'unknown parameter');
        else {
          const why = validateParamValue(pd, n.params[k]);
          if (why) c.add(`${p}.params.${k}`, why);
        }
      }
    }
  });
  edges.forEach((e, i) => {
    const p = `graph.edges[${i}]`;
    if (!c.keys(e, p, ['id', 'from', 'to'], ['props'])) return;
    id(e.id, `${p}.id`);
    for (const end of ['from', 'to']) {
      if (c.keys(e[end], `${p}.${end}`, ['node', 'port'])) {
        id(e[end].node, `${p}.${end}.node`);
        s(e[end].port, `${p}.${end}.port`, 64);
      }
    }
    if (e.props !== undefined && c.obj(e.props, `${p}.props`)) {
      if (Object.keys(e.props).length > 8) c.add(`${p}.props`, 'too many properties');
    }
  });
  tracks.forEach((t, i) => {
    const p = `timeline.tracks[${i}]`;
    if (!c.keys(t, p, ['id', 'kind'], ['name', 'target'])) return;
    id(t.id, `${p}.id`);
    c.oneOf(t.kind, `${p}.kind`, TRACK_KINDS);
    if (t.name !== undefined) s(t.name, `${p}.name`, NAME_MAX_CHARS);
    if (t.target !== undefined && t.target !== null) id(t.target, `${p}.target`);
  });
  clips.forEach((x, i) => {
    const p = `timeline.clips[${i}]`;
    if (!c.keys(x, p, ['id', 'trackId', 'kind', 'start', 'duration'],
      ['target', 'payload', 'musical'])) {
      return;
    }
    if (x.musical !== undefined && c.keys(x.musical, `${p}.musical`,
      ['startBeats', 'durationBeats'])) {
      c.num(x.musical.startBeats, `${p}.musical.startBeats`, 0, TIMELINE_MAX_S * 10);
      c.num(x.musical.durationBeats, `${p}.musical.durationBeats`, 0, TIMELINE_MAX_S * 10);
    }
    id(x.id, `${p}.id`);
    id(x.trackId, `${p}.trackId`);
    c.oneOf(x.kind, `${p}.kind`, CLIP_KINDS);
    c.num(x.start, `${p}.start`, 0, TIMELINE_MAX_S);
    c.num(x.duration, `${p}.duration`, MIN_CLIP_S, TIMELINE_MAX_S);
    if (x.target !== undefined && x.target !== null) id(x.target, `${p}.target`);
    if (x.payload !== undefined) {
      const payload = c.json(x.payload, `${p}.payload`, { depth: 3, keys: 32, array: 64,
        string: lim.stringChars });
      if (payload !== undefined && (payload === null || typeof payload !== 'object'
        || Array.isArray(payload))) c.add(`${p}.payload`, 'must be an object');
    }
  });
  lanes.forEach((l, i) => {
    const p = `timeline.automation[${i}]`;
    if (!c.keys(l, p, ['id', 'target', 'points'])) return;
    id(l.id, `${p}.id`);
    if (c.keys(l.target, `${p}.target`, ['node', 'param'])) {
      id(l.target.node, `${p}.target.node`);
      s(l.target.param, `${p}.target.param`, 64);
    }
    const pts = list(l.points, `${p}.points`, lim.pointsPerLane, 'points');
    (pts || []).forEach((pt, j) => {
      const q = `${p}.points[${j}]`;
      if (!c.keys(pt, q, ['id', 'time', 'value'], ['curve'])) return;
      id(pt.id, `${q}.id`);
      c.num(pt.time, `${q}.time`, 0, TIMELINE_MAX_S);
      c.num(pt.value, `${q}.value`, -Number.MAX_VALUE, Number.MAX_VALUE);
      if (pt.curve !== undefined) c.oneOf(pt.curve, `${q}.curve`, AUTOMATION_CURVES);
    });
  });
  markers.forEach((m, i) => {
    const p = `timeline.markers[${i}]`;
    if (!c.keys(m, p, ['id', 'time'], ['kind', 'label'])) return;
    id(m.id, `${p}.id`);
    c.num(m.time, `${p}.time`, 0, TIMELINE_MAX_S);
    if (m.kind !== undefined) c.oneOf(m.kind, `${p}.kind`, MARKER_KINDS);
    if (m.label !== undefined) s(m.label, `${p}.label`, NAME_MAX_CHARS);
  });
  if (tl.loop !== undefined && c.keys(tl.loop, 'timeline.loop', ['enabled', 'start', 'end'])) {
    c.bool(tl.loop.enabled, 'timeline.loop.enabled');
    c.num(tl.loop.start, 'timeline.loop.start', 0, TIMELINE_MAX_S);
    c.num(tl.loop.end, 'timeline.loop.end', 0, TIMELINE_MAX_S);
  }
  if (c.keys(doc.transport, 'transport', [], ['timeMode', 'tempo', 'timeSignature'])) {
    const tr = doc.transport;
    if (tr.timeMode !== undefined) c.oneOf(tr.timeMode, 'transport.timeMode', TIME_MODES);
    if (tr.tempo !== undefined) c.num(tr.tempo, 'transport.tempo', ...TEMPO_RANGE);
    if (tr.timeSignature !== undefined) {
      if (!Array.isArray(tr.timeSignature) || tr.timeSignature.length !== 2) {
        c.add('transport.timeSignature', 'must be [beats, unit]');
      } else {
        c.num(tr.timeSignature[0], 'transport.timeSignature[0]', 1, 32, { integer: true });
        c.oneOf(tr.timeSignature[1], 'transport.timeSignature[1]', TIME_SIGNATURE_DENOMINATORS);
      }
    }
  }
  if (doc.view !== undefined && c.keys(doc.view, 'view', [], ['graph', 'timeline'])) {
    const v = doc.view;
    if (v.graph !== undefined && c.keys(v.graph, 'view.graph', [], ['panX', 'panY', 'zoom'])) {
      for (const k of ['panX', 'panY']) {
        if (v.graph[k] !== undefined) c.num(v.graph[k], `view.graph.${k}`, -1e9, 1e9);
      }
      if (v.graph.zoom !== undefined) c.num(v.graph.zoom, 'view.graph.zoom', 1e-6, 1e6);
    }
    if (v.timeline !== undefined
      && c.keys(v.timeline, 'view.timeline', [], ['pxPerSecond', 'scrollX'])) {
      if (v.timeline.pxPerSecond !== undefined) {
        c.num(v.timeline.pxPerSecond, 'view.timeline.pxPerSecond', 1e-6, 1e6);
      }
      if (v.timeline.scrollX !== undefined) {
        c.num(v.timeline.scrollX, 'view.timeline.scrollX', -1e9, 1e9);
      }
    }
  }
  if (doc.metadata !== undefined && c.keys(doc.metadata, 'metadata', [], ['title', 'notes'])) {
    if (doc.metadata.title !== undefined) s(doc.metadata.title, 'metadata.title', TITLE_MAX_CHARS);
    if (doc.metadata.notes !== undefined) {
      c.str(doc.metadata.notes, 'metadata.notes', lim.notesChars, { multiline: true });
    }
  }
  return true;
}

const asError = (e, code = 'invalid-structure') => ({ code, severity: 'error',
  message: e.text, path: e.path });

/**
 * Validate an untrusted Studio document of the CURRENT schema (§115, §159, §238): JSON text or
 * a parsed object. Pipeline: size cap (before JSON.parse) → structural scan (plain data only, no
 * prototype keys, finite numbers, nesting depth) → kind and version → import limits (counts,
 * string lengths) → strict schema (unknown fields rejected, node types, parameters) → normalize
 * → semantic validation (validateStudioModel). The returned model is a normalized deep copy;
 * the input is never modified. Older schema versions go through migrate.js importStudio.
 */
export function validateStudioImport(input, limits = STUDIO_IMPORT_LIMITS,
  { registry = NODE_REGISTRY } = {}) {
  const lim = { ...STUDIO_IMPORT_LIMITS, ...limits };
  const fail = (path, message, code = 'invalid-structure') => ({ ok: false, warnings: [],
    errors: [{ code, severity: 'error', message, path }] });
  let doc = input;
  if (typeof input === 'string') {
    if (utf8Length(input, lim.maxBytes) > lim.maxBytes) {
      return fail('', `The file is larger than the ${lim.maxBytes}-byte import limit.`,
        'limit-exceeded');
    }
    try {
      doc = JSON.parse(input);
    } catch (err) {
      return fail('', `Not valid JSON (${String(err && err.message).slice(0, 120)}).`);
    }
  }
  const scan = scanUntrusted(doc, { maxBytes: typeof input === 'string' ? Infinity : lim.maxBytes,
    maxErrors: lim.maxErrors });
  if (scan.length) return { ok: false, warnings: [], errors: scan.map((e) => asError(e)) };
  if (depthOf(doc, lim.depth) > lim.depth) {
    return fail('', `The data is nested deeper than ${lim.depth} levels.`, 'limit-exceeded');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return fail('', 'The file does not contain a Studio object.');
  }
  if (doc.kind !== STUDIO_KIND) {
    return fail('kind', doc.kind === 'oscilla-experiment'
      ? 'This is an OSCILLA experiment file, not a Studio file.'
      : `kind must be "${STUDIO_KIND}".`);
  }
  if (doc.schemaVersion !== STUDIO_SCHEMA_VERSION) {
    return fail('schemaVersion', `Studio schema ${String(doc.schemaVersion).slice(0, 16)} is not `
      + `${STUDIO_SCHEMA_VERSION}; import it through importStudio (migrate.js).`);
  }
  const c = createChecker(lim.maxErrors);
  let model;
  try {
    structure(c, doc, lim, registry);
    if (!c.errors.length) model = normalizeStudio(doc, { registry });
  } catch (err) {
    return fail('', `The Studio file could not be checked (${String(err && err.message)
      .slice(0, 120)}).`);
  }
  if (c.errors.length) {
    const errors = c.errors.map((e) => asError(e, /import limit/.test(e.text) ? 'limit-exceeded'
      : 'invalid-structure'));
    return { ok: false, errors, warnings: [] };
  }
  const report = validateStudioModel(model, { registry });
  if (!report.ok) return { ok: false, errors: report.errors, warnings: report.warnings };
  return { ok: true, model, warnings: report.warnings };
}
