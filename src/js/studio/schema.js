// The canonical Studio model (spec §9-§11, §27, §83, §97, §161-§163, §172, §252-§255). Pure: plain
// data in, plain data out; no DOM, no Web Audio, no globals, no clock, no randomness.
//
// StudioModel (schema 1):
//   { kind: 'oscilla-studio', schemaVersion: 1,
//     graph: { nodes: [{ id, type, position: { x, y }, params, metadata: { name } }],
//              edges: [{ id, from: { node, port }, to: { node, port }, props }] },
//     timeline: { tracks: [{ id, kind, name, target }],
//                 clips: [{ id, trackId, kind, start, duration, target, payload }],
//                 automation: [{ id, target: { node, param },
//                                points: [{ id, time, value, curve }] }],
//                 markers: [{ id, time, kind, label }],
//                 loop: { enabled, start, end } },
//     transport: { timeMode: 'seconds', tempo: 120, timeSignature: [4, 4] },
//     view: { graph: { panX, panY, zoom }, timeline: { pxPerSecond, scrollX } },
//     metadata: { title, notes } }
// Times are absolute seconds; positions are logical graph units (§56); `props` are the edge's
// routing properties (ports.js). The signal type of an edge is derived from its ports and never
// stored, so it cannot disagree with them. Automation points are kept sorted by time.
//
// STUDIO_SCHEMA_VERSION is independent of the product, experiment, calibration and config
// versions (§11, ADR 0023): a Studio file from 3.1.0 stays readable in later releases.
//
// Three layers of state (§163, §252-§255):
//   EXECUTION     what the compiler turns into sound and measurement: node ids, types and
//                 parameters, edges and their properties, tracks (id, kind, target), clips,
//                 automation, loop, transport. studioHash covers exactly this.
//   PRESENTATION  authored but not executed: node positions and names, track names, markers,
//                 metadata. Undoable and part of the saved document, excluded from the hash.
//   VIEW          pan, zoom, timeline scale and scroll (in the model, so they can persist
//                 locally), plus selection and hover (store-only, never serialized). Neither
//                 undoable nor dirtying nor hashed.
//
// INVARIANT (§10): a model holds plain JSON data only. assertPlainData rejects functions,
// symbols, BigInt, typed arrays, class instances (AudioNode, AudioParam, MediaStream, DOM nodes,
// p5, uPlot, workers, Map, Date, ...), prototype keys, non-finite numbers and cycles.
//
//   createStudioModel(init?) -> model               normalizeStudio(json) -> model
//   serializeStudio(model, space?) -> string        (canonical key order, §161)
//   executionState(model) / semanticState(model) / splitExecutionAndView(model)
//   studioHash(model, { sha256Hex }) -> hex         (SHA-256 of the execution state, §162)
//   assertPlainData(value), isSemanticallyEqual(a, b), edgeSignalType(model, edge)

import { canonicalJson } from '../experiments/canonical-json.js';
import { sha256Hex as defaultSha256Hex } from '../calibration/sha256.js';
import { FORBIDDEN_KEYS } from '../experiments/schema.js';
import { BLOCK_SCHEMA, DEFAULT_TEMPO_BPM, MAX_TEMPO_BPM, MIN_TEMPO_BPM, defaultParams }
  from '../sequencer/model.js';
import { CLIP_KINDS } from './nodes/common.js';
import { EDGE_PROPERTY_FIELDS, canConnect, defaultEdgeProps } from './ports.js';
import { NODE_REGISTRY, projectParams } from './registry.js';

export const STUDIO_SCHEMA_VERSION = 1;
export const STUDIO_KIND = 'oscilla-studio';
export const STUDIO_FILE_EXTENSION = '.oscilla-studio.json';
/** Version of the hashed execution-state selection; bump when its contents change. */
export const STUDIO_HASH_VERSION = 1;

export { CLIP_KINDS };
export const TRACK_KINDS = Object.freeze(['event', 'measurement']);
/** Clip kinds each track kind holds (§82, §84). Automation lives in lanes, not clips. */
export const TRACK_CLIP_KINDS = Object.freeze({
  event: Object.freeze(['pattern', 'event']),
  measurement: Object.freeze(['measurement']),
});
/** Steps of a measurement run that a measurement clip orchestrates (§108). */
export const MEASUREMENT_ACTIONS = Object.freeze(['noise-check', 'pre-roll', 'stimulus',
  'capture', 'tail', 'analysis']);
export const AUTOMATION_CURVES = Object.freeze(['step', 'linear', 'exponential']);
export const MARKER_KINDS = Object.freeze(['start', 'sweep', 'capture', 'analysis', 'end',
  'custom']);
export const TIME_MODES = Object.freeze(['seconds', 'musical']);
export const TEMPO_RANGE = Object.freeze([MIN_TEMPO_BPM, MAX_TEMPO_BPM]);
export const TIME_SIGNATURE_DENOMINATORS = Object.freeze([1, 2, 4, 8, 16, 32]);
/** Longest timeline position (s), the experiment time limit (experiments LIMITS.timeS). */
export const TIMELINE_MAX_S = 3600;
/**
 * Clip time bases (§90-§91): 'absolute' clips are positioned in seconds and ignore the tempo;
 * 'tempo' clips carry `musical: { startBeats, durationBeats }` and follow tempo changes. The
 * seconds (`start`, `duration`) stay authoritative for playback in both cases.
 */
export const CLIP_TIME_BASES = Object.freeze(['absolute', 'tempo']);
/** Largest allowed disagreement between a tempo-linked clip's seconds and its beats (s). */
export const MUSICAL_TOLERANCE_S = 1e-6;
/** Shortest clip (s): the sequencer's MIN_BLOCK_MS. */
export const MIN_CLIP_S = 0.01;
/** Largest |coordinate| of a node position, logical units. */
export const POSITION_LIMIT = 1e6;
export const NAME_MAX_CHARS = 64;
export const TITLE_MAX_CHARS = 200;
export const NOTES_MAX_CHARS = 10000;
export const DEFAULT_TITLE = 'Untitled Studio';
const MAX_PLAIN_DEPTH = 32;

export const DEFAULT_VIEW = Object.freeze({
  graph: Object.freeze({ panX: 0, panY: 0, zoom: 1 }),
  timeline: Object.freeze({ pxPerSecond: 100, scrollX: 0 }),
});
export const DEFAULT_TRANSPORT = Object.freeze({
  timeMode: 'seconds', tempo: DEFAULT_TEMPO_BPM, timeSignature: Object.freeze([4, 4]),
});
export const DEFAULT_LOOP = Object.freeze({ enabled: false, start: 0, end: 4 });

/** A model that is not plain data or not a Studio model. `path` locates the problem. */
export class StudioSchemaError extends TypeError {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message);
    this.name = 'StudioSchemaError';
    this.path = path;
  }
}

// ---------------------------------------------------------------- plain-data guard

/** Throws StudioSchemaError unless `value` is plain JSON data (see the header). */
export function assertPlainData(value, path = '$') {
  const seen = new Set();
  const walk = (v, p, depth) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new StudioSchemaError(`non-finite number ${v}`, p);
      return;
    }
    if (typeof v !== 'object') throw new StudioSchemaError(`${typeof v} is not plain data`, p);
    if (depth > MAX_PLAIN_DEPTH) {
      throw new StudioSchemaError(`nested deeper than ${MAX_PLAIN_DEPTH} levels`, p);
    }
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
      throw new StudioSchemaError('typed arrays are not allowed in a Studio model', p);
    }
    if (seen.has(v)) throw new StudioSchemaError('cycle', p);
    seen.add(v);
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) {
        throw new StudioSchemaError('array subclass is not plain data', p);
      }
      for (let i = 0; i < v.length; i++) {
        if (v[i] === undefined) throw new StudioSchemaError('undefined element', `${p}[${i}]`);
        walk(v[i], `${p}[${i}]`, depth + 1);
      }
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        const name = v.constructor && typeof v.constructor.name === 'string'
          ? v.constructor.name : 'object';
        throw new StudioSchemaError(`${name} instance is not plain data (runtime objects never `
          + 'enter the Studio model)', p);
      }
      if (Object.getOwnPropertySymbols(v).length) {
        throw new StudioSchemaError('symbol keys are not plain data', p);
      }
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.includes(k)) throw new StudioSchemaError('forbidden key', `${p}.${k}`);
        if (v[k] !== undefined) walk(v[k], `${p}.${k}`, depth + 1);
      }
    }
    seen.delete(v);
  };
  walk(value, path, 0);
  return true;
}

// ---------------------------------------------------------------- normalization

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strOrNull = (v) => (typeof v === 'string' ? v : null);

/** Deep copy of plain data (assertPlainData has already run). */
export function copyPlain(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copyPlain);
  const out = {};
  for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = copyPlain(v[k]);
  return out;
}

function normalizeNodes(list, registry) {
  const counts = new Map();
  return arr(list).map((raw) => {
    const n = obj(raw);
    const type = str(n.type);
    const def = registry.get(type);
    const k = (counts.get(type) || 0) + 1;
    counts.set(type, k);
    const meta = obj(n.metadata);
    const pos = obj(n.position);
    return {
      id: str(n.id),
      type,
      position: { x: num(pos.x, 0), y: num(pos.y, 0) },
      params: def ? projectParams(def, copyPlain(obj(n.params))) : copyPlain(obj(n.params)),
      metadata: { name: str(meta.name) || `${def ? def.displayName : type || 'Node'} ${k}` },
    };
  });
}

/** Signal type of an edge from its ports, or null when the edge is not connectable. */
export function edgeSignalType(model, edge, registry = NODE_REGISTRY) {
  const info = edgePorts(model.graph.nodes, edge, registry);
  return info ? info.type : null;
}

function edgePorts(nodes, edge, registry) {
  const from = nodes.find((n) => n.id === (edge.from && edge.from.node));
  const to = nodes.find((n) => n.id === (edge.to && edge.to.node));
  if (!from || !to) return null;
  const src = registry.port(from.type, edge.from.port, 'out');
  const tgt = registry.port(to.type, edge.to.port, 'in');
  const verdict = canConnect(src, tgt, { sourceNodeId: from.id, targetNodeId: to.id });
  if (!verdict.allowed) return null;
  const paramDef = tgt.param ? registry.param(to.type, tgt.param.key) : null;
  return { type: verdict.signalType, src, tgt, paramDef, from, to };
}

function normalizeEdges(list, nodes, registry) {
  return arr(list).map((raw) => {
    const e = obj(raw);
    const from = obj(e.from);
    const to = obj(e.to);
    const edge = {
      id: str(e.id),
      from: { node: str(from.node), port: str(from.port) },
      to: { node: str(to.node), port: str(to.port) },
      props: copyPlain(obj(e.props)),
    };
    const info = edgePorts(nodes, edge, registry);
    if (info) {
      const props = defaultEdgeProps(info.type, info.tgt, info.paramDef);
      for (const f of EDGE_PROPERTY_FIELDS[info.type]) {
        if (edge.props[f] !== undefined) props[f] = edge.props[f];
      }
      for (const f of Object.keys(edge.props)) {
        if (!EDGE_PROPERTY_FIELDS[info.type].includes(f)) props[f] = edge.props[f];
      }
      edge.props = props;
    }
    return edge;
  });
}

/** A clip payload with its kind's defaults (pattern: block params; measurement: action). */
export function normalizeClipPayload(kind, payload) {
  const p = copyPlain(obj(payload));
  if (kind === 'pattern') {
    const type = str(p.blockType, 'tone');
    const given = obj(p.params);
    const params = defaultParams(type);
    for (const k of Object.keys(given)) params[k] = given[k];
    return { ...p, blockType: type, params };
  }
  if (kind === 'measurement') return { ...p, action: str(p.action, 'stimulus') };
  return p;
}

/** Points sorted by time; equal times keep their order (a step is two points at one time). */
export function sortPoints(points) {
  return points.map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.time - b.p.time || a.i - b.i)
    .map((x) => x.p);
}

function normalizeTimeline(raw) {
  const t = obj(raw);
  const loop = obj(t.loop);
  return {
    tracks: arr(t.tracks).map((x, i) => {
      const r = obj(x);
      return { id: str(r.id), kind: str(r.kind, 'event'), name: str(r.name) || `Track ${i + 1}`,
        target: strOrNull(r.target) };
    }),
    clips: arr(t.clips).map((x) => {
      const r = obj(x);
      const kind = str(r.kind, 'pattern');
      const clip = { id: str(r.id), trackId: str(r.trackId), kind, start: num(r.start, 0),
        duration: num(r.duration, 1), target: strOrNull(r.target),
        payload: normalizeClipPayload(kind, r.payload) };
      // Tempo-linked clips (§90-§91) carry their musical position; absolute clips omit the
      // field, so models without musical clips serialize and hash exactly as before.
      if (isObj(r.musical)) {
        const mu = obj(r.musical);
        clip.musical = { startBeats: num(mu.startBeats, 0),
          durationBeats: num(mu.durationBeats, 0) };
      }
      return clip;
    }),
    automation: arr(t.automation).map((x) => {
      const r = obj(x);
      const target = obj(r.target);
      return {
        id: str(r.id),
        target: { node: str(target.node), param: str(target.param) },
        points: sortPoints(arr(r.points).map((y) => {
          const q = obj(y);
          return { id: str(q.id), time: num(q.time, 0), value: num(q.value, 0),
            curve: str(q.curve, 'linear') };
        })),
      };
    }),
    markers: arr(t.markers).map((x) => {
      const r = obj(x);
      return { id: str(r.id), time: num(r.time, 0), kind: str(r.kind, 'custom'),
        label: str(r.label) };
    }),
    loop: {
      enabled: bool(loop.enabled, DEFAULT_LOOP.enabled),
      start: num(loop.start, DEFAULT_LOOP.start),
      end: num(loop.end, DEFAULT_LOOP.end),
    },
  };
}

/**
 * The normalized model of `json` (a current-schema document or a partial one): defaults for
 * every missing field, node parameters completed from the registry, edge properties completed
 * for their signal type, automation points sorted, unknown fields dropped. It does not judge
 * values — validate.js does, before normalization on import. Never mutates its input.
 * Throws StudioSchemaError for non-plain data or another schema version.
 */
export function normalizeStudio(json, { registry = NODE_REGISTRY } = {}) {
  assertPlainData(json);
  if (!isObj(json)) throw new StudioSchemaError('a Studio model must be an object');
  if (json.kind !== undefined && json.kind !== STUDIO_KIND) {
    throw new StudioSchemaError(`kind must be "${STUDIO_KIND}"`, 'kind');
  }
  if (json.schemaVersion !== undefined && json.schemaVersion !== STUDIO_SCHEMA_VERSION) {
    throw new StudioSchemaError(`schema ${String(json.schemaVersion)} is not `
      + `${STUDIO_SCHEMA_VERSION}; migrate it first (migrate.js)`, 'schemaVersion');
  }
  const graph = obj(json.graph);
  const nodes = normalizeNodes(graph.nodes, registry);
  const transport = obj(json.transport);
  const sig = arr(transport.timeSignature);
  const view = obj(json.view);
  const vg = obj(view.graph);
  const vt = obj(view.timeline);
  const meta = obj(json.metadata);
  return {
    kind: STUDIO_KIND,
    schemaVersion: STUDIO_SCHEMA_VERSION,
    graph: { nodes, edges: normalizeEdges(graph.edges, nodes, registry) },
    timeline: normalizeTimeline(json.timeline),
    transport: {
      timeMode: str(transport.timeMode, DEFAULT_TRANSPORT.timeMode),
      tempo: num(transport.tempo, DEFAULT_TRANSPORT.tempo),
      timeSignature: [num(sig[0], 4), num(sig[1], 4)],
    },
    view: {
      graph: { panX: num(vg.panX, 0), panY: num(vg.panY, 0), zoom: num(vg.zoom, 1) },
      timeline: {
        pxPerSecond: num(vt.pxPerSecond, DEFAULT_VIEW.timeline.pxPerSecond),
        scrollX: num(vt.scrollX, 0),
      },
    },
    metadata: { title: str(meta.title) || DEFAULT_TITLE, notes: str(meta.notes) },
  };
}

/** A new, empty, normalized model; `init` may carry any part of the shape. */
export function createStudioModel(init = {}, opts = {}) {
  return normalizeStudio({ ...init, kind: STUDIO_KIND, schemaVersion: STUDIO_SCHEMA_VERSION },
    opts);
}

// ---------------------------------------------------------------- serialization and hash

/**
 * Deterministic text of a model (§161): canonical JSON (keys sorted, no whitespace) of the
 * normalized model; `space` > 0 pretty-prints the same key order.
 */
export function serializeStudio(model, space = 0, opts = {}) {
  const text = canonicalJson(normalizeStudio(model, opts));
  return space ? JSON.stringify(JSON.parse(text), null, space) : text;
}

const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * The EXECUTION state (§163, §255): what the hash covers. Arrays of identified records are
 * sorted by id, so authoring order (z-order, list order) does not change the hash.
 */
export function executionState(model) {
  const g = model.graph;
  const t = model.timeline;
  return {
    v: STUDIO_HASH_VERSION,
    kind: STUDIO_KIND,
    schemaVersion: model.schemaVersion,
    nodes: byId(g.nodes).map((n) => ({ id: n.id, type: n.type, params: n.params })),
    edges: byId(g.edges).map((e) => ({ id: e.id, from: e.from, to: e.to, props: e.props })),
    timeline: {
      tracks: byId(t.tracks).map((x) => ({ id: x.id, kind: x.kind, target: x.target })),
      clips: byId(t.clips),
      automation: byId(t.automation),
      loop: t.loop,
    },
    transport: model.transport,
  };
}

/** The PRESENTATION state: authored, undoable, saved, but not executed. */
export function presentationState(model) {
  return {
    nodes: byId(model.graph.nodes).map((n) => ({ id: n.id, position: n.position,
      metadata: n.metadata })),
    tracks: byId(model.timeline.tracks).map((x) => ({ id: x.id, name: x.name })),
    markers: byId(model.timeline.markers),
    metadata: model.metadata,
  };
}

/** Execution + presentation: what undo restores and what makes a document dirty (§254). */
export function semanticState(model) {
  return { execution: executionState(model), presentation: presentationState(model) };
}

/** { execution, presentation, view } — the three layers, as plain data. */
export function splitExecutionAndView(model) {
  return { ...semanticState(model), view: model.view };
}

/** True when two models have the same execution and presentation state (view ignored). */
export function isSemanticallyEqual(a, b) {
  return canonicalJson(semanticState(a)) === canonicalJson(semanticState(b));
}

/**
 * studioHash = SHA-256 (lowercase hex) of the canonical JSON of executionState(model) (§162).
 * Never covers view state, selection, positions, names, markers or metadata. sha256Hex defaults
 * to the bundled synchronous calibration/sha256.js.
 */
export function studioHash(model, { sha256Hex = defaultSha256Hex } = {}) {
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('studioHash: sha256Hex must be a function');
  }
  return sha256Hex(canonicalJson(executionState(model)));
}

// ---------------------------------------------------------------- lookups

/** The node with `id`, or null. */
export function findNode(model, id) {
  return model.graph.nodes.find((n) => n.id === id) || null;
}

/** Every id in the model (nodes, edges, tracks, clips, lanes, points, markers). */
export function collectIds(model) {
  const ids = new Set();
  for (const n of model.graph.nodes) ids.add(n.id);
  for (const e of model.graph.edges) ids.add(e.id);
  const t = model.timeline;
  for (const list of [t.tracks, t.clips, t.markers]) for (const x of list) ids.add(x.id);
  for (const lane of t.automation) {
    ids.add(lane.id);
    for (const p of lane.points) ids.add(p.id);
  }
  return ids;
}

/** Block types a pattern clip may carry (the sequencer's, §84). */
export const PATTERN_BLOCK_TYPES = Object.freeze(Object.keys(BLOCK_SCHEMA));
