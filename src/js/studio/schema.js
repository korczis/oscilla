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
// versions (§11, ADR 0023): a Studio file from the release that introduced Studio stays
// readable in later releases.
//
// Three layers of state (§163, §252-§255):
//   EXECUTION     what the compiler turns into sound and measurement: node ids, types and
//                 parameters, edges and their properties, tracks (id, kind, target), clips,
//                 automation, loop, transport. studioHash covers exactly this.
//   PRESENTATION  authored but not executed: node positions and names, track names, markers,
//                 metadata (title, notes, the keys' noteTarget, the Synth's synthAmounts).
//                 Undoable and part of the saved document, excluded from the hash.
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
//   studioHashAt(model, version) -> hex | null      the hash as an earlier epoch computed it
//   hashEpochOf(model, hash) -> version | null      which epoch's hash `hash` is (K022, D2)
//   assertPlainData(value), isSemanticallyEqual(a, b), edgeSignalType(model, edge)

import { canonicalJson } from '../experiments/canonical-json.js';
import { sha256Hex as defaultSha256Hex } from '../calibration/sha256.js';
import { FORBIDDEN_KEYS } from '../experiments/schema.js';
import { BLOCK_SCHEMA, DEFAULT_TEMPO_BPM, MAX_TEMPO_BPM, MIN_TEMPO_BPM, defaultParams }
  from '../sequencer/model.js';
import { CLIP_KINDS } from './nodes/common.js';
import { EDGE_PROPERTY_FIELDS, canConnect, defaultEdgeProps } from './ports.js';
import { sortNotes } from './notes.js';
import { NODE_REGISTRY, projectParams } from './registry.js';

export const STUDIO_SCHEMA_VERSION = 1;
export const STUDIO_KIND = 'oscilla-studio';
export const STUDIO_FILE_EXTENSION = '.oscilla-studio.json';
/** Version of the hashed execution-state selection; bump when its contents change. */
export const STUDIO_HASH_VERSION = 3;
/**
 * The parameters each hash epoch added to existing node types (D2: every new parameter on an
 * existing type lands in one epoch). Epoch 2 is K022; epoch 3 is shared by K071/K072 (the
 * percussion engine's per-voice decay, tune, level and choke group) and K229/K230 (the LFO's
 * morph, the envelope's delay and hold). A record hashed under an earlier epoch is checked by
 * studioHashAt(model, v), which leaves out what later epochs added; it matches only while those
 * parameters are at their defaults (an earlier record cannot hold them).
 */
/** Each voice of the kit (perc-recipes.js and the FM blip): decay, tune, level, choke group. */
const PERC_VOICE_KEYS = ['kickDecay', 'kickTune', 'kickLevel', 'kickChoke', 'snareDecay',
  'snareTune', 'snareLevel', 'snareChoke', 'clapDecay', 'clapTune', 'clapLevel', 'clapChoke',
  'tomLowDecay', 'tomLowTune', 'tomLowLevel', 'tomLowChoke', 'tomMidDecay', 'tomMidTune',
  'tomMidLevel', 'tomMidChoke', 'tomHighDecay', 'tomHighTune', 'tomHighLevel', 'tomHighChoke',
  'hatClosedDecay', 'hatClosedTune', 'hatClosedLevel', 'hatClosedChoke', 'hatOpenDecay',
  'hatOpenTune', 'hatOpenLevel', 'hatOpenChoke', 'noiseDecay', 'noiseTune', 'noiseLevel',
  'noiseChoke', 'blipDecay', 'blipTune', 'blipLevel', 'blipChoke'];
export const HASH_EPOCH_PARAMS = Object.freeze({
  2: Object.freeze({
    oscillator: Object.freeze(['unison', 'spread']),
    filter: Object.freeze(['slope']),
    lfo: Object.freeze(['depth', 'sync']),
    random: Object.freeze(['sync']),
    'step-modulator': Object.freeze(['sync', 'quantize']),
    gain: Object.freeze(['bypass']),
    pan: Object.freeze(['bypass']),
    drive: Object.freeze(['bypass']),
  }),
  3: Object.freeze({
    'perc-voice': Object.freeze(PERC_VOICE_KEYS),
    lfo: Object.freeze(['morph']),
    envelope: Object.freeze(['delay', 'hold']),
  }),
});
/**
 * Parameters added to a released node type without a hash epoch (K245). #447 (v3.28.0) gave the
 * Keys node keyLow and keyHigh while the hash stayed at epoch 1, so a record saved with a Keys
 * node in v3.15.0-v3.27.x hashed without them. Such a record matches its epoch's hash with these
 * left out, only while the model holds them at their defaults. Closed: a new parameter goes into
 * a hash epoch (HASH_EPOCH_PARAMS), never here.
 */
export const UNEPOCHED_PARAMS = Object.freeze([
  Object.freeze({ epoch: 1,
    params: Object.freeze({ keys: Object.freeze(['keyLow', 'keyHigh']) }) }),
]);

export { CLIP_KINDS };
export const TRACK_KINDS = Object.freeze(['event', 'measurement']);
/** Clip kinds each track kind holds (§82, §84). Automation lives in lanes, not clips. */
export const TRACK_CLIP_KINDS = Object.freeze({
  event: Object.freeze(['pattern', 'event', 'notes']),
  measurement: Object.freeze(['measurement']),
});
/** Event clip actions: gate (on for the clip's duration) or trigger (one pulse at its start). */
export const EVENT_ACTIONS = Object.freeze(['gate', 'trigger']);
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
/** Why a node position is refused: the one sentence, naming the range (V272 C9). */
export const POSITION_MESSAGE = 'A position needs finite x and y between '
  + `-${POSITION_LIMIT} and ${POSITION_LIMIT}.`;
/** True when `p` is { x, y } with finite coordinates within POSITION_LIMIT. */
export const isPosition = (p) => !!p && [p.x, p.y].every((v) => typeof v === 'number'
  && Number.isFinite(v) && Math.abs(v) <= POSITION_LIMIT);
export const NAME_MAX_CHARS = 64;
/**
 * A node's optional metadata.panel (K061): the Synth panel and module it belongs to, kept by
 * normalize, save and import, and outside the execution state (studioHash); presentation only.
 */
export const PANEL_REF_MESSAGE = 'metadata.panel must be { id, module }: an id of 1-48 letters, '
  + 'digits or dashes and a module of 1-32 lower-case letters, digits or dashes.';
export const isPanelRef = (p) => !!p && typeof p === 'object' && !Array.isArray(p)
  && Object.keys(p).every((k) => k === 'id' || k === 'module')
  && /^[a-z][a-z0-9-]{0,47}$/.test(p.id) && /^[a-z][a-z0-9-]{0,31}$/.test(p.module);
export const TITLE_MAX_CHARS = 200;
export const NOTES_MAX_CHARS = 10000;
export const DEFAULT_TITLE = 'Untitled Studio';
const MAX_PLAIN_DEPTH = 32;

/**
 * Ranges of the persisted view values (the import's, V272 A1): |panX|, |panY|, |scrollX| at most
 * `pan`; graph zoom and timeline pxPerSecond within `scale`. VIEW_SET is held to them as well.
 */
export const VIEW_LIMITS = Object.freeze({ pan: 1e9, scale: Object.freeze([1e-6, 1e6]) });
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
      metadata: { name: str(meta.name) || `${def ? def.displayName : type || 'Node'} ${k}`,
        ...(isPanelRef(meta.panel) ? { panel: { id: meta.panel.id, module: meta.panel.module } }
          : {}) },
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

/**
 * A clip payload with its kind's defaults (pattern: block params; measurement: action; notes:
 * an empty list, and the notes sorted by (at, note), notes.js).
 */
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
  if (kind === 'notes') {
    return { ...p, notes: Array.isArray(p.notes) ? sortNotes(p.notes) : p.notes ?? [] };
  }
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
    metadata: { title: str(meta.title) || DEFAULT_TITLE, notes: str(meta.notes),
      ...(str(meta.noteTarget) ? { noteTarget: meta.noteTarget } : {}),
      ...(isAmountMap(meta.synthAmounts) ? { synthAmounts: { ...meta.synthAmounts } } : {}) },
  };
}

/**
 * metadata.synthAmounts (review S10 of src/js/synth): the depth each amount knob of the Synth
 * panel comes back at once a cable broke its every edge, { amountId: depth }. Presentation
 * state, as noteTarget is: undoable and saved, never compiled and outside studioHash (no edge
 * carries it), so a document without it keeps its hash. validate.js checks its entries.
 */
const isAmountMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length > 0;

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
  const m = normalizeStudio(model, opts);
  const registry = opts.registry || NODE_REGISTRY;
  const text = canonicalJson({ ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => ({
    ...n, params: elideParams(n.type, n.params, registry) })) } });
  return space ? JSON.stringify(JSON.parse(text), null, space) : text;
}

const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * `params` of a node of `type` without the ones its definition elides at their default (`elide`,
 * K231: the xy-pad's x and y), so a model or patch that never moved them serialises and hashes,
 * at every hash epoch, as before they existed; normalizeStudio gives them back on load.
 */
export function elideParams(type, params, registry = NODE_REGISTRY) {
  const def = registry.get(type);
  if (!def || !def.params.some((p) => p.elide)) return params;
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => {
    const p = def.params.find((x) => x.key === k);
    return !(p && p.elide && canonicalJson(v) === canonicalJson(p.default));
  }));
}

/**
 * The EXECUTION state (§163, §255): what the hash covers. Arrays of identified records are
 * sorted by id, so authoring order (z-order, list order) does not change the hash. `omit`
 * (type -> keys, one UNEPOCHED_PARAMS entry's params) leaves those keys out as well (K245).
 */
export function executionState(model, version = STUDIO_HASH_VERSION, { omit = null } = {}) {
  const g = model.graph;
  const t = model.timeline;
  const params = (n) => {
    const p = version === STUDIO_HASH_VERSION ? n.params : paramsAt(n, version);
    const drop = omit && omit[n.type];
    return elideParams(n.type, drop
      ? Object.fromEntries(Object.entries(p).filter(([k]) => !drop.includes(k))) : p);
  };
  return {
    v: version,
    kind: STUDIO_KIND,
    schemaVersion: model.schemaVersion,
    nodes: byId(g.nodes).map((n) => ({ id: n.id, type: n.type, params: params(n) })),
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

/**
 * True when `b` has the execution state of `a` (what executionState selects and studioHash
 * covers), so that `b` compiles to the plan `a` compiled to: a presentation-only change (R9).
 * Cheap on the store's structurally shared models: the parts are compared by reference first and
 * only a part that is a new object is compared by content. Conservative: list order is compared
 * as well (the compile order follows it), so a reordered list is not claimed to be the same.
 */
export function sameExecutionState(a, b) {
  if (a === b) return true;
  if (!a || !b || a.schemaVersion !== b.schemaVersion) return false;
  const same = (x, y) => x === y || canonicalJson(x) === canonicalJson(y);
  const each = (xs, ys, eq) => xs === ys || (xs.length === ys.length
    && xs.every((x, i) => x === ys[i] || eq(x, ys[i])));
  const ga = a.graph;
  const gb = b.graph;
  const ta = a.timeline;
  const tb = b.timeline;
  return each(ga.nodes, gb.nodes, (x, y) => x.id === y.id && x.type === y.type
      && same(x.params, y.params))
    && each(ga.edges, gb.edges, (x, y) => x.id === y.id && same(x.from, y.from)
      && same(x.to, y.to) && same(x.props, y.props))
    && each(ta.tracks, tb.tracks, (x, y) => x.id === y.id && x.kind === y.kind
      && x.target === y.target)
    && each(ta.clips, tb.clips, same) && each(ta.automation, tb.automation, same)
    && same(ta.loop, tb.loop) && same(a.transport, b.transport);
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

/** The keys hash epochs after `version` added to `type`. */
function laterKeys(type, version) {
  const out = [];
  for (const [v, byType] of Object.entries(HASH_EPOCH_PARAMS)) {
    if (Number(v) > version && byType[type]) out.push(...byType[type]);
  }
  return out;
}

/** A node's parameters as hash epoch `version` hashed them (later epochs' keys left out). */
function paramsAt(node, version) {
  const drop = laterKeys(node.type, version);
  if (!drop.length) return node.params;
  return Object.fromEntries(Object.entries(node.params).filter(([k]) => !drop.includes(k)));
}

/**
 * studioHash of a normalized model as hash epoch `version` computed it (K022, D2), or null when
 * the model holds a value that epoch could not record: a parameter a later epoch added that is
 * not at its default.
 */
export function studioHashAt(model, version, { sha256Hex = defaultSha256Hex,
  registry = NODE_REGISTRY } = {}) {
  if (version === STUDIO_HASH_VERSION) return studioHash(model, { sha256Hex });
  if (!Number.isInteger(version) || version < 1 || version > STUDIO_HASH_VERSION) return null;
  for (const n of model.graph.nodes) {
    for (const k of laterKeys(n.type, version)) {
      if (n.params[k] === undefined) continue; // a key the node does not hold changes nothing
      const def = registry.param(n.type, k);
      if (!def || canonicalJson(n.params[k]) !== canonicalJson(def.default)) return null;
    }
  }
  return sha256Hex(canonicalJson(executionState(model, version)));
}

/**
 * Every { execution, hash } hash epoch `version` could have recorded for `model` (K245): the
 * epoch's own (studioHashAt), then the same without each UNEPOCHED_PARAMS entry of that epoch
 * whose keys the model holds, all at their defaults. [] when the epoch could not record it.
 */
export function hashRecordsAt(model, version, { sha256Hex = defaultSha256Hex,
  registry = NODE_REGISTRY } = {}) {
  const hash = studioHashAt(model, version, { sha256Hex, registry });
  if (hash === null) return [];
  const out = [{ execution: executionState(model, version), hash }];
  for (const { epoch, params: omit } of UNEPOCHED_PARAMS) {
    if (epoch !== version) continue;
    let held = false;
    let atDefault = true;
    for (const n of model.graph.nodes) {
      for (const k of omit[n.type] || []) {
        if (n.params[k] === undefined) continue;
        held = true;
        const def = registry.param(n.type, k);
        if (!def || canonicalJson(n.params[k]) !== canonicalJson(def.default)) atDefault = false;
      }
    }
    if (!held || !atDefault) continue;
    const execution = executionState(model, version, { omit });
    out.push({ execution, hash: sha256Hex(canonicalJson(execution)) });
  }
  return out;
}

/**
 * The hash epoch whose studioHash of `model` is `hash` (the current one first), or null: how a
 * saved record's stored hash is checked after an epoch bump, or a record saved before an
 * unepoched parameter existed (hashRecordsAt, K245).
 */
export function hashEpochOf(model, hash, opts = {}) {
  for (let v = STUDIO_HASH_VERSION; v >= 1; v -= 1) {
    if (hashRecordsAt(model, v, opts).some((r) => r.hash === hash)) return v;
  }
  return null;
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

/**
 * The node-removal cascade (§124), the one implementation (actions.js NODE_REMOVE, patches.js
 * replaceWithPatch): the nodes `ids` go with their edges, the clips that target them and their
 * automation lanes; tracks that target them keep their clips and lose the target.
 */
export function withoutNodes(model, ids) {
  const gone = new Set(ids);
  const t = model.timeline;
  const { noteTarget, ...meta } = model.metadata;
  return { ...model, metadata: gone.has(noteTarget) ? meta : model.metadata,
    graph: { ...model.graph, nodes: model.graph.nodes.filter((n) => !gone.has(n.id)),
      edges: model.graph.edges.filter((e) => !gone.has(e.from.node) && !gone.has(e.to.node)) },
    timeline: { ...t,
      tracks: t.tracks.map((x) => (gone.has(x.target) ? { ...x, target: null } : x)),
      clips: t.clips.filter((c) => !gone.has(c.target)),
      automation: t.automation.filter((l) => !gone.has(l.target.node)) } };
}

/** Block types a pattern clip may carry (the sequencer's, §84). */
export const PATTERN_BLOCK_TYPES = Object.freeze(Object.keys(BLOCK_SCHEMA));
