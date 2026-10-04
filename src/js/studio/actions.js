// The Studio action layer and store (spec §47-§52, §118-§124, §172-§174, §178-§179). Every
// meaningful mutation of the canonical StudioModel goes through dispatch({ type, ... }); there is
// no other writer. Pure apart from the injected idGenerator and onChange callbacks: no DOM, no
// Web Audio, no globals, no clock.
//
//   createStudioStore(initialModel, { idGenerator, onChange, registry, historyLimit }) -> store
//   store.dispatch(action) -> { ok: true, changed, model, revision, label?, created? }
//                           | { ok: false, reason, diagnostics }
//   store.undo() / store.redo() -> { ok, label? };  canUndo(), canRedo(), undoLabel(), redoLabel()
//   store.beginGesture(label?), endGesture(), cancelGesture()      (§50, §185)
//   store.getModel(), getSelection(), getRevision(), getState(), debugInfo()      (§52, §177)
//   copySubgraph(model, nodeIds) -> clipboard (plain data, §121)
//   createIdGenerator(model?) -> (prefix) => '<prefix>-<n>'
//
// Actions (semantic, undoable): NODE_ADD, NODE_REMOVE, NODE_MOVE, NODE_PARAM_SET, NODE_RENAME,
// EDGE_ADD, EDGE_REMOVE, EDGE_UPDATE, TRACK_ADD, TRACK_REMOVE, CLIP_ADD, CLIP_REMOVE, CLIP_MOVE,
// CLIP_RESIZE, AUTOMATION_POINT_ADD, AUTOMATION_POINT_MOVE, AUTOMATION_POINT_REMOVE, MARKER_ADD,
// MARKER_REMOVE, LOOP_SET, TRANSPORT_SET, METADATA_SET, PASTE, DUPLICATE; timeline additions
// (V416-V420): CLIP_UPDATE, CLIP_SET_TIME_BASE, MARKER_MOVE; patch additions (V426, patches.js):
// PATCH_INSERT { patch, at? } ("Insert <name>") and PATCH_REPLACE { patch, at? } ("Replace
// graph with <name>"), the explicit insert-or-replace intent of §114.
// Tempo-linked clips (§90-§91, `clip.musical`): CLIP_ADD with timeBase 'tempo' (or startBeats /
// durationBeats) creates one; CLIP_MOVE / CLIP_RESIZE keep it linked and re-derive its beats from
// the new seconds; TRANSPORT_SET with a new tempo rescales every tempo-linked clip (absolute
// clips stay where they are); DUPLICATE shifts a copy's beats with its seconds and accepts
// `placements: { [clipId]: { start, trackId? } }` (timeline.js duplicateClipPlacement).
// View actions (not undoable, no revision bump, never dirty): SELECTION_CHANGE (selection lives in
// the store, never in the model or a file, §252), VIEW_SET (pan/zoom/timeline scale, §253).
// Undoing selection would interleave navigation with edits in the history and make "undo"
// appear to do nothing; editors restore focus themselves (§142).
//
// INVARIANTS:
//   - The store's model is always valid: a semantic action whose result fails
//     validateStudioModel is rejected with the first error's message and leaves model, history,
//     selection and revision unchanged (§46, §179). The initial model must be valid.
//   - Models are deep-frozen and never mutated; actions return new models sharing unchanged
//     sub-objects (history.js explains the memory reasoning).
//   - `revision` is monotonic and in memory only (§178): it increases on every semantic change,
//     undo and redo, so a runtime can tell which topology it reflects. It is never persisted.
//   - IDs come only from the injected generator, are checked against every id in the model and
//     never reused within one action (§172). Display names are metadata (§173-§174).
//   - NODE_REMOVE cascades (§124): connected edges, clips targeting the node and its automation
//     lanes are removed, track targets cleared; one undo restores all of it.

import { ID_PATTERN } from '../experiments/schema.js';
import { canConnect, validateEdgeProps } from './ports.js';
import { NODE_REGISTRY, projectParams, validateParamValue } from './registry.js';
import {
  CLIP_KINDS, CLIP_TIME_BASES, MARKER_KINDS, NAME_MAX_CHARS, POSITION_LIMIT, StudioSchemaError,
  TRACK_CLIP_KINDS,
  assertPlainData, collectIds, copyPlain, createStudioModel, normalizeClipPayload,
  normalizeStudio, sortPoints,
} from './schema.js';
import { validateStudioModel } from './validate.js';
import { createHistory, STUDIO_HISTORY_LIMIT } from './history.js';
import { PatchError, insertPatch, replaceWithPatch } from './patches.js';

export { STUDIO_HISTORY_LIMIT };
export const CLIPBOARD_KIND = 'oscilla-studio-clipboard';
/** Offset of pasted / duplicated nodes, logical units (§121, §123). */
export const PASTE_OFFSET = Object.freeze({ x: 24, y: 24 });
const MAX_ID_ATTEMPTS = 64;

export const EMPTY_SELECTION = Object.freeze({
  nodes: Object.freeze([]), edges: Object.freeze([]), clips: Object.freeze([]),
  points: Object.freeze([]), markers: Object.freeze([]),
});
const SELECTION_KEYS = Object.keys(EMPTY_SELECTION);

/** A rejected action; the store turns it into { ok: false, reason }. */
export class ActionRejected extends Error {
  constructor(reason, diagnostics = []) {
    super(reason);
    this.name = 'ActionRejected';
    this.diagnostics = diagnostics;
  }
}
const reject = (reason) => {
  throw new ActionRejected(reason);
};

// ---------------------------------------------------------------- helpers

/** Freeze every object reachable from v that is not frozen yet (shared parts already are). */
export function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

/**
 * A deterministic counter id generator: `<prefix>-<n>` with n one above the largest suffix
 * already used for that prefix in `model` (osc-1, filter-1, edge-4, ...). The store still
 * checks every id for uniqueness.
 */
export function createIdGenerator(model = null) {
  const next = new Map();
  if (model) {
    for (const id of collectIds(model)) {
      const m = /^(.*)-(\d+)$/.exec(id);
      if (m) next.set(m[1], Math.max(next.get(m[1]) || 1, Number(m[2]) + 1));
    }
  }
  return (prefix) => {
    const n = next.get(prefix) || 1;
    next.set(prefix, n + 1);
    return `${prefix}-${n}`;
  };
}

const nodeName = (model, id) => {
  const n = model.graph.nodes.find((x) => x.id === id);
  return n ? n.metadata.name : id;
};
const withGraph = (model, graph) => ({ ...model, graph: { ...model.graph, ...graph } });
const withTimeline = (model, timeline) => ({ ...model,
  timeline: { ...model.timeline, ...timeline } });
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function requireNode(model, id) {
  const n = model.graph.nodes.find((x) => x.id === id);
  if (!n) reject(`There is no node "${String(id)}".`);
  return n;
}

function requireIn(list, id, what) {
  const x = list.find((y) => y.id === id);
  if (!x) reject(`There is no ${what} "${String(id)}".`);
  return x;
}

function checkPosition(p) {
  if (!p || !finite(p.x) || !finite(p.y) || Math.abs(p.x) > POSITION_LIMIT
    || Math.abs(p.y) > POSITION_LIMIT) reject('A position needs finite x and y.');
  return { x: p.x, y: p.y };
}

function checkName(name) {
  const v = typeof name === 'string' ? name.trim() : '';
  if (!v || v.length > NAME_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(v)) {
    reject(`A name must be 1-${NAME_MAX_CHARS} printable characters.`);
  }
  return v;
}

/** "Filter 3": one above the highest "Filter <n>" in use (duplicates stay legal, §173). */
function defaultName(nodes, def) {
  const re = new RegExp(`^${escapeRe(def.displayName)} (\\d+)$`);
  let max = 0;
  for (const n of nodes) {
    const m = re.exec(n.metadata.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${def.displayName} ${max + 1}`;
}

function checkParams(def, params, node) {
  if (params == null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) reject('Parameters must be an object.');
  for (const k of Object.keys(params)) {
    const p = def.params.find((x) => x.key === k);
    if (!p) reject(`${def.displayName} has no parameter "${k}".`);
    const why = validateParamValue(p, params[k]);
    if (why) reject(`${node ? node.metadata.name : def.displayName} ${p.label} ${why}.`);
  }
  return copyPlain(params);
}

function resolvePorts(model, from, to, registry) {
  if (!from || !to) reject('A connection needs from and to.');
  const a = requireNode(model, from.node);
  const b = requireNode(model, to.node);
  const src = registry.port(a.type, from.port, 'out');
  const tgt = registry.port(b.type, to.port, 'in');
  if (!src) {
    reject(registry.port(a.type, from.port, 'in')
      ? `Connection rejected: ${a.metadata.name} ${from.port} is an input; a connection starts at `
        + 'an output.'
      : `${a.metadata.name} has no output "${String(from.port)}".`);
  }
  if (!tgt) {
    reject(registry.port(b.type, to.port, 'out')
      ? `Connection rejected: ${b.metadata.name} ${to.port} is an output; a connection ends at `
        + 'an input.'
      : `${b.metadata.name} has no input "${String(to.port)}".`);
  }
  const verdict = canConnect(src, tgt, { sourceNodeId: a.id, targetNodeId: b.id });
  if (!verdict.allowed) reject(`Connection rejected: ${verdict.reason}`);
  const paramDef = tgt.param ? registry.param(b.type, tgt.param.key) : null;
  return { a, b, src, tgt, type: verdict.signalType, paramDef };
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

// ---------------------------------------------------------------- clipboard

/**
 * The internal clipboard of a selection (§121): the selected nodes plus every edge whose two
 * endpoints are selected, as plain data (safe to put on the system clipboard as JSON).
 */
export function copySubgraph(model, nodeIds) {
  const ids = new Set(nodeIds);
  const nodes = model.graph.nodes.filter((n) => ids.has(n.id));
  const edges = model.graph.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node));
  return { kind: CLIPBOARD_KIND, v: 1, nodes: copyPlain(nodes), edges: copyPlain(edges) };
}

/** Insert a clipboard with new ids and an offset; returns { model, created, skipped }. */
function pasteInto(model, clipboard, offset, ctx) {
  if (!clipboard || clipboard.kind !== CLIPBOARD_KIND || !Array.isArray(clipboard.nodes)
    || !Array.isArray(clipboard.edges)) reject('The clipboard does not hold Studio nodes.');
  const off = offset ? checkPosition(offset) : PASTE_OFFSET;
  const idMap = new Map();
  const nodes = [...model.graph.nodes];
  const created = { nodes: [], edges: [] };
  const skipped = [];
  const counts = new Map();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
  for (const src of clipboard.nodes) {
    const def = ctx.registry.get(src && src.type);
    if (!def) reject(`Unknown node type "${String(src && src.type)}" on the clipboard.`);
    if (def.maxInstances != null && (counts.get(def.type) || 0) >= def.maxInstances) {
      skipped.push(src.id);
      continue;
    }
    counts.set(def.type, (counts.get(def.type) || 0) + 1);
    const params = { ...projectParams(def, {}), ...checkParams(def, src.params, null) };
    const pos = checkPosition(src.position);
    const srcName = src.metadata && typeof src.metadata.name === 'string' ? src.metadata.name : '';
    const numbered = new RegExp(`^${escapeRe(def.displayName)} \\d+$`).test(srcName);
    const node = {
      id: ctx.newId(def.idPrefix),
      type: def.type,
      position: { x: pos.x + off.x, y: pos.y + off.y },
      params,
      metadata: { name: numbered || !srcName ? defaultName(nodes, def) : checkName(srcName) },
    };
    idMap.set(src.id, node.id);
    nodes.push(node);
    created.nodes.push(node.id);
  }
  const edges = [...model.graph.edges];
  for (const e of clipboard.edges) {
    if (!e || !e.from || !e.to || !idMap.has(e.from.node) || !idMap.has(e.to.node)) continue;
    const edge = {
      id: ctx.newId('edge'),
      from: { node: idMap.get(e.from.node), port: e.from.port },
      to: { node: idMap.get(e.to.node), port: e.to.port },
      props: copyPlain(e.props || {}),
    };
    edges.push(edge);
    created.edges.push(edge.id);
  }
  if (!created.nodes.length) reject('Nothing to paste.');
  return { model: withGraph(model, { nodes, edges }), created, skipped };
}

const countLabel = (n, one, many) => (n === 1 ? one : `${many.replace('#', n)}`);

// ---------------------------------------------------------------- tempo-linked clips

const roundBeats = (v) => Math.round(v * 1e9) / 1e9;

/** The clip with `musical` re-derived from its seconds at `tempo` (tempo-linked clips only). */
function relink(clip, tempo) {
  if (!clip.musical) return clip;
  return { ...clip, musical: { startBeats: roundBeats(clip.start * tempo / 60),
    durationBeats: roundBeats(clip.duration * tempo / 60) } };
}

/** Seconds of a tempo-linked clip at a new tempo: beats are kept, seconds follow (§91). */
function retempo(clip, tempo) {
  if (!clip.musical) return clip;
  const spb = 60 / tempo;
  return { ...clip, start: clip.musical.startBeats * spb,
    duration: clip.musical.durationBeats * spb };
}

// ---------------------------------------------------------------- reducers

const REDUCERS = {
  NODE_ADD(model, a, ctx) {
    const def = ctx.registry.get(a.nodeType);
    if (!def) reject(`Unknown node type "${String(a.nodeType)}".`);
    const count = model.graph.nodes.filter((n) => n.type === def.type).length;
    if (def.maxInstances != null && count >= def.maxInstances) {
      reject(def.maxInstances === 1 ? `A Studio has exactly one ${def.displayName}.`
        : `At most ${def.maxInstances} ${def.displayName} nodes are allowed.`);
    }
    const node = {
      id: ctx.newId(def.idPrefix),
      type: def.type,
      position: checkPosition(a.position || { x: 0, y: 0 }),
      params: { ...projectParams(def, {}), ...checkParams(def, a.params, null) },
      metadata: { name: a.name != null ? checkName(a.name) : defaultName(model.graph.nodes, def) },
    };
    return {
      model: withGraph(model, { nodes: [...model.graph.nodes, node] }),
      label: `Add ${node.metadata.name}`,
      created: { nodes: [node.id] },
    };
  },

  NODE_REMOVE(model, a) {
    const ids = a.nodeIds || [a.nodeId];
    if (!Array.isArray(ids) || !ids.length) reject('No node to delete.');
    for (const id of ids) requireNode(model, id);
    const gone = new Set(ids);
    const t = model.timeline;
    const next = withGraph(model, {
      nodes: model.graph.nodes.filter((n) => !gone.has(n.id)),
      edges: model.graph.edges.filter((e) => !gone.has(e.from.node) && !gone.has(e.to.node)),
    });
    return {
      model: withTimeline(next, {
        tracks: t.tracks.map((x) => (gone.has(x.target) ? { ...x, target: null } : x)),
        clips: t.clips.filter((c) => !gone.has(c.target)),
        automation: t.automation.filter((l) => !gone.has(l.target.node)),
      }),
      label: countLabel(ids.length, `Delete ${nodeName(model, ids[0])}`, 'Delete # nodes'),
    };
  },

  NODE_MOVE(model, a) {
    let moves;
    if (a.nodeIds) {
      if (!Array.isArray(a.nodeIds) || !a.nodeIds.length) reject('No node to move.');
      const d = checkPosition(a.delta);
      moves = new Map(a.nodeIds.map((id) => {
        const n = requireNode(model, id);
        return [id, checkPosition({ x: n.position.x + d.x, y: n.position.y + d.y })];
      }));
    } else {
      requireNode(model, a.nodeId);
      moves = new Map([[a.nodeId, checkPosition(a.position)]]);
    }
    let changed = false;
    const nodes = model.graph.nodes.map((n) => {
      const p = moves.get(n.id);
      if (!p || (p.x === n.position.x && p.y === n.position.y)) return n;
      changed = true;
      return { ...n, position: p };
    });
    const ids = [...moves.keys()];
    return {
      model: changed ? withGraph(model, { nodes }) : model,
      label: countLabel(ids.length, `Move ${nodeName(model, ids[0])}`, 'Move # nodes'),
    };
  },

  NODE_PARAM_SET(model, a, ctx) {
    const node = requireNode(model, a.nodeId);
    const def = ctx.registry.get(node.type);
    const patch = a.params != null ? a.params : { [a.key]: a.value };
    const checked = checkParams(def, patch, node);
    const keys = Object.keys(checked);
    if (!keys.length) reject('No parameter to change.');
    if (keys.every((k) => sameValue(node.params[k], checked[k]))) return { model, label: '' };
    const updated = { ...node, params: { ...node.params, ...checked } };
    const label = keys.length === 1
      ? `Change ${node.metadata.name} ${def.params.find((p) => p.key === keys[0]).label}`
      : `Change ${node.metadata.name}`;
    return {
      model: withGraph(model, { nodes: model.graph.nodes.map((n) => (n === node ? updated : n)) }),
      label,
    };
  },

  NODE_RENAME(model, a) {
    const node = requireNode(model, a.nodeId);
    const name = checkName(a.name);
    if (name === node.metadata.name) return { model, label: '' };
    const updated = { ...node, metadata: { ...node.metadata, name } };
    return {
      model: withGraph(model, { nodes: model.graph.nodes.map((n) => (n === node ? updated : n)) }),
      label: `Rename ${node.metadata.name} to ${name}`,
    };
  },

  EDGE_ADD(model, a, ctx) {
    const r = resolvePorts(model, a.from, a.to, ctx.registry);
    const props = validateEdgeProps(a.props, r.type, r.tgt, r.paramDef);
    if (!props.ok) {
      reject(`Connection rejected: ${props.errors.map((e) => `${e.field} ${e.text}`).join('; ')}.`);
    }
    const edge = {
      id: ctx.newId('edge'),
      from: { node: r.a.id, port: r.src.id },
      to: { node: r.b.id, port: r.tgt.id },
      props: props.props,
    };
    return {
      model: withGraph(model, { edges: [...model.graph.edges, edge] }),
      label: `Connect ${r.a.metadata.name} to ${r.b.metadata.name}`,
      created: { edges: [edge.id] },
    };
  },

  EDGE_REMOVE(model, a) {
    const ids = a.edgeIds || [a.edgeId];
    if (!Array.isArray(ids) || !ids.length) reject('No connection to delete.');
    const first = requireIn(model.graph.edges, ids[0], 'connection');
    for (const id of ids) requireIn(model.graph.edges, id, 'connection');
    const gone = new Set(ids);
    return {
      model: withGraph(model, { edges: model.graph.edges.filter((e) => !gone.has(e.id)) }),
      label: countLabel(ids.length, `Disconnect ${nodeName(model, first.from.node)} from `
        + `${nodeName(model, first.to.node)}`, 'Delete # connections'),
    };
  },

  EDGE_UPDATE(model, a, ctx) {
    const edge = requireIn(model.graph.edges, a.edgeId, 'connection');
    if (!a.props || typeof a.props !== 'object') reject('No connection property to change.');
    const r = resolvePorts(model, edge.from, edge.to, ctx.registry);
    const props = validateEdgeProps({ ...edge.props, ...a.props }, r.type, r.tgt, r.paramDef);
    if (!props.ok) reject(props.errors.map((e) => `${e.field} ${e.text}`).join('; '));
    if (Object.keys(props.props).every((k) => props.props[k] === edge.props[k])) {
      return { model, label: '' };
    }
    const updated = { ...edge, props: props.props };
    return {
      model: withGraph(model, { edges: model.graph.edges.map((e) => (e === edge ? updated : e)) }),
      label: `Edit connection ${r.a.metadata.name} → ${r.b.metadata.name}`,
    };
  },

  TRACK_ADD(model, a, ctx) {
    const kind = a.kind || 'event';
    if (!TRACK_CLIP_KINDS[kind]) reject(`Unknown track kind "${String(kind)}".`);
    if (a.target != null) requireNode(model, a.target);
    const track = {
      id: ctx.newId('track'),
      kind,
      name: a.name != null ? checkName(a.name) : `Track ${model.timeline.tracks.length + 1}`,
      target: a.target ?? null,
    };
    return {
      model: withTimeline(model, { tracks: [...model.timeline.tracks, track] }),
      label: `Add ${track.name}`,
      created: { tracks: [track.id] },
    };
  },

  TRACK_REMOVE(model, a) {
    const track = requireIn(model.timeline.tracks, a.trackId, 'track');
    return {
      model: withTimeline(model, {
        tracks: model.timeline.tracks.filter((x) => x !== track),
        clips: model.timeline.clips.filter((c) => c.trackId !== track.id),
      }),
      label: `Delete ${track.name}`,
    };
  },

  CLIP_ADD(model, a, ctx) {
    const track = requireIn(model.timeline.tracks, a.trackId, 'track');
    const kind = a.kind || TRACK_CLIP_KINDS[track.kind][0];
    if (!CLIP_KINDS.includes(kind)) reject(`Unknown clip kind "${String(kind)}".`);
    if (a.target != null) requireNode(model, a.target);
    const timeBase = a.timeBase || (a.startBeats != null || a.durationBeats != null ? 'tempo'
      : 'absolute');
    if (!CLIP_TIME_BASES.includes(timeBase)) reject(`Unknown time base "${String(timeBase)}".`);
    const spb = 60 / model.transport.tempo;
    let clip = {
      id: ctx.newId('clip'),
      trackId: track.id,
      kind,
      start: a.startBeats != null && a.start == null ? a.startBeats * spb : a.start,
      duration: a.durationBeats != null && a.duration == null ? a.durationBeats * spb
        : a.duration,
      target: a.target ?? null,
      payload: normalizeClipPayload(kind, a.payload),
    };
    if (timeBase === 'tempo') {
      if (kind === 'measurement') {
        reject('A measurement clip is always placed in seconds; musical time never enters a '
          + 'measurement experiment.');
      }
      clip = relink({ ...clip, musical: {} }, model.transport.tempo);
    }
    return {
      model: withTimeline(model, { clips: [...model.timeline.clips, clip] }),
      label: `Add ${kind} clip`,
      created: { clips: [clip.id] },
    };
  },

  CLIP_REMOVE(model, a) {
    const clip = requireIn(model.timeline.clips, a.clipId, 'clip');
    return {
      model: withTimeline(model, { clips: model.timeline.clips.filter((c) => c !== clip) }),
      label: `Delete ${clip.kind} clip`,
    };
  },

  CLIP_MOVE(model, a) {
    const clip = requireIn(model.timeline.clips, a.clipId, 'clip');
    const trackId = a.trackId ?? clip.trackId;
    requireIn(model.timeline.tracks, trackId, 'track');
    const start = a.start ?? clip.start;
    if (start === clip.start && trackId === clip.trackId) return { model, label: '' };
    const updated = relink({ ...clip, start, trackId }, model.transport.tempo);
    return {
      model: withTimeline(model, { clips: model.timeline.clips.map((c) => (c === clip ? updated
        : c)) }),
      label: `Move ${clip.kind} clip`,
    };
  },

  CLIP_RESIZE(model, a) {
    const clip = requireIn(model.timeline.clips, a.clipId, 'clip');
    const start = a.start ?? clip.start;
    const duration = a.duration ?? clip.duration;
    if (start === clip.start && duration === clip.duration) return { model, label: '' };
    const updated = relink({ ...clip, start, duration }, model.transport.tempo);
    return {
      model: withTimeline(model, { clips: model.timeline.clips.map((c) => (c === clip ? updated
        : c)) }),
      label: `Resize ${clip.kind} clip`,
    };
  },

  CLIP_UPDATE(model, a) {
    const clip = requireIn(model.timeline.clips, a.clipId, 'clip');
    if (a.target != null) requireNode(model, a.target);
    const updated = { ...clip };
    if (a.target !== undefined) updated.target = a.target ?? null;
    if (a.payload !== undefined) updated.payload = normalizeClipPayload(clip.kind, a.payload);
    if (updated.target === clip.target
      && JSON.stringify(updated.payload) === JSON.stringify(clip.payload)) {
      return { model, label: '' };
    }
    return {
      model: withTimeline(model, { clips: model.timeline.clips.map((c) => (c === clip ? updated
        : c)) }),
      label: `Edit ${clip.kind} clip`,
    };
  },

  CLIP_SET_TIME_BASE(model, a) {
    const clip = requireIn(model.timeline.clips, a.clipId, 'clip');
    if (!CLIP_TIME_BASES.includes(a.timeBase)) reject(`Unknown time base "${String(a.timeBase)}".`);
    const linked = !!clip.musical;
    if ((a.timeBase === 'tempo') === linked) return { model, label: '' };
    let updated;
    if (a.timeBase === 'tempo') {
      if (clip.kind === 'measurement') {
        reject('A measurement clip is always placed in seconds; musical time never enters a '
          + 'measurement experiment.');
      }
      updated = relink({ ...clip, musical: {} }, model.transport.tempo);
    } else {
      updated = { ...clip };
      delete updated.musical;
    }
    return {
      model: withTimeline(model, { clips: model.timeline.clips.map((c) => (c === clip ? updated
        : c)) }),
      label: a.timeBase === 'tempo' ? `Link ${clip.kind} clip to tempo`
        : `Unlink ${clip.kind} clip from tempo`,
    };
  },

  AUTOMATION_POINT_ADD(model, a, ctx) {
    const target = a.target || {};
    const node = requireNode(model, target.node);
    const p = ctx.registry.param(node.type, target.param);
    if (!p || !p.automatable) reject(`${node.metadata.name} ${p ? p.label : target.param} cannot `
      + 'be automated.');
    const point = { id: ctx.newId('pt'), time: a.time, value: a.value, curve: a.curve || 'linear' };
    const lanes = model.timeline.automation;
    const lane = lanes.find((l) => l.target.node === node.id && l.target.param === p.key);
    const next = lane
      ? lanes.map((l) => (l === lane ? { ...l, points: sortPoints([...l.points, point]) } : l))
      : [...lanes, { id: ctx.newId('lane'), target: { node: node.id, param: p.key },
        points: [point] }];
    return {
      model: withTimeline(model, { automation: next }),
      label: `Automate ${node.metadata.name} ${p.label}`,
      created: { points: [point.id] },
    };
  },

  AUTOMATION_POINT_MOVE(model, a) {
    const lane = requireIn(model.timeline.automation, a.laneId, 'automation lane');
    const pt = requireIn(lane.points, a.pointId, 'automation point');
    const updated = { ...pt, time: a.time ?? pt.time, value: a.value ?? pt.value,
      curve: a.curve ?? pt.curve };
    if (updated.time === pt.time && updated.value === pt.value && updated.curve === pt.curve) {
      return { model, label: '' };
    }
    const points = sortPoints(lane.points.map((x) => (x === pt ? updated : x)));
    return {
      model: withTimeline(model, { automation: model.timeline.automation.map((l) => (l === lane
        ? { ...l, points } : l)) }),
      label: 'Move automation point',
    };
  },

  AUTOMATION_POINT_REMOVE(model, a) {
    const lane = requireIn(model.timeline.automation, a.laneId, 'automation lane');
    const pt = requireIn(lane.points, a.pointId, 'automation point');
    const points = lane.points.filter((x) => x !== pt);
    const automation = points.length
      ? model.timeline.automation.map((l) => (l === lane ? { ...l, points } : l))
      : model.timeline.automation.filter((l) => l !== lane);
    return { model: withTimeline(model, { automation }), label: 'Delete automation point' };
  },

  MARKER_ADD(model, a, ctx) {
    const kind = a.kind || 'custom';
    if (!MARKER_KINDS.includes(kind)) reject(`Unknown marker kind "${String(kind)}".`);
    const marker = { id: ctx.newId('marker'), time: a.time, kind,
      label: typeof a.label === 'string' ? a.label : '' };
    return {
      model: withTimeline(model, { markers: [...model.timeline.markers, marker] }),
      label: `Add ${kind} marker`,
      created: { markers: [marker.id] },
    };
  },

  MARKER_REMOVE(model, a) {
    const marker = requireIn(model.timeline.markers, a.markerId, 'marker');
    return {
      model: withTimeline(model, { markers: model.timeline.markers.filter((m) => m !== marker) }),
      label: `Delete ${marker.kind} marker`,
    };
  },

  MARKER_MOVE(model, a) {
    const marker = requireIn(model.timeline.markers, a.markerId, 'marker');
    const kind = a.kind ?? marker.kind;
    if (!MARKER_KINDS.includes(kind)) reject(`Unknown marker kind "${String(kind)}".`);
    const updated = { ...marker, time: a.time ?? marker.time, kind,
      label: typeof a.label === 'string' ? a.label : marker.label };
    if (updated.time === marker.time && updated.kind === marker.kind
      && updated.label === marker.label) return { model, label: '' };
    return {
      model: withTimeline(model, { markers: model.timeline.markers.map((m) => (m === marker
        ? updated : m)) }),
      label: `Move ${marker.kind} marker`,
    };
  },

  LOOP_SET(model, a) {
    const cur = model.timeline.loop;
    const loop = { enabled: a.enabled ?? cur.enabled, start: a.start ?? cur.start,
      end: a.end ?? cur.end };
    if (loop.enabled === cur.enabled && loop.start === cur.start && loop.end === cur.end) {
      return { model, label: '' };
    }
    return { model: withTimeline(model, { loop }), label: 'Change loop' };
  },

  TRANSPORT_SET(model, a) {
    const cur = model.transport;
    const transport = { timeMode: a.timeMode ?? cur.timeMode, tempo: a.tempo ?? cur.tempo,
      timeSignature: a.timeSignature ? [...a.timeSignature] : cur.timeSignature };
    if (transport.timeMode === cur.timeMode && transport.tempo === cur.tempo
      && sameValue(transport.timeSignature, cur.timeSignature)) return { model, label: '' };
    let next = { ...model, transport };
    if (transport.tempo !== cur.tempo && typeof transport.tempo === 'number'
      && transport.tempo > 0 && model.timeline.clips.some((c) => c.musical)) {
      next = withTimeline(next, { clips: model.timeline.clips.map((c) => retempo(c,
        transport.tempo)) });
    }
    return { model: next, label: transport.tempo !== cur.tempo ? 'Change tempo'
      : 'Change transport' };
  },

  METADATA_SET(model, a) {
    const cur = model.metadata;
    const metadata = { title: a.title ?? cur.title, notes: a.notes ?? cur.notes };
    if (metadata.title === cur.title && metadata.notes === cur.notes) return { model, label: '' };
    return { model: { ...model, metadata }, label: 'Change Studio details' };
  },

  PASTE(model, a, ctx) {
    const r = pasteInto(model, a.clipboard, a.offset, ctx);
    return { ...r, label: countLabel(r.created.nodes.length,
      `Paste ${nodeName(r.model, r.created.nodes[0])}`, 'Paste # nodes'),
    select: { nodes: r.created.nodes, edges: r.created.edges } };
  },

  DUPLICATE(model, a, ctx) {
    let next = model;
    const created = { nodes: [], edges: [], clips: [] };
    let skipped = [];
    if (a.nodeIds && a.nodeIds.length) {
      for (const id of a.nodeIds) requireNode(model, id);
      const r = pasteInto(model, copySubgraph(model, a.nodeIds), a.offset, ctx);
      next = r.model;
      created.nodes = r.created.nodes;
      created.edges = r.created.edges;
      skipped = r.skipped;
    }
    const placements = a.placements && typeof a.placements === 'object' ? a.placements : {};
    for (const id of a.clipIds || []) {
      const clip = requireIn(model.timeline.clips, id, 'clip');
      const place = Object.prototype.hasOwnProperty.call(placements, id) ? placements[id] : null;
      if (place && place.trackId != null) requireIn(model.timeline.tracks, place.trackId, 'track');
      let copy = { ...copyPlain(clip), id: ctx.newId('clip'),
        start: place && place.start != null ? place.start : clip.start + clip.duration,
        trackId: place && place.trackId != null ? place.trackId : clip.trackId };
      copy = relink(copy, model.transport.tempo);
      next = withTimeline(next, { clips: [...next.timeline.clips, copy] });
      created.clips.push(copy.id);
    }
    const total = created.nodes.length + created.clips.length;
    if (!total) reject('Nothing to duplicate.');
    const label = created.nodes.length === 1 && !created.clips.length
      ? `Duplicate ${nodeName(model, a.nodeIds.find((x) => !skipped.includes(x)))}`
      : created.clips.length && !created.nodes.length
        ? countLabel(created.clips.length, 'Duplicate clip', 'Duplicate # clips')
        : `Duplicate ${total} items`;
    return { model: next, label, created, skipped,
      select: { nodes: created.nodes, edges: created.edges, clips: created.clips } };
  },

  // Patches (V426, patches.js): one undoable entry each; ids from the store's allocator.
  PATCH_INSERT(model, a, ctx) {
    let r;
    try {
      r = insertPatch(model, a.patch, a.at || null, { newId: ctx.newId, registry: ctx.registry });
    } catch (err) {
      if (err instanceof PatchError) reject(err.message);
      throw err;
    }
    return { model: r.model, label: `Insert ${a.patch.name}`, created: r.created,
      skipped: r.skipped,
      select: { nodes: r.created.nodes, edges: r.created.edges } };
  },

  PATCH_REPLACE(model, a, ctx) {
    let r;
    try {
      r = replaceWithPatch(model, a.patch, { newId: ctx.newId, registry: ctx.registry,
        at: a.at || { x: 0, y: 0 } });
    } catch (err) {
      if (err instanceof PatchError) reject(err.message);
      throw err;
    }
    return { model: r.model, label: `Replace graph with ${a.patch.name}`, created: r.created,
      skipped: r.skipped, select: { nodes: r.created.nodes, edges: r.created.edges } };
  },
};

/** The semantic action types the store accepts. */
export const ACTION_TYPES = Object.freeze([...Object.keys(REDUCERS), 'SELECTION_CHANGE',
  'VIEW_SET']);

// ---------------------------------------------------------------- store

function pruneSelection(sel, model) {
  const t = model.timeline;
  const exists = {
    nodes: new Set(model.graph.nodes.map((n) => n.id)),
    edges: new Set(model.graph.edges.map((e) => e.id)),
    clips: new Set(t.clips.map((c) => c.id)),
    points: new Set(t.automation.flatMap((l) => l.points.map((p) => p.id))),
    markers: new Set(t.markers.map((m) => m.id)),
  };
  const out = {};
  for (const k of SELECTION_KEYS) {
    const list = Array.isArray(sel[k]) ? sel[k] : [];
    out[k] = Object.freeze([...new Set(list.filter((id) => exists[k].has(id)))]);
  }
  return Object.freeze(out);
}

function checkView(view, cur) {
  const v = view || {};
  const g = { ...cur.graph, ...(v.graph || {}) };
  const t = { ...cur.timeline, ...(v.timeline || {}) };
  if (![g.panX, g.panY, t.scrollX].every(finite) || !(finite(g.zoom) && g.zoom > 0)
    || !(finite(t.pxPerSecond) && t.pxPerSecond > 0)) {
    reject('View values must be finite; zoom and timeline scale must be positive.');
  }
  return { graph: { panX: g.panX, panY: g.panY, zoom: g.zoom },
    timeline: { pxPerSecond: t.pxPerSecond, scrollX: t.scrollX } };
}

/**
 * The single owner of the canonical StudioModel (§9, §47). `idGenerator(prefix)` is required
 * (createIdGenerator gives readable deterministic ids); `onChange(event)` is called after every
 * change with { type: 'model'|'selection'|'view', reason, action, label, model, selection,
 * revision }.
 */
export function createStudioStore(initialModel, {
  idGenerator, onChange = null, registry = NODE_REGISTRY, historyLimit = STUDIO_HISTORY_LIMIT,
} = {}) {
  if (typeof idGenerator !== 'function') {
    throw new TypeError('createStudioStore: an idGenerator(prefix) function is required');
  }
  let model = deepFreeze(initialModel == null ? createStudioModel({}, { registry })
    : normalizeStudio(initialModel, { registry }));
  const initial = validateStudioModel(model, { registry });
  if (!initial.ok) {
    throw new StudioSchemaError(`createStudioStore: the initial model is invalid: `
      + `${initial.errors[0].message}`);
  }
  let selection = EMPTY_SELECTION;
  let revision = 0;
  let lastAction = null;
  const history = createHistory({ limit: historyLimit });

  const emit = (type, extra = {}) => {
    if (typeof onChange === 'function') {
      onChange({ type, model, selection, revision, ...extra });
    }
  };
  const fail = (reason, diagnostics = []) => ({ ok: false, reason, diagnostics });

  // View state is persisted but not undoable (ADR 0030, 0031): a history snapshot carries the
  // view of its time, so undo, redo and cancel restore the document and keep the current view.
  const withCurrentView = (snapshot) => (snapshot.view === model.view ? snapshot
    : deepFreeze({ ...snapshot, view: model.view }));
  const setModel = (next, reason, extra = {}) => {
    model = next;
    revision++;
    selection = pruneSelection(selection, model);
    emit('model', { reason, ...extra });
  };

  function dispatch(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return fail('An action needs a type.');
    }
    try {
      if (action.type === 'SELECTION_CHANGE') {
        selection = pruneSelection(action.selection || {}, model);
        emit('selection', { reason: 'dispatch', action });
        return { ok: true, changed: false, model, revision, selection };
      }
      if (action.type === 'VIEW_SET') {
        const view = checkView(action.view, model.view);
        model = deepFreeze({ ...model, view });
        emit('view', { reason: 'dispatch', action });
        return { ok: true, changed: false, model, revision };
      }
      const reducer = Object.prototype.hasOwnProperty.call(REDUCERS, action.type)
        ? REDUCERS[action.type] : null;
      if (!reducer) return fail(`Unknown action "${action.type}".`);
      const used = collectIds(model);
      const newId = (prefix) => {
        for (let i = 0; i < MAX_ID_ATTEMPTS; i++) {
          const id = idGenerator(prefix);
          if (typeof id === 'string' && ID_PATTERN.test(id) && !used.has(id)) {
            used.add(id);
            return id;
          }
        }
        return reject('Could not allocate a unique id.');
      };
      const result = reducer(model, action, { registry, newId });
      if (result.model === model) return { ok: true, changed: false, model, revision };
      // The model holds plain JSON data only (§10, ADR 0030), whatever an action carried in
      // (a function or a prototype-setting key in a payload or pasted props: V431 A4, X9).
      if (action.type !== 'NODE_MOVE') assertPlainData(result.model);
      if (action.type !== 'NODE_MOVE') {
        const report = validateStudioModel(result.model, { registry });
        if (!report.ok) {
          const e = report.errors[0];
          return fail(e.detail ? `${e.message} (${e.detail})` : e.message, report.errors);
        }
      }
      const next = deepFreeze(result.model);
      history.record({ label: result.label, before: model, after: next,
        actionType: action.type });
      lastAction = { type: action.type, label: result.label };
      if (result.select) {
        selection = Object.freeze({ ...EMPTY_SELECTION, ...result.select });
      }
      setModel(next, 'dispatch', { action, label: result.label });
      return { ok: true, changed: true, model, revision, label: result.label,
        created: result.created || null, skipped: result.skipped || [] };
    } catch (err) {
      if (err instanceof ActionRejected) return fail(err.message, err.diagnostics);
      if (err instanceof StudioSchemaError) return fail(err.message);
      throw err;
    }
  }

  function closeGesture() {
    const entry = history.endGesture(model);
    if (entry) lastAction = { type: entry.actionType, label: entry.label };
    return entry;
  }

  return Object.freeze({
    dispatch,
    undo() {
      while (history.inGesture()) closeGesture();
      const e = history.undo();
      if (!e) return { ok: false, reason: 'Nothing to undo.' };
      setModel(withCurrentView(e.before), 'undo', { label: e.label });
      return { ok: true, label: e.label, model, revision };
    },
    redo() {
      while (history.inGesture()) closeGesture();
      const e = history.redo();
      if (!e) return { ok: false, reason: 'Nothing to redo.' };
      setModel(withCurrentView(e.after), 'redo', { label: e.label });
      return { ok: true, label: e.label, model, revision };
    },
    beginGesture(label = null) {
      history.beginGesture(label, model);
    },
    endGesture() {
      const entry = closeGesture();
      return entry ? { label: entry.label } : null;
    },
    /** Abandon the open gesture and return to the model at its start (no history entry). */
    cancelGesture() {
      const before = history.cancelGesture();
      if (before && before !== model) setModel(withCurrentView(before), 'cancel');
      return !!before;
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    undoLabel: () => history.undoLabel(),
    redoLabel: () => history.redoLabel(),
    getModel: () => model,
    getSelection: () => selection,
    getRevision: () => revision,
    getState: () => ({ model, selection, revision }),
    debugInfo() {
      const d = history.depth();
      return { undoDepth: d.undo, redoDepth: d.redo, inGesture: history.inGesture(), lastAction,
        revision, nodeCount: model.graph.nodes.length, edgeCount: model.graph.edges.length };
    },
  });
}
