// The canonical Studio node-type registry (spec §28-§30, §79, §173-§176, §193). Pure: no DOM, no
// Web Audio, no globals; definitions are frozen plain data plus pure summary formatters, and
// they never hold audio nodes (§28).
//
//   createNodeRegistry(definitions) -> registry   (throws TypeError on an invalid definition)
//   NODE_REGISTRY                                 the registry of the §29 library
//   registry.get(type) -> def | null              registry.has(type), registry.list()
//   registry.categories() -> [{ id, label, types: [def] }]   (library order, §30)
//   registry.port(type, portId, direction) -> port | null;  registry.ports(type, direction)
//   registry.param(type, key) -> paramDef | null;  registry.defaults(type) -> params (fresh)
//   registry.search(query) -> [def]               name, aliases, category; ranked
//   registry.summarize(node) -> string            compact card text (§75)
//   validateNodeDefinition(def) -> [error text]   authoring check, used by the unit tests
//   validateParamValue(paramDef, value) -> null | error text
//   projectParams(def, params) -> params          defaults + the known keys of `params` (copy)
//   searchNodeTypes(query), getNodeType(type)     shortcuts on NODE_REGISTRY
//
// A completed definition's `inputs` lists the explicit input ports followed by one generated
// PARAMETER port per modulatable parameter (ports.js parameterPort), so the compiler, the
// validator and the editor all see the same ports.

import { CATEGORY_ORDER, CATEGORIES, CLIP_KINDS } from './nodes/common.js';
import { DIRECTIONS, parameterPort } from './ports.js';
import sources from './nodes/sources.js';
import modulation from './nodes/modulation.js';
import processing from './nodes/processing.js';
import analysis from './nodes/analysis.js';
import output from './nodes/output.js';
import measurement from './nodes/measurement.js';

export { CATEGORIES, CATEGORY_ORDER, CLIP_KINDS };

export const NODE_DEFINITIONS = Object.freeze([
  ...sources, ...modulation, ...processing, ...analysis, ...output, ...measurement,
]);

export const PARAM_TYPES = Object.freeze(['number', 'integer', 'enum', 'boolean', 'list', 'id']);
export const TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const ID_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
export const COMPILER_KEY_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.js#[A-Za-z_$][\w$]*$/;
const HELP_FIELDS = ['what', 'inputs', 'outputs', 'constraints'];
const CAPABILITIES = ['realtime', 'offline', 'measurement', 'requiresInputPermission',
  'serializable'];

// ---------------------------------------------------------------- parameter values

/** null when `value` is valid for the parameter, else a short reason. */
export function validateParamValue(p, value) {
  switch (p.type) {
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
      if (p.type === 'integer' && !Number.isInteger(value)) return 'must be an integer';
      if (value < p.min || value > p.max) return `must be between ${p.min} and ${p.max}`;
      return null;
    case 'enum':
      return p.options.some((o) => o[0] === value) ? null
        : `must be one of ${p.options.map((o) => o[0]).join(', ')}`;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'list':
      if (!Array.isArray(value)) return 'must be a list of numbers';
      if (value.length < p.minLength || value.length > p.maxLength) {
        return `must have ${p.minLength}-${p.maxLength} values`;
      }
      for (const v of value) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < p.min || v > p.max) {
          return `values must be numbers between ${p.min} and ${p.max}`;
        }
      }
      return null;
    case 'id':
      if (value === null) return p.nullable ? null : 'must not be empty';
      return typeof value === 'string' && p.pattern.test(value) ? null : 'has an invalid format';
    default:
      return 'unknown parameter type';
  }
}

const copyValue = (v) => (Array.isArray(v) ? [...v] : v);

/** Defaults overlaid with the known keys of `params` (unknown keys dropped; values copied). */
export function projectParams(def, params) {
  const out = {};
  const given = params && typeof params === 'object' ? params : {};
  for (const p of def.params) {
    out[p.key] = copyValue(Object.prototype.hasOwnProperty.call(given, p.key)
      ? given[p.key] : p.default);
  }
  return out;
}

// ---------------------------------------------------------------- definition check

/** Authoring errors of a raw (or completed) node definition; empty when valid. */
export function validateNodeDefinition(def) {
  const errors = [];
  const err = (text) => errors.push(`${def && def.type ? def.type : '?'}: ${text}`);
  if (!def || typeof def !== 'object') return ['definition is not an object'];
  if (!TYPE_ID_PATTERN.test(def.type || '')) err('invalid type id');
  if (typeof def.displayName !== 'string' || !def.displayName) err('missing displayName');
  if (!ID_PREFIX_PATTERN.test(def.idPrefix || '')) err('invalid idPrefix');
  if (!Object.values(CATEGORIES).includes(def.category)) err('unknown category');
  if (!Array.isArray(def.aliases) || def.aliases.some((a) => typeof a !== 'string' || !a)) {
    err('aliases must be non-empty strings');
  }
  const params = Array.isArray(def.params) ? def.params : [];
  const keys = new Set();
  for (const p of params) {
    if (keys.has(p.key)) err(`duplicate parameter ${p.key}`);
    keys.add(p.key);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(p.key || '')) err(`invalid parameter key ${p.key}`);
    if (!PARAM_TYPES.includes(p.type)) err(`${p.key}: unknown parameter type`);
    if (typeof p.label !== 'string' || !p.label) err(`${p.key}: missing label`);
    const numeric = p.type === 'number' || p.type === 'integer';
    if ((numeric || p.type === 'list')
      && !(Number.isFinite(p.min) && Number.isFinite(p.max) && p.min < p.max)) {
      err(`${p.key}: needs a finite range`);
    }
    if (p.type === 'list' && !(p.minLength >= 0 && p.maxLength >= p.minLength)) {
      err(`${p.key}: needs list length bounds`);
    }
    if (p.type === 'enum' && !(Array.isArray(p.options) && p.options.length)) {
      err(`${p.key}: needs options`);
    }
    if (p.scale === 'log' && !(p.min > 0)) err(`${p.key}: a log scale needs min > 0`);
    if ((p.automatable || p.modulatable) && !numeric) {
      err(`${p.key}: only numeric parameters can be automated or modulated`);
    }
    if (p.softRange && !(p.softRange[0] >= p.min && p.softRange[1] <= p.max)) {
      err(`${p.key}: softRange outside the range`);
    }
    const why = PARAM_TYPES.includes(p.type) ? validateParamValue(p, p.default) : null;
    if (why) err(`${p.key}: default ${why}`);
    if (p.modulatable && p.modDepth != null && !(Math.abs(p.modDepth) <= p.max - p.min)) {
      err(`${p.key}: modDepth exceeds the range`);
    }
  }
  const explicit = (list, direction) => {
    const ids = new Set();
    for (const port of Array.isArray(list) ? list : []) {
      if (!port || port.direction !== direction) err(`port ${port && port.id} has wrong direction`);
      else if (ids.has(port.id)) err(`duplicate ${direction} port ${port.id}`);
      else ids.add(port.id);
    }
    return ids;
  };
  const inIds = explicit((def.inputs || []).filter((p) => p.role !== 'PARAMETER'), 'in');
  explicit(def.outputs, 'out');
  for (const p of params) if (p.modulatable && inIds.has(p.key)) err(`port id ${p.key} collides`);
  if (!COMPILER_KEY_PATTERN.test(def.compiler || '')) err('missing or invalid compiler key');
  for (const r of def.reuses || []) if (!COMPILER_KEY_PATTERN.test(r)) err(`invalid reuse ${r}`);
  for (const k of def.clipKinds || []) if (!CLIP_KINDS.includes(k)) err(`unknown clip kind ${k}`);
  for (const c of CAPABILITIES) {
    if (typeof (def.capabilities || {})[c] !== 'boolean') err(`capability ${c} missing`);
  }
  for (const h of HELP_FIELDS) {
    if (typeof (def.help || {})[h] !== 'string' || !def.help[h]) err(`help.${h} missing`);
  }
  if (def.maxInstances != null && !(Number.isInteger(def.maxInstances) && def.maxInstances > 0)) {
    err('maxInstances must be a positive integer');
  }
  if (typeof def.summary !== 'function') err('missing summary formatter');
  else {
    try {
      const s = def.summary(projectParams(def, {}));
      if (typeof s !== 'string' || !s) err('summary of the defaults is empty');
    } catch (e) {
      err(`summary throws: ${e && e.message}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- registry

function complete(def) {
  const paramPorts = def.params.filter((p) => p.modulatable).map(parameterPort);
  return Object.freeze({
    ...def,
    aliases: Object.freeze([...def.aliases]),
    params: Object.freeze([...def.params]),
    inputs: Object.freeze([...def.inputs, ...paramPorts]),
    outputs: Object.freeze([...def.outputs]),
    clipKinds: Object.freeze([...def.clipKinds]),
    reuses: Object.freeze([...def.reuses]),
  });
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9&/()]+/g, ' ').trim();
}

/** Score of one query token against a definition (0 = no match). */
function tokenScore(def, token, categoryLabel) {
  const name = norm(def.displayName);
  const aliases = def.aliases.map(norm);
  if (name === token) return 100;
  if (name.split(' ').some((w) => w.startsWith(token))) return 80;
  if (aliases.includes(token)) return 70;
  if (aliases.some((a) => a.split(' ').some((w) => w.startsWith(token)))) return 60;
  if (name.includes(token)) return 50;
  if (aliases.some((a) => a.includes(token))) return 40;
  if (norm(def.type).includes(token)) return 35;
  if (norm(categoryLabel).startsWith(token)) return 30;
  return 0;
}

/** Build a registry; throws TypeError listing every authoring error. */
export function createNodeRegistry(definitions) {
  const byType = new Map();
  const order = [];
  const problems = [];
  for (const raw of definitions) {
    problems.push(...validateNodeDefinition(raw));
    if (byType.has(raw.type)) problems.push(`${raw.type}: duplicate type`);
    const def = complete(raw);
    byType.set(def.type, def);
    order.push(def);
  }
  if (problems.length) throw new TypeError(`createNodeRegistry: ${problems.join('; ')}`);
  const labels = new Map(CATEGORY_ORDER.map((c) => [c.id, c.label]));
  const list = Object.freeze(CATEGORY_ORDER.flatMap((c) => order.filter((d) =>
    d.category === c.id)));
  const get = (type) => (typeof type === 'string' && byType.has(type) ? byType.get(type) : null);
  const registry = {
    get,
    has: (type) => get(type) !== null,
    list: () => list,
    categories() {
      return CATEGORY_ORDER.map((c) => ({ id: c.id, label: c.label,
        types: list.filter((d) => d.category === c.id) }));
    },
    ports(type, direction) {
      const def = get(type);
      if (!def) return [];
      return direction === DIRECTIONS.OUT ? def.outputs : def.inputs;
    },
    port(type, portId, direction) {
      return registry.ports(type, direction).find((p) => p.id === portId) || null;
    },
    param(type, key) {
      const def = get(type);
      return def ? def.params.find((p) => p.key === key) || null : null;
    },
    defaults(type) {
      const def = get(type);
      return def ? projectParams(def, {}) : null;
    },
    search(query) {
      const tokens = norm(query || '').split(' ').filter(Boolean);
      if (!tokens.length) return list;
      const scored = [];
      list.forEach((def, i) => {
        let total = 0;
        for (const t of tokens) {
          const s = tokenScore(def, t, labels.get(def.category));
          if (!s) return;
          total += s;
        }
        scored.push({ def, total, i });
      });
      scored.sort((a, b) => b.total - a.total || a.i - b.i);
      return scored.map((x) => x.def);
    },
    summarize(node) {
      const def = node ? get(node.type) : null;
      if (!def) return 'Unknown node type';
      try {
        return def.summary(projectParams(def, node.params));
      } catch {
        return def.displayName;
      }
    },
  };
  return Object.freeze(registry);
}

export const NODE_REGISTRY = createNodeRegistry(NODE_DEFINITIONS);

/** Node types matching `query` over name, aliases and category (library order on ties). */
export function searchNodeTypes(query, registry = NODE_REGISTRY) {
  return registry.search(query);
}

/** The completed definition of `type`, or null. */
export function getNodeType(type, registry = NODE_REGISTRY) {
  return registry.get(type);
}
