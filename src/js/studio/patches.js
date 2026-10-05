// Studio patches (spec §111-§117, §158-§160, §238; plan issue V426): a reusable, serializable
// subgraph with its parameter defaults. Pure: plain data in, plain data out; never evals, no
// DOM, no Web Audio, no globals, no clock.
//
// Patch schema 1 — an explicit SUBSET of the StudioModel (§112), with its own kind and version:
//   { kind: 'oscilla-patch', schemaVersion: 1, studioSchemaVersion: 1,
//     name, description,
//     graph: { nodes: [{ id, type, position, params, metadata: { name } }],
//              edges: [{ id, from, to, props }] },     only edges with both ends in the patch
//     automation: [{ id, target: { node, param }, points }] }   lanes of patch nodes only
// Positions are relative to the patch's top-left node (the smallest x and y become 0). A patch
// never holds view state (pan, zoom, selection), runtime handles, tracks, clips or markers: a
// patch is a graph fragment, the timeline belongs to the project it is inserted into. Node
// parameters are complete (normalized), so a patch carries its own defaults (§111).
// `studioSchemaVersion` names the Studio schema of the embedded graph, so the graph migrates
// through migrate.js studioMigrations exactly like a project file; `schemaVersion` versions the
// patch envelope through patchMigrations.
//
//   createPatch(model, nodeIds, { name, description, includeAutomation = true }) -> patch
//   importPatch(input, { limits, migrations }) -> { ok: true, patch, warnings, migratedFrom }
//                                               | { ok: false, errors, warnings }
//     parse → size cap → safety scan → depth → kind → migrate → strict envelope check →
//     embedded graph through migrate.js importStudio with PATCH_IMPORT_LIMITS (§115, §159)
//   serializePatch(patch, space?) -> canonical JSON text (§161)
//   patchHash(patch) -> SHA-256 hex of the patch graph's execution state (schema.js studioHash)
//   insertPatch(model, patch, at?, { newId, registry }) -> { model, created, idMap, skipped }
//     new ids for every node, edge, lane and point; positions offset to `at` (§114)
//   replaceWithPatch(model, patch, { newId, registry, at }) -> { model, created, idMap,
//     skipped, removed }   the whole graph is replaced (explicit intent, §114)
//   applyPatch(model, patch, { mode: 'insert' | 'replace', at, newId }) — mode is required
// Every function that returns a model validates it (validateStudioModel) and throws PatchError
// with the first error's message instead of returning an invalid model. The store reducers
// PATCH_INSERT and PATCH_REPLACE (actions.js) call insertPatch / replaceWithPatch with the
// store's id allocator, so both are undoable single history entries.

import { canonicalJson } from '../experiments/canonical-json.js';
import { createChecker } from '../experiments/schema.js';
import { migrateExperiment } from '../experiments/migrate.js';
import { scanUntrusted, utf8Length } from '../experiments/validate.js';
import { NODE_REGISTRY } from './registry.js';
import {
  DEFAULT_TRANSPORT, NAME_MAX_CHARS, STUDIO_KIND, STUDIO_SCHEMA_VERSION, collectIds, copyPlain,
  normalizeStudio, studioHash, withoutNodes,
} from './schema.js';
import { validateStudioModel, STUDIO_IMPORT_LIMITS } from './validate.js';
import { importStudio } from './migrate.js';

export const PATCH_KIND = 'oscilla-patch';
export const PATCH_SCHEMA_VERSION = 1;
export const PATCH_FILE_EXTENSION = '.oscilla-patch.json';
export const PATCH_DESCRIPTION_MAX_CHARS = 2000;
/** Default distance (logical units) between existing content and an inserted patch. */
export const PATCH_INSERT_GAP = 120;
/**
 * Untrusted-import limits of a patch (§115): a fragment, so a quarter of the project limits
 * (STUDIO_IMPORT_LIMITS) for nodes, edges and automation; no tracks, clips or markers at all.
 */
export const PATCH_IMPORT_LIMITS = Object.freeze({
  ...STUDIO_IMPORT_LIMITS,
  maxBytes: 1024 * 1024,
  nodes: 128,
  edges: 512,
  tracks: 0,
  clips: 0,
  markers: 0,
  automationLanes: 128,
  automationPoints: 5000,
  pointsPerLane: 1024,
});

/** Envelope migrations: patchMigrations[n] upgrades patch schema n - 1 to n (1: identity). */
export const patchMigrations = Object.freeze({
  1: (doc) => doc,
});

const ENVELOPE = Object.freeze({ req: ['kind', 'schemaVersion', 'studioSchemaVersion', 'name',
  'graph'], opt: ['description', 'automation'] });

/** A patch that cannot be created, inserted or replaced; `diagnostics` from the validator. */
export class PatchError extends RangeError {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'PatchError';
    this.diagnostics = diagnostics;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkMeta(meta) {
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  if (!name || name.length > NAME_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new PatchError(`A patch name must be 1-${NAME_MAX_CHARS} printable characters.`);
  }
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (description.length > PATCH_DESCRIPTION_MAX_CHARS
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
    throw new PatchError(`A patch description must be at most ${PATCH_DESCRIPTION_MAX_CHARS} `
      + 'characters of text.');
  }
  return { name, description };
}

// ---------------------------------------------------------------- create (§113)

/** The patch of `nodeIds` (model order), its internal edges and, optionally, their lanes. */
export function createPatch(model, nodeIds, meta = {}) {
  const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
  if (!ids.size) throw new PatchError('Select at least one node to save as a patch.');
  for (const id of ids) {
    if (!model.graph.nodes.some((n) => n.id === id)) {
      throw new PatchError(`There is no node "${String(id)}".`);
    }
  }
  const { name, description } = checkMeta(meta);
  const nodes = model.graph.nodes.filter((n) => ids.has(n.id));
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const patch = {
    kind: PATCH_KIND,
    schemaVersion: PATCH_SCHEMA_VERSION,
    studioSchemaVersion: model.schemaVersion,
    name,
    description,
    graph: {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type,
        position: { x: n.position.x - minX, y: n.position.y - minY },
        params: copyPlain(n.params), metadata: { name: n.metadata.name } })),
      edges: model.graph.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
        .map((e) => copyPlain(e)),
    },
    automation: meta.includeAutomation === false ? []
      : model.timeline.automation.filter((l) => ids.has(l.target.node)).map((l) => copyPlain(l)),
  };
  const r = importPatch(patch);
  if (!r.ok) throw new PatchError(`The selection is not a valid patch: ${r.errors[0].message}`,
    r.errors);
  return r.patch;
}

// ---------------------------------------------------------------- import (§114-§115, §159)

const fail = (path, message, code = 'invalid-structure') => ({ ok: false, warnings: [],
  errors: [{ code, severity: 'error', message, path }] });

function depthOf(v, limit, depth = 0) {
  if (v === null || typeof v !== 'object') return depth;
  if (depth > limit) return depth;
  let max = depth;
  for (const k of Object.keys(v)) max = Math.max(max, depthOf(v[k], limit, depth + 1));
  return max;
}

/** The Studio document a patch's graph is validated as (no timeline but its lanes). */
function asStudioDoc(p) {
  return { kind: STUDIO_KIND, schemaVersion: p.studioSchemaVersion, graph: p.graph,
    timeline: { automation: p.automation || [] },
    transport: { timeMode: DEFAULT_TRANSPORT.timeMode, tempo: DEFAULT_TRANSPORT.tempo,
      timeSignature: [...DEFAULT_TRANSPORT.timeSignature] } };
}

/**
 * Validate an untrusted patch (JSON text or a parsed object). Never throws, never evals. The
 * returned patch is a normalized deep copy (complete parameters and edge properties, sorted
 * automation points); the input is not modified.
 */
export function importPatch(input, opts = {}) {
  const lim = { ...PATCH_IMPORT_LIMITS, ...(opts.limits || {}) };
  let doc = input;
  if (typeof input === 'string') {
    if (utf8Length(input, lim.maxBytes) > lim.maxBytes) {
      return fail('', `The patch file is larger than the ${lim.maxBytes}-byte import limit.`,
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
  if (scan.length) {
    return { ok: false, warnings: [], errors: scan.map((e) => ({ code: 'invalid-structure',
      severity: 'error', message: e.text, path: e.path })) };
  }
  if (depthOf(doc, lim.depth) > lim.depth) {
    return fail('', `The data is nested deeper than ${lim.depth} levels.`, 'limit-exceeded');
  }
  if (!isObj(doc)) return fail('', 'The file does not contain a patch object.');
  if (doc.kind !== PATCH_KIND) {
    return fail('kind', doc.kind === STUDIO_KIND
      ? 'This is an OSCILLA Studio project file, not a patch.'
      : `kind must be "${PATCH_KIND}".`);
  }
  const migrated = migrateExperiment(doc, { migrations: opts.migrations || patchMigrations,
    targetVersion: PATCH_SCHEMA_VERSION });
  if (!migrated.ok) {
    return { ok: false, warnings: [], errors: migrated.errors.map((e) => ({
      code: 'unsupported-version', severity: 'error', path: e.path,
      message: e.text.replace(/^experiment schema/, 'Patch schema')
        .replace('not an experiment object', 'not a patch object') })) };
  }
  const p = migrated.experiment;
  const c = createChecker(lim.maxErrors);
  // Codes are given where each check is made (createChecker add(path, text, code)), never read
  // back from the message: a length over its limit is limit-exceeded, a Studio schema newer
  // than this build is unsupported-version, anything else invalid-structure.
  const text = (v, path, max, o) => (typeof v === 'string' && v.length > max
    ? c.add(path, `longer than ${max} characters`, 'limit-exceeded') : c.str(v, path, max, o));
  if (c.keys(p, '', ENVELOPE.req, ENVELOPE.opt)) {
    text(p.name, 'name', NAME_MAX_CHARS, { min: 1 });
    if (p.description !== undefined) {
      text(p.description, 'description', PATCH_DESCRIPTION_MAX_CHARS, { multiline: true });
    }
    const v = p.studioSchemaVersion;
    if (Number.isInteger(v) && v > STUDIO_SCHEMA_VERSION) {
      c.add('studioSchemaVersion', `Studio schema ${v} is newer than this version of OSCILLA `
        + `supports (${STUDIO_SCHEMA_VERSION}); open the patch in a newer version.`,
      'unsupported-version');
    } else {
      c.num(v, 'studioSchemaVersion', 1, STUDIO_SCHEMA_VERSION, { integer: true });
    }
    if (p.automation !== undefined && !Array.isArray(p.automation)) {
      c.add('automation', 'must be a list');
    }
  }
  if (c.errors.length) {
    return { ok: false, warnings: [], errors: c.errors.map((e) => ({
      code: e.code || 'invalid-structure', severity: 'error', message: e.text, path: e.path })) };
  }
  const studio = importStudio(asStudioDoc(p), { limits: lim, registry: opts.registry });
  if (!studio.ok) {
    return { ok: false, warnings: studio.warnings || [], errors: studio.errors.map((e) => ({
      ...e, path: e.path.replace(/^timeline\.automation/, 'automation') })) };
  }
  const m = studio.model;
  return {
    ok: true,
    warnings: studio.warnings,
    migratedFrom: migrated.applied.length ? migrated.from : null,
    patch: {
      kind: PATCH_KIND,
      schemaVersion: PATCH_SCHEMA_VERSION,
      studioSchemaVersion: m.schemaVersion,
      name: p.name.trim(),
      description: typeof p.description === 'string' ? p.description.trim() : '',
      graph: { nodes: m.graph.nodes, edges: m.graph.edges },
      automation: m.timeline.automation,
    },
  };
}

/** Deterministic text of a (valid) patch: canonical JSON, keys sorted (§161). */
export function serializePatch(patch, space = 0) {
  const r = importPatch(patch);
  if (!r.ok) throw new PatchError(`Invalid patch: ${r.errors[0].message}`, r.errors);
  const text = canonicalJson(r.patch);
  return space ? JSON.stringify(JSON.parse(text), null, space) : text;
}

/** SHA-256 of the patch graph's execution state (what it does, not where it is drawn). */
export function patchHash(patch) {
  const r = importPatch(patch);
  if (!r.ok) throw new PatchError(`Invalid patch: ${r.errors[0].message}`, r.errors);
  return studioHash(normalizeStudio(asStudioDoc(r.patch)));
}

// ---------------------------------------------------------------- insert / replace (§114)

/** The store's id scheme (actions.js createIdGenerator) seeded with every id of `model`. */
function allocator(model) {
  const used = collectIds(model);
  const next = new Map();
  for (const id of used) {
    const m = /^(.*)-(\d+)$/.exec(id);
    if (m) next.set(m[1], Math.max(next.get(m[1]) || 1, Number(m[2]) + 1));
  }
  return (prefix) => {
    let id;
    do {
      const n = next.get(prefix) || 1;
      next.set(prefix, n + 1);
      id = `${prefix}-${n}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

function defaultName(nodes, def) {
  const re = new RegExp(`^${escapeRe(def.displayName)} (\\d+)$`);
  let max = 0;
  for (const n of nodes) {
    const m = re.exec(n.metadata.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${def.displayName} ${max + 1}`;
}

/** Where a patch goes when no position is given: right of the existing content. */
export function defaultInsertPosition(model) {
  const nodes = model.graph.nodes;
  if (!nodes.length) return { x: 0, y: 0 };
  return { x: Math.max(...nodes.map((n) => n.position.x)) + PATCH_INSERT_GAP,
    y: Math.min(...nodes.map((n) => n.position.y)) };
}

function validPatch(patch, registry) {
  const r = importPatch(patch, { registry });
  if (!r.ok) throw new PatchError(`The patch is invalid: ${r.errors[0].message}`, r.errors);
  return r.patch;
}

function checked(model, registry) {
  const report = validateStudioModel(model, { registry });
  if (!report.ok) {
    const e = report.errors[0];
    throw new PatchError(e.detail ? `${e.message} (${e.detail})` : e.message, report.errors);
  }
  return model;
}

/**
 * Insert a copy of `patch` into `model` (§114): every node, edge, lane and point gets a new id
 * from `newId(prefix)` (default: the store's scheme over the model's ids), positions are moved
 * so the patch's top-left lands at `at` (default: defaultInsertPosition), default names are
 * renumbered ("Filter 2") and custom names kept. A node over its type's maxInstances (Master
 * Output when the model has one) is skipped with its edges and lanes and reported in
 * `skipped` (patch node ids). Returns { model, created: { nodes, edges, lanes, points }, idMap,
 * skipped }; throws PatchError when the patch or the result is invalid.
 */
export function insertPatch(model, patch, at = null, { newId = null,
  registry = NODE_REGISTRY } = {}) {
  const p = validPatch(patch, registry);
  const alloc = typeof newId === 'function' ? newId : allocator(model);
  const pos = at || defaultInsertPosition(model);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    throw new PatchError('A position needs finite x and y.');
  }
  const nodes = [...model.graph.nodes];
  const counts = new Map();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
  const idMap = {};
  const skipped = [];
  const created = { nodes: [], edges: [], lanes: [], points: [] };
  for (const src of p.graph.nodes) {
    const def = registry.get(src.type);
    if (def.maxInstances != null && (counts.get(def.type) || 0) >= def.maxInstances) {
      skipped.push(src.id);
      continue;
    }
    counts.set(def.type, (counts.get(def.type) || 0) + 1);
    const numbered = new RegExp(`^${escapeRe(def.displayName)} \\d+$`).test(src.metadata.name);
    const node = { id: alloc(def.idPrefix), type: src.type,
      position: { x: pos.x + src.position.x, y: pos.y + src.position.y },
      params: copyPlain(src.params),
      metadata: { name: numbered ? defaultName(nodes, def) : src.metadata.name } };
    idMap[src.id] = node.id;
    nodes.push(node);
    created.nodes.push(node.id);
  }
  if (!created.nodes.length) {
    throw new PatchError('Nothing to insert: the Studio already has every node of this patch '
      + 'that may exist only once.');
  }
  const edges = [...model.graph.edges];
  for (const e of p.graph.edges) {
    if (!idMap[e.from.node] || !idMap[e.to.node]) continue;
    const edge = { id: alloc('edge'), from: { node: idMap[e.from.node], port: e.from.port },
      to: { node: idMap[e.to.node], port: e.to.port }, props: copyPlain(e.props) };
    edges.push(edge);
    created.edges.push(edge.id);
  }
  const automation = [...model.timeline.automation];
  for (const l of p.automation) {
    if (!idMap[l.target.node]) continue;
    const lane = { id: alloc('lane'), target: { node: idMap[l.target.node], param: l.target.param },
      points: l.points.map((pt) => ({ ...copyPlain(pt), id: alloc('pt') })) };
    automation.push(lane);
    created.lanes.push(lane.id);
    created.points.push(...lane.points.map((pt) => pt.id));
  }
  const next = { ...model, graph: { ...model.graph, nodes, edges },
    timeline: { ...model.timeline, automation } };
  return { model: checked(next, registry), created, idMap, skipped };
}

/**
 * Replace the whole graph with `patch` (explicit intent, §114): every node goes, with its edges,
 * automation lanes and the clips that target it; track targets are cleared; tracks, other clips,
 * markers, loop, transport, view and metadata stay. The patch is then inserted at `at`
 * (default { x: 0, y: 0 }) with new ids. Returns insertPatch's result plus `removed` (node ids).
 */
export function replaceWithPatch(model, patch, { newId = null, registry = NODE_REGISTRY,
  at = { x: 0, y: 0 } } = {}) {
  validPatch(patch, registry);
  const gone = model.graph.nodes.map((n) => n.id);
  const alloc = typeof newId === 'function' ? newId : allocator(model);
  const r = insertPatch(withoutNodes(model, gone), patch, at, { newId: alloc, registry });
  return { ...r, removed: gone };
}

/** Insert or replace, by explicit mode (no default: §114 "with explicit user intent"). */
export function applyPatch(model, patch, { mode, at = null, newId = null,
  registry = NODE_REGISTRY } = {}) {
  if (mode === 'insert') return insertPatch(model, patch, at, { newId, registry });
  if (mode === 'replace') {
    return replaceWithPatch(model, patch, { newId, registry, at: at || { x: 0, y: 0 } });
  }
  throw new PatchError('Choose how to load the patch: mode "insert" or "replace".');
}
